#include "core/world.h"

#include "core/broadphase.h"
#include "core/narrowphase.h"
#include "core/solver.h"
#include "platform/memory.h"
#include "runtime/arena.h"

namespace axrone::physics {

namespace {

template <typename T>
T* allocateArray(Arena& arena, int32_t count) {
    if (count <= 0) {
        return nullptr;
    }
    return static_cast<T*>(arena.alloc(sizeof(T) * static_cast<size_t>(count), 64));
}

uint32_t contactHash(int32_t a, int32_t b, int32_t feature) {
    return (static_cast<uint32_t>(a) * 73856093u) ^
           (static_cast<uint32_t>(b) * 19349663u) ^
           (static_cast<uint32_t>(feature) * 83492791u);
}

bool cacheContains(const CacheEntry* table, uint32_t mask, int32_t capacity, const CacheEntry& wanted) {
    if (table == nullptr || wanted.keyA == 0) {
        return false;
    }
    uint32_t index = contactHash(wanted.keyA - 1, wanted.keyB, wanted.feature) & mask;
    for (int32_t probe = 0; probe < capacity; ++probe) {
        const CacheEntry& entry = table[index];
        if (entry.keyA == 0) {
            return false;
        }
        if (entry.keyA == wanted.keyA && entry.keyB == wanted.keyB && entry.feature == wanted.feature) {
            return true;
        }
        index = (index + 1) & mask;
    }
    return false;
}

void resetStepCounters(StepStatistics& statistics) {
    statistics.boxFacePairs = 0;
    statistics.boxEdgePairs = 0;
    statistics.boxPairsTotal = 0;
    statistics.cacheLookups = 0;
    statistics.cacheHits = 0;
    statistics.cacheStores = 0;
    statistics.pointIdentitiesPrevStep = 0;
    statistics.pointIdentitiesRepeatingPrevStep = 0;
    statistics.boxClipCandidateTotal = 0;
    for (uint32_t& bucket : statistics.boxPointBuckets) {
        bucket = 0;
    }
}

void zeroMass(Body& body) {
    body.invMass = 0.0f;
    body.invInertia = Vec3();
}

bool accumulateMass(const Body& body, float& mass, float& inertiaX, float& inertiaY, float& inertiaZ) {
    mass = 0.0f;
    inertiaX = 0.0f;
    inertiaY = 0.0f;
    inertiaZ = 0.0f;

    const int32_t slots = shapeSlots(body);
    for (int32_t slot = 0; slot < slots; ++slot) {
        const Shape& shape = body.shapes[slot];
        if (!shapeValid(shape)) {
            continue;
        }
        if (shape.kind == kShapeMesh || shape.kind == kShapeHeightField) {
            continue;
        }
        if (shape.kind == kShapeHull && (shape.extents.x <= 0.0f || shape.extents.y <= 0.0f || shape.extents.z <= 0.0f)) {
            continue;
        }

        float shapeMass = 0.0f;
        float shapeInertiaX = 0.0f;
        float shapeInertiaY = 0.0f;
        float shapeInertiaZ = 0.0f;

        if (shape.kind == kShapeSphere) {
            const float radius = shape.extents.x;
            shapeMass = shape.density * kSphereVolume * radius * radius * radius;
            const float spin = kSphereInertia * shapeMass * radius * radius;
            shapeInertiaX = spin;
            shapeInertiaY = spin;
            shapeInertiaZ = spin;
        } else if (shape.kind == kShapeCapsule) {
            const float radius = shape.extents.x;
            const float halfSegment = shape.extents.y;
            const float segmentLength = 2.0f * halfSegment;
            const float cylinderMass = shape.density * kPi * radius * radius * segmentLength;
            const float capMass = shape.density * kSphereVolume * radius * radius * radius;
            shapeMass = cylinderMass + capMass;
            shapeInertiaY = 0.5f * cylinderMass * radius * radius + 2.0f * kSphereInertia * capMass * radius * radius;
            const float twelfth = 1.0f / 12.0f;
            shapeInertiaX = cylinderMass * (3.0f * radius * radius + segmentLength * segmentLength) * twelfth +
                            2.0f * (kSphereInertia * capMass * radius * radius + capMass * halfSegment * halfSegment);
            shapeInertiaZ = shapeInertiaX;
        } else if (shape.kind == kShapeCylinder) {
            const float radius = shape.extents.x;
            const float fullHeight = 2.0f * shape.extents.y;
            shapeMass = shape.density * kPi * radius * radius * fullHeight;
            const float twelfth = 1.0f / 12.0f;
            shapeInertiaX = shapeMass * (3.0f * radius * radius + fullHeight * fullHeight) * twelfth;
            shapeInertiaY = 0.5f * shapeMass * radius * radius;
            shapeInertiaZ = shapeInertiaX;
        } else if (shape.kind == kShapeCone) {
            const float radius = shape.extents.x;
            const float halfHeight = shape.extents.y;
            const float third = 1.0f / 3.0f;
            shapeMass = shape.density * third * kPi * radius * radius * (2.0f * halfHeight);
            shapeInertiaY = 0.3f * shapeMass * radius * radius;
            shapeInertiaX = 0.15f * shapeMass * (radius * radius + halfHeight * halfHeight * (4.0f / 3.0f));
            shapeInertiaZ = shapeInertiaX;
        } else {
            const float hx = shape.extents.x;
            const float hy = shape.extents.y;
            const float hz = shape.extents.z;
            shapeMass = shape.density * kBoxVolume * hx * hy * hz;
            const float third = 1.0f / 3.0f;
            shapeInertiaX = shapeMass * (hy * hy + hz * hz) * third;
            shapeInertiaY = shapeMass * (hx * hx + hz * hz) * third;
            shapeInertiaZ = shapeMass * (hx * hx + hy * hy) * third;
        }

        const float dx = shape.offset.x;
        const float dy = shape.offset.y;
        const float dz = shape.offset.z;

        mass += shapeMass;
        inertiaX += shapeInertiaX + shapeMass * (dy * dy + dz * dz);
        inertiaY += shapeInertiaY + shapeMass * (dx * dx + dz * dz);
        inertiaZ += shapeInertiaZ + shapeMass * (dx * dx + dy * dy);
    }

    return isFinite(mass) && isFinite(inertiaX) && isFinite(inertiaY) && isFinite(inertiaZ);
}

size_t slotGenIndex(int32_t bodyId, int32_t slot) {
    return static_cast<size_t>(bodyId) * kMaxShapesPerBody + static_cast<size_t>(slot);
}

void invalidateSlot(World& world, int32_t bodyId, int32_t slot) {
    world.bodies[bodyId].shapes[slot].kind = kShapeNone;
    bumpSlotGeneration(world, bodyId, slot);
}

void invalidateAllSlots(World& world, int32_t bodyId) {
    Body& body = world.bodies[bodyId];
    for (int32_t slot = 0; slot < kMaxShapesPerBody; ++slot) {
        body.shapes[slot].kind = kShapeNone;
        bumpSlotGeneration(world, bodyId, slot);
    }
}

int32_t shapeHighWater(const Body& body) {
    int32_t count = body.shapeCount;
    while (count > 0 && !shapeValid(body.shapes[count - 1])) {
        --count;
    }
    return count;
}

void addAngularResponse(World& world, Body& body, int32_t id, const Vec3& angularImpulse) {
    const Vec3 inertia = body.invInertia;
    if (inertia.x == 0.0f && inertia.y == 0.0f && inertia.z == 0.0f) {
        return;
    }

    Vec3 local = body.rotation.transposeTransform(angularImpulse);
    local.x *= inertia.x;
    local.y *= inertia.y;
    local.z *= inertia.z;
    world.angularVelocities[id] += body.rotation.transform(local);
}

int32_t shapeSignature(const Body& body) {
    const int32_t slots = shapeSlots(body);
    if (slots == 1) {
        return body.shapes[0].kind;
    }
    if (slots == 0) {
        return kShapeNone;
    }
    return kMaxShapesPerBody + slots;
}

void wakeBody(World& world, int32_t id) {
    Body& body = world.bodies[id];
    body.awake = 1;
    body.sleepTime = 0.0f;
}

bool isSleepThreat(const World& world, int32_t id) {
    const Body& body = world.bodies[id];
    if (body.state == kBodyDynamic) {
        return body.awake != 0 && lengthSq(world.velocities[id]) > kSleepWakeSpeedSq;
    }
    if (body.state == kBodyKinematic) {
        return lengthSq(world.velocities[id]) > kSleepWakeSpeedSq;
    }
    return false;
}

void wakeSleepingOnContacts(World& world) {
    for (int32_t k = 0; k < world.contactCount; ++k) {
        const Contact& contact = world.contacts[k];
        Body& bodyA = world.bodies[contact.a];
        Body& bodyB = world.bodies[contact.b];
        const bool aSleeping = bodyA.state == kBodyDynamic && bodyA.awake == 0;
        const bool bSleeping = bodyB.state == kBodyDynamic && bodyB.awake == 0;
        if (aSleeping && !bSleeping && isSleepThreat(world, contact.b)) {
            wakeBody(world, contact.a);
        }
        if (bSleeping && !aSleeping && isSleepThreat(world, contact.a)) {
            wakeBody(world, contact.b);
        }
    }
}

struct Hasher {
    uint64_t value;

