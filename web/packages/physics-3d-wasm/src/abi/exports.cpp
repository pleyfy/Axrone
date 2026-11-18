#include "axrone/physics_wasm.h"

#include "core/broadphase.h"
#include "core/events.h"
#include "core/query.h"
#include "core/world.h"
#include "platform/memory.h"
#include "platform/wasm.h"
#include "runtime/arena.h"

using axrone::physics::Vec3;
using axrone::physics::World;

namespace {

axrone::physics::Arena g_arena;
World g_world;

#if !AXRONE_PHYSICS_TARGET_WASM
alignas(64) unsigned char g_hostMemory[64 * 1024 * 1024];
#endif

constexpr int32_t kQueryScratchCapacity = 256;
alignas(16) axrone::physics::RayHit g_queryScratch[kQueryScratchCapacity];

static_assert(sizeof(axrone::physics::RayHit) == 40, "ray hit record must stay 40 bytes");

alignas(16) axrone::physics::StepStatistics g_stepStatistics;

#if AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE
alignas(16) axrone::physics::PhaseTimers g_phaseTimers;
#endif

constexpr int32_t kEventCapacity = 4096;
alignas(16) axrone::physics::ContactEvent g_events[kEventCapacity];
alignas(16) uint64_t g_eventKeys[kEventCapacity];
alignas(16) uint8_t g_eventSensors[kEventCapacity];
axrone::physics::ContactEventState g_eventState;
int32_t g_eventCount = 0;
int32_t g_eventOverflow = 0;
bool g_eventsDirty = false;

static_assert(sizeof(axrone::physics::ContactEvent) == 40, "contact event record must stay 40 bytes");

void resetContactEvents() {
    g_eventState.keys = g_eventKeys;
    g_eventState.sensors = g_eventSensors;
    g_eventState.capacity = kEventCapacity;
    g_eventState.count = 0;
    g_eventCount = 0;
    g_eventOverflow = 0;
    g_eventsDirty = false;
}

void ensureContactEvents() {
    if (!g_eventsDirty) {
        return;
    }
    g_eventsDirty = false;
    const int32_t written = axrone::physics::collectContactEvents(g_world, g_eventState, g_events, kEventCapacity);
    if (written < 0) {
        g_eventCount = 0;
        g_eventOverflow += 1;
    } else {
        g_eventCount = written;
    }
}

uint64_t packView(uintptr_t pointer, size_t bytes) {
    return (static_cast<uint64_t>(pointer) << 32) | static_cast<uint64_t>(bytes);
}

bool queryOutputValid(uintptr_t pointer, size_t elementBytes, int32_t capacity) {
    if (capacity <= 0 || (pointer & 3U) != 0) {
        return false;
    }
#if AXRONE_PHYSICS_TARGET_WASM
    const size_t limit = static_cast<size_t>(__builtin_wasm_memory_size(0)) * 65536;
#else
    const size_t limit = g_arena.capacity();
#endif
    const size_t start = static_cast<size_t>(pointer);
    if (start == 0 || start >= limit) {
        return false;
    }
    return static_cast<size_t>(capacity) <= (limit - start) / elementBytes;
}

}

#if AXRONE_PHYSICS_TARGET_WASM
extern "C" char __heap_base;
#endif

AXRONE_PHYSICS_EXPORT(worldInit) int32_t worldInit(int32_t maxBodies, int32_t maxContacts, float gx, float gy, float gz) {
    g_world.initialized = false;
    resetContactEvents();
    g_stepStatistics = {};

#if AXRONE_PHYSICS_TARGET_WASM
    const uintptr_t heapBase = reinterpret_cast<uintptr_t>(&__heap_base);
    const size_t memoryBytes = __builtin_wasm_memory_size(0) * 65536;
    if (memoryBytes <= heapBase) {
        return -1;
    }
    g_arena.init(reinterpret_cast<unsigned char*>(heapBase), memoryBytes - heapBase);
#else
    g_arena.init(g_hostMemory, sizeof(g_hostMemory));
#endif

    return g_world.init(g_arena, maxBodies, maxContacts, Vec3(gx, gy, gz)) ? 0 : -1;
}

AXRONE_PHYSICS_EXPORT(worldSetGravity) int32_t worldSetGravity(float gx, float gy, float gz) {
    return g_world.setGravity(gx, gy, gz);
}

AXRONE_PHYSICS_EXPORT(worldSetBoxManifoldPointCap) int32_t worldSetBoxManifoldPointCap(int32_t cap) {
    if (cap != 4 && cap != 8) {
        return -1;
    }
    g_world.boxManifoldPointCapRaw = cap;
    return 0;
}

AXRONE_PHYSICS_EXPORT(bodyCreate) int32_t bodyCreate(int32_t type, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    return g_world.createBody(type, px, py, pz, qx, qy, qz, qw);
}

AXRONE_PHYSICS_EXPORT(bodyDestroy) int32_t bodyDestroy(int32_t id) {
    return g_world.destroyBody(id);
}

AXRONE_PHYSICS_EXPORT(bodySetSphere) int32_t bodySetSphere(int32_t id, float radius, float density) {
    return g_world.setSphere(id, radius, density);
}

AXRONE_PHYSICS_EXPORT(bodyAddSphere) int32_t bodyAddSphere(int32_t id, float radius, float density, float px, float py, float pz) {
    return g_world.addSphere(id, radius, density, px, py, pz);
}

AXRONE_PHYSICS_EXPORT(body_add_sphere) int32_t body_add_sphere(int32_t id, float radius, float density, float px, float py, float pz) {
    return bodyAddSphere(id, radius, density, px, py, pz);
}

AXRONE_PHYSICS_EXPORT(bodySetBox) int32_t bodySetBox(int32_t id, float hx, float hy, float hz, float density) {
    return g_world.setBox(id, hx, hy, hz, density);
}

AXRONE_PHYSICS_EXPORT(bodySetTransform) int32_t bodySetTransform(int32_t id, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    return g_world.setTransform(id, px, py, pz, qx, qy, qz, qw);
}

AXRONE_PHYSICS_EXPORT(bodySetVelocity) int32_t bodySetVelocity(int32_t id, float vx, float vy, float vz) {
    return g_world.setVelocity(id, vx, vy, vz);
}

