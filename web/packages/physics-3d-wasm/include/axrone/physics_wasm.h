#pragma once

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

enum {
    AXRONE_PHYSICS_BODY_STATIC = 0,
    AXRONE_PHYSICS_BODY_DYNAMIC = 1,
    AXRONE_PHYSICS_BODY_KINEMATIC = 2
};

enum {
    AXRONE_PHYSICS_SHAPE_NONE = 0,
    AXRONE_PHYSICS_SHAPE_SPHERE = 1,
    AXRONE_PHYSICS_SHAPE_BOX = 2,
    AXRONE_PHYSICS_SHAPE_CAPSULE = 3,
    AXRONE_PHYSICS_SHAPE_CYLINDER = 4,
    AXRONE_PHYSICS_SHAPE_CONE = 5
};

enum {
    AXRONE_PHYSICS_SHAPE_TYPE_CAPSULE = 1,
    AXRONE_PHYSICS_SHAPE_TYPE_BOX = 3,
    AXRONE_PHYSICS_SHAPE_TYPE_SPHERE = 5,
    AXRONE_PHYSICS_SHAPE_TYPE_CYLINDER = 6,
    AXRONE_PHYSICS_SHAPE_TYPE_CONE = 7
};

enum {
    AXRONE_PHYSICS_BODY_FREEZE_ROTATION_X = 1,
    AXRONE_PHYSICS_BODY_FREEZE_ROTATION_Y = 2,
    AXRONE_PHYSICS_BODY_FREEZE_ROTATION_Z = 4,
    AXRONE_PHYSICS_BODY_FREEZE_POSITION_X = 8,
    AXRONE_PHYSICS_BODY_FREEZE_POSITION_Y = 16,
    AXRONE_PHYSICS_BODY_FREEZE_POSITION_Z = 32,
    AXRONE_PHYSICS_BODY_RESERVED_X = 64,
    AXRONE_PHYSICS_BODY_RESERVED_Y = 128
};