    Hasher() : value(14695981039346656037ull) {}

    void byte(uint8_t input) {
        value ^= input;
        value *= 1099511628211ull;
    }

    void u32(uint32_t input) {
        byte(static_cast<uint8_t>(input));
        byte(static_cast<uint8_t>(input >> 8));
        byte(static_cast<uint8_t>(input >> 16));
        byte(static_cast<uint8_t>(input >> 24));
    }

    void i32(int32_t input) {
        u32(static_cast<uint32_t>(input));
    }

    void f32(float input) {
        uint32_t bits = 0;
        memcpy(&bits, &input, sizeof(bits));
        u32(bits);
    }

    void vec3(const Vec3& input) {
        f32(input.x);
        f32(input.y);
        f32(input.z);
    }
};

}

bool recomputeMass(Body& body) {
    float mass = 0.0f;
    float inertiaX = 0.0f;
    float inertiaY = 0.0f;
    float inertiaZ = 0.0f;
    const bool finite = accumulateMass(body, mass, inertiaX, inertiaY, inertiaZ);

    if (body.state != kBodyDynamic || !finite) {
        zeroMass(body);
        return finite;
    }

    const bool overridden = body.customMass > 0.0f;
    if (mass <= 0.0f && !overridden) {
        zeroMass(body);
        return true;
    }

    const float effectiveMass = overridden ? body.customMass : mass;
    float inverse[3];
    inverse[0] = body.customInertia.x > 0.0f ? 1.0f / body.customInertia.x : (inertiaX > 0.0f ? 1.0f / inertiaX : 0.0f);
    inverse[1] = body.customInertia.y > 0.0f ? 1.0f / body.customInertia.y : (inertiaY > 0.0f ? 1.0f / inertiaY : 0.0f);
    inverse[2] = body.customInertia.z > 0.0f ? 1.0f / body.customInertia.z : (inertiaZ > 0.0f ? 1.0f / inertiaZ : 0.0f);

    const float invMass = effectiveMass > 0.0f ? 1.0f / effectiveMass : 0.0f;
    if (!isFinite(invMass) || !isFinite(inverse[0]) || !isFinite(inverse[1]) || !isFinite(inverse[2])) {
        zeroMass(body);
        return false;
    }

    body.invMass = invMass;
    body.invInertia = Vec3(inverse[0], inverse[1], inverse[2]);
    return true;
}

void bumpSlotGeneration(World& world, int32_t bodyId, int32_t slot) {
    uint16_t& entry = world.slotGen[slotGenIndex(bodyId, slot)];
    entry = static_cast<uint16_t>(entry + 1);
    world.invalidateStats();
}

int32_t firstFreeShapeSlot(const Body& body) {
    const int32_t limit = body.shapeCount > kMaxShapesPerBody ? kMaxShapesPerBody : body.shapeCount;
    for (int32_t slot = 0; slot < limit; ++slot) {
        if (!shapeValid(body.shapes[slot])) {
            return slot;
        }
    }
    if (body.shapeCount < kMaxShapesPerBody) {
        return body.shapeCount;
    }
    return -1;
}

bool World::init(Arena& arena, int32_t bodyCapacity, int32_t contactCapacity, Vec3 initialGravity) {
    initialized = false;
    if (bodyCapacity <= 0 || bodyCapacity > kMaxBodies ||
        contactCapacity <= 0 || contactCapacity > kMaxContacts ||
        !isFinite(initialGravity.x) || !isFinite(initialGravity.y) || !isFinite(initialGravity.z)) {
        return false;
    }

    maxBodies = bodyCapacity;
    maxContacts = contactCapacity;
    gravity = initialGravity;
    allowSleep = 0;
    boxManifoldPointCap = 8;
    highWater = 0;
    liveCount = 0;
    freeCount = 0;
    contactCount = 0;
    stepSerial = 0;
    statsSerial = -1;
    statsBroadphasePairs = 0;
    statsShapePairs = 0;
    m_stepStatistics = {};
#if AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE
    m_phaseNanoseconds = {};
#endif

    cacheCapacity = 64;
    while (cacheCapacity < maxContacts * 2) {
        cacheCapacity <<= 1;
    }
    cacheMask = static_cast<uint32_t>(cacheCapacity - 1);

    transforms = allocateArray<Transform>(arena, maxBodies);
    sleepTransforms = allocateArray<Transform>(arena, maxBodies);
    velocities = allocateArray<Vec3>(arena, maxBodies);
    angularVelocities = allocateArray<Vec3>(arena, maxBodies);
    packedContacts = allocateArray<PackedContact>(arena, maxContacts);
    bodies = allocateArray<Body>(arena, maxBodies);
    slotGen = allocateArray<uint16_t>(arena, maxBodies * kMaxShapesPerBody);
    sweepOrder = allocateArray<int32_t>(arena, maxBodies);
    sweepRecords = allocateArray<SweepRecord>(arena, maxBodies);
    freeIds = allocateArray<int32_t>(arena, maxBodies);
    contacts = allocateArray<Contact>(arena, maxContacts);
    int32_t constraintCapacity = maxBodies * 2;
    if (constraintCapacity < 256) {
        constraintCapacity = 256;
    }
    if (constraintCapacity > kMaxConstraints) {
        constraintCapacity = kMaxConstraints;
    }
    constraints = allocateArray<Constraint>(arena, constraintCapacity);
    constraintFreeIds = allocateArray<int32_t>(arena, constraintCapacity);
    static_assert(kMaxConstraints <= ((1 << 30) - 1) / 4, "suppressed pair table size must stay representable");
    static_assert(kMaxConstraints * 4 > 0, "suppressed pair table target must stay positive");
    int32_t suppressedTableSize = 16;
    const int32_t suppressedTableTarget = constraintCapacity * 4;
    while (suppressedTableSize < suppressedTableTarget && suppressedTableSize < (1 << 30)) {
        suppressedTableSize <<= 1;
    }
    if (suppressedTableSize < suppressedTableTarget) {
        return false;
    }
    suppressedKeys = allocateArray<int32_t>(arena, suppressedTableSize);
    suppressedMask = static_cast<uint32_t>(suppressedTableSize - 1);
    suppressedTableBuilt = false;
    cachePrev = allocateArray<CacheEntry>(arena, cacheCapacity);
    cacheNext = allocateArray<CacheEntry>(arena, cacheCapacity);
    cachePrevUsed = allocateArray<int32_t>(arena, maxContacts);
    cacheNextUsed = allocateArray<int32_t>(arena, maxContacts);

    if (transforms == nullptr || sleepTransforms == nullptr || velocities == nullptr || angularVelocities == nullptr ||
        packedContacts == nullptr || bodies == nullptr || slotGen == nullptr || sweepOrder == nullptr ||
        sweepRecords == nullptr ||
        freeIds == nullptr || contacts == nullptr || constraints == nullptr || constraintFreeIds == nullptr ||
        suppressedKeys == nullptr ||
        cachePrev == nullptr || cacheNext == nullptr ||
        cachePrevUsed == nullptr || cacheNextUsed == nullptr) {
        return false;
    }

    memset(slotGen, 0, sizeof(uint16_t) * static_cast<size_t>(maxBodies) * kMaxShapesPerBody);
    maxConstraints = constraintCapacity;
    constraintCount = 0;
    constraintFreeCount = maxConstraints;
    for (int32_t i = 0; i < maxConstraints; ++i) {
        Constraint& constraint = constraints[i];
        constraint.kind = kConstraintFree;
        constraint.bodyA = -1;
        constraint.bodyB = -1;
        constraint.enabled = 0;
        constraint.collideConnected = 1;
        constraint.cacheSlotA = -1;
        constraint.cacheSlotB = -1;
        constraint.feature = 0;
        constraint.enableLimit = 0;
        constraint.enableMotor = 0;
        constraint.nextFree = -1;
        for (int32_t row = 0; row < kMaxJointRows; ++row) {
            constraint.impulses[row] = 0.0f;
        }
        constraintFreeIds[i] = maxConstraints - 1 - i;
    }
    cachePrevUsedCount = 0;
    cacheNextUsedCount = 0;
    memset(cachePrev, 0, sizeof(CacheEntry) * static_cast<size_t>(cacheCapacity));
    memset(cacheNext, 0, sizeof(CacheEntry) * static_cast<size_t>(cacheCapacity));

    this->bulkArena = &arena;

    initialized = true;
    return true;
}

void World::reset() {
    if (!initialized) {
        return;
    }
    for (int32_t i = 0; i < highWater; ++i) {
        bodies[i].sleepTime = 0.0f;
        bodies[i].awake = 1;
    }
    highWater = 0;
    liveCount = 0;
    freeCount = 0;
    contactCount = 0;
    statsSerial = -1;
    m_stepStatistics = {};
#if AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE
    m_phaseNanoseconds = {};
#endif
    if (constraints != nullptr && constraintFreeIds != nullptr) {
        for (int32_t i = 0; i < maxConstraints; ++i) {
            Constraint& constraint = constraints[i];
            if (constraint.kind != kConstraintFree) {
                constraint.feature = (constraint.feature + 1) & kConstraintIdGenMask;
            }
            constraint.kind = kConstraintFree;
            constraint.bodyA = -1;
            constraint.bodyB = -1;
            constraint.enabled = 0;
            constraint.cacheSlotA = -1;
            constraint.cacheSlotB = -1;
            for (int32_t row = 0; row < kMaxJointRows; ++row) {
                constraint.impulses[row] = 0.0f;
            }
            constraintFreeIds[i] = maxConstraints - 1 - i;
        }
    }
    constraintCount = 0;
    constraintFreeCount = maxConstraints;
    suppressedTableBuilt = false;
    cachePrevUsedCount = 0;
    cacheNextUsedCount = 0;
    memset(cachePrev, 0, sizeof(CacheEntry) * static_cast<size_t>(cacheCapacity));
    memset(cacheNext, 0, sizeof(CacheEntry) * static_cast<size_t>(cacheCapacity));
}

bool World::isActive(int32_t id) const {
    return initialized && id >= 0 && id < highWater && bodies[id].state != kBodyFree;
}

void refreshBodyRotation(World& world, int32_t id) {
    Body& body = world.bodies[id];
    const Transform& transform = world.transforms[id];
    body.rotation.fromQuaternion(transform.qx, transform.qy, transform.qz, transform.qw);
}

void resetBodyRotation(World& world, int32_t id) {
    Body& body = world.bodies[id];
    const Transform& transform = world.transforms[id];
    body.rotation.setIdentity();
    body.rotation.fromQuaternion(transform.qx, transform.qy, transform.qz, transform.qw);
}

int32_t World::createBody(int32_t type, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    if (!initialized || (type != kBodyTypeStatic && type != kBodyTypeDynamic && type != kBodyTypeKinematic)) {
        return -1;
    }
    if (!isFinite(px) || !isFinite(py) || !isFinite(pz) ||
        !isFinite(qx) || !isFinite(qy) || !isFinite(qz) || !isFinite(qw)) {
        return -1;
    }

    int32_t id = -1;
    if (freeCount > 0) {
        id = freeIds[--freeCount];
    } else if (highWater < maxBodies) {
        id = highWater++;
    } else {
        return -1;
    }

    Transform transform = { px, py, pz, qx, qy, qz, qw };
    normalizeQuaternion(transform);
    transforms[id] = transform;
    velocities[id] = Vec3();
    angularVelocities[id] = Vec3();

    Body& body = bodies[id];
    body.state = type == kBodyTypeStatic ? kBodyStatic : (type == kBodyTypeDynamic ? kBodyDynamic : kBodyKinematic);
    body.shapeCount = 0;
    body.invMass = 0.0f;
    body.gravityScale = 1.0f;
    body.linearDamping = 0.0f;
    body.angularDamping = 0.0f;
    body.customMass = 0.0f;
    body.flags = 0;
    body.invInertia = Vec3();
    resetBodyRotation(*this, id);
    body.aabb = { 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f };
    body.friction = kDefaultFriction;
    body.restitution = 0.0f;
    body.sleepTime = 0.0f;
    body.awake = 1;
    body.customInertia = Vec3();
    body.forceAccum = Vec3();
    body.torqueAccum = Vec3();
    for (int32_t slot = 0; slot < kMaxShapesPerBody; ++slot) {
        body.shapes[slot].kind = kShapeNone;
        body.shapes[slot].resetBulkFields();
        if (shapeBulks != nullptr) {
            setBulkAt(id, slot, nullptr);
        }
    }

    ++liveCount;
    invalidateStats();
    return id;
}

int32_t World::destroyBody(int32_t id) {
    if (!isActive(id)) {
        return -1;
    }

    releaseConstraintsForBody(*this, id);
    Body& body = bodies[id];
    for (int32_t slot = 0; slot < kMaxShapesPerBody; ++slot) {
        clearShapeBulk(id, slot);
    }
    body.state = kBodyFree;
    body.shapeCount = 0;
    invalidateAllSlots(*this, id);
    body.invMass = 0.0f;
    body.invInertia = Vec3();
    body.aabb = { 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f };
    body.sleepTime = 0.0f;
    body.awake = 1;
    velocities[id] = Vec3();
    angularVelocities[id] = Vec3();

    freeIds[freeCount++] = id;
    --liveCount;
    contactCount = 0;
    return 0;
}

int32_t World::setSphere(int32_t id, float radius, float density) {
    if (!isActive(id) || !isFinite(radius) || !isFinite(density) || radius <= 0.0f || density < 0.0f) {
        return -1;
    }

    Body& body = bodies[id];
    const bool dynamic = body.state == kBodyDynamic;
    float mass = 0.0f;
    float inertia = 0.0f;
    float invMass = 0.0f;
    float invInertia = 0.0f;

    if (dynamic) {
        if (density <= 0.0f) {
            return -1;
        }
        mass = density * kSphereVolume * radius * radius * radius;
        inertia = kSphereInertia * mass * radius * radius;
        if (!isFinite(mass) || !isFinite(inertia) || mass <= 0.0f || inertia <= 0.0f) {
            return -1;
        }
        invMass = 1.0f / mass;
        invInertia = 1.0f / inertia;
        if (!isFinite(invMass) || !isFinite(invInertia)) {
            return -1;
        }
    }

    body.shapeCount = 1;
    invalidateAllSlots(*this, id);
    body.shapes[0].setSphere(radius, density, Vec3());
    recomputeMass(body);
    return 0;
}

int32_t World::setBox(int32_t id, float hx, float hy, float hz, float density) {
    if (!isActive(id) || !isFinite(hx) || !isFinite(hy) || !isFinite(hz) ||
        !isFinite(density) || hx <= 0.0f || hy <= 0.0f || hz <= 0.0f || density < 0.0f) {
        return -1;
    }

    Body& body = bodies[id];
    const bool dynamic = body.state == kBodyDynamic;
    float mass = 0.0f;
    float inertiaX = 0.0f;
    float inertiaY = 0.0f;
    float inertiaZ = 0.0f;
    float invMass = 0.0f;
    float invInertiaX = 0.0f;
    float invInertiaY = 0.0f;
    float invInertiaZ = 0.0f;

    if (dynamic) {
        if (density <= 0.0f) {
            return -1;
        }
        mass = density * kBoxVolume * hx * hy * hz;
        const float third = 1.0f / 3.0f;
        inertiaX = mass * (hy * hy + hz * hz) * third;
        inertiaY = mass * (hx * hx + hz * hz) * third;
        inertiaZ = mass * (hx * hx + hy * hy) * third;
        if (!isFinite(mass) || !isFinite(inertiaX) || !isFinite(inertiaY) || !isFinite(inertiaZ) ||
            mass <= 0.0f || inertiaX <= 0.0f || inertiaY <= 0.0f || inertiaZ <= 0.0f) {
            return -1;
        }
        invMass = 1.0f / mass;
        invInertiaX = 1.0f / inertiaX;
        invInertiaY = 1.0f / inertiaY;
        invInertiaZ = 1.0f / inertiaZ;
        if (!isFinite(invMass) || !isFinite(invInertiaX) || !isFinite(invInertiaY) || !isFinite(invInertiaZ)) {
            return -1;
        }
    }

    body.shapeCount = 1;
    invalidateAllSlots(*this, id);
    body.shapes[0].setBox(hx, hy, hz, density, Vec3(), 0.0f, 0.0f, 0.0f, 1.0f);
    recomputeMass(body);
    return 0;
}

int32_t World::addSphere(int32_t id, float radius, float density, float px, float py, float pz) {
    if (!isActive(id) || !isFinite(radius) || !isFinite(density) ||
        !isFinite(px) || !isFinite(py) || !isFinite(pz) ||
        radius <= 0.0f || density < 0.0f) {
        return -1;
    }

    Body& body = bodies[id];
    const int32_t slot = firstFreeShapeSlot(body);
    if (slot < 0) {
        return -1;
    }

    const int32_t previousCount = body.shapeCount;
    body.shapes[slot].setSphere(radius, density, Vec3(px, py, pz));
    bumpSlotGeneration(*this, id, slot);
    if (slot + 1 > body.shapeCount) {
        body.shapeCount = slot + 1;
    }

    if (!recomputeMass(body)) {
        body.shapes[slot].kind = kShapeNone;
        body.shapeCount = previousCount;
        recomputeMass(body);
        return -1;
    }
    return slot;
}

int32_t World::addBox(
    int32_t id,
    float hx,
    float hy,
    float hz,
    float density,
    float px,
    float py,
    float pz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    if (!isActive(id) || !isFinite(hx) || !isFinite(hy) || !isFinite(hz) || !isFinite(density) ||
        !isFinite(px) || !isFinite(py) || !isFinite(pz) ||
        !isFinite(qx) || !isFinite(qy) || !isFinite(qz) || !isFinite(qw) ||
        hx <= 0.0f || hy <= 0.0f || hz <= 0.0f || density < 0.0f) {
        return -1;
    }

    Body& body = bodies[id];
    if (body.shapeCount >= kMaxShapesPerBody) {
        return -1;
    }

    Transform local = { 0.0f, 0.0f, 0.0f, qx, qy, qz, qw };
    normalizeQuaternion(local);

    const int32_t slot = firstFreeShapeSlot(body);
    if (slot < 0) {
        return -1;
    }

    const int32_t previousCount = body.shapeCount;
    body.shapes[slot].setBox(hx, hy, hz, density, Vec3(px, py, pz), local.qx, local.qy, local.qz, local.qw);
    bumpSlotGeneration(*this, id, slot);
    if (slot + 1 > body.shapeCount) {
        body.shapeCount = slot + 1;
    }

    if (!recomputeMass(body)) {
        body.shapes[slot].kind = kShapeNone;
        body.shapeCount = previousCount;
        recomputeMass(body);
        return -1;
    }
    return slot;
}

int32_t World::addCapsule(
    int32_t id,
    float radius,
    float halfSegment,
    float density,
    float px,
    float py,
    float pz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    if (!isActive(id) || !isFinite(radius) || !isFinite(halfSegment) || !isFinite(density) ||
        !isFinite(px) || !isFinite(py) || !isFinite(pz) ||
        !isFinite(qx) || !isFinite(qy) || !isFinite(qz) || !isFinite(qw) ||
        radius <= 0.0f || halfSegment < 0.0f || density < 0.0f) {
        return -1;
    }

    Body& body = bodies[id];
    if (body.shapeCount >= kMaxShapesPerBody) {
        return -1;
    }

    Transform local = { 0.0f, 0.0f, 0.0f, qx, qy, qz, qw };
    normalizeQuaternion(local);

    const int32_t slot = firstFreeShapeSlot(body);
    if (slot < 0) {
        return -1;
    }

    const int32_t previousCount = body.shapeCount;
    body.shapes[slot].setCapsule(radius, halfSegment, density, Vec3(px, py, pz), local.qx, local.qy, local.qz, local.qw);
    bumpSlotGeneration(*this, id, slot);
    if (slot + 1 > body.shapeCount) {
        body.shapeCount = slot + 1;
    }

    if (!recomputeMass(body)) {
        body.shapes[slot].kind = kShapeNone;
        body.shapeCount = previousCount;
        recomputeMass(body);
        return -1;
    }
    return slot;
}

int32_t World::addCylinder(
    int32_t id,
    float radius,
    float halfHeight,
    float density,
    float px,
    float py,
    float pz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    if (!isActive(id) || !isFinite(radius) || !isFinite(halfHeight) || !isFinite(density) ||
        !isFinite(px) || !isFinite(py) || !isFinite(pz) ||
        !isFinite(qx) || !isFinite(qy) || !isFinite(qz) || !isFinite(qw) ||
        radius <= 0.0f || halfHeight <= 0.0f || density < 0.0f) {
        return -1;
    }

    Body& body = bodies[id];
    if (body.shapeCount >= kMaxShapesPerBody) {
        return -1;
    }

    Transform local = { 0.0f, 0.0f, 0.0f, qx, qy, qz, qw };
    normalizeQuaternion(local);

    const int32_t slot = firstFreeShapeSlot(body);
    if (slot < 0) {
        return -1;
    }

    const int32_t previousCount = body.shapeCount;
    body.shapes[slot].setCylinder(radius, halfHeight, density, Vec3(px, py, pz), local.qx, local.qy, local.qz, local.qw);
    bumpSlotGeneration(*this, id, slot);
    if (slot + 1 > body.shapeCount) {
        body.shapeCount = slot + 1;
    }

    if (!recomputeMass(body)) {
        body.shapes[slot].kind = kShapeNone;
        body.shapeCount = previousCount;
        recomputeMass(body);
        return -1;
    }
    return slot;
}

int32_t World::addCone(
    int32_t id,
    float radius,
    float halfHeight,
    float density,
    float px,
    float py,
    float pz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    if (!isActive(id) || !isFinite(radius) || !isFinite(halfHeight) || !isFinite(density) ||
        !isFinite(px) || !isFinite(py) || !isFinite(pz) ||
        !isFinite(qx) || !isFinite(qy) || !isFinite(qz) || !isFinite(qw) ||
        radius <= 0.0f || halfHeight <= 0.0f || density < 0.0f) {
        return -1;
    }

    Body& body = bodies[id];
    if (body.shapeCount >= kMaxShapesPerBody) {
        return -1;
    }

    Transform local = { 0.0f, 0.0f, 0.0f, qx, qy, qz, qw };
    normalizeQuaternion(local);

    const int32_t slot = firstFreeShapeSlot(body);
    if (slot < 0) {
        return -1;
    }

    const int32_t previousCount = body.shapeCount;
    body.shapes[slot].setCone(radius, halfHeight, density, Vec3(px, py, pz), local.qx, local.qy, local.qz, local.qw);
    bumpSlotGeneration(*this, id, slot);
    if (slot + 1 > body.shapeCount) {
        body.shapeCount = slot + 1;
    }

    if (!recomputeMass(body)) {
        body.shapes[slot].kind = kShapeNone;
        body.shapeCount = previousCount;
        recomputeMass(body);
        return -1;
    }
    return slot;
}

int32_t World::clearShapes(int32_t id) {
    if (!isActive(id)) {
        return -1;
    }

    Body& body = bodies[id];
    for (int32_t slot = 0; slot < kMaxShapesPerBody; ++slot) {
        clearShapeBulk(id, slot);
    }
    body.shapeCount = 0;
    invalidateAllSlots(*this, id);
    body.aabb = { 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f };
    recomputeMass(body);
    return 0;
}

int32_t World::shapeClear(int32_t bodyId) {
    return clearShapes(bodyId);
}

int32_t World::shapeDestroy(int32_t shapeId) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    if (!shapeIdResolve(shapeId, bodyId, slot)) {
        return -1;
    }

