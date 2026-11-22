#include <bit>
#include <stdint.h>
#include <stdio.h>

#include "core/query.h"

#include "core/polytope.h"
#include "core/world.h"

using axrone::physics::AABB;
using axrone::physics::applyFractionConvention;
using axrone::physics::Body;
using axrone::physics::buildConeHull;
using axrone::physics::collectStepStatistics;
using axrone::physics::Contact;
using axrone::physics::dot;
using axrone::physics::Hull;
using axrone::physics::kBodyDynamic;
using axrone::physics::kBodyFree;
using axrone::physics::kBodyKinematic;
using axrone::physics::kBodyStatic;
using axrone::physics::kMaxIterations;
using axrone::physics::kMaxShapesPerBody;
using axrone::physics::Mat3;
using axrone::physics::overlapBoxAll;
using axrone::physics::overlapSphere;
using axrone::physics::queryPointAll;
using axrone::physics::raycastAll;
using axrone::physics::raycastClosest;
using axrone::physics::RayHit;
using axrone::physics::Shape;
using axrone::physics::StepStatistics;
using axrone::physics::Transform;
using axrone::physics::Vec3;
using axrone::physics::World;

namespace {

int gChecks = 0;
int gFailures = 0;

#define CHECK(cond)                                                              \
    do {                                                                         \
        ++gChecks;                                                               \
        if (!(cond)) {                                                           \
            ++gFailures;                                                         \
            printf("FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);              \
        }                                                                        \
    } while (0)

bool near(float left, float right) {
    float delta = left - right;
    if (delta < 0.0f) {
        delta = -delta;
    }
    return delta < 1e-4f;
}

struct Fixture {
    World world;
    Body bodies[8];
    Transform transforms[8];
    uint16_t gens[8 * kMaxShapesPerBody];

    Fixture() : world(), bodies(), transforms(), gens() {
        world.initialized = true;
        world.bodies = bodies;
        world.transforms = transforms;
        world.slotGen = gens;
        world.highWater = 0;
    }

    int32_t reserve(Vec3 position, float qx, float qy, float qz, float qw, int32_t state) {
        const int32_t id = world.highWater++;
        Body& body = bodies[id];
        body.state = state;
        body.shapeCount = 0;
        body.invMass = 0.0f;
        body.invInertia = Vec3();
        body.friction = 0.6f;
        body.restitution = 0.0f;
        body.aabb = AABB{ 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f };
        body.rotation.setIdentity();
        Transform& transform = transforms[id];
        transform.px = position.x;
        transform.py = position.y;
        transform.pz = position.z;
        transform.qx = qx;
        transform.qy = qy;
        transform.qz = qz;
        transform.qw = qw;
        return id;
    }

    int32_t addSphereShape(int32_t id, float radius, Vec3 offset) {
        const int32_t slot = bodies[id].shapeCount;
        if (slot >= kMaxShapesPerBody) {
            return -1;
        }
        bodies[id].shapes[slot].setSphere(radius, 0.0f, offset);
        bodies[id].shapeCount = slot + 1;
        return slot;
    }

    int32_t addBoxShape(int32_t id, Vec3 half, Vec3 offset, float qx, float qy, float qz, float qw) {
        const int32_t slot = bodies[id].shapeCount;
        if (slot >= kMaxShapesPerBody) {
            return -1;
        }
        bodies[id].shapes[slot].setBox(half.x, half.y, half.z, 0.0f, offset, qx, qy, qz, qw);
        bodies[id].shapeCount = slot + 1;
        return slot;
    }

    int32_t addSphere(Vec3 position, float radius, int32_t state = kBodyStatic) {
        const int32_t id = reserve(position, 0.0f, 0.0f, 0.0f, 1.0f, state);
        addSphereShape(id, radius, Vec3());
        return id;
    }

    int32_t addBox(
        Vec3 position,
        Vec3 half,
        float qx = 0.0f,
        float qy = 0.0f,
        float qz = 0.0f,
        float qw = 1.0f,
        int32_t state = kBodyStatic) {
        const int32_t id = reserve(position, qx, qy, qz, qw, state);
        bodies[id].rotation.fromQuaternion(qx, qy, qz, qw);
        addBoxShape(id, half, Vec3(), 0.0f, 0.0f, 0.0f, 1.0f);
        return id;
    }

    int32_t addCompound(Vec3 position, float qx = 0.0f, float qy = 0.0f, float qz = 0.0f, float qw = 1.0f, int32_t state = kBodyStatic) {
        const int32_t id = reserve(position, qx, qy, qz, qw, state);
        bodies[id].rotation.fromQuaternion(qx, qy, qz, qw);
        return id;
    }

    int32_t addCapsuleShape(int32_t id, float radius, float halfSegment, Vec3 offset) {
        const int32_t slot = bodies[id].shapeCount;
        if (slot >= kMaxShapesPerBody) {
            return -1;
        }
        bodies[id].shapes[slot].setCapsule(radius, halfSegment, 0.0f, offset, 0.0f, 0.0f, 0.0f, 1.0f);
        bodies[id].shapeCount = slot + 1;
        return slot;
    }

    int32_t addCylinderShape(int32_t id, float radius, float halfHeight, Vec3 offset) {
        const int32_t slot = bodies[id].shapeCount;
        if (slot >= kMaxShapesPerBody) {
            return -1;
        }
        bodies[id].shapes[slot].setCylinder(radius, halfHeight, 0.0f, offset, 0.0f, 0.0f, 0.0f, 1.0f);
        bodies[id].shapeCount = slot + 1;
        return slot;
    }

    int32_t addConeShape(int32_t id, float radius, float halfHeight, Vec3 offset) {
        const int32_t slot = bodies[id].shapeCount;
        if (slot >= kMaxShapesPerBody) {
            return -1;
        }
        bodies[id].shapes[slot].setCone(radius, halfHeight, 0.0f, offset, 0.0f, 0.0f, 0.0f, 1.0f);
        bodies[id].shapeCount = slot + 1;
        return slot;
    }

    int32_t addCapsule(Vec3 position, float radius, float halfSegment, int32_t state = kBodyStatic) {
        const int32_t id = reserve(position, 0.0f, 0.0f, 0.0f, 1.0f, state);
        addCapsuleShape(id, radius, halfSegment, Vec3());
        return id;
    }

    int32_t addCylinder(Vec3 position, float radius, float halfHeight, int32_t state = kBodyStatic) {
        const int32_t id = reserve(position, 0.0f, 0.0f, 0.0f, 1.0f, state);
        addCylinderShape(id, radius, halfHeight, Vec3());
        return id;
    }

    int32_t addCone(Vec3 position, float radius, float halfHeight, int32_t state = kBodyStatic) {
        const int32_t id = reserve(position, 0.0f, 0.0f, 0.0f, 1.0f, state);
        addConeShape(id, radius, halfHeight, Vec3());
        return id;
    }

    void setAabb(int32_t id, Vec3 min, Vec3 max) {
        bodies[id].aabb = AABB{ min.x, min.y, min.z, max.x, max.y, max.z };
    }

    void setShapeFilter(int32_t id, int32_t slot, int32_t categoryBits, int32_t maskBits, int32_t groupIndex) {
        Shape& shape = bodies[id].shapes[slot];
        shape.categoryBits = categoryBits;
        shape.maskBits = maskBits;
        shape.groupIndex = groupIndex;
    }
};

uint32_t mix(uint32_t hash, uint32_t value) {
    hash ^= value;
    hash *= 16777619u;
    return hash;
}

uint32_t floatBits(float value) {
    return std::bit_cast<uint32_t>(value);
}

uint32_t checksum(const Fixture& fixture) {
    uint32_t hash = 2166136261u;
    hash = mix(hash, static_cast<uint32_t>(fixture.world.highWater));
    for (int32_t id = 0; id < fixture.world.highWater; ++id) {
        const Body& body = fixture.world.bodies[id];
        const Transform& transform = fixture.world.transforms[id];
        hash = mix(hash, static_cast<uint32_t>(body.state));
        hash = mix(hash, static_cast<uint32_t>(body.shapeCount));
        hash = mix(hash, floatBits(body.invMass));
        hash = mix(hash, floatBits(body.invInertia.x));
        hash = mix(hash, floatBits(body.invInertia.y));
        hash = mix(hash, floatBits(body.invInertia.z));
        hash = mix(hash, floatBits(body.friction));
        hash = mix(hash, floatBits(body.restitution));
        for (int32_t i = 0; i < 9; ++i) {
            hash = mix(hash, floatBits(body.rotation.m[i]));
        }
        for (int32_t slot = 0; slot < body.shapeCount; ++slot) {
            const Shape& shape = body.shapes[slot];
            hash = mix(hash, static_cast<uint32_t>(shape.kind));
            hash = mix(hash, floatBits(shape.density));
            hash = mix(hash, floatBits(shape.extents.x));
            hash = mix(hash, floatBits(shape.extents.y));
            hash = mix(hash, floatBits(shape.extents.z));
            hash = mix(hash, floatBits(shape.offset.x));
            hash = mix(hash, floatBits(shape.offset.y));
            hash = mix(hash, floatBits(shape.offset.z));
            for (int32_t i = 0; i < 9; ++i) {
                hash = mix(hash, floatBits(shape.rotation.m[i]));
            }
        }
        hash = mix(hash, floatBits(body.aabb.minX));
        hash = mix(hash, floatBits(body.aabb.minY));
        hash = mix(hash, floatBits(body.aabb.minZ));
        hash = mix(hash, floatBits(body.aabb.maxX));
        hash = mix(hash, floatBits(body.aabb.maxY));
        hash = mix(hash, floatBits(body.aabb.maxZ));
        hash = mix(hash, floatBits(transform.px));
        hash = mix(hash, floatBits(transform.py));
        hash = mix(hash, floatBits(transform.pz));
        hash = mix(hash, floatBits(transform.qx));
        hash = mix(hash, floatBits(transform.qy));
        hash = mix(hash, floatBits(transform.qz));
        hash = mix(hash, floatBits(transform.qw));
    }
    return hash;
}

void testRayHitsSphereFromOutside() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].body == 0);
        CHECK(hits[0].shape == 0);
        CHECK(hits[0].reserved == 0.0f);
        CHECK(near(hits[0].t, 4.0f));
        CHECK(near(hits[0].px, 0.0f));
        CHECK(near(hits[0].py, 0.0f));
        CHECK(near(hits[0].pz, -4.0f));
        CHECK(near(hits[0].nx, 0.0f));
        CHECK(near(hits[0].ny, 0.0f));
        CHECK(near(hits[0].nz, 1.0f));
    }
    RayHit closest;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, closest));
    CHECK(closest.body == 0);
    CHECK(closest.shape == 0);
    CHECK(near(closest.t, 4.0f));
}

