#include "core/solver.h"

#include "core/constraints.h"
#include "platform/math.h"

namespace axrone::physics {

namespace {

float angularTerm(const World& world, int32_t id, const Vec3& r, const Vec3& normal) {
    const Vec3 torque = cross(r, normal);
    const Vec3 local = world.bodies[id].rotation.transposeTransform(torque);
    const Vec3 inertia = world.bodies[id].invInertia;
    return local.x * local.x * inertia.x +
           local.y * local.y * inertia.y +
           local.z * local.z * inertia.z;
}

void applyImpulse(World& world, int32_t id, const Vec3& impulse, const Vec3& r) {
    Body& body = world.bodies[id];
    world.velocities[id] += impulse * body.invMass;

    const Vec3 inertia = body.invInertia;
    if (inertia.x == 0.0f && inertia.y == 0.0f && inertia.z == 0.0f) {
        return;
    }

    const Vec3 torque = cross(r, impulse);
    Vec3 local = body.rotation.transposeTransform(torque);
    local.x *= inertia.x;
    local.y *= inertia.y;
    local.z *= inertia.z;
    world.angularVelocities[id] += body.rotation.transform(local);
}

void applyPositionImpulse(World& world, int32_t id, const Vec3& impulse, const Vec3& r) {
    Body& body = world.bodies[id];
    const float invMass = body.invMass;
    const Vec3 inertia = body.invInertia;
    if (invMass == 0.0f && inertia.x == 0.0f && inertia.y == 0.0f && inertia.z == 0.0f) {
        return;
    }

    Transform& transform = world.transforms[id];
    transform.px += impulse.x * invMass;
    transform.py += impulse.y * invMass;
    transform.pz += impulse.z * invMass;

    if (inertia.x == 0.0f && inertia.y == 0.0f && inertia.z == 0.0f) {
        return;
    }

    const Vec3 torque = cross(r, impulse);
    Vec3 local = body.rotation.transposeTransform(torque);
    local.x *= inertia.x;
    local.y *= inertia.y;
    local.z *= inertia.z;
    const Vec3 rotationalImpulse = body.rotation.transform(local);

    integrateRotation(transform, rotationalImpulse, 1.0f);
    refreshBodyRotation(world, id);
}

Vec3 relativeVelocity(const World& world, const Contact& contact) {
    return (world.velocities[contact.b] + cross(world.angularVelocities[contact.b], contact.rb)) -
           (world.velocities[contact.a] + cross(world.angularVelocities[contact.a], contact.ra));
}

}

void prepareContacts(World& world) {
    for (int32_t k = 0; k < world.contactCount; ++k) {
        Contact& contact = world.contacts[k];
        const int32_t a = contact.a;
        const int32_t b = contact.b;

        const float inverseMassSum = world.bodies[a].invMass + world.bodies[b].invMass;
        const float normalMass = inverseMassSum +
            angularTerm(world, a, contact.ra, contact.normal) +
            angularTerm(world, b, contact.rb, contact.normal);
        contact.massN = normalMass > kEps ? 1.0f / normalMass : 0.0f;

        Vec3 tangent1;
        if (fabsf(contact.normal.x) < kTangentThreshold) {
            tangent1 = Vec3(0.0f, contact.normal.z, -contact.normal.y);
        } else {
            tangent1 = Vec3(-contact.normal.z, 0.0f, contact.normal.x);
        }
        contact.t1 = normalize(tangent1);
        contact.t2 = cross(contact.normal, contact.t1);

        const float tangent1Mass = inverseMassSum +
            angularTerm(world, a, contact.ra, contact.t1) +
            angularTerm(world, b, contact.rb, contact.t1);
        contact.massT1 = tangent1Mass > kEps ? 1.0f / tangent1Mass : 0.0f;

        const float tangent2Mass = inverseMassSum +
            angularTerm(world, a, contact.ra, contact.t2) +
            angularTerm(world, b, contact.rb, contact.t2);
        contact.massT2 = tangent2Mass > kEps ? 1.0f / tangent2Mass : 0.0f;

        const Vec3 relative = relativeVelocity(world, contact);
        const float normalVelocity = dot(relative, contact.normal);
        contact.velocityBias = (contact.restitution > 0.0f && normalVelocity < -kRestitutionThreshold)
            ? -contact.restitution * normalVelocity
            : 0.0f;

        const Vec3 impulse = contact.normal * contact.impN +
                             contact.t1 * contact.impT1 +
                             contact.t2 * contact.impT2;
        applyImpulse(world, a, -impulse, contact.ra);
        applyImpulse(world, b, impulse, contact.rb);
    }
}

void solveVelocities(World& world, int32_t iterations) {
    for (int32_t iteration = 0; iteration < iterations; ++iteration) {
        for (int32_t k = 0; k < world.contactCount; ++k) {
            Contact& contact = world.contacts[k];
            if (contact.sensor != 0) {
                continue;
            }
            const int32_t a = contact.a;
            const int32_t b = contact.b;

            Vec3 relative = relativeVelocity(world, contact);
            const float normalVelocity = dot(relative, contact.normal);
            const float previousNormal = contact.impN;
            float totalNormal = previousNormal + (contact.velocityBias - normalVelocity) * contact.massN;
            if (totalNormal < 0.0f) {
                totalNormal = 0.0f;
            }
            const float normalLambda = totalNormal - previousNormal;
            contact.impN = totalNormal;

            const Vec3 normalImpulse = contact.normal * normalLambda;
            applyImpulse(world, a, -normalImpulse, contact.ra);
            applyImpulse(world, b, normalImpulse, contact.rb);

            const float maxFriction = contact.friction * totalNormal;

            relative = relativeVelocity(world, contact);
            const float tangent1Velocity = dot(relative, contact.t1);
            const float previousTangent1 = contact.impT1;
            float totalTangent1 = previousTangent1 - tangent1Velocity * contact.massT1;
            totalTangent1 = clampf(totalTangent1, -maxFriction, maxFriction);
            const float tangent1Lambda = totalTangent1 - previousTangent1;
            contact.impT1 = totalTangent1;

            const Vec3 tangent1Impulse = contact.t1 * tangent1Lambda;
            applyImpulse(world, a, -tangent1Impulse, contact.ra);
            applyImpulse(world, b, tangent1Impulse, contact.rb);

            relative = relativeVelocity(world, contact);
            const float tangent2Velocity = dot(relative, contact.t2);
            const float previousTangent2 = contact.impT2;
            float totalTangent2 = previousTangent2 - tangent2Velocity * contact.massT2;
            totalTangent2 = clampf(totalTangent2, -maxFriction, maxFriction);
            const float tangent2Lambda = totalTangent2 - previousTangent2;
            contact.impT2 = totalTangent2;

            const Vec3 tangent2Impulse = contact.t2 * tangent2Lambda;
            applyImpulse(world, a, -tangent2Impulse, contact.ra);
            applyImpulse(world, b, tangent2Impulse, contact.rb);
        }
        solveConstraintVelocityPass(world);
    }
}

void solvePositions(World& world, int32_t iterations) {
    for (int32_t iteration = 0; iteration < iterations; ++iteration) {
        for (int32_t k = 0; k < world.contactCount; ++k) {
            const Contact& contact = world.contacts[k];
            if (contact.sensor != 0) {
                continue;
            }
            const int32_t a = contact.a;
            const int32_t b = contact.b;

            Vec3 normal = contact.normal;
            if (contact.normalMode == 1) {
                normal = world.bodies[a].rotation.transform(contact.localNormal);
            } else if (contact.normalMode == 2) {
                normal = -world.bodies[b].rotation.transform(contact.localNormal);
            }

            const Vec3 ra = world.bodies[a].rotation.transform(contact.localA);
            const Vec3 rb = world.bodies[b].rotation.transform(contact.localB);

            const Vec3 qa = transformPosition(world.transforms[a]) + ra;
            const Vec3 qb = transformPosition(world.transforms[b]) + rb;

            const float separation = dot(qb - qa, normal);
            float correction = -separation - kPositionSlop;
            if (correction <= 0.0f) {
                continue;
            }
            if (correction > kMaxPositionCorrection) {
                correction = kMaxPositionCorrection;
            }

            const float effectiveMass = world.bodies[a].invMass + world.bodies[b].invMass +
                angularTerm(world, a, ra, normal) +
                angularTerm(world, b, rb, normal);
            if (effectiveMass <= kEps) {
                continue;
            }

            const float lambda = kPositionPercent * correction / effectiveMass;
            const Vec3 impulse = normal * lambda;
            applyPositionImpulse(world, a, -impulse, ra);
            applyPositionImpulse(world, b, impulse, rb);
        }
        solveConstraintPositionPass(world);
    }
}

void writePackedContacts(World& world) {
    for (int32_t k = 0; k < world.contactCount; ++k) {
        const Contact& contact = world.contacts[k];
        PackedContact& packed = world.packedContacts[k];
        packed.a = contact.a;
        packed.b = contact.b;
        packed.nx = contact.normal.x;
        packed.ny = contact.normal.y;
        packed.nz = contact.normal.z;
        packed.pen = contact.pen;
    }
}

}