    Body& body = bodies[bodyId];
    clearShapeBulk(bodyId, slot);
    invalidateSlot(*this, bodyId, slot);
    body.shapeCount = shapeHighWater(body);
    recomputeMass(body);
    return 0;
}

int32_t World::shapeMakeId(int32_t bodyId, int32_t slot) const {
    if (!initialized || bodyId < 0 || bodyId >= highWater || slot < 0 || slot >= kMaxShapesPerBody || slotGen == nullptr) {
        return -1;
    }
    const int32_t generation = static_cast<int32_t>(slotGen[slotGenIndex(bodyId, slot)] & kShapeIdGenMask);
    return shapeEncodeId(generation, bodyId, slot);
}

bool World::shapeIdResolve(int32_t shapeId, int32_t& bodyId, int32_t& slot) const {
    if (!initialized || slotGen == nullptr || !shapeIdInRange(shapeId)) {
        return false;
    }
    const int32_t decodedBody = shapeDecodeBodyId(shapeId);
    if (decodedBody >= highWater) {
        return false;
    }
    if (bodies[decodedBody].state == kBodyFree) {
        return false;
    }
    const int32_t decodedSlot = shapeDecodeSlot(shapeId);
    if (decodedSlot >= kMaxShapesPerBody) {
        return false;
    }
    if (!shapeValid(bodies[decodedBody].shapes[decodedSlot])) {
        return false;
    }
    const int32_t generation = static_cast<int32_t>(slotGen[slotGenIndex(decodedBody, decodedSlot)] & kShapeIdGenMask);
    if (generation != shapeDecodeGeneration(shapeId)) {
        return false;
    }
    bodyId = decodedBody;
    slot = decodedSlot;
    return true;
}