void testRayMissesSphere() {
    Fixture fixture;
    fixture.addSphere(Vec3(4.0f, 0.0f, -5.0f), 1.0f);
    RayHit hits[4];
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4) == 0);
    RayHit closest;
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, closest));
}

void testRayBehindSphereMisses() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, 5.0f), 1.0f);
    RayHit hits[4];
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4) == 0);
}

void testRayInsideSphere() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 2.0f);
    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, -5.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].shape == 0);
        CHECK(near(hits[0].t, 0.0f));
        CHECK(near(hits[0].px, 0.0f));
        CHECK(near(hits[0].py, 0.0f));
        CHECK(near(hits[0].pz, -5.0f));
        CHECK(near(hits[0].nx, 0.0f));
        CHECK(near(hits[0].ny, 0.0f));
        CHECK(near(hits[0].nz, 1.0f));
    }
}

void testRayHitsAxisAlignedBox() {
    Fixture fixture;
    fixture.addBox(Vec3(0.0f, 0.0f, -5.0f), Vec3(1.0f, 1.0f, 1.0f));
    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].shape == 0);
        CHECK(near(hits[0].t, 4.0f));
        CHECK(near(hits[0].pz, -4.0f));
        CHECK(near(hits[0].nx, 0.0f));
        CHECK(near(hits[0].ny, 0.0f));
        CHECK(near(hits[0].nz, 1.0f));
    }
}

void testRayHitsRotatedBox() {
    Fixture fixture;
    const float yawHalf = 0.3826834323650898f;
    const float yawCos = 0.9238795325112867f;
    fixture.addBox(Vec3(0.0f, 0.0f, -5.0f), Vec3(1.0f, 1.0f, 0.5f), 0.0f, yawHalf, 0.0f, yawCos);
    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].shape == 0);
        CHECK(near(hits[0].t, 4.2928932f));
        CHECK(near(hits[0].px, 0.0f));
        CHECK(near(hits[0].pz, -4.2928932f));
        CHECK(near(hits[0].nx, 0.7071068f));
        CHECK(near(hits[0].ny, 0.0f));
        CHECK(near(hits[0].nz, 0.7071068f));
    }
}

void testRayInsideBox() {
    Fixture fixture;
    fixture.addBox(Vec3(0.0f, 0.0f, -5.0f), Vec3(1.0f, 1.0f, 1.0f));
    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, -5.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].shape == 0);
        CHECK(near(hits[0].t, 0.0f));
        CHECK(near(hits[0].pz, -5.0f));
        CHECK(near(hits[0].nx, 0.0f));
        CHECK(near(hits[0].ny, 0.0f));
        CHECK(near(hits[0].nz, 1.0f));
    }
}

void testRayMissesBox() {
    Fixture fixture;
    fixture.addBox(Vec3(3.0f, 0.0f, -5.0f), Vec3(1.0f, 1.0f, 1.0f));
    RayHit hits[4];
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4) == 0);
    RayHit closest;
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, closest));
}