AXRONE_PHYSICS_EXPORT(bodySetAngularVelocity) int32_t bodySetAngularVelocity(int32_t id, float vx, float vy, float vz) {
    return g_world.setAngularVelocity(id, vx, vy, vz);
}

AXRONE_PHYSICS_EXPORT(bodySetMaterial) int32_t bodySetMaterial(int32_t id, float friction, float restitution) {
    return g_world.setMaterial(id, friction, restitution);
}

AXRONE_PHYSICS_EXPORT(bodySetDamping) int32_t bodySetDamping(int32_t id, float linear, float angular) {
    return g_world.setDamping(id, linear, angular);
}

AXRONE_PHYSICS_EXPORT(bodySetGravityScale) int32_t bodySetGravityScale(int32_t id, float scale) {
    return g_world.setGravityScale(id, scale);
}

AXRONE_PHYSICS_EXPORT(bodySetFlags) int32_t bodySetFlags(int32_t id, int32_t setMask, int32_t clearMask) {
    return g_world.setFlags(id, setMask, clearMask);
}

AXRONE_PHYSICS_EXPORT(bodyApplyForce) int32_t bodyApplyForce(int32_t id, float fx, float fy, float fz, float px, float py, float pz) {
    return g_world.applyForce(id, fx, fy, fz, px, py, pz);
}

AXRONE_PHYSICS_EXPORT(bodyApplyImpulse) int32_t bodyApplyImpulse(int32_t id, float ix, float iy, float iz, float px, float py, float pz) {
    return g_world.applyImpulse(id, ix, iy, iz, px, py, pz);
}

AXRONE_PHYSICS_EXPORT(bodyApplyTorque) int32_t bodyApplyTorque(int32_t id, float tx, float ty, float tz) {
    return g_world.applyTorque(id, tx, ty, tz);
}

AXRONE_PHYSICS_EXPORT(bodyApplyAngularImpulse) int32_t bodyApplyAngularImpulse(int32_t id, float ix, float iy, float iz) {
    return g_world.applyAngularImpulse(id, ix, iy, iz);
}

AXRONE_PHYSICS_EXPORT(bodySetMassData) int32_t bodySetMassData(int32_t id, float mass, float ix, float iy, float iz) {
    return g_world.setMassData(id, mass, ix, iy, iz);
}

AXRONE_PHYSICS_EXPORT(step) int32_t step(float dt, int32_t velocityIterations, int32_t positionIterations) {
    const int32_t contacts = g_world.step(dt, velocityIterations, positionIterations);
    if (contacts < 0) {
        return contacts;
    }
    axrone::physics::collectStepStatistics(g_world, velocityIterations, positionIterations, g_world.mutableStepStatistics());
    g_stepStatistics = g_world.stepStatistics();
    g_eventCount = 0;
    g_eventsDirty = true;
    return contacts;
}

AXRONE_PHYSICS_EXPORT(bodyCount) int32_t bodyCount(void) {
    return g_world.bodyCount();
}

AXRONE_PHYSICS_EXPORT(contactCount) int32_t contactCount(void) {
    return g_world.getContactCount();
}

AXRONE_PHYSICS_EXPORT(transformsPtr) uintptr_t transformsPtr(void) {
    return g_world.initialized ? reinterpret_cast<uintptr_t>(g_world.transforms) : 0;
}

AXRONE_PHYSICS_EXPORT(velocitiesPtr) uintptr_t velocitiesPtr(void) {
    return g_world.initialized ? reinterpret_cast<uintptr_t>(g_world.velocities) : 0;
}

AXRONE_PHYSICS_EXPORT(angularVelocitiesPtr) uintptr_t angularVelocitiesPtr(void) {
    return g_world.initialized ? reinterpret_cast<uintptr_t>(g_world.angularVelocities) : 0;
}

AXRONE_PHYSICS_EXPORT(contactsPtr) uintptr_t contactsPtr(void) {
    return g_world.initialized ? reinterpret_cast<uintptr_t>(g_world.packedContacts) : 0;
}

AXRONE_PHYSICS_EXPORT(worldFingerprint) uint64_t worldFingerprint(void) {
    return g_world.initialized ? g_world.fingerprint() : 0;
}

AXRONE_PHYSICS_EXPORT(worldMemoryBytes) uintptr_t worldMemoryBytes(void) {
#if AXRONE_PHYSICS_TARGET_WASM
    return static_cast<uintptr_t>(__builtin_wasm_memory_size(0) * 65536);
#else
    return static_cast<uintptr_t>(g_arena.capacity());
#endif
}

AXRONE_PHYSICS_EXPORT(world_init) int32_t world_init(int32_t maxBodies, int32_t maxContacts, float gx, float gy, float gz) {
    return worldInit(maxBodies, maxContacts, gx, gy, gz);
}

AXRONE_PHYSICS_EXPORT(lib_init) int32_t lib_init(int32_t maxBodies, int32_t maxContacts, float gx, float gy, float gz) {
    return worldInit(maxBodies, maxContacts, gx, gy, gz);
}

AXRONE_PHYSICS_EXPORT(world_reset) void world_reset(void) {
    g_world.reset();
    resetContactEvents();
}

AXRONE_PHYSICS_EXPORT(worldReset) void worldReset(void) {
    world_reset();
}

AXRONE_PHYSICS_EXPORT(lib_reset) void lib_reset(void) {
    world_reset();
}

AXRONE_PHYSICS_EXPORT(world_set_gravity) int32_t world_set_gravity(float gx, float gy, float gz) {
    return worldSetGravity(gx, gy, gz);
}

AXRONE_PHYSICS_EXPORT(body_create) int32_t body_create(int32_t type, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    return bodyCreate(type, px, py, pz, qx, qy, qz, qw);
}

AXRONE_PHYSICS_EXPORT(body_destroy) int32_t body_destroy(int32_t id) {
    return bodyDestroy(id);
}

AXRONE_PHYSICS_EXPORT(body_set_sphere) int32_t body_set_sphere(int32_t id, float radius, float density) {
    return bodySetSphere(id, radius, density);
}

AXRONE_PHYSICS_EXPORT(body_set_box) int32_t body_set_box(int32_t id, float hx, float hy, float hz, float density) {
    return bodySetBox(id, hx, hy, hz, density);
}