namespace {

bool shapeSlotAddressable(const World& world, int32_t bodyId, int32_t slot) {
    if (!world.isActive(bodyId) || slot < 0 || slot >= kMaxShapesPerBody) {
        return false;
    }
    return shapeValid(world.bodies[bodyId].shapes[slot]);
}

bool shapeMaterialValueAccepted(float value) {
    return isFinite(value) && (value == kShapeMaterialInherit || value >= 0.0f);
}

}

int32_t World::setShapeMaterial(int32_t bodyId, int32_t slot, float friction, float restitution) {
    if (!shapeSlotAddressable(*this, bodyId, slot) ||
        !shapeMaterialValueAccepted(friction) || !shapeMaterialValueAccepted(restitution)) {
        return -1;
    }
    Shape& shape = bodies[bodyId].shapes[slot];
    shape.friction = friction;
    shape.restitution = restitution >= 0.0f ? clampf(restitution, 0.0f, 1.0f) : restitution;
    return 0;
}

int32_t World::setShapeSensor(int32_t bodyId, int32_t slot, int32_t on) {
    if (!shapeSlotAddressable(*this, bodyId, slot) || (on != 0 && on != 1)) {
        return -1;
    }
    bodies[bodyId].shapes[slot].sensor = on;
    return 0;
}