void testMaxDistanceCutoff() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -10.0f), 1.0f);
    fixture.addBox(Vec3(0.0f, 0.0f, -10.0f), Vec3(1.0f, 1.0f, 1.0f));
    RayHit hits[4];
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 5.0f, hits, 4) == 0);
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 9.0f, hits, 4) == 2);
    RayHit closest;
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 5.0f, closest));
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 0.0f, closest));
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), -1.0f, hits, 4) == 0);
}

void testUnnormalizedDirection() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -200.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(near(hits[0].t, 4.0f));
        CHECK(near(hits[0].pz, -4.0f));
    }
    RayHit closest;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -0.5f), 100.0f, closest));
    CHECK(near(closest.t, 4.0f));
}

void testZeroDirection() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    RayHit hits[4];
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, 0.0f), 100.0f, hits, 4) == 0);
    RayHit closest;
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(1e-7f, 0.0f, 0.0f), 100.0f, closest));
}

void testCapacityTruncationKeepsClosest() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -3.0f), 1.0f);
    fixture.addSphere(Vec3(0.0f, 0.0f, -7.0f), 1.0f);
    fixture.addSphere(Vec3(0.0f, 0.0f, -11.0f), 1.0f);
    RayHit hits[2];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 2);
    CHECK(count == 2);
    if (count == 2) {
        CHECK(hits[0].body == 0);
        CHECK(hits[1].body == 1);
        CHECK(hits[0].shape == 0);
        CHECK(hits[1].shape == 8);
        CHECK(near(hits[0].t, 2.0f));
        CHECK(near(hits[1].t, 6.0f));
    }
    RayHit single[1];
    const int32_t one = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, single, 1);
    CHECK(one == 1);
    if (one == 1) {
        CHECK(single[0].body == 0);
        CHECK(single[0].shape == 0);
    }
}

void testHitOrderingByT() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -9.0f), 1.0f);
    fixture.addSphere(Vec3(0.0f, 0.0f, -3.0f), 1.0f);
    fixture.addSphere(Vec3(0.0f, 0.0f, -6.0f), 1.0f);
    RayHit hits[8];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 8);
    CHECK(count == 3);
    if (count == 3) {
        CHECK(hits[0].body == 1);
        CHECK(hits[1].body == 2);
        CHECK(hits[2].body == 0);
        CHECK(hits[0].shape == 8);
        CHECK(hits[1].shape == 16);
        CHECK(hits[2].shape == 0);
        CHECK(hits[0].t <= hits[1].t);
        CHECK(hits[1].t <= hits[2].t);
    }
}

void testTieBreakByBodyId() {
    Fixture fixture;
    fixture.addSphere(Vec3(2.0f, 0.0f, -5.0f), 3.0f);
    fixture.addSphere(Vec3(-2.0f, 0.0f, -5.0f), 3.0f);
    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 2);
    if (count == 2) {
        CHECK(hits[0].t == hits[1].t);
        CHECK(hits[0].body == 0);
        CHECK(hits[1].body == 1);
        CHECK(hits[0].shape == 0);
        CHECK(hits[1].shape == 8);
    }
}

void testRaycastClosestPicksMinimum() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -9.0f), 1.0f);
    fixture.addBox(Vec3(0.0f, 0.0f, -4.0f), Vec3(0.5f, 0.5f, 0.5f));
    fixture.addSphere(Vec3(0.0f, 0.0f, -7.0f), 1.0f);
    RayHit closest;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, closest));
    CHECK(closest.body == 1);
    CHECK(closest.shape == 8);
    CHECK(near(closest.t, 3.5f));
}

void testInvalidArguments() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    RayHit hits[4];
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, nullptr, 4) == 0);
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 0) == 0);
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, -3) == 0);
    int32_t bodies[4];
    CHECK(overlapSphere(fixture.world, Vec3(0.0f, 0.0f, -5.0f), 1.0f, nullptr, 4) == 0);
    CHECK(overlapSphere(fixture.world, Vec3(0.0f, 0.0f, -5.0f), 1.0f, bodies, 0) == 0);
    Fixture uninitialized;
    uninitialized.world.initialized = false;
    CHECK(raycastAll(
        uninitialized.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4) == 0);
    RayHit closest;
    CHECK(!raycastClosest(
        uninitialized.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, closest));
}

void testSkipsUnusableBodies() {
    Fixture fixture;
    const int32_t freeId = fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    fixture.bodies[freeId].state = kBodyFree;
    const int32_t noneId = fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    fixture.bodies[noneId].shapeCount = 0;
    const int32_t flatId = fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 0.0f);
    fixture.bodies[flatId].shapes[0].extents = Vec3(0.0f, 0.0f, 0.0f);
    const int32_t degenerateId = fixture.addBox(Vec3(0.0f, 0.0f, -5.0f), Vec3(1.0f, 0.0f, 1.0f));
    CHECK(flatId == 2);
    CHECK(degenerateId == 3);
    RayHit hits[4];
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4) == 0);
    int32_t bodies[4];
    CHECK(overlapSphere(fixture.world, Vec3(0.0f, 0.0f, -5.0f), 0.5f, bodies, 4) == 0);
    fixture.bodies[freeId].state = kBodyDynamic;
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4) == 1);
}

void testOverlapSphereWithSphere() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, 0.0f), 1.0f);
    fixture.addSphere(Vec3(5.0f, 0.0f, 0.0f), 1.0f);
    fixture.addSphere(Vec3(2.4f, 0.0f, 0.0f), 1.0f);
    int32_t bodies[4];
    const int32_t count = overlapSphere(fixture.world, Vec3(1.4f, 0.0f, 0.0f), 0.5f, bodies, 4);
    CHECK(count == 2);
    if (count == 2) {
        CHECK(bodies[0] == 0);
        CHECK(bodies[1] == 2);
    }
}

void testOverlapSphereWithBox() {
    Fixture fixture;
    fixture.addBox(Vec3(0.0f, 0.0f, 0.0f), Vec3(1.0f, 1.0f, 1.0f));
    int32_t bodies[4];
    CHECK(overlapSphere(fixture.world, Vec3(2.5f, 0.0f, 0.0f), 1.5f, bodies, 4) == 1);
    CHECK(overlapSphere(fixture.world, Vec3(2.5f, 0.0f, 0.0f), 1.4f, bodies, 4) == 0);
    CHECK(overlapSphere(fixture.world, Vec3(1.9f, 1.9f, 1.9f), 1.6f, bodies, 4) == 1);
    CHECK(overlapSphere(fixture.world, Vec3(0.0f, 0.0f, 0.0f), 0.1f, bodies, 4) == 1);
    const float yawHalf = 0.3826834323650898f;
    const float yawCos = 0.9238795325112867f;
    Fixture rotated;
    rotated.addBox(Vec3(0.0f, 0.0f, 0.0f), Vec3(1.0f, 1.0f, 1.0f), 0.0f, yawHalf, 0.0f, yawCos);
    const float edge = 1.4142136f;
    CHECK(overlapSphere(rotated.world, Vec3(edge, 0.0f, 0.0f), 0.2f, bodies, 4) == 1);
    CHECK(overlapSphere(rotated.world, Vec3(edge + 0.3f, 0.0f, 0.0f), 0.2f, bodies, 4) == 0);
}