AXRONE_PHYSICS_EXPORT(body_set_transform) int32_t body_set_transform(int32_t id, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    return bodySetTransform(id, px, py, pz, qx, qy, qz, qw);
}

AXRONE_PHYSICS_EXPORT(body_set_velocity) int32_t body_set_velocity(int32_t id, float vx, float vy, float vz) {
    return bodySetVelocity(id, vx, vy, vz);
}

AXRONE_PHYSICS_EXPORT(body_set_angular_velocity) int32_t body_set_angular_velocity(int32_t id, float vx, float vy, float vz) {
    return bodySetAngularVelocity(id, vx, vy, vz);
}

AXRONE_PHYSICS_EXPORT(body_set_material) int32_t body_set_material(int32_t id, float friction, float restitution) {
    return bodySetMaterial(id, friction, restitution);
}

AXRONE_PHYSICS_EXPORT(body_set_damping) int32_t body_set_damping(int32_t id, float linear, float angular) {
    return bodySetDamping(id, linear, angular);
}

AXRONE_PHYSICS_EXPORT(body_set_gravity_scale) int32_t body_set_gravity_scale(int32_t id, float scale) {
    return bodySetGravityScale(id, scale);
}

AXRONE_PHYSICS_EXPORT(body_set_flags) int32_t body_set_flags(int32_t id, int32_t setMask, int32_t clearMask) {
    return bodySetFlags(id, setMask, clearMask);
}

AXRONE_PHYSICS_EXPORT(body_apply_force) int32_t body_apply_force(int32_t id, float fx, float fy, float fz, float px, float py, float pz) {
    return bodyApplyForce(id, fx, fy, fz, px, py, pz);
}

AXRONE_PHYSICS_EXPORT(body_apply_impulse) int32_t body_apply_impulse(int32_t id, float ix, float iy, float iz, float px, float py, float pz) {
    return bodyApplyImpulse(id, ix, iy, iz, px, py, pz);
}

AXRONE_PHYSICS_EXPORT(body_apply_torque) int32_t body_apply_torque(int32_t id, float tx, float ty, float tz) {
    return bodyApplyTorque(id, tx, ty, tz);
}

AXRONE_PHYSICS_EXPORT(body_apply_angular_impulse) int32_t body_apply_angular_impulse(int32_t id, float ix, float iy, float iz) {
    return bodyApplyAngularImpulse(id, ix, iy, iz);
}

AXRONE_PHYSICS_EXPORT(body_set_mass_data) int32_t body_set_mass_data(int32_t id, float mass, float ix, float iy, float iz) {
    return bodySetMassData(id, mass, ix, iy, iz);
}

AXRONE_PHYSICS_EXPORT(body_count) int32_t body_count(void) {
    return bodyCount();
}

AXRONE_PHYSICS_EXPORT(contact_count) int32_t contact_count(void) {
    return contactCount();
}

AXRONE_PHYSICS_EXPORT(transforms_ptr) uintptr_t transforms_ptr(void) {
    return transformsPtr();
}

AXRONE_PHYSICS_EXPORT(velocities_ptr) uintptr_t velocities_ptr(void) {
    return velocitiesPtr();
}

AXRONE_PHYSICS_EXPORT(angular_velocities_ptr) uintptr_t angular_velocities_ptr(void) {
    return angularVelocitiesPtr();
}

AXRONE_PHYSICS_EXPORT(contacts_ptr) uintptr_t contacts_ptr(void) {
    return contactsPtr();
}

AXRONE_PHYSICS_EXPORT(world_fingerprint) uint64_t world_fingerprint(void) {
    return worldFingerprint();
}

AXRONE_PHYSICS_EXPORT(world_memory_bytes) uintptr_t world_memory_bytes(void) {
    return worldMemoryBytes();
}

AXRONE_PHYSICS_EXPORT(get_transforms_view) uint64_t get_transforms_view(void) {
    return g_world.initialized
        ? packView(reinterpret_cast<uintptr_t>(g_world.transforms), sizeof(axrone::physics::Transform) * static_cast<size_t>(g_world.highWater))
        : 0;
}

AXRONE_PHYSICS_EXPORT(get_velocities_view) uint64_t get_velocities_view(void) {
    return g_world.initialized
        ? packView(reinterpret_cast<uintptr_t>(g_world.velocities), sizeof(axrone::physics::Vec3) * static_cast<size_t>(g_world.highWater))
        : 0;
}

AXRONE_PHYSICS_EXPORT(get_angular_velocities_view) uint64_t get_angular_velocities_view(void) {
    return g_world.initialized
        ? packView(reinterpret_cast<uintptr_t>(g_world.angularVelocities), sizeof(axrone::physics::Vec3) * static_cast<size_t>(g_world.highWater))
        : 0;
}

AXRONE_PHYSICS_EXPORT(get_contacts_view) uint64_t get_contacts_view(void) {
    return g_world.initialized
        ? packView(reinterpret_cast<uintptr_t>(g_world.packedContacts), sizeof(axrone::physics::PackedContact) * static_cast<size_t>(g_world.contactCount))
        : 0;
}

AXRONE_PHYSICS_EXPORT(getTransformsView) uint64_t getTransformsView(void) {
    return get_transforms_view();
}

AXRONE_PHYSICS_EXPORT(getVelocitiesView) uint64_t getVelocitiesView(void) {
    return get_velocities_view();
}

AXRONE_PHYSICS_EXPORT(getAngularVelocitiesView) uint64_t getAngularVelocitiesView(void) {
    return get_angular_velocities_view();
}

AXRONE_PHYSICS_EXPORT(getContactsView) uint64_t getContactsView(void) {
    return get_contacts_view();
}

AXRONE_PHYSICS_EXPORT(raycastAll) int32_t raycastAll(float ox, float oy, float oz, float dx, float dy, float dz, float maxDistance, uintptr_t hits, int32_t capacity) {
    if (!queryOutputValid(hits, sizeof(axrone::physics::RayHit), capacity)) {
        return 0;
    }
    return axrone::physics::raycastAll(
        g_world,
        Vec3(ox, oy, oz),
        Vec3(dx, dy, dz),
        maxDistance,
        reinterpret_cast<axrone::physics::RayHit*>(hits),
        capacity);
}