int32_t World::setShapeFilter(int32_t bodyId, int32_t slot, int32_t categoryBits, int32_t maskBits, int32_t groupIndex) {
    if (!shapeSlotAddressable(*this, bodyId, slot)) {
        return -1;
    }
    Shape& shape = bodies[bodyId].shapes[slot];
    shape.categoryBits = categoryBits;
    shape.maskBits = maskBits;
    shape.groupIndex = groupIndex;
    invalidateStats();
    return 0;
}

int32_t World::setTransform(int32_t id, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    if (!isActive(id) || !isFinite(px) || !isFinite(py) || !isFinite(pz) ||
        !isFinite(qx) || !isFinite(qy) || !isFinite(qz) || !isFinite(qw)) {
        return -1;
    }

    Transform transform = { px, py, pz, qx, qy, qz, qw };
    normalizeQuaternion(transform);
    transforms[id] = transform;
    Body& body = bodies[id];
    refreshBodyRotation(*this, id);
    body.awake = 1;
    body.sleepTime = 0.0f;
    return 0;
}

int32_t World::setVelocity(int32_t id, float vx, float vy, float vz) {
    if (!isActive(id) || !isFinite(vx) || !isFinite(vy) || !isFinite(vz)) {
        return -1;
    }
    velocities[id] = Vec3(vx, vy, vz);
    bodies[id].awake = 1;
    bodies[id].sleepTime = 0.0f;
    return 0;
}

