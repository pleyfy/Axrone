#include <stdint.h>
#include <stdio.h>

#include "core/query.h"
#include "core/solver.h"
#include "core/world.h"
#include "runtime/arena.h"

using namespace axrone::physics;

namespace {

alignas(64) unsigned char g_memory[64 * 1024 * 1024];
alignas(64) unsigned char g_probeMemory[64 * 1024 * 1024];

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

bool matricesAgree(const Mat3& left, const Mat3& right) {
    for (int32_t index = 0; index < 9; ++index) {
        if (left.m[index] != right.m[index]) {
            return false;
        }
    }
    return true;
}

int32_t countBodiesOutOfSyncWithTheirTransform(const World& world) {
    int32_t mismatches = 0;
    for (int32_t id = 0; id < world.highWater; ++id) {
        if (world.bodies[id].state == kBodyFree) {
            continue;
        }
        const Transform& transform = world.transforms[id];
        Mat3 expected;
        expected.fromQuaternion(transform.qx, transform.qy, transform.qz, transform.qw);
        if (!matricesAgree(world.bodies[id].rotation, expected)) {
            ++mismatches;
        }
    }
    return mismatches;
}

bool initWorld(World& world, Arena& arena, int32_t bodyCapacity, int32_t contactCapacity) {
    arena.init(g_memory, sizeof(g_memory));
    return world.init(arena, bodyCapacity, contactCapacity, Vec3(0.0f, -9.81f, 0.0f));
}

int32_t addBox(World& world, int32_t type, float x, float y, float z, float half) {
    const int32_t id = world.createBody(type, x, y, z, 0.0f, 0.0f, 0.0f, 1.0f);
    if (id < 0) {
        return id;
    }
    world.setBox(id, half, half, half, type == kBodyTypeDynamic ? 1.0f : 0.0f);
    world.setMaterial(id, 0.7f, 0.0f);
    return id;
}

void buildPile(World& world, int32_t& lower, int32_t& upper) {
    lower = -1;
    upper = -1;
    const int32_t ground = addBox(world, kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.5f);
    world.setMaterial(ground, 0.8f, 0.0f);
    for (int32_t row = 0; row < 5; ++row) {
        for (int32_t column = 0; column < 5; ++column) {
            const float x = (static_cast<float>(column) - 2.0f) * 1.1f;
            const float z = (static_cast<float>(row) - 2.0f) * 1.1f;
            const int32_t id = addBox(world, kBodyTypeDynamic, x, 0.45f, z, 0.5f);
            if (row == 0 && column == 0) {
                lower = id;
            }
            if (row == 0 && column == 1) {
                upper = id;
            }
        }
    }
}

int32_t attachHinge(World& world, int32_t lower, int32_t upper) {
    return world.createHinge(lower, upper, Vec3(0.5f, 0.0f, 0.0f), Vec3(-0.5f, 0.0f, 0.0f),
        Vec3(0.0f, 1.0f, 0.0f), Vec3(0.0f, 1.0f, 0.0f), 0, 0.0f, 0.0f, 1, 1.0f, 10.0f, 1);
}

uint64_t fingerprintOfPile(bool withHinge, int32_t positionIterations, int32_t steps) {
    World world;
    Arena arena;
    arena.init(g_probeMemory, sizeof(g_probeMemory));
    if (!world.init(arena, 64, 4096, Vec3(0.0f, -9.81f, 0.0f))) {
        return 0;
    }
    int32_t lower = -1;
    int32_t upper = -1;
    buildPile(world, lower, upper);
    if (withHinge && attachHinge(world, lower, upper) < 0) {
        return 0;
    }
    for (int32_t step = 0; step < steps; ++step) {
        world.step(1.0f / 60.0f, 10, positionIterations);
    }
    return world.fingerprint();
}

int32_t countRestingBodies(const World& world) {
    int32_t asleep = 0;
    for (int32_t id = 0; id < world.highWater; ++id) {
        if (world.bodies[id].state == kBodyDynamic && world.bodies[id].awake == 0) {
            ++asleep;
        }
    }
    return asleep;
}

void everySiteKeepsTheDerivedMatrixEqualToItsTransform() {
    World world;
    Arena arena;
    CHECK_LABEL(initWorld(world, arena, 64, 4096), "the funnel world initializes");

    const int32_t ground = addBox(world, kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.5f);
    world.setMaterial(ground, 0.8f, 0.0f);
    CHECK_LABEL(countBodiesOutOfSyncWithTheirTransform(world) == 0,
        "createBody leaves the derived matrix equal to the identity built from its own transform");

    const int32_t tilted = world.createBody(kBodyTypeDynamic, 0.0f, 6.0f, 0.0f, 0.0f, 0.3826834f, 0.0f, 0.9238795f);
    world.setBox(tilted, 0.4f, 0.4f, 0.4f, 1.0f);
    CHECK_LABEL(countBodiesOutOfSyncWithTheirTransform(world) == 0,
        "a body created with a non-identity quaternion is derived from that quaternion");

    CHECK_LABEL(world.setTransform(tilted, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0, "the tilted body is reset");
    CHECK_LABEL(countBodiesOutOfSyncWithTheirTransform(world) == 0,
        "setTransform refreshes the derived matrix in the same call that writes the transform");

    int32_t lower = -1;
    int32_t upper = -1;
    buildPile(world, lower, upper);
    CHECK_LABEL(lower >= 0 && upper >= 0, "the grid pile is built beside the first body");

    const int32_t hinge = attachHinge(world, lower, upper);
    CHECK_LABEL(hinge >= 0, "a motorised hinge joins two pile bodies");
    CHECK_LABEL(world.constraintCount > 0,
        "premise: the hinge occupies a constraint slot, so the joint passes have rows to solve");

    const uint64_t withPosition = fingerprintOfPile(true, 4, 60);
    const uint64_t withoutPosition = fingerprintOfPile(true, 0, 60);
    CHECK_LABEL(withPosition != 0 && withoutPosition != 0 && withoutPosition != withPosition,
        "premise: switching the position pass off changes this scene, so position impulses really fire here");

    const uint64_t withoutHinge = fingerprintOfPile(false, 4, 60);
    CHECK_LABEL(withoutHinge != 0 && withoutHinge != withPosition,
        "premise: removing the hinge changes this scene, so joint position rows really fire here");

    for (int32_t step = 0; step < 240; ++step) {
        world.step(1.0f / 60.0f, 10, 4);
    }
    printf("settle: %d contacts, %d bodies out of sync\n", world.contactCount,
        countBodiesOutOfSyncWithTheirTransform(world));
    CHECK_LABEL(world.contactCount > 0,
        "premise: the settled pile still carries contact points for the position pass to read");
    CHECK_LABEL(countBodiesOutOfSyncWithTheirTransform(world) == 0,
        "after 240 settling steps every derived matrix still equals its transform, through integrate, "
        "position impulses and joint position rows alike");

    for (int32_t step = 0; step < 20; ++step) {
        world.setTransform(lower, 0.25f, 0.6f, 0.25f, 0.0f, 0.1986693f, 0.0f, 0.9800666f);
        world.step(1.0f / 60.0f, 10, 4);
    }
    CHECK_LABEL(countBodiesOutOfSyncWithTheirTransform(world) == 0,
        "repeatedly teleporting a body between steps cannot desynchronise the derived matrix");

    World resting;
    Arena restingArena;
    restingArena.init(g_probeMemory, sizeof(g_probeMemory));
    CHECK_LABEL(resting.init(restingArena, 64, 4096, Vec3(0.0f, -9.81f, 0.0f)), "the resting world initializes");
    int32_t restingLower = -1;
    int32_t restingUpper = -1;
    buildPile(resting, restingLower, restingUpper);
    resting.setAllowSleep(1);
    for (int32_t step = 0; step < 900; ++step) {
        resting.step(1.0f / 60.0f, 10, 4);
    }
    const int32_t asleep = countRestingBodies(resting);
    const StepStatistics statistics = resting.stepStatistics();
    printf("sleep: %d bodies resting, statistics sleepingBodies=%f liveRecordedSteps=%u\n",
        asleep, statistics.sleepingBodies, statistics.stepsRecorded);
    CHECK_LABEL(statistics.stepsRecorded > 0, "premise: the resting world really stepped");
    CHECK_LABEL(asleep > 0,
        "premise: a body really fell asleep, so the sleep-restore branch is the code judged next");
    CHECK_LABEL(countBodiesOutOfSyncWithTheirTransform(resting) == 0,
        "the sleep-restore branch refreshes the derived matrix like every other site");
}

}

int main() {
    everySiteKeepsTheDerivedMatrixEqualToItsTransform();
    printf("rotation_funnel_test: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
