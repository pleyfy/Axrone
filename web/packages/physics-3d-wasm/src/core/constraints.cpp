#include "core/constraints.h"

#include "core/world.h"

namespace axrone::physics {

namespace {

constexpr float kUnboundedImpulse = kBig;

float atanTaylor(float value) {
    const float square = value * value;
    return value * (1.0f + square * (-0.33333333f + square * (0.2f + square *
        (-0.14285714f + square * (0.11111111f + square * (-0.09090909f + square * 0.07692308f))))));
}

float atanApprox(float value) {
    const float reduced = value / (1.0f + sqrtf(1.0f + value * value));
    return 2.0f * atanTaylor(reduced);
}

float atan2Approx(float y, float x) {
    if (x == 0.0f && y == 0.0f) {
        return 0.0f;
    }
    const float absoluteX = fabsf(x);
    const float absoluteY = fabsf(y);
    if (absoluteX >= absoluteY) {
        return atanApprox(y / x);
    }
    const float halfPi = 0.5f * kPi;
    return (y > 0.0f ? halfPi : -halfPi) - atanApprox(x / y);
}

void relativeQuaternion(const Transform& a, const Transform& b, Vec3& vector, float& scalar) {
    vector.x = a.qw * b.qx - a.qx * b.qw + a.qy * b.qz - a.qz * b.qy;
    vector.y = a.qw * b.qy - a.qy * b.qw + a.qz * b.qx - a.qx * b.qz;
    vector.z = a.qw * b.qz - a.qz * b.qw + a.qx * b.qy - a.qy * b.qx;
    scalar = a.qw * b.qw + a.qx * b.qx + a.qy * b.qy + a.qz * b.qz;
}

void buildPerpendicular(const Vec3& axis, Vec3& first, Vec3& second) {
    Vec3 perpendicular;
    if (fabsf(axis.x) < 0.9f) {
        perpendicular = Vec3(0.0f, -axis.z, axis.y);
    } else {
        perpendicular = Vec3(axis.z, 0.0f, -axis.x);
    }
    first = normalize(perpendicular);
    second = cross(axis, first);
}

float angularAxisTerm(const World& world, int32_t id, const Vec3& axis) {
    const Body& body = world.bodies[id];
    const Vec3 local = body.rotation.transposeTransform(axis);
    const Vec3 inertia = body.invInertia;
    return local.x * local.x * inertia.x +
           local.y * local.y * inertia.y +
           local.z * local.z * inertia.z;
}

float rowMass(const World& world, int32_t a, int32_t b, const JointRow& row) {
    const float sum = world.bodies[a].invMass * lengthSq(row.j1Linear) +
                      world.bodies[b].invMass * lengthSq(row.j2Linear) +
                      angularAxisTerm(world, a, row.j1Angular) +
                      angularAxisTerm(world, b, row.j2Angular);
    return sum > kEps ? 1.0f / sum : 0.0f;
}

void applyAngularDelta(World& world, int32_t id, const Vec3& torque) {
    Body& body = world.bodies[id];
    const Vec3 inertia = body.invInertia;
    if (inertia.x == 0.0f && inertia.y == 0.0f && inertia.z == 0.0f) {
        return;
    }
    Vec3 local = body.rotation.transposeTransform(torque);
    local.x *= inertia.x;
    local.y *= inertia.y;
    local.z *= inertia.z;
    world.angularVelocities[id] += body.rotation.transform(local);
}

void applyRowVelocityDelta(World& world, const Constraint& constraint, const JointRow& row, float delta) {
    world.velocities[constraint.bodyA] += row.j1Linear * (delta * world.bodies[constraint.bodyA].invMass);
    applyAngularDelta(world, constraint.bodyA, row.j1Angular * delta);
    world.velocities[constraint.bodyB] += row.j2Linear * (delta * world.bodies[constraint.bodyB].invMass);
    applyAngularDelta(world, constraint.bodyB, row.j2Angular * delta);
}

void applyRowPositionDelta(World& world, int32_t id, const Vec3& linear, const Vec3& angular, float delta) {
    Body& body = world.bodies[id];
    const float invMass = body.invMass;
    const Vec3 inertia = body.invInertia;
    if (invMass == 0.0f && inertia.x == 0.0f && inertia.y == 0.0f && inertia.z == 0.0f) {
        return;
    }
    Transform& transform = world.transforms[id];
    transform.px += linear.x * (delta * invMass);
    transform.py += linear.y * (delta * invMass);
    transform.pz += linear.z * (delta * invMass);
    if (inertia.x == 0.0f && inertia.y == 0.0f && inertia.z == 0.0f) {
        return;
    }
    Vec3 local = body.rotation.transposeTransform(angular * delta);
    local.x *= inertia.x;
    local.y *= inertia.y;
    local.z *= inertia.z;
    const Vec3 rotational = body.rotation.transform(local);
    integrateRotation(transform, rotational, 1.0f);
    refreshBodyRotation(world, id);
}

void clearRowState(Constraint& constraint, int32_t index) {
    JointRow& row = constraint.rows[index];
    row.mass = 0.0f;
    row.bias = 0.0f;
    row.positionMode = kJointPositionNone;
    constraint.impulses[index] = 0.0f;
}

bool finiteVec3(const Vec3& value) {
    return isFinite(value.x) && isFinite(value.y) && isFinite(value.z);
}

bool finiteScalar(float value) {
    return isFinite(value);
}

bool booleanFlag(int32_t value) {
    return value == 0 || value == 1;
}

Vec3 worldAnchor(const World& world, int32_t bodyId, const Vec3& localAnchor) {
    return transformPosition(world.transforms[bodyId]) + world.bodies[bodyId].rotation.transform(localAnchor);
}

Vec3 worldAxis(const World& world, int32_t bodyId, const Vec3& localAxis) {
    return normalize(world.bodies[bodyId].rotation.transform(localAxis));
}

void preparePointRow(
    World& world,
    Constraint& constraint,
    int32_t index,
    const Vec3& direction,
    const Vec3& anchorA,
    const Vec3& anchorB,
    float inverseH
) {
    const Vec3 radiusA = anchorA - transformPosition(world.transforms[constraint.bodyA]);
    const Vec3 radiusB = anchorB - transformPosition(world.transforms[constraint.bodyB]);
    JointRow& row = constraint.rows[index];
    row.j1Linear = -direction;
    row.j1Angular = cross(direction, radiusA);
    row.j2Linear = direction;
    row.j2Angular = cross(radiusB, direction);
    row.lower = -kUnboundedImpulse;
    row.upper = kUnboundedImpulse;
    row.positionMode = kJointPositionPoint;
    row.mass = rowMass(world, constraint.bodyA, constraint.bodyB, row);
    if (row.mass == 0.0f) {
        constraint.impulses[index] = 0.0f;
        return;
    }
    const float error = dot(direction, anchorB - anchorA);
    row.bias = kJointBaumgarte * error * inverseH;
}

void prepareAngularMotorRow(
    World& world,
    Constraint& constraint,
    int32_t index,
    const Vec3& axis,
    float inverseH
) {
    JointRow& row = constraint.rows[index];
    row.j1Linear = Vec3();
    row.j1Angular = -axis;
    row.j2Linear = Vec3();
    row.j2Angular = axis;
    row.bias = -constraint.motorSpeed;
    const float maxImpulse = fabsf(constraint.maxMotorForceOrTorque) * (inverseH > 0.0f ? 1.0f / inverseH : 0.0f);
    row.lower = -maxImpulse;
    row.upper = maxImpulse;
    row.positionMode = kJointPositionNone;
    row.mass = rowMass(world, constraint.bodyA, constraint.bodyB, row);
    if (row.mass == 0.0f) {
        constraint.impulses[index] = 0.0f;
    }
}

void prepareLinearMotorRow(
    World& world,
    Constraint& constraint,
    int32_t index,
    const Vec3& axis,
    const Vec3& anchorA,
    const Vec3& anchorB,
    float inverseH
) {
    const Vec3 radiusA = anchorA - transformPosition(world.transforms[constraint.bodyA]);
    const Vec3 radiusB = anchorB - transformPosition(world.transforms[constraint.bodyB]);
    JointRow& row = constraint.rows[index];
    row.j1Linear = -axis;
    row.j1Angular = cross(axis, radiusA);
    row.j2Linear = axis;
    row.j2Angular = cross(radiusB, axis);
    row.bias = -constraint.motorSpeed;
    const float maxImpulse = fabsf(constraint.maxMotorForceOrTorque) * (inverseH > 0.0f ? 1.0f / inverseH : 0.0f);
    row.lower = -maxImpulse;
    row.upper = maxImpulse;
    row.positionMode = kJointPositionNone;
    row.mass = rowMass(world, constraint.bodyA, constraint.bodyB, row);
    if (row.mass == 0.0f) {
        constraint.impulses[index] = 0.0f;
    }
}

float hingeLimitError(const World& world, const Constraint& constraint, const Vec3& axis, const Vec3& anchorA, const Vec3& anchorB, float slop) {
    float error = 0.0f;
    if (constraint.enableLimit != 0) {
        float measured = 0.0f;
        if (constraint.kind == kConstraintHinge) {
            Vec3 relativeVector;
            float relativeScalar = 0.0f;
            relativeQuaternion(world.transforms[constraint.bodyA], world.transforms[constraint.bodyB], relativeVector, relativeScalar);
            const float sinHalf = clampf(dot(relativeVector, axis), -1.0f, 1.0f);
            const float cosHalf = clampf(relativeScalar, -1.0f, 1.0f);
            measured = 2.0f * atan2Approx(sinHalf, cosHalf);
        } else {
            measured = dot(anchorB - anchorA, axis);
        }
        if (measured > constraint.upper) {
            error = measured - constraint.upper;
        } else if (measured < constraint.lower) {
            error = measured - constraint.lower;
        }
        if (fabsf(error) <= slop) {
            error = 0.0f;
        }
    }
    return error;
}

void prepareLimitRow(
    World& world,
    Constraint& constraint,
    int32_t index,
    const Vec3& axis,
    const Vec3& anchorA,
    const Vec3& anchorB,
    float inverseH,
    float error
) {
    if (error == 0.0f) {
        clearRowState(constraint, index);
        return;
    }
    const bool upper = error > 0.0f;
    JointRow& row = constraint.rows[index];
    if (constraint.kind == kConstraintHinge) {
        row.j1Linear = Vec3();
        row.j1Angular = -axis;
        row.j2Linear = Vec3();
        row.j2Angular = axis;
        row.positionMode = kJointPositionNone;
    } else {
        const Vec3 radiusA = anchorA - transformPosition(world.transforms[constraint.bodyA]);
        const Vec3 radiusB = anchorB - transformPosition(world.transforms[constraint.bodyB]);
        row.j1Linear = -axis;
        row.j1Angular = cross(axis, radiusA);
        row.j2Linear = axis;
        row.j2Angular = cross(radiusB, axis);
        row.positionMode = kJointPositionAxialLimit;
    }
    row.bias = kJointBaumgarte * error * inverseH;
    row.lower = upper ? -kUnboundedImpulse : 0.0f;
    row.upper = upper ? 0.0f : kUnboundedImpulse;
    row.mass = rowMass(world, constraint.bodyA, constraint.bodyB, row);
    if (row.mass == 0.0f) {
        constraint.impulses[index] = 0.0f;
    }
}

void prepareConstraintRows(World& world, Constraint& constraint, float dt) {
    const float inverseH = 1.0f / (dt > kEps ? dt : kEps);
    const Vec3 anchorA = worldAnchor(world, constraint.bodyA, constraint.localAnchorA);
    const Vec3 anchorB = worldAnchor(world, constraint.bodyB, constraint.localAnchorB);

    if (constraint.kind == kConstraintFixed) {
        preparePointRow(world, constraint, 0, Vec3(1.0f, 0.0f, 0.0f), anchorA, anchorB, inverseH);
        preparePointRow(world, constraint, 1, Vec3(0.0f, 1.0f, 0.0f), anchorA, anchorB, inverseH);
        preparePointRow(world, constraint, 2, Vec3(0.0f, 0.0f, 1.0f), anchorA, anchorB, inverseH);
        clearRowState(constraint, 3);
        return;
    }

    if (constraint.kind == kConstraintHinge) {
        const Vec3 axisA = worldAxis(world, constraint.bodyA, constraint.localAxisA);
        const Vec3 axisB = worldAxis(world, constraint.bodyB, constraint.localAxisB);
        Vec3 summed = axisA + axisB;
        const Vec3 axis = lengthSq(summed) > kEps ? normalize(summed) : axisA;
        Vec3 perpendicularOne;
        Vec3 perpendicularTwo;
        buildPerpendicular(axis, perpendicularOne, perpendicularTwo);
        preparePointRow(world, constraint, 0, perpendicularOne, anchorA, anchorB, inverseH);
        preparePointRow(world, constraint, 1, perpendicularTwo, anchorA, anchorB, inverseH);
        if (constraint.enableMotor != 0 && fabsf(constraint.maxMotorForceOrTorque) > kEps) {
            prepareAngularMotorRow(world, constraint, 2, axis, inverseH);
        } else {
            clearRowState(constraint, 2);
        }
        const float error = hingeLimitError(world, constraint, axis, anchorA, anchorB, kJointAngularSlop);
        prepareLimitRow(world, constraint, 3, axis, anchorA, anchorB, inverseH, error);
        return;
    }

    const Vec3 axis = worldAxis(world, constraint.bodyA, constraint.localAxisA);
    Vec3 perpendicularOne;
    Vec3 perpendicularTwo;
    buildPerpendicular(axis, perpendicularOne, perpendicularTwo);
    preparePointRow(world, constraint, 0, perpendicularOne, anchorA, anchorB, inverseH);
    preparePointRow(world, constraint, 1, perpendicularTwo, anchorA, anchorB, inverseH);
    if (constraint.enableMotor != 0 && fabsf(constraint.maxMotorForceOrTorque) > kEps) {
        prepareLinearMotorRow(world, constraint, 2, axis, anchorA, anchorB, inverseH);
    } else {
        clearRowState(constraint, 2);
    }
    const float error = hingeLimitError(world, constraint, axis, anchorA, anchorB, kJointLinearSlop);
    prepareLimitRow(world, constraint, 3, axis, anchorA, anchorB, inverseH, error);
}

void solveSpringConstraint(World& world, Constraint& constraint, float dt) {
    const Vec3 anchorA = worldAnchor(world, constraint.bodyA, constraint.localAnchorA);
    const Vec3 anchorB = worldAnchor(world, constraint.bodyB, constraint.localAnchorB);
    const Vec3 delta = anchorB - anchorA;
    const float distance = length(delta);
    const float error = distance - constraint.restLength;
    if (!isFinite(error) || fabsf(error) <= kEps) {
        constraint.impulses[0] = 0.0f;
        return;
    }
    const Vec3 direction = distance > kEps ? delta * (1.0f / distance) : Vec3(0.0f, 1.0f, 0.0f);
    const float inverseMassSum = world.bodies[constraint.bodyA].invMass + world.bodies[constraint.bodyB].invMass;
    if (inverseMassSum <= kEps) {
        constraint.impulses[0] = 0.0f;
        return;
    }

    Body& bodyA = world.bodies[constraint.bodyA];
    Body& bodyB = world.bodies[constraint.bodyB];
    const Vec3 relative = world.velocities[constraint.bodyB] - world.velocities[constraint.bodyA];
    const float velocityAlong = dot(relative, direction);
    const float force = -constraint.stiffness * error - constraint.damping * velocityAlong;
    const float impulse = force * dt;
    constraint.impulses[0] = impulse;
    if (impulse == 0.0f || !isFinite(impulse)) {
        return;
    }
    world.velocities[constraint.bodyA] += direction * (-impulse * bodyA.invMass);
    world.velocities[constraint.bodyB] += direction * (impulse * bodyB.invMass);
}

bool constraintUsable(const World& world, const Constraint& constraint) {
    if (constraint.kind == kConstraintFree || constraint.enabled == 0) {
        return false;
    }
    if (constraint.bodyA < 0 || constraint.bodyA >= world.highWater ||
        constraint.bodyB < 0 || constraint.bodyB >= world.highWater) {
        return false;
    }
    return world.bodies[constraint.bodyA].state != kBodyFree && world.bodies[constraint.bodyB].state != kBodyFree;
}

uint32_t pairKeyHash(int32_t a, int32_t b) {
    const uint32_t lo = static_cast<uint32_t>(a < b ? a : b);
    const uint32_t hi = static_cast<uint32_t>(a < b ? b : a);
    uint32_t hash = lo * 0x9E3779B9u;
    hash ^= hi + 0x85EBCA6Bu + (hash << 6) + (hash >> 2);
    return hash;
}

}

bool referencePairSuppressed(const World& world, int32_t a, int32_t b) {
    for (int32_t slot = 0; slot < world.maxConstraints; ++slot) {
        const Constraint& constraint = world.constraints[slot];
        if (constraint.kind == kConstraintFree) {
            continue;
        }
        if (constraint.collideConnected != 0) {
            continue;
        }
        if ((constraint.bodyA == a && constraint.bodyB == b) ||
            (constraint.bodyA == b && constraint.bodyB == a)) {
            return true;
        }
    }
    return false;
}

void buildSuppressedPairTable(World& world) {
    if (world.suppressedKeys == nullptr || world.constraintCount == 0) {
        world.suppressedTableBuilt = false;
        return;
    }
    const uint32_t slotCount = world.suppressedMask + 1;
    if (static_cast<int64_t>(slotCount) < static_cast<int64_t>(world.maxConstraints) * 4) {
        world.suppressedTableBuilt = false;
        return;
    }
    for (uint32_t i = 0; i < slotCount; ++i) {
        world.suppressedKeys[i] = -1;
    }
    world.suppressedTableBuilt = true;
    for (int32_t slot = 0; slot < world.maxConstraints; ++slot) {
        const Constraint& constraint = world.constraints[slot];
        if (constraint.kind == kConstraintFree || constraint.collideConnected != 0) {
            continue;
        }
        uint32_t index = pairKeyHash(constraint.bodyA, constraint.bodyB) & world.suppressedMask;
        uint32_t probe = 0;
        while (probe < slotCount && world.suppressedKeys[index] != -1) {
            index = (index + 1) & world.suppressedMask;
            ++probe;
        }
        if (probe >= slotCount) {
            world.suppressedTableBuilt = false;
            return;
        }
        world.suppressedKeys[index] = slot;
    }
}

bool pairSuppressedByConstraints(const World& world, int32_t a, int32_t b) {
    if (world.constraintCount == 0) {
        return false;
    }
    if (!world.suppressedTableBuilt || world.suppressedKeys == nullptr) {
        return referencePairSuppressed(world, a, b);
    }
    const uint32_t slotCount = world.suppressedMask + 1;
    uint32_t index = pairKeyHash(a, b) & world.suppressedMask;
    for (uint32_t probe = 0; probe < slotCount; ++probe) {
        const int32_t key = world.suppressedKeys[index];
        if (key == -1) {
            return false;
        }
        if (key < 0 || key >= world.maxConstraints) {
            return referencePairSuppressed(world, a, b);
        }
        const Constraint& constraint = world.constraints[key];
        if (constraint.kind != kConstraintFree && constraint.collideConnected == 0 &&
            ((constraint.bodyA == a && constraint.bodyB == b) ||
             (constraint.bodyA == b && constraint.bodyB == a))) {
            return true;
        }
        index = (index + 1) & world.suppressedMask;
    }
    return referencePairSuppressed(world, a, b);
}

void prepareConstraints(World& world, float dt) {
    if (world.constraintCount == 0) {
        return;
    }
    for (int32_t slot = 0; slot < world.maxConstraints; ++slot) {
        Constraint& constraint = world.constraints[slot];
        if (!constraintUsable(world, constraint)) {
            continue;
        }
        if (constraint.kind == kConstraintSpring) {
            solveSpringConstraint(world, constraint, dt);
            continue;
        }
        prepareConstraintRows(world, constraint, dt);
        for (int32_t row = 0; row < kMaxJointRows; ++row) {
            const JointRow& jointRow = constraint.rows[row];
            if (jointRow.mass == 0.0f) {
                continue;
            }
            applyRowVelocityDelta(world, constraint, jointRow, constraint.impulses[row]);
        }
    }
}

void solveConstraintVelocityPass(World& world) {
    if (world.constraintCount == 0) {
        return;
    }
    for (int32_t slot = 0; slot < world.maxConstraints; ++slot) {
        Constraint& constraint = world.constraints[slot];
        if (!constraintUsable(world, constraint) || constraint.kind == kConstraintSpring) {
            continue;
        }
        for (int32_t row = 0; row < kMaxJointRows; ++row) {
            const JointRow& jointRow = constraint.rows[row];
            if (jointRow.mass == 0.0f) {
                continue;
            }
            const Vec3 velocityA = world.velocities[constraint.bodyA];
            const Vec3 angularA = world.angularVelocities[constraint.bodyA];
            const Vec3 velocityB = world.velocities[constraint.bodyB];
            const Vec3 angularB = world.angularVelocities[constraint.bodyB];
            const float jacobianVelocity = dot(jointRow.j1Linear, velocityA) +
                dot(jointRow.j1Angular, angularA) +
                dot(jointRow.j2Linear, velocityB) +
                dot(jointRow.j2Angular, angularB);
            float lambda = -jointRow.mass * (jacobianVelocity + jointRow.bias);
            const float previous = constraint.impulses[row];
            float total = previous + lambda;
            if (total < jointRow.lower) {
                total = jointRow.lower;
            }
            if (total > jointRow.upper) {
                total = jointRow.upper;
            }
            lambda = total - previous;
            if (lambda == 0.0f) {
                constraint.impulses[row] = total;
                continue;
            }
            constraint.impulses[row] = total;
            applyRowVelocityDelta(world, constraint, jointRow, lambda);
        }
    }
}

void solveConstraintPositionPass(World& world) {
    if (world.constraintCount == 0) {
        return;
    }
    for (int32_t slot = 0; slot < world.maxConstraints; ++slot) {
        Constraint& constraint = world.constraints[slot];
        if (!constraintUsable(world, constraint) || constraint.kind == kConstraintSpring) {
            continue;
        }
        const Vec3 anchorA = worldAnchor(world, constraint.bodyA, constraint.localAnchorA);
        const Vec3 anchorB = worldAnchor(world, constraint.bodyB, constraint.localAnchorB);
        Vec3 axis = Vec3();
        if (constraint.kind == kConstraintHinge) {
            const Vec3 axisA = worldAxis(world, constraint.bodyA, constraint.localAxisA);
            const Vec3 axisB = worldAxis(world, constraint.bodyB, constraint.localAxisB);
            const Vec3 summed = axisA + axisB;
            axis = lengthSq(summed) > kEps ? normalize(summed) : axisA;
        } else if (constraint.kind == kConstraintSlider) {
            axis = worldAxis(world, constraint.bodyA, constraint.localAxisA);
        }

        for (int32_t row = 0; row < kMaxJointRows; ++row) {
            const JointRow& jointRow = constraint.rows[row];
            if (jointRow.mass == 0.0f || jointRow.positionMode == kJointPositionNone) {
                continue;
            }
            if (jointRow.positionMode == kJointPositionPoint) {
                const Vec3 direction = jointRow.j2Linear;
                const float error = dot(direction, anchorB - anchorA);
                if (fabsf(error) <= kEps) {
                    continue;
                }
                const float lambda = -kJointPositionFactor * error * jointRow.mass;
                applyRowPositionDelta(world, constraint.bodyA, jointRow.j1Linear, jointRow.j1Angular, lambda);
                applyRowPositionDelta(world, constraint.bodyB, jointRow.j2Linear, jointRow.j2Angular, lambda);
                continue;
            }
            const float translation = dot(anchorB - anchorA, axis);
            float error = 0.0f;
            if (translation > constraint.upper) {
                error = translation - constraint.upper;
            } else if (translation < constraint.lower) {
                error = translation - constraint.lower;
            }
            if (error == 0.0f) {
                continue;
            }
            const float lambda = -kJointPositionFactor * error * jointRow.mass;
            applyRowPositionDelta(world, constraint.bodyA, jointRow.j1Linear, jointRow.j1Angular, lambda);
            applyRowPositionDelta(world, constraint.bodyB, jointRow.j2Linear, jointRow.j2Angular, lambda);
        }
    }
}

void releaseConstraintsForBody(World& world, int32_t bodyId) {
    if (world.constraintCount == 0) {
        return;
    }
    for (int32_t slot = 0; slot < world.maxConstraints; ++slot) {
        Constraint& constraint = world.constraints[slot];
        if (constraint.kind == kConstraintFree) {
            continue;
        }
        if (constraint.bodyA != bodyId && constraint.bodyB != bodyId) {
            continue;
        }
        constraint.kind = kConstraintFree;
        constraint.enabled = 0;
        constraint.cacheSlotA = -1;
        constraint.cacheSlotB = -1;
        constraint.feature = (constraint.feature + 1) & kConstraintIdGenMask;
        for (int32_t row = 0; row < kMaxJointRows; ++row) {
            constraint.impulses[row] = 0.0f;
        }
        world.constraintFreeIds[world.constraintFreeCount++] = slot;
        --world.constraintCount;
    }
}

bool World::constraintResolve(int32_t id, Constraint*& out) const {
    out = nullptr;
    if (!initialized || constraints == nullptr || constraintFreeIds == nullptr || id < 0) {
        return false;
    }
    const int32_t slot = constraintDecodeSlot(id);
    if (slot >= maxConstraints) {
        return false;
    }
    const Constraint& constraint = constraints[slot];
    if (constraint.kind == kConstraintFree) {
        return false;
    }
    if (constraintDecodeGeneration(id) != (constraint.feature & kConstraintIdGenMask)) {
        return false;
    }
    if (!isActive(constraint.bodyA) || !isActive(constraint.bodyB)) {
        return false;
    }
    out = const_cast<Constraint*>(&constraint);
    return true;
}

namespace {

int32_t allocateConstraintSlot(World& world) {
    if (world.constraintFreeCount <= 0) {
        return -1;
    }
    const int32_t slot = world.constraintFreeIds[--world.constraintFreeCount];
    Constraint& constraint = world.constraints[slot];
    constraint.enabled = 1;
    constraint.cacheSlotA = -1;
    constraint.cacheSlotB = -1;
    constraint.enableLimit = 0;
    constraint.lower = 0.0f;
    constraint.upper = 0.0f;
    constraint.enableMotor = 0;
    constraint.motorSpeed = 0.0f;
    constraint.maxMotorForceOrTorque = 0.0f;
    constraint.restLength = 0.0f;
    constraint.stiffness = 0.0f;
    constraint.damping = 0.0f;
    constraint.localAxisA = Vec3(1.0f, 0.0f, 0.0f);
    constraint.localAxisB = Vec3(1.0f, 0.0f, 0.0f);
    for (int32_t row = 0; row < kMaxJointRows; ++row) {
        constraint.impulses[row] = 0.0f;
        constraint.rows[row].mass = 0.0f;
        constraint.rows[row].bias = 0.0f;
        constraint.rows[row].positionMode = kJointPositionNone;
    }
    ++world.constraintCount;
    return slot;
}

}

int32_t World::createFixed(int32_t bodyA, int32_t bodyB, Vec3 anchorA, Vec3 anchorB, int32_t collideConnected) {
    if (!isActive(bodyA) || !isActive(bodyB) || bodyA == bodyB) {
        return -1;
    }
    if (!finiteVec3(anchorA) || !finiteVec3(anchorB) || !booleanFlag(collideConnected)) {
        return -1;
    }
    const int32_t slot = allocateConstraintSlot(*this);
    if (slot < 0) {
        return -1;
    }
    Constraint& constraint = constraints[slot];
    constraint.kind = kConstraintFixed;
    constraint.bodyA = bodyA;
    constraint.bodyB = bodyB;
    constraint.collideConnected = collideConnected;
    constraint.localAnchorA = anchorA;
    constraint.localAnchorB = anchorB;
    return constraintEncodeId(constraint.feature, slot);
}

int32_t World::createHinge(
    int32_t bodyA,
    int32_t bodyB,
    Vec3 anchorA,
    Vec3 anchorB,
    Vec3 axisA,
    Vec3 axisB,
    int32_t enableLimit,
    float lower,
    float upper,
    int32_t enableMotor,
    float motorSpeed,
    float maxMotorTorque,
    int32_t collideConnected
) {
    if (!isActive(bodyA) || !isActive(bodyB) || bodyA == bodyB) {
        return -1;
    }
    if (!finiteVec3(anchorA) || !finiteVec3(anchorB) || !finiteVec3(axisA) || !finiteVec3(axisB)) {
        return -1;
    }
    if (!booleanFlag(enableLimit) || !booleanFlag(enableMotor) || !booleanFlag(collideConnected)) {
        return -1;
    }
    if (!finiteScalar(lower) || !finiteScalar(upper) || !finiteScalar(motorSpeed) || !finiteScalar(maxMotorTorque)) {
        return -1;
    }
    if (maxMotorTorque < 0.0f || (enableLimit != 0 && lower > upper)) {
        return -1;
    }
    if (lengthSq(axisA) <= kEps || lengthSq(axisB) <= kEps) {
        return -1;
    }
    const int32_t slot = allocateConstraintSlot(*this);
    if (slot < 0) {
        return -1;
    }
    Constraint& constraint = constraints[slot];
    constraint.kind = kConstraintHinge;
    constraint.bodyA = bodyA;
    constraint.bodyB = bodyB;
    constraint.collideConnected = collideConnected;
    constraint.localAnchorA = anchorA;
    constraint.localAnchorB = anchorB;
    constraint.localAxisA = normalize(axisA);
    constraint.localAxisB = normalize(axisB);
    constraint.enableLimit = enableLimit;
    constraint.lower = lower;
    constraint.upper = upper;
    constraint.enableMotor = enableMotor;
    constraint.motorSpeed = motorSpeed;
    constraint.maxMotorForceOrTorque = maxMotorTorque;
    return constraintEncodeId(constraint.feature, slot);
}

int32_t World::createSlider(
    int32_t bodyA,
    int32_t bodyB,
    Vec3 anchorA,
    Vec3 anchorB,
    Vec3 axisA,
    int32_t enableLimit,
    float lower,
    float upper,
    int32_t enableMotor,
    float motorSpeed,
    float maxMotorForce,
    int32_t collideConnected
) {
    if (!isActive(bodyA) || !isActive(bodyB) || bodyA == bodyB) {
        return -1;
    }
    if (!finiteVec3(anchorA) || !finiteVec3(anchorB) || !finiteVec3(axisA)) {
        return -1;
    }
    if (!booleanFlag(enableLimit) || !booleanFlag(enableMotor) || !booleanFlag(collideConnected)) {
        return -1;
    }
    if (!finiteScalar(lower) || !finiteScalar(upper) || !finiteScalar(motorSpeed) || !finiteScalar(maxMotorForce)) {
        return -1;
    }
    if (maxMotorForce < 0.0f || (enableLimit != 0 && lower > upper)) {
        return -1;
    }
    if (lengthSq(axisA) <= kEps) {
        return -1;
    }
    const int32_t slot = allocateConstraintSlot(*this);
    if (slot < 0) {
        return -1;
    }
    Constraint& constraint = constraints[slot];
    constraint.kind = kConstraintSlider;
    constraint.bodyA = bodyA;
    constraint.bodyB = bodyB;
    constraint.collideConnected = collideConnected;
    constraint.localAnchorA = anchorA;
    constraint.localAnchorB = anchorB;
    constraint.localAxisA = normalize(axisA);
    constraint.enableLimit = enableLimit;
    constraint.lower = lower;
    constraint.upper = upper;
    constraint.enableMotor = enableMotor;
    constraint.motorSpeed = motorSpeed;
    constraint.maxMotorForceOrTorque = maxMotorForce;
    return constraintEncodeId(constraint.feature, slot);
}

int32_t World::createSpring(
    int32_t bodyA,
    int32_t bodyB,
    Vec3 anchorA,
    Vec3 anchorB,
    float restLength,
    float stiffness,
    float damping,
    int32_t collideConnected
) {
    if (!isActive(bodyA) || !isActive(bodyB) || bodyA == bodyB) {
        return -1;
    }
    if (!finiteVec3(anchorA) || !finiteVec3(anchorB) || !booleanFlag(collideConnected)) {
        return -1;
    }
    if (!finiteScalar(restLength) || !finiteScalar(stiffness) || !finiteScalar(damping)) {
        return -1;
    }
    if (restLength < 0.0f || stiffness < 0.0f || damping < 0.0f) {
        return -1;
    }
    const int32_t slot = allocateConstraintSlot(*this);
    if (slot < 0) {
        return -1;
    }
    Constraint& constraint = constraints[slot];
    constraint.kind = kConstraintSpring;
    constraint.bodyA = bodyA;
    constraint.bodyB = bodyB;
    constraint.collideConnected = collideConnected;
    constraint.localAnchorA = anchorA;
    constraint.localAnchorB = anchorB;
    constraint.restLength = restLength;
    constraint.stiffness = stiffness;
    constraint.damping = damping;
    return constraintEncodeId(constraint.feature, slot);
}

int32_t World::destroyConstraint(int32_t id) {
    Constraint* constraint = nullptr;
    if (!constraintResolve(id, constraint)) {
        return -1;
    }
    constraint->kind = kConstraintFree;
    constraint->enabled = 0;
    constraint->cacheSlotA = -1;
    constraint->cacheSlotB = -1;
    constraint->feature = (constraint->feature + 1) & kConstraintIdGenMask;
    for (int32_t row = 0; row < kMaxJointRows; ++row) {
        constraint->impulses[row] = 0.0f;
    }
    constraintFreeIds[constraintFreeCount++] = constraintDecodeSlot(id);
    --constraintCount;
    return 0;
}

int32_t World::setConstraintEnabled(int32_t id, int32_t enabled) {
    Constraint* constraint = nullptr;
    if (!constraintResolve(id, constraint) || !booleanFlag(enabled)) {
        return -1;
    }
    constraint->enabled = enabled;
    if (enabled == 0) {
        for (int32_t row = 0; row < kMaxJointRows; ++row) {
            constraint->impulses[row] = 0.0f;
        }
    }
    return 0;
}

int32_t World::setJointMotor(
    int32_t id,
    int32_t expectedKind,
    float speed,
    float maxForceOrTorque
) {
    Constraint* constraint = nullptr;
    if (!constraintResolve(id, constraint) || constraint->kind != expectedKind) {
        return -1;
    }
    if (!finiteScalar(speed) || !finiteScalar(maxForceOrTorque) || maxForceOrTorque < 0.0f) {
        return -1;
    }
    constraint->motorSpeed = speed;
    constraint->maxMotorForceOrTorque = maxForceOrTorque;
    constraint->enableMotor = maxForceOrTorque > kEps ? 1 : 0;
    constraint->impulses[2] = 0.0f;
    constraint->impulses[3] = 0.0f;
    return 0;
}

int32_t World::setJointLimit(
    int32_t id,
    int32_t expectedKind,
    int32_t enable,
    float lower,
    float upper
) {
    Constraint* constraint = nullptr;
    if (!constraintResolve(id, constraint) || constraint->kind != expectedKind) {
        return -1;
    }
    if (!booleanFlag(enable) || !finiteScalar(lower) || !finiteScalar(upper) ||
        (enable != 0 && lower > upper)) {
        return -1;
    }
    constraint->enableLimit = enable;
    constraint->lower = lower;
    constraint->upper = upper;
    constraint->impulses[2] = 0.0f;
    constraint->impulses[3] = 0.0f;
    return 0;
}

int32_t World::setHingeMotor(int32_t id, float speed, float maxTorque) {
    return setJointMotor(id, kConstraintHinge, speed, maxTorque);
}

int32_t World::setHingeLimit(int32_t id, int32_t enable, float lower, float upper) {
    return setJointLimit(id, kConstraintHinge, enable, lower, upper);
}

int32_t World::setSliderMotor(int32_t id, float speed, float maxForce) {
    return setJointMotor(id, kConstraintSlider, speed, maxForce);
}

int32_t World::setSliderLimit(int32_t id, int32_t enable, float lower, float upper) {
    return setJointLimit(id, kConstraintSlider, enable, lower, upper);
}

}