AXRONE_PHYSICS_EXPORT(raycastAllV2) int32_t raycastAllV2(
    float ox,
    float oy,
    float oz,
    float dx,
    float dy,
    float dz,
    float maxDistance,
    int32_t categoryBits,
    int32_t maskBits,
    uintptr_t hits,
    int32_t capacity
) {
    if (!queryOutputValid(hits, sizeof(axrone::physics::RayHit), capacity)) {
        return 0;
    }
    axrone::physics::RayHit* output = reinterpret_cast<axrone::physics::RayHit*>(hits);
    const Vec3 direction(dx, dy, dz);
    const int32_t count = axrone::physics::raycastAll(
        g_world,
        Vec3(ox, oy, oz),
        direction,
        maxDistance,
        categoryBits,
        maskBits,
        output,
        capacity);
    axrone::physics::applyFractionConvention(output, count, direction);
    return count;
}

AXRONE_PHYSICS_EXPORT(raycastClosest) int32_t raycastClosest(float ox, float oy, float oz, float dx, float dy, float dz, float maxDistance, uintptr_t hit) {
    if (!queryOutputValid(hit, sizeof(axrone::physics::RayHit), 1)) {
        return 0;
    }
    return axrone::physics::raycastClosest(
        g_world,
        Vec3(ox, oy, oz),
        Vec3(dx, dy, dz),
        maxDistance,
        *reinterpret_cast<axrone::physics::RayHit*>(hit)) ? 1 : 0;
}

AXRONE_PHYSICS_EXPORT(raycastClosestV2) int32_t raycastClosestV2(
    float ox,
    float oy,
    float oz,
    float dx,
    float dy,
    float dz,
    float maxDistance,
    int32_t categoryBits,
    int32_t maskBits,
    uintptr_t hit
) {
    if (!queryOutputValid(hit, sizeof(axrone::physics::RayHit), 1)) {
        return 0;
    }
    axrone::physics::RayHit& output = *reinterpret_cast<axrone::physics::RayHit*>(hit);
    const Vec3 direction(dx, dy, dz);
    if (!axrone::physics::raycastClosest(
        g_world,
        Vec3(ox, oy, oz),
        direction,
        maxDistance,
        categoryBits,
        maskBits,
        output)) {
        return 0;
    }
    axrone::physics::applyFractionConvention(output, direction);
    return 1;
}

AXRONE_PHYSICS_EXPORT(overlapSphere) int32_t overlapSphere(float cx, float cy, float cz, float radius, uintptr_t ids, int32_t capacity) {
    if (!queryOutputValid(ids, sizeof(int32_t), capacity)) {
        return 0;
    }
    return axrone::physics::overlapSphere(
        g_world,
        Vec3(cx, cy, cz),
        radius,
        reinterpret_cast<int32_t*>(ids),
        capacity);
}

AXRONE_PHYSICS_EXPORT(overlapSphereV2) int32_t overlapSphereV2(
    float cx,
    float cy,
    float cz,
    float radius,
    int32_t categoryBits,
    int32_t maskBits,
    uintptr_t ids,
    int32_t capacity
) {
    if (!queryOutputValid(ids, sizeof(int32_t), capacity)) {
        return 0;
    }
    return axrone::physics::overlapSphere(
        g_world,
        Vec3(cx, cy, cz),
        radius,
        categoryBits,
        maskBits,
        reinterpret_cast<int32_t*>(ids),
        capacity);
}

AXRONE_PHYSICS_EXPORT(overlapBoxAll) int32_t overlapBoxAll(
    uintptr_t outBodyIds,
    int32_t capacity,
    float minX,
    float minY,
    float minZ,
    float maxX,
    float maxY,
    float maxZ
) {
    if (!queryOutputValid(outBodyIds, sizeof(int32_t), capacity)) {
        return 0;
    }
    if (g_world.initialized) {
        axrone::physics::updateBounds(g_world);
    }
    const axrone::physics::AABB bounds = { minX, minY, minZ, maxX, maxY, maxZ };
    return axrone::physics::overlapBoxAll(
        g_world,
        bounds,
        reinterpret_cast<int32_t*>(outBodyIds),
        capacity);
}

AXRONE_PHYSICS_EXPORT(queryPointAll) int32_t queryPointAll(uintptr_t outBodyIds, int32_t capacity, float x, float y, float z) {
    if (!queryOutputValid(outBodyIds, sizeof(int32_t), capacity)) {
        return 0;
    }
    if (g_world.initialized) {
        axrone::physics::updateBounds(g_world);
    }
    return axrone::physics::queryPointAll(
        g_world,
        Vec3(x, y, z),
        reinterpret_cast<int32_t*>(outBodyIds),
        capacity);
}

AXRONE_PHYSICS_EXPORT(stepStatisticsView) uint64_t stepStatisticsView(void) {
    return packView(reinterpret_cast<uintptr_t>(&g_stepStatistics), sizeof(g_stepStatistics));
}

#if AXRONE_PHYSICS_PHASE_TIMERS_ACTIVE
AXRONE_PHYSICS_EXPORT(phaseTimersView) uint64_t phaseTimersView(void) {
    g_phaseTimers = g_world.phaseTimers();
    return packView(reinterpret_cast<uintptr_t>(&g_phaseTimers), sizeof(g_phaseTimers));
}

AXRONE_PHYSICS_EXPORT(phaseTimerSweptNanoseconds) uint64_t phaseTimerSweptNanoseconds(void) {
    return g_world.phaseTimerSweptNanoseconds();
}

AXRONE_PHYSICS_EXPORT(phaseTimerCollideNanoseconds) uint64_t phaseTimerCollideNanoseconds(void) {
    return g_world.phaseTimerCollideNanoseconds();
}

AXRONE_PHYSICS_EXPORT(phaseTimerClampFired) int32_t phaseTimerClampFired(void) {
    return g_world.phaseTimerClampFired();
}
#endif

AXRONE_PHYSICS_EXPORT(queryScratchPtr) uintptr_t queryScratchPtr(void) {
    return reinterpret_cast<uintptr_t>(g_queryScratch);
}

AXRONE_PHYSICS_EXPORT(queryScratchCapacity) int32_t queryScratchCapacity(void) {
    return kQueryScratchCapacity;
}

