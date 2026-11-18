#include <cstdio>
#include <cstring>

#include "core/broadphase.h"
#include "core/query.h"
#include "core/world.h"
#include "runtime/arena.h"

using namespace axrone::physics;

static_assert(sizeof(Shape) == 112, "inline shape record must stay at 112 bytes");
static_assert(sizeof(Body) == 1072, "body record must stay at 1072 bytes");

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

bool initWorld(World& world, Arena& arena, unsigned char* memory, int32_t bodies, int32_t contacts) {
    arena.init(memory, 64 * 1024 * 1024);
    return world.init(arena, bodies, contacts, Vec3(0.0f, -9.81f, 0.0f));
}

int32_t makeHullShape(World& world, int32_t bodyId, const float* vertices, int32_t count) {
    const int32_t slot = world.addHull(bodyId, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    if (slot < 0) {
        return -1;
    }
    const int32_t shapeId = world.shapeMakeId(bodyId, slot);
    const uintptr_t address = world.bulkAlloc(count * 3 * static_cast<int32_t>(sizeof(float)));
    if (address == 0) {
        return -1;
    }
    float* scratch = reinterpret_cast<float*>(address);
    for (int32_t i = 0; i < count * 3; ++i) {
        scratch[i] = vertices[i];
    }
    const int32_t status = world.setShapeVertices(shapeId, address, count);
    world.bulkRelease(address);
    if (status != 0) {
        world.shapeDestroy(shapeId);
        return -1;
    }
    return shapeId;
}

const float kUnitBoxHull[24] = {
    -0.5f, -1.0f, -1.5f,
     0.5f, -1.0f, -1.5f,
    -0.5f,  1.0f, -1.5f,
     0.5f,  1.0f, -1.5f,
    -0.5f, -1.0f,  1.5f,
     0.5f, -1.0f,  1.5f,
    -0.5f,  1.0f,  1.5f,
     0.5f,  1.0f,  1.5f
};

const float kShiftedBoxHull[24] = {
    0.0f, 0.0f, 0.0f,
    1.0f, 0.0f, 0.0f,
    0.0f, 2.0f, 0.0f,
    1.0f, 2.0f, 0.0f,
    0.0f, 0.0f, 3.0f,
    1.0f, 0.0f, 3.0f,
    0.0f, 2.0f, 3.0f,
    1.0f, 2.0f, 3.0f
};

void testBulkScratchCycles() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    CHECK(world.scratchBegin == 0);
    CHECK(world.shapeBulks == nullptr);

    uintptr_t firstAddress = 0;
    size_t steadyUsage = 0;
    for (int32_t cycle = 0; cycle < 1000; ++cycle) {
        const int32_t body = world.createBody(kBodyTypeDynamic, 0.0f, 5.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
        CHECK(body >= 0);
        const int32_t shapeId = makeHullShape(world, body, kUnitBoxHull, 8);
        CHECK(shapeId >= 0);
        const uintptr_t address = world.bulkAlloc(96);
        if (cycle == 0) {
            firstAddress = address;
        }
        CHECK(address == firstAddress);
        CHECK(world.bulkRelease(address) == 0);
        CHECK(world.bulkScratchUsed() == 0);
        CHECK(world.shapeDestroy(shapeId) == 0);
        CHECK(world.destroyBody(body) == 0);
        if (cycle == 0) {
            steadyUsage = world.bulkArenaUsed();
            CHECK(steadyUsage > 0);
        } else {
            CHECK(world.bulkArenaUsed() == steadyUsage);
        }
    }

    CHECK(world.bulkScratchUsed() == 0);
    CHECK(world.bulkArenaUsed() == steadyUsage);
}

void testPrimitiveWorldHasNoBulkPool() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 32, 2048));
    const size_t baseline = world.bulkArenaUsed();
    CHECK(baseline == arena.used());
    CHECK(world.scratchBegin == 0);
    CHECK(world.shapeBulks == nullptr);
    CHECK(world.bulkScratchUsed() == 0);

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);
    const int32_t sphere = world.createBody(kBodyTypeDynamic, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setSphere(sphere, 0.5f, 1.0f) == 0);
    const int32_t capsule = world.createBody(kBodyTypeDynamic, 1.0f, 6.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.addCapsule(capsule, 0.25f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) >= 0);
    const int32_t cylinder = world.createBody(kBodyTypeDynamic, 2.0f, 8.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.addCylinder(cylinder, 0.3f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) >= 0);
    const int32_t cone = world.createBody(kBodyTypeDynamic, 3.0f, 10.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.addCone(cone, 0.3f, 0.5f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) >= 0);

    for (int32_t i = 0; i < 240; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    CHECK(world.scratchBegin == 0);
    CHECK(world.shapeBulks == nullptr);
    CHECK(world.bulkScratchUsed() == 0);
    CHECK(world.bulkArenaUsed() == baseline);

    const int32_t hullSlot = world.addHull(cone, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(hullSlot >= 0);
    CHECK(world.scratchBegin != 0);
    CHECK(world.shapeBulks != nullptr);
    CHECK(world.bulkScratchUsed() == 0);
    CHECK(world.bulkArenaUsed() > baseline);
}

void testHullMassAndAabb() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeDynamic, 2.0f, 5.0f, 3.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(body >= 0);
    const int32_t shapeId = makeHullShape(world, body, kShiftedBoxHull, 8);
    CHECK(shapeId >= 0);

    const Body& record = world.bodies[body];
    CHECK(near(record.invMass, 1.0f / 6.0f, 1e-6f));
    CHECK(near(record.invInertia.x, 1.0f / 26.0f, 1e-6f));
    CHECK(near(record.invInertia.y, 1.0f / 20.0f, 1e-6f));
    CHECK(near(record.invInertia.z, 1.0f / 10.0f, 1e-6f));

    CHECK(near(record.shapes[0].extents.x, 0.5f, 0.0f));
    CHECK(near(record.shapes[0].extents.y, 1.0f, 0.0f));
    CHECK(near(record.shapes[0].extents.z, 1.5f, 0.0f));
    CHECK(near(record.shapes[0].offset.x, 0.5f, 0.0f));
    CHECK(near(record.shapes[0].offset.y, 1.0f, 0.0f));
    CHECK(near(record.shapes[0].offset.z, 1.5f, 0.0f));

    updateBounds(world);
    const AABB& bounds = record.aabb;
    CHECK(near(bounds.minX, 2.0f, 1e-5f));
    CHECK(near(bounds.minY, 5.0f, 1e-5f));
    CHECK(near(bounds.minZ, 3.0f, 1e-5f));
    CHECK(near(bounds.maxX, 3.0f, 1e-5f));
    CHECK(near(bounds.maxY, 7.0f, 1e-5f));
    CHECK(near(bounds.maxZ, 6.0f, 1e-5f));
}

