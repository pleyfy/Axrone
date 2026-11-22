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

StepStatistics readStatistics(const World& world) {
    StepStatistics statistics = world.stepStatistics();
    collectStepStatistics(world, 10, 4, statistics);
    return statistics;
}

uint32_t bucketPairs(const StepStatistics& statistics) {
    uint32_t pairs = 0;
    for (int32_t index = 0; index < 8; ++index) {
        pairs += statistics.boxPointBuckets[index];
    }
    return pairs;
}

uint32_t bucketPoints(const StepStatistics& statistics) {
    uint32_t points = 0;
    for (int32_t index = 0; index < 8; ++index) {
        points += statistics.boxPointBuckets[index] * static_cast<uint32_t>(index + 1);
    }
    return points;
}

int32_t makeGround(World& world) {
    const int32_t id = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    if (id >= 0) {
        world.setBox(id, 20.0f, 0.5f, 20.0f, 0.0f);
    }
    return id;
}

int32_t makeYawBox(World& world, float x, float y, float z, float half, float qy, float qw) {
    const int32_t id = world.createBody(kBodyTypeDynamic, x, y, z, 0.0f, qy, 0.0f, qw);
    if (id >= 0) {
        world.setBox(id, half, half, half, 1.0f);
    }
    return id;
}

uint32_t facePoints(const StepStatistics& statistics) {
    return bucketPoints(statistics) - statistics.boxEdgePairs;
}

void histogramSumsToContactsGenerated() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, 64, 512));
    makeBox(world, kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.5f);
    makeBox(world, kBodyTypeDynamic, 0.0f, 0.55f, 0.0f, 0.5f);
    makeBox(world, kBodyTypeDynamic, 0.9f, 0.55f, 0.0f, 0.5f);
    for (int32_t index = 0; index < 8; ++index) {
        world.step(1.0f / 60.0f, 10, 4);
    }
    const StepStatistics statistics = readStatistics(world);
    CHECK(statistics.boxPairsTotal > 0);
    CHECK(bucketPairs(statistics) == statistics.boxPairsTotal);
    CHECK(bucketPoints(statistics) == static_cast<uint32_t>(statistics.contactsGenerated));
    CHECK(statistics.boxFacePairs + statistics.boxEdgePairs == statistics.boxPairsTotal);
    CHECK(statistics.boxClipCandidateTotal > facePoints(statistics));
    CHECK(statistics.boxClipCandidateTotal <= 8u * statistics.boxFacePairs);
    world.reset();
    CHECK(bucketPairs(world.stepStatistics()) == 0u);
    CHECK(world.stepStatistics().boxPairsTotal == 0u);
    CHECK(world.stepStatistics().boxClipCandidateTotal == 0u);
}

void separatedPairsContributeNothing() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, 64, 512));
    makeBox(world, kBodyTypeDynamic, 0.0f, 0.0f, 0.0f, 0.5f);
    makeBox(world, kBodyTypeDynamic, 25.0f, 0.0f, 0.0f, 0.5f);
    world.step(1.0f / 60.0f, 10, 4);
    const StepStatistics statistics = readStatistics(world);
    CHECK(statistics.boxPairsTotal == 0);
    CHECK(statistics.contactsGenerated == 0.0f);
    CHECK(bucketPairs(statistics) == 0);
    CHECK(statistics.boxClipCandidateTotal == 0);
}

void alignedFacePairEmitsEveryClipCandidate() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, 16, 512));
    CHECK(makeGround(world) >= 0);
    CHECK(makeBox(world, kBodyTypeDynamic, 0.0f, 0.45f, 0.0f, 0.5f) >= 0);
    for (int32_t index = 0; index < 8; ++index) {
        world.step(1.0f / 60.0f, 10, 4);
    }
    const StepStatistics statistics = readStatistics(world);
    CHECK(statistics.boxPairsTotal == 1u);
    CHECK(statistics.boxEdgePairs == 0u);
    CHECK(bucketPoints(statistics) == static_cast<uint32_t>(statistics.contactsGenerated));
    CHECK(statistics.boxClipCandidateTotal == facePoints(statistics));
    CHECK(facePoints(statistics) == 4u);
}

void cappedFacePairEmitsItsWholeClipList() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, 16, 512));
    CHECK(makeGround(world) >= 0);
    CHECK(makeYawBox(world, 0.0f, 0.45f, 0.0f, 0.5f, 0.13052619f, 0.99144486f) >= 0);
    CHECK(makeYawBox(world, 0.0f, 1.45f, 0.0f, 0.5f, -0.25881905f, 0.96592583f) >= 0);
    for (int32_t index = 0; index < 12; ++index) {
        world.step(1.0f / 60.0f, 10, 4);
    }
    const StepStatistics statistics = readStatistics(world);
    CHECK(statistics.boxPairsTotal > 0);
    CHECK(statistics.boxPointBuckets[7] > 0u);
    CHECK(bucketPoints(statistics) == static_cast<uint32_t>(statistics.contactsGenerated));
    CHECK(statistics.boxClipCandidateTotal == facePoints(statistics));
    CHECK(statistics.boxClipCandidateTotal <= 8u * statistics.boxFacePairs);
}

void contactCapacitySaturationBreaksTheWeightedIdentity() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, 16, 4));
    CHECK(makeGround(world) >= 0);
    CHECK(makeBox(world, kBodyTypeDynamic, -1.1f, 0.45f, 0.0f, 0.5f) >= 0);
    CHECK(makeBox(world, kBodyTypeDynamic, 0.0f, 0.45f, 0.0f, 0.5f) >= 0);
    CHECK(makeBox(world, kBodyTypeDynamic, 1.1f, 0.45f, 0.0f, 0.5f) >= 0);
    for (int32_t index = 0; index < 8; ++index) {
        world.step(1.0f / 60.0f, 10, 4);
    }
    const StepStatistics statistics = readStatistics(world);
    CHECK(static_cast<uint32_t>(statistics.contactsGenerated) == 4u);
    CHECK(statistics.boxPairsTotal > 1u);
    CHECK(bucketPoints(statistics) > static_cast<uint32_t>(statistics.contactsGenerated));
    CHECK(facePoints(statistics) > static_cast<uint32_t>(statistics.contactsGenerated));
    CHECK(statistics.boxClipCandidateTotal >= facePoints(statistics));
}

}

int main() {
    histogramSumsToContactsGenerated();
    separatedPairsContributeNothing();
    alignedFacePairEmitsEveryClipCandidate();
    cappedFacePairEmitsItsWholeClipList();
    contactCapacitySaturationBreaksTheWeightedIdentity();
    printf("contacts_test: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
