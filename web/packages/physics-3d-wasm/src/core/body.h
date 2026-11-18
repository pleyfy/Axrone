#pragma once

#include "core/math.h"

namespace axrone::physics {

enum BodyState : int32_t {
    kBodyFree = 0,
    kBodyStatic = 1,
    kBodyDynamic = 2,
    kBodyKinematic = 3
};

enum ShapeKind : int32_t {
    kShapeNone = 0,
    kShapeSphere = 1,
    kShapeBox = 2,
    kShapeCapsule = 3,
    kShapeCylinder = 4,
    kShapeCone = 5,
    kShapeHull = 8,
    kShapeMesh = 9,
    kShapeHeightField = 10
};

struct ShapeBulk {
    uintptr_t blockStart;
    int32_t blockBytes;
    int32_t vertexCount;
    int32_t faceCount;
    Vec3* vertices;
    int32_t* faceStart;
    int32_t* faceIndices;
    Vec3* faceNormals;
    float* faceOffsets;
    int32_t triangleCount;
    uint32_t* indices;
    int32_t heightFieldWidth;
    int32_t heightFieldDepth;
    Vec3 heightFieldScale;
    float* heights;
    Vec3 localMin;
    Vec3 localMax;
};

struct Shape {
    int32_t kind;
    Vec3 extents;
    Vec3 offset;
    Mat3 rotation;
    float density;
    float friction;
    float restitution;
    int32_t categoryBits;
    int32_t maskBits;
    int32_t groupIndex;
    int32_t sensor;

    AXRONE_PHYSICS_INLINE void applyDefaults() {
        friction = kShapeMaterialInherit;
        restitution = kShapeMaterialInherit;
        categoryBits = kDefaultCategoryBits;
        maskBits = kDefaultMaskBits;
        groupIndex = 0;
        sensor = 0;
    }

    AXRONE_PHYSICS_INLINE void setSphere(float radius, float shapeDensity, const Vec3& shapeOffset) {
        kind = kShapeSphere;
        extents = Vec3(radius, 0.0f, 0.0f);
        offset = shapeOffset;
        rotation.setIdentity();
        density = shapeDensity;
        applyDefaults();
    }

    AXRONE_PHYSICS_INLINE void setBox(
        float hx,
        float hy,
        float hz,
        float shapeDensity,
        const Vec3& shapeOffset,
        float qx,
        float qy,
        float qz,
        float qw
    ) {
        kind = kShapeBox;
        extents = Vec3(hx, hy, hz);
        offset = shapeOffset;
        rotation.fromQuaternion(qx, qy, qz, qw);
        density = shapeDensity;
        applyDefaults();
    }

    AXRONE_PHYSICS_INLINE void setBoxIdentity(
        float hx,
        float hy,
        float hz,
        float shapeDensity,
        const Vec3& shapeOffset
    ) {
        kind = kShapeBox;
        extents = Vec3(hx, hy, hz);
        offset = shapeOffset;
        rotation.setIdentity();
        density = shapeDensity;
        applyDefaults();
    }

    AXRONE_PHYSICS_INLINE void setCapsule(
        float radius,
        float halfSegment,
        float shapeDensity,
        const Vec3& shapeOffset,
        float qx,
        float qy,
        float qz,
        float qw
    ) {
        kind = kShapeCapsule;
        extents = Vec3(radius, halfSegment, 0.0f);
        offset = shapeOffset;
        rotation.fromQuaternion(qx, qy, qz, qw);
        density = shapeDensity;
        applyDefaults();
    }

    AXRONE_PHYSICS_INLINE void setCylinder(
        float radius,
        float halfHeight,
        float shapeDensity,
        const Vec3& shapeOffset,
        float qx,
        float qy,
        float qz,
        float qw
    ) {
        kind = kShapeCylinder;
        extents = Vec3(radius, halfHeight, 0.0f);
        offset = shapeOffset;
        rotation.fromQuaternion(qx, qy, qz, qw);
        density = shapeDensity;
        applyDefaults();
    }

    AXRONE_PHYSICS_INLINE void setCone(
        float radius,
        float halfHeight,
        float shapeDensity,
        const Vec3& shapeOffset,
        float qx,
        float qy,
        float qz,
        float qw
    ) {
        kind = kShapeCone;
        extents = Vec3(radius, halfHeight, 0.0f);
        offset = shapeOffset;
        rotation.fromQuaternion(qx, qy, qz, qw);
        density = shapeDensity;
        applyDefaults();
    }

    AXRONE_PHYSICS_INLINE void resetBulkFields() {
        extents = Vec3();
    }

