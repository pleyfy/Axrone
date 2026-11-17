#include <stdint.h>
#include <stdio.h>

#include "core/constants.h"
#include "core/constraints.h"
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

bool oraclePairSuppressed(const World& world, int32_t a, int32_t b) {
    int32_t matches = 0;
    for (int32_t slot = world.maxConstraints - 1; slot >= 0; --slot) {
        const Constraint& constraint = world.constraints[slot];
        if (constraint.kind == kConstraintFree) {
            continue;
        }
        if (constraint.collideConnected != 0) {
            continue;
        }
        const bool forward = constraint.bodyA == a && constraint.bodyB == b;
        const bool reversed = constraint.bodyA == b && constraint.bodyB == a;
        if (forward) {
            ++matches;
        }
        if (reversed) {
            ++matches;
        }
    }
    return matches != 0;
}

int32_t makeHinge(World& world, int32_t a, int32_t b, int32_t collideConnected) {
    return world.createHinge(
        a, b,
        Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.5f, 0.0f),
        Vec3(0.0f, 0.0f, 1.0f), Vec3(0.0f, 0.0f, 1.0f),
        0, 0.0f, 0.0f,
        0, 0.0f, 0.0f,
        collideConnected);
}

int32_t gridMismatches(const World& world, int32_t range, bool againstShippedFallback) {
    int32_t mismatches = 0;
    for (int32_t a = 0; a < range; ++a) {
        for (int32_t b = 0; b < range; ++b) {
            const bool answered = againstShippedFallback
                ? referencePairSuppressed(world, a, b)
                : pairSuppressedByConstraints(world, a, b);
            if (answered != oraclePairSuppressed(world, a, b)) {
                ++mismatches;
            }
        }
    }
    return mismatches;
}

void bothAnswersMatchTheOracle(const World& world, int32_t range, const char* label) {
    CHECK_LABEL(gridMismatches(world, range, false) == 0, label);
    CHECK_LABEL(gridMismatches(world, range, true) == 0, "the scan kept as the fallback answers exactly what the independent oracle answers");
}

