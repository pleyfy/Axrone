#include <cstdio>
#include <cstring>

#include "core/world.h"
#include "runtime/arena.h"
#include "scenario.h"

using namespace axrone::physics;

namespace {

alignas(64) unsigned char g_memoryA[64 * 1024 * 1024];
alignas(64) unsigned char g_memoryB[64 * 1024 * 1024];

int g_failures = 0;

#define CHECK(condition) \
    do { \
        if (!(condition)) { \
            std::printf("FAIL %s:%d %s\n", __FILE__, __LINE__, #condition); \
            ++g_failures; \
        } \
    } while (0)

bool near(float value, float expected, float tolerance) {
    const float difference = value - expected;
    return difference <= tolerance && difference >= -tolerance;
}

bool finiteVector(const Vec3& value) {
    return isFinite(value.x) && isFinite(value.y) && isFinite(value.z);
}

bool initWorld(World& world, Arena& arena, unsigned char* memory, int32_t bodies, int32_t contacts) {
    arena.init(memory, 64 * 1024 * 1024);
    return world.init(arena, bodies, contacts, Vec3(0.0f, -9.81f, 0.0f));
}

void testInitValidation() {
    Arena arena;
    World world;
    arena.init(g_memoryA, sizeof(g_memoryA));

    CHECK(!world.init(arena, 0, 16, Vec3(0.0f, -9.81f, 0.0f)));
    CHECK(!world.init(arena, 16, 0, Vec3(0.0f, -9.81f, 0.0f)));
    CHECK(!world.init(arena, -1, 16, Vec3(0.0f, -9.81f, 0.0f)));

    arena.reset();
    CHECK(world.init(arena, 16, 256, Vec3(0.0f, -9.81f, 0.0f)));
    CHECK(world.bodyCount() == 0);
    CHECK(world.getContactCount() == 0);
}

void testSphereRest() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 64, 2048));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t sphere = world.createBody(kBodyTypeDynamic, 0.0f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(sphere >= 0);
    CHECK(world.setSphere(sphere, 0.5f, 1.0f) == 0);
    CHECK(world.setMaterial(sphere, 0.6f, 0.0f) == 0);

    for (int32_t i = 0; i < 180; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    const Transform& transform = world.transforms[sphere];
    CHECK(isFinite(transform.px) && isFinite(transform.py) && isFinite(transform.pz));
    CHECK(near(transform.py, 0.5f, 0.08f));
    CHECK(fabsf(world.velocities[sphere].y) < 0.25f);
    CHECK(world.getContactCount() >= 1);
}

void testBoxStack() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 64, 2048));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    int32_t boxes[3];
    for (int32_t i = 0; i < 3; ++i) {
        boxes[i] = world.createBody(kBodyTypeDynamic, 0.0f, 0.5f + static_cast<float>(i), 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        CHECK(boxes[i] >= 0);
        CHECK(world.setBox(boxes[i], 0.5f, 0.5f, 0.5f, 1.0f) == 0);
        CHECK(world.setMaterial(boxes[i], 0.7f, 0.0f) == 0);
    }

    for (int32_t i = 0; i < 240; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    for (int32_t i = 0; i < 3; ++i) {
        const Transform& transform = world.transforms[boxes[i]];
        CHECK(isFinite(transform.px) && isFinite(transform.py) && isFinite(transform.pz));
        CHECK(transform.py > 0.2f && transform.py < 5.0f);
    }
    CHECK(world.getContactCount() >= 1);
}

void testDeterminism() {
    Arena arenaA;
    Arena arenaB;
    World worldA;
    World worldB;
    CHECK(initWorld(worldA, arenaA, g_memoryA, 512, 16384));
    CHECK(initWorld(worldB, arenaB, g_memoryB, 512, 16384));

    addStandardBodies(worldA);
    addStandardBodies(worldB);
    runStandardScene(worldA);
    runStandardScene(worldB);

    CHECK(worldA.getContactCount() == worldB.getContactCount());
    CHECK(worldA.fingerprint() == worldB.fingerprint());

    const uint64_t first = worldA.fingerprint();
    worldA.step(kStandardDt, 8, 3);
    CHECK(worldA.fingerprint() != first);
}

void testDestroyAndReuse() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 8, 64));

    const int32_t first = world.createBody(kBodyTypeDynamic, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t second = world.createBody(kBodyTypeDynamic, 1.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t third = world.createBody(kBodyTypeDynamic, 2.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(first >= 0 && second >= 0 && third >= 0);
    CHECK(world.setBox(first, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setBox(second, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setBox(third, 0.5f, 0.5f, 0.5f, 1.0f) == 0);

    CHECK(world.destroyBody(second) == 0);
    CHECK(world.bodyCount() == 2);

    const int32_t reused = world.createBody(kBodyTypeDynamic, 3.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(reused == second);
    CHECK(world.bodyCount() == 3);
    CHECK(world.setBox(reused, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 0);
}

void testContactManifolds() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t boxA = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t boxB = world.createBody(kBodyTypeDynamic, 0.6f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(boxA, 0.5f, 0.5f, 0.5f, 0.0f) == 0);
    CHECK(world.setBox(boxB, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 0);
    CHECK(world.getContactCount() >= 1);

    const int32_t sphere = world.createBody(kBodyTypeDynamic, 0.4f, 0.4f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setSphere(sphere, 0.5f, 1.0f) == 0);
    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 0);
    CHECK(world.getContactCount() >= 1);

    for (int32_t i = 0; i < world.getContactCount(); ++i) {
        const PackedContact& contact = world.packedContacts[i];
        CHECK(contact.a >= 0 && contact.a < world.highWater);
        CHECK(contact.b >= 0 && contact.b < world.highWater);
        CHECK(isFinite(contact.nx) && isFinite(contact.ny) && isFinite(contact.nz));
        CHECK(isFinite(contact.pen));
    }
}

void testInvalidInputs() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 2, 32));

    CHECK(world.createBody(99, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.createBody(kBodyTypeDynamic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f) >= 0);

    const int32_t id = world.createBody(kBodyTypeDynamic, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(id >= 0);
    CHECK(world.createBody(kBodyTypeDynamic, 0.0f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);

    CHECK(world.setSphere(id, -1.0f, 1.0f) == -1);
    CHECK(world.setSphere(id, 1.0f, 0.0f) == -1);
    CHECK(world.setBox(id, 0.0f, 1.0f, 1.0f, 1.0f) == -1);
    CHECK(world.setBox(id, 1.0f, 1.0f, 1.0f, -1.0f) == -1);
    CHECK(world.setTransform(id, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.setVelocity(id, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.setAngularVelocity(id, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.setMaterial(id, -0.1f, 0.0f) == -1);
    CHECK(world.setMaterial(id, 0.5f, 2.0f) == 0);
    CHECK(world.step(0.0f, 4, 2) == -1);
    CHECK(world.step(-1.0f, 4, 2) == -1);
    CHECK(world.step(1.0f / 60.0f, -5, -5) >= 0);
    CHECK(world.destroyBody(-1) == -1);
    CHECK(world.destroyBody(999) == -1);
}

void testRestitution() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t sphere = world.createBody(kBodyTypeDynamic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(sphere >= 0);
    CHECK(world.setSphere(sphere, 0.5f, 1.0f) == 0);
    CHECK(world.setMaterial(ground, 0.6f, 1.0f) == 0);
    CHECK(world.setMaterial(sphere, 0.6f, 1.0f) == 0);

    bool touched = false;
    float highestAfterContact = 0.0f;
    for (int32_t i = 0; i < 240; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
        if (world.getContactCount() > 0) {
            touched = true;
        }
        if (touched && world.transforms[sphere].py > highestAfterContact) {
            highestAfterContact = world.transforms[sphere].py;
        }
    }

    CHECK(touched);
    CHECK(highestAfterContact > 0.8f);
    CHECK(isFinite(world.transforms[sphere].py));
}

void testFriction() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t box = world.createBody(kBodyTypeDynamic, 0.0f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(box >= 0);
    CHECK(world.setBox(box, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setMaterial(box, 0.8f, 0.0f) == 0);
    CHECK(world.setVelocity(box, 5.0f, 0.0f, 0.0f) == 0);

    for (int32_t i = 0; i < 180; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    CHECK(fabsf(world.velocities[box].x) < 4.0f);
    CHECK(isFinite(world.transforms[box].px));
}

void testRotatedBoxContact() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t boxA = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const float half = 0.70710678f;
    const int32_t boxB = world.createBody(kBodyTypeDynamic, 0.7f, 0.0f, 0.0f, 0.0f, 0.0f, half, half);
    CHECK(world.setBox(boxA, 0.5f, 0.5f, 0.5f, 0.0f) == 0);
    CHECK(world.setBox(boxB, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 0);
    CHECK(world.getContactCount() >= 1);

    for (int32_t i = 0; i < world.getContactCount(); ++i) {
        CHECK(isFinite(world.packedContacts[i].pen));
        CHECK(isFinite(world.packedContacts[i].nx));
    }
}

void testKinematicBodyCreation() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t platform = world.createBody(kBodyTypeKinematic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(platform >= 0);
    CHECK(world.bodies[platform].state == kBodyKinematic);
    CHECK(world.setBox(platform, 2.0f, 0.1f, 2.0f, 1.0f) == 0);
    CHECK(world.bodies[platform].invMass == 0.0f);
    CHECK(world.bodies[platform].invInertia.x == 0.0f);
    CHECK(world.bodies[platform].invInertia.y == 0.0f);
    CHECK(world.bodies[platform].invInertia.z == 0.0f);
    CHECK(world.setSphere(platform, 0.5f, 1.0f) == 0);
    CHECK(world.bodies[platform].invMass == 0.0f);
    CHECK(world.bodies[platform].invInertia.x == 0.0f);

    CHECK(world.createBody(3, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.destroyBody(platform) == 0);
}

void testKinematicIgnoresGravity() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeKinematic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    CHECK(world.setBox(body, 0.5f, 0.5f, 0.5f, 1.0f) == 0);

    for (int32_t i = 0; i < 60; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    CHECK(world.transforms[body].px == 0.0f);
    CHECK(world.transforms[body].py == 3.0f);
    CHECK(world.transforms[body].pz == 0.0f);
    CHECK(world.velocities[body].x == 0.0f);
    CHECK(world.velocities[body].y == 0.0f);

    CHECK(world.setVelocity(body, 1.0f, 0.0f, 0.0f) == 0);
    for (int32_t i = 0; i < 60; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    CHECK(near(world.transforms[body].px, 1.0f, 0.01f));
    CHECK(near(world.transforms[body].py, 3.0f, 0.01f));
    CHECK(world.velocities[body].x == 1.0f);
    CHECK(world.velocities[body].y == 0.0f);

    CHECK(world.setAngularVelocity(body, 0.0f, 2.0f, 0.0f) == 0);
    const float qyBefore = world.transforms[body].qy;
    world.step(1.0f / 60.0f, 8, 3);
    CHECK(fabsf(world.transforms[body].qy - qyBefore) > 1e-4f);
    CHECK(near(world.transforms[body].px, 1.0f, 0.02f));
    CHECK(world.angularVelocities[body].y == 2.0f);
}

void testKinematicCollidesWithStatic() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t drifter = world.createBody(kBodyTypeKinematic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(drifter >= 0);
    CHECK(world.setBox(drifter, 0.5f, 0.5f, 0.5f, 1.0f) == 0);

    CHECK(world.step(1.0f / 60.0f, 8, 3) >= 0);
    CHECK(world.getContactCount() >= 1);
    CHECK(world.transforms[ground].py == -0.5f);
    CHECK(world.transforms[drifter].py == 0.0f);

    const int32_t other = world.createBody(kBodyTypeKinematic, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(other >= 0);
    CHECK(world.setBox(other, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.step(1.0f / 60.0f, 8, 3) >= 0);
    CHECK(world.transforms[other].px == 3.0f);
}

void testKinematicPlatformCarriesBox() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t platform = world.createBody(kBodyTypeKinematic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(platform >= 0);
    CHECK(world.setBox(platform, 2.0f, 0.1f, 2.0f, 1.0f) == 0);
    CHECK(world.setMaterial(platform, 0.9f, 0.0f) == 0);
    CHECK(world.setVelocity(platform, 0.0f, 1.0f, 0.0f) == 0);

    const int32_t box = world.createBody(kBodyTypeDynamic, 0.0f, 0.6f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(box >= 0);
    CHECK(world.setBox(box, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setMaterial(box, 0.9f, 0.0f) == 0);

    for (int32_t i = 0; i < 120; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    CHECK(near(world.transforms[platform].py, 2.0f, 0.01f));
    CHECK(world.transforms[box].py > 2.2f);
    CHECK(world.transforms[box].py < 2.9f);
    CHECK(world.velocities[box].y > 0.4f);
    CHECK(world.velocities[box].y < 1.6f);
    CHECK(world.getContactCount() >= 1);
}

void testDynamicCannotPushKinematic() {
    Arena arena;
    World world;
    arena.init(g_memoryA, 64 * 1024 * 1024);
    CHECK(world.init(arena, 16, 256, Vec3(0.0f, 0.0f, 0.0f)));

    const int32_t wall = world.createBody(kBodyTypeKinematic, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(wall >= 0);
    CHECK(world.setBox(wall, 0.2f, 1.0f, 1.0f, 1.0f) == 0);
    CHECK(world.setMaterial(wall, 0.5f, 0.0f) == 0);

    const int32_t ram = world.createBody(kBodyTypeDynamic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ram >= 0);
    CHECK(world.setBox(ram, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setMaterial(ram, 0.0f, 0.0f) == 0);
    CHECK(world.setVelocity(ram, 5.0f, 0.0f, 0.0f) == 0);

    for (int32_t i = 0; i < 120; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    CHECK(world.transforms[wall].px == 2.0f);
    CHECK(world.transforms[wall].py == 0.0f);
    CHECK(world.velocities[wall].x == 0.0f);
    CHECK(world.transforms[ram].px < 1.5f);
    CHECK(isFinite(world.transforms[ram].px));
}

void testMultiShapeMassAccumulation() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t single = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(single >= 0);
    CHECK(world.setBox(single, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.bodies[single].shapeCount == 1);
    CHECK(near(world.bodies[single].invMass, 1.0f, 1e-5f));
    CHECK(near(world.bodies[single].invInertia.x, 6.0f, 1e-4f));
    CHECK(near(world.bodies[single].invInertia.y, 6.0f, 1e-4f));

    const int32_t compound = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(compound >= 0);
    CHECK(world.setBox(compound, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.addBox(compound, 0.5f, 0.5f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 1);
    CHECK(world.bodies[compound].shapeCount == 2);
    CHECK(near(world.bodies[compound].invMass, 0.5f, 1e-5f));
    CHECK(near(world.bodies[compound].invInertia.x, 3.0f, 1e-4f));
    CHECK(near(world.bodies[compound].invInertia.y, 3.0f, 1e-4f));
    CHECK(near(world.bodies[compound].invInertia.z, 3.0f, 1e-4f));

    CHECK(world.addSphere(compound, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f) == 2);
    CHECK(world.bodies[compound].shapeCount == 3);
    CHECK(world.bodies[compound].invMass < 0.5f);
    CHECK(world.bodies[compound].invMass > 0.0f);
}

void testParallelAxisInertiaGrows() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t centered = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(centered, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.addBox(centered, 0.5f, 0.5f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 1);

    const int32_t offset = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(offset, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.addBox(offset, 0.5f, 0.5f, 0.5f, 1.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 1);

    CHECK(world.bodies[offset].invMass == world.bodies[centered].invMass);
    CHECK(world.bodies[offset].invInertia.x < world.bodies[centered].invInertia.x);
    CHECK(world.bodies[offset].invInertia.z < world.bodies[centered].invInertia.z);
    CHECK(near(world.bodies[offset].invInertia.y, 3.0f, 1e-4f));
    CHECK(near(world.bodies[offset].invInertia.x, 0.75f, 1e-4f));
    CHECK(near(world.bodies[offset].invInertia.z, 0.75f, 1e-4f));
}

void testOffsetShapeRestsOnGround() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    CHECK(world.addBox(body, 0.5f, 0.5f, 0.5f, 1.0f, 0.0f, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.setMaterial(body, 0.7f, 0.0f) == 0);

    for (int32_t i = 0; i < 240; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    const Transform& transform = world.transforms[body];
    CHECK(isFinite(transform.px) && isFinite(transform.py) && isFinite(transform.pz));
    CHECK(near(transform.py, 1.5f, 0.08f));
    CHECK(fabsf(world.velocities[body].y) < 0.25f);
    CHECK(world.getContactCount() >= 1);
}

void testClearShapesResetsProperties() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    CHECK(world.setSphere(body, 0.5f, 1.0f) == 0);
    CHECK(world.bodies[body].invMass > 0.0f);
    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 0);
    CHECK(world.getContactCount() >= 1);

    CHECK(world.clearShapes(body) == 0);
    CHECK(world.bodies[body].shapeCount == 0);
    CHECK(world.bodies[body].invMass == 0.0f);
    CHECK(world.bodies[body].invInertia.x == 0.0f);
    CHECK(world.bodies[body].invInertia.y == 0.0f);
    CHECK(world.bodies[body].invInertia.z == 0.0f);
    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 0);
    CHECK(world.getContactCount() == 0);

    CHECK(world.addBox(body, 0.5f, 0.5f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.bodies[body].shapeCount == 1);
    CHECK(near(world.bodies[body].invMass, 1.0f, 1e-5f));
    CHECK(world.clearShapes(-1) == -1);
    CHECK(world.clearShapes(9999) == -1);
}

void testShapeCapacityRejection() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);

    for (int32_t slot = 0; slot < kMaxShapesPerBody; ++slot) {
        const float offset = static_cast<float>(slot) * 0.1f;
        CHECK(world.addSphere(body, 0.5f, 1.0f, offset, 0.0f, 0.0f) == slot);
    }
    CHECK(world.bodies[body].shapeCount == kMaxShapesPerBody);

    const float invMassBefore = world.bodies[body].invMass;
    const Vec3 inertiaBefore = world.bodies[body].invInertia;
    CHECK(world.addSphere(body, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.addBox(body, 0.5f, 0.5f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.bodies[body].shapeCount == kMaxShapesPerBody);
    CHECK(world.bodies[body].invMass == invMassBefore);
    CHECK(world.bodies[body].invInertia.x == inertiaBefore.x);
    CHECK(world.bodies[body].invInertia.y == inertiaBefore.y);
    CHECK(world.bodies[body].invInertia.z == inertiaBefore.z);
    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 0);

    const int32_t probe = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(probe >= 0);
    CHECK(world.setSphere(probe, 0.5f, 1.0f) == 0);
    CHECK(world.addSphere(probe, -1.0f, 1.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.addSphere(probe, 1.0f, -1.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.addSphere(probe, 1.0f, 1.0f, kFloatMax, 0.0f, 0.0f) == -1);
    CHECK(world.addBox(probe, 0.0f, 1.0f, 1.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addBox(probe, 1.0f, 1.0f, 1.0f, 1.0f, 0.0f, kFloatMax, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addSphere(probe, 1.0f, 1.0f, 0.0f, 0.0f, 0.0f) == 1);
    CHECK(world.bodies[probe].shapeCount == 2);
}

void testStaticAndKinematicKeepZeroMass() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t staticBody = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t kinematicBody = world.createBody(kBodyTypeKinematic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(staticBody >= 0);
    CHECK(kinematicBody >= 0);

    const int32_t bodies[2] = { staticBody, kinematicBody };
    for (int32_t i = 0; i < 2; ++i) {
        const int32_t id = bodies[i];
        CHECK(world.setSphere(id, 0.5f, 5.0f) == 0);
        CHECK(world.bodies[id].invMass == 0.0f);
        CHECK(world.setBox(id, 0.5f, 0.5f, 0.5f, 5.0f) == 0);
        CHECK(world.bodies[id].invMass == 0.0f);
        CHECK(world.bodies[id].invInertia.x == 0.0f);
        CHECK(world.addSphere(id, 0.5f, 5.0f, 0.0f, 1.0f, 0.0f) == 1);
        CHECK(world.bodies[id].invMass == 0.0f);
        CHECK(world.addBox(id, 0.5f, 0.5f, 0.5f, 5.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.70710678f, 0.0f, 0.70710678f) == 2);
        CHECK(world.bodies[id].shapeCount == 3);
        CHECK(world.bodies[id].invMass == 0.0f);
        CHECK(world.bodies[id].invInertia.y == 0.0f);
        CHECK(world.bodies[id].invInertia.z == 0.0f);
    }
}

void testOffsetShapeAabbUnion() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    CHECK(world.setBox(body, 1.0f, 1.0f, 1.0f, 0.0f) == 0);
    CHECK(world.step(1.0f / 60.0f, 1, 1) >= 0);
    CHECK(near(world.bodies[body].aabb.minX, -1.0f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxX, 1.0f, 1e-5f));

    CHECK(world.addBox(body, 0.5f, 0.5f, 0.5f, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 1);
    CHECK(world.step(1.0f / 60.0f, 1, 1) >= 0);
    CHECK(near(world.bodies[body].aabb.maxX, 4.5f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.minX, -1.0f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxY, 1.0f, 1e-5f));

    CHECK(world.addSphere(body, 2.0f, 0.0f, -6.0f, 0.0f, 0.0f) == 2);
    CHECK(world.step(1.0f / 60.0f, 1, 1) >= 0);
    CHECK(near(world.bodies[body].aabb.minX, -8.0f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxX, 4.5f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.minY, -2.0f, 1e-5f));
}

void testMultiShapeDeterminism() {
    Arena arenaA;
    Arena arenaB;
    World worldA;
    World worldB;
    CHECK(initWorld(worldA, arenaA, g_memoryA, 64, 4096));
    CHECK(initWorld(worldB, arenaB, g_memoryB, 64, 4096));

    World* const worlds[2] = { &worldA, &worldB };
    for (int32_t w = 0; w < 2; ++w) {
        World& world = *worlds[w];
        const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        CHECK(ground >= 0);
        CHECK(world.setBox(ground, 20.0f, 0.5f, 20.0f, 0.0f) == 0);
        CHECK(world.setMaterial(ground, 0.8f, 0.0f) == 0);

        for (int32_t i = 0; i < 6; ++i) {
            const float x = static_cast<float>(i) * 2.5f - 6.0f;
            const int32_t body = world.createBody(
                kBodyTypeDynamic, x, 2.0f + static_cast<float>(i), 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
            CHECK(body >= 0);
            CHECK(world.addBox(body, 0.5f, 0.5f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
            CHECK(world.addSphere(body, 0.4f, 1.0f, 1.1f, 0.0f, 0.0f) == 1);
            CHECK(world.addBox(body, 0.25f, 0.75f, 0.25f, 2.0f, -1.0f, 0.5f, 0.0f, 0.0f, 0.3826834f, 0.0f, 0.9238795f) == 2);
            CHECK(world.setMaterial(body, 0.7f, 0.0f) == 0);
        }
    }

    for (int32_t i = 0; i < 180; ++i) {
        worldA.step(1.0f / 60.0f, 8, 3);
        worldB.step(1.0f / 60.0f, 8, 3);
    }

    CHECK(worldA.getContactCount() == worldB.getContactCount());
    CHECK(worldA.fingerprint() == worldB.fingerprint());
    CHECK(worldA.getContactCount() >= 1);

    for (int32_t i = 0; i < worldA.highWater; ++i) {
        if (worldA.bodies[i].state == kBodyFree) {
            continue;
        }
        const Transform& transform = worldA.transforms[i];
        CHECK(isFinite(transform.px) && isFinite(transform.py) && isFinite(transform.pz));
        CHECK(isFinite(transform.qx) && isFinite(transform.qy) && isFinite(transform.qz) && isFinite(transform.qw));
        CHECK(finiteVector(worldA.velocities[i]));
        CHECK(finiteVector(worldA.angularVelocities[i]));
        CHECK(isFinite(worldA.bodies[i].invMass));
        CHECK(finiteVector(worldA.bodies[i].invInertia));
    }
}

void testArenaExhaustion() {
    alignas(64) unsigned char small[8192];
    Arena arena;
    arena.init(small, sizeof(small));
    World world;
    CHECK(!world.init(arena, 512, 16384, Vec3(0.0f, -9.81f, 0.0f)));
    CHECK(world.bodyCount() == 0);
}

void testStressDeterminism() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 512, 16384));
    addStandardBodies(world);
    runStandardScene(world);

    for (int32_t i = 0; i < world.highWater; ++i) {
        if (world.bodies[i].state == kBodyFree) {
            continue;
        }
        const Transform& transform = world.transforms[i];
        CHECK(isFinite(transform.px) && isFinite(transform.py) && isFinite(transform.pz));
        CHECK(isFinite(transform.qx) && isFinite(transform.qy) && isFinite(transform.qz) && isFinite(transform.qw));
        CHECK(finiteVector(world.velocities[i]));
        CHECK(finiteVector(world.angularVelocities[i]));
    }

    const uint64_t first = world.fingerprint();
    const int32_t contacts = world.getContactCount();
    world.step(kStandardDt, 8, 3);
    CHECK(world.getContactCount() > 0);
    CHECK(contacts > 0);
    CHECK(world.fingerprint() != first);
}

bool initGravitylessWorld(World& world, Arena& arena, unsigned char* memory, int32_t bodies, int32_t contacts) {
    arena.init(memory, 64 * 1024 * 1024);
    return world.init(arena, bodies, contacts, Vec3(0.0f, 0.0f, 0.0f));
}

int32_t addFreeBox(World& world, float x, float y, float z) {
    const int32_t id = world.createBody(kBodyTypeDynamic, x, y, z, 0.0f, 0.0f, 0.0f, 1.0f);
    if (id < 0) {
        return id;
    }
    if (world.setBox(id, 0.5f, 0.5f, 0.5f, 1.0f) != 0) {
        return -1;
    }
    return id;
}

void testDampingDecay() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = addFreeBox(world, 0.0f, 10.0f, 0.0f);
    CHECK(body >= 0);
    CHECK(world.setDamping(body, 0.1f, 0.2f) == 0);
    CHECK(world.setVelocity(body, 1.0f, 0.0f, 0.0f) == 0);
    CHECK(world.setAngularVelocity(body, 0.0f, 1.0f, 0.0f) == 0);
    CHECK(world.bodies[body].linearDamping == 0.1f);
    CHECK(world.bodies[body].angularDamping == 0.2f);

    const float dt = 1.0f / 60.0f;
    for (int32_t i = 0; i < 10; ++i) {
        world.step(dt, 4, 2);
    }

    const double factor = 1.0 - 0.1 * static_cast<double>(dt);
    const double expectedLinear = factor * factor * factor * factor * factor *
                                  factor * factor * factor * factor * factor;
    const double expectedAngular = (1.0 - 0.2 * static_cast<double>(dt)) *
                                   (1.0 - 0.2 * static_cast<double>(dt)) *
                                   (1.0 - 0.2 * static_cast<double>(dt)) *
                                   (1.0 - 0.2 * static_cast<double>(dt)) *
                                   (1.0 - 0.2 * static_cast<double>(dt)) *
                                   (1.0 - 0.2 * static_cast<double>(dt)) *
                                   (1.0 - 0.2 * static_cast<double>(dt)) *
                                   (1.0 - 0.2 * static_cast<double>(dt)) *
                                   (1.0 - 0.2 * static_cast<double>(dt)) *
                                   (1.0 - 0.2 * static_cast<double>(dt));

    const float relative = 1e-4f;
    CHECK(fabsf(world.velocities[body].x - static_cast<float>(expectedLinear)) <=
          relative * static_cast<float>(expectedLinear));
    CHECK(fabsf(world.angularVelocities[body].y - static_cast<float>(expectedAngular)) <=
          relative * static_cast<float>(expectedAngular));

    CHECK(world.setDamping(body, -0.1f, 0.0f) == -1);
    CHECK(world.setDamping(body, 0.0f, kFloatMax * 10.0f) == -1);
    CHECK(world.setDamping(-1, 0.0f, 0.0f) == -1);

    const int32_t blocker = addFreeBox(world, 5.0f, 10.0f, 0.0f);
    CHECK(blocker >= 0);
    CHECK(world.setDamping(blocker, 10000.0f, 0.0f) == 0);
    CHECK(world.setVelocity(blocker, 3.0f, 0.0f, 0.0f) == 0);
    world.step(dt, 4, 2);
    CHECK(world.velocities[blocker].x == 0.0f);
}

void testGravityScale() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t floater = addFreeBox(world, -4.0f, 100.0f, 0.0f);
    const int32_t normal = addFreeBox(world, 0.0f, 100.0f, 0.0f);
    const int32_t doublePull = addFreeBox(world, 4.0f, 100.0f, 0.0f);
    CHECK(floater >= 0 && normal >= 0 && doublePull >= 0);

    CHECK(world.setGravityScale(floater, 0.0f) == 0);
    CHECK(world.setGravityScale(doublePull, 2.0f) == 0);
    CHECK(world.setGravityScale(normal, kFloatMax * 10.0f) == -1);

    const float dt = 1.0f / 60.0f;
    for (int32_t i = 0; i < 60; ++i) {
        world.step(dt, 4, 2);
    }

    CHECK(world.transforms[floater].py == 100.0f);
    CHECK(world.velocities[floater].y == 0.0f);

    const float normalDrop = 100.0f - world.transforms[normal].py;
    const float doubleDrop = 100.0f - world.transforms[doublePull].py;
    CHECK(normalDrop > 0.1f);
    CHECK(fabsf(doubleDrop - 2.0f * normalDrop) < 0.02f);
    CHECK(fabsf(world.velocities[doublePull].y - 2.0f * world.velocities[normal].y) < 0.02f);

    CHECK(world.setGravityScale(-1, 1.0f) == -1);
}

void testFrozenPositionAxes() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = addFreeBox(world, 0.0f, 10.0f, 0.0f);
    CHECK(body >= 0);
    CHECK(world.setFlags(body, kBodyFreezePositionY | kBodyFreezePositionZ, 0) == 0);
    CHECK(world.bodies[body].flags == (kBodyFreezePositionY | kBodyFreezePositionZ));
    CHECK(world.setVelocity(body, 1.0f, 1.0f, 1.0f) == 0);

    const float dt = 1.0f / 60.0f;
    for (int32_t i = 0; i < 10; ++i) {
        world.step(dt, 4, 2);
    }

    CHECK(near(world.transforms[body].px, 10.0f * dt, 1e-4f));
    CHECK(world.transforms[body].py == 10.0f);
    CHECK(world.transforms[body].pz == 0.0f);
    CHECK(world.velocities[body].x == 1.0f);
    CHECK(world.velocities[body].y == 0.0f);
    CHECK(world.velocities[body].z == 0.0f);

    CHECK(world.setFlags(body, 0, kBodyFreezePositionY) == 0);
    CHECK(world.bodies[body].flags == kBodyFreezePositionZ);
    CHECK(world.setFlags(body, 64 | 128, 0) == 0);
    CHECK(world.bodies[body].flags == (64 | 128 | kBodyFreezePositionZ));
    CHECK(world.setFlags(body, -1, 0) == -1);
    CHECK(world.setFlags(body, 0, -1) == -1);
    CHECK(world.setFlags(999, 1, 0) == -1);
}

void testFrozenRotationAxes() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = addFreeBox(world, 0.0f, 10.0f, 0.0f);
    CHECK(body >= 0);
    CHECK(world.setFlags(body, kBodyFreezeRotationX | kBodyFreezeRotationZ, 0) == 0);
    CHECK(world.setAngularVelocity(body, 1.0f, 2.0f, 1.0f) == 0);

    for (int32_t i = 0; i < 10; ++i) {
        world.step(1.0f / 60.0f, 4, 2);
    }

    CHECK(world.angularVelocities[body].x == 0.0f);
    CHECK(world.angularVelocities[body].y == 2.0f);
    CHECK(world.angularVelocities[body].z == 0.0f);

    const Transform& transform = world.transforms[body];
    CHECK(transform.qx == 0.0f);
    CHECK(transform.qz == 0.0f);
    CHECK(fabsf(transform.qy) > 1e-4f);
    CHECK(near(transform.qy * transform.qy + transform.qw * transform.qw, 1.0f, 1e-4f));

    CHECK(world.setFlags(body, 0, kBodyFreezeRotationX | kBodyFreezeRotationY | kBodyFreezeRotationZ) == 0);
    CHECK(world.bodies[body].flags == 0);
}

void testForceAppliedPerStep() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = addFreeBox(world, 0.0f, 10.0f, 0.0f);
    CHECK(body >= 0);
    CHECK(world.bodies[body].invMass == 1.0f);
    CHECK(world.applyForce(body, 60.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.bodies[body].forceAccum.x == 60.0f);
    CHECK(world.applyForce(body, 0.0f, kFloatMax * 10.0f, 0.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.applyForce(body, kFloatMax * 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f) == -1);

    const float dt = 1.0f / 60.0f;
    world.step(dt, 4, 2);
    CHECK(near(world.velocities[body].x, 60.0f * dt * 1.0f, 1e-5f));
    CHECK(world.bodies[body].forceAccum.x == 0.0f);
    CHECK(world.bodies[body].forceAccum.y == 0.0f);
    CHECK(world.bodies[body].torqueAccum.y == 0.0f);

    world.step(dt, 4, 2);
    CHECK(near(world.velocities[body].x, 1.0f, 1e-6f));

    const int32_t staticBody = world.createBody(kBodyTypeStatic, 8.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t kinematicBody = world.createBody(kBodyTypeKinematic, 9.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(staticBody >= 0);
    CHECK(kinematicBody >= 0);
    CHECK(world.setBox(staticBody, 0.5f, 0.5f, 0.5f, 0.0f) == 0);
    CHECK(world.setBox(kinematicBody, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.applyForce(staticBody, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.applyForce(kinematicBody, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.applyTorque(kinematicBody, 0.0f, 1.0f, 0.0f) == -1);
    CHECK(world.applyImpulse(kinematicBody, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.applyAngularImpulse(staticBody, 0.0f, 1.0f, 0.0f) == -1);
    CHECK(world.applyForce(999, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f) == -1);

    CHECK(world.applyTorque(body, 0.0f, 0.0f, 6.0f) == 0);
    CHECK(world.bodies[body].torqueAccum.z == 6.0f);
    world.step(dt, 4, 2);
    CHECK(near(world.angularVelocities[body].z, 6.0f * dt * world.bodies[body].invInertia.z, 1e-5f));
    CHECK(world.bodies[body].torqueAccum.z == 0.0f);
}

void testImpulseAtOffset() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = addFreeBox(world, 0.0f, 10.0f, 0.0f);
    CHECK(body >= 0);
    CHECK(world.applyImpulse(body, 0.0f, 0.0f, 10.0f, 1.0f, 0.0f, 0.0f) == 0);
    CHECK(world.velocities[body].z == 10.0f);
    CHECK(near(world.angularVelocities[body].y, -10.0f * world.bodies[body].invInertia.y, 1e-3f));

    CHECK(world.applyAngularImpulse(body, 0.0f, 10.0f, 0.0f) == 0);
    CHECK(near(world.angularVelocities[body].y, 0.0f, 1e-3f));
    CHECK(world.applyImpulse(body, kFloatMax * 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.applyAngularImpulse(body, 0.0f, kFloatMax * 10.0f, 0.0f) == -1);
}

void testMassOverride() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = addFreeBox(world, 0.0f, 10.0f, 0.0f);
    const int32_t reference = addFreeBox(world, 3.0f, 10.0f, 0.0f);
    CHECK(body >= 0 && reference >= 0);
    CHECK(world.bodies[body].invMass == 1.0f);

    CHECK(world.setMassData(body, 2.0f, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.bodies[body].customMass == 2.0f);
    CHECK(world.bodies[body].invMass == 0.5f);

    CHECK(world.addSphere(body, 0.5f, 1.0f, 1.0f, 0.0f, 0.0f) == 1);
    CHECK(world.bodies[body].invMass == 0.5f);

    CHECK(world.setMassData(body, 4.0f, 1.0f, 0.0f, 2.0f) == 0);
    CHECK(world.bodies[body].invMass == 0.25f);
    CHECK(world.bodies[body].invInertia.x == 1.0f);
    CHECK(world.bodies[body].invInertia.z == 0.5f);
    CHECK(world.bodies[body].invInertia.y > 0.0f);

    CHECK(world.addBox(body, 0.25f, 0.25f, 0.25f, 1.0f, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 2);
    CHECK(world.bodies[body].invMass == 0.25f);
    CHECK(world.bodies[body].invInertia.x == 1.0f);
    CHECK(world.bodies[body].invInertia.z == 0.5f);

    CHECK(world.setMassData(body, kFloatMax * 10.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.setMassData(body, 1.0f, kFloatMax * 10.0f, 0.0f, 0.0f) == -1);
    CHECK(world.bodies[body].invMass == 0.25f);
    CHECK(world.setMassData(body, 0.0f, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.bodies[body].customMass == 0.0f);
    CHECK(world.bodies[body].invMass > 0.0f);

    CHECK(world.addSphere(reference, 0.5f, 1.0f, 1.0f, 0.0f, 0.0f) == 1);
    CHECK(world.addBox(reference, 0.25f, 0.25f, 0.25f, 1.0f, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 2);
    CHECK(world.bodies[body].invMass == world.bodies[reference].invMass);
    CHECK(world.bodies[body].invInertia.x == world.bodies[reference].invInertia.x);
    CHECK(world.bodies[body].invInertia.y == world.bodies[reference].invInertia.y);
    CHECK(world.bodies[body].invInertia.z == world.bodies[reference].invInertia.z);

    const int32_t staticBody = world.createBody(kBodyTypeStatic, 6.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t kinematicBody = world.createBody(kBodyTypeKinematic, 7.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(staticBody, 0.5f, 0.5f, 0.5f, 0.0f) == 0);
    CHECK(world.setBox(kinematicBody, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setMassData(staticBody, 5.0f, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.setMassData(kinematicBody, 5.0f, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.bodies[staticBody].invMass == 0.0f);
    CHECK(world.bodies[kinematicBody].invMass == 0.0f);
    CHECK(world.bodies[staticBody].customMass == 0.0f);
    CHECK(world.bodies[kinematicBody].customMass == 0.0f);
    CHECK(world.setMassData(999, 1.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.setMassData(body, kFloatMax, kFloatMax, 0.0f, 0.0f) == 0);
    CHECK(world.bodies[body].invMass > 0.0f);
}

void testKinematicDampingKeepsMotion() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeKinematic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    CHECK(world.setBox(body, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setDamping(body, 0.5f, 0.0f) == 0);
    CHECK(world.setVelocity(body, 1.0f, 0.0f, 0.0f) == 0);
    CHECK(world.setGravityScale(body, 3.0f) == 0);

    const float dt = 1.0f / 60.0f;
    world.step(dt, 4, 2);
    CHECK(near(world.velocities[body].x, 1.0f - 0.5f * dt, 1e-6f));
    CHECK(world.transforms[body].py == 10.0f);
    CHECK(world.velocities[body].y == 0.0f);
}

void testDynamicsDefaultsAndReset() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = addFreeBox(world, 0.0f, 10.0f, 0.0f);
    CHECK(body >= 0);
    CHECK(world.bodies[body].linearDamping == 0.0f);
    CHECK(world.bodies[body].angularDamping == 0.0f);
    CHECK(world.bodies[body].gravityScale == 1.0f);
    CHECK(world.bodies[body].flags == 0);
    CHECK(world.bodies[body].customMass == 0.0f);

    CHECK(world.setMassData(body, 3.0f, 2.0f, 2.0f, 2.0f) == 0);
    CHECK(world.applyForce(body, 1.0f, 0.0f, 0.0f, 0.0f, 1.0f, 0.0f) == 0);
    CHECK(world.destroyBody(body) == 0);

    const int32_t reused = addFreeBox(world, 0.0f, 10.0f, 0.0f);
    CHECK(reused == body);
    CHECK(world.bodies[reused].customMass == 0.0f);
    CHECK(world.bodies[reused].gravityScale == 1.0f);
    CHECK(world.bodies[reused].flags == 0);
    CHECK(world.bodies[reused].forceAccum.x == 0.0f);
    CHECK(world.bodies[reused].torqueAccum.x == 0.0f);
    CHECK(world.bodies[reused].invMass == 1.0f);
}

int32_t addSleepGround(World& world) {
    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);
    return ground;
}

int32_t addSettledBox(World& world) {
    const int32_t box = world.createBody(kBodyTypeDynamic, 0.0f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(box >= 0);
    CHECK(world.setBox(box, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setMaterial(box, 0.7f, 0.0f) == 0);
    return box;
}

bool settleToSleep(World& world, int32_t id, int32_t steps) {
    for (int32_t i = 0; i < steps; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
        if (world.isSleeping(id) == 1) {
            return true;
        }
    }
    return false;
}

void testSleepDefaultsOff() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.allowSleep == 0);
    CHECK(world.setAllowSleep(2) == -1);
    CHECK(world.setAllowSleep(-1) == -1);

    addSleepGround(world);
    const int32_t box = addSettledBox(world);
    CHECK(world.bodies[box].awake == 1);
    CHECK(world.bodies[box].sleepTime == 0.0f);
    CHECK(world.isSleeping(box) == 0);

    for (int32_t i = 0; i < 600; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }
    CHECK(world.bodies[box].awake == 1);
    CHECK(world.bodies[box].sleepTime == 0.0f);
    CHECK(world.isSleeping(box) == 0);
}

void testSleepAfterRest() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.setAllowSleep(1) == 0);
    CHECK(world.allowSleep == 1);

    addSleepGround(world);
    const int32_t box = addSettledBox(world);
    CHECK(settleToSleep(world, box, 600));
    CHECK(world.isSleeping(box) == 1);
    CHECK(world.bodies[box].awake == 0);
    CHECK(world.bodies[box].sleepTime >= kSleepTimeLimit);
    CHECK(world.velocities[box].x == 0.0f && world.velocities[box].y == 0.0f && world.velocities[box].z == 0.0f);
    CHECK(world.angularVelocities[box].x == 0.0f && world.angularVelocities[box].y == 0.0f && world.angularVelocities[box].z == 0.0f);

    const Transform frozen = world.transforms[box];
    for (int32_t i = 0; i < 120; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }
    CHECK(world.isSleeping(box) == 1);
    CHECK(world.transforms[box].px == frozen.px);
    CHECK(world.transforms[box].py == frozen.py);
    CHECK(world.transforms[box].pz == frozen.pz);
    CHECK(world.transforms[box].qx == frozen.qx);
    CHECK(world.transforms[box].qy == frozen.qy);
    CHECK(world.transforms[box].qz == frozen.qz);
    CHECK(world.transforms[box].qw == frozen.qw);
    CHECK(world.velocities[box].x == 0.0f && world.velocities[box].y == 0.0f && world.velocities[box].z == 0.0f);
}

void testWakeOnImpulse() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.setAllowSleep(1) == 0);

    addSleepGround(world);
    const int32_t box = addSettledBox(world);
    CHECK(settleToSleep(world, box, 600));

    CHECK(world.applyImpulse(box, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.bodies[box].awake == 1);
    CHECK(world.bodies[box].sleepTime == 0.0f);
    CHECK(world.isSleeping(box) == 0);
    CHECK(world.velocities[box].y > 4.0f);

    world.step(1.0f / 60.0f, 8, 3);
    CHECK(world.isSleeping(box) == 0);
    CHECK(world.transforms[box].py > 0.45f);
}

void testWakeOnForceAndTorque() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.setAllowSleep(1) == 0);

    addSleepGround(world);
    const int32_t box = addSettledBox(world);
    CHECK(settleToSleep(world, box, 600));
    CHECK(world.applyForce(box, 50.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.bodies[box].awake == 1);
    CHECK(world.bodies[box].sleepTime == 0.0f);

    CHECK(settleToSleep(world, box, 600));
    CHECK(world.applyTorque(box, 0.0f, 10.0f, 0.0f) == 0);
    CHECK(world.bodies[box].awake == 1);

    CHECK(settleToSleep(world, box, 600));
    CHECK(world.applyAngularImpulse(box, 0.0f, 2.0f, 0.0f) == 0);
    CHECK(world.bodies[box].awake == 1);

    CHECK(settleToSleep(world, box, 600));
    CHECK(world.setTransform(box, 0.0f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.bodies[box].awake == 1);

    CHECK(settleToSleep(world, box, 600));
    CHECK(world.setVelocity(box, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.bodies[box].awake == 1);
}

void testWakeByFastDynamicNeighbor() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.setAllowSleep(1) == 0);

    addSleepGround(world);
    const int32_t sleeper = addSettledBox(world);
    CHECK(settleToSleep(world, sleeper, 600));

    const int32_t striker = world.createBody(kBodyTypeDynamic, 2.5f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(striker >= 0);
    CHECK(world.setBox(striker, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setMaterial(striker, 0.0f, 0.0f) == 0);
    CHECK(world.setVelocity(striker, -4.0f, 0.0f, 0.0f) == 0);

    bool woke = false;
    for (int32_t i = 0; i < 180; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
        if (world.isSleeping(sleeper) == 0) {
            woke = true;
            break;
        }
    }
    CHECK(woke);
    CHECK(world.bodies[sleeper].awake == 1);
    CHECK(world.bodies[sleeper].sleepTime == 0.0f);
}

void testKinematicWakesSleepingBody() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.setAllowSleep(1) == 0);

    addSleepGround(world);
    const int32_t sleeper = addSettledBox(world);
    CHECK(settleToSleep(world, sleeper, 600));

    const int32_t platform = world.createBody(kBodyTypeKinematic, 4.0f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(platform >= 0);
    CHECK(world.setBox(platform, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setVelocity(platform, -2.0f, 0.0f, 0.0f) == 0);

    bool woke = false;
    for (int32_t i = 0; i < 240; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
        if (world.isSleeping(sleeper) == 0) {
            woke = true;
            break;
        }
    }
    CHECK(woke);
    CHECK(world.bodies[platform].awake == 1);
    CHECK(world.isSleeping(platform) == 0);
}

void testAwakeApiValidation() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t ground = addSleepGround(world);
    const int32_t box = addSettledBox(world);
    const int32_t platform = world.createBody(kBodyTypeKinematic, 2.0f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(platform >= 0);

    CHECK(world.setAwake(-1, 1) == -1);
    CHECK(world.setAwake(999, 1) == -1);
    CHECK(world.setAwake(box, 2) == -1);
    CHECK(world.setAwake(box, -1) == -1);
    CHECK(world.setAwake(ground, 0) == -1);
    CHECK(world.setAwake(platform, 0) == -1);
    CHECK(world.isSleeping(-1) == -1);
    CHECK(world.isSleeping(999) == -1);
    CHECK(world.isSleeping(ground) == 0);
    CHECK(world.isSleeping(platform) == 0);

    CHECK(world.setAllowSleep(1) == 0);
    CHECK(world.setAwake(box, 0) == 0);
    CHECK(world.isSleeping(box) == 1);
    CHECK(world.velocities[box].x == 0.0f && world.velocities[box].y == 0.0f && world.velocities[box].z == 0.0f);

    world.step(1.0f / 60.0f, 8, 3);
    CHECK(world.isSleeping(box) == 1);

    CHECK(world.setAwake(box, 1) == 0);
    CHECK(world.isSleeping(box) == 0);
    CHECK(world.bodies[box].sleepTime == 0.0f);
}

void testSleepResetClearsState() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.setAllowSleep(1) == 0);

    addSleepGround(world);
    const int32_t box = addSettledBox(world);
    CHECK(settleToSleep(world, box, 600));

    world.reset();
    CHECK(world.isSleeping(box) == -1);

    const int32_t fresh = addSettledBox(world);
    CHECK(fresh >= 0);
    CHECK(world.bodies[fresh].awake == 1);
    CHECK(world.bodies[fresh].sleepTime == 0.0f);
    CHECK(world.isSleeping(fresh) == 0);
}

void testSleepingBodiesSkipIntegration() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.setAllowSleep(1) == 0);

    addSleepGround(world);
    const int32_t sleeper = addSettledBox(world);
    CHECK(settleToSleep(world, sleeper, 600));

    const int32_t drifter = world.createBody(kBodyTypeDynamic, 6.0f, 6.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(drifter >= 0);
    CHECK(world.setBox(drifter, 0.5f, 0.5f, 0.5f, 1.0f) == 0);

    const float sleeperY = world.transforms[sleeper].py;
    world.step(1.0f / 60.0f, 8, 3);
    CHECK(world.transforms[sleeper].py == sleeperY);
    CHECK(world.transforms[drifter].py < 6.0f);
    CHECK(world.isSleeping(sleeper) == 1);
}

void testSleepDisableWakesEverything() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.setAllowSleep(1) == 0);

    addSleepGround(world);
    const int32_t box = addSettledBox(world);
    CHECK(settleToSleep(world, box, 600));

    CHECK(world.setAllowSleep(0) == 0);
    world.step(1.0f / 60.0f, 8, 3);
    CHECK(world.isSleeping(box) == 0);
    CHECK(world.bodies[box].awake == 1);
    CHECK(world.bodies[box].sleepTime == 0.0f);
}

void testShapeMaterialParity() {
    Arena arenaA;
    Arena arenaB;
    World worldA;
    World worldB;
    CHECK(initWorld(worldA, arenaA, g_memoryA, 16, 256));
    CHECK(initWorld(worldB, arenaB, g_memoryB, 16, 256));

    World* const worlds[2] = { &worldA, &worldB };
    int32_t grounds[2];
    int32_t boxes[2];
    for (int32_t w = 0; w < 2; ++w) {
        World& world = *worlds[w];
        grounds[w] = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        CHECK(grounds[w] >= 0);
        CHECK(world.setBox(grounds[w], 10.0f, 0.5f, 10.0f, 0.0f) == 0);
        boxes[w] = world.createBody(kBodyTypeDynamic, 0.0f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        CHECK(boxes[w] >= 0);
        CHECK(world.setBox(boxes[w], 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    }

    CHECK(worldA.bodies[boxes[0]].shapes[0].friction == kShapeMaterialInherit);
    CHECK(worldA.bodies[boxes[0]].shapes[0].restitution == kShapeMaterialInherit);
    CHECK(worldA.bodies[boxes[0]].shapes[0].categoryBits == kDefaultCategoryBits);
    CHECK(worldA.bodies[boxes[0]].shapes[0].maskBits == kDefaultMaskBits);
    CHECK(worldA.bodies[boxes[0]].shapes[0].groupIndex == 0);
    CHECK(worldA.bodies[boxes[0]].shapes[0].sensor == 0);

    CHECK(worldA.setShapeMaterial(grounds[0], 0, 1.0f, kShapeMaterialInherit) == 0);
    CHECK(worldA.setShapeMaterial(boxes[0], 0, 0.4f, 0.0f) == 0);
    CHECK(worldB.setMaterial(grounds[1], 1.0f, 0.0f) == 0);
    CHECK(worldB.setMaterial(boxes[1], 0.4f, 0.0f) == 0);

    CHECK(worldA.setShapeMaterial(boxes[0], 8, 0.5f, 0.5f) == -1);
    CHECK(worldA.setShapeMaterial(boxes[0], -1, 0.5f, 0.5f) == -1);
    CHECK(worldA.setShapeMaterial(999, 0, 0.5f, 0.5f) == -1);
    CHECK(worldA.setShapeMaterial(boxes[0], 0, -2.0f, 0.5f) == -1);
    CHECK(worldA.setShapeMaterial(boxes[0], 0, kFloatMax * 10.0f, 0.5f) == -1);

    CHECK(worldA.setVelocity(boxes[0], 2.0f, 0.0f, 0.0f) == 0);
    CHECK(worldB.setVelocity(boxes[1], 2.0f, 0.0f, 0.0f) == 0);

    for (int32_t i = 0; i < 120; ++i) {
        worldA.step(1.0f / 60.0f, 8, 3);
        worldB.step(1.0f / 60.0f, 8, 3);
    }

    CHECK(near(worldA.transforms[boxes[0]].px, 0.3389f, 0.010f));
    CHECK(worldA.transforms[boxes[0]].px == worldB.transforms[boxes[1]].px);
    CHECK(worldA.transforms[boxes[0]].py == worldB.transforms[boxes[1]].py);
    CHECK(worldA.velocities[boxes[0]].x == worldB.velocities[boxes[1]].x);
    CHECK(worldA.velocities[boxes[0]].y == worldB.velocities[boxes[1]].y);
    CHECK(memcmp(&worldA.velocities[boxes[0]], &worldB.velocities[boxes[1]], sizeof(Vec3)) == 0);

    CHECK(worldA.setShapeSensor(boxes[0], 0, 2) == -1);
    CHECK(worldA.setShapeSensor(boxes[0], 0, 1) == 0);
    CHECK(worldA.bodies[boxes[0]].shapes[0].sensor == 1);
    CHECK(worldA.setShapeSensor(boxes[0], 0, 0) == 0);
    CHECK(worldA.bodies[boxes[0]].shapes[0].sensor == 0);

    const float invMassBefore = worldA.bodies[boxes[0]].invMass;
    CHECK(worldA.setShapeSensor(boxes[0], 0, 1) == 0);
    CHECK(worldA.bodies[boxes[0]].invMass == invMassBefore);
}

void setupFilterPair(World& world, int32_t& first, int32_t& second) {
    first = world.createBody(kBodyTypeDynamic, -0.05f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    second = world.createBody(kBodyTypeDynamic, 0.05f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(first >= 0 && second >= 0);
    CHECK(world.setSphere(first, 0.1f, 1.0f) == 0);
    CHECK(world.setSphere(second, 0.1f, 1.0f) == 0);
}

void testShapeFilterReject() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    int32_t first = -1;
    int32_t second = -1;
    setupFilterPair(world, first, second);

    world.step(1.0f / 60.0f, 4, 2);
    CHECK(world.getContactCount() >= 1);
    for (int32_t i = 0; i < 120; ++i) {
        world.step(1.0f / 60.0f, 4, 2);
    }

    CHECK(world.setShapeFilter(first, 0, 1, 0x0002, 0) == 0);
    CHECK(world.setShapeFilter(second, 0, 4, 1, 0) == 0);
    CHECK(world.setShapeFilter(first, 8, 1, 1, 0) == -1);
    CHECK(world.setShapeFilter(999, 0, 1, 1, 0) == -1);
    CHECK(world.setShapeFilter(second, 1, 1, 1, 0) == -1);

    const float firstXBefore = world.transforms[first].px;
    const float secondXBefore = world.transforms[second].px;
    for (int32_t i = 0; i < 60; ++i) {
        world.step(1.0f / 60.0f, 4, 2);
        CHECK(world.getContactCount() == 0);
    }
    CHECK(world.transforms[first].px == firstXBefore);
    CHECK(world.transforms[second].px == secondXBefore);
    CHECK(world.velocities[first].x == 0.0f);
    CHECK(world.velocities[second].x == 0.0f);

    CHECK(world.setShapeFilter(first, 0, 1, 4, 0) == 0);
    CHECK(world.setShapeFilter(second, 0, 1, 0, 0) == 0);
    world.step(1.0f / 60.0f, 4, 2);
    CHECK(world.getContactCount() == 0);
}

void testShapeFilterGroups() {
    struct GroupCase {
        int32_t groupFirst;
        int32_t groupSecond;
        int32_t maskBits;
        int32_t expectContacts;
    };

    const GroupCase cases[3] = {
        { 2, 2, 0, 1 },
        { -2, -2, 0, 0 },
        { 2, -2, kDefaultMaskBits, 1 },
    };

    unsigned char* memories[3] = { g_memoryA, g_memoryB, g_memoryA };
    for (int32_t c = 0; c < 3; ++c) {
        Arena arena;
        World world;
        CHECK(initGravitylessWorld(world, arena, memories[c], 16, 256));

        int32_t first = -1;
        int32_t second = -1;
        setupFilterPair(world, first, second);
        CHECK(world.setShapeFilter(first, 0, 1, cases[c].maskBits, cases[c].groupFirst) == 0);
        CHECK(world.setShapeFilter(second, 0, 1, cases[c].maskBits, cases[c].groupSecond) == 0);

        world.step(1.0f / 60.0f, 4, 2);
        if (cases[c].expectContacts != 0) {
            CHECK(world.getContactCount() >= 1);
        } else {
            CHECK(world.getContactCount() == 0);
            CHECK(world.transforms[first].px == -0.05f);
            CHECK(world.transforms[second].px == 0.05f);
        }
    }
}

void testSensorContactTransfersNoImpulse() {
    Arena arenaA;
    Arena arenaB;
    World worldA;
    World worldB;
    CHECK(initGravitylessWorld(worldA, arenaA, g_memoryA, 16, 256));
    CHECK(initGravitylessWorld(worldB, arenaB, g_memoryB, 16, 256));

    const int32_t visitorA = worldA.createBody(kBodyTypeDynamic, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t visitorB = worldB.createBody(kBodyTypeDynamic, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(visitorA >= 0 && visitorB >= 0);
    CHECK(worldA.setSphere(visitorA, 0.5f, 1.0f) == 0);
    CHECK(worldB.setSphere(visitorB, 0.5f, 1.0f) == 0);

    const int32_t trigger = worldB.createBody(kBodyTypeStatic, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(trigger >= 0);
    CHECK(worldB.setSphere(trigger, 0.5f, 0.0f) == 0);
    CHECK(worldB.setShapeSensor(trigger, 0, 1) == 0);
    CHECK(worldB.bodies[trigger].invMass == 0.0f);

    CHECK(worldA.setVelocity(visitorA, 1.0f, 0.0f, 0.0f) == 0);
    CHECK(worldB.setVelocity(visitorB, 1.0f, 0.0f, 0.0f) == 0);

    bool generated = false;
    for (int32_t i = 0; i < 240; ++i) {
        worldA.step(1.0f / 60.0f, 8, 3);
        worldB.step(1.0f / 60.0f, 8, 3);
        if (worldB.getContactCount() > 0) {
            generated = true;
        }
    }

    CHECK(generated);
    CHECK(worldB.getContactCount() == 0);
    CHECK(worldB.transforms[visitorB].px > 2.5f);
    CHECK(memcmp(&worldA.velocities[visitorA], &worldB.velocities[visitorB], sizeof(Vec3)) == 0);
    CHECK(memcmp(&worldA.angularVelocities[visitorA], &worldB.angularVelocities[visitorB], sizeof(Vec3)) == 0);
    CHECK(worldA.transforms[visitorA].px == worldB.transforms[visitorB].px);
    CHECK(worldB.transforms[trigger].px == 1.0f);

    const float visitorMassBefore = worldB.bodies[visitorB].invMass;
    CHECK(worldB.setShapeSensor(visitorB, 0, 1) == 0);
    CHECK(worldB.bodies[visitorB].invMass == visitorMassBefore);
}

void testShapeIdLifecycle() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    CHECK(world.addSphere(body, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.addBox(body, 0.5f, 0.5f, 0.5f, 1.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 1);
    CHECK(world.addSphere(body, 0.25f, 1.0f, -1.0f, 0.0f, 0.0f) == 2);

    const int32_t id0 = world.shapeMakeId(body, 0);
    const int32_t id1 = world.shapeMakeId(body, 1);
    const int32_t id2 = world.shapeMakeId(body, 2);
    CHECK(id0 >= 0 && id1 >= 0 && id2 >= 0);
    CHECK(id0 <= kShapeIdMax && id1 <= kShapeIdMax && id2 <= kShapeIdMax);
    CHECK(shapeDecodeSlot(id0) == 0 && shapeDecodeSlot(id1) == 1 && shapeDecodeSlot(id2) == 2);
    CHECK(shapeDecodeBodyId(id0) == body && shapeDecodeBodyId(id2) == body);

    int32_t resolvedBody = -1;
    int32_t resolvedSlot = -1;
    CHECK(world.shapeIdResolve(id1, resolvedBody, resolvedSlot));
    CHECK(resolvedBody == body && resolvedSlot == 1);
    CHECK(shapeTypeCode(world.bodies[body].shapes[0].kind) == 5);
    CHECK(shapeTypeCode(world.bodies[body].shapes[1].kind) == 3);
    CHECK(shapeTypeCode(world.bodies[body].shapes[2].kind) == 5);

    CHECK(world.shapeDestroy(id1) == 0);
    CHECK(world.shapeIdResolve(id1, resolvedBody, resolvedSlot) == false);
    CHECK(world.shapeIdResolve(id0, resolvedBody, resolvedSlot));
    CHECK(world.shapeIdResolve(id2, resolvedBody, resolvedSlot));
    CHECK(world.shapeDestroy(id1) == -1);
    CHECK(world.setShapeSensor(body, 1, 1) == -1);
    CHECK(world.bodies[body].shapeCount == 3);

    const int32_t reusedSlot = world.addSphere(body, 0.5f, 1.0f, 0.0f, 1.0f, 0.0f);
    CHECK(reusedSlot == 1);
    const int32_t freshId = world.shapeMakeId(body, 1);
    CHECK(freshId != id1);
    CHECK(world.shapeIdResolve(freshId, resolvedBody, resolvedSlot));
    CHECK(shapeDecodeGeneration(freshId) != shapeDecodeGeneration(id1));

    const int32_t forged = shapeEncodeId(shapeDecodeGeneration(id0) ^ 0x1FF, shapeDecodeBodyId(id0), shapeDecodeSlot(id0));
    CHECK(world.shapeIdResolve(forged, resolvedBody, resolvedSlot) == false);
    CHECK(world.shapeIdResolve(-1, resolvedBody, resolvedSlot) == false);
    CHECK(world.shapeIdResolve(-2, resolvedBody, resolvedSlot) == false);
    CHECK(world.shapeIdResolve(0x7FFFFFFF, resolvedBody, resolvedSlot) == false);
    CHECK(world.shapeMakeId(999, 0) == -1);
    CHECK(world.shapeMakeId(body, 8) == -1);

    CHECK(world.setSphere(body, 0.4f, 1.0f) == 0);
    CHECK(world.shapeIdResolve(id0, resolvedBody, resolvedSlot) == false);
    CHECK(world.shapeIdResolve(freshId, resolvedBody, resolvedSlot) == false);
    CHECK(world.shapeIdResolve(id2, resolvedBody, resolvedSlot) == false);
    CHECK(world.bodies[body].shapeCount == 1);

    const int32_t slot0Id = world.shapeMakeId(body, 0);
    CHECK(world.shapeIdResolve(slot0Id, resolvedBody, resolvedSlot));
    CHECK(world.destroyBody(body) == 0);
    CHECK(world.shapeIdResolve(slot0Id, resolvedBody, resolvedSlot) == false);

    const int32_t recreated = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(recreated == body);
    CHECK(world.shapeIdResolve(slot0Id, resolvedBody, resolvedSlot) == false);
    CHECK(world.addSphere(body, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f) == 0);
    const int32_t newId0 = world.shapeMakeId(body, 0);
    CHECK(newId0 != slot0Id);
    CHECK(world.shapeIdResolve(newId0, resolvedBody, resolvedSlot));

    CHECK(world.shapeClear(body) == 0);
    CHECK(world.bodies[body].shapeCount == 0);
    CHECK(world.shapeIdResolve(newId0, resolvedBody, resolvedSlot) == false);
    CHECK(world.addBox(body, 0.5f, 0.5f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    const int32_t afterClearId = world.shapeMakeId(body, 0);
    CHECK(afterClearId != newId0);
    CHECK(world.shapeIdResolve(afterClearId, resolvedBody, resolvedSlot));
    CHECK(world.shapeClear(999) == -1);

    int32_t lastValidId = -1;
    for (int32_t slot = 1; slot < kMaxShapesPerBody; ++slot) {
        CHECK(world.addSphere(body, 0.1f, 1.0f, 0.0f, 0.0f, 0.0f) == slot);
        lastValidId = world.shapeMakeId(body, slot);
    }
    CHECK(world.bodies[body].shapeCount == kMaxShapesPerBody);
    CHECK(world.addSphere(body, 0.1f, 1.0f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.shapeDestroy(lastValidId) == 0);
    CHECK(world.bodies[body].shapeCount == kMaxShapesPerBody - 1);
    CHECK(world.shapeDestroy(lastValidId) == -1);
}

void testAddRollbackKeepsHighWater() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    CHECK(world.addSphere(body, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f) == 0);
    CHECK(world.addSphere(body, 0.5f, 1.0f, 1.0f, 0.0f, 0.0f) == 1);
    const int32_t holedId = world.shapeMakeId(body, 1);
    CHECK(world.addSphere(body, 0.5f, 1.0f, 2.0f, 0.0f, 0.0f) == 2);
    const int32_t tailId = world.shapeMakeId(body, 2);
    CHECK(world.shapeDestroy(holedId) == 0);
    CHECK(world.bodies[body].shapeCount == 3);

    const float invMassBefore = world.bodies[body].invMass;
    CHECK(world.addSphere(body, 1.0e20f, 1.0e10f, 0.0f, 0.0f, 0.0f) == -1);
    CHECK(world.bodies[body].shapeCount == 3);
    CHECK(world.bodies[body].invMass == invMassBefore);
    CHECK(shapeValid(world.bodies[body].shapes[0]));
    CHECK(!shapeValid(world.bodies[body].shapes[1]));
    CHECK(shapeValid(world.bodies[body].shapes[2]));
    int32_t resolvedBody = -1;
    int32_t resolvedSlot = -1;
    CHECK(world.shapeIdResolve(tailId, resolvedBody, resolvedSlot));

    CHECK(world.addBox(body, 0.5f, 0.5f, 0.5f, 1.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 1);
    CHECK(world.bodies[body].shapeCount == 3);
    CHECK(!world.shapeIdResolve(holedId, resolvedBody, resolvedSlot));

    const float refilledMass = world.bodies[body].invMass;
    CHECK(world.addBox(body, 1.0e20f, 0.5f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.bodies[body].shapeCount == 3);
    CHECK(world.bodies[body].invMass == refilledMass);
    CHECK(shapeValid(world.bodies[body].shapes[1]));
}

}

void testCapsuleMassAndInertia() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    const float radius = 0.3f;
    const float halfSegment = 0.4f;
    const float density = 1.5f;
    CHECK(world.addCapsule(body, radius, halfSegment, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    const float segmentLength = 2.0f * halfSegment;
    const float cylinderMass = density * kPi * radius * radius * segmentLength;
    const float capMass = density * kSphereVolume * radius * radius * radius;
    const float mass = cylinderMass + capMass;
    const float inertiaY = 0.5f * cylinderMass * radius * radius + 2.0f * kSphereInertia * capMass * radius * radius;
    const float twelfth = 1.0f / 12.0f;
    const float inertiaX = cylinderMass * (3.0f * radius * radius + segmentLength * segmentLength) * twelfth +
                           2.0f * (kSphereInertia * capMass * radius * radius + capMass * halfSegment * halfSegment);

    CHECK(near(1.0f / world.bodies[body].invMass, mass, mass * 1e-4f));
    CHECK(near(1.0f / world.bodies[body].invInertia.x, inertiaX, inertiaX * 1e-4f));
    CHECK(near(1.0f / world.bodies[body].invInertia.y, inertiaY, inertiaY * 1e-4f));
    CHECK(near(1.0f / world.bodies[body].invInertia.z, inertiaX, inertiaX * 1e-4f));

    CHECK(world.addCapsule(999, radius, halfSegment, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addCapsule(body, -1.0f, halfSegment, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addCapsule(body, radius, -0.001f, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addCapsule(body, radius, halfSegment, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addCapsule(body, radius, kFloatMax * 2.0f, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
}

void testCapsuleAabb() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeStatic, 1.0f, 2.0f, 3.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    CHECK(world.addCapsule(body, 0.2f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.step(1.0f / 60.0f, 1, 1) >= 0);
    CHECK(near(world.bodies[body].aabb.minX, 0.8f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxX, 1.2f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.minY, 1.3f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxY, 2.7f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.minZ, 2.8f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxZ, 3.2f, 1e-5f));

    const float yaw90 = 0.7071067811865476f;
    CHECK(world.addCapsule(body, 0.2f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, yaw90, yaw90) == 1);
    CHECK(world.step(1.0f / 60.0f, 1, 1) >= 0);
    CHECK(near(world.bodies[body].aabb.minX, 0.3f, 1e-4f));
    CHECK(near(world.bodies[body].aabb.maxX, 1.7f, 1e-4f));
    CHECK(near(world.bodies[body].aabb.minY, 1.3f, 1e-4f));
    CHECK(near(world.bodies[body].aabb.maxY, 2.7f, 1e-4f));
}

void testCapsuleRestsOnBox() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 64, 2048));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t capsule = world.createBody(kBodyTypeDynamic, 0.0f, 1.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(capsule >= 0);
    CHECK(world.addCapsule(capsule, 0.25f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.setMaterial(capsule, 0.7f, 0.0f) == 0);

    float minPy = kFloatMax;
    float maxPy = -kFloatMax;
    for (int32_t i = 0; i < 240; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
        if (i >= 228) {
            const float py = world.transforms[capsule].py;
            if (py < minPy) {
                minPy = py;
            }
            if (py > maxPy) {
                maxPy = py;
            }
        }
    }

    const float py = world.transforms[capsule].py;
    CHECK(isFinite(py));
    CHECK(py > 0.725f && py < 0.752f);
    CHECK(maxPy - minPy < 0.002f);
    CHECK(lengthSq(world.velocities[capsule]) < 0.01f);
    CHECK(world.getContactCount() >= 1);
}

void testCapsuleCapsuleStacking() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 64, 2048));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t lower = world.createBody(kBodyTypeDynamic, 0.0f, 0.8f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(lower >= 0);
    CHECK(world.addCapsule(lower, 0.2f, 0.4f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.setMaterial(lower, 0.7f, 0.0f) == 0);

    const int32_t upper = world.createBody(kBodyTypeDynamic, 0.0f, 1.9f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(upper >= 0);
    CHECK(world.addCapsule(upper, 0.2f, 0.4f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.setMaterial(upper, 0.7f, 0.0f) == 0);

    for (int32_t i = 0; i < 240; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    const float lowerPy = world.transforms[lower].py;
    const float upperPy = world.transforms[upper].py;
    CHECK(isFinite(lowerPy) && isFinite(upperPy));
    CHECK(lowerPy > 0.52f && lowerPy < 0.61f);
    CHECK(upperPy > lowerPy);
    CHECK(near(upperPy - lowerPy, 1.2f, 0.04f));
    CHECK(lengthSq(world.velocities[upper]) < 0.01f);
    CHECK(world.getContactCount() >= 1);
}

void testCapsuleSphereContact() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t capsule = world.createBody(kBodyTypeDynamic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(capsule >= 0);
    CHECK(world.addCapsule(capsule, 0.2f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    const int32_t sphere = world.createBody(kBodyTypeStatic, 0.3f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(sphere >= 0);
    CHECK(world.setSphere(sphere, 0.2f, 0.0f) == 0);

    CHECK(world.step(1.0f / 60.0f, 4, 2) == 1);
    CHECK(world.getContactCount() >= 1);
    const PackedContact& contact = world.packedContacts[0];
    CHECK(near(contact.nx, 1.0f, 1e-4f) || near(contact.nx, -1.0f, 1e-4f));
    CHECK(contact.pen > 0.03f && contact.pen <= 0.1001f);
}

void testCapsuleBoxSideContact() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t capsule = world.createBody(kBodyTypeDynamic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(capsule >= 0);
    CHECK(world.addCapsule(capsule, 0.2f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    const int32_t box = world.createBody(kBodyTypeStatic, 0.35f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(box >= 0);
    CHECK(world.setBox(box, 0.2f, 0.2f, 0.2f, 0.0f) == 0);

    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 1);
    CHECK(world.getContactCount() >= 1);
    const PackedContact& contact = world.packedContacts[0];
    CHECK(near(contact.nx, 1.0f, 1e-4f) || near(contact.nx, -1.0f, 1e-4f));
}

void testCylinderMassAndAabb() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    const float radius = 0.4f;
    const float halfHeight = 0.6f;
    const float density = 2.0f;
    CHECK(world.addCylinder(body, radius, halfHeight, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    const float fullHeight = 2.0f * halfHeight;
    const float mass = density * kPi * radius * radius * fullHeight;
    const float inertiaY = 0.5f * mass * radius * radius;
    const float inertiaX = mass * (3.0f * radius * radius + fullHeight * fullHeight) * (1.0f / 12.0f);

    CHECK(near(1.0f / world.bodies[body].invMass, mass, mass * 1e-4f));
    CHECK(near(1.0f / world.bodies[body].invInertia.x, inertiaX, inertiaX * 1e-4f));
    CHECK(near(1.0f / world.bodies[body].invInertia.y, inertiaY, inertiaY * 1e-4f));
    CHECK(near(1.0f / world.bodies[body].invInertia.z, inertiaX, inertiaX * 1e-4f));

    CHECK(world.step(1.0f / 60.0f, 1, 1) >= 0);
    CHECK(near(world.bodies[body].aabb.minX, -radius, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxX, radius, 1e-5f));
    CHECK(near(world.bodies[body].aabb.minY, 4.4f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxY, 5.6f, 1e-5f));
    CHECK(near(world.bodies[body].aabb.minZ, -radius, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxZ, radius, 1e-5f));

    CHECK(world.addCylinder(body, radius, 0.0f, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addCylinder(body, 0.0f, halfHeight, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addCylinder(body, radius, halfHeight, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
}

void testCylinderRestsOnBox() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 64, 2048));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t cylinder = world.createBody(kBodyTypeDynamic, 0.0f, 1.2f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(cylinder >= 0);
    CHECK(world.addCylinder(cylinder, 0.3f, 0.4f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.setMaterial(cylinder, 0.7f, 0.0f) == 0);

    for (int32_t i = 0; i < 240; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    const float py = world.transforms[cylinder].py;
    CHECK(isFinite(py));
    CHECK(py > 0.375f && py < 0.402f);
    CHECK(lengthSq(world.velocities[cylinder]) < 0.01f);
    CHECK(world.getContactCount() >= 1);
}

void testCylinderSphereContact() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t cylinder = world.createBody(kBodyTypeDynamic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(cylinder >= 0);
    CHECK(world.addCylinder(cylinder, 0.3f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    const int32_t sphere = world.createBody(kBodyTypeStatic, 0.45f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(sphere >= 0);
    CHECK(world.setSphere(sphere, 0.2f, 0.0f) == 0);

    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 1);
    CHECK(world.getContactCount() >= 1);
    const PackedContact& contact = world.packedContacts[0];
    CHECK(near(contact.nx, 1.0f, 1e-4f) || near(contact.nx, -1.0f, 1e-4f));
    CHECK(contact.pen > 0.01f && contact.pen <= 0.0501f);
}

void testCylinderCapsuleContact() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t cylinder = world.createBody(kBodyTypeDynamic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(cylinder >= 0);
    CHECK(world.addCylinder(cylinder, 0.3f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    const int32_t capsule = world.createBody(kBodyTypeStatic, 0.45f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(capsule >= 0);
    CHECK(world.addCapsule(capsule, 0.2f, 0.4f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 1);
    CHECK(world.getContactCount() >= 1);
    const PackedContact& contact = world.packedContacts[0];
    CHECK(near(contact.nx, 1.0f, 1e-4f) || near(contact.nx, -1.0f, 1e-4f));
    CHECK(contact.pen > 0.01f && contact.pen <= 0.0501f);
}

void testShapeIdLifecycleNewKinds() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    CHECK(world.addCapsule(body, 0.3f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.addCylinder(body, 0.4f, 0.6f, 1.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 1);
    CHECK(world.addCone(body, 0.3f, 0.5f, 1.0f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 2);
    CHECK(world.addSphere(body, 0.2f, 1.0f, -1.0f, 0.0f, 0.0f) == 3);

    const int32_t capsuleId = world.shapeMakeId(body, 0);
    const int32_t cylinderId = world.shapeMakeId(body, 1);
    const int32_t coneId = world.shapeMakeId(body, 2);
    CHECK(capsuleId >= 0 && cylinderId >= 0 && coneId >= 0 && capsuleId != cylinderId && cylinderId != coneId);

    int32_t resolvedBody = -1;
    int32_t resolvedSlot = -1;
    CHECK(world.shapeIdResolve(capsuleId, resolvedBody, resolvedSlot));
    CHECK(resolvedBody == body && resolvedSlot == 0);
    CHECK(world.shapeIdResolve(cylinderId, resolvedBody, resolvedSlot));
    CHECK(resolvedBody == body && resolvedSlot == 1);
    CHECK(world.shapeIdResolve(coneId, resolvedBody, resolvedSlot));
    CHECK(resolvedBody == body && resolvedSlot == 2);

    CHECK(shapeTypeCode(world.bodies[body].shapes[0].kind) == kShapeTypeCodeCapsule);
    CHECK(shapeTypeCode(world.bodies[body].shapes[1].kind) == kShapeTypeCodeCylinder);
    CHECK(shapeTypeCode(world.bodies[body].shapes[2].kind) == kShapeTypeCodeCone);
    CHECK(shapeTypeCode(world.bodies[body].shapes[3].kind) == kShapeTypeCodeSphere);
    CHECK(world.bodies[body].shapes[0].kind == kShapeCapsule);
    CHECK(world.bodies[body].shapes[1].kind == kShapeCylinder);
    CHECK(world.bodies[body].shapes[2].kind == kShapeCone);

    CHECK(world.setShapeSensor(body, 0, 1) == 0);
    CHECK(world.bodies[body].shapes[0].sensor == 1);
    CHECK(world.setShapeFilter(body, 1, 2, 4, -3) == 0);
    CHECK(world.bodies[body].shapes[1].categoryBits == 2);

    CHECK(world.shapeDestroy(capsuleId) == 0);
    CHECK(!world.shapeIdResolve(capsuleId, resolvedBody, resolvedSlot));
    CHECK(world.shapeIdResolve(coneId, resolvedBody, resolvedSlot));
    CHECK(world.shapeDestroy(coneId) == 0);
    CHECK(!world.shapeIdResolve(coneId, resolvedBody, resolvedSlot));

    const int32_t refilledSlot = world.addCapsule(body, 0.25f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(refilledSlot == 0);
    const int32_t freshCapsuleId = world.shapeMakeId(body, 0);
    CHECK(freshCapsuleId != capsuleId);
    CHECK(world.shapeIdResolve(freshCapsuleId, resolvedBody, resolvedSlot));
    CHECK(shapeValid(world.bodies[body].shapes[0]));
}

void testConeMassAndAabb() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    const float radius = 0.4f;
    const float halfHeight = 0.6f;
    const float density = 2.0f;
    CHECK(world.addCone(body, radius, halfHeight, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    const float mass = density * (1.0f / 3.0f) * kPi * radius * radius * (2.0f * halfHeight);
    const float inertiaY = 0.3f * mass * radius * radius;
    const float inertiaX = 0.15f * mass * (radius * radius + halfHeight * halfHeight * (4.0f / 3.0f));

    CHECK(near(1.0f / world.bodies[body].invMass, mass, mass * 1e-4f));
    CHECK(near(1.0f / world.bodies[body].invInertia.y, inertiaY, inertiaY * 1e-4f));
    CHECK(near(1.0f / world.bodies[body].invInertia.x, inertiaX, inertiaX * 1e-4f));
    CHECK(near(1.0f / world.bodies[body].invInertia.z, inertiaX, inertiaX * 1e-4f));

    CHECK(world.step(1.0f / 60.0f, 1, 1) >= 0);
    CHECK(near(world.bodies[body].aabb.minX, -radius, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxX, radius, 1e-5f));
    CHECK(near(world.bodies[body].aabb.minY, 5.0f - halfHeight, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxY, 5.0f + halfHeight, 1e-5f));
    CHECK(near(world.bodies[body].aabb.minZ, -radius, 1e-5f));
    CHECK(near(world.bodies[body].aabb.maxZ, radius, 1e-5f));

    CHECK(world.addCone(body, radius, 0.0f, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addCone(body, 0.0f, halfHeight, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addCone(body, radius, halfHeight, -1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    CHECK(world.addCone(999, radius, halfHeight, density, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
}

void testConeRestsOnBox() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 64, 2048));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t cone = world.createBody(kBodyTypeDynamic, 0.0f, 1.2f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(cone >= 0);
    CHECK(world.addCone(cone, 0.3f, 0.4f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
    CHECK(world.setMaterial(cone, 0.7f, 0.0f) == 0);

    for (int32_t i = 0; i < 240; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    const float py = world.transforms[cone].py;
    CHECK(isFinite(py));
    CHECK(py > 0.375f && py < 0.415f);
    CHECK(lengthSq(world.velocities[cone]) < 0.01f);
    CHECK(world.getContactCount() >= 1);
}

void testCylinderCylinderStacking() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 64, 2048));
    world.setAllowSleep(1);

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(ground >= 0);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const float radius = 0.3f;
    const float halfHeight = 0.5f;
    const float columnY[3] = { 0.496f, 1.492f, 2.488f };
    int32_t stack[3];
    for (int32_t i = 0; i < 3; ++i) {
        stack[i] = world.createBody(kBodyTypeDynamic, 0.0f, columnY[i], 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        CHECK(stack[i] >= 0);
        CHECK(world.addCylinder(stack[i], radius, halfHeight, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);
        CHECK(world.setMaterial(stack[i], 0.7f, 0.0f) == 0);
        CHECK(world.setDamping(stack[i], 6.0f, 6.0f) == 0);
    }

    for (int32_t i = 0; i < 600; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    for (int32_t i = 0; i < 3; ++i) {
        const Transform& transform = world.transforms[stack[i]];
        CHECK(isFinite(transform.px) && isFinite(transform.py) && isFinite(transform.pz));
        CHECK(fabsf(transform.px) < 1e-3f);
        CHECK(fabsf(transform.pz) < 1e-3f);
        CHECK(fabsf(transform.qx) < 5e-3f);
        CHECK(fabsf(transform.qz) < 5e-3f);
    }

    const float lowerPy = world.transforms[stack[0]].py;
    const float middlePy = world.transforms[stack[1]].py;
    const float upperPy = world.transforms[stack[2]].py;
    CHECK(middlePy > lowerPy && upperPy > middlePy);
    CHECK(middlePy - lowerPy > 0.98f && middlePy - lowerPy < 0.995f);
    CHECK(upperPy - middlePy > 0.98f && upperPy - middlePy < 0.995f);
    CHECK(fabsf((upperPy - middlePy) - (middlePy - lowerPy)) < 2e-3f);
    CHECK(world.isSleeping(stack[2]) == 1);
}


void testCylinderBoxEdgeContact() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const float turn = 0.70710678f;
    const int32_t cylinder = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, turn, turn);
    CHECK(cylinder >= 0);
    CHECK(world.addCylinder(cylinder, 0.3f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    const int32_t box = world.createBody(kBodyTypeDynamic, 0.0f, 0.365f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(box >= 0);
    CHECK(world.setBox(box, 0.4f, 0.15f, 0.15f, 1.0f) == 0);

    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 2);
    int32_t pairContacts = 0;
    for (int32_t i = 0; i < world.getContactCount(); ++i) {
        const Contact& contact = world.contacts[i];
        if ((contact.a == cylinder && contact.b == box) || (contact.a == box && contact.b == cylinder)) {
            ++pairContacts;
        }
    }
    CHECK(pairContacts >= 2);
}

void testCapsuleCylinderTwoPointManifold() {
    Arena arena;
    World world;
    CHECK(initGravitylessWorld(world, arena, g_memoryA, 16, 256));

    const float turn = 0.70710678f;
    const int32_t cylinder = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, turn, turn);
    CHECK(cylinder >= 0);
    CHECK(world.addCylinder(cylinder, 0.3f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    const int32_t capsule = world.createBody(kBodyTypeDynamic, 0.0f, 0.46f, 0.0f, 0.0f, 0.0f, turn, turn);
    CHECK(capsule >= 0);
    CHECK(world.addCapsule(capsule, 0.2f, 0.4f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == 0);

    CHECK(world.step(1.0f / 60.0f, 4, 2) >= 2);
    int32_t pairContacts = 0;
    for (int32_t i = 0; i < world.getContactCount(); ++i) {
        const Contact& contact = world.contacts[i];
        if ((contact.a == cylinder && contact.b == capsule) || (contact.a == capsule && contact.b == cylinder)) {
            ++pairContacts;
        }
    }
    CHECK(pairContacts >= 2);
    CHECK(pairContacts <= 4);
}

float testSin(float angle) {
    const float square = angle * angle;
    return angle * (1.0f + square * (-0.16666667f + square * (0.00833333f + square * -0.00019841f)));
}

float testCos(float angle) {
    const float square = angle * angle;
    return 1.0f + square * (-0.5f + square * (0.04166667f + square * (-0.00138889f + square * 0.0000248f)));
}

float testAtan(float value) {
    const float reduced = value / (1.0f + sqrtf(1.0f + value * value));
    const float square = reduced * reduced;
    return 2.0f * reduced * (1.0f + square * (-0.33333333f + square * (0.2f + square * -0.14285714f)));
}

float testAtan2(float y, float x) {
    if (x == 0.0f && y == 0.0f) {
        return 0.0f;
    }
    if (fabsf(x) >= fabsf(y)) {
        return testAtan(y / x);
    }
    const float halfPi = 0.5f * kPi;
    return (y > 0.0f ? halfPi : -halfPi) - testAtan(x / y);
}

float makeNan() {
    const uint32_t bits = 0x7FC00000u;
    float value = 0.0f;
    memcpy(&value, &bits, sizeof(value));
    return value;
}

Vec3 jointWorldAnchor(const World& world, int32_t id, const Vec3& localAnchor) {
    return transformPosition(world.transforms[id]) + world.bodies[id].rotation.transform(localAnchor);
}

float hingeAngleZ(const World& world, int32_t id) {
    const Transform& transform = world.transforms[id];
    return 2.0f * testAtan2(transform.qz, transform.qw);
}

bool initJointWorld(World& world, Arena& arena, unsigned char* memory, Vec3 gravity) {
    return initWorld(world, arena, memory, 64, 4096) && world.setGravity(gravity.x, gravity.y, gravity.z) == 0;
}

void testFixedJointHoldsRigid() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, -9.81f, 0.0f)));

    const int32_t support = world.createBody(kBodyTypeStatic, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t payload = world.createBody(kBodyTypeDynamic, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(support >= 0);
    CHECK(payload >= 0);
    CHECK(world.setSphere(payload, 0.3f, 1.0f) == 0);

    const Vec3 supportAnchor(0.0f, -1.0f, 0.0f);
    const Vec3 payloadAnchor(0.0f, 0.0f, 0.0f);
    const int32_t joint = world.createFixed(support, payload, supportAnchor, payloadAnchor, 1);
    CHECK(joint >= 0);

    Vec3 settled(0.0f, 0.0f, 0.0f);
    for (int32_t i = 0; i < 300; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
        if (i == 60) {
            settled = jointWorldAnchor(world, payload, payloadAnchor) -
                      jointWorldAnchor(world, support, supportAnchor);
        }
    }

    const Vec3 mismatch = jointWorldAnchor(world, payload, payloadAnchor) -
                          jointWorldAnchor(world, support, supportAnchor);
    CHECK(isFinite(mismatch.x) && isFinite(mismatch.y) && isFinite(mismatch.z));
    CHECK(length(mismatch) < 1e-3f);
    CHECK(length(mismatch - settled) < 1e-5f);
    CHECK(world.constraintCount == 1);
}

void testHingeDoorSwingsAndClampsAtLimit() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, -9.81f, 0.0f)));

    const int32_t frame = world.createBody(kBodyTypeStatic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const float half = 0.025f;
    const float qz = testSin(half);
    const float qw = testCos(half);
    Mat3 rotation;
    rotation.fromQuaternion(0.0f, 0.0f, qz, qw);
    const Vec3 doorAnchor(0.4f, 0.0f, 0.0f);
    const Vec3 lever = rotation.transform(doorAnchor);
    const int32_t door = world.createBody(kBodyTypeDynamic, -lever.x, 3.0f - lever.y, 0.0f, 0.0f, 0.0f, qz, qw);
    CHECK(frame >= 0);
    CHECK(door >= 0);
    CHECK(world.setBox(door, 0.4f, 0.08f, 0.2f, 1.0f) == 0);

    const int32_t joint = world.createHinge(
        frame, door, Vec3(0.0f, 0.0f, 0.0f), doorAnchor,
        Vec3(0.0f, 0.0f, 1.0f), Vec3(0.0f, 0.0f, 1.0f),
        1, 0.0f, 0.35f, 0, 0.0f, 0.0f, 1);
    CHECK(joint >= 0);

    float startAngle = hingeAngleZ(world, door);
    CHECK(startAngle < 0.15f);

    for (int32_t i = 0; i < 300; ++i) {
        world.step(1.0f / 60.0f, 10, 4);
        const float angle = hingeAngleZ(world, door);
        CHECK(isFinite(angle));
    }

    const float settled = hingeAngleZ(world, door);
    const float expected = 0.35f + kJointAngularSlop;
    CHECK(settled < 0.5f);
    CHECK(settled > 0.3f);
    CHECK(near(settled, expected, 0.03f));
}

void testHingeMotorReachesTargetSpeed() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, 0.0f, 0.0f)));

    const int32_t mount = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t rotor = world.createBody(kBodyTypeDynamic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(rotor, 0.2f, 0.2f, 0.2f, 1.0f) == 0);

    const int32_t joint = world.createHinge(
        mount, rotor, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, 0.0f),
        Vec3(0.0f, 1.0f, 0.0f), Vec3(0.0f, 1.0f, 0.0f),
        0, 0.0f, 0.0f, 1, 2.0f, 50.0f, 1);
    CHECK(joint >= 0);

    for (int32_t i = 0; i < 60; ++i) {
        world.step(1.0f / 60.0f, 10, 4);
    }

    const float relativeSpeed = world.angularVelocities[rotor].y - world.angularVelocities[mount].y;
    CHECK(isFinite(relativeSpeed));
    CHECK(near(relativeSpeed, 2.0f, 0.06f));
}

void testSliderMovesOnlyAlongAxis() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, -9.81f, 0.0f)));

    const int32_t mount = world.createBody(kBodyTypeStatic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t carriage = world.createBody(kBodyTypeDynamic, 0.0f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setSphere(carriage, 0.2f, 1.0f) == 0);

    const int32_t joint = world.createSlider(
        mount, carriage, Vec3(0.0f, -1.0f, 0.0f), Vec3(0.0f, 0.0f, 0.0f),
        Vec3(0.0f, -1.0f, 0.0f), 0, 0.0f, 0.0f, 0, 0.0f, 0.0f, 1);
    CHECK(joint >= 0);

    for (int32_t i = 0; i < 120; ++i) {
        world.step(1.0f / 60.0f, 10, 4);
    }

    const Transform& transform = world.transforms[carriage];
    CHECK(isFinite(transform.px) && isFinite(transform.py) && isFinite(transform.pz));
    CHECK(fabsf(transform.px) < 1e-4f);
    CHECK(fabsf(transform.pz) < 1e-4f);
    CHECK(transform.py < -10.0f);
}

void testSliderLimitClamps() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, -9.81f, 0.0f)));

    const int32_t mount = world.createBody(kBodyTypeStatic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t carriage = world.createBody(kBodyTypeDynamic, 0.0f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(carriage, 0.2f, 0.2f, 0.2f, 1.0f) == 0);

    const int32_t joint = world.createSlider(
        mount, carriage, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 1.0f, 0.0f),
        Vec3(0.0f, -1.0f, 0.0f), 1, 0.0f, 1.0f, 0, 0.0f, 0.0f, 1);
    CHECK(joint >= 0);

    for (int32_t i = 0; i < 300; ++i) {
        world.step(1.0f / 60.0f, 10, 4);
        const float angle = hingeAngleZ(world, carriage);
        CHECK(isFinite(angle));
    }

    const Transform& transform = world.transforms[carriage];
    CHECK(near(transform.py, 1.0f, 0.08f));
    CHECK(transform.py < 1.1f);
    CHECK(fabsf(transform.px) < 0.05f);
    CHECK(fabsf(transform.pz) < 0.05f);
}

void testSpringPendulumPeriod() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, 0.0f, 0.0f)));

    const int32_t mount = world.createBody(kBodyTypeStatic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t bob = world.createBody(kBodyTypeDynamic, 0.0f, 1.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setSphere(bob, 0.2f, 1.0f) == 0);
    CHECK(world.setMassData(bob, 1.0f, 0.0f, 0.0f, 0.0f) == 0);

    const int32_t joint = world.createSpring(
        mount, bob, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, 0.0f),
        1.0f, 10.0f, 0.0f, 1);
    CHECK(joint >= 0);

    int32_t crossings[8];
    int32_t crossingCount = 0;
    float previousVelocity = 0.0f;
    for (int32_t i = 0; i < 800; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
        const float velocity = world.velocities[bob].y;
        CHECK(isFinite(velocity));
        CHECK(isFinite(world.transforms[bob].py));
        if (i > 2 && crossingCount < 8 && previousVelocity < 0.0f && velocity >= 0.0f) {
            crossings[crossingCount++] = i;
        }
        previousVelocity = velocity;
    }

    CHECK(crossingCount >= 3);
    if (crossingCount >= 3) {
        const float period = static_cast<float>(crossings[crossingCount - 1] - crossings[0]) /
                             static_cast<float>(crossingCount - 1);
        const float expected = 2.0f * kPi * sqrtf(1.0f / 10.0f) * 60.0f;
        CHECK(near(period, expected, expected * 0.05f));
    }
}

void testCollideConnectedSuppressesContacts() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, -9.81f, 0.0f)));

    const int32_t left = world.createBody(kBodyTypeDynamic, 0.0f, 1.2f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t right = world.createBody(kBodyTypeDynamic, 1.2f, 1.2f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(left, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    CHECK(world.setBox(right, 0.5f, 0.5f, 0.5f, 1.0f) == 0);

    const int32_t joint = world.createFixed(left, right, Vec3(0.1f, 0.0f, 0.0f), Vec3(-0.1f, 0.0f, 0.0f), 0);
    CHECK(joint >= 0);

    int32_t pairContacts = 0;
    for (int32_t i = 0; i < 120; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
        for (int32_t k = 0; k < world.contactCount; ++k) {
            const Contact& contact = world.contacts[k];
            if ((contact.a == left && contact.b == right) || (contact.a == right && contact.b == left)) {
                ++pairContacts;
            }
        }
    }
    CHECK(pairContacts == 0);

    CHECK(world.setConstraintEnabled(joint, 0) == 0);
    CHECK(world.destroyConstraint(joint) == 0);

    int32_t controlContacts = 0;
    for (int32_t i = 0; i < 60; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
        for (int32_t k = 0; k < world.contactCount; ++k) {
            const Contact& contact = world.contacts[k];
            if ((contact.a == left && contact.b == right) || (contact.a == right && contact.b == left)) {
                ++controlContacts;
            }
        }
    }
    CHECK(controlContacts > 0);
}

void testConstraintIdsStableAndStaleRejected() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, -9.81f, 0.0f)));

    const int32_t mount = world.createBody(kBodyTypeStatic, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t payload = world.createBody(kBodyTypeDynamic, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setSphere(payload, 0.3f, 1.0f) == 0);

    const int32_t first = world.createFixed(mount, payload, Vec3(0.0f, -1.0f, 0.0f), Vec3(0.0f, 0.0f, 0.0f), 1);
    CHECK(constraintDecodeSlot(first) == 0);
    CHECK(constraintDecodeGeneration(first) == 0);
    CHECK(world.constraintCount == 1);
    CHECK(world.destroyConstraint(first) == 0);
    CHECK(world.constraintCount == 0);

    const int32_t second = world.createFixed(mount, payload, Vec3(0.0f, -1.0f, 0.0f), Vec3(0.0f, 0.0f, 0.0f), 1);
    CHECK(constraintDecodeSlot(second) == 0);
    CHECK(constraintDecodeGeneration(second) == 1);
    CHECK(second != first);

    axrone::physics::Constraint* resolved = nullptr;
    CHECK(!world.constraintResolve(first, resolved));
    CHECK(world.setConstraintEnabled(first, 1) == -1);
    CHECK(world.destroyConstraint(first) == -1);
    CHECK(world.setHingeMotor(first, 1.0f, 1.0f) == -1);
    CHECK(world.constraintResolve(second, resolved));
    CHECK(resolved != nullptr);
    CHECK(resolved->kind == kConstraintFixed);
    CHECK(world.setConstraintEnabled(second, 1) == 0);
    CHECK(world.setConstraintEnabled(second, 0) == 0);
    CHECK(world.setConstraintEnabled(second, 2) == -1);

    CHECK(world.destroyBody(payload) == 0);
    CHECK(world.constraintCount == 0);
    CHECK(!world.constraintResolve(second, resolved));

    const int32_t third = world.createFixed(
        mount, world.createBody(kBodyTypeDynamic, 0.0f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f),
        Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, 0.0f), 1);
    CHECK(third >= 0);
    CHECK(constraintDecodeGeneration(third) == 2);

    world.reset();
    CHECK(world.constraintCount == 0);
    CHECK(!world.constraintResolve(third, resolved));
    CHECK(world.constraintCount == 0);
}

void testConstraintDisablingReleasesSolverState() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, -9.81f, 0.0f)));

    const int32_t mount = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t rotor = world.createBody(kBodyTypeDynamic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(rotor, 0.4f, 0.08f, 0.2f, 1.0f) == 0);

    const float half = 0.025f;
    Mat3 rotation;
    rotation.fromQuaternion(0.0f, 0.0f, testSin(half), testCos(half));
    const Vec3 doorAnchor(0.4f, 0.0f, 0.0f);
    const Vec3 lever = rotation.transform(doorAnchor);
    CHECK(world.setTransform(rotor, -lever.x, -lever.y, 0.0f, 0.0f, 0.0f, testSin(half), testCos(half)) == 0);

    const int32_t joint = world.createHinge(
        mount, rotor, Vec3(0.0f, 0.0f, 0.0f), doorAnchor,
        Vec3(0.0f, 0.0f, 1.0f), Vec3(0.0f, 0.0f, 1.0f),
        1, 0.0f, 0.35f, 1, 2.0f, 50.0f, 1);
    CHECK(joint >= 0);

    for (int32_t i = 0; i < 120; ++i) {
        world.step(1.0f / 60.0f, 10, 4);
    }

    axrone::physics::Constraint* constraint = nullptr;
    CHECK(world.constraintResolve(joint, constraint));
    CHECK(fabsf(constraint->impulses[2]) > 1e-4f);
    CHECK(constraint->impulses[3] < -0.05f);

    CHECK(world.setConstraintEnabled(joint, 0) == 0);
    CHECK(constraint->impulses[0] == 0.0f);
    CHECK(constraint->impulses[2] == 0.0f);
    CHECK(constraint->impulses[3] == 0.0f);

    CHECK(world.setConstraintEnabled(joint, 1) == 0);
    CHECK(world.setHingeMotor(joint, 0.0f, 0.0f) == 0);
    CHECK(constraint->impulses[2] == 0.0f);
    CHECK(constraint->enableMotor == 0);
    CHECK(world.setHingeMotor(joint, makeNan(), 1.0f) == -1);
    CHECK(world.setHingeLimit(joint, 1, 1.0f, -1.0f) == -1);
}

void testConstraintInputValidation() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, -9.81f, 0.0f)));

    const int32_t mount = world.createBody(kBodyTypeStatic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setSphere(body, 0.3f, 1.0f) == 0);

    const float nan = makeNan();
    CHECK(world.createFixed(mount, -1, Vec3(), Vec3(), 1) == -1);
    CHECK(world.createFixed(mount, body, Vec3(nan, 0.0f, 0.0f), Vec3(), 1) == -1);
    CHECK(world.createFixed(mount, mount, Vec3(), Vec3(), 1) == -1);
    CHECK(world.createFixed(mount, body, Vec3(), Vec3(), 2) == -1);
    CHECK(world.createHinge(
        mount, body, Vec3(), Vec3(), Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, 1.0f),
        0, 0.0f, 0.0f, 0, 0.0f, 0.0f, 1) == -1);
    CHECK(world.createHinge(
        mount, body, Vec3(), Vec3(), Vec3(0.0f, 0.0f, 1.0f), Vec3(0.0f, 0.0f, 1.0f),
        1, 0.5f, 0.25f, 0, 0.0f, 0.0f, 1) == -1);
    CHECK(world.createHinge(
        mount, body, Vec3(), Vec3(), Vec3(0.0f, 0.0f, 1.0f), Vec3(0.0f, 0.0f, 1.0f),
        0, 0.0f, 0.0f, 0, 0.0f, -1.0f, 1) == -1);
    CHECK(world.createSlider(
        mount, body, Vec3(), Vec3(), Vec3(0.0f, 0.0f, 0.0f),
        0, 0.0f, 0.0f, 0, 0.0f, 0.0f, 1) == -1);
    CHECK(world.createSpring(
        mount, body, Vec3(), Vec3(), 1.0f, -10.0f, 0.0f, 1) == -1);
    CHECK(world.createSpring(
        mount, body, Vec3(), Vec3(), -1.0f, 10.0f, 0.0f, 1) == -1);
    CHECK(world.constraintCount == 0);
    CHECK(world.destroyConstraint(12345) == -1);
    CHECK(world.setSliderMotor(12345, 1.0f, 1.0f) == -1);
    CHECK(world.setSliderLimit(12345, 1, 0.0f, 1.0f) == -1);
}

void testConstraintCapacityRejection() {
    Arena arena;
    World world;
    CHECK(initJointWorld(world, arena, g_memoryA, Vec3(0.0f, -9.81f, 0.0f)));

    const int32_t mount = world.createBody(kBodyTypeStatic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);

    int32_t created = 0;
    int32_t lastId = -1;
    for (int32_t i = 0; i < world.maxConstraints; ++i) {
        const int32_t id = world.createFixed(mount, body, Vec3(0.0f, 0.0f, 0.0f), Vec3(0.0f, 0.0f, 0.0f), 1);
        if (id < 0) {
            break;
        }
        lastId = id;
        ++created;
    }
    CHECK(created == world.maxConstraints);
    CHECK(world.constraintCount == world.maxConstraints);
    CHECK(world.createFixed(mount, body, Vec3(), Vec3(), 1) == -1);
    CHECK(world.destroyConstraint(lastId) == 0);
    CHECK(world.createFixed(mount, body, Vec3(), Vec3(), 1) >= 0);
}

void testConstraintSceneDeterminism() {
    Arena arenaA;
    Arena arenaB;
    World worldA;
    World worldB;
    CHECK(initWorld(worldA, arenaA, g_memoryA, 64, 4096));
    CHECK(initWorld(worldB, arenaB, g_memoryB, 64, 4096));
    CHECK(worldA.setGravity(0.0f, -9.81f, 0.0f) == 0);
    CHECK(worldB.setGravity(0.0f, -9.81f, 0.0f) == 0);

    const int32_t supportA = worldA.createBody(kBodyTypeStatic, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t supportB = worldB.createBody(kBodyTypeStatic, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t payloadA = worldA.createBody(kBodyTypeDynamic, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t payloadB = worldB.createBody(kBodyTypeDynamic, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(worldA.setBox(payloadA, 0.3f, 0.3f, 0.3f, 1.0f) == 0);
    CHECK(worldB.setBox(payloadB, 0.3f, 0.3f, 0.3f, 1.0f) == 0);
    CHECK(worldA.createHinge(
        supportA, payloadA, Vec3(0.0f, -1.0f, 0.0f), Vec3(-0.3f, 0.0f, 0.0f),
        Vec3(0.0f, 0.0f, 1.0f), Vec3(0.0f, 0.0f, 1.0f), 1, -0.5f, 0.5f, 1, 0.5f, 2.0f, 1) >= 0);
    CHECK(worldB.createHinge(
        supportB, payloadB, Vec3(0.0f, -1.0f, 0.0f), Vec3(-0.3f, 0.0f, 0.0f),
        Vec3(0.0f, 0.0f, 1.0f), Vec3(0.0f, 0.0f, 1.0f), 1, -0.5f, 0.5f, 1, 0.5f, 2.0f, 1) >= 0);
    CHECK(worldA.createSpring(
        supportA, payloadA, Vec3(0.0f, -1.0f, 0.5f), Vec3(0.0f, 0.3f, 0.0f), 1.0f, 10.0f, 0.5f, 1) >= 0);
    CHECK(worldB.createSpring(
        supportB, payloadB, Vec3(0.0f, -1.0f, 0.5f), Vec3(0.0f, 0.3f, 0.0f), 1.0f, 10.0f, 0.5f, 1) >= 0);

    for (int32_t i = 0; i < 200; ++i) {
        worldA.step(1.0f / 60.0f, 10, 4);
        worldB.step(1.0f / 60.0f, 10, 4);
    }

    CHECK(worldA.fingerprint() == worldB.fingerprint());
    CHECK(worldA.constraintCount == worldB.constraintCount);
}

int main() {
    testInitValidation();
    testSphereRest();
    testBoxStack();
    testDeterminism();
    testDestroyAndReuse();
    testContactManifolds();
    testInvalidInputs();
    testRestitution();
    testFriction();
    testRotatedBoxContact();
    testKinematicBodyCreation();
    testKinematicIgnoresGravity();
    testKinematicCollidesWithStatic();
    testKinematicPlatformCarriesBox();
    testDynamicCannotPushKinematic();
    testMultiShapeMassAccumulation();
    testParallelAxisInertiaGrows();
    testOffsetShapeRestsOnGround();
    testClearShapesResetsProperties();
    testShapeCapacityRejection();
    testStaticAndKinematicKeepZeroMass();
    testOffsetShapeAabbUnion();
    testMultiShapeDeterminism();
    testArenaExhaustion();
    testStressDeterminism();
    testDampingDecay();
    testGravityScale();
    testFrozenPositionAxes();
    testFrozenRotationAxes();
    testForceAppliedPerStep();
    testImpulseAtOffset();
    testMassOverride();
    testKinematicDampingKeepsMotion();
    testDynamicsDefaultsAndReset();
    testSleepDefaultsOff();
    testSleepAfterRest();
    testWakeOnImpulse();
    testWakeOnForceAndTorque();
    testWakeByFastDynamicNeighbor();
    testKinematicWakesSleepingBody();
    testAwakeApiValidation();
    testSleepResetClearsState();
    testSleepingBodiesSkipIntegration();
    testSleepDisableWakesEverything();
    testShapeMaterialParity();
    testShapeFilterReject();
    testShapeFilterGroups();
    testSensorContactTransfersNoImpulse();
    testShapeIdLifecycle();
    testAddRollbackKeepsHighWater();
    testCapsuleMassAndInertia();
    testCapsuleAabb();
    testCapsuleRestsOnBox();
    testCapsuleCapsuleStacking();
    testCapsuleSphereContact();
    testCapsuleBoxSideContact();
    testCylinderMassAndAabb();
    testCylinderRestsOnBox();
    testCylinderSphereContact();
    testCylinderCapsuleContact();
    testShapeIdLifecycleNewKinds();
    testConeMassAndAabb();
    testConeRestsOnBox();
    testCylinderCylinderStacking();
    testCylinderBoxEdgeContact();
    testCapsuleCylinderTwoPointManifold();
    testFixedJointHoldsRigid();
    testHingeDoorSwingsAndClampsAtLimit();
    testHingeMotorReachesTargetSpeed();
    testSliderMovesOnlyAlongAxis();
    testSliderLimitClamps();
    testSpringPendulumPeriod();
    testCollideConnectedSuppressesContacts();
    testConstraintIdsStableAndStaleRejected();
    testConstraintDisablingReleasesSolverState();
    testConstraintInputValidation();
    testConstraintCapacityRejection();
    testConstraintSceneDeterminism();

    if (g_failures == 0) {
        std::printf("PASS\n");
        return 0;
    }

    std::printf("FAILED %d\n", g_failures);
    return 1;
}
