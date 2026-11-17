#include <stdint.h>
#include <stdio.h>

#include "core/constants.h"
#include "core/query.h"
#include "core/world.h"
#include "runtime/arena.h"

using namespace axrone::physics;

namespace {

alignas(64) unsigned char g_memory[64 * 1024 * 1024];

constexpr uint32_t sentinel = 1u << 20;

int g_checks = 0;
int g_failures = 0;

#define CHECK(condition)                                                          \
    do {                                                                          \
        ++g_checks;                                                               \
        if (!(condition)) {                                                       \
            printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition);            \
            ++g_failures;                                                         \
        }                                                                         \
    } while (0)

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

bool buildStack(World& world, Arena& arena, int32_t& ground, int32_t& lower, int32_t& upper) {
    if (!initWorld(world, arena, 64, 512)) {
        return false;
    }
    ground = makeBox(world, kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.5f);
    lower = makeBox(world, kBodyTypeDynamic, 0.0f, 0.45f, 0.0f, 0.5f);
    upper = makeBox(world, kBodyTypeDynamic, 0.0f, 1.45f, 0.0f, 0.5f);
    return ground >= 0 && lower >= 0 && upper >= 0;
}

void lookupsOutsideTheStepCannotMoveTheCounter() {
    Arena arena;
    World world = {};
    int32_t ground = -1;
    int32_t lower = -1;
    int32_t upper = -1;
    CHECK(buildStack(world, arena, ground, lower, upper));
    for (int32_t index = 0; index < 8; ++index) {
        CHECK(world.step(1.0f / 60.0f, 10, 4) >= 0);
    }

    const StepStatistics stepped = world.stepStatistics();
    CHECK_LABEL(stepped.cacheLookups > 0, "a stepped world records cache lookups inside the step");
    CHECK_LABEL(stepped.cacheHits > 0, "a warm stepped world records warm-start hits inside the step");

    int32_t found = 0;
    for (int32_t probe = 0; probe < 128; ++probe) {
        found += world.cacheLookup(ground, lower, probe) >= 0 ? 1 : 0;
        found += world.cacheLookup(lower, upper, probe) >= 0 ? 1 : 0;
    }
    CHECK_LABEL(found > 0, "the warm stack really does answer out-of-step lookups, so the two checks below have a hit to corrupt");
    CHECK_LABEL(world.stepStatistics().cacheLookups == stepped.cacheLookups,
                "reading the warm-start cache outside step() must not move the counter");
    CHECK_LABEL(world.stepStatistics().cacheHits == stepped.cacheHits,
                "reading the warm-start cache outside step() must not move the hit counter");

    CHECK(world.step(1.0f / 60.0f, 10, 4) >= 0);
    const StepStatistics nextStep = world.stepStatistics();
    CHECK_LABEL(nextStep.cacheLookups > 0, "the next step re-arms the lookup counter from the step path");
    CHECK_LABEL(nextStep.cacheLookups >= nextStep.cacheHits,
                "hits stay inside the lookups of the same step");
}

void cacheLookupWritesNothing() {
    Arena arena;
    World world = {};
    int32_t ground = -1;
    int32_t lower = -1;
    int32_t upper = -1;
    CHECK(buildStack(world, arena, ground, lower, upper));
    for (int32_t index = 0; index < 8; ++index) {
        CHECK(world.step(1.0f / 60.0f, 10, 4) >= 0);
    }

    StepStatistics& seeded = world.mutableStepStatistics();
    seeded.cacheLookups = sentinel;
    seeded.cacheHits = sentinel;
    seeded.cacheStores = sentinel;

    int32_t found = 0;
    for (int32_t probe = 0; probe < 128; ++probe) {
        found += world.cacheLookup(ground, lower, probe) >= 0 ? 1 : 0;
        found += world.cacheLookup(lower, upper, probe) >= 0 ? 1 : 0;
    }
    CHECK_LABEL(found > 0, "the seeded stack answers warm-start lookups");
    CHECK_LABEL(world.stepStatistics().cacheLookups == sentinel,
                "cacheLookup must not write the lookup counter on any path");
    CHECK_LABEL(world.stepStatistics().cacheHits == sentinel,
                "cacheLookup must not write the hit counter even when it hits");
}

void stepOwnsEveryPerStepCounter() {
    Arena arena;
    World world = {};
    int32_t ground = -1;
    int32_t lower = -1;
    int32_t upper = -1;
    CHECK(buildStack(world, arena, ground, lower, upper));
    CHECK(world.step(1.0f / 60.0f, 10, 4) >= 0);

    StepStatistics& seeded = world.mutableStepStatistics();
    const uint32_t stepsBefore = seeded.stepsRecorded;
    seeded.boxFacePairs = sentinel;
    seeded.boxEdgePairs = sentinel;
    seeded.boxPairsTotal = sentinel;
    seeded.cacheLookups = sentinel;
    seeded.cacheHits = sentinel;
    seeded.cacheStores = sentinel;
    seeded.pointIdentitiesPrevStep = sentinel;
    seeded.pointIdentitiesRepeatingPrevStep = sentinel;
    seeded.boxClipCandidateTotal = sentinel;
    for (uint32_t& bucket : seeded.boxPointBuckets) {
        bucket = sentinel;
    }

    CHECK(world.step(1.0f / 60.0f, 10, 4) >= 0);
    const StepStatistics after = world.stepStatistics();
    CHECK_LABEL(after.stepsRecorded == stepsBefore + 1, "stepsRecorded is the cumulative field and grows once per step");

    bool everyCounterRearmed = true;
    everyCounterRearmed = everyCounterRearmed && after.boxFacePairs < sentinel;
    everyCounterRearmed = everyCounterRearmed && after.boxEdgePairs < sentinel;
    everyCounterRearmed = everyCounterRearmed && after.boxPairsTotal < sentinel;
    everyCounterRearmed = everyCounterRearmed && after.cacheLookups < sentinel;
    everyCounterRearmed = everyCounterRearmed && after.cacheHits < sentinel;
    everyCounterRearmed = everyCounterRearmed && after.cacheStores < sentinel;
    everyCounterRearmed = everyCounterRearmed && after.pointIdentitiesPrevStep < sentinel;
    everyCounterRearmed = everyCounterRearmed && after.pointIdentitiesRepeatingPrevStep < sentinel;
    everyCounterRearmed = everyCounterRearmed && after.boxClipCandidateTotal < sentinel;
    for (const uint32_t bucket : after.boxPointBuckets) {
        everyCounterRearmed = everyCounterRearmed && bucket < sentinel;
    }
    CHECK_LABEL(everyCounterRearmed, "step starts every per-step counter from zero, so a stray write outside the step cannot survive into a step");

    uint32_t bucketTotal = 0;
    for (const uint32_t bucket : after.boxPointBuckets) {
        bucketTotal += bucket;
    }
    const bool histogramPairedWithResetPopulation = bucketTotal == after.boxPairsTotal;
    CHECK_LABEL(histogramPairedWithResetPopulation, "the step re-armed the point histogram and the pair population together, so a one-sided reset breaks this pairing");
}

}

int main() {
    lookupsOutsideTheStepCannotMoveTheCounter();
    cacheLookupWritesNothing();
    stepOwnsEveryPerStepCounter();
    printf("counters_test: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