int32_t worldInit(int32_t maxBodies, int32_t maxContacts, float gx, float gy, float gz);
int32_t world_init(int32_t maxBodies, int32_t maxContacts, float gx, float gy, float gz);
int32_t lib_init(int32_t maxBodies, int32_t maxContacts, float gx, float gy, float gz);
void world_reset(void);
void worldReset(void);
void lib_reset(void);
int32_t worldSetGravity(float gx, float gy, float gz);
int32_t world_set_gravity(float gx, float gy, float gz);
int32_t worldSetBoxManifoldPointCap(int32_t cap);
int32_t bodyCreate(int32_t type, float px, float py, float pz, float qx, float qy, float qz, float qw);
int32_t body_create(int32_t type, float px, float py, float pz, float qx, float qy, float qz, float qw);
int32_t bodyDestroy(int32_t id);
int32_t body_destroy(int32_t id);
int32_t bodySetSphere(int32_t id, float radius, float density);
int32_t body_set_sphere(int32_t id, float radius, float density);
int32_t bodyAddSphere(int32_t id, float radius, float density, float px, float py, float pz);
int32_t body_add_sphere(int32_t id, float radius, float density, float px, float py, float pz);
int32_t bodySetBox(int32_t id, float hx, float hy, float hz, float density);
int32_t body_set_box(int32_t id, float hx, float hy, float hz, float density);
int32_t bodySetTransform(int32_t id, float px, float py, float pz, float qx, float qy, float qz, float qw);
int32_t body_set_transform(int32_t id, float px, float py, float pz, float qx, float qy, float qz, float qw);
int32_t bodySetVelocity(int32_t id, float vx, float vy, float vz);
int32_t body_set_velocity(int32_t id, float vx, float vy, float vz);
int32_t bodySetAngularVelocity(int32_t id, float vx, float vy, float vz);
int32_t body_set_angular_velocity(int32_t id, float vx, float vy, float vz);
int32_t bodySetMaterial(int32_t id, float friction, float restitution);
int32_t body_set_material(int32_t id, float friction, float restitution);
int32_t bodySetDamping(int32_t id, float linear, float angular);
int32_t body_set_damping(int32_t id, float linear, float angular);
int32_t bodySetGravityScale(int32_t id, float scale);
int32_t body_set_gravity_scale(int32_t id, float scale);
int32_t bodySetFlags(int32_t id, int32_t setMask, int32_t clearMask);
int32_t body_set_flags(int32_t id, int32_t setMask, int32_t clearMask);
int32_t bodyApplyForce(int32_t id, float fx, float fy, float fz, float px, float py, float pz);
int32_t body_apply_force(int32_t id, float fx, float fy, float fz, float px, float py, float pz);
int32_t bodyApplyImpulse(int32_t id, float ix, float iy, float iz, float px, float py, float pz);
int32_t body_apply_impulse(int32_t id, float ix, float iy, float iz, float px, float py, float pz);
int32_t bodyApplyTorque(int32_t id, float tx, float ty, float tz);
int32_t body_apply_torque(int32_t id, float tx, float ty, float tz);
int32_t bodyApplyAngularImpulse(int32_t id, float ix, float iy, float iz);
int32_t body_apply_angular_impulse(int32_t id, float ix, float iy, float iz);
int32_t bodySetMassData(int32_t id, float mass, float ix, float iy, float iz);
int32_t body_set_mass_data(int32_t id, float mass, float ix, float iy, float iz);
int32_t step(float dt, int32_t velocityIterations, int32_t positionIterations);
int32_t bodySetAwake(int32_t id, int32_t awake);
int32_t body_set_awake(int32_t id, int32_t awake);
int32_t bodyIsSleeping(int32_t id);
int32_t body_is_sleeping(int32_t id);
int32_t worldSetAllowSleep(int32_t on);
int32_t world_set_allow_sleep(int32_t on);
uintptr_t eventsPtr(void);
int32_t eventCount(void);
int32_t eventsOverflow(void);
void eventsClear(void);
int32_t shapeCreateSphere(int32_t bodyId, float radius, float density, float cx, float cy, float cz);
int32_t shape_create_sphere(int32_t bodyId, float radius, float density, float cx, float cy, float cz);
int32_t shapeCreateBox(int32_t bodyId, float hx, float hy, float hz, float density, float cx, float cy, float cz, float qx, float qy, float qz, float qw);
int32_t shape_create_box(int32_t bodyId, float hx, float hy, float hz, float density, float cx, float cy, float cz, float qx, float qy, float qz, float qw);
int32_t shapeCreateCapsule(int32_t bodyId, float radius, float halfSegment, float density, float cx, float cy, float cz, float qx, float qy, float qz, float qw);
int32_t shape_create_capsule(int32_t bodyId, float radius, float halfSegment, float density, float cx, float cy, float cz, float qx, float qy, float qz, float qw);
int32_t shapeCreateCylinder(int32_t bodyId, float radius, float halfHeight, float density, float cx, float cy, float cz, float qx, float qy, float qz, float qw);
int32_t shape_create_cylinder(int32_t bodyId, float radius, float halfHeight, float density, float cx, float cy, float cz, float qx, float qy, float qz, float qw);
int32_t shapeCreateCone(int32_t bodyId, float radius, float halfHeight, float density, float cx, float cy, float cz, float qx, float qy, float qz, float qw);
int32_t shape_create_cone(int32_t bodyId, float radius, float halfHeight, float density, float cx, float cy, float cz, float qx, float qy, float qz, float qw);
int32_t shapeDestroy(int32_t shapeId);
int32_t shape_destroy(int32_t shapeId);
int32_t shapeCreateHull(int32_t bodyId, float density, float cx, float cy, float cz);
int32_t shape_create_hull(int32_t bodyId, float density, float cx, float cy, float cz);
int32_t shapeCreateMesh(int32_t bodyId, float density, float cx, float cy, float cz);
int32_t shape_create_mesh(int32_t bodyId, float density, float cx, float cy, float cz);
int32_t shapeCreateHeightField(int32_t bodyId, float density, float cx, float cy, float cz, int32_t width, int32_t depth, float scaleX, float scaleY, float scaleZ);
int32_t shape_create_height_field(int32_t bodyId, float density, float cx, float cy, float cz, int32_t width, int32_t depth, float scaleX, float scaleY, float scaleZ);
uintptr_t worldAlloc(int32_t bytes);
uintptr_t world_alloc(int32_t bytes);
int32_t worldRelease(uintptr_t address);
int32_t world_release(uintptr_t address);
int32_t shapeSetVertices(int32_t shapeId, uintptr_t address, int32_t count);
int32_t shape_set_vertices(int32_t shapeId, uintptr_t address, int32_t count);
int32_t shapeSetIndices(int32_t shapeId, uintptr_t address, int32_t count);
int32_t shape_set_indices(int32_t shapeId, uintptr_t address, int32_t count);
int32_t shapeSetHeightField(int32_t shapeId, uintptr_t address, int32_t width, int32_t depth, float scaleX, float scaleY, float scaleZ);
int32_t shape_set_height_field(int32_t shapeId, uintptr_t address, int32_t width, int32_t depth, float scaleX, float scaleY, float scaleZ);
int32_t shapeClear(int32_t bodyId);
int32_t shape_clear(int32_t bodyId);
int32_t shapeGetBody(int32_t shapeId);
int32_t shape_get_body(int32_t shapeId);
int32_t shapeGetKind(int32_t shapeId);
int32_t shape_get_kind(int32_t shapeId);
int32_t shapeSetMaterial(int32_t shapeId, float friction, float restitution);
int32_t shape_set_material(int32_t shapeId, float friction, float restitution);
int32_t shapeGetMaterial(int32_t shapeId, uintptr_t out2f32);
int32_t shape_get_material(int32_t shapeId, uintptr_t out2f32);
int32_t shapeSetSensor(int32_t shapeId, int32_t on);
int32_t shape_set_sensor(int32_t shapeId, int32_t on);
int32_t shapeIsSensor(int32_t shapeId);
int32_t shape_is_sensor(int32_t shapeId);
int32_t shapeSetFilter(int32_t shapeId, int32_t categoryBits, int32_t maskBits, int32_t groupIndex);
int32_t shape_set_filter(int32_t shapeId, int32_t categoryBits, int32_t maskBits, int32_t groupIndex);
int32_t shapeGetFilter(int32_t shapeId, uintptr_t out3i32);
int32_t shape_get_filter(int32_t shapeId, uintptr_t out3i32);
int32_t bodyCount(void);
int32_t body_count(void);
int32_t contactCount(void);
int32_t contact_count(void);
uintptr_t transformsPtr(void);
uintptr_t transforms_ptr(void);
uintptr_t velocitiesPtr(void);
uintptr_t velocities_ptr(void);
uintptr_t angularVelocitiesPtr(void);
uintptr_t angular_velocities_ptr(void);
uintptr_t contactsPtr(void);
uintptr_t contacts_ptr(void);
uint64_t worldFingerprint(void);
uint64_t world_fingerprint(void);
uintptr_t worldMemoryBytes(void);
uintptr_t world_memory_bytes(void);
uint64_t get_transforms_view(void);
uint64_t get_velocities_view(void);
uint64_t get_angular_velocities_view(void);
uint64_t get_contacts_view(void);
uint64_t getTransformsView(void);
uint64_t getVelocitiesView(void);
uint64_t getAngularVelocitiesView(void);
uint64_t getContactsView(void);