void testHullDedupRejectsDegenerate() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    const int32_t body = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t slot = world.addHull(body, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(slot >= 0);
    const int32_t shapeId = world.shapeMakeId(body, slot);

    float coplanar[12] = {
        -1.0f, 0.0f, -1.0f,
         1.0f, 0.0f, -1.0f,
        -1.0f, 0.0f,  1.0f,
         1.0f, 0.0f,  1.0f
    };
    const uintptr_t address = world.bulkAlloc(sizeof(coplanar));
    CHECK(address != 0);
    std::memcpy(reinterpret_cast<void*>(address), coplanar, sizeof(coplanar));
    CHECK(world.setShapeVertices(shapeId, address, 4) == -1);
    world.bulkRelease(address);
}

void testHullRestsOnBoxAndHull() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 32, 2048));

    const int32_t ground = world.createBody(kBodyTypeStatic, 0.0f, -0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(ground, 10.0f, 0.5f, 10.0f, 0.0f) == 0);

    const int32_t hull = world.createBody(kBodyTypeDynamic, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(makeHullShape(world, hull, kUnitBoxHull, 8) >= 0);

    const int32_t hullOnTop = world.createBody(kBodyTypeDynamic, 0.0f, 8.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(makeHullShape(world, hullOnTop, kUnitBoxHull, 8) >= 0);

    int32_t contactsSeen = 0;
    for (int32_t i = 0; i < 600; ++i) {
        contactsSeen |= world.step(1.0f / 60.0f, 8, 3) > 0 ? 1 : 0;
    }
    CHECK(contactsSeen == 1);

    const float lowerY = world.transforms[hull].py;
    const float upperY = world.transforms[hullOnTop].py;
    CHECK(isFinite(lowerY) && isFinite(upperY));
    CHECK(near(lowerY, 1.0f, 0.15f));
    CHECK(upperY > lowerY + 1.7f);
    CHECK(world.velocities[hull].y * world.velocities[hull].y < 0.05f);
}

void collectContactDigest(World& world, uint64_t digest[4]) {
    digest[0] = static_cast<uint64_t>(world.contactCount);
    digest[1] = 14695981039346656037ull;
    digest[2] = 14695981039346656037ull;
    digest[3] = 14695981039346656037ull;
    for (int32_t k = 0; k < world.contactCount; ++k) {
        const Contact& contact = world.contacts[k];
        for (uint64_t* slot = digest + 1; slot <= digest + 3; ++slot) {
            *slot ^= static_cast<uint64_t>(contact.a);
            *slot *= 1099511628211ull;
            *slot ^= static_cast<uint64_t>(contact.b);
            *slot *= 1099511628211ull;
        }
        uint32_t bits = 0;
        std::memcpy(&bits, &contact.normal.x, sizeof(bits));
        digest[1] ^= bits;
        digest[1] *= 1099511628211ull;
        std::memcpy(&bits, &contact.normal.y, sizeof(bits));
        digest[2] ^= bits;
        digest[2] *= 1099511628211ull;
        std::memcpy(&bits, &contact.normal.z, sizeof(bits));
        digest[3] ^= bits;
        digest[3] *= 1099511628211ull;
    }
}

bool runHullContactScene(unsigned char* memory, uint64_t digest[4], int32_t* contactsTotal) {
    Arena arena;
    World world;
    if (!initWorld(world, arena, memory, 32, 2048)) {
        return false;
    }
    const int32_t capsule = world.createBody(kBodyTypeDynamic, -0.4f, 2.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(capsule >= 0);
    CHECK(world.addCapsule(capsule, 0.4f, 0.8f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) >= 0);
    const int32_t hullA = world.createBody(kBodyTypeStatic, 0.6f, 0.5f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(makeHullShape(world, hullA, kUnitBoxHull, 8) >= 0);
    const int32_t sphere = world.createBody(kBodyTypeDynamic, 0.6f, 4.0f, 1.6f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setSphere(sphere, 0.5f, 1.0f) == 0);
    const int32_t hullB = world.createBody(kBodyTypeDynamic, 0.0f, 6.0f, 0.0f, 0.0f, 0.342f, 0.0f, 0.940f);
    CHECK(makeHullShape(world, hullB, kShiftedBoxHull, 8) >= 0);
    CHECK(world.setMaterial(capsule, 0.6f, 0.0f) == 0);
    CHECK(world.setMaterial(sphere, 0.6f, 0.0f) == 0);
    CHECK(world.setMaterial(hullB, 0.6f, 0.0f) == 0);

    *contactsTotal = 0;
    uint64_t running[4] = { 0, 14695981039346656037ull, 14695981039346656037ull, 14695981039346656037ull };
    for (int32_t i = 0; i < 60; ++i) {
        *contactsTotal += world.step(1.0f / 60.0f, 8, 3);
        uint64_t stepDigest[4];
        collectContactDigest(world, stepDigest);
        for (int32_t s = 0; s < 4; ++s) {
            running[s] ^= stepDigest[s];
            running[s] *= 1099511628211ull;
        }
    }
    for (int32_t s = 0; s < 4; ++s) {
        digest[s] = running[s];
    }
    return true;
}

void testHullContactNormalsDeterministic() {
    uint64_t digestA[4];
    uint64_t digestB[4];
    int32_t contactsA = 0;
    int32_t contactsB = 0;
    CHECK(runHullContactScene(g_memoryA, digestA, &contactsA));
    CHECK(runHullContactScene(g_memoryB, digestB, &contactsB));
    CHECK(contactsA > 0);
    CHECK(contactsA == contactsB);
    for (int32_t s = 0; s < 4; ++s) {
        CHECK(digestA[s] == digestB[s]);
    }
}

void testMeshFloorStopsBox() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 1024));

    const int32_t floor = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t slot = world.addMesh(floor, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(slot >= 0);
    const int32_t shapeId = world.shapeMakeId(floor, slot);
    const float vertices[12] = {
        -10.0f, 0.0f, -10.0f,
        10.0f, 0.0f, -10.0f,
        10.0f, 0.0f, 10.0f,
        -10.0f, 0.0f, 10.0f
    };
    const uint32_t indices[6] = { 0, 1, 2, 0, 2, 3 };
    const uintptr_t vertexAddress = world.bulkAlloc(sizeof(vertices));
    const uintptr_t indexAddress = world.bulkAlloc(sizeof(indices));
    CHECK(vertexAddress != 0 && indexAddress != 0);
    std::memcpy(reinterpret_cast<void*>(vertexAddress), vertices, sizeof(vertices));
    std::memcpy(reinterpret_cast<void*>(indexAddress), indices, sizeof(indices));
    CHECK(world.setShapeVertices(shapeId, vertexAddress, 4) == 0);
    CHECK(world.setShapeIndices(shapeId, indexAddress, 2) == 0);
    world.bulkRelease(indexAddress);
    world.bulkRelease(vertexAddress);

    const int32_t box = world.createBody(kBodyTypeDynamic, 0.0f, 3.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(box, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    const int32_t stray = world.createBody(kBodyTypeDynamic, 40.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(stray, 0.5f, 0.5f, 0.5f, 1.0f) == 0);

    for (int32_t i = 0; i < 300; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }

    CHECK(near(world.transforms[box].py, 0.5f, 0.08f));
    CHECK(world.transforms[stray].py < 0.5f);

    int32_t strayContacted = 0;
    for (int32_t i = 0; i < world.contactCount; ++i) {
        if (world.contacts[i].a == stray || world.contacts[i].b == stray) {
            strayContacted = 1;
        }
    }
    CHECK(strayContacted == 0);
}

void testMeshOnDynamicRejected() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    const int32_t dynamic = world.createBody(kBodyTypeDynamic, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.addMesh(dynamic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    const int32_t kinematic = world.createBody(kBodyTypeKinematic, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.addMesh(kinematic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
    const int32_t heightFieldTarget = world.createBody(kBodyTypeDynamic, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.addHeightField(heightFieldTarget, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f) == -1);
}

void testMeshIndexValidation() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    const int32_t floor = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t slot = world.addMesh(floor, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t shapeId = world.shapeMakeId(floor, slot);
    const float vertices[12] = { 0.0f, 0.0f, 0.0f, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f, 1.0f, 0.0f, 1.0f };
    const uintptr_t vertexAddress = world.bulkAlloc(sizeof(vertices));
    std::memcpy(reinterpret_cast<void*>(vertexAddress), vertices, sizeof(vertices));
    CHECK(world.setShapeVertices(shapeId, vertexAddress, 4) == 0);
    world.bulkRelease(vertexAddress);

    uint32_t badIndices[3] = { 0, 1, 9 };
    const uintptr_t badAddress = world.bulkAlloc(sizeof(badIndices));
    std::memcpy(reinterpret_cast<void*>(badAddress), badIndices, sizeof(badIndices));
    CHECK(world.setShapeIndices(shapeId, badAddress, 1) == -1);
    world.bulkRelease(badAddress);

    CHECK(world.setShapeIndices(shapeId, 16, 1) == -1);

    uint32_t goodIndices[3] = { 0, 1, 2 };
    const uintptr_t goodAddress = world.bulkAlloc(sizeof(goodIndices));
    std::memcpy(reinterpret_cast<void*>(goodAddress), goodIndices, sizeof(goodIndices));
    CHECK(world.setShapeIndices(shapeId, goodAddress, 1) == 0);
    world.bulkRelease(goodAddress);
}

void testResetReclaimsBulkStorage() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));

    const int32_t body = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(makeHullShape(world, body, kUnitBoxHull, 8) >= 0);
    const size_t peak = world.bulkArenaUsed();
    CHECK(peak > 0);
    CHECK(world.bulkScratchUsed() == 0);

    world.reset();
    CHECK(world.liveCount == 0);
    CHECK(world.bulkScratchUsed() == 0);
    CHECK(world.bulkArenaUsed() <= peak);

    const int32_t reused = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(reused >= 0);
    CHECK(makeHullShape(world, reused, kUnitBoxHull, 8) >= 0);
    CHECK(world.bulkArenaUsed() > 0);
}

void testReinitDropsPreviousScratchLayout() {
    Arena arena;
    World world;
    arena.init(g_memoryA, sizeof(g_memoryA));
    CHECK(world.init(arena, 16, 256, Vec3(0.0f, 0.0f, 0.0f)));

    const int32_t body = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(makeHullShape(world, body, kUnitBoxHull, 8) >= 0);
    CHECK(world.scratchBegin != 0);
    CHECK(world.shapeBulks != nullptr);

    arena.reset();
    CHECK(world.init(arena, 16, 256, Vec3(0.0f, 0.0f, 0.0f)));
    CHECK(world.scratchBegin == 0);
    CHECK(world.scratchCursor == 0);
    CHECK(world.shapeBulks == nullptr);
    CHECK(world.bulkPoolBaseOffset == 0);

    const int32_t rebuilt = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(rebuilt >= 0);
    CHECK(makeHullShape(world, rebuilt, kUnitBoxHull, 8) >= 0);
    CHECK(world.scratchBegin != 0);
    CHECK(world.shapeBulks != nullptr);
}

void testHeightFieldRestAndRay() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 1024));

    const int32_t field = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t slot = world.addHeightField(field, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(slot >= 0);
    const int32_t shapeId = world.shapeMakeId(field, slot);
    float heights[16 * 16];
    for (int32_t iz = 0; iz < 16; ++iz) {
        for (int32_t ix = 0; ix < 16; ++ix) {
            heights[iz * 16 + ix] = 1.0f;
        }
    }
    const uintptr_t address = world.bulkAlloc(sizeof(heights));
    CHECK(address != 0);
    std::memcpy(reinterpret_cast<void*>(address), heights, sizeof(heights));
    CHECK(world.setShapeHeightField(shapeId, address, 16, 16, 1.0f, 1.0f, 1.0f) == 0);
    world.bulkRelease(address);

    RayHit hit;
    CHECK(raycastClosest(world, Vec3(0.0f, 5.0f, 0.0f), Vec3(0.0f, -1.0f, 0.0f), 20.0f, hit));
    CHECK(hit.body == field);
    CHECK(near(hit.py, 1.0f, 1e-3f));

    RayHit corner;
    CHECK(raycastClosest(world, Vec3(-7.5f, 5.0f, -7.5f), Vec3(0.0f, -1.0f, 0.0f), 20.0f, corner));
    CHECK(near(corner.py, 1.0f, 1e-3f));

    RayHit miss;
    CHECK(!raycastClosest(world, Vec3(20.0f, 5.0f, 0.0f), Vec3(0.0f, -1.0f, 0.0f), 20.0f, miss));

    const int32_t box = world.createBody(kBodyTypeDynamic, 0.0f, 4.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(world.setBox(box, 0.5f, 0.5f, 0.5f, 1.0f) == 0);
    for (int32_t i = 0; i < 300; ++i) {
        world.step(1.0f / 60.0f, 8, 3);
    }
    CHECK(near(world.transforms[box].py, 1.5f, 0.1f));
}

void testHullQueriesAndOverlap() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 1024));

    const int32_t hull = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(makeHullShape(world, hull, kUnitBoxHull, 8) >= 0);

    RayHit hit;
    CHECK(raycastClosest(world, Vec3(0.0f, 5.0f, 0.0f), Vec3(0.0f, -1.0f, 0.0f), 20.0f, hit));
    CHECK(hit.body == hull);
    CHECK(near(hit.py, 1.0f, 1e-5f));

    CHECK(overlapSphere(world, Vec3(0.0f, 3.0f, 0.0f), 0.5f, nullptr, 0) == 0);
    int32_t ids[4];
    CHECK(overlapSphere(world, Vec3(0.0f, 1.2f, 0.0f), 0.3f, ids, 4) == 1);
    CHECK(ids[0] == hull);
    CHECK(overlapSphere(world, Vec3(0.0f, 3.0f, 0.0f), 0.5f, ids, 4) == 0);
}