AXRONE_PHYSICS_EXPORT(bodySetAwake) int32_t bodySetAwake(int32_t id, int32_t awake) {
    return g_world.setAwake(id, awake);
}

AXRONE_PHYSICS_EXPORT(body_set_awake) int32_t body_set_awake(int32_t id, int32_t awake) {
    return bodySetAwake(id, awake);
}

AXRONE_PHYSICS_EXPORT(bodyIsSleeping) int32_t bodyIsSleeping(int32_t id) {
    return g_world.isSleeping(id);
}

AXRONE_PHYSICS_EXPORT(body_is_sleeping) int32_t body_is_sleeping(int32_t id) {
    return bodyIsSleeping(id);
}

AXRONE_PHYSICS_EXPORT(worldSetAllowSleep) int32_t worldSetAllowSleep(int32_t on) {
    return g_world.setAllowSleep(on);
}

AXRONE_PHYSICS_EXPORT(world_set_allow_sleep) int32_t world_set_allow_sleep(int32_t on) {
    return worldSetAllowSleep(on);
}

AXRONE_PHYSICS_EXPORT(eventsPtr) uintptr_t eventsPtr(void) {
    ensureContactEvents();
    return reinterpret_cast<uintptr_t>(g_events);
}

AXRONE_PHYSICS_EXPORT(eventCount) int32_t eventCount(void) {
    ensureContactEvents();
    return g_eventCount;
}

AXRONE_PHYSICS_EXPORT(eventsOverflow) int32_t eventsOverflow(void) {
    return g_eventOverflow;
}

AXRONE_PHYSICS_EXPORT(eventsClear) void eventsClear(void) {
    g_eventCount = 0;
    g_eventsDirty = false;
}

AXRONE_PHYSICS_EXPORT(shapeCreateSphere) int32_t shapeCreateSphere(int32_t bodyId, float radius, float density, float cx, float cy, float cz) {
    const int32_t slot = g_world.addSphere(bodyId, radius, density, cx, cy, cz);
    if (slot < 0) {
        return -1;
    }
    return g_world.shapeMakeId(bodyId, slot);
}

AXRONE_PHYSICS_EXPORT(shape_create_sphere) int32_t shape_create_sphere(int32_t bodyId, float radius, float density, float cx, float cy, float cz) {
    return shapeCreateSphere(bodyId, radius, density, cx, cy, cz);
}

AXRONE_PHYSICS_EXPORT(shapeCreateBox) int32_t shapeCreateBox(
    int32_t bodyId,
    float hx,
    float hy,
    float hz,
    float density,
    float cx,
    float cy,
    float cz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    const int32_t slot = g_world.addBox(bodyId, hx, hy, hz, density, cx, cy, cz, qx, qy, qz, qw);
    if (slot < 0) {
        return -1;
    }
    return g_world.shapeMakeId(bodyId, slot);
}

AXRONE_PHYSICS_EXPORT(shape_create_box) int32_t shape_create_box(
    int32_t bodyId,
    float hx,
    float hy,
    float hz,
    float density,
    float cx,
    float cy,
    float cz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    return shapeCreateBox(bodyId, hx, hy, hz, density, cx, cy, cz, qx, qy, qz, qw);
}

AXRONE_PHYSICS_EXPORT(shapeCreateCapsule) int32_t shapeCreateCapsule(
    int32_t bodyId,
    float radius,
    float halfSegment,
    float density,
    float cx,
    float cy,
    float cz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    const int32_t slot = g_world.addCapsule(bodyId, radius, halfSegment, density, cx, cy, cz, qx, qy, qz, qw);
    if (slot < 0) {
        return -1;
    }
    return g_world.shapeMakeId(bodyId, slot);
}

AXRONE_PHYSICS_EXPORT(shape_create_capsule) int32_t shape_create_capsule(
    int32_t bodyId,
    float radius,
    float halfSegment,
    float density,
    float cx,
    float cy,
    float cz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    return shapeCreateCapsule(bodyId, radius, halfSegment, density, cx, cy, cz, qx, qy, qz, qw);
}

AXRONE_PHYSICS_EXPORT(shapeCreateCylinder) int32_t shapeCreateCylinder(
    int32_t bodyId,
    float radius,
    float halfHeight,
    float density,
    float cx,
    float cy,
    float cz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    const int32_t slot = g_world.addCylinder(bodyId, radius, halfHeight, density, cx, cy, cz, qx, qy, qz, qw);
    if (slot < 0) {
        return -1;
    }
    return g_world.shapeMakeId(bodyId, slot);
}

AXRONE_PHYSICS_EXPORT(shape_create_cylinder) int32_t shape_create_cylinder(
    int32_t bodyId,
    float radius,
    float halfHeight,
    float density,
    float cx,
    float cy,
    float cz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    return shapeCreateCylinder(bodyId, radius, halfHeight, density, cx, cy, cz, qx, qy, qz, qw);
}

AXRONE_PHYSICS_EXPORT(shapeCreateCone) int32_t shapeCreateCone(
    int32_t bodyId,
    float radius,
    float halfHeight,
    float density,
    float cx,
    float cy,
    float cz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    const int32_t slot = g_world.addCone(bodyId, radius, halfHeight, density, cx, cy, cz, qx, qy, qz, qw);
    if (slot < 0) {
        return -1;
    }
    return g_world.shapeMakeId(bodyId, slot);
}

AXRONE_PHYSICS_EXPORT(shape_create_cone) int32_t shape_create_cone(
    int32_t bodyId,
    float radius,
    float halfHeight,
    float density,
    float cx,
    float cy,
    float cz,
    float qx,
    float qy,
    float qz,
    float qw
) {
    return shapeCreateCone(bodyId, radius, halfHeight, density, cx, cy, cz, qx, qy, qz, qw);
}

AXRONE_PHYSICS_EXPORT(shapeDestroy) int32_t shapeDestroy(int32_t shapeId) {
    return g_world.shapeDestroy(shapeId);
}

AXRONE_PHYSICS_EXPORT(shapeCreateHull) int32_t shapeCreateHull(int32_t bodyId, float density, float cx, float cy, float cz) {
    const int32_t slot = g_world.addHull(bodyId, density, cx, cy, cz, 0.0f, 0.0f, 0.0f, 1.0f);
    if (slot < 0) {
        return -1;
    }
    return g_world.shapeMakeId(bodyId, slot);
}