void testOverlapDisjointAndOrdering() {
    Fixture fixture;
    fixture.addSphere(Vec3(-8.0f, 0.0f, 0.0f), 1.0f);
    fixture.addBox(Vec3(0.0f, 0.0f, 0.0f), Vec3(1.0f, 1.0f, 1.0f));
    fixture.addSphere(Vec3(8.0f, 0.0f, 0.0f), 1.0f);
    fixture.addSphere(Vec3(3.0f, 0.0f, 0.0f), 2.0f);
    int32_t bodies[8];
    const int32_t count = overlapSphere(fixture.world, Vec3(2.0f, 0.0f, 0.0f), 1.0f, bodies, 8);
    CHECK(count == 2);
    if (count == 2) {
        CHECK(bodies[0] == 1);
        CHECK(bodies[1] == 3);
    }
    const int32_t all = overlapSphere(fixture.world, Vec3(0.0f, 0.0f, 0.0f), 20.0f, bodies, 8);
    CHECK(all == 4);
    if (all == 4) {
        CHECK(bodies[0] == 0);
        CHECK(bodies[1] == 1);
        CHECK(bodies[2] == 2);
        CHECK(bodies[3] == 3);
    }
    const int32_t truncated = overlapSphere(fixture.world, Vec3(0.0f, 0.0f, 0.0f), 20.0f, bodies, 2);
    CHECK(truncated == 2);
    if (truncated == 2) {
        CHECK(bodies[0] == 0);
        CHECK(bodies[1] == 1);
    }
    CHECK(overlapSphere(fixture.world, Vec3(100.0f, 100.0f, 100.0f), 1.0f, bodies, 8) == 0);
}

void testRayHitsSecondShape() {
    Fixture fixture;
    const int32_t compound = fixture.addCompound(Vec3(0.0f, 0.0f, 0.0f));
    fixture.addBoxShape(compound, Vec3(1.0f, 1.0f, 1.0f), Vec3(4.0f, 0.0f, -5.0f), 0.0f, 0.0f, 0.0f, 1.0f);
    fixture.addSphereShape(compound, 1.0f, Vec3(0.0f, 0.0f, -5.0f));
    CHECK(fixture.bodies[compound].shapeCount == 2);

    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].body == compound);
        CHECK(hits[0].shape == ((compound << 3) | 1));
        CHECK(near(hits[0].t, 4.0f));
        CHECK(near(hits[0].pz, -4.0f));
        CHECK(near(hits[0].nz, 1.0f));
    }
    RayHit closest;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, closest));
    CHECK(closest.body == compound);
    CHECK(closest.shape == ((compound << 3) | 1));
    CHECK(near(closest.t, 4.0f));
}

void testRayKeepsEveryStruckShape() {
    Fixture fixture;
    const int32_t first = fixture.addCompound(Vec3(0.0f, 0.0f, 0.0f));
    fixture.addSphereShape(first, 1.0f, Vec3(0.0f, 0.0f, -9.0f));
    fixture.addBoxShape(first, Vec3(0.5f, 0.5f, 0.5f), Vec3(0.0f, 0.0f, -4.0f), 0.0f, 0.0f, 0.0f, 1.0f);

    const int32_t second = fixture.addCompound(Vec3(0.0f, 0.0f, 0.0f));
    fixture.addBoxShape(second, Vec3(0.5f, 0.5f, 0.5f), Vec3(0.0f, 0.0f, -4.0f), 0.0f, 0.0f, 0.0f, 1.0f);
    fixture.addSphereShape(second, 1.0f, Vec3(0.0f, 0.0f, -9.0f));

    RayHit hits[8];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 8);
    CHECK(count == 4);
    if (count == 4) {
        CHECK(hits[0].body == first);
        CHECK(hits[0].shape == ((first << 3) | 1));
        CHECK(near(hits[0].t, 3.5f));
        CHECK(hits[1].body == second);
        CHECK(hits[1].shape == ((second << 3) | 0));
        CHECK(near(hits[1].t, 3.5f));
        CHECK(hits[2].body == first);
        CHECK(hits[2].shape == ((first << 3) | 0));
        CHECK(near(hits[2].t, 8.0f));
        CHECK(hits[3].body == second);
        CHECK(hits[3].shape == ((second << 3) | 1));
        CHECK(near(hits[3].t, 8.0f));
    }

    RayHit closest;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, closest));
    CHECK(closest.body == first);
    CHECK(closest.shape == ((first << 3) | 1));
    CHECK(near(closest.t, 3.5f));
}

void testRayReportsStruckShapeId() {
    Fixture fixture;
    const int32_t compound = fixture.addCompound(Vec3(0.0f, 0.0f, 0.0f));
    fixture.addSphereShape(compound, 0.4f, Vec3(0.0f, 4.0f, 0.0f));
    fixture.addSphereShape(compound, 0.4f, Vec3(0.0f, -4.0f, 0.0f));
    fixture.addBoxShape(compound, Vec3(1.0f, 1.0f, 1.0f), Vec3(2.0f, 0.0f, 0.0f), 0.0f, 0.0f, 0.0f, 1.0f);

    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(-5.0f, 0.0f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 30.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].body == compound);
        CHECK(hits[0].shape == ((compound << 3) | 2));
        CHECK(near(hits[0].t, 6.0f));
        CHECK(near(hits[0].px, 1.0f));
        CHECK(near(hits[0].nx, -1.0f));
        CHECK(hits[0].reserved == 0.0f);
    }

    RayHit closest;
    CHECK(raycastClosest(
        fixture.world, Vec3(-5.0f, 0.0f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 30.0f, closest));
    CHECK(closest.body == compound);
    CHECK(closest.shape == ((compound << 3) | 2));
}

void testRayReportsMinusOneShapeWithoutGenerationTable() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    fixture.world.slotGen = nullptr;
    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].shape == -1);
    }
}

void testRotatedShapeOffsetRotation() {
    Fixture fixture;
    const float yawHalf = 0.3826834323650898f;
    const float yawCos = 0.9238795325112867f;
    const int32_t compound = fixture.addCompound(Vec3(0.0f, 0.0f, 0.0f));
    fixture.addBoxShape(compound, Vec3(1.0f, 1.0f, 0.5f), Vec3(0.0f, 0.0f, -5.0f), 0.0f, yawHalf, 0.0f, yawCos);

    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].shape == ((compound << 3) | 0));
        CHECK(near(hits[0].t, 4.2928932f));
        CHECK(near(hits[0].nx, 0.7071068f));
        CHECK(near(hits[0].nz, 0.7071068f));
    }
}

