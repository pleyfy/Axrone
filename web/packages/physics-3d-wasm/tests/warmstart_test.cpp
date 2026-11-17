#include <stdint.h>
#include <stdio.h>

#include "core/query.h"
#include "core/world.h"
#include "runtime/arena.h"

using namespace axrone::physics;

namespace {

alignas(64) unsigned char g_memory[64 * 1024 * 1024];

int g_checks = 0;
int g_failures = 0;

#define CHECK(condition)                                                          \
    do {                                                                          \
        ++g_checks;                                                               \
        if (!(condition)) {                                                       \
            printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition);           \
            ++g_failures;                                                         \
        }                                                                         \
    } while (0)

bool initWorld(World& world, Arena& arena, int32_t bodyCapacity, int32_t contactCapacity) {
    arena.init(g_memory, sizeof(g_memory));
    return world.init(arena, bodyCapacity, contactCapacity, Vec3(0.0f, -9.81f, 0.0f));
}

int32_t makeBox(World& world, int32_t type, float x, float y, float z, float half) {
    const int32_t id = world.createBody(type, x, y, z, 0.0f, 0.0f, 0.0f, 1.0f);
    if (id < 0) {
        return id;
    }
    world.setBox(id, half, half, half, type == kBodyTypeDynamic ? 1.0f : 0.0f);
    return id;
}

int32_t makeGround(World& world, float x) {
    const int32_t id = world.createBody(kBodyTypeStatic, x, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    if (id >= 0) {
        world.setBox(id, 20.0f, 0.5f, 20.0f, 0.0f);
    }
    return id;
}

double hitRate(const StepStatistics& statistics) {
    return statistics.cacheLookups == 0
        ? 0.0
        : static_cast<double>(statistics.cacheHits) / static_cast<double>(statistics.cacheLookups);
}

double pointIdentityRate(const StepStatistics& statistics) {
    return statistics.pointIdentitiesPrevStep == 0
        ? 0.0
        : static_cast<double>(statistics.pointIdentitiesRepeatingPrevStep) / static_cast<double>(statistics.pointIdentitiesPrevStep);
}

void settledPileReusesWarmStartEntries() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, 256, 4096));
    CHECK(makeGround(world, 0.0f) >= 0);
    for (int32_t row = 0; row < 4; ++row) {
        for (int32_t column = 0; column < 4; ++column) {
            makeBox(
                world,
                kBodyTypeDynamic,
                static_cast<float>(row) * 1.1f,
                0.55f + static_cast<float>(column) * 1.05f,
                static_cast<float>(column) * 1.1f,
                0.5f);
        }
    }
    for (int32_t index = 0; index < 60; ++index) {
        world.step(1.0f / 60.0f, 10, 4);
    }
    const StepStatistics statistics = world.stepStatistics();
    CHECK(statistics.cacheLookups > 0);
    CHECK(statistics.cacheStores > 0);
    CHECK(statistics.cacheStores == statistics.cacheLookups);
    CHECK(hitRate(statistics) > 0.5);
    CHECK(statistics.pointIdentitiesPrevStep > 0);
    CHECK(pointIdentityRate(statistics) > 0.5);
}

void teleportingBodiesBreakReuse() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, 256, 4096));
    CHECK(makeGround(world, 0.0f) >= 0);
    CHECK(makeBox(world, kBodyTypeStatic, 24.0f, -0.5f, 0.0f, 0.5f) >= 0);
    const int32_t box = makeBox(world, kBodyTypeDynamic, 0.0f, 0.45f, 0.0f, 0.5f);
    for (int32_t index = 0; index < 20; ++index) {
        const float x = static_cast<float>(index % 2) * 24.0f;
        world.setTransform(box, x, 0.45f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        world.step(1.0f / 60.0f, 10, 4);
    }
    const StepStatistics statistics = world.stepStatistics();
    CHECK(statistics.cacheLookups > 0);
    CHECK(hitRate(statistics) < 0.5);
    CHECK(statistics.pointIdentitiesPrevStep > 0);
    CHECK(pointIdentityRate(statistics) < 0.5);
}

void teleportingBodiesOnOneGroundKeepPointIdentity() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, 256, 4096));
    CHECK(makeGround(world, 0.0f) >= 0);
    const int32_t box = makeBox(world, kBodyTypeDynamic, 0.0f, 0.45f, 0.0f, 0.5f);
    for (int32_t index = 0; index < 20; ++index) {
        const float x = static_cast<float>(index % 2) * 6.0f;
        world.setTransform(box, x, 0.45f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        world.step(1.0f / 60.0f, 10, 4);
    }
    const StepStatistics statistics = world.stepStatistics();
    CHECK(statistics.cacheLookups > 0);
    CHECK(hitRate(statistics) > 0.5);
    CHECK(pointIdentityRate(statistics) > 0.5);
}

}

int main() {
    settledPileReusesWarmStartEntries();
    teleportingBodiesBreakReuse();
    teleportingBodiesOnOneGroundKeepPointIdentity();
    printf("warmstart_test: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