AXRONE_PHYSICS_EXPORT(shape_create_hull) int32_t shape_create_hull(int32_t bodyId, float density, float cx, float cy, float cz) {
    return shapeCreateHull(bodyId, density, cx, cy, cz);
}

AXRONE_PHYSICS_EXPORT(shapeCreateMesh) int32_t shapeCreateMesh(int32_t bodyId, float density, float cx, float cy, float cz) {
    const int32_t slot = g_world.addMesh(bodyId, density, cx, cy, cz, 0.0f, 0.0f, 0.0f, 1.0f);
    if (slot < 0) {
        return -1;
    }
    return g_world.shapeMakeId(bodyId, slot);
}

AXRONE_PHYSICS_EXPORT(shape_create_mesh) int32_t shape_create_mesh(int32_t bodyId, float density, float cx, float cy, float cz) {
    return shapeCreateMesh(bodyId, density, cx, cy, cz);
}

AXRONE_PHYSICS_EXPORT(shapeCreateHeightField) int32_t shapeCreateHeightField(
    int32_t bodyId,
    float density,
    float cx,
    float cy,
    float cz,
    int32_t width,
    int32_t depth,
    float scaleX,
    float scaleY,
    float scaleZ
) {
    using axrone::physics::isFinite;
    if (width < 2 || depth < 2 ||
        width > axrone::physics::kBulkMaxHeightFieldSide ||
        depth > axrone::physics::kBulkMaxHeightFieldSide ||
        !isFinite(scaleX) || !isFinite(scaleY) || !isFinite(scaleZ) ||
        scaleX <= 0.0f || scaleY <= 0.0f || scaleZ <= 0.0f) {
        return -1;
    }
    const int32_t slot = g_world.addHeightField(bodyId, density, cx, cy, cz, 0.0f, 0.0f, 0.0f, 1.0f);
    if (slot < 0) {
        return -1;
    }
    return g_world.shapeMakeId(bodyId, slot);
}

AXRONE_PHYSICS_EXPORT(shape_create_height_field) int32_t shape_create_height_field(
    int32_t bodyId,
    float density,
    float cx,
    float cy,
    float cz,
    int32_t width,
    int32_t depth,
    float scaleX,
    float scaleY,
    float scaleZ
) {
    return shapeCreateHeightField(bodyId, density, cx, cy, cz, width, depth, scaleX, scaleY, scaleZ);
}

AXRONE_PHYSICS_EXPORT(worldAlloc) uintptr_t worldAlloc(int32_t bytes) {
    return g_world.initialized ? g_world.bulkAlloc(bytes) : 0;
}

AXRONE_PHYSICS_EXPORT(world_alloc) uintptr_t world_alloc(int32_t bytes) {
    return worldAlloc(bytes);
}

AXRONE_PHYSICS_EXPORT(worldRelease) int32_t worldRelease(uintptr_t address) {
    return g_world.initialized ? g_world.bulkRelease(address) : -1;
}

AXRONE_PHYSICS_EXPORT(world_release) int32_t world_release(uintptr_t address) {
    return worldRelease(address);
}

AXRONE_PHYSICS_EXPORT(shapeSetVertices) int32_t shapeSetVertices(int32_t shapeId, uintptr_t address, int32_t count) {
    if (!g_world.initialized) {
        return -1;
    }
    return g_world.setShapeVertices(shapeId, address, count);
}

AXRONE_PHYSICS_EXPORT(shape_set_vertices) int32_t shape_set_vertices(int32_t shapeId, uintptr_t address, int32_t count) {
    return shapeSetVertices(shapeId, address, count);
}

AXRONE_PHYSICS_EXPORT(shapeSetIndices) int32_t shapeSetIndices(int32_t shapeId, uintptr_t address, int32_t count) {
    if (!g_world.initialized) {
        return -1;
    }
    return g_world.setShapeIndices(shapeId, address, count);
}

AXRONE_PHYSICS_EXPORT(shape_set_indices) int32_t shape_set_indices(int32_t shapeId, uintptr_t address, int32_t count) {
    return shapeSetIndices(shapeId, address, count);
}

AXRONE_PHYSICS_EXPORT(shapeSetHeightField) int32_t shapeSetHeightField(
    int32_t shapeId,
    uintptr_t address,
    int32_t width,
    int32_t depth,
    float scaleX,
    float scaleY,
    float scaleZ
) {
    if (!g_world.initialized) {
        return -1;
    }
    return g_world.setShapeHeightField(shapeId, address, width, depth, scaleX, scaleY, scaleZ);
}

AXRONE_PHYSICS_EXPORT(shape_set_height_field) int32_t shape_set_height_field(
    int32_t shapeId,
    uintptr_t address,
    int32_t width,
    int32_t depth,
    float scaleX,
    float scaleY,
    float scaleZ
) {
    return shapeSetHeightField(shapeId, address, width, depth, scaleX, scaleY, scaleZ);
}

AXRONE_PHYSICS_EXPORT(shape_destroy) int32_t shape_destroy(int32_t shapeId) {
    return shapeDestroy(shapeId);
}

AXRONE_PHYSICS_EXPORT(shapeClear) int32_t shapeClear(int32_t bodyId) {
    return g_world.shapeClear(bodyId);
}

AXRONE_PHYSICS_EXPORT(shape_clear) int32_t shape_clear(int32_t bodyId) {
    return shapeClear(bodyId);
}

AXRONE_PHYSICS_EXPORT(shapeGetBody) int32_t shapeGetBody(int32_t shapeId) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    if (!g_world.shapeIdResolve(shapeId, bodyId, slot)) {
        return -1;
    }
    return bodyId;
}

AXRONE_PHYSICS_EXPORT(shape_get_body) int32_t shape_get_body(int32_t shapeId) {
    return shapeGetBody(shapeId);
}

AXRONE_PHYSICS_EXPORT(shapeGetKind) int32_t shapeGetKind(int32_t shapeId) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    if (!g_world.shapeIdResolve(shapeId, bodyId, slot)) {
        return -1;
    }
    return axrone::physics::shapeTypeCode(g_world.bodies[bodyId].shapes[slot].kind);
}

AXRONE_PHYSICS_EXPORT(shape_get_kind) int32_t shape_get_kind(int32_t shapeId) {
    return shapeGetKind(shapeId);
}

