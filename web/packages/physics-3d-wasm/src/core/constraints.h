#pragma once

#include <stdint.h>

#include "core/body.h"
#include "core/math.h"

namespace axrone::physics {

struct World;

enum ConstraintKind : int32_t {
    kConstraintFixed = 0,
    kConstraintHinge = 1,
    kConstraintSlider = 2,
    kConstraintSpring = 3,
    kConstraintFree = -1
};

enum JointPositionMode : int32_t {
    kJointPositionNone = 0,
    kJointPositionPoint = 1,
    kJointPositionAxialLimit = 2
};

struct alignas(16) JointRow {
    Vec3 j1Linear;
    Vec3 j1Angular;
    Vec3 j2Linear;
    Vec3 j2Angular;
    float mass;
    float bias;
    float lower;
    float upper;
    int32_t positionMode;
    int32_t pad;
};

struct alignas(16) Constraint {
    int32_t kind;
    int32_t bodyA;
    int32_t bodyB;
    int32_t enabled;
    int32_t collideConnected;
    int32_t cacheSlotA;
    int32_t cacheSlotB;
    int32_t feature;
    Vec3 localAnchorA;
    Vec3 localAnchorB;
    Vec3 localAxisA;
    Vec3 localAxisB;
    int32_t enableLimit;
    float lower;
    float upper;
    int32_t enableMotor;
    float motorSpeed;
    float maxMotorForceOrTorque;
    float restLength;
    float stiffness;
    float damping;
    float impulses[kMaxJointRows];
    JointRow rows[kMaxJointRows];
    int32_t nextFree;
    int32_t pad;
};

static_assert(sizeof(JointRow) == 96, "joint row record size must stay fixed");
static_assert(alignof(JointRow) == 16, "joint row record must stay vector aligned");
static_assert(sizeof(Constraint) == 560, "constraint record size must stay fixed for arena sizing");
static_assert(alignof(Constraint) == 16, "constraint record must stay vector aligned");

AXRONE_PHYSICS_INLINE int32_t constraintEncodeId(int32_t generation, int32_t slot) {
    return ((generation & kConstraintIdGenMask) << kConstraintIdGenShift) |
           (slot & kConstraintIdSlotMask);
}

AXRONE_PHYSICS_INLINE int32_t constraintDecodeSlot(int32_t id) {
    return id & kConstraintIdSlotMask;
}

AXRONE_PHYSICS_INLINE int32_t constraintDecodeGeneration(int32_t id) {
    return (id >> kConstraintIdGenShift) & kConstraintIdGenMask;
}

bool pairSuppressedByConstraints(const World& world, int32_t a, int32_t b);
bool referencePairSuppressed(const World& world, int32_t a, int32_t b);
void buildSuppressedPairTable(World& world);
void releaseConstraintsForBody(World& world, int32_t bodyId);

void prepareConstraints(World& world, float dt);
void solveConstraintVelocityPass(World& world);
void solveConstraintPositionPass(World& world);

}