void testOverlapDeduplicatesBody() {
    Fixture fixture;
    const int32_t compound = fixture.addCompound(Vec3(0.0f, 0.0f, 0.0f));
    fixture.addSphereShape(compound, 1.0f, Vec3(0.0f, 0.0f, 0.0f));
    fixture.addSphereShape(compound, 1.0f, Vec3(3.0f, 0.0f, 0.0f));
    fixture.addBoxShape(compound, Vec3(0.5f, 0.5f, 0.5f), Vec3(1.5f, 0.0f, 0.0f), 0.0f, 0.0f, 0.0f, 1.0f);

    int32_t bodies[8];
    const int32_t count = overlapSphere(fixture.world, Vec3(1.5f, 0.0f, 0.0f), 1.0f, bodies, 8);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(bodies[0] == compound);
    }
}

void testOffsetShapeCoverage() {
    Fixture fixture;
    const int32_t compound = fixture.addCompound(Vec3(0.0f, 0.0f, 0.0f));
    fixture.addBoxShape(compound, Vec3(1.0f, 1.0f, 1.0f), Vec3(0.0f, 0.0f, -6.0f), 0.0f, 0.0f, 0.0f, 1.0f);

    int32_t bodies[8];
    CHECK(overlapSphere(fixture.world, Vec3(0.0f, 0.0f, 0.0f), 0.5f, bodies, 8) == 0);
    CHECK(overlapSphere(fixture.world, Vec3(0.0f, 0.0f, -6.0f), 0.5f, bodies, 8) == 1);
    CHECK(overlapSphere(fixture.world, Vec3(1.5f, 0.0f, -6.0f), 0.6f, bodies, 8) == 1);
    CHECK(overlapSphere(fixture.world, Vec3(1.5f, 0.0f, -6.0f), 0.4f, bodies, 8) == 0);

    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].shape == ((compound << 3) | 0));
        CHECK(near(hits[0].t, 5.0f));
        CHECK(near(hits[0].pz, -5.0f));
    }
    RayHit closest;
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.0f, 10.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, closest));
}

void testNoMutationOfWorld() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 1.0f, -3.0f), 1.5f);
    const float yawHalf = 0.3826834323650898f;
    const float yawCos = 0.9238795325112867f;
    fixture.addBox(Vec3(-2.0f, 0.0f, -6.0f), Vec3(1.0f, 2.0f, 0.5f), 0.0f, yawHalf, 0.0f, yawCos);
    const int32_t compound = fixture.addCompound(
        Vec3(1.0f, 0.5f, -2.0f), 0.0f, yawHalf, 0.0f, yawCos, kBodyDynamic);
    fixture.addSphereShape(compound, 0.75f, Vec3(0.0f, 1.5f, -3.0f));
    fixture.addBoxShape(compound, Vec3(0.5f, 0.25f, 1.0f), Vec3(2.0f, 0.0f, 0.0f), 0.0f, 0.0f, 0.0f, 1.0f);
    const uint32_t before = checksum(fixture);
    RayHit hits[8];
    RayHit closest;
    int32_t bodies[8];
    for (int32_t i = 0; i < 8; ++i) {
        hits[i].body = -777;
        hits[i].shape = -777;
        hits[i].t = -777.0f;
        hits[i].reserved = -777.0f;
        bodies[i] = -777;
    }
    const int32_t all = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.5f, -0.25f, -3.0f), 50.0f, hits, 8);
    CHECK(all >= 0);
    raycastClosest(
        fixture.world, Vec3(1.0f, 2.0f, 3.0f), Vec3(-0.75f, 0.25f, -4.5f), 50.0f, closest);
    overlapSphere(fixture.world, Vec3(0.0f, 0.0f, -4.0f), 3.0f, bodies, 8);
    const uint32_t after = checksum(fixture);
    CHECK(before == after);
}

void testRayHitsCapsuleSide() {
    Fixture fixture;
    const int32_t capsule = fixture.addCapsule(Vec3(0.0f, 0.0f, 0.0f), 0.2f, 0.5f);
    RayHit hit;
    CHECK(raycastClosest(
        fixture.world, Vec3(-3.0f, 0.0f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 100.0f, hit));
    CHECK(hit.body == capsule);
    CHECK(hit.shape == fixture.world.shapeMakeId(capsule, 0));
    CHECK(near(hit.t, 2.8f));
    CHECK(near(hit.nx, -1.0f));
    CHECK(near(hit.ny, 0.0f));
    CHECK(near(hit.nz, 0.0f));
    CHECK(near(hit.px, -0.2f));
}

void testRayHitsCapsuleCap() {
    Fixture fixture;
    fixture.addCapsule(Vec3(0.0f, 0.0f, 0.0f), 0.2f, 0.5f);
    RayHit hit;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 3.0f, 0.0f), Vec3(0.0f, -1.0f, 0.0f), 100.0f, hit));
    CHECK(near(hit.t, 2.3f));
    CHECK(near(hit.nx, 0.0f));
    CHECK(near(hit.ny, 1.0f));
    CHECK(near(hit.nz, 0.0f));
    CHECK(near(hit.py, 0.7f));
}

void testRayMissesCapsule() {
    Fixture fixture;
    fixture.addCapsule(Vec3(0.0f, 0.0f, 0.0f), 0.2f, 0.5f);
    RayHit hit;
    CHECK(!raycastClosest(
        fixture.world, Vec3(-3.0f, 2.0f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 100.0f, hit));
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.0f, 3.0f, 0.0f), Vec3(0.0f, 1.0f, 0.0f), 100.0f, hit));
}

void testRayInsideCapsule() {
    Fixture fixture;
    fixture.addCapsule(Vec3(0.0f, 0.0f, 0.0f), 0.2f, 0.5f);
    RayHit hit;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, 1.0f), 100.0f, hit));
    CHECK(near(hit.t, 0.0f));
    CHECK(near(hit.nz, -1.0f));
}

