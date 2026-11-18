#pragma once

#include <stddef.h>
#include <stdint.h>

#include "core/body.h"
#include "core/contact.h"
#include "core/constraints.h"
#include "core/math.h"
#include "core/query.h"
#include "core/timers.h"

namespace axrone::physics {

class Arena;
struct HullBuildScratch;
struct NarrowphaseScratch;

struct World {
    bool initialized = false;
    int32_t maxBodies = 0;
    int32_t maxContacts = 0;
    int32_t cacheCapacity = 0;
    uint32_t cacheMask = 0;
    int32_t highWater = 0;
    int32_t liveCount = 0;
    int32_t freeCount = 0;
    int32_t contactCount = 0;
    int32_t maxConstraints = 0;
    int32_t constraintCount = 0;
    int32_t constraintFreeCount = 0;
    Vec3 gravity = {};
    int32_t allowSleep = 0;
    int32_t boxManifoldPointCapRaw = 0; // zero means the default cap

    Arena* bulkArena = nullptr;
    NarrowphaseScratch* narrowphaseScratch = nullptr;
    HullBuildScratch* hullScratch = nullptr;
    size_t bulkPoolBaseOffset = 0;
    uintptr_t scratchBegin = 0;
    uintptr_t scratchCursor = 0;
    uintptr_t scratchEnd = 0;

    Transform* transforms = nullptr;
    Transform* sleepTransforms = nullptr;
    Vec3* velocities = nullptr;
    Vec3* angularVelocities = nullptr;
    PackedContact* packedContacts = nullptr;
    Body* bodies = nullptr;
    uint16_t* slotGen = nullptr;
    ShapeBulk** shapeBulks = nullptr;
    int32_t* sweepOrder = nullptr;
    SweepRecord* sweepRecords = nullptr;
    int32_t* freeIds = nullptr;
    Contact* contacts = nullptr;
    Constraint* constraints = nullptr;
    int32_t* constraintFreeIds = nullptr;
    int32_t* suppressedKeys = nullptr;
    uint32_t suppressedMask = 0;
    bool suppressedTableBuilt = false;
    CacheEntry* cachePrev = nullptr;
    CacheEntry* cacheNext = nullptr;
    int32_t* cachePrevUsed = nullptr;
    int32_t* cacheNextUsed = nullptr;
    int32_t cachePrevUsedCount = 0;
    int32_t cacheNextUsedCount = 0;

    int64_t stepSerial = 0;
    int64_t statsSerialPlusOne = 0; // zero means "no statistics for the current step"
    int64_t statsBroadphasePairs = 0;
    int64_t statsShapePairs = 0;
    StepStatistics m_stepStatistics = {};
#if AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE
    PhaseNanoseconds m_phaseNanoseconds = {};
#endif

    bool init(Arena& arena, int32_t maxBodies, int32_t maxContacts, Vec3 gravity);
    void reset();
    int32_t createBody(int32_t type, float px, float py, float pz, float qx, float qy, float qz, float qw);
    int32_t destroyBody(int32_t id);
    int32_t setSphere(int32_t id, float radius, float density);
    int32_t setBox(int32_t id, float hx, float hy, float hz, float density);
    int32_t addSphere(int32_t id, float radius, float density, float px, float py, float pz);
    int32_t addBox(
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
        float qw);
    int32_t addCapsule(
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
        float qw);
    int32_t addCylinder(
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
        float qw);
    int32_t addCone(
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
        float qw);
    int32_t clearShapes(int32_t id);
    int32_t shapeDestroy(int32_t shapeId);
    int32_t shapeClear(int32_t bodyId);
    int32_t addHull(
        int32_t id,
        float density,
        float px,
        float py,
        float pz,
        float qx,
        float qy,
        float qz,
        float qw);
    int32_t addMesh(
        int32_t id,
        float density,
        float px,
        float py,
        float pz,
        float qx,
        float qy,
        float qz,
        float qw);
    int32_t addHeightField(
        int32_t id,
        float density,
        float px,
        float py,
        float pz,
        float qx,
        float qy,
        float qz,
        float qw);
    int32_t setShapeVertices(int32_t shapeId, uintptr_t address, int32_t count);
    int32_t setShapeIndices(int32_t shapeId, uintptr_t address, int32_t count);
    int32_t setShapeHeightField(
        int32_t shapeId,
        uintptr_t address,
        int32_t width,
        int32_t depth,
        float scaleX,
        float scaleY,
        float scaleZ);
    uintptr_t bulkAlloc(int32_t bytes);
    int32_t bulkRelease(uintptr_t address);
    size_t bulkScratchUsed() const;
    size_t bulkArenaUsed() const;
    void clearShapeBulk(int32_t bodyId, int32_t slot);
    bool ensureBulkPool();

    ShapeBulk* bulkOf(int32_t bodyId, int32_t slot) const {
        if (shapeBulks == nullptr || bodyId < 0 || slot < 0 || slot >= kMaxShapesPerBody) {
            return nullptr;
        }
        return shapeBulks[static_cast<size_t>(bodyId) * kMaxShapesPerBody + static_cast<size_t>(slot)];
    }

