#pragma once

#include "core/constants.h"
#include "platform/math.h"
#include "platform/wasm.h"

namespace axrone::physics {

struct alignas(16) Vec3 {
    float x;
    float y;
    float z;
    float pad;

    AXRONE_PHYSICS_INLINE constexpr Vec3() : x(0.0f), y(0.0f), z(0.0f), pad(0.0f) {}
    AXRONE_PHYSICS_INLINE constexpr Vec3(float xv, float yv, float zv) : x(xv), y(yv), z(zv), pad(0.0f) {}

    AXRONE_PHYSICS_INLINE Vec3 operator+(const Vec3& other) const {
        return Vec3(x + other.x, y + other.y, z + other.z);
    }

    AXRONE_PHYSICS_INLINE Vec3 operator-(const Vec3& other) const {
        return Vec3(x - other.x, y - other.y, z - other.z);
    }

    AXRONE_PHYSICS_INLINE Vec3 operator*(float scale) const {
        return Vec3(x * scale, y * scale, z * scale);
    }

    AXRONE_PHYSICS_INLINE Vec3 operator-() const {
        return Vec3(-x, -y, -z);
    }

    AXRONE_PHYSICS_INLINE Vec3& operator+=(const Vec3& other) {
        x += other.x;
        y += other.y;
        z += other.z;
        return *this;
    }

    AXRONE_PHYSICS_INLINE Vec3& operator-=(const Vec3& other) {
        x -= other.x;
        y -= other.y;
        z -= other.z;
        return *this;
    }

    AXRONE_PHYSICS_INLINE Vec3& operator*=(float scale) {
        x *= scale;
        y *= scale;
        z *= scale;
        return *this;
    }
};

static_assert(sizeof(Vec3) == 16, "Vec3 must remain a 16-byte SIMD value");
static_assert(alignof(Vec3) == 16, "Vec3 must remain SIMD aligned");

AXRONE_PHYSICS_INLINE float dot(const Vec3& left, const Vec3& right) {
    return left.x * right.x + left.y * right.y + left.z * right.z;
}

AXRONE_PHYSICS_INLINE Vec3 cross(const Vec3& left, const Vec3& right) {
    return Vec3(
        left.y * right.z - left.z * right.y,
        left.z * right.x - left.x * right.z,
        left.x * right.y - left.y * right.x
    );
}

AXRONE_PHYSICS_INLINE float lengthSq(const Vec3& value) {
    return dot(value, value);
}

AXRONE_PHYSICS_INLINE float length(const Vec3& value) {
    return sqrtf(lengthSq(value));
}

AXRONE_PHYSICS_INLINE Vec3 normalize(const Vec3& value) {
    const float len = length(value);
    if (len > kEps) {
        return value * (1.0f / len);
    }
    return Vec3(0.0f, 0.0f, 0.0f);
}

struct Mat3 {
    float m[9];

    AXRONE_PHYSICS_INLINE void setIdentity() {
        m[0] = 1.0f; m[1] = 0.0f; m[2] = 0.0f;
        m[3] = 0.0f; m[4] = 1.0f; m[5] = 0.0f;
        m[6] = 0.0f; m[7] = 0.0f; m[8] = 1.0f;
    }

    AXRONE_PHYSICS_INLINE void fromQuaternion(float qx, float qy, float qz, float qw) {
        const float xx = qx * qx;
        const float yy = qy * qy;
        const float zz = qz * qz;
        const float xy = qx * qy;
        const float xz = qx * qz;
        const float yz = qy * qz;
        const float xw = qx * qw;
        const float yw = qy * qw;
        const float zw = qz * qw;

        m[0] = 1.0f - 2.0f * (yy + zz);
        m[1] = 2.0f * (xy - zw);
        m[2] = 2.0f * (xz + yw);

        m[3] = 2.0f * (xy + zw);
        m[4] = 1.0f - 2.0f * (xx + zz);
        m[5] = 2.0f * (yz - xw);

        m[6] = 2.0f * (xz - yw);
        m[7] = 2.0f * (yz + xw);
        m[8] = 1.0f - 2.0f * (xx + yy);
    }

    AXRONE_PHYSICS_INLINE Vec3 transform(const Vec3& value) const {
        return Vec3(
            m[0] * value.x + m[1] * value.y + m[2] * value.z,
            m[3] * value.x + m[4] * value.y + m[5] * value.z,
            m[6] * value.x + m[7] * value.y + m[8] * value.z
        );
    }

    AXRONE_PHYSICS_INLINE Vec3 transposeTransform(const Vec3& value) const {
        return Vec3(
            m[0] * value.x + m[3] * value.y + m[6] * value.z,
            m[1] * value.x + m[4] * value.y + m[7] * value.z,
            m[2] * value.x + m[5] * value.y + m[8] * value.z
        );
    }
};

struct Transform {
    float px;
    float py;
    float pz;
    float qx;
    float qy;
    float qz;
    float qw;
};

struct AABB {
    float minX;
    float minY;
    float minZ;
    float maxX;
    float maxY;
    float maxZ;
};

AXRONE_PHYSICS_INLINE void expandAabb(AABB& box, const Vec3& point) {
    if (point.x < box.minX) box.minX = point.x;
    if (point.y < box.minY) box.minY = point.y;
    if (point.z < box.minZ) box.minZ = point.z;
    if (point.x > box.maxX) box.maxX = point.x;
    if (point.y > box.maxY) box.maxY = point.y;
    if (point.z > box.maxZ) box.maxZ = point.z;
}

AXRONE_PHYSICS_INLINE Vec3 transformPosition(const Transform& transform) {
    return Vec3(transform.px, transform.py, transform.pz);
}

AXRONE_PHYSICS_INLINE void normalizeQuaternion(Transform& transform) {
    const float len2 = transform.qx * transform.qx + transform.qy * transform.qy +
                       transform.qz * transform.qz + transform.qw * transform.qw;
    if (len2 < kQuatEps) {
        transform.qx = 0.0f;
        transform.qy = 0.0f;
        transform.qz = 0.0f;
        transform.qw = 1.0f;
        return;
    }
    const float inv = 1.0f / sqrtf(len2);
    transform.qx *= inv;
    transform.qy *= inv;
    transform.qz *= inv;
    transform.qw *= inv;
}

AXRONE_PHYSICS_INLINE void integrateRotation(Transform& transform, const Vec3& angularVelocity, float dt) {
    const float factor = 0.5f * dt;
    const float nx = transform.qx + factor * (transform.qw * angularVelocity.x + angularVelocity.y * transform.qz - angularVelocity.z * transform.qy);
    const float ny = transform.qy + factor * (transform.qw * angularVelocity.y + angularVelocity.z * transform.qx - angularVelocity.x * transform.qz);
    const float nz = transform.qz + factor * (transform.qw * angularVelocity.z + angularVelocity.x * transform.qy - angularVelocity.y * transform.qx);
    const float nw = transform.qw + factor * (-(angularVelocity.x * transform.qx + angularVelocity.y * transform.qy + angularVelocity.z * transform.qz));
    transform.qx = nx;
    transform.qy = ny;
    transform.qz = nz;
    transform.qw = nw;
    normalizeQuaternion(transform);
}

}