int32_t World::setAngularVelocity(int32_t id, float vx, float vy, float vz) {
    if (!isActive(id) || !isFinite(vx) || !isFinite(vy) || !isFinite(vz)) {
        return -1;
    }
    angularVelocities[id] = Vec3(vx, vy, vz);
    bodies[id].awake = 1;
    bodies[id].sleepTime = 0.0f;
    return 0;
}

int32_t World::setMaterial(int32_t id, float friction, float restitution) {
    if (!isActive(id) || !isFinite(friction) || !isFinite(restitution) || friction < 0.0f || restitution < 0.0f) {
        return -1;
    }
    bodies[id].friction = friction;
    bodies[id].restitution = clampf(restitution, 0.0f, 1.0f);
    return 0;
}

int32_t World::setDamping(int32_t id, float linear, float angular) {
    if (!isActive(id) || !isFinite(linear) || !isFinite(angular) || linear < 0.0f || angular < 0.0f) {
        return -1;
    }
    bodies[id].linearDamping = linear;
    bodies[id].angularDamping = angular;
    return 0;
}

int32_t World::setGravityScale(int32_t id, float scale) {
    if (!isActive(id) || !isFinite(scale)) {
        return -1;
    }
    bodies[id].gravityScale = scale;
    return 0;
}

int32_t World::setFlags(int32_t id, int32_t setMask, int32_t clearMask) {
    if (!isActive(id) || setMask < 0 || clearMask < 0) {
        return -1;
    }
    Body& body = bodies[id];
    body.flags = (body.flags | setMask) & ~clearMask;
    return 0;
}

int32_t World::applyForce(int32_t id, float fx, float fy, float fz, float px, float py, float pz) {
    if (!isActive(id)) {
        return -1;
    }
    Body& body = bodies[id];
    if (body.state != kBodyDynamic) {
        return -1;
    }
    if (!isFinite(fx) || !isFinite(fy) || !isFinite(fz) ||
        !isFinite(px) || !isFinite(py) || !isFinite(pz)) {
        return -1;
    }
    const Vec3 force(fx, fy, fz);
    body.forceAccum += force;
    body.torqueAccum += cross(Vec3(px, py, pz), force);
    body.awake = 1;
    body.sleepTime = 0.0f;
    return 0;
}

int32_t World::applyImpulse(int32_t id, float ix, float iy, float iz, float px, float py, float pz) {
    if (!isActive(id)) {
        return -1;
    }
    Body& body = bodies[id];
    if (body.state != kBodyDynamic) {
        return -1;
    }
    if (!isFinite(ix) || !isFinite(iy) || !isFinite(iz) ||
        !isFinite(px) || !isFinite(py) || !isFinite(pz)) {
        return -1;
    }
    const Vec3 impulse(ix, iy, iz);
    velocities[id] += impulse * body.invMass;
    addAngularResponse(*this, body, id, cross(Vec3(px, py, pz), impulse));
    body.awake = 1;
    body.sleepTime = 0.0f;
    return 0;
}

int32_t World::applyTorque(int32_t id, float tx, float ty, float tz) {
    if (!isActive(id)) {
        return -1;
    }
    Body& body = bodies[id];
    if (body.state != kBodyDynamic) {
        return -1;
    }
    if (!isFinite(tx) || !isFinite(ty) || !isFinite(tz)) {
        return -1;
    }
    body.torqueAccum += Vec3(tx, ty, tz);
    body.awake = 1;
    body.sleepTime = 0.0f;
    return 0;
}