int32_t constraintCreateFixed(int32_t bodyA, int32_t bodyB, float ax, float ay, float az, float bx, float by, float bz, int32_t collideConnected);
int32_t constraint_create_fixed(int32_t bodyA, int32_t bodyB, float ax, float ay, float az, float bx, float by, float bz, int32_t collideConnected);
int32_t constraintCreateHinge(int32_t bodyA, int32_t bodyB, float ax, float ay, float az, float bx, float by, float bz, float aax, float aay, float aaz, float abx, float aby, float abz, int32_t enableLimit, float lower, float upper, int32_t enableMotor, float motorSpeed, float maxMotorTorque, int32_t collideConnected);
int32_t constraint_create_hinge(int32_t bodyA, int32_t bodyB, float ax, float ay, float az, float bx, float by, float bz, float aax, float aay, float aaz, float abx, float aby, float abz, int32_t enableLimit, float lower, float upper, int32_t enableMotor, float motorSpeed, float maxMotorTorque, int32_t collideConnected);
int32_t constraintCreateSlider(int32_t bodyA, int32_t bodyB, float ax, float ay, float az, float bx, float by, float bz, float aax, float aay, float aaz, int32_t enableLimit, float lower, float upper, int32_t enableMotor, float motorSpeed, float maxMotorForce, int32_t collideConnected);
int32_t constraint_create_slider(int32_t bodyA, int32_t bodyB, float ax, float ay, float az, float bx, float by, float bz, float aax, float aay, float aaz, int32_t enableLimit, float lower, float upper, int32_t enableMotor, float motorSpeed, float maxMotorForce, int32_t collideConnected);
int32_t constraintCreateSpring(int32_t bodyA, int32_t bodyB, float ax, float ay, float az, float bx, float by, float bz, float restLength, float stiffness, float damping, int32_t collideConnected);
int32_t constraint_create_spring(int32_t bodyA, int32_t bodyB, float ax, float ay, float az, float bx, float by, float bz, float restLength, float stiffness, float damping, int32_t collideConnected);
int32_t constraintDestroy(int32_t id);
int32_t constraint_destroy(int32_t id);
int32_t constraintSetEnabled(int32_t id, int32_t enabled);
int32_t constraint_set_enabled(int32_t id, int32_t enabled);
int32_t constraintSetHingeMotor(int32_t id, float speed, float maxTorque);
int32_t constraint_set_hinge_motor(int32_t id, float speed, float maxTorque);
int32_t constraintSetHingeLimit(int32_t id, int32_t enable, float lower, float upper);
int32_t constraint_set_hinge_limit(int32_t id, int32_t enable, float lower, float upper);
int32_t constraintSetSliderMotor(int32_t id, float speed, float maxForce);
int32_t constraint_set_slider_motor(int32_t id, float speed, float maxForce);
int32_t constraintSetSliderLimit(int32_t id, int32_t enable, float lower, float upper);
int32_t constraint_set_slider_limit(int32_t id, int32_t enable, float lower, float upper);
int32_t constraintCount(void);
int32_t constraint_count(void);
int32_t constraintGetKind(int32_t id);
int32_t constraint_get_kind(int32_t id);

