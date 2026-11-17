#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "core/solver.h"
#include "core/world.h"
#include "runtime/arena.h"

using namespace axrone::physics;

namespace {

alignas(64) unsigned char g_memory[64 * 1024 * 1024];

int g_checks = 0;
int g_failures = 0;

#define CHECK_LABEL(condition, label)                                             \
    do {                                                                          \
        ++g_checks;                                                               \
        if (!(condition)) {                                                       \
            printf("FAIL %s:%d %s\n", __FILE__, __LINE__, label);                 \
            ++g_failures;                                                         \
        } else {                                                                  \
            printf("ok   %s\n", label);                                           \
        }                                                                         \
    } while (0)

uint32_t bitsOf(float value) {
    uint32_t raw = 0;
    memcpy(&raw, &value, sizeof(raw));
    return raw;
}

uint32_t mix(uint32_t state, uint32_t value) {
    return (state ^ value) * 16777619u;
}

bool initWorld(World& world, Arena& arena, int32_t bodyCapacity, int32_t contactCapacity) {
    arena.init(g_memory, sizeof(g_memory));
    return world.init(arena, bodyCapacity, contactCapacity, Vec3(0.0f, -9.81f, 0.0f));
}

int32_t addBox(World& world, int32_t type, float x, float y, float z, float half, float density) {
    const int32_t id = world.createBody(type, x, y, z, 0.0f, 0.0f, 0.0f, 1.0f);
    if (id < 0) {
        return id;
    }
    world.setBox(id, half, half, half, density);
    world.setMaterial(id, 0.7f, 0.0f);
    return id;
}

void buildStack(World& world, Arena& arena) {
    CHECK_LABEL(initWorld(world, arena, 64, 4096), "the stack world initializes");
    const int32_t ground = addBox(world, kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.5f, 0.0f);
    world.setMaterial(ground, 0.8f, 0.0f);
    for (int32_t index = 0; index < 6; ++index) {
        addBox(world, kBodyTypeDynamic, 0.0f, 0.45f + 1.05f * static_cast<float>(index), 0.0f, 0.5f, 1.0f);
    }
    addBox(world, kBodyTypeDynamic, 1.1f, 0.45f, 0.0f, 0.5f, 1.0f);
    addBox(world, kBodyTypeKinematic, -1.1f, 0.45f, 0.0f, 0.5f, 0.0f);
}

void buildJointedPile(World& world, Arena& arena) {
    CHECK_LABEL(initWorld(world, arena, 64, 4096), "the jointed pile world initializes");
    const int32_t ground = addBox(world, kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.5f, 0.0f);
    world.setMaterial(ground, 0.8f, 0.0f);
    int32_t first = -1;
    int32_t previous = -1;
    for (int32_t row = 0; row < 4; ++row) {
        for (int32_t column = 0; column < 4; ++column) {
            const float x = (static_cast<float>(column) - 1.5f) * 1.1f;
            const float z = (static_cast<float>(row) - 1.5f) * 1.1f;
            const int32_t id = addBox(world, kBodyTypeDynamic, x, 0.45f, z, 0.5f, 1.0f);
            if (row == 0 && column == 0) {
                first = id;
            }
            if (previous >= 0) {
                world.createHinge(previous, id, Vec3(0.5f, 0.0f, 0.0f), Vec3(-0.5f, 0.0f, 0.0f),
                    Vec3(0.0f, 1.0f, 0.0f), Vec3(0.0f, 1.0f, 0.0f), 0, 0.0f, 0.0f, 1, 0.5f, 5.0f, 1);
            }
            previous = id;
        }
    }
    world.createSpring(first, previous, Vec3(), Vec3(), 1.0f, 12.0f, 0.4f, 0);
}

uint32_t impulseChecksum(const World& world) {
    uint32_t state = 2166136261u;
    for (int32_t k = 0; k < world.contactCount; ++k) {
        state = mix(state, bitsOf(world.contacts[k].impN));
        state = mix(state, bitsOf(world.contacts[k].impT1));
        state = mix(state, bitsOf(world.contacts[k].impT2));
    }
    return state;
}

uint32_t velocityChecksum(const World& world) {
    uint32_t state = 2166136261u;
    for (int32_t id = 0; id < world.highWater; ++id) {
        if (world.bodies[id].state == kBodyFree) {
            continue;
        }
        state = mix(state, bitsOf(world.velocities[id].x));
        state = mix(state, bitsOf(world.velocities[id].y));
        state = mix(state, bitsOf(world.velocities[id].z));
        state = mix(state, bitsOf(world.angularVelocities[id].x));
        state = mix(state, bitsOf(world.angularVelocities[id].y));
        state = mix(state, bitsOf(world.angularVelocities[id].z));
    }
    return state;
}

bool everyImpulseFinite(const World& world) {
    for (int32_t k = 0; k < world.contactCount; ++k) {
        if (!isFinite(world.contacts[k].impN) || !isFinite(world.contacts[k].impT1)
            || !isFinite(world.contacts[k].impT2)) {
            return false;
        }
    }
    return true;
}

struct Golden {
    int32_t contacts;
    uint64_t fingerprint;
    uint32_t impulses;
    uint32_t velocities;
};

void recordScene(const char* label, int32_t steps, const Golden& golden) {
    World world;
    Arena arena;
    if (strcmp(label, "stack") == 0) {
        buildStack(world, arena);
    } else {
        buildJointedPile(world, arena);
    }
    for (int32_t step = 0; step < steps; ++step) {
        world.step(1.0f / 60.0f, 10, 4);
    }
    printf("%s contacts=%d fingerprint=%016llx impulses=%08x velocities=%08x\n", label, world.contactCount,
        static_cast<unsigned long long>(world.fingerprint()), impulseChecksum(world), velocityChecksum(world));
    CHECK_LABEL(world.contactCount == golden.contacts, "the contact population is the recorded one");
    CHECK_LABEL(world.fingerprint() == golden.fingerprint,
        "the whole-world digest is the value the pre-hoist velocity pass produced");
    CHECK_LABEL(impulseChecksum(world) == golden.impulses,
        "every accumulated impulse is bit-identical to the recorded pass");
    CHECK_LABEL(velocityChecksum(world) == golden.velocities,
        "every body linear and angular velocity is bit-identical to the recorded pass");
    CHECK_LABEL(everyImpulseFinite(world), "no contact impulse escapes into a non-finite value");
    CHECK_LABEL(world.contactCount > 0, "the scene carries contacts for the velocity pass to solve");
}

void warmStartReconstructionStillMatches() {
    World world;
    Arena arena;
    buildStack(world, arena);
    for (int32_t step = 0; step < 8; ++step) {
        world.step(1.0f / 60.0f, 10, 4);
    }
    const StepStatistics statistics = world.stepStatistics();
    CHECK_LABEL(statistics.cacheLookups > 0, "the repeating stack asks the warm-start cache for its points");
    CHECK_LABEL(statistics.cacheHits > 0, "and the warm-start cache answers them");
    CHECK_LABEL(statistics.cacheHits <= statistics.cacheLookups, "hits can never exceed lookups");
}

}

int main() {
    const Golden stack120{30, 0x7b34f079454c7ba3ull, 0xaf36444cu, 0x8f082f31u};
    const Golden pile120{14, 0x30e7342a76c830afull, 0xb99dfc95u, 0xabdd0ff0u};
    const Golden stack40{26, 0xfe9d8b0516ec6ee4ull, 0x9c1e0fc4u, 0x21b54747u};
    const Golden pile40{27, 0xe66313be3b07fccfull, 0xd057e555u, 0x0e0b5e82u};
    recordScene("stack", 120, stack120);
    recordScene("pile", 120, pile120);
    recordScene("stack", 40, stack40);
    recordScene("pile", 40, pile40);
    warmStartReconstructionStillMatches();
    printf("solver_pair_state_test: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