AXRONE_PHYSICS_EXPORT(shapeSetMaterial) int32_t shapeSetMaterial(int32_t shapeId, float friction, float restitution) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    if (!g_world.shapeIdResolve(shapeId, bodyId, slot)) {
        return -1;
    }
    return g_world.setShapeMaterial(bodyId, slot, friction, restitution);
}

AXRONE_PHYSICS_EXPORT(shape_set_material) int32_t shape_set_material(int32_t shapeId, float friction, float restitution) {
    return shapeSetMaterial(shapeId, friction, restitution);
}

AXRONE_PHYSICS_EXPORT(shapeGetMaterial) int32_t shapeGetMaterial(int32_t shapeId, uintptr_t out2f32) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    if (!g_world.shapeIdResolve(shapeId, bodyId, slot)) {
        return -1;
    }
    if (!queryOutputValid(out2f32, sizeof(float), 2)) {
        return -1;
    }
    const axrone::physics::Shape& shape = g_world.bodies[bodyId].shapes[slot];
    float* output = reinterpret_cast<float*>(out2f32);
    output[0] = shape.friction;
    output[1] = shape.restitution;
    return 0;
}

AXRONE_PHYSICS_EXPORT(shape_get_material) int32_t shape_get_material(int32_t shapeId, uintptr_t out2f32) {
    return shapeGetMaterial(shapeId, out2f32);
}

AXRONE_PHYSICS_EXPORT(shapeSetSensor) int32_t shapeSetSensor(int32_t shapeId, int32_t on) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    if (!g_world.shapeIdResolve(shapeId, bodyId, slot)) {
        return -1;
    }
    return g_world.setShapeSensor(bodyId, slot, on);
}

AXRONE_PHYSICS_EXPORT(shape_set_sensor) int32_t shape_set_sensor(int32_t shapeId, int32_t on) {
    return shapeSetSensor(shapeId, on);
}

AXRONE_PHYSICS_EXPORT(shapeIsSensor) int32_t shapeIsSensor(int32_t shapeId) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    if (!g_world.shapeIdResolve(shapeId, bodyId, slot)) {
        return -1;
    }
    return g_world.bodies[bodyId].shapes[slot].sensor != 0 ? 1 : 0;
}

AXRONE_PHYSICS_EXPORT(shape_is_sensor) int32_t shape_is_sensor(int32_t shapeId) {
    return shapeIsSensor(shapeId);
}

AXRONE_PHYSICS_EXPORT(shapeSetFilter) int32_t shapeSetFilter(int32_t shapeId, int32_t categoryBits, int32_t maskBits, int32_t groupIndex) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    if (!g_world.shapeIdResolve(shapeId, bodyId, slot)) {
        return -1;
    }
    return g_world.setShapeFilter(bodyId, slot, categoryBits, maskBits, groupIndex);
}

AXRONE_PHYSICS_EXPORT(shape_set_filter) int32_t shape_set_filter(int32_t shapeId, int32_t categoryBits, int32_t maskBits, int32_t groupIndex) {
    return shapeSetFilter(shapeId, categoryBits, maskBits, groupIndex);
}

AXRONE_PHYSICS_EXPORT(shapeGetFilter) int32_t shapeGetFilter(int32_t shapeId, uintptr_t out3i32) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    if (!g_world.shapeIdResolve(shapeId, bodyId, slot)) {
        return -1;
    }
    if (!queryOutputValid(out3i32, sizeof(int32_t), 3)) {
        return -1;
    }
    const axrone::physics::Shape& shape = g_world.bodies[bodyId].shapes[slot];
    int32_t* output = reinterpret_cast<int32_t*>(out3i32);
    output[0] = shape.categoryBits;
    output[1] = shape.maskBits;
    output[2] = shape.groupIndex;
    return 0;
}

AXRONE_PHYSICS_EXPORT(shape_get_filter) int32_t shape_get_filter(int32_t shapeId, uintptr_t out3i32) {
    return shapeGetFilter(shapeId, out3i32);
}

AXRONE_PHYSICS_EXPORT(constraintCreateFixed) int32_t constraintCreateFixed(
    int32_t bodyA,
    int32_t bodyB,
    float ax,
    float ay,
    float az,
    float bx,
    float by,
    float bz,
    int32_t collideConnected
) {
    return g_world.createFixed(bodyA, bodyB, Vec3(ax, ay, az), Vec3(bx, by, bz), collideConnected);
}

AXRONE_PHYSICS_EXPORT(constraint_create_fixed) int32_t constraint_create_fixed(
    int32_t bodyA,
    int32_t bodyB,
    float ax,
    float ay,
    float az,
    float bx,
    float by,
    float bz,
    int32_t collideConnected
) {
    return constraintCreateFixed(bodyA, bodyB, ax, ay, az, bx, by, bz, collideConnected);
}

AXRONE_PHYSICS_EXPORT(constraintCreateHinge) int32_t constraintCreateHinge(
    int32_t bodyA,
    int32_t bodyB,
    float ax,
    float ay,
    float az,
    float bx,
    float by,
    float bz,
    float aax,
    float aay,
    float aaz,
    float abx,
    float aby,
    float abz,
    int32_t enableLimit,
    float lower,
    float upper,
    int32_t enableMotor,
    float motorSpeed,
    float maxMotorTorque,
    int32_t collideConnected
) {
    return g_world.createHinge(
        bodyA,
        bodyB,
        Vec3(ax, ay, az),
        Vec3(bx, by, bz),
        Vec3(aax, aay, aaz),
        Vec3(abx, aby, abz),
        enableLimit,
        lower,
        upper,
        enableMotor,
        motorSpeed,
        maxMotorTorque,
        collideConnected);
}

AXRONE_PHYSICS_EXPORT(constraint_create_hinge) int32_t constraint_create_hinge(
    int32_t bodyA,
    int32_t bodyB,
    float ax,
    float ay,
    float az,
    float bx,
    float by,
    float bz,
    float aax,
    float aay,
    float aaz,
    float abx,
    float aby,
    float abz,
    int32_t enableLimit,
    float lower,
    float upper,
    int32_t enableMotor,
    float motorSpeed,
    float maxMotorTorque,
    int32_t collideConnected
) {
    return constraintCreateHinge(
        bodyA,
        bodyB,
        ax, ay, az,
        bx, by, bz,
        aax, aay, aaz,
        abx, aby, abz,
        enableLimit,
        lower,
        upper,
        enableMotor,
        motorSpeed,
        maxMotorTorque,
        collideConnected);
}