int32_t World::applyAngularImpulse(int32_t id, float ix, float iy, float iz) {
    if (!isActive(id)) {
        return -1;
    }
    Body& body = bodies[id];
    if (body.state != kBodyDynamic) {
        return -1;
    }
    if (!isFinite(ix) || !isFinite(iy) || !isFinite(iz)) {
        return -1;
    }
    addAngularResponse(*this, body, id, Vec3(ix, iy, iz));
    body.awake = 1;
    body.sleepTime = 0.0f;
    return 0;
}

int32_t World::setMassData(int32_t id, float mass, float ix, float iy, float iz) {
    if (!isActive(id) || !isFinite(mass) || !isFinite(ix) || !isFinite(iy) || !isFinite(iz)) {
        return -1;
    }

    Body& body = bodies[id];
    if (body.state != kBodyDynamic) {
        return 0;
    }

    if (mass <= 0.0f) {
        body.customMass = 0.0f;
        body.customInertia = Vec3();
        recomputeMass(body);
        return 0;
    }

    if (!isFinite(1.0f / mass)) {
        return -1;
    }

    const Vec3 requested(ix > 0.0f ? ix : 0.0f, iy > 0.0f ? iy : 0.0f, iz > 0.0f ? iz : 0.0f);
    if ((requested.x > 0.0f && !isFinite(1.0f / requested.x)) ||
        (requested.y > 0.0f && !isFinite(1.0f / requested.y)) ||
        (requested.z > 0.0f && !isFinite(1.0f / requested.z))) {
        return -1;
    }

    const float previousMass = body.customMass;
    const Vec3 previousInertia = body.customInertia;
    body.customMass = mass;
    body.customInertia = requested;
    if (!recomputeMass(body)) {
        body.customMass = previousMass;
        body.customInertia = previousInertia;
        recomputeMass(body);
        return -1;
    }
    return 0;
}

int32_t World::setGravity(float gx, float gy, float gz) {
    if (!initialized || !isFinite(gx) || !isFinite(gy) || !isFinite(gz)) {
        return -1;
    }
    gravity = Vec3(gx, gy, gz);
    return 0;
}

int32_t World::setAllowSleep(int32_t on) {
    if (!initialized || (on != 0 && on != 1)) {
        return -1;
    }
    allowSleep = on;
    return 0;
}

int32_t World::setAwake(int32_t id, int32_t awake) {
    if (!isActive(id) || (awake != 0 && awake != 1)) {
        return -1;
    }
    Body& body = bodies[id];
    if (awake == 0 && body.state != kBodyDynamic) {
        return -1;
    }
    body.awake = awake;
    body.sleepTime = 0.0f;
    if (awake == 0) {
        velocities[id] = Vec3();
        angularVelocities[id] = Vec3();
    }
    return 0;
}

int32_t World::isSleeping(int32_t id) const {
    if (!isActive(id)) {
        return -1;
    }
    const Body& body = bodies[id];
    return body.state == kBodyDynamic && body.awake == 0 ? 1 : 0;
}

