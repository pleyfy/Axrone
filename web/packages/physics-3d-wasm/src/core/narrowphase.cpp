#include "core/narrowphase.h"

#include "core/polytope.h"
#include "platform/math.h"

namespace axrone::physics {

namespace {

struct ShapeWorld {
    int32_t kind;
    Vec3 center;
    Vec3 half;
    Mat3 rotation;
    const ShapeBulk* bulk;
};

struct SphereBoxContactData {
    float pen;
    Vec3 worldNormal;
    Vec3 point;
    Vec3 sphereSurface;
};

Vec3 worldPosition(const World& world, int32_t id) {
    return transformPosition(world.transforms[id]);
}

void loadShapeWorld(const World& world, int32_t id, int32_t slot, ShapeWorld& out) {
    const Body& body = world.bodies[id];
    const Shape& shape = body.shapes[slot];
    const Vec3 position = worldPosition(world, id);

    out.kind = shape.kind;
    out.half = shape.extents;
    out.center = shapeCenter(position, body.rotation, shape);
    out.bulk = isBulkKind(shape.kind) ? world.bulkOf(id, slot) : nullptr;
    if (shape.kind == kShapeSphere) {
        out.rotation = body.rotation;
    } else {
        shapeWorldRotation(body.rotation, shape, out.rotation);
    }
}

float shapeRadius(const ShapeWorld& shape) {
    return shape.half.x;
}

int32_t pairFeature(int32_t shapeIndexA, int32_t shapeIndexB, int32_t baseFeature) {
    return ((shapeIndexA * kMaxShapesPerBody + shapeIndexB) << 12) | baseFeature;
}

float boxProjection(const Vec3 axes[3], const Vec3& half, const Vec3& normal) {
    return half.x * fabsf(dot(axes[0], normal)) +
           half.y * fabsf(dot(axes[1], normal)) +
           half.z * fabsf(dot(axes[2], normal));
}

void addContact(
    World& world,
    int32_t a,
    int32_t b,
    Vec3 normal,
    float pen,
    Vec3 point,
    Vec3 surfA,
    Vec3 surfB,
    int32_t normalMode,
    Vec3 localNormal,
    int32_t shapeIndexA,
    int32_t shapeIndexB,
    int32_t baseFeature
) {
    if (world.contactCount >= world.maxContacts) {
        return;
    }

    if (a > b) {
        int32_t swap = a;
        a = b;
        b = swap;
        swap = shapeIndexA;
        shapeIndexA = shapeIndexB;
        shapeIndexB = swap;
        normal = -normal;
        Vec3 surfaceSwap = surfA;
        surfA = surfB;
        surfB = surfaceSwap;
        if (normalMode == 1) {
            normalMode = 2;
        } else if (normalMode == 2) {
            normalMode = 1;
        }
    }

    const int32_t feature = pairFeature(shapeIndexA, shapeIndexB, baseFeature);

    const int32_t index = world.contactCount++;
    Contact& contact = world.contacts[index];

    contact.a = a;
    contact.b = b;
    contact.shapeA = shapeIndexA;
    contact.shapeB = shapeIndexB;
    contact.normal = normal;
    contact.pen = pen;
    contact.normalMode = normalMode;
    contact.localNormal = localNormal;
    contact.t1 = Vec3();
    contact.t2 = Vec3();
    contact.ra = Vec3();
    contact.rb = Vec3();
    contact.massN = 0.0f;
    contact.massT1 = 0.0f;
    contact.massT2 = 0.0f;
    contact.impN = 0.0f;
    contact.impT1 = 0.0f;
    contact.impT2 = 0.0f;
    contact.velocityBias = 0.0f;

    const Shape& shapeA = world.bodies[a].shapes[shapeIndexA];
    const Shape& shapeB = world.bodies[b].shapes[shapeIndexB];
    const float frictionA = shapeEffectiveFriction(shapeA, world.bodies[a].friction);
    const float frictionB = shapeEffectiveFriction(shapeB, world.bodies[b].friction);
    contact.friction = sqrtf(frictionA * frictionB);
    const float restitutionA = shapeEffectiveRestitution(shapeA, world.bodies[a].restitution);
    const float restitutionB = shapeEffectiveRestitution(shapeB, world.bodies[b].restitution);
    contact.restitution = restitutionA > restitutionB ? restitutionA : restitutionB;
    contact.sensor = (shapeA.sensor != 0 || shapeB.sensor != 0) ? 1 : 0;

    if (contact.sensor != 0) {
        contact.cacheSlot = -1;
    } else {
        world.recordCacheLookup();
        const int32_t cached = world.cacheLookup(a, b, feature);
        if (cached >= 0) {
            world.recordCacheHit();
            const CacheEntry& entry = world.cachePrev[cached];
            contact.impN = entry.impN;
            contact.impT1 = entry.impT1;
            contact.impT2 = entry.impT2;
        }
        contact.cacheSlot = world.cacheStore(a, b, feature, contact.impN, contact.impT1, contact.impT2);
    }

    const Vec3 posA = worldPosition(world, a);
    const Vec3 posB = worldPosition(world, b);
    contact.ra = point - posA;
    contact.rb = point - posB;
    contact.localA = world.bodies[a].rotation.transposeTransform(surfA - posA);
    contact.localB = world.bodies[b].rotation.transposeTransform(surfB - posB);
}

void collideSphereVersusSphere(
    World& world,
    int32_t a,
    int32_t indexA,
    const Vec3& centerA,
    float radiusA,
    int32_t b,
    int32_t indexB,
    const Vec3& centerB,
    float radiusB,
    int32_t baseFeature
) {
    const Vec3 delta = centerB - centerA;

    const float radiusSum = radiusA + radiusB;
    const float distanceSq = lengthSq(delta);
    if (distanceSq > radiusSum * radiusSum) {
        return;
    }

    float distance = 0.0f;
    Vec3 normal(1.0f, 0.0f, 0.0f);
    if (distanceSq > kEps) {
        distance = sqrtf(distanceSq);
        normal = delta * (1.0f / distance);
    }

    const float pen = radiusSum - distance;
    const Vec3 point = centerA + normal * (radiusA - pen * 0.5f);
    const Vec3 surfA = centerA + normal * radiusA;
    const Vec3 surfB = centerB - normal * radiusB;

    addContact(world, a, b, normal, pen, point, surfA, surfB, 0, Vec3(), indexA, indexB, baseFeature);
}

void collideSphereSphere(World& world, int32_t a, int32_t indexA, const ShapeWorld& sphereA, int32_t b, int32_t indexB, const ShapeWorld& sphereB) {
    collideSphereVersusSphere(
        world,
        a,
        indexA,
        sphereA.center,
        shapeRadius(sphereA),
        b,
        indexB,
        sphereB.center,
        shapeRadius(sphereB),
        kKindSphereSphere * 16);
}

void capsuleSegment(const ShapeWorld& capsule, Vec3& p0, Vec3& p1) {
    const float halfSegment = capsule.half.y;
    const Vec3 axis(
        capsule.rotation.m[1] * halfSegment,
        capsule.rotation.m[4] * halfSegment,
        capsule.rotation.m[7] * halfSegment
    );
    p0 = capsule.center - axis;
    p1 = capsule.center + axis;
}

Vec3 closestPointOnSegment(const Vec3& point, const Vec3& p0, const Vec3& p1) {
    const Vec3 direction = p1 - p0;
    const float span = lengthSq(direction);
    if (span <= kEps) {
        return p0;
    }
    const float s = clampf(dot(point - p0, direction) / span, 0.0f, 1.0f);
    return p0 + direction * s;
}

void closestPointsBetweenSegments(
    const Vec3& a0,
    const Vec3& a1,
    const Vec3& b0,
    const Vec3& b1,
    Vec3& outA,
    Vec3& outB
) {
    const Vec3 d1 = a1 - a0;
    const Vec3 d2 = b1 - b0;
    const Vec3 w = a0 - b0;
    const float aa = dot(d1, d1);
    const float bb = dot(d1, d2);
    const float cc = dot(d2, d2);
    const float dd = dot(d1, w);
    const float ee = dot(d2, w);

    float s = 0.0f;
    float t = 0.0f;

    if (aa <= kEps && cc <= kEps) {
        s = 0.0f;
        t = 0.0f;
    } else if (aa <= kEps) {
        t = clampf(ee / cc, 0.0f, 1.0f);
    } else if (cc <= kEps) {
        s = clampf(-dd / aa, 0.0f, 1.0f);
    } else {
        const float denominator = aa * cc - bb * bb;
        s = denominator > kEps ? clampf((bb * ee - cc * dd) / denominator, 0.0f, 1.0f) : 0.0f;
        t = clampf((ee + bb * s) / cc, 0.0f, 1.0f);
        s = clampf((t * bb - dd) / aa, 0.0f, 1.0f);
    }

    outA = a0 + d1 * s;
    outB = b0 + d2 * t;
}

void collideSphereCapsule(
    World& world,
    int32_t sphere,
    int32_t sphereIndex,
    const ShapeWorld& sphereShape,
    int32_t capsule,
    int32_t capsuleIndex,
    const ShapeWorld& capsuleShape
) {
    Vec3 p0;
    Vec3 p1;
    capsuleSegment(capsuleShape, p0, p1);
    const Vec3 anchor = closestPointOnSegment(sphereShape.center, p0, p1);

    collideSphereVersusSphere(
        world,
        sphere,
        sphereIndex,
        sphereShape.center,
        shapeRadius(sphereShape),
        capsule,
        capsuleIndex,
        anchor,
        shapeRadius(capsuleShape),
        kKindCapsuleSphere * 16);
}

void collideCapsuleCapsule(
    World& world,
    int32_t a,
    int32_t indexA,
    const ShapeWorld& capsuleA,
    int32_t b,
    int32_t indexB,
    const ShapeWorld& capsuleB
) {
    Vec3 a0;
    Vec3 a1;
    Vec3 b0;
    Vec3 b1;
    capsuleSegment(capsuleA, a0, a1);
    capsuleSegment(capsuleB, b0, b1);

    Vec3 pointA;
    Vec3 pointB;
    closestPointsBetweenSegments(a0, a1, b0, b1, pointA, pointB);

    collideSphereVersusSphere(
        world,
        a,
        indexA,
        pointA,
        shapeRadius(capsuleA),
        b,
        indexB,
        pointB,
        shapeRadius(capsuleB),
        kKindCapsuleCapsule * 16);

    const float radiusA = shapeRadius(capsuleA);
    const float radiusB = shapeRadius(capsuleB);
    const float radiusSum = radiusA + radiusB;

    Vec3 accepted[kCapsuleManifoldCapacity];
    int32_t acceptedCount = 0;
    accepted[acceptedCount++] = (pointA + pointB) * 0.5f;

    for (int32_t i = 0; i < 2 && acceptedCount < kCapsuleManifoldCapacity; ++i) {
        const Vec3& endpoint = i == 0 ? a0 : a1;
        const Vec3 anchor = closestPointOnSegment(endpoint, b0, b1);
        const Vec3 delta = anchor - endpoint;
        const float distanceSq = lengthSq(delta);
        if (distanceSq >= radiusSum * radiusSum || distanceSq <= kEps) {
            continue;
        }
        const float distance = sqrtf(distanceSq);
        const float pen = radiusSum - distance;
        const Vec3 normal = delta * (1.0f / distance);
        const Vec3 point = endpoint + normal * (radiusA - pen * 0.5f);

        bool duplicate = false;
        for (int32_t j = 0; j < acceptedCount; ++j) {
            if (lengthSq(point - accepted[j]) < kCrossEps) {
                duplicate = true;
                break;
            }
        }
        if (duplicate) {
            continue;
        }

        addContact(
            world,
            a,
            b,
            normal,
            pen,
            point,
            endpoint + normal * radiusA,
            anchor - normal * radiusB,
            0,
            Vec3(),
            indexA,
            indexB,
            kKindCapsuleCapsule * 16 + acceptedCount);
        accepted[acceptedCount++] = point;
    }

    for (int32_t i = 0; i < 2 && acceptedCount < kCapsuleManifoldCapacity; ++i) {
        const Vec3& endpoint = i == 0 ? b0 : b1;
        const Vec3 anchor = closestPointOnSegment(endpoint, a0, a1);
        const Vec3 delta = anchor - endpoint;
        const float distanceSq = lengthSq(delta);
        if (distanceSq >= radiusSum * radiusSum || distanceSq <= kEps) {
            continue;
        }
        const float distance = sqrtf(distanceSq);
        const float pen = radiusSum - distance;
        const Vec3 normal = delta * (-1.0f / distance);
        const Vec3 point = anchor + normal * (radiusA - pen * 0.5f);

        bool duplicate = false;
        for (int32_t j = 0; j < acceptedCount; ++j) {
            if (lengthSq(point - accepted[j]) < kCrossEps) {
                duplicate = true;
                break;
            }
        }
        if (duplicate) {
            continue;
        }

        addContact(
            world,
            a,
            b,
            normal,
            pen,
            point,
            anchor + normal * radiusA,
            endpoint - normal * radiusB,
            0,
            Vec3(),
            indexA,
            indexB,
            kKindCapsuleCapsule * 16 + acceptedCount);
        accepted[acceptedCount++] = point;
    }
}

bool sphereBoxTest(const ShapeWorld& sphereShape, const ShapeWorld& boxShape, SphereBoxContactData& data) {
    const Vec3 delta = sphereShape.center - boxShape.center;

    const Vec3 localSphere = boxShape.rotation.transposeTransform(delta);
    const Vec3 half = boxShape.half;

    const Vec3 closest(
        localSphere.x > half.x ? half.x : (localSphere.x < -half.x ? -half.x : localSphere.x),
        localSphere.y > half.y ? half.y : (localSphere.y < -half.y ? -half.y : localSphere.y),
        localSphere.z > half.z ? half.z : (localSphere.z < -half.z ? -half.z : localSphere.z)
    );

    const Vec3 difference = localSphere - closest;
    const float distanceSq = lengthSq(difference);
    const float radius = shapeRadius(sphereShape);
    if (distanceSq > radius * radius) {
        return false;
    }

    Vec3 localNormal(0.0f, 0.0f, 0.0f);
    float pen = 0.0f;
    Vec3 localPoint = closest;

    if (distanceSq > kEps) {
        const float distance = sqrtf(distanceSq);
        localNormal = difference * (1.0f / distance);
        pen = radius - distance;
    } else {
        const float faceX = half.x - fabsf(localSphere.x);
        const float faceY = half.y - fabsf(localSphere.y);
        const float faceZ = half.z - fabsf(localSphere.z);

        if (faceX <= faceY && faceX <= faceZ) {
            localNormal.x = localSphere.x >= 0.0f ? 1.0f : -1.0f;
            localPoint.x = localNormal.x * half.x;
            pen = radius + faceX;
        } else if (faceY <= faceZ) {
            localNormal.y = localSphere.y >= 0.0f ? 1.0f : -1.0f;
            localPoint.y = localNormal.y * half.y;
            pen = radius + faceY;
        } else {
            localNormal.z = localSphere.z >= 0.0f ? 1.0f : -1.0f;
            localPoint.z = localNormal.z * half.z;
            pen = radius + faceZ;
        }
    }

    const Vec3 worldNormal = boxShape.rotation.transform(localNormal);
    const Vec3 point = boxShape.center + boxShape.rotation.transform(localPoint);

    data.pen = pen;
    data.worldNormal = worldNormal;
    data.point = point;
    data.sphereSurface = sphereShape.center - worldNormal * radius;
    return true;
}

void collideSphereBox(
    World& world,
    int32_t sphere,
    int32_t sphereIndex,
    const ShapeWorld& sphereShape,
    int32_t box,
    int32_t boxIndex,
    const ShapeWorld& boxShape,
    bool sphereIsA,
    int32_t baseFeature
) {
    SphereBoxContactData data;
    if (!sphereBoxTest(sphereShape, boxShape, data)) {
        return;
    }

    if (sphereIsA) {
        addContact(world, sphere, box, -data.worldNormal, data.pen, data.point, data.sphereSurface, data.point, 0, Vec3(), sphereIndex, boxIndex, baseFeature);
    } else {
        addContact(world, box, sphere, data.worldNormal, data.pen, data.point, data.point, data.sphereSurface, 0, Vec3(), boxIndex, sphereIndex, baseFeature);
    }
}

Vec3 clampToBox(const Vec3& value, const Vec3& half) {
    return Vec3(
        value.x > half.x ? half.x : (value.x < -half.x ? -half.x : value.x),
        value.y > half.y ? half.y : (value.y < -half.y ? -half.y : value.y),
        value.z > half.z ? half.z : (value.z < -half.z ? -half.z : value.z)
    );
}

float segmentBoxParametricDistanceSq(const Vec3& l0, const Vec3& dl, const Vec3& half, float t, Vec3& outLocal, Vec3& outClamped) {
    outLocal = l0 + dl * t;
    outClamped = clampToBox(outLocal, half);
    const Vec3 difference = outLocal - outClamped;
    return lengthSq(difference);
}

float closestSegmentBoxParameter(const Vec3& l0, const Vec3& l1, const Vec3& half) {
    const Vec3 dl = l1 - l0;
    float lo = 0.0f;
    float hi = 1.0f;
    float bestT = 0.0f;
    int32_t bestIndex = 0;

    for (int32_t pass = 0; pass < 2; ++pass) {
        float bestDistanceSq = kBig;
        const float step = (hi - lo) / static_cast<float>(kCapsuleBoxSamples);
        for (int32_t i = 0; i <= kCapsuleBoxSamples; ++i) {
            const float t = lo + step * static_cast<float>(i);
            Vec3 local;
            Vec3 clamped;
            const float distanceSq = segmentBoxParametricDistanceSq(l0, dl, half, t, local, clamped);
            if (distanceSq < bestDistanceSq) {
                bestDistanceSq = distanceSq;
                bestT = t;
                bestIndex = i;
            }
        }
        if (pass == 1) {
            break;
        }
        const float windowStart = lo + step * static_cast<float>(bestIndex - 1 > 0 ? bestIndex - 1 : 0);
        const float windowEnd = lo + step * static_cast<float>(bestIndex + 1 < kCapsuleBoxSamples ? bestIndex + 1 : kCapsuleBoxSamples);
        lo = windowStart;
        hi = windowEnd;
    }

    return bestT;
}

void collideCapsuleBox(
    World& world,
    int32_t capsule,
    int32_t capsuleIndex,
    const ShapeWorld& capsuleShape,
    int32_t box,
    int32_t boxIndex,
    const ShapeWorld& boxShape,
    bool capsuleIsA
) {
    Vec3 p0;
    Vec3 p1;
    capsuleSegment(capsuleShape, p0, p1);

    const Vec3 delta0 = p0 - boxShape.center;
    const Vec3 delta1 = p1 - boxShape.center;
    const Vec3 l0 = boxShape.rotation.transposeTransform(delta0);
    const Vec3 l1 = boxShape.rotation.transposeTransform(delta1);

    const float t = closestSegmentBoxParameter(l0, l1, boxShape.half);
    const Vec3 localAnchor = l0 + (l1 - l0) * t;
    const Vec3 worldAnchor = boxShape.center + boxShape.rotation.transform(localAnchor);

    const float radius = shapeRadius(capsuleShape);

    ShapeWorld anchorSphere;
    anchorSphere.kind = kShapeSphere;
    anchorSphere.center = worldAnchor;
    anchorSphere.half = Vec3(radius, 0.0f, 0.0f);
    anchorSphere.rotation = boxShape.rotation;

    SphereBoxContactData candidates[kCapsuleManifoldCapacity];
    int32_t candidateCount = 0;

    SphereBoxContactData anchorData;
    if (sphereBoxTest(anchorSphere, boxShape, anchorData)) {
        candidates[candidateCount++] = anchorData;
    }

    ShapeWorld probeSphere;
    probeSphere.kind = kShapeSphere;
    probeSphere.half = anchorSphere.half;
    probeSphere.rotation = boxShape.rotation;

    for (int32_t i = 0; i < 2 && candidateCount < kCapsuleManifoldCapacity; ++i) {
        probeSphere.center = i == 0 ? p0 : p1;
        SphereBoxContactData probeData;
        if (!sphereBoxTest(probeSphere, boxShape, probeData)) {
            continue;
        }
        bool duplicate = false;
        for (int32_t j = 0; j < candidateCount; ++j) {
            if (lengthSq(probeData.point - candidates[j].point) < kCrossEps) {
                duplicate = true;
                break;
            }
        }
        if (!duplicate) {
            candidates[candidateCount++] = probeData;
        }
    }

    for (int32_t k = 1; k < candidateCount; ++k) {
        for (int32_t j = k; j > 0 && candidates[j].pen > candidates[j - 1].pen; --j) {
            const SphereBoxContactData swap = candidates[j];
            candidates[j] = candidates[j - 1];
            candidates[j - 1] = swap;
        }
    }

    for (int32_t k = 0; k < candidateCount; ++k) {
        const SphereBoxContactData& data = candidates[k];
        if (capsuleIsA) {
            addContact(
                world,
                capsule,
                box,
                -data.worldNormal,
                data.pen,
                data.point,
                data.sphereSurface,
                data.point,
                0,
                Vec3(),
                capsuleIndex,
                boxIndex,
                kKindCapsuleBox * 16 + k);
        } else {
            addContact(
                world,
                box,
                capsule,
                data.worldNormal,
                data.pen,
                data.point,
                data.point,
                data.sphereSurface,
                0,
                Vec3(),
                boxIndex,
                capsuleIndex,
                kKindCapsuleBox * 16 + k);
        }
    }
}

void buildFace(const Vec3& center, const Vec3 axes[3], const Vec3& half, int32_t axisIndex, float sign, Vec3 out[4]) {
    const int32_t uIndex = (axisIndex + 1) % 3;
    const int32_t vIndex = (axisIndex + 2) % 3;

    const Vec3 u = axes[uIndex];
    const Vec3 v = axes[vIndex];
    const float hu = uIndex == 0 ? half.x : (uIndex == 1 ? half.y : half.z);
    const float hv = vIndex == 0 ? half.x : (vIndex == 1 ? half.y : half.z);
    const float ha = axisIndex == 0 ? half.x : (axisIndex == 1 ? half.y : half.z);

    const Vec3 faceCenter = center + axes[axisIndex] * (sign * ha);

    out[0] = faceCenter + u * hu + v * hv;
    out[1] = faceCenter - u * hu + v * hv;
    out[2] = faceCenter - u * hu - v * hv;
    out[3] = faceCenter + u * hu - v * hv;
}

int32_t clipPlane(
    const Vec3 input[],
    int32_t count,
    Vec3 output[],
    int32_t outputCapacity,
    const Vec3& reference,
    const Vec3& normal,
    float offset
) {
    if (count == 0 || outputCapacity <= 0) {
        return 0;
    }

    int32_t outputCount = 0;
    Vec3 previous = input[count - 1];
    float previousDistance = dot(previous - reference, normal) - offset;

    for (int32_t i = 0; i < count; ++i) {
        const Vec3 current = input[i];
        const float currentDistance = dot(current - reference, normal) - offset;
        const bool previousInside = previousDistance <= 0.0f;
        const bool currentInside = currentDistance <= 0.0f;

        if (previousInside != currentInside) {
            if (outputCount >= outputCapacity) {
                return outputCount;
            }
            const float t = previousDistance / (previousDistance - currentDistance);
            output[outputCount++] = previous + (current - previous) * t;
        }
        if (currentInside) {
            if (outputCount >= outputCapacity) {
                return outputCount;
            }
            output[outputCount++] = current;
        }

        previous = current;
        previousDistance = currentDistance;
    }

    return outputCount;
}

void addFaceContacts(
    World& world,
    int32_t a,
    int32_t indexA,
    const ShapeWorld& shapeA,
    int32_t b,
    int32_t indexB,
    const ShapeWorld& shapeB,
    const Vec3& normal,
    bool referenceIsA,
    int32_t axisIndex
) {
    const Vec3* referenceAxes = referenceIsA ? world.narrowphaseScratch->axesA : world.narrowphaseScratch->axesB;
    const Vec3* incidentAxes = referenceIsA ? world.narrowphaseScratch->axesB : world.narrowphaseScratch->axesA;
    const ShapeWorld& referenceShape = referenceIsA ? shapeA : shapeB;
    const ShapeWorld& incidentShape = referenceIsA ? shapeB : shapeA;
    const int32_t reference = referenceIsA ? a : b;

    const Vec3 referenceNormal = referenceIsA ? normal : -normal;
    const float sign = dot(referenceAxes[axisIndex], referenceNormal) >= 0.0f ? 1.0f : -1.0f;

    const Vec3& referenceHalf = referenceShape.half;
    const float referenceHalfExtent = axisIndex == 0 ? referenceHalf.x : (axisIndex == 1 ? referenceHalf.y : referenceHalf.z);

    const Vec3 referencePosition = referenceShape.center;
    const Vec3 faceCenter = referencePosition + referenceAxes[axisIndex] * (sign * referenceHalfExtent);

    const int32_t uIndex = (axisIndex + 1) % 3;
    const int32_t vIndex = (axisIndex + 2) % 3;
    const Vec3 u = referenceAxes[uIndex];
    const Vec3 v = referenceAxes[vIndex];
    const float hu = uIndex == 0 ? referenceHalf.x : (uIndex == 1 ? referenceHalf.y : referenceHalf.z);
    const float hv = vIndex == 0 ? referenceHalf.x : (vIndex == 1 ? referenceHalf.y : referenceHalf.z);

    float bestDot = -1.0f;
    int32_t incidentAxis = 0;
    float incidentSign = 1.0f;

    for (int32_t k = 0; k < 3; ++k) {
        const float d = dot(incidentAxes[k], referenceNormal);
        const float absolute = fabsf(d);
        if (absolute > bestDot) {
            bestDot = absolute;
            incidentAxis = k;
            incidentSign = d >= 0.0f ? -1.0f : 1.0f;
        }
    }

    buildFace(incidentShape.center, incidentAxes, incidentShape.half, incidentAxis, incidentSign, world.narrowphaseScratch->faceVertices);

    int32_t count = clipPlane(world.narrowphaseScratch->faceVertices, 4, world.narrowphaseScratch->clipA, 16, referencePosition, u, hu);
    count = clipPlane(world.narrowphaseScratch->clipA, count, world.narrowphaseScratch->clipB, 16, referencePosition, -u, hu);
    count = clipPlane(world.narrowphaseScratch->clipB, count, world.narrowphaseScratch->clipA, 16, referencePosition, v, hv);
    count = clipPlane(world.narrowphaseScratch->clipA, count, world.narrowphaseScratch->clipB, 16, referencePosition, -v, hv);

    const int32_t start = world.contactCount;
    int32_t added = 0;
    const Vec3 localNormal = world.bodies[reference].rotation.transposeTransform(referenceNormal);

    for (int32_t i = 0; i < count; ++i) {
        const Vec3 point = world.narrowphaseScratch->clipB[i];
        const float separation = dot(point - faceCenter, referenceNormal);
        if (separation > 0.0f) {
            continue;
        }

        bool duplicate = false;
        for (int32_t j = start; j < world.contactCount; ++j) {
            const Contact& existing = world.contacts[j];
            const Vec3 existingPoint = transformPosition(world.transforms[existing.a]) + existing.ra;
            if (lengthSq(point - existingPoint) < kCrossEps) {
                duplicate = true;
                break;
            }
        }
        if (duplicate) {
            continue;
        }

        const Vec3 referencePoint = point - referenceNormal * separation;
        if (referenceIsA) {
            addContact(world, a, b, normal, -separation, point, referencePoint, point, 1, localNormal, indexA, indexB, kKindBoxFace * 16 + added);
        } else {
            addContact(world, a, b, normal, -separation, point, point, referencePoint, 2, localNormal, indexA, indexB, kKindBoxFace * 16 + added);
        }

        if (++added >= world.boxManifoldPointCap()) {
            break;
        }
    }

    if (added > 0) {
        StepStatistics& statistics = world.mutableStepStatistics();
        ++statistics.boxPointBuckets[added - 1];
        ++statistics.boxPairsTotal;
        ++statistics.boxFacePairs;
        statistics.boxClipCandidateTotal += static_cast<uint32_t>(count);
    }
}

void addEdgeContact(
    World& world,
    int32_t a,
    int32_t indexA,
    const ShapeWorld& shapeA,
    int32_t b,
    int32_t indexB,
    const ShapeWorld& shapeB,
    const Vec3& normal,
    int32_t axisA,
    int32_t axisB,
    float pen
) {
    const Vec3& halfA = shapeA.half;
    Vec3 centerA = shapeA.center;
    for (int32_t k = 0; k < 3; ++k) {
        if (k == axisA) {
            continue;
        }
        const float d = dot(world.narrowphaseScratch->axesA[k], normal);
        const float sign = d >= 0.0f ? 1.0f : -1.0f;
        const float half = k == 0 ? halfA.x : (k == 1 ? halfA.y : halfA.z);
        centerA += world.narrowphaseScratch->axesA[k] * (sign * half);
    }
    const Vec3 directionA = world.narrowphaseScratch->axesA[axisA];
    const float halfExtentA = axisA == 0 ? halfA.x : (axisA == 1 ? halfA.y : halfA.z);

    const Vec3& halfB = shapeB.half;
    Vec3 centerB = shapeB.center;
    for (int32_t k = 0; k < 3; ++k) {
        if (k == axisB) {
            continue;
        }
        const float d = dot(world.narrowphaseScratch->axesB[k], normal);
        const float sign = d <= 0.0f ? 1.0f : -1.0f;
        const float half = k == 0 ? halfB.x : (k == 1 ? halfB.y : halfB.z);
        centerB += world.narrowphaseScratch->axesB[k] * (sign * half);
    }
    const Vec3 directionB = world.narrowphaseScratch->axesB[axisB];
    const float halfExtentB = axisB == 0 ? halfB.x : (axisB == 1 ? halfB.y : halfB.z);

    const Vec3 offset = centerA - centerB;
    const float dotDirections = dot(directionA, directionB);
    const float dotA = dot(directionA, offset);
    const float dotB = dot(directionB, offset);
    const float denominator = 1.0f - dotDirections * dotDirections;

    float s = denominator > kEps ? (dotDirections * dotB - dotA) / denominator : 0.0f;
    s = clampf(s, -halfExtentA, halfExtentA);

    float t = dotDirections * s + dotB;
    t = clampf(t, -halfExtentB, halfExtentB);

    s = dotDirections * t - dotA;
    s = clampf(s, -halfExtentA, halfExtentA);

    const Vec3 pointA = centerA + directionA * s;
    const Vec3 pointB = centerB + directionB * t;

    addContact(world, a, b, normal, pen, (pointA + pointB) * 0.5f, pointA, pointB, 0, Vec3(), indexA, indexB, kKindBoxEdge * 16);

    StepStatistics& statistics = world.mutableStepStatistics();
    ++statistics.boxPointBuckets[0];
    ++statistics.boxPairsTotal;
    ++statistics.boxEdgePairs;
}

void collideBoxBox(World& world, int32_t a, int32_t indexA, const ShapeWorld& shapeA, int32_t b, int32_t indexB, const ShapeWorld& shapeB) {
    const Mat3& rotationA = shapeA.rotation;
    world.narrowphaseScratch->axesA[0] = Vec3(rotationA.m[0], rotationA.m[3], rotationA.m[6]);
    world.narrowphaseScratch->axesA[1] = Vec3(rotationA.m[1], rotationA.m[4], rotationA.m[7]);
    world.narrowphaseScratch->axesA[2] = Vec3(rotationA.m[2], rotationA.m[5], rotationA.m[8]);

    const Mat3& rotationB = shapeB.rotation;
    world.narrowphaseScratch->axesB[0] = Vec3(rotationB.m[0], rotationB.m[3], rotationB.m[6]);
    world.narrowphaseScratch->axesB[1] = Vec3(rotationB.m[1], rotationB.m[4], rotationB.m[7]);
    world.narrowphaseScratch->axesB[2] = Vec3(rotationB.m[2], rotationB.m[5], rotationB.m[8]);

    const Vec3 offset = shapeB.center - shapeA.center;
    const Vec3& halfA = shapeA.half;
    const Vec3& halfB = shapeB.half;

    float bestSeparation = -kBig;
    int32_t bestKind = 0;
    int32_t bestIndexA = 0;
    int32_t bestIndexB = 0;
    Vec3 bestNormal(1.0f, 0.0f, 0.0f);

    for (int32_t i = 0; i < 3; ++i) {
        const Vec3 axis = world.narrowphaseScratch->axesA[i];
        const float d = dot(offset, axis);
        const float separation = fabsf(d) - boxProjection(world.narrowphaseScratch->axesA, halfA, axis) - boxProjection(world.narrowphaseScratch->axesB, halfB, axis);
        if (separation > 0.0f) {
            return;
        }
        if (separation > bestSeparation) {
            bestSeparation = separation;
            bestKind = 1;
            bestIndexA = i;
            bestNormal = axis * (d >= 0.0f ? 1.0f : -1.0f);
        }
    }

    for (int32_t i = 0; i < 3; ++i) {
        const Vec3 axis = world.narrowphaseScratch->axesB[i];
        const float d = dot(offset, axis);
        const float separation = fabsf(d) - boxProjection(world.narrowphaseScratch->axesA, halfA, axis) - boxProjection(world.narrowphaseScratch->axesB, halfB, axis);
        if (separation > 0.0f) {
            return;
        }
        if (separation > bestSeparation) {
            bestSeparation = separation;
            bestKind = 2;
            bestIndexA = i;
            bestNormal = axis * (d >= 0.0f ? 1.0f : -1.0f);
        }
    }

    for (int32_t i = 0; i < 3; ++i) {
        for (int32_t j = 0; j < 3; ++j) {
            const Vec3 axis = cross(world.narrowphaseScratch->axesA[i], world.narrowphaseScratch->axesB[j]);
            const float lengthSquared = lengthSq(axis);
            if (lengthSquared < kCrossEps) {
                continue;
            }

            const Vec3 normalized = axis * (1.0f / sqrtf(lengthSquared));
            const float d = dot(offset, normalized);
            const float separation = fabsf(d) - boxProjection(world.narrowphaseScratch->axesA, halfA, normalized) - boxProjection(world.narrowphaseScratch->axesB, halfB, normalized);
            if (separation > 0.0f) {
                return;
            }

            const float score = separation - kFaceEdgeBias;
            if (score > bestSeparation) {
                bestSeparation = separation;
                bestKind = 3;
                bestIndexA = i;
                bestIndexB = j;
                bestNormal = normalized * (d >= 0.0f ? 1.0f : -1.0f);
            }
        }
    }

    if (bestKind == 0) {
        return;
    }

    if (bestKind == 1) {
        addFaceContacts(world, a, indexA, shapeA, b, indexB, shapeB, bestNormal, true, bestIndexA);
    } else if (bestKind == 2) {
        addFaceContacts(world, a, indexA, shapeA, b, indexB, shapeB, bestNormal, false, bestIndexA);
    } else {
        addEdgeContact(world, a, indexA, shapeA, b, indexB, shapeB, bestNormal, bestIndexA, bestIndexB, -bestSeparation);
    }
}

bool isHullKind(int32_t kind) {
    return kind == kShapeCylinder || kind == kShapeCone || kind == kShapeHull || kind == kShapeHeightField;
}

void buildShapeHull(const ShapeWorld& shape, Hull& hull) {
    if (shape.kind == kShapeCone) {
        buildConeHull(shape.center, shape.rotation, shape.half.x, shape.half.y, hull);
    } else if (shape.kind == kShapeCylinder) {
        buildPrismHull(shape.center, shape.rotation, shape.half.x, shape.half.y, hull);
    } else {
        buildBoxHull(shape.center, shape.rotation, shape.half, hull);
    }
}

void buildBulkHullWorldView(World& world, int32_t side, const ShapeWorld& shape, HullView& view) {
    const ShapeBulk* bulk = shape.bulk;
    Vec3* vertices = side == 0 ? world.narrowphaseScratch->hullVerticesA : world.narrowphaseScratch->hullVerticesB;
    Vec3* normals = side == 0 ? world.narrowphaseScratch->hullNormalsA : world.narrowphaseScratch->hullNormalsB;
    float* offsets = side == 0 ? world.narrowphaseScratch->hullOffsetsA : world.narrowphaseScratch->hullOffsetsB;
    const int32_t vertexCount = bulk->vertexCount;
    for (int32_t i = 0; i < vertexCount; ++i) {
        vertices[i] = shape.center + shape.rotation.transform(bulk->vertices[i]);
    }
    const int32_t faceCount = bulk->faceCount;
    for (int32_t f = 0; f < faceCount; ++f) {
        const Vec3 worldNormal = shape.rotation.transform(bulk->faceNormals[f]);
        normals[f] = worldNormal;
        offsets[f] = dot(worldNormal, vertices[bulk->faceStart[f]]);
    }
    view.vertexCount = vertexCount;
    view.vertices = vertices;
    view.faceCount = faceCount;
    view.faceStart = bulk->faceStart;
    view.faceIndices = bulk->faceIndices;
    view.faceNormals = normals;
    view.faceOffsets = offsets;
}

void buildFieldHullWorldView(World& world, int32_t side, const ShapeWorld& shape, HullView& view) {
    static const int32_t fieldFaces[6][4] = {
        { 1, 3, 7, 5 },
        { 4, 6, 2, 0 },
        { 2, 6, 7, 3 },
        { 1, 5, 4, 0 },
        { 4, 5, 7, 6 },
        { 2, 3, 1, 0 }
    };

    Vec3* vertices = side == 0 ? world.narrowphaseScratch->hullVerticesA : world.narrowphaseScratch->hullVerticesB;
    Vec3* normals = side == 0 ? world.narrowphaseScratch->hullNormalsA : world.narrowphaseScratch->hullNormalsB;
    float* offsets = side == 0 ? world.narrowphaseScratch->hullOffsetsA : world.narrowphaseScratch->hullOffsetsB;
    int32_t* starts = side == 0 ? world.narrowphaseScratch->hullStartA : world.narrowphaseScratch->hullStartB;
    int32_t* indices = side == 0 ? world.narrowphaseScratch->hullIndicesA : world.narrowphaseScratch->hullIndicesB;

    Vec3 mn = shape.bulk->localMin;
    Vec3 mx = shape.bulk->localMax;
    if (mx.y - mn.y < 1e-4f) {
        mn.y = mx.y - 1e-4f;
    }
    Vec3 centroid(0.0f, 0.0f, 0.0f);
    for (int32_t i = 0; i < 8; ++i) {
        const Vec3 corner(
            (i & 1) != 0 ? mx.x : mn.x,
            (i & 2) != 0 ? mx.y : mn.y,
            (i & 4) != 0 ? mx.z : mn.z
        );
        vertices[i] = shape.center + shape.rotation.transform(corner);
        centroid += vertices[i];
    }
    centroid *= 0.125f;

    int32_t cursor = 0;
    for (int32_t f = 0; f < 6; ++f) {
        starts[f] = cursor;
        for (int32_t i = 0; i < 4; ++i) {
            indices[cursor++] = fieldFaces[f][i];
        }
    }
    starts[6] = cursor;

    for (int32_t f = 0; f < 6; ++f) {
        const int32_t start = starts[f];
        const Vec3& v0 = vertices[indices[start]];
        const Vec3& v1 = vertices[indices[start + 1]];
        const Vec3& v2 = vertices[indices[start + 2]];
        Vec3 normal = normalize(cross(v1 - v0, v2 - v0));
        if (dot(normal, v0 - centroid) < 0.0f) {
            normal = -normal;
            for (int32_t i = 0; i < 2; ++i) {
                const int32_t low = indices[start + i];
                const int32_t high = indices[start + 3 - i];
                indices[start + i] = high;
                indices[start + 3 - i] = low;
            }
        }
        normals[f] = normal;
        offsets[f] = dot(normal, vertices[indices[start]]);
    }

    view.vertexCount = 8;
    view.vertices = vertices;
    view.faceCount = 6;
    view.faceStart = starts;
    view.faceIndices = indices;
    view.faceNormals = normals;
    view.faceOffsets = offsets;
}

void resolveHullView(World& world, int32_t side, const ShapeWorld& shape, Hull& fallback, HullView& view) {
    if (shape.kind == kShapeHull) {
        buildBulkHullWorldView(world, side, shape, view);
        return;
    }
    if (shape.kind == kShapeHeightField) {
        buildFieldHullWorldView(world, side, shape, view);
        return;
    }
    buildShapeHull(shape, fallback);
    view = makeHullView(fallback);
}

void collideSphereHull(
    World& world,
    int32_t sphere,
    int32_t sphereIndex,
    const ShapeWorld& sphereShape,
    int32_t hull,
    int32_t hullIndex,
    const HullView& hullShape,
    bool sphereIsA,
    int32_t baseFeature
) {
    Vec3 closest;
    float signedDistance;
    Vec3 faceHint;
    hullClosestPoint(hullShape, sphereShape.center, closest, signedDistance, faceHint);

    const float radius = shapeRadius(sphereShape);
    if (signedDistance > radius) {
        return;
    }

    const float pen = radius - signedDistance;
    Vec3 normal = faceHint;
    if (signedDistance > 0.0f) {
        const Vec3 delta = sphereShape.center - closest;
        const float distanceSq = lengthSq(delta);
        if (distanceSq > kEps) {
            normal = delta * (1.0f / sqrtf(distanceSq));
        }
    }

    const Vec3 sphereSurface = sphereShape.center - normal * radius;
    const Vec3 point = closest - normal * (pen * 0.5f);

    if (sphereIsA) {
        addContact(world, sphere, hull, -normal, pen, point, sphereSurface, closest, 0, Vec3(), sphereIndex, hullIndex, baseFeature);
    } else {
        addContact(world, hull, sphere, normal, pen, point, closest, sphereSurface, 0, Vec3(), hullIndex, sphereIndex, baseFeature);
    }
}

void collideCapsuleHull(
    World& world,
    int32_t capsule,
    int32_t capsuleIndex,
    const ShapeWorld& capsuleShape,
    int32_t hull,
    int32_t hullIndex,
    const HullView& hullShape,
    bool capsuleIsA,
    int32_t baseFeature
) {
    Vec3 p0;
    Vec3 p1;
    capsuleSegment(capsuleShape, p0, p1);

    const float radius = shapeRadius(capsuleShape);
    const Vec3 span = p1 - p0;
    const float spanSq = lengthSq(span);

    Vec3 samples[kCapsuleManifoldCapacity];
    int32_t sampleCount = 0;

    Vec3 probe = (p0 + p1) * 0.5f;
    if (spanSq > kEps) {
        for (int32_t iter = 0; iter < 8; ++iter) {
            Vec3 closest;
            float signedDistance;
            Vec3 faceHint;
            hullClosestPoint(hullShape, probe, closest, signedDistance, faceHint);
            const float t = clampf(dot(closest - p0, span) / spanSq, 0.0f, 1.0f);
            probe = p0 + span * t;
        }
    }
    samples[sampleCount++] = probe;
    samples[sampleCount++] = p0;
    samples[sampleCount++] = p1;

    struct CapsuleHullCandidate {
        Vec3 normal;
        float pen;
        Vec3 point;
        Vec3 capsuleSurface;
        Vec3 hullSurface;
    };

    CapsuleHullCandidate candidates[kCapsuleManifoldCapacity];
    int32_t candidateCount = 0;

    for (int32_t i = 0; i < sampleCount; ++i) {
        Vec3 closest;
        float signedDistance;
        Vec3 faceHint;
        hullClosestPoint(hullShape, samples[i], closest, signedDistance, faceHint);
        if (signedDistance >= radius) {
            continue;
        }

        Vec3 normal = faceHint;
        if (signedDistance > 0.0f) {
            const Vec3 delta = samples[i] - closest;
            const float distanceSq = lengthSq(delta);
            if (distanceSq > kEps) {
                normal = delta * (1.0f / sqrtf(distanceSq));
            }
        }

        const float pen = radius - signedDistance;
        const Vec3 point = closest - normal * (pen * 0.5f);

        bool duplicate = false;
        for (int32_t j = 0; j < candidateCount; ++j) {
            if (lengthSq(point - candidates[j].point) < kCrossEps) {
                duplicate = true;
                break;
            }
        }
        if (duplicate) {
            continue;
        }
        if (candidateCount >= kCapsuleManifoldCapacity) {
            break;
        }

        CapsuleHullCandidate& candidate = candidates[candidateCount++];
        candidate.normal = normal;
        candidate.pen = pen;
        candidate.point = point;
        candidate.capsuleSurface = samples[i] - normal * radius;
        candidate.hullSurface = closest;
    }

    for (int32_t k = 1; k < candidateCount; ++k) {
        for (int32_t j = k; j > 0 && candidates[j].pen > candidates[j - 1].pen; --j) {
            const CapsuleHullCandidate swap = candidates[j];
            candidates[j] = candidates[j - 1];
            candidates[j - 1] = swap;
        }
    }

    for (int32_t k = 0; k < candidateCount; ++k) {
        const CapsuleHullCandidate& candidate = candidates[k];
        if (capsuleIsA) {
            addContact(
                world,
                capsule,
                hull,
                -candidate.normal,
                candidate.pen,
                candidate.point,
                candidate.capsuleSurface,
                candidate.hullSurface,
                0,
                Vec3(),
                capsuleIndex,
                hullIndex,
                baseFeature + k);
        } else {
            addContact(
                world,
                hull,
                capsule,
                candidate.normal,
                candidate.pen,
                candidate.point,
                candidate.hullSurface,
                candidate.capsuleSurface,
                0,
                Vec3(),
                hullIndex,
                capsuleIndex,
                baseFeature + k);
        }
    }
}

void addHullFaceContacts(
    World& world,
    int32_t a,
    int32_t indexA,
    const HullView& hullA,
    int32_t b,
    int32_t indexB,
    const HullView& hullB,
    const Vec3& normal,
    bool referenceIsA
) {
    const HullView& referenceHull = referenceIsA ? hullA : hullB;
    const HullView& incidentHull = referenceIsA ? hullB : hullA;
    const int32_t referenceBody = referenceIsA ? a : b;
    const Vec3 referenceNormal = referenceIsA ? normal : -normal;

    int32_t referenceFace = 0;
    float referenceBest = -2.0f;
    for (int32_t f = 0; f < referenceHull.faceCount; ++f) {
        const float d = dot(referenceHull.faceNormals[f], referenceNormal);
        if (d > referenceBest) {
            referenceBest = d;
            referenceFace = f;
        }
    }

    const int32_t referenceStart = referenceHull.faceStart[referenceFace];
    const int32_t referenceCount = referenceHull.faceStart[referenceFace + 1] - referenceStart;
    Vec3 referenceVertices[kHullMaxFaceVertices];
    for (int32_t i = 0; i < referenceCount; ++i) {
        referenceVertices[i] = referenceHull.vertices[referenceHull.faceIndices[referenceStart + i]];
    }
    const float planeOffset = dot(referenceNormal, referenceVertices[0]);

    int32_t incidentFace = 0;
    float incidentBest = 2.0f;
    for (int32_t f = 0; f < incidentHull.faceCount; ++f) {
        const float d = dot(incidentHull.faceNormals[f], referenceNormal);
        if (d < incidentBest) {
            incidentBest = d;
            incidentFace = f;
        }
    }

    const int32_t incidentStart = incidentHull.faceStart[incidentFace];
    const int32_t incidentCount = incidentHull.faceStart[incidentFace + 1] - incidentStart;

    Vec3 clipSource[kHullClipCapacity];
    Vec3 clipTarget[kHullClipCapacity];
    int32_t clipCount = 0;
    for (int32_t i = 0; i < incidentCount && clipCount < kHullClipCapacity; ++i) {
        clipSource[clipCount++] = incidentHull.vertices[incidentHull.faceIndices[incidentStart + i]];
    }

    for (int32_t i = 0; i < referenceCount && clipCount > 0; ++i) {
        const Vec3& from = referenceVertices[i];
        const Vec3& to = referenceVertices[(i + 1) % referenceCount];
        const Vec3 edge = to - from;
        Vec3 side = cross(edge, referenceNormal);
        const float sideLengthSq = lengthSq(side);
        if (sideLengthSq < kCrossEps) {
            continue;
        }
        side = side * (1.0f / sqrtf(sideLengthSq));
        clipCount = clipPlane(clipSource, clipCount, clipTarget, kHullClipCapacity, from, side, 0.0f);
        for (int32_t j = 0; j < clipCount; ++j) {
            clipSource[j] = clipTarget[j];
        }
    }

    struct HullManifoldPoint {
        Vec3 point;
        float pen;
    };

    HullManifoldPoint manifold[kHullClipCapacity];
    int32_t manifoldCount = 0;
    for (int32_t i = 0; i < clipCount; ++i) {
        const float separation = dot(referenceNormal, clipSource[i]) - planeOffset;
        if (separation > 0.0f) {
            continue;
        }
        HullManifoldPoint& entry = manifold[manifoldCount++];
        entry.point = clipSource[i];
        entry.pen = -separation;
    }

    const Vec3 localNormal = world.bodies[referenceBody].rotation.transposeTransform(referenceNormal);
    const int32_t start = world.contactCount;
    int32_t added = 0;

    if (manifoldCount > 0) {
        int32_t bestIndex = 0;
        float bestPen = -1.0f;
        for (int32_t i = 0; i < manifoldCount; ++i) {
            if (manifold[i].pen > bestPen) {
                bestPen = manifold[i].pen;
                bestIndex = i;
            }
        }

        int32_t selected[kHullManifoldCapacity];
        int32_t selectedCount = 0;
        selected[selectedCount++] = bestIndex;
        manifold[bestIndex].pen = -1.0f;

        while (selectedCount < kHullManifoldCapacity) {
            int32_t spreadIndex = -1;
            float bestMinDistanceSq = kCrossEps;
            for (int32_t i = 0; i < manifoldCount; ++i) {
                if (manifold[i].pen < 0.0f) {
                    continue;
                }
                float minDistanceSq = kBig;
                for (int32_t j = 0; j < selectedCount; ++j) {
                    const float d = lengthSq(manifold[i].point - manifold[selected[j]].point);
                    if (d < minDistanceSq) {
                        minDistanceSq = d;
                    }
                }
                if (minDistanceSq > bestMinDistanceSq) {
                    bestMinDistanceSq = minDistanceSq;
                    spreadIndex = i;
                }
            }
            if (spreadIndex < 0) {
                break;
            }
            selected[selectedCount++] = spreadIndex;
            manifold[spreadIndex].pen = -1.0f;
        }

        for (int32_t k = 1; k < selectedCount; ++k) {
            for (int32_t j = k; j > 0 && selected[j] < selected[j - 1]; --j) {
                const int32_t swap = selected[j];
                selected[j] = selected[j - 1];
                selected[j - 1] = swap;
            }
        }

        for (int32_t k = 0; k < selectedCount; ++k) {
            const HullManifoldPoint& entry = manifold[selected[k]];
            const Vec3 point = entry.point;
            const float pen = -dot(referenceNormal, point) + planeOffset;

            bool duplicate = false;
            for (int32_t j = start; j < world.contactCount; ++j) {
                const Contact& existing = world.contacts[j];
                const Vec3 existingPoint = transformPosition(world.transforms[existing.a]) + existing.ra;
                if (lengthSq(point - existingPoint) < kCrossEps) {
                    duplicate = true;
                    break;
                }
            }
            if (duplicate) {
                continue;
            }

            const Vec3 referencePoint = point + referenceNormal * pen;
            if (referenceIsA) {
                addContact(world, a, b, normal, pen, point, referencePoint, point, 1, localNormal, indexA, indexB, kKindHullFace * 16 + added);
            } else {
                addContact(world, a, b, normal, pen, point, point, referencePoint, 2, localNormal, indexA, indexB, kKindHullFace * 16 + added);
            }
            ++added;
        }
    }

    if (added == 0) {
        float bestDepth = 0.0f;
        int32_t bestVertex = -1;
        int32_t bestPlane = 0;
        for (int32_t v = 0; v < incidentHull.vertexCount; ++v) {
            const Vec3& vertex = incidentHull.vertices[v];
            float depth = kBig;
            int32_t plane = 0;
            for (int32_t f = 0; f < referenceHull.faceCount; ++f) {
                const float candidateDepth = referenceHull.faceOffsets[f] - dot(referenceHull.faceNormals[f], vertex);
                if (candidateDepth < depth) {
                    depth = candidateDepth;
                    plane = f;
                }
            }
            if (depth > bestDepth) {
                bestDepth = depth;
                bestVertex = v;
                bestPlane = plane;
            }
        }

        if (bestVertex >= 0) {
            const Vec3& vertex = incidentHull.vertices[bestVertex];
            const Vec3 planeNormal = referenceHull.faceNormals[bestPlane];
            const Vec3 referencePoint = vertex + planeNormal * bestDepth;
            const Vec3 emissionNormal = referenceIsA ? planeNormal : -planeNormal;
            const float pen = bestDepth;
            if (referenceIsA) {
                addContact(world, a, b, emissionNormal, pen, vertex, referencePoint, vertex, 1, localNormal, indexA, indexB, kKindHullFace * 16);
            } else {
                addContact(world, a, b, emissionNormal, pen, vertex, vertex, referencePoint, 2, localNormal, indexA, indexB, kKindHullFace * 16);
            }
        }
    }
}

void collideHullHull(
    World& world,
    int32_t a,
    int32_t indexA,
    const ShapeWorld& shapeA,
    const HullView& hullA,
    int32_t b,
    int32_t indexB,
    const ShapeWorld& shapeB,
    const HullView& hullB
) {
    const Vec3 offset = shapeB.center - shapeA.center;

    float bestSeparation = -kBig;
    int32_t bestKind = 0;
    Vec3 bestNormal(1.0f, 0.0f, 0.0f);

    for (int32_t f = 0; f < hullA.faceCount; ++f) {
        Vec3 axis = hullA.faceNormals[f];
        if (dot(offset, axis) < 0.0f) {
            axis = -axis;
        }
        const float separation = hullMinProjection(hullB, axis) - hullMaxProjection(hullA, axis);
        if (separation > 0.0f) {
            return;
        }
        if (separation > bestSeparation) {
            bestSeparation = separation;
            bestKind = 1;
            bestNormal = axis;
        }
    }

    for (int32_t f = 0; f < hullB.faceCount; ++f) {
        Vec3 axis = hullB.faceNormals[f];
        if (dot(offset, axis) < 0.0f) {
            axis = -axis;
        }
        const float separation = hullMinProjection(hullB, axis) - hullMaxProjection(hullA, axis);
        if (separation > 0.0f) {
            return;
        }
        if (separation > bestSeparation) {
            bestSeparation = separation;
            bestKind = 2;
            bestNormal = axis;
        }
    }

    if (bestKind == 0) {
        return;
    }

    addHullFaceContacts(
        world,
        a,
        indexA,
        hullA,
        b,
        indexB,
        hullB,
        bestNormal,
        bestKind == 1);
}

float selectMeshExtent(const Vec3& half, int32_t axis) {
    if (axis == 0) {
        return half.x;
    }
    if (axis == 1) {
        return half.y;
    }
    return half.z;
}

AXRONE_PHYSICS_INLINE Vec3 rotationComponent(const Mat3& rotation, int32_t column, float scale) {
    return Vec3(rotation.m[column] * scale, rotation.m[column + 3] * scale, rotation.m[column + 6] * scale);
}

bool rotatedHalfAabb(const Vec3& center, const Mat3& rotation, const Vec3& half, AABB& out) {
    const float ex = fabsf(rotation.m[0]) * selectMeshExtent(half, 0) +
                     fabsf(rotation.m[1]) * selectMeshExtent(half, 1) +
                     fabsf(rotation.m[2]) * selectMeshExtent(half, 2);
    const float ey = fabsf(rotation.m[3]) * selectMeshExtent(half, 0) +
                     fabsf(rotation.m[4]) * selectMeshExtent(half, 1) +
                     fabsf(rotation.m[5]) * selectMeshExtent(half, 2);
    const float ez = fabsf(rotation.m[6]) * selectMeshExtent(half, 0) +
                     fabsf(rotation.m[7]) * selectMeshExtent(half, 1) +
                     fabsf(rotation.m[8]) * selectMeshExtent(half, 2);
    out = { center.x - ex, center.y - ey, center.z - ez, center.x + ex, center.y + ey, center.z + ez };
    return true;
}

bool cornerAabb(const Vec3& center, const Mat3& rotation, const Vec3& mn, const Vec3& mx, AABB& out) {
    Vec3 lo = center + rotation.transform(mn);
    Vec3 hi = lo;
    for (int32_t i = 1; i < 8; ++i) {
        const Vec3 corner(
            (i & 1) != 0 ? mx.x : mn.x,
            (i & 2) != 0 ? mx.y : mn.y,
            (i & 4) != 0 ? mx.z : mn.z
        );
        const Vec3 world = center + rotation.transform(corner);
        if (world.x < lo.x) {
            lo.x = world.x;
        }
        if (world.y < lo.y) {
            lo.y = world.y;
        }
        if (world.z < lo.z) {
            lo.z = world.z;
        }
        if (world.x > hi.x) {
            hi.x = world.x;
        }
        if (world.y > hi.y) {
            hi.y = world.y;
        }
        if (world.z > hi.z) {
            hi.z = world.z;
        }
    }
    out = { lo.x, lo.y, lo.z, hi.x, hi.y, hi.z };
    return true;
}

bool shapeWorldAabbOf(const ShapeWorld& shape, AABB& out) {
    if (shape.kind == kShapeSphere) {
        const float r = shape.half.x;
        out = { shape.center.x - r, shape.center.y - r, shape.center.z - r, shape.center.x + r, shape.center.y + r, shape.center.z + r };
        return true;
    }
    if (shape.kind == kShapeCapsule) {
        const Vec3 halfAxis(rotationComponent(shape.rotation, 1, shape.half.y));
        const float radius = shape.half.x;
        const float ex = fabsf(halfAxis.x) + radius;
        const float ey = fabsf(halfAxis.y) + radius;
        const float ez = fabsf(halfAxis.z) + radius;
        out = { shape.center.x - ex, shape.center.y - ey, shape.center.z - ez, shape.center.x + ex, shape.center.y + ey, shape.center.z + ez };
        return true;
    }
    if (shape.kind == kShapeCylinder || shape.kind == kShapeCone) {
        const Vec3 half(shape.half.x, shape.half.y, shape.half.x);
        return rotatedHalfAabb(shape.center, shape.rotation, half, out);
    }
    if (shape.kind == kShapeBox || shape.kind == kShapeHull) {
        return rotatedHalfAabb(shape.center, shape.rotation, shape.half, out);
    }
    if (shape.bulk == nullptr) {
        return false;
    }
    return cornerAabb(shape.center, shape.rotation, shape.bulk->localMin, shape.bulk->localMax, out);
}

bool aabbsOverlap(const AABB& a, const AABB& b) {
    if (b.minX > a.maxX || a.minX > b.maxX) {
        return false;
    }
    if (b.minY > a.maxY || a.minY > b.maxY) {
        return false;
    }
    return !(b.minZ > a.maxZ || a.minZ > b.maxZ);
}

void collideMeshPair(
    World& world,
    int32_t a,
    int32_t indexA,
    const ShapeWorld& shapeA,
    int32_t b,
    int32_t indexB,
    const ShapeWorld& shapeB
) {
    const bool meshIsA = shapeA.kind == kShapeMesh;
    const ShapeWorld& meshShape = meshIsA ? shapeA : shapeB;
    const ShapeWorld& otherShape = meshIsA ? shapeB : shapeA;
    const int32_t meshBody = meshIsA ? a : b;
    const int32_t otherBody = meshIsA ? b : a;
    const int32_t meshIndex = meshIsA ? indexA : indexB;
    const int32_t otherIndex = meshIsA ? indexB : indexA;

    const ShapeBulk* bulk = meshShape.bulk;
    if (bulk == nullptr || bulk->triangleCount <= 0 || bulk->vertexCount <= 0) {
        return;
    }
    if (isBulkKind(otherShape.kind) && otherShape.bulk == nullptr) {
        return;
    }
    if (otherShape.kind == kShapeMesh) {
        return;
    }

    AABB otherBounds;
    if (!shapeWorldAabbOf(otherShape, otherBounds)) {
        return;
    }

    const int32_t triangleCount = bulk->triangleCount;
    Hull hullOther;
    HullView viewOther;
    bool otherViewBuilt = false;

    Vec3 triangleVertices[3];
    int32_t triangleStart[3] = { 0, 3, 6 };
    int32_t triangleIndices[6] = { 0, 1, 2, 0, 2, 1 };
    Vec3 triangleNormals[2];
    float triangleOffsets[2];
    HullView triangleView;
    triangleView.vertexCount = 3;
    triangleView.vertices = triangleVertices;
    triangleView.faceCount = 2;
    triangleView.faceStart = triangleStart;
    triangleView.faceIndices = triangleIndices;
    triangleView.faceNormals = triangleNormals;
    triangleView.faceOffsets = triangleOffsets;

    for (int32_t t = 0; t < triangleCount; ++t) {
        const Vec3 local0 = bulk->vertices[bulk->indices[t * 3 + 0]];
        const Vec3 local1 = bulk->vertices[bulk->indices[t * 3 + 1]];
        const Vec3 local2 = bulk->vertices[bulk->indices[t * 3 + 2]];
        const Vec3 v0 = meshShape.center + meshShape.rotation.transform(local0);
        const Vec3 v1 = meshShape.center + meshShape.rotation.transform(local1);
        const Vec3 v2 = meshShape.center + meshShape.rotation.transform(local2);

        Vec3 normal = cross(v1 - v0, v2 - v0);
        const float normalLengthSq = lengthSq(normal);
        if (normalLengthSq <= kCrossEps) {
            continue;
        }
        normal = normal * (1.0f / sqrtf(normalLengthSq));

        AABB triangleBounds = { v0.x, v0.y, v0.z, v0.x, v0.y, v0.z };
        if (v1.x < triangleBounds.minX) {
            triangleBounds.minX = v1.x;
        }
        if (v1.y < triangleBounds.minY) {
            triangleBounds.minY = v1.y;
        }
        if (v1.z < triangleBounds.minZ) {
            triangleBounds.minZ = v1.z;
        }
        if (v2.x < triangleBounds.minX) {
            triangleBounds.minX = v2.x;
        }
        if (v2.y < triangleBounds.minY) {
            triangleBounds.minY = v2.y;
        }
        if (v2.z < triangleBounds.minZ) {
            triangleBounds.minZ = v2.z;
        }
        if (v1.x > triangleBounds.maxX) {
            triangleBounds.maxX = v1.x;
        }
        if (v1.y > triangleBounds.maxY) {
            triangleBounds.maxY = v1.y;
        }
        if (v1.z > triangleBounds.maxZ) {
            triangleBounds.maxZ = v1.z;
        }
        if (v2.x > triangleBounds.maxX) {
            triangleBounds.maxX = v2.x;
        }
        if (v2.y > triangleBounds.maxY) {
            triangleBounds.maxY = v2.y;
        }
        if (v2.z > triangleBounds.maxZ) {
            triangleBounds.maxZ = v2.z;
        }
        if (!aabbsOverlap(triangleBounds, otherBounds)) {
            continue;
        }

        triangleVertices[0] = v0;
        triangleVertices[1] = v1;
        triangleVertices[2] = v2;
        triangleNormals[0] = normal;
        triangleNormals[1] = -normal;
        const float planeOffset = dot(normal, v0);
        triangleOffsets[0] = planeOffset;
        triangleOffsets[1] = -planeOffset;

        const int32_t baseFeature = kKindMeshTriangle * 16 + (t & 15);

        if (otherShape.kind == kShapeSphere) {
            collideSphereHull(world, otherBody, otherIndex, otherShape, meshBody, meshIndex, triangleView, otherBody == a, baseFeature);
            continue;
        }
        if (otherShape.kind == kShapeCapsule) {
            collideCapsuleHull(world, otherBody, otherIndex, otherShape, meshBody, meshIndex, triangleView, otherBody == a, baseFeature);
            continue;
        }

        if (!otherViewBuilt) {
            const int32_t otherSide = meshIsA ? 1 : 0;
            resolveHullView(world, otherSide, otherShape, hullOther, viewOther);
            otherViewBuilt = true;
        }

        if (meshIsA) {
            collideHullHull(world, a, indexA, shapeA, triangleView, b, indexB, shapeB, viewOther);
        } else {
            collideHullHull(world, a, indexA, shapeA, viewOther, b, indexB, shapeB, triangleView);
        }
    }
}

AXRONE_PHYSICS_NOINLINE void collideHullPair(
    World& world,
    int32_t a,
    int32_t indexA,
    const ShapeWorld& shapeA,
    int32_t b,
    int32_t indexB,
    const ShapeWorld& shapeB
) {
    Hull fallbackA;
    Hull fallbackB;
    HullView viewA;
    HullView viewB;
    if (shapeA.kind == kShapeSphere) {
        resolveHullView(world, 1, shapeB, fallbackB, viewB);
        collideSphereHull(world, a, indexA, shapeA, b, indexB, viewB, true, kKindHullSphere * 16);
    } else if (shapeB.kind == kShapeSphere) {
        resolveHullView(world, 0, shapeA, fallbackA, viewA);
        collideSphereHull(world, b, indexB, shapeB, a, indexA, viewA, true, kKindHullSphere * 16);
    } else if (shapeA.kind == kShapeCapsule) {
        resolveHullView(world, 1, shapeB, fallbackB, viewB);
        collideCapsuleHull(world, a, indexA, shapeA, b, indexB, viewB, true, kKindCapsuleHull * 16);
    } else if (shapeB.kind == kShapeCapsule) {
        resolveHullView(world, 0, shapeA, fallbackA, viewA);
        collideCapsuleHull(world, b, indexB, shapeB, a, indexA, viewA, true, kKindCapsuleHull * 16);
    } else {
        resolveHullView(world, 0, shapeA, fallbackA, viewA);
        resolveHullView(world, 1, shapeB, fallbackB, viewB);
        collideHullHull(world, a, indexA, shapeA, viewA, b, indexB, shapeB, viewB);
    }
}

void collideShapePair(World& world, int32_t a, int32_t indexA, const ShapeWorld& shapeA, int32_t b, int32_t indexB, const ShapeWorld& shapeB) {
    if (shapeA.kind == kShapeMesh || shapeB.kind == kShapeMesh) {
        collideMeshPair(world, a, indexA, shapeA, b, indexB, shapeB);
        return;
    }

    if (isHullKind(shapeA.kind) || isHullKind(shapeB.kind)) {
        if (isBulkKind(shapeA.kind) && shapeA.bulk == nullptr) {
            return;
        }
        if (isBulkKind(shapeB.kind) && shapeB.bulk == nullptr) {
            return;
        }
        collideHullPair(world, a, indexA, shapeA, b, indexB, shapeB);
        return;
    }

    if (shapeA.kind == kShapeSphere) {
        if (shapeB.kind == kShapeSphere) {
            collideSphereSphere(world, a, indexA, shapeA, b, indexB, shapeB);
        } else if (shapeB.kind == kShapeBox) {
            collideSphereBox(world, a, indexA, shapeA, b, indexB, shapeB, true, kKindSphereBox * 16);
        } else if (shapeB.kind == kShapeCapsule) {
            collideSphereCapsule(world, a, indexA, shapeA, b, indexB, shapeB);
        }
    } else if (shapeA.kind == kShapeBox) {
        if (shapeB.kind == kShapeSphere) {
            collideSphereBox(world, b, indexB, shapeB, a, indexA, shapeA, false, kKindSphereBox * 16);
        } else if (shapeB.kind == kShapeBox) {
            collideBoxBox(world, a, indexA, shapeA, b, indexB, shapeB);
        } else if (shapeB.kind == kShapeCapsule) {
            collideCapsuleBox(world, b, indexB, shapeB, a, indexA, shapeA, false);
        }
    } else if (shapeA.kind == kShapeCapsule) {
        if (shapeB.kind == kShapeSphere) {
            collideSphereCapsule(world, b, indexB, shapeB, a, indexA, shapeA);
        } else if (shapeB.kind == kShapeBox) {
            collideCapsuleBox(world, a, indexA, shapeA, b, indexB, shapeB, true);
        } else if (shapeB.kind == kShapeCapsule) {
            collideCapsuleCapsule(world, a, indexA, shapeA, b, indexB, shapeB);
        }
    }
}

}

void collidePair(World& world, int32_t a, int32_t b) {
    const Body& bodyA = world.bodies[a];
    const Body& bodyB = world.bodies[b];
    const int32_t countA = shapeSlots(bodyA);
    const int32_t countB = shapeSlots(bodyB);

    const bool suppressed = pairSuppressedByConstraints(world, a, b);

    ShapeWorld stateA;
    ShapeWorld stateB;

    for (int32_t indexA = 0; indexA < countA; ++indexA) {
        if (!shapeValid(bodyA.shapes[indexA])) {
            continue;
        }
        if (!suppressed) {
            loadShapeWorld(world, a, indexA, stateA);
        }

        for (int32_t indexB = 0; indexB < countB; ++indexB) {
            if (!shapeValid(bodyB.shapes[indexB])) {
                continue;
            }
            if (!filtersCollide(bodyA.shapes[indexA], bodyB.shapes[indexB])) {
                continue;
            }
            ++world.statsShapePairs;
            if (suppressed) {
                continue;
            }
            loadShapeWorld(world, b, indexB, stateB);
            collideShapePair(world, a, indexA, stateA, b, indexB, stateB);
        }
    }
}

}