void testShapeGetKindBulkCodes() {
    Arena arena;
    World world;
    CHECK(initWorld(world, arena, g_memoryA, 16, 256));
    const int32_t staticBody = world.createBody(kBodyTypeStatic, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t hullSlot = world.addHull(staticBody, 1.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    const int32_t hullId = world.shapeMakeId(staticBody, hullSlot);
    CHECK(shapeTypeCode(world.bodies[staticBody].shapes[hullSlot].kind) == kShapeTypeCodeHull);
    const int32_t meshSlot = world.addMesh(staticBody, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(shapeTypeCode(world.bodies[staticBody].shapes[meshSlot].kind) == kShapeTypeCodeMesh);
    const int32_t fieldSlot = world.addHeightField(staticBody, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 1.0f);
    CHECK(shapeTypeCode(world.bodies[staticBody].shapes[fieldSlot].kind) == kShapeTypeCodeHeightField);
    CHECK(hullId >= 0);
}

}

int main() {
    testBulkScratchCycles();
    testPrimitiveWorldHasNoBulkPool();
    testHullMassAndAabb();
    testHullDedupRejectsDegenerate();
    testHullRestsOnBoxAndHull();
    testHullContactNormalsDeterministic();
    testMeshFloorStopsBox();
    testMeshOnDynamicRejected();
    testMeshIndexValidation();
    testResetReclaimsBulkStorage();
    testReinitDropsPreviousScratchLayout();
    testHeightFieldRestAndRay();
    testHullQueriesAndOverlap();
    testShapeGetKindBulkCodes();

    if (g_failures == 0) {
        std::printf("PASS\n");
        return 0;
    }

    std::printf("FAILED %d\n", g_failures);
    return 1;
}