void tableAnswersExactlyWhatTheScanAnswers() {
    World world;
    Arena arena;
    arena.init(g_memory, sizeof(g_memory));
    CHECK_LABEL(world.init(arena, 256, 4096, Vec3(0.0f, -9.81f, 0.0f)), "the joint mask world initializes");

    for (int32_t i = 0; i < 40; ++i) {
        const int32_t id = world.createBody(kBodyTypeDynamic, static_cast<float>(i), 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        world.setBox(id, 0.5f, 0.5f, 0.5f, 1.0f);
    }

    for (int32_t i = 0; i + 1 < 40; i += 2) {
        CHECK_LABEL(makeHinge(world, i, i + 1, 0) >= 0, "a suppressing hinge is created");
    }
    CHECK_LABEL(makeHinge(world, 4, 6, 1) >= 0, "a collideConnected hinge is created");
    CHECK_LABEL(world.createSpring(8, 10, Vec3(), Vec3(), 1.0f, 10.0f, 0.5f, 0) >= 0, "a spring constraint is created");
    CHECK_LABEL(makeHinge(world, 30, 32, 0) >= 0, "a hinge that will be disabled is created");

    bothAnswersMatchTheOracle(world, 40, "an unbuilt world falls back to the scan and answers identically");

    buildSuppressedPairTable(world);
    bothAnswersMatchTheOracle(world, 40, "the table answers exactly what the linear scan answered, for every pair");
    CHECK_LABEL(pairSuppressedByConstraints(world, 4, 6) == false, "a collideConnected constraint does not suppress its pair");
    CHECK_LABEL(pairSuppressedByConstraints(world, 6, 4) == false, "a collideConnected constraint does not suppress its pair in either order");
    CHECK_LABEL(pairSuppressedByConstraints(world, 0, 1) == true, "a suppressing constraint does suppress its pair");
    CHECK_LABEL(pairSuppressedByConstraints(world, 1, 0) == true, "a suppressing constraint suppresses the reversed pair too");
    CHECK_LABEL(pairSuppressedByConstraints(world, 8, 10) == true, "a spring suppresses its pair exactly like a hinge does");
    CHECK_LABEL(pairSuppressedByConstraints(world, 0, 0) == false, "a body is never suppressed against itself");

    const int32_t disabled = makeHinge(world, 12, 14, 0);
    CHECK_LABEL(disabled >= 0, "a further hinge is created after the first build");
    CHECK_LABEL(world.setConstraintEnabled(disabled, 0) == 0, "that hinge is disabled");
    buildSuppressedPairTable(world);
    bothAnswersMatchTheOracle(world, 40, "a disabled constraint keeps answering what the scan answered");
    CHECK_LABEL(pairSuppressedByConstraints(world, 30, 32) == true, "disabling a constraint does not un-suppress its pair, as the scan never read enabled");
    CHECK_LABEL(pairSuppressedByConstraints(world, 12, 14) == true, "the disabled constraint added after the first build is visible after the rebuild");

    CHECK_LABEL(world.destroyConstraint(disabled) == 0, "the disabled hinge is destroyed");
    buildSuppressedPairTable(world);
    bothAnswersMatchTheOracle(world, 40, "a destroyed constraint stops answering for its pair after a rebuild");
    CHECK_LABEL(pairSuppressedByConstraints(world, 12, 14) == false, "the destroyed pair is no longer suppressed after the rebuild");

    CHECK_LABEL(makeHinge(world, 20, 22, 0) >= 0, "a hinge is added between builds");
    buildSuppressedPairTable(world);
    CHECK_LABEL(pairSuppressedByConstraints(world, 20, 22), "a constraint added between builds is visible after the rebuild");
    bothAnswersMatchTheOracle(world, 40, "the rebuilt table still answers exactly what the scan answers");
}

void aWorldWithoutConstraintsAnswersFalseEverywhere() {
    World world;
    Arena arena;
    arena.init(g_memory, sizeof(g_memory));
    CHECK_LABEL(world.init(arena, 64, 512, Vec3(0.0f, -9.81f, 0.0f)), "the constraint-free world initializes");
    for (int32_t i = 0; i < 12; ++i) {
        const int32_t id = world.createBody(kBodyTypeDynamic, static_cast<float>(i), 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        world.setBox(id, 0.5f, 0.5f, 0.5f, 1.0f);
    }
    buildSuppressedPairTable(world);
    bool everyPairFree = true;
    for (int32_t a = 0; a < 12; ++a) {
        for (int32_t b = 0; b < 12; ++b) {
            everyPairFree = everyPairFree && !pairSuppressedByConstraints(world, a, b);
        }
    }
    CHECK_LABEL(everyPairFree, "a scene without constraints suppresses nothing, so the box pile pays no new cost");

    const int32_t joint = makeHinge(world, 2, 4, 0);
    CHECK_LABEL(joint >= 0, "a constraint is created in the previously empty world");
    buildSuppressedPairTable(world);
    CHECK_LABEL(pairSuppressedByConstraints(world, 2, 4), "the table picks up the first constraint of a world that used to be empty");
    bothAnswersMatchTheOracle(world, 12, "the formerly empty world still answers exactly what the scan answers");
}

void resetClearsTheSuppressedAnswers() {
    World world;
    Arena arena;
    arena.init(g_memory, sizeof(g_memory));
    CHECK_LABEL(world.init(arena, 64, 512, Vec3(0.0f, -9.81f, 0.0f)), "the reset world initializes");
    for (int32_t i = 0; i < 8; ++i) {
        const int32_t id = world.createBody(kBodyTypeDynamic, static_cast<float>(i), 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        world.setBox(id, 0.5f, 0.5f, 0.5f, 1.0f);
    }
    CHECK_LABEL(makeHinge(world, 1, 3, 0) >= 0, "the reset world gets a suppressing hinge");
    buildSuppressedPairTable(world);
    CHECK_LABEL(pairSuppressedByConstraints(world, 1, 3), "the hinge suppresses its pair before the reset");
    world.reset();
    buildSuppressedPairTable(world);
    CHECK_LABEL(pairSuppressedByConstraints(world, 1, 3) == false, "the reset world suppresses nothing, table included");
    bothAnswersMatchTheOracle(world, 8, "the reset world answers exactly what the scan answers");
}

void theStepBuildsTheSuppressedTableBeforeAnythingProbesIt() {
    World world;
    Arena arena;
    arena.init(g_memory, sizeof(g_memory));
    CHECK_LABEL(world.init(arena, 64, 512, Vec3(0.0f, 0.0f, 0.0f)), "the step-order world initializes");

    const float positions[6] = {0.0f, 0.4f, 20.0f, 20.4f, 40.0f, 40.4f};
    for (int32_t i = 0; i < 6; ++i) {
        const int32_t id = world.createBody(kBodyTypeDynamic, positions[i], 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        world.setBox(id, 0.5f, 0.5f, 0.5f, 1.0f);
    }

    const int32_t jointA = makeHinge(world, 0, 1, 0);
    const int32_t jointB = makeHinge(world, 2, 3, 0);
    CHECK_LABEL(jointA >= 0 && jointB >= 0, "two joints exist on two distinct pairs and a third pair stays unjointed");
    CHECK_LABEL(oraclePairSuppressed(world, 4, 5) == false, "the third pair is genuinely unjointed before the first step");

    const int32_t contactsWhileThirdPairFree = world.step(1.0f / 60.0f, 10, 4);
    CHECK_LABEL(contactsWhileThirdPairFree > 0, "the production step still generates contacts for the unjointed pair");
    CHECK_LABEL(world.suppressedTableBuilt, "the step builds the suppressed-pair table");
    CHECK_LABEL(world.getContactCount() == contactsWhileThirdPairFree, "the step reports the contacts its collide phase generated");
    CHECK_LABEL(pairSuppressedByConstraints(world, 0, 1) && oraclePairSuppressed(world, 0, 1), "after the step the table suppresses the first jointed pair as the oracle does");
    CHECK_LABEL(pairSuppressedByConstraints(world, 2, 3) && oraclePairSuppressed(world, 2, 3), "after the step the table suppresses the second jointed pair as the oracle does");
    CHECK_LABEL(pairSuppressedByConstraints(world, 4, 5) == false && oraclePairSuppressed(world, 4, 5) == false, "after the step the table leaves the unjointed pair unsuppressed as the oracle does");

    const int32_t jointC = makeHinge(world, 4, 5, 0);
    CHECK_LABEL(jointC >= 0, "a third joint is created between two production steps");
    const int32_t contactsAfterThirdJoint = world.step(1.0f / 60.0f, 10, 4);
    CHECK_LABEL(contactsAfterThirdJoint == 0, "the step builds the table before the collide phase probes it, so a joint created since the last step suppresses its pair in this one");

    CHECK_LABEL(world.destroyConstraint(jointA) == 0, "the first joint is destroyed before the next production step");
    const int32_t contactsAfterDestroy = world.step(1.0f / 60.0f, 10, 4);
    CHECK_LABEL(contactsAfterDestroy > 0, "the step brings the pair of the destroyed joint back into the collide phase");
    CHECK_LABEL(pairSuppressedByConstraints(world, 0, 1) == oraclePairSuppressed(world, 0, 1) && !oraclePairSuppressed(world, 0, 1), "after the step the destroyed pair agrees with the oracle and is unsuppressed");
    CHECK_LABEL(pairSuppressedByConstraints(world, 2, 3) == oraclePairSuppressed(world, 2, 3) && oraclePairSuppressed(world, 2, 3), "after the step the surviving second jointed pair agrees with the oracle");
    CHECK_LABEL(pairSuppressedByConstraints(world, 4, 5) == oraclePairSuppressed(world, 4, 5) && oraclePairSuppressed(world, 4, 5), "after the step the third jointed pair agrees with the oracle");
}

}

void theSizingInvariantHoldsForEveryCapacity() {
    const int32_t bodyCapacities[4] = {1, 64, 256, 2048};
    for (int32_t i = 0; i < 4; ++i) {
        World world;
        Arena arena;
        arena.init(g_memory, sizeof(g_memory));
        const int32_t bodies = bodyCapacities[i];
        char label[96];
        snprintf(label, sizeof(label), "a world sized for %d bodies allocates the suppressed pair table", bodies);
        CHECK_LABEL(world.init(arena, bodies, 512, Vec3(0.0f, -9.81f, 0.0f)), label);
        const int64_t slotCount = static_cast<int64_t>(world.suppressedMask) + 1;
        snprintf(label, sizeof(label), "a world sized for %d bodies sizes the table at four slots per constraint slot", bodies);
        CHECK_LABEL(world.suppressedKeys != nullptr && slotCount >= static_cast<int64_t>(world.maxConstraints) * 4, label);
        snprintf(label, sizeof(label), "a world sized for %d bodies sizes the table on a power of two", bodies);
        CHECK_LABEL((slotCount & (slotCount - 1)) == 0, label);
    }
    CHECK_LABEL(kMaxConstraints * 4 > 0 && kMaxConstraints <= ((1 << 30) - 1) / 4,
        "the compile time constraint ceiling keeps the table target representable");
}

void aTableFilledToTheInvariantEdgeAnswersExactly() {
    World world;
    Arena arena;
    arena.init(g_memory, sizeof(g_memory));
    CHECK_LABEL(world.init(arena, 128, 512, Vec3(0.0f, -9.81f, 0.0f)), "the edge world initializes");
    CHECK_LABEL(world.maxConstraints == 256, "the edge world derives the constraint capacity the table is sized from");
    CHECK_LABEL(static_cast<int64_t>(world.suppressedMask) + 1 == static_cast<int64_t>(world.maxConstraints) * 4,
        "the edge world sits exactly on the sizing invariant rather than above it");

    for (int32_t i = 0; i < 128; ++i) {
        const int32_t id = world.createBody(kBodyTypeDynamic, static_cast<float>(i), 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        world.setBox(id, 0.5f, 0.5f, 0.5f, 1.0f);
    }

    int32_t created = 0;
    for (int32_t slot = 0; slot < world.maxConstraints; ++slot) {
        if (makeHinge(world, slot % 128, (slot + 1) % 128, 0) >= 0) {
            ++created;
        }
    }
    CHECK_LABEL(created == world.maxConstraints, "every constraint slot of the edge world holds a suppressing hinge");
    CHECK_LABEL(world.constraintCount == world.maxConstraints, "the edge world reports a fully occupied constraint table");

    buildSuppressedPairTable(world);
    CHECK_LABEL(world.suppressedTableBuilt, "a table filled to the invariant edge still builds instead of being refused");

    int32_t occupied = 0;
    for (int32_t i = 0; i <= static_cast<int32_t>(world.suppressedMask); ++i) {
        if (world.suppressedKeys[i] != -1) {
            ++occupied;
        }
    }
    CHECK_LABEL(occupied == world.maxConstraints, "one slot per suppressing hinge is occupied, so the load factor sits at the invariant edge");
    CHECK_LABEL(gridMismatches(world, 128, false) == 0, "the table at the invariant edge answers every one of the 16384 pairs exactly as the scan does");
    CHECK_LABEL(pairSuppressedByConstraints(world, 0, 1) == true, "a jointed pair is still suppressed at the invariant edge");
    CHECK_LABEL(pairSuppressedByConstraints(world, 3, 7) == false, "an unjointed pair is still released at the invariant edge");
    CHECK_LABEL(referencePairSuppressed(world, 3, 7) == false, "the scan agrees that the spot checked pair is unjointed");
}

void anUndersizedTableIsRefusedAndTheScanAnswers() {
    World world;
    Arena arena;
    arena.init(g_memory, sizeof(g_memory));
    CHECK_LABEL(world.init(arena, 64, 512, Vec3(0.0f, -9.81f, 0.0f)), "the undersizing world initializes");
    for (int32_t i = 0; i < 8; ++i) {
        const int32_t id = world.createBody(kBodyTypeDynamic, static_cast<float>(i), 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        world.setBox(id, 0.5f, 0.5f, 0.5f, 1.0f);
    }
    CHECK_LABEL(makeHinge(world, 0, 1, 0) >= 0, "the undersizing world gets a suppressing hinge");
    buildSuppressedPairTable(world);
    CHECK_LABEL(world.suppressedTableBuilt, "the undersizing world builds its table before the mask is narrowed");

    const uint32_t savedMask = world.suppressedMask;
    world.suppressedMask = 3;
    buildSuppressedPairTable(world);
    CHECK_LABEL(world.suppressedTableBuilt == false, "a table sized below four slots per constraint slot is refused instead of filled");
    CHECK_LABEL(pairSuppressedByConstraints(world, 0, 1) == oraclePairSuppressed(world, 0, 1),
        "a refused table answers from the scan and never from the undersized slots");
    CHECK_LABEL(gridMismatches(world, 8, false) == 0, "every pair of a refused table answers exactly what the scan answers");
    world.suppressedMask = savedMask;
    buildSuppressedPairTable(world);
    CHECK_LABEL(world.suppressedTableBuilt, "restoring the real mask rebuilds the table");
    CHECK_LABEL(gridMismatches(world, 8, false) == 0, "the rebuilt table answers every pair exactly as the scan does");
}

void aCorruptedTableTerminatesAndAnswersFromTheScan() {
    World world;
    Arena arena;
    arena.init(g_memory, sizeof(g_memory));
    CHECK_LABEL(world.init(arena, 64, 512, Vec3(0.0f, -9.81f, 0.0f)), "the corrupted world initializes");
    for (int32_t i = 0; i < 8; ++i) {
        const int32_t id = world.createBody(kBodyTypeDynamic, static_cast<float>(i), 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        world.setBox(id, 0.5f, 0.5f, 0.5f, 1.0f);
    }
    CHECK_LABEL(makeHinge(world, 0, 1, 0) >= 0, "the corrupted world gets a suppressing hinge");
    buildSuppressedPairTable(world);
    CHECK_LABEL(world.suppressedTableBuilt, "the corrupted world builds its table before the corruption");

    for (int32_t i = 0; i <= static_cast<int32_t>(world.suppressedMask); ++i) {
        world.suppressedKeys[i] = world.maxConstraints + 7;
    }
    CHECK_LABEL(pairSuppressedByConstraints(world, 0, 1) == oraclePairSuppressed(world, 0, 1),
        "a table of out of range keys terminates and answers from the scan instead of reading past the constraints");
    CHECK_LABEL(pairSuppressedByConstraints(world, 5, 6) == oraclePairSuppressed(world, 5, 6),
        "an out of range key table leaves an unjointed pair unjointed");

    for (int32_t i = 0; i <= static_cast<int32_t>(world.suppressedMask); ++i) {
        world.suppressedKeys[i] = 0;
    }
    CHECK_LABEL(pairSuppressedByConstraints(world, 5, 6) == oraclePairSuppressed(world, 5, 6),
        "a table with no free sentinel walks every slot once and answers from the scan instead of spinning");
    CHECK_LABEL(pairSuppressedByConstraints(world, 0, 1) == oraclePairSuppressed(world, 0, 1),
        "a table of every slot pointing at slot zero still suppresses the pair that slot holds");
}

int main() {
    tableAnswersExactlyWhatTheScanAnswers();
    aWorldWithoutConstraintsAnswersFalseEverywhere();
    resetClearsTheSuppressedAnswers();
    theStepBuildsTheSuppressedTableBeforeAnythingProbesIt();
    theSizingInvariantHoldsForEveryCapacity();
    aTableFilledToTheInvariantEdgeAnswersExactly();
    anUndersizedTableIsRefusedAndTheScanAnswers();
    aCorruptedTableTerminatesAndAnswersFromTheScan();
    printf("jointmask_test: %d checks, %d failures\n", g_checks, g_failures);
    return g_failures == 0 ? 0 : 1;
}