    AXRONE_PHYSICS_INLINE void setHull(
        float shapeDensity,
        const Vec3& shapeOffset,
        float qx,
        float qy,
        float qz,
        float qw
    ) {
        kind = kShapeHull;
        resetBulkFields();
        offset = shapeOffset;
        rotation.fromQuaternion(qx, qy, qz, qw);
        density = shapeDensity;
        applyDefaults();
    }

    AXRONE_PHYSICS_INLINE void setMesh(
        float shapeDensity,
        const Vec3& shapeOffset,
        float qx,
        float qy,
        float qz,
        float qw
    ) {
        kind = kShapeMesh;
        resetBulkFields();
        offset = shapeOffset;
        rotation.fromQuaternion(qx, qy, qz, qw);
        density = shapeDensity;
        applyDefaults();
    }

    AXRONE_PHYSICS_INLINE void setHeightField(
        float shapeDensity,
        const Vec3& shapeOffset,
        float qx,
        float qy,
        float qz,
        float qw
    ) {
        kind = kShapeHeightField;
        resetBulkFields();
        offset = shapeOffset;
        rotation.fromQuaternion(qx, qy, qz, qw);
        density = shapeDensity;
        applyDefaults();
    }
};

struct Body {
    int32_t state;
    int32_t shapeCount;
    float invMass;
    float gravityScale;
    float linearDamping;
    float angularDamping;
    float customMass;
    int32_t flags;
    Vec3 invInertia;
    Mat3 rotation;
    AABB aabb;
    float friction;
    float restitution;
    float sleepTime;
    int32_t awake;
    Vec3 customInertia;
    Vec3 forceAccum;
    Vec3 torqueAccum;
    Shape shapes[kMaxShapesPerBody];
};

static_assert(sizeof(Shape) == 112, "shape size must stay fixed for arena sizing");
static_assert(alignof(Shape) == 16, "shape must stay vector aligned");
static_assert(sizeof(Body) == 1072, "body size must stay fixed for arena sizing");
static_assert(alignof(Body) == 16, "body must stay vector aligned");

AXRONE_PHYSICS_INLINE Vec3 worldInvInertiaMul(const Body& body, const Vec3& torque) {
    const Vec3& inverse = body.invInertia;
    if (inverse.x == 0.0f && inverse.y == 0.0f && inverse.z == 0.0f) {
        return Vec3();
    }
    Vec3 local = body.rotation.transposeTransform(torque);
    local.x *= inverse.x;
    local.y *= inverse.y;
    local.z *= inverse.z;
    return body.rotation.transform(local);
}

struct World;

void refreshBodyRotation(World& world, int32_t id);

struct SweepRecord {
    float minX;
    float minY;
    float minZ;
    float maxX;
    float maxY;
    float maxZ;
    int32_t filter;
    int32_t pad;
};

static_assert(sizeof(SweepRecord) == 32, "sweep record must stay two per cache line");

AXRONE_PHYSICS_INLINE int32_t sweepFilterCode(int32_t state, int32_t slots) {
    return state | (slots << 2);
}

AXRONE_PHYSICS_INLINE int32_t sweepFilterState(int32_t filter) {
    return filter & 3;
}

AXRONE_PHYSICS_INLINE int32_t sweepFilterSlots(int32_t filter) {
    return filter >> 2;
}

AXRONE_PHYSICS_INLINE bool sweepQueryableFilter(int32_t filter) {
    return sweepFilterState(filter) != kBodyFree && sweepFilterSlots(filter) > 0;
}

AXRONE_PHYSICS_INLINE int32_t shapeSlots(const Body& body) {
    if (body.shapeCount <= 0) {
        return 0;
    }
    return body.shapeCount < kMaxShapesPerBody ? body.shapeCount : kMaxShapesPerBody;
}

AXRONE_PHYSICS_INLINE bool isBulkKind(int32_t kind) {
    return kind == kShapeHull || kind == kShapeMesh || kind == kShapeHeightField;
}

AXRONE_PHYSICS_INLINE bool shapeValid(const Shape& shape) {
    if (shape.kind == kShapeSphere) {
        return shape.extents.x > 0.0f;
    }
    if (shape.kind == kShapeBox) {
        return shape.extents.x > 0.0f && shape.extents.y > 0.0f && shape.extents.z > 0.0f;
    }
    if (shape.kind == kShapeCapsule) {
        return shape.extents.x > 0.0f && shape.extents.y >= 0.0f;
    }
    if (shape.kind == kShapeCylinder) {
        return shape.extents.x > 0.0f && shape.extents.y > 0.0f;
    }
    if (shape.kind == kShapeCone) {
        return shape.extents.x > 0.0f && shape.extents.y > 0.0f;
    }
    if (shape.kind == kShapeHull || shape.kind == kShapeMesh || shape.kind == kShapeHeightField) {
        return true;
    }
    return false;
}

AXRONE_PHYSICS_INLINE bool bodyQueryable(const Body& body) {
    return body.state != kBodyFree && shapeSlots(body) > 0;
}

AXRONE_PHYSICS_INLINE int32_t shapeEncodeId(int32_t generation, int32_t bodyId, int32_t slot) {
    return ((generation & kShapeIdGenMask) << kShapeIdGenShift) |
           ((bodyId & kShapeIdBodyMask) << kShapeIdSlotBits) |
           (slot & kShapeIdSlotMask);
}

AXRONE_PHYSICS_INLINE int32_t shapeDecodeSlot(int32_t shapeId) {
    return shapeId & kShapeIdSlotMask;
}

AXRONE_PHYSICS_INLINE int32_t shapeDecodeBodyId(int32_t shapeId) {
    return (shapeId >> kShapeIdSlotBits) & kShapeIdBodyMask;
}

AXRONE_PHYSICS_INLINE int32_t shapeDecodeGeneration(int32_t shapeId) {
    return (shapeId >> kShapeIdGenShift) & kShapeIdGenMask;
}

AXRONE_PHYSICS_INLINE bool shapeIdInRange(int32_t shapeId) {
    return shapeId >= 0 && shapeId <= kShapeIdMax;
}

AXRONE_PHYSICS_INLINE bool filtersCollide(const Shape& left, const Shape& right) {
    if (left.groupIndex != 0 && left.groupIndex == right.groupIndex) {
        return left.groupIndex > 0;
    }
    return (left.maskBits & right.categoryBits) != 0 && (right.maskBits & left.categoryBits) != 0;
}

AXRONE_PHYSICS_INLINE int32_t shapeTypeCode(int32_t kind) {
    if (kind == kShapeSphere) {
        return kShapeTypeCodeSphere;
    }
    if (kind == kShapeBox) {
        return kShapeTypeCodeBox;
    }
    if (kind == kShapeCapsule) {
        return kShapeTypeCodeCapsule;
    }
    if (kind == kShapeCylinder) {
        return kShapeTypeCodeCylinder;
    }
    if (kind == kShapeCone) {
        return kShapeTypeCodeCone;
    }
    if (kind == kShapeHull) {
        return kShapeTypeCodeHull;
    }
    if (kind == kShapeMesh) {
        return kShapeTypeCodeMesh;
    }
    if (kind == kShapeHeightField) {
        return kShapeTypeCodeHeightField;
    }
    return -1;
}

AXRONE_PHYSICS_INLINE float shapeEffectiveFriction(const Shape& shape, float bodyFriction) {
    return shape.friction >= 0.0f ? shape.friction : bodyFriction;
}

AXRONE_PHYSICS_INLINE float shapeEffectiveRestitution(const Shape& shape, float bodyRestitution) {
    return shape.restitution >= 0.0f ? shape.restitution : bodyRestitution;
}

AXRONE_PHYSICS_INLINE Vec3 shapeCenter(const Vec3& bodyPosition, const Mat3& bodyRotation, const Shape& shape) {
    return bodyPosition + bodyRotation.transform(shape.offset);
}

AXRONE_PHYSICS_INLINE void composeRotation(const Mat3& outer, const Mat3& inner, Mat3& result) {
    const float* o = outer.m;
    const float* i = inner.m;

    const float r00 = o[0] * i[0] + o[1] * i[3] + o[2] * i[6];
    const float r01 = o[0] * i[1] + o[1] * i[4] + o[2] * i[7];
    const float r02 = o[0] * i[2] + o[1] * i[5] + o[2] * i[8];
    const float r10 = o[3] * i[0] + o[4] * i[3] + o[5] * i[6];
    const float r11 = o[3] * i[1] + o[4] * i[4] + o[5] * i[7];
    const float r12 = o[3] * i[2] + o[4] * i[5] + o[5] * i[8];
    const float r20 = o[6] * i[0] + o[7] * i[3] + o[8] * i[6];
    const float r21 = o[6] * i[1] + o[7] * i[4] + o[8] * i[7];
    const float r22 = o[6] * i[2] + o[7] * i[5] + o[8] * i[8];

    result.m[0] = r00;
    result.m[1] = r01;
    result.m[2] = r02;
    result.m[3] = r10;
    result.m[4] = r11;
    result.m[5] = r12;
    result.m[6] = r20;
    result.m[7] = r21;
    result.m[8] = r22;
}

AXRONE_PHYSICS_INLINE void shapeWorldRotation(const Mat3& bodyRotation, const Shape& shape, Mat3& result) {
    composeRotation(bodyRotation, shape.rotation, result);
}

}