AXRONE_PHYSICS_EXPORT(constraintCreateSlider) int32_t constraintCreateSlider(
    int32_t bodyA,
    int32_t bodyB,
    float ax,
    float ay,
    float az,
    float bx,
    float by,
    float bz,
    float aax,
    float aay,
    float aaz,
    int32_t enableLimit,
    float lower,
    float upper,
    int32_t enableMotor,
    float motorSpeed,
    float maxMotorForce,
    int32_t collideConnected
) {
    return g_world.createSlider(
        bodyA,
        bodyB,
        Vec3(ax, ay, az),
        Vec3(bx, by, bz),
        Vec3(aax, aay, aaz),
        enableLimit,
        lower,
        upper,
        enableMotor,
        motorSpeed,
        maxMotorForce,
        collideConnected);
}

AXRONE_PHYSICS_EXPORT(constraint_create_slider) int32_t constraint_create_slider(
    int32_t bodyA,
    int32_t bodyB,
    float ax,
    float ay,
    float az,
    float bx,
    float by,
    float bz,
    float aax,
    float aay,
    float aaz,
    int32_t enableLimit,
    float lower,
    float upper,
    int32_t enableMotor,
    float motorSpeed,
    float maxMotorForce,
    int32_t collideConnected
) {
    return constraintCreateSlider(
        bodyA,
        bodyB,
        ax, ay, az,
        bx, by, bz,
        aax, aay, aaz,
        enableLimit,
        lower,
        upper,
        enableMotor,
        motorSpeed,
        maxMotorForce,
        collideConnected);
}

AXRONE_PHYSICS_EXPORT(constraintCreateSpring) int32_t constraintCreateSpring(
    int32_t bodyA,
    int32_t bodyB,
    float ax,
    float ay,
    float az,
    float bx,
    float by,
    float bz,
    float restLength,
    float stiffness,
    float damping,
    int32_t collideConnected
) {
    return g_world.createSpring(
        bodyA,
        bodyB,
        Vec3(ax, ay, az),
        Vec3(bx, by, bz),
        restLength,
        stiffness,
        damping,
        collideConnected);
}

AXRONE_PHYSICS_EXPORT(constraint_create_spring) int32_t constraint_create_spring(
    int32_t bodyA,
    int32_t bodyB,
    float ax,
    float ay,
    float az,
    float bx,
    float by,
    float bz,
    float restLength,
    float stiffness,
    float damping,
    int32_t collideConnected
) {
    return constraintCreateSpring(bodyA, bodyB, ax, ay, az, bx, by, bz, restLength, stiffness, damping, collideConnected);
}

AXRONE_PHYSICS_EXPORT(constraintDestroy) int32_t constraintDestroy(int32_t id) {
    return g_world.destroyConstraint(id);
}

AXRONE_PHYSICS_EXPORT(constraint_destroy) int32_t constraint_destroy(int32_t id) {
    return constraintDestroy(id);
}

AXRONE_PHYSICS_EXPORT(constraintSetEnabled) int32_t constraintSetEnabled(int32_t id, int32_t enabled) {
    return g_world.setConstraintEnabled(id, enabled);
}

AXRONE_PHYSICS_EXPORT(constraint_set_enabled) int32_t constraint_set_enabled(int32_t id, int32_t enabled) {
    return constraintSetEnabled(id, enabled);
}

AXRONE_PHYSICS_EXPORT(constraintSetHingeMotor) int32_t constraintSetHingeMotor(int32_t id, float speed, float maxTorque) {
    return g_world.setHingeMotor(id, speed, maxTorque);
}

AXRONE_PHYSICS_EXPORT(constraint_set_hinge_motor) int32_t constraint_set_hinge_motor(int32_t id, float speed, float maxTorque) {
    return constraintSetHingeMotor(id, speed, maxTorque);
}

AXRONE_PHYSICS_EXPORT(constraintSetHingeLimit) int32_t constraintSetHingeLimit(int32_t id, int32_t enable, float lower, float upper) {
    return g_world.setHingeLimit(id, enable, lower, upper);
}

AXRONE_PHYSICS_EXPORT(constraint_set_hinge_limit) int32_t constraint_set_hinge_limit(int32_t id, int32_t enable, float lower, float upper) {
    return constraintSetHingeLimit(id, enable, lower, upper);
}

AXRONE_PHYSICS_EXPORT(constraintSetSliderMotor) int32_t constraintSetSliderMotor(int32_t id, float speed, float maxForce) {
    return g_world.setSliderMotor(id, speed, maxForce);
}

AXRONE_PHYSICS_EXPORT(constraint_set_slider_motor) int32_t constraint_set_slider_motor(int32_t id, float speed, float maxForce) {
    return constraintSetSliderMotor(id, speed, maxForce);
}

AXRONE_PHYSICS_EXPORT(constraintSetSliderLimit) int32_t constraintSetSliderLimit(int32_t id, int32_t enable, float lower, float upper) {
    return g_world.setSliderLimit(id, enable, lower, upper);
}

AXRONE_PHYSICS_EXPORT(constraint_set_slider_limit) int32_t constraint_set_slider_limit(int32_t id, int32_t enable, float lower, float upper) {
    return constraintSetSliderLimit(id, enable, lower, upper);
}

AXRONE_PHYSICS_EXPORT(constraintCount) int32_t constraintCount(void) {
    return g_world.initialized ? g_world.constraintCount : -1;
}

AXRONE_PHYSICS_EXPORT(constraint_count) int32_t constraint_count(void) {
    return constraintCount();
}

AXRONE_PHYSICS_EXPORT(constraintGetKind) int32_t constraintGetKind(int32_t id) {
    axrone::physics::Constraint* constraint = nullptr;
    if (!g_world.constraintResolve(id, constraint)) {
        return -1;
    }
    return constraint->kind;
}

AXRONE_PHYSICS_EXPORT(constraint_get_kind) int32_t constraint_get_kind(int32_t id) {
    return constraintGetKind(id);
}