    void setBulkAt(int32_t bodyId, int32_t slot, ShapeBulk* bulk) {
        shapeBulks[static_cast<size_t>(bodyId) * kMaxShapesPerBody + static_cast<size_t>(slot)] = bulk;
    }
    int32_t addBulkShape(
        int32_t kind,
        int32_t id,
        float density,
        float px,
        float py,
        float pz,
        float qx,
        float qy,
        float qz,
        float qw);
    int32_t shapeMakeId(int32_t bodyId, int32_t slot) const;
    bool shapeIdResolve(int32_t shapeId, int32_t& bodyId, int32_t& slot) const;
    int32_t setShapeMaterial(int32_t bodyId, int32_t slot, float friction, float restitution);
    int32_t setShapeSensor(int32_t bodyId, int32_t slot, int32_t on);
    int32_t setShapeFilter(int32_t bodyId, int32_t slot, int32_t categoryBits, int32_t maskBits, int32_t groupIndex);
    int32_t setTransform(int32_t id, float px, float py, float pz, float qx, float qy, float qz, float qw);
    int32_t setVelocity(int32_t id, float vx, float vy, float vz);
    int32_t setAngularVelocity(int32_t id, float vx, float vy, float vz);
    int32_t setMaterial(int32_t id, float friction, float restitution);
    int32_t setDamping(int32_t id, float linear, float angular);
    int32_t setGravityScale(int32_t id, float scale);
    int32_t setFlags(int32_t id, int32_t setMask, int32_t clearMask);
    int32_t applyForce(int32_t id, float fx, float fy, float fz, float px, float py, float pz);
    int32_t applyImpulse(int32_t id, float ix, float iy, float iz, float px, float py, float pz);
    int32_t applyTorque(int32_t id, float tx, float ty, float tz);
    int32_t applyAngularImpulse(int32_t id, float ix, float iy, float iz);
    int32_t setMassData(int32_t id, float mass, float ix, float iy, float iz);
    int32_t setGravity(float gx, float gy, float gz);
    int32_t setAllowSleep(int32_t on);
    int32_t setAwake(int32_t id, int32_t awake);
    int32_t isSleeping(int32_t id) const;
    int32_t step(float dt, int32_t velocityIterations, int32_t positionIterations);

    int32_t createFixed(int32_t bodyA, int32_t bodyB, Vec3 anchorA, Vec3 anchorB, int32_t collideConnected);
    int32_t createHinge(
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
        int32_t collideConnected);
    int32_t createSlider(
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
        int32_t collideConnected);
    int32_t createSpring(
        int32_t bodyA,
        int32_t bodyB,
        Vec3 anchorA,
        Vec3 anchorB,
        float restLength,
        float stiffness,
        float damping,
        int32_t collideConnected);
    int32_t destroyConstraint(int32_t id);
    int32_t setConstraintEnabled(int32_t id, int32_t enabled);
    int32_t setHingeMotor(int32_t id, float speed, float maxTorque);
    int32_t setHingeLimit(int32_t id, int32_t enable, float lower, float upper);
    int32_t setSliderMotor(int32_t id, float speed, float maxForce);
    int32_t setSliderLimit(int32_t id, int32_t enable, float lower, float upper);
    bool constraintResolve(int32_t id, Constraint*& out) const;

    int32_t bodyCount() const;
    int32_t getContactCount() const;
    uint64_t fingerprint() const;

    AXRONE_PHYSICS_INLINE int32_t boxManifoldPointCap() const {
        return boxManifoldPointCapRaw == 0 ? 8 : boxManifoldPointCapRaw;
    }

    void invalidateStats() {
        statsSerialPlusOne = 0;
    }

    const StepStatistics& stepStatistics() const {
        return m_stepStatistics;
    }

    StepStatistics& mutableStepStatistics() {
        return m_stepStatistics;
    }

#if AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE
    PhaseTimers phaseTimers() const {
        PhaseTimers timers{};
        const uint64_t collide = m_phaseNanoseconds.collide;
        const uint64_t swept = m_phaseNanoseconds.broadphase;
        timers.recordVersion = 1;
        timers.recordBytes = static_cast<uint32_t>(sizeof(PhaseTimers));
        timers.integrate = phaseSecondsFromNanoseconds(m_phaseNanoseconds.integrate);
        timers.broadphase = phaseSecondsFromNanoseconds(swept > collide ? swept - collide : 0);
        timers.collide = phaseSecondsFromNanoseconds(collide);
        timers.prepare = phaseSecondsFromNanoseconds(m_phaseNanoseconds.prepare);
        timers.assembleConstraints = phaseSecondsFromNanoseconds(m_phaseNanoseconds.assembleConstraints);
        timers.solveVelocities = phaseSecondsFromNanoseconds(m_phaseNanoseconds.solveVelocities);
        timers.solvePositions = phaseSecondsFromNanoseconds(m_phaseNanoseconds.solvePositions);
        timers.sleepAndCacheSwap = phaseSecondsFromNanoseconds(m_phaseNanoseconds.sleepAndCacheSwap);
        timers.pack = phaseSecondsFromNanoseconds(m_phaseNanoseconds.pack);
        timers.sweepSort = phaseSecondsFromNanoseconds(m_phaseNanoseconds.sweepSort);
        timers.pairLoop = phaseSecondsFromNanoseconds(m_phaseNanoseconds.pairLoop);
        return timers;
    }

    uint64_t phaseTimerSweptNanoseconds() const {
        return m_phaseNanoseconds.broadphase;
    }

    uint64_t phaseTimerCollideNanoseconds() const {
        return m_phaseNanoseconds.collide;
    }

    int32_t phaseTimerClampFired() const {
        return m_phaseNanoseconds.broadphase < m_phaseNanoseconds.collide ? 1 : 0;
    }
#endif

    bool isActive(int32_t id) const;
    int32_t cacheLookup(int32_t a, int32_t b, int32_t feature) const;
    void recordCacheLookup();
    void recordCacheHit();
    int32_t cacheStore(int32_t a, int32_t b, int32_t feature, float impN, float impT1, float impT2);
};

static_assert(sizeof(World) <= 1024,
              "World must remain a small descriptor; large worksets belong in arena-backed scratch");

bool recomputeMass(Body& body);
int32_t firstFreeShapeSlot(const Body& body);
void bumpSlotGeneration(World& world, int32_t bodyId, int32_t slot);

}