int32_t World::step(float dt, int32_t velocityIterations, int32_t positionIterations) {
    if (!initialized) {
        return -1;
    }
    if (!isFinite(dt) || dt <= 0.0f) {
        return -1;
    }
    if (dt > kMaxDt) {
        dt = kMaxDt;
    }
    velocityIterations = velocityIterations < 0 ? 0 : (velocityIterations > kMaxIterations ? kMaxIterations : velocityIterations);
    positionIterations = positionIterations < 0 ? 0 : (positionIterations > kMaxIterations ? kMaxIterations : positionIterations);

    ++stepSerial;
    resetStepCounters(m_stepStatistics);
#if AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE
    m_phaseNanoseconds = {};
#endif
    const Vec3 gravityStep = gravity * dt;
    const bool sleepEnabled = allowSleep != 0;

    AXRONE_PHASE(integrateScope, m_phaseNanoseconds.integrate);
    for (int32_t i = 0; i < highWater; ++i) {
        Body& body = bodies[i];
        const int32_t state = body.state;
        if (state != kBodyDynamic && state != kBodyKinematic) {
            continue;
        }

        if (state == kBodyDynamic) {
            if (sleepEnabled && body.awake == 0) {
                sleepTransforms[i] = transforms[i];
                continue;
            }
            if (!sleepEnabled) {
                body.awake = 1;
                body.sleepTime = 0.0f;
            }
        }

        Vec3& velocity = velocities[i];
        Vec3& angularVelocity = angularVelocities[i];

        if (state == kBodyDynamic) {
            if (body.forceAccum.x != 0.0f || body.forceAccum.y != 0.0f || body.forceAccum.z != 0.0f) {
                velocity += (body.forceAccum * dt) * body.invMass;
            }
            if (body.torqueAccum.x != 0.0f || body.torqueAccum.y != 0.0f || body.torqueAccum.z != 0.0f) {
                addAngularResponse(*this, body, i, body.torqueAccum * dt);
            }
            body.forceAccum = Vec3();
            body.torqueAccum = Vec3();
            velocity += gravityStep * body.gravityScale;
        }

        float linearFactor = 1.0f - body.linearDamping * dt;
        if (linearFactor < 0.0f) {
            linearFactor = 0.0f;
        }
        velocity *= linearFactor;

        float angularFactor = 1.0f - body.angularDamping * dt;
        if (angularFactor < 0.0f) {
            angularFactor = 0.0f;
        }
        angularVelocity *= angularFactor;

        const int32_t flags = body.flags;
        if ((flags & kBodyFreezePositionX) != 0) {
            velocity.x = 0.0f;
        }
        if ((flags & kBodyFreezePositionY) != 0) {
            velocity.y = 0.0f;
        }
        if ((flags & kBodyFreezePositionZ) != 0) {
            velocity.z = 0.0f;
        }
        if ((flags & kBodyFreezeRotationX) != 0) {
            angularVelocity.x = 0.0f;
        }
        if ((flags & kBodyFreezeRotationY) != 0) {
            angularVelocity.y = 0.0f;
        }
        if ((flags & kBodyFreezeRotationZ) != 0) {
            angularVelocity.z = 0.0f;
        }

        Transform& transform = transforms[i];
        if ((flags & kBodyFreezePositionX) == 0) {
            transform.px += velocity.x * dt;
        }
        if ((flags & kBodyFreezePositionY) == 0) {
            transform.py += velocity.y * dt;
        }
        if ((flags & kBodyFreezePositionZ) == 0) {
            transform.pz += velocity.z * dt;
        }
        integrateRotation(transform, angularVelocity, dt);
        refreshBodyRotation(*this, i);
    }
    AXRONE_PHASE_CLOSE(integrateScope);

    buildSuppressedPairTable(*this);

    AXRONE_PHASE(broadphaseScope, m_phaseNanoseconds.broadphase);
    updateBounds(*this);
    contactCount = 0;
    for (int32_t i = 0; i < cacheNextUsedCount; ++i) {
        cacheNext[cacheNextUsed[i]].keyA = 0;
    }
    cacheNextUsedCount = 0;
    broadphase(*this);
    AXRONE_PHASE_CLOSE(broadphaseScope);

    AXRONE_PHASE(prepareScope, m_phaseNanoseconds.prepare);
    prepareContacts(*this);
    AXRONE_PHASE_CLOSE(prepareScope);

    AXRONE_PHASE(assembleScope, m_phaseNanoseconds.assembleConstraints);
    prepareConstraints(*this, dt);
    AXRONE_PHASE_CLOSE(assembleScope);

    AXRONE_PHASE(wakeScope, m_phaseNanoseconds.sleepAndCacheSwap);
    if (sleepEnabled) {
        wakeSleepingOnContacts(*this);
    }
    AXRONE_PHASE_CLOSE(wakeScope);

    AXRONE_PHASE_COND(velocityScope, m_phaseNanoseconds.solveVelocities, velocityIterations > 0);
    solveVelocities(*this, velocityIterations);
    AXRONE_PHASE_CLOSE(velocityScope);

    AXRONE_PHASE_COND(positionScope, m_phaseNanoseconds.solvePositions, positionIterations > 0);
    solvePositions(*this, positionIterations);
    AXRONE_PHASE_CLOSE(positionScope);

    AXRONE_PHASE(sleepScope, m_phaseNanoseconds.sleepAndCacheSwap);
    if (sleepEnabled) {
        for (int32_t i = 0; i < highWater; ++i) {
            Body& body = bodies[i];
            if (body.state != kBodyDynamic) {
                continue;
            }
            if (body.awake == 0) {
                transforms[i] = sleepTransforms[i];
                refreshBodyRotation(*this, i);
                velocities[i] = Vec3();
                angularVelocities[i] = Vec3();
                continue;
            }
            if (lengthSq(velocities[i]) < kSleepLinearThresholdSq &&
                lengthSq(angularVelocities[i]) < kSleepAngularThresholdSq) {
                body.sleepTime += dt;
                if (body.sleepTime >= kSleepTimeLimit) {
                    body.awake = 0;
                    velocities[i] = Vec3();
                    angularVelocities[i] = Vec3();
                }
            } else {
                body.sleepTime = 0.0f;
            }
        }
    }

    for (int32_t k = 0; k < contactCount; ++k) {
        const Contact& contact = contacts[k];
        if (contact.cacheSlot < 0) {
            continue;
        }
        CacheEntry& entry = cacheNext[contact.cacheSlot];
        entry.impN = contact.impN;
        entry.impT1 = contact.impT1;
        entry.impT2 = contact.impT2;
    }

    for (int32_t index = 0; index < cachePrevUsedCount; ++index) {
        ++m_stepStatistics.pointIdentitiesPrevStep;
        if (cacheContains(cacheNext, cacheMask, cacheCapacity, cachePrev[cachePrevUsed[index]])) {
            ++m_stepStatistics.pointIdentitiesRepeatingPrevStep;
        }
    }

    CacheEntry* previousTable = cachePrev;
    cachePrev = cacheNext;
    cacheNext = previousTable;

    int32_t* previousUsed = cachePrevUsed;
    cachePrevUsed = cacheNextUsed;
    cacheNextUsed = previousUsed;

    const int32_t previousUsedCount = cachePrevUsedCount;
    cachePrevUsedCount = cacheNextUsedCount;
    cacheNextUsedCount = previousUsedCount;
    AXRONE_PHASE_CLOSE(sleepScope);

    AXRONE_PHASE(packScope, m_phaseNanoseconds.pack);
    writePackedContacts(*this);
    AXRONE_PHASE_CLOSE(packScope);

    ++m_stepStatistics.stepsRecorded;
    return contactCount;
}

int32_t World::bodyCount() const {
    return liveCount;
}

int32_t World::getContactCount() const {
    return contactCount;
}

int32_t World::cacheLookup(int32_t a, int32_t b, int32_t feature) const {
    uint32_t index = contactHash(a, b, feature) & cacheMask;
    for (int32_t probe = 0; probe < cacheCapacity; ++probe) {
        const CacheEntry& entry = cachePrev[index];
        if (entry.keyA == 0) {
            return -1;
        }
        if (entry.keyA == a + 1 && entry.keyB == b && entry.feature == feature) {
            return static_cast<int32_t>(index);
        }
        index = (index + 1) & cacheMask;
    }
    return -1;
}

void World::recordCacheLookup() {
    ++m_stepStatistics.cacheLookups;
}

void World::recordCacheHit() {
    ++m_stepStatistics.cacheHits;
}

int32_t World::cacheStore(int32_t a, int32_t b, int32_t feature, float impN, float impT1, float impT2) {
    if (cacheNextUsedCount >= maxContacts) {
        return -1;
    }
    uint32_t index = contactHash(a, b, feature) & cacheMask;
    for (int32_t probe = 0; probe < cacheCapacity; ++probe) {
        CacheEntry& entry = cacheNext[index];
        if (entry.keyA == 0) {
            entry.keyA = a + 1;
            entry.keyB = b;
            entry.feature = feature;
            entry.impN = impN;
            entry.impT1 = impT1;
            entry.impT2 = impT2;
            cacheNextUsed[cacheNextUsedCount++] = static_cast<int32_t>(index);
            ++m_stepStatistics.cacheStores;
            return static_cast<int32_t>(index);
        }
        index = (index + 1) & cacheMask;
    }
    return -1;
}

uint64_t World::fingerprint() const {
    Hasher hasher;
    hasher.i32(highWater);
    hasher.i32(contactCount);

    for (int32_t i = 0; i < highWater; ++i) {
        const Body& body = bodies[i];
        hasher.i32(body.state);
        hasher.i32(shapeSignature(body));
        if (body.state == kBodyFree) {
            continue;
        }
        const Transform& transform = transforms[i];
        hasher.f32(transform.px);
        hasher.f32(transform.py);
        hasher.f32(transform.pz);
        hasher.f32(transform.qx);
        hasher.f32(transform.qy);
        hasher.f32(transform.qz);
        hasher.f32(transform.qw);
        hasher.vec3(velocities[i]);
        hasher.vec3(angularVelocities[i]);
    }

    for (int32_t i = 0; i < contactCount; ++i) {
        const PackedContact& contact = packedContacts[i];
        hasher.i32(contact.a);
        hasher.i32(contact.b);
        hasher.f32(contact.nx);
        hasher.f32(contact.ny);
        hasher.f32(contact.nz);
        hasher.f32(contact.pen);
    }

    return hasher.value;
}

}