int32_t raycastAll(float ox, float oy, float oz, float dx, float dy, float dz, float maxDistance, uintptr_t hits, int32_t capacity);
int32_t raycastClosest(float ox, float oy, float oz, float dx, float dy, float dz, float maxDistance, uintptr_t hit);
int32_t overlapSphere(float cx, float cy, float cz, float radius, uintptr_t ids, int32_t capacity);
uintptr_t queryScratchPtr(void);
int32_t queryScratchCapacity(void);

int32_t raycastAllV2(float ox, float oy, float oz, float dx, float dy, float dz, float maxDistance, int32_t categoryBits, int32_t maskBits, uintptr_t hits, int32_t capacity);
int32_t raycastClosestV2(float ox, float oy, float oz, float dx, float dy, float dz, float maxDistance, int32_t categoryBits, int32_t maskBits, uintptr_t hit);
int32_t overlapSphereV2(float cx, float cy, float cz, float radius, int32_t categoryBits, int32_t maskBits, uintptr_t ids, int32_t capacity);
int32_t overlapBoxAll(uintptr_t outBodyIds, int32_t capacity, float minX, float minY, float minZ, float maxX, float maxY, float maxZ);
int32_t queryPointAll(uintptr_t outBodyIds, int32_t capacity, float x, float y, float z);
uint64_t stepStatisticsView(void);

#ifdef __cplusplus
}
#endif