void testRayHitsRotatedCapsuleCap() {
    Fixture fixture;
    const float quarterTurn = 0.7071067811865476f;
    const int32_t id = fixture.reserve(Vec3(0.0f, 0.0f, 0.0f), 0.0f, 0.0f, quarterTurn, quarterTurn, kBodyStatic);
    fixture.bodies[id].rotation.fromQuaternion(0.0f, 0.0f, quarterTurn, quarterTurn);
    fixture.addCapsuleShape(id, 0.2f, 0.5f, Vec3());
    RayHit hit;
    CHECK(raycastClosest(
        fixture.world, Vec3(-3.0f, 0.0f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 100.0f, hit));
    CHECK(near(hit.t, 2.3f));
    CHECK(near(hit.nx, -1.0f));
    CHECK(near(hit.ny, 0.0f));
}

void testRayHitsCylinderSide() {
    Fixture fixture;
    const int32_t cylinder = fixture.addCylinder(Vec3(0.0f, 0.0f, 0.0f), 0.3f, 0.5f);
    RayHit hit;
    CHECK(raycastClosest(
        fixture.world, Vec3(-3.0f, 0.0f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 100.0f, hit));
    CHECK(hit.body == cylinder);
    CHECK(hit.shape == fixture.world.shapeMakeId(cylinder, 0));
    CHECK(near(hit.t, 2.7f));
    CHECK(near(hit.nx, -0.92387953f));
    CHECK(near(hit.ny, 0.0f));
    CHECK(near(hit.nz, 0.38268343f) || near(hit.nz, -0.38268343f));

    RayHit planar;
    CHECK(raycastClosest(
        fixture.world, Vec3(-3.0f, 0.0f, 0.12f), Vec3(1.0f, 0.0f, 0.0f), 100.0f, planar));
    CHECK(planar.px < -0.24f && planar.px > -0.26f);
}

void testRayHitsCylinderCap() {
    Fixture fixture;
    fixture.addCylinder(Vec3(0.0f, 0.0f, 0.0f), 0.3f, 0.5f);
    RayHit hit;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 3.0f, 0.0f), Vec3(0.0f, -1.0f, 0.0f), 100.0f, hit));
    CHECK(near(hit.t, 2.5f));
    CHECK(near(hit.nx, 0.0f));
    CHECK(near(hit.ny, 1.0f));
    CHECK(near(hit.py, 0.5f));
}

void testRayMissesCylinder() {
    Fixture fixture;
    fixture.addCylinder(Vec3(0.0f, 0.0f, 0.0f), 0.3f, 0.5f);
    RayHit hit;
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.5f, 3.0f, 0.0f), Vec3(0.0f, -1.0f, 0.0f), 100.0f, hit));
    CHECK(!raycastClosest(
        fixture.world, Vec3(-3.0f, 0.8f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 100.0f, hit));
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.0f, -3.0f, 0.0f), Vec3(0.0f, -1.0f, 0.0f), 100.0f, hit));
}

void testRayInsideCylinder() {
    Fixture fixture;
    fixture.addCylinder(Vec3(0.0f, 0.0f, 0.0f), 0.3f, 0.5f);
    RayHit hit;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 100.0f, hit));
    CHECK(near(hit.t, 0.0f));
    CHECK(near(hit.nx, -1.0f));
}

void testRayHitsConeSlantedFace() {
    Fixture fixture;
    const int32_t cone = fixture.addCone(Vec3(0.0f, 0.0f, 0.0f), 0.3f, 0.5f);

    RayHit hit;
    CHECK(raycastClosest(
        fixture.world, Vec3(-3.0f, 0.0f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 100.0f, hit));
    CHECK(hit.body == cone);
    CHECK(hit.t > 2.8f && hit.t < 2.9f);
    CHECK(hit.nx < -0.5f);
    CHECK(hit.ny > 0.1f);

    Hull hull;
    Mat3 identity;
    identity.setIdentity();
    buildConeHull(Vec3(), identity, 0.3f, 0.5f, hull);

    bool matchedFace = false;
    int32_t matchedIndex = -1;
    for (int32_t f = 0; f < hull.faceCount; ++f) {
        if (near(hit.nx, hull.faceNormals[f].x) && near(hit.ny, hull.faceNormals[f].y) &&
            near(hit.nz, hull.faceNormals[f].z)) {
            matchedFace = true;
            matchedIndex = f;
            break;
        }
    }
    CHECK(matchedFace);
    if (matchedIndex >= 0) {
        const Vec3 point(hit.px, hit.py, hit.pz);
        const float separation = dot(hull.faceNormals[matchedIndex], point) - hull.faceOffsets[matchedIndex];
        CHECK(near(separation, 0.0f));
    }

    RayHit miss;
    CHECK(!raycastClosest(
        fixture.world, Vec3(-3.0f, 0.8f, 0.0f), Vec3(1.0f, 0.0f, 0.0f), 100.0f, miss));
}

void testOverlapUsesConePolytope() {
    Fixture fixture;
    const int32_t cone = fixture.addCone(Vec3(3.0f, 0.0f, 0.0f), 0.3f, 0.5f);
    fixture.addSphere(Vec3(-4.0f, 0.0f, 0.0f), 0.2f);

    int32_t ids[8];
    const int32_t nearHits = overlapSphere(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), 2.85f, ids, 8);
    bool sawCone = false;
    for (int32_t i = 0; i < nearHits; ++i) {
        sawCone = sawCone || ids[i] == cone;
    }
    CHECK(nearHits == 1);
    CHECK(sawCone);

    const int32_t tight = overlapSphere(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), 2.72f, ids, 8);
    CHECK(tight == 0);
}

void testOverlapReturnsCapsuleAndCylinder() {
    Fixture fixture;
    const int32_t capsule = fixture.addCapsule(Vec3(-2.0f, 0.0f, 0.0f), 0.2f, 0.5f);
    const int32_t cylinder = fixture.addCylinder(Vec3(2.0f, 0.0f, 0.0f), 0.3f, 0.5f);
    fixture.addSphere(Vec3(0.0f, 0.0f, -8.0f), 0.1f);

    int32_t ids[8];
    const int32_t count = overlapSphere(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), 2.5f, ids, 8);
    CHECK(count == 2);
    bool sawCapsule = false;
    bool sawCylinder = false;
    for (int32_t i = 0; i < count; ++i) {
        sawCapsule = sawCapsule || ids[i] == capsule;
        sawCylinder = sawCylinder || ids[i] == cylinder;
    }
    CHECK(sawCapsule);
    CHECK(sawCylinder);

    const int32_t tight = overlapSphere(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), 1.0f, ids, 8);
    CHECK(tight == 0);
}

void testRaycastFilterByCategoryAndMask() {
    Fixture fixture;
    const int32_t first = fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    const int32_t second = fixture.addSphere(Vec3(0.0f, 0.0f, -9.0f), 1.0f);
    fixture.setShapeFilter(first, 0, 2, 2, 0);
    fixture.setShapeFilter(second, 0, 4, 4, 0);

    RayHit hits[4];
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, hits, 4) == 2);
    const int32_t onlyFirst = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, 2, 2, hits, 4);
    CHECK(onlyFirst == 1);
    if (onlyFirst == 1) {
        CHECK(hits[0].body == first);
    }
    const int32_t onlySecond = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, 4, 4, hits, 4);
    CHECK(onlySecond == 1);
    if (onlySecond == 1) {
        CHECK(hits[0].body == second);
    }
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, 0, 0, hits, 4) == 2);
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, 1, 0xFFFF, hits, 4) == 0);

    RayHit closest;
    CHECK(raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, 4, 4, closest));
    CHECK(closest.body == second);
    CHECK(!raycastClosest(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, 8, 8, closest));
}

void testQueryIgnoresGroupAndCollisionFilterRules() {
    Fixture fixture;
    const int32_t first = fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    const int32_t second = fixture.addSphere(Vec3(0.0f, 0.0f, -9.0f), 1.0f);
    fixture.setShapeFilter(first, 0, 1, 0xFFFF, -7);
    fixture.setShapeFilter(second, 0, 1, 0xFFFF, -7);

    RayHit hits[4];
    CHECK(raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, 1, 0xFFFF, hits, 4) == 2);
    int32_t bodies[4];
    CHECK(overlapSphere(
        fixture.world, Vec3(0.0f, 0.0f, -7.0f), 5.0f, 1, 0xFFFF, bodies, 4) == 2);
}

void testOverlapSphereFilterRejectsMismatchedShapes() {
    Fixture fixture;
    const int32_t first = fixture.addSphere(Vec3(0.0f, 0.0f, 0.0f), 1.0f);
    const int32_t second = fixture.addSphere(Vec3(2.0f, 0.0f, 0.0f), 1.0f);
    fixture.setShapeFilter(first, 0, 2, 2, 0);
    fixture.setShapeFilter(second, 0, 4, 4, 0);

    int32_t bodies[4];
    CHECK(overlapSphere(fixture.world, Vec3(1.0f, 0.0f, 0.0f), 2.0f, bodies, 4) == 2);
    const int32_t onlyFirst = overlapSphere(
        fixture.world, Vec3(1.0f, 0.0f, 0.0f), 2.0f, 2, 2, bodies, 4);
    CHECK(onlyFirst == 1);
    if (onlyFirst == 1) {
        CHECK(bodies[0] == first);
    }
    const int32_t onlySecond = overlapSphere(
        fixture.world, Vec3(1.0f, 0.0f, 0.0f), 2.0f, 4, 4, bodies, 4);
    CHECK(onlySecond == 1);
    if (onlySecond == 1) {
        CHECK(bodies[0] == second);
    }
    CHECK(overlapSphere(fixture.world, Vec3(1.0f, 0.0f, 0.0f), 2.0f, 0, 0, bodies, 4) == 2);
}

void testFractionConvention() {
    Fixture fixture;
    fixture.addSphere(Vec3(0.0f, 0.0f, -5.0f), 1.0f);
    RayHit hits[4];
    const int32_t count = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -4.0f), 100.0f, 0, 0, hits, 4);
    CHECK(count == 1);
    if (count == 1) {
        CHECK(hits[0].t == 4.0f);
        applyFractionConvention(hits, count, Vec3(0.0f, 0.0f, -4.0f));
        CHECK(hits[0].t == 1.0f);
        CHECK(near(hits[0].pz, -4.0f));
    }

    const int32_t scaled = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -0.5f), 100.0f, 0, 0, hits, 4);
    CHECK(scaled == 1);
    if (scaled == 1) {
        applyFractionConvention(hits, scaled, Vec3(0.0f, 0.0f, -0.5f));
        CHECK(near(hits[0].t, 8.0f));
    }

    RayHit untouched;
    const int32_t zeroCount = raycastAll(
        fixture.world, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, -1.0f), 100.0f, 0, 0, &untouched, 1);
    CHECK(zeroCount == 1);
    applyFractionConvention(&untouched, zeroCount, Vec3(0.0f, 0.0f, 0.0f));
    CHECK(untouched.t == 4.0f);
}

void testOverlapBoxAllBasics() {
    Fixture fixture;
    const int32_t box = fixture.addBox(Vec3(0.0f, 0.0f, 0.0f), Vec3(1.0f, 1.0f, 1.0f));
    fixture.setAabb(box, Vec3(-1.0f, -1.0f, -1.0f), Vec3(1.0f, 1.0f, 1.0f));
    const int32_t far = fixture.addSphere(Vec3(8.0f, 0.0f, 0.0f), 1.0f);
    fixture.setAabb(far, Vec3(7.0f, -1.0f, -1.0f), Vec3(9.0f, 1.0f, 1.0f));
    const int32_t freedId = fixture.addSphere(Vec3(0.0f, 0.0f, 0.0f), 1.0f);
    fixture.bodies[freedId].state = kBodyFree;
    const int32_t noShape = fixture.reserve(Vec3(0.0f, 0.0f, 0.0f), 0.0f, 0.0f, 0.0f, 1.0f, kBodyStatic);
    fixture.setAabb(noShape, Vec3(-1.0f, -1.0f, -1.0f), Vec3(1.0f, 1.0f, 1.0f));

    int32_t ids[8];
    const AABB nearBox = { -2.0f, -2.0f, -2.0f, 2.0f, 2.0f, 2.0f };
    CHECK(overlapBoxAll(fixture.world, nearBox, ids, 8) == 1);
    if (overlapBoxAll(fixture.world, nearBox, ids, 8) == 1) {
        CHECK(ids[0] == box);
    }

    const AABB touchBox = { 1.0f, -1.0f, -1.0f, 2.0f, 1.0f, 1.0f };
    CHECK(overlapBoxAll(fixture.world, touchBox, ids, 8) == 1);

    const AABB bothBox = { -5.0f, -5.0f, -5.0f, 20.0f, 5.0f, 5.0f };
    const int32_t both = overlapBoxAll(fixture.world, bothBox, ids, 8);
    CHECK(both == 2);
    if (both == 2) {
        CHECK(ids[0] == box);
        CHECK(ids[1] == far);
    }

    const int32_t capped = overlapBoxAll(fixture.world, bothBox, ids, 1);
    CHECK(capped == 1);
    if (capped == 1) {
        CHECK(ids[0] == box);
    }

    const AABB inverted = { 2.0f, -1.0f, -1.0f, -2.0f, 1.0f, 1.0f };
    CHECK(overlapBoxAll(fixture.world, inverted, ids, 8) == 0);

    const AABB nanBox = {
        0.0f / 0.0f, -1.0f, -1.0f, 1.0f, 1.0f, 1.0f
    };
    CHECK(overlapBoxAll(fixture.world, nanBox, ids, 8) == 0);

    CHECK(overlapBoxAll(fixture.world, nearBox, nullptr, 8) == 0);
    CHECK(overlapBoxAll(fixture.world, nearBox, ids, 0) == 0);
    CHECK(overlapBoxAll(fixture.world, nearBox, ids, -2) == 0);
}

void testQueryPointAllMatchesDegenerateBox() {
    Fixture fixture;
    const int32_t box = fixture.addBox(Vec3(0.0f, 0.0f, 0.0f), Vec3(1.0f, 1.0f, 1.0f));
    fixture.setAabb(box, Vec3(-1.0f, -1.0f, -1.0f), Vec3(1.0f, 1.0f, 1.0f));
    const int32_t compound = fixture.addCompound(Vec3(0.0f, 0.0f, 0.0f));
    fixture.addSphereShape(compound, 1.0f, Vec3(4.0f, 0.0f, 0.0f));
    fixture.addSphereShape(compound, 1.0f, Vec3(6.0f, 0.0f, 0.0f));
    fixture.setAabb(compound, Vec3(3.0f, -1.0f, -1.0f), Vec3(7.0f, 1.0f, 1.0f));

    int32_t ids[8];
    CHECK(queryPointAll(fixture.world, Vec3(0.5f, 0.5f, 0.5f), ids, 8) == 1);
    CHECK(queryPointAll(fixture.world, Vec3(1.0f, 1.0f, 1.0f), ids, 8) == 1);
    CHECK(queryPointAll(fixture.world, Vec3(1.1f, 0.0f, 0.0f), ids, 8) == 0);
    const int32_t both = queryPointAll(fixture.world, Vec3(4.5f, 0.0f, 0.0f), ids, 8);
    CHECK(both == 1);
    if (both == 1) {
        CHECK(ids[0] == compound);
    }
    const int32_t spanning = queryPointAll(
        fixture.world, Vec3(5.0f, 0.0f, 0.0f), ids, 1);
    CHECK(spanning == 1);

    fixture.reserve(Vec3(20.0f, 0.0f, 0.0f), 0.0f, 0.0f, 0.0f, 1.0f, kBodyStatic);
    CHECK(queryPointAll(fixture.world, Vec3(20.0f, 0.0f, 0.0f), ids, 8) == 0);
    CHECK(queryPointAll(fixture.world, Vec3(0.0f / 0.0f, 0.0f, 0.0f), ids, 8) == 0);
}

void testCollectStepStatistics() {
    Fixture fixture;
    const int32_t dynamic = fixture.addSphere(Vec3(0.0f, 0.0f, 0.0f), 1.0f, kBodyDynamic);
    fixture.bodies[dynamic].awake = 1;
    fixture.setAabb(dynamic, Vec3(-1.0f, -1.0f, -1.0f), Vec3(1.0f, 1.0f, 1.0f));

    const int32_t touching = fixture.addSphere(Vec3(1.0f, 0.0f, 0.0f), 1.0f);
    fixture.setAabb(touching, Vec3(0.0f, -1.0f, -1.0f), Vec3(2.0f, 1.0f, 1.0f));

    const int32_t staticA = fixture.addSphere(Vec3(0.0f, 0.0f, 0.0f), 0.5f);
    fixture.setAabb(staticA, Vec3(-1.0f, -1.0f, -1.0f), Vec3(1.0f, 1.0f, 1.0f));
    const int32_t staticB = fixture.addSphere(Vec3(0.5f, 0.0f, 0.0f), 0.5f);
    fixture.setAabb(staticB, Vec3(-0.5f, -0.5f, -0.5f), Vec3(1.5f, 0.5f, 0.5f));

    const int32_t sleeping = fixture.addSphere(Vec3(30.0f, 0.0f, 0.0f), 1.0f, kBodyDynamic);
    fixture.bodies[sleeping].awake = 0;
    fixture.setAabb(sleeping, Vec3(29.0f, -1.0f, -1.0f), Vec3(31.0f, 1.0f, 1.0f));

    const int32_t kinematic = fixture.addSphere(Vec3(32.0f, 0.0f, 0.0f), 1.0f, kBodyKinematic);
    fixture.setAabb(kinematic, Vec3(31.0f, -1.0f, -1.0f), Vec3(33.0f, 1.0f, 1.0f));

    Contact contacts[2];
    contacts[0].sensor = 0;
    contacts[1].sensor = 1;
    fixture.world.contacts = contacts;
    fixture.world.contactCount = 2;
    fixture.world.liveCount = 6;

    StepStatistics stats;
    collectStepStatistics(fixture.world, 100, -5, stats);
    CHECK(stats.broadphasePairsTested == 4.0f);
    CHECK(stats.shapePairsTested == 4.0f);
    CHECK(stats.contactsGenerated == 2.0f);
    CHECK(stats.sensorContacts == 1.0f);
    CHECK(stats.velocityIterations == static_cast<float>(kMaxIterations));
    CHECK(stats.positionIterations == 0.0f);
    CHECK(stats.sleepingBodies == 1.0f);
    CHECK(stats.liveBodies == 6.0f);

    collectStepStatistics(fixture.world, 8, 3, stats);
    CHECK(stats.velocityIterations == 8.0f);
    CHECK(stats.positionIterations == 3.0f);

    Fixture uninitialized;
    uninitialized.world.initialized = false;
    collectStepStatistics(uninitialized.world, 4, 2, stats);
    CHECK(stats.broadphasePairsTested == 0.0f);
    CHECK(stats.shapePairsTested == 0.0f);
    CHECK(stats.contactsGenerated == 0.0f);
    CHECK(stats.sensorContacts == 0.0f);
    CHECK(stats.velocityIterations == 4.0f);
    CHECK(stats.positionIterations == 2.0f);
    CHECK(stats.sleepingBodies == 0.0f);
    CHECK(stats.liveBodies == 0.0f);
}

}

int main() {
    testRayHitsSphereFromOutside();
    testRayMissesSphere();
    testRayBehindSphereMisses();
    testRayInsideSphere();
    testRayHitsAxisAlignedBox();
    testRayHitsRotatedBox();
    testRayInsideBox();
    testRayMissesBox();
    testMaxDistanceCutoff();
    testUnnormalizedDirection();
    testZeroDirection();
    testCapacityTruncationKeepsClosest();
    testHitOrderingByT();
    testTieBreakByBodyId();
    testRaycastClosestPicksMinimum();
    testInvalidArguments();
    testSkipsUnusableBodies();
    testRayHitsSecondShape();
    testRayKeepsEveryStruckShape();
    testRayReportsStruckShapeId();
    testRayReportsMinusOneShapeWithoutGenerationTable();
    testRotatedShapeOffsetRotation();
    testOverlapDeduplicatesBody();
    testOffsetShapeCoverage();
    testOverlapSphereWithSphere();
    testOverlapSphereWithBox();
    testOverlapDisjointAndOrdering();
    testNoMutationOfWorld();
    testRayHitsCapsuleSide();
    testRayHitsCapsuleCap();
    testRayMissesCapsule();
    testRayInsideCapsule();
    testRayHitsRotatedCapsuleCap();
    testRayHitsCylinderSide();
    testRayHitsCylinderCap();
    testRayMissesCylinder();
    testRayInsideCylinder();
    testRayHitsConeSlantedFace();
    testOverlapUsesConePolytope();
    testOverlapReturnsCapsuleAndCylinder();
    testRaycastFilterByCategoryAndMask();
    testQueryIgnoresGroupAndCollisionFilterRules();
    testOverlapSphereFilterRejectsMismatchedShapes();
    testFractionConvention();
    testOverlapBoxAllBasics();
    testQueryPointAllMatchesDegenerateBox();
    testCollectStepStatistics();

    printf("query_test: %d checks, %d failures\n", gChecks, gFailures);
    return gFailures == 0 ? 0 : 1;
}
