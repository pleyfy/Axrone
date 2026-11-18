#include "core/polytope.h"

namespace axrone::physics {

namespace {

const float kHullRingCos[kHullRingVertices] = {
    1.0f,
    0.70710678f,
    0.0f,
    -0.70710678f,
    -1.0f,
    -0.70710678f,
    0.0f,
    0.70710678f
};

const float kHullRingSin[kHullRingVertices] = {
    0.0f,
    0.70710678f,
    1.0f,
    0.70710678f,
    0.0f,
    -0.70710678f,
    -1.0f,
    -0.70710678f
};

void finalizeHull(Hull& hull) {
    Vec3 centroid(0.0f, 0.0f, 0.0f);
    for (int32_t i = 0; i < hull.vertexCount; ++i) {
        centroid += hull.vertices[i];
    }
    centroid *= 1.0f / static_cast<float>(hull.vertexCount);

    for (int32_t f = 0; f < hull.faceCount; ++f) {
        const int32_t start = hull.faceStart[f];
        const int32_t count = hull.faceStart[f + 1] - start;
        const Vec3& v0 = hull.vertices[hull.faceIndices[start]];
        const Vec3& v1 = hull.vertices[hull.faceIndices[start + 1]];
        const Vec3& v2 = hull.vertices[hull.faceIndices[start + 2]];

        Vec3 normal = normalize(cross(v1 - v0, v2 - v0));
        if (dot(normal, v0 - centroid) < 0.0f) {
            normal = -normal;
            for (int32_t i = 0; i < count / 2; ++i) {
                const int32_t low = hull.faceIndices[start + i];
                const int32_t high = hull.faceIndices[start + count - 1 - i];
                hull.faceIndices[start + i] = high;
                hull.faceIndices[start + count - 1 - i] = low;
            }
        }

        hull.faceNormals[f] = normal;
        hull.faceOffsets[f] = dot(normal, hull.vertices[hull.faceIndices[start]]);
    }
}

Vec3 closestPointOnHullSegment(const Vec3& point, const Vec3& a, const Vec3& b) {
    const Vec3 direction = b - a;
    const float span = lengthSq(direction);
    if (span <= kEps) {
        return a;
    }
    const float t = clampf(dot(point - a, direction) / span, 0.0f, 1.0f);
    return a + direction * t;
}

bool hullFaceContains(const HullView& hull, int32_t face, const Vec3& point) {
    const int32_t start = hull.faceStart[face];
    const int32_t count = hull.faceStart[face + 1] - start;
    const Vec3& normal = hull.faceNormals[face];

    for (int32_t i = 0; i < count; ++i) {
        const Vec3& a = hull.vertices[hull.faceIndices[start + i]];
        const Vec3& b = hull.vertices[hull.faceIndices[start + (i + 1) % count]];
        const Vec3 side = cross(b - a, normal);
        if (dot(side, point - a) > 0.0f) {
            return false;
        }
    }
    return true;
}

}

void buildPrismHull(const Vec3& center, const Mat3& rotation, float radius, float halfHeight, Hull& hull) {
    hull.vertexCount = 2 * kHullRingVertices;
    for (int32_t i = 0; i < kHullRingVertices; ++i) {
        hull.vertices[i] = center + rotation.transform(
            Vec3(radius * kHullRingCos[i], -halfHeight, radius * kHullRingSin[i]));
        hull.vertices[kHullRingVertices + i] = center + rotation.transform(
            Vec3(radius * kHullRingCos[i], halfHeight, radius * kHullRingSin[i]));
    }

    hull.faceCount = kHullRingVertices + 2;
    int32_t cursor = 0;
    for (int32_t i = 0; i < kHullRingVertices; ++i) {
        const int32_t next = (i + 1) % kHullRingVertices;
        hull.faceStart[i] = cursor;
        hull.faceIndices[cursor++] = i;
        hull.faceIndices[cursor++] = kHullRingVertices + i;
        hull.faceIndices[cursor++] = kHullRingVertices + next;
        hull.faceIndices[cursor++] = next;
    }

    hull.faceStart[kHullRingVertices] = cursor;
    for (int32_t i = 0; i < kHullRingVertices; ++i) {
        hull.faceIndices[cursor++] = kHullRingVertices + i;
    }

    hull.faceStart[kHullRingVertices + 1] = cursor;
    for (int32_t i = 0; i < kHullRingVertices; ++i) {
        hull.faceIndices[cursor++] = i;
    }

    hull.faceStart[kHullRingVertices + 2] = cursor;
    finalizeHull(hull);
}

void buildConeHull(const Vec3& center, const Mat3& rotation, float radius, float halfHeight, Hull& hull) {
    hull.vertexCount = kHullRingVertices + 1;
    hull.vertices[0] = center + rotation.transform(Vec3(0.0f, halfHeight, 0.0f));
    for (int32_t i = 0; i < kHullRingVertices; ++i) {
        hull.vertices[1 + i] = center + rotation.transform(
            Vec3(radius * kHullRingCos[i], -halfHeight, radius * kHullRingSin[i]));
    }

    hull.faceCount = kHullRingVertices + 1;
    int32_t cursor = 0;
    for (int32_t i = 0; i < kHullRingVertices; ++i) {
        const int32_t next = (i + 1) % kHullRingVertices;
        hull.faceStart[i] = cursor;
        hull.faceIndices[cursor++] = 0;
        hull.faceIndices[cursor++] = 1 + next;
        hull.faceIndices[cursor++] = 1 + i;
    }

    hull.faceStart[kHullRingVertices] = cursor;
    for (int32_t i = 0; i < kHullRingVertices; ++i) {
        hull.faceIndices[cursor++] = 1 + i;
    }

    hull.faceStart[kHullRingVertices + 1] = cursor;
    finalizeHull(hull);
}

void buildBoxHull(const Vec3& center, const Mat3& rotation, const Vec3& half, Hull& hull) {
    const Vec3 axes[3] = {
        Vec3(rotation.m[0], rotation.m[3], rotation.m[6]),
        Vec3(rotation.m[1], rotation.m[4], rotation.m[7]),
        Vec3(rotation.m[2], rotation.m[5], rotation.m[8])
    };

    hull.vertexCount = 8;
    for (int32_t i = 0; i < 8; ++i) {
        const Vec3 delta(
            (i & 1) != 0 ? half.x : -half.x,
            (i & 2) != 0 ? half.y : -half.y,
            (i & 4) != 0 ? half.z : -half.z
        );
        hull.vertices[i] = center +
            axes[0] * delta.x +
            axes[1] * delta.y +
            axes[2] * delta.z;
    }

    static const int32_t boxFaces[6][4] = {
        { 1, 3, 7, 5 },
        { 4, 6, 2, 0 },
        { 2, 6, 7, 3 },
        { 1, 5, 4, 0 },
        { 4, 5, 7, 6 },
        { 2, 3, 1, 0 }
    };

    hull.faceCount = 6;
    int32_t cursor = 0;
    for (int32_t f = 0; f < 6; ++f) {
        hull.faceStart[f] = cursor;
        for (int32_t i = 0; i < 4; ++i) {
            hull.faceIndices[cursor++] = boxFaces[f][i];
        }
    }
    hull.faceStart[6] = cursor;
    finalizeHull(hull);
}

float hullMaxProjection(const HullView& hull, const Vec3& axis) {
    float best = dot(axis, hull.vertices[0]);
    for (int32_t i = 1; i < hull.vertexCount; ++i) {
        const float value = dot(axis, hull.vertices[i]);
        if (value > best) {
            best = value;
        }
    }
    return best;
}

float hullMinProjection(const HullView& hull, const Vec3& axis) {
    float best = dot(axis, hull.vertices[0]);
    for (int32_t i = 1; i < hull.vertexCount; ++i) {
        const float value = dot(axis, hull.vertices[i]);
        if (value < best) {
            best = value;
        }
    }
    return best;
}

void hullClosestPoint(
    const HullView& hull,
    const Vec3& point,
    Vec3& closest,
    float& signedDistance,
    Vec3& faceHint
) {
    float maxSep = -kBig;
    int32_t maxFace = 0;
    for (int32_t f = 0; f < hull.faceCount; ++f) {
        const float sep = dot(hull.faceNormals[f], point) - hull.faceOffsets[f];
        if (sep > maxSep) {
            maxSep = sep;
            maxFace = f;
        }
    }

    faceHint = hull.faceNormals[maxFace];

    if (maxSep <= 0.0f) {
        signedDistance = maxSep;
        closest = point + faceHint * (-maxSep);
        return;
    }

    float bestSq = kBig;
    Vec3 best = point;

    for (int32_t f = 0; f < hull.faceCount; ++f) {
        const float sep = dot(hull.faceNormals[f], point) - hull.faceOffsets[f];
        if (sep <= 0.0f) {
            continue;
        }
        if (sep * sep >= bestSq) {
            continue;
        }
        const Vec3 projection = point - hull.faceNormals[f] * sep;
        if (hullFaceContains(hull, f, projection)) {
            bestSq = sep * sep;
            best = projection;
        }
    }

    for (int32_t f = 0; f < hull.faceCount; ++f) {
        const int32_t start = hull.faceStart[f];
        const int32_t count = hull.faceStart[f + 1] - start;
        for (int32_t i = 0; i < count; ++i) {
            const Vec3& a = hull.vertices[hull.faceIndices[start + i]];
            const Vec3& b = hull.vertices[hull.faceIndices[start + (i + 1) % count]];
            const Vec3 candidate = closestPointOnHullSegment(point, a, b);
            const float distanceSq = lengthSq(point - candidate);
            if (distanceSq < bestSq) {
                bestSq = distanceSq;
                best = candidate;
            }
        }
    }

    signedDistance = sqrtf(bestSq);
    closest = best;
}

namespace {

using HullFace = HullBuildScratch::FaceRecord;

bool sameDirectedEdge(const HullFace& face, int32_t u, int32_t v) {
    if (face.a == u && face.b == v) {
        return true;
    }
    if (face.b == u && face.c == v) {
        return true;
    }
    return face.c == u && face.a == v;
}

bool faceHasUndirectedEdge(const HullFace& face, int32_t u, int32_t v) {
    if (face.a == u || face.a == v) {
        if (face.b == u || face.b == v) {
            return true;
        }
        if (face.c == u || face.c == v) {
            return true;
        }
    }
    if (face.b == u || face.b == v) {
        return face.c == u || face.c == v;
    }
    return false;
}

}

bool buildUserHullFaces(
    const Vec3* vertices,
    int32_t vertexCount,
    HullBuildScratch& scratch,
    int32_t& faceCount,
    int32_t& indexTotal
) {
    if (vertices == nullptr) {
        return false;
    }
    if (vertexCount < 4 || vertexCount > kBulkMaxVertices ||
        kBulkMaxFaces < 2 * vertexCount - 4) {
        return false;
    }

    int32_t seed[4] = { -1, -1, -1, -1 };
    int32_t base = 0;
    float baseDistance = -1.0f;
    for (int32_t i = 0; i < vertexCount; ++i) {
        const float distance = lengthSq(vertices[i] - vertices[0]);
        if (distance > baseDistance) {
            baseDistance = distance;
            base = i;
        }
    }
    if (baseDistance <= kEps) {
        return false;
    }
    seed[0] = 0;
    seed[1] = base;

    const Vec3 reference = vertices[base] - vertices[0];
    float bestArea = kEps;
    seed[2] = -1;
    for (int32_t i = 0; i < vertexCount; ++i) {
        if (i == 0 || i == base) {
            continue;
        }
        const float area = lengthSq(cross(reference, vertices[i] - vertices[0]));
        if (area > bestArea) {
            bestArea = area;
            seed[2] = i;
        }
    }
    if (seed[2] < 0) {
        return false;
    }

    const Vec3 planeNormal = cross(vertices[seed[2]] - vertices[0], vertices[seed[1]] - vertices[0]);
    float bestVolume = kEps;
    seed[3] = -1;
    for (int32_t i = 0; i < vertexCount; ++i) {
        if (i == seed[0] || i == seed[1] || i == seed[2]) {
            continue;
        }
        const float volume = fabsf(dot(planeNormal, vertices[i] - vertices[0]));
        if (volume > bestVolume) {
            bestVolume = volume;
            seed[3] = i;
        }
    }
    if (seed[3] < 0) {
        return false;
    }

    HullFace* const faces = scratch.faces;
    for (int32_t i = 0; i < kHullScratchFaces; ++i) {
        faces[i].alive = false;
    }
    int32_t faceCapacity = 3 * vertexCount - 8;
    if (faceCapacity > kHullScratchFaces) {
        faceCapacity = kHullScratchFaces;
    }

    int32_t faceTotal = 0;
    const auto appendFace = [&](int32_t a, int32_t b, int32_t c) {
        for (int32_t reuse = 0; reuse < faceTotal; ++reuse) {
            if (!faces[reuse].alive) {
                faces[reuse].a = a;
                faces[reuse].b = b;
                faces[reuse].c = c;
                faces[reuse].alive = true;
                return true;
            }
        }
        if (faceTotal >= faceCapacity) {
            return false;
        }
        faces[faceTotal].a = a;
        faces[faceTotal].b = b;
        faces[faceTotal].c = c;
        faces[faceTotal].alive = true;
        ++faceTotal;
        return true;
    };

    const int32_t trianglePairs[4][3] = {
        { 0, 1, 2 },
        { 0, 3, 1 },
        { 0, 2, 3 },
        { 1, 3, 2 }
    };
    for (int32_t f = 0; f < 4; ++f) {
        const int32_t sa = seed[trianglePairs[f][0]];
        const int32_t sb = seed[trianglePairs[f][1]];
        const int32_t sc = seed[trianglePairs[f][2]];
        const Vec3& va = vertices[sa];
        const Vec3& vb = vertices[sb];
        const Vec3& vc = vertices[sc];
        const Vec3 normal = cross(vb - va, vc - va);
        Vec3 interior = vertices[seed[0]] + vertices[seed[1]] + vertices[seed[2]] + vertices[seed[3]];
        interior *= 0.25f;
        if (dot(normal, interior - va) > 0.0f) {
            if (!appendFace(sa, sc, sb)) {
                return false;
            }
        } else if (!appendFace(sa, sb, sc)) {
            return false;
        }
    }

    for (int32_t p = 0; p < vertexCount; ++p) {
        if (p == seed[0] || p == seed[1] || p == seed[2] || p == seed[3]) {
            continue;
        }
        const Vec3& point = vertices[p];
        bool* const visible = scratch.visible;
        int32_t visibleCount = 0;
        for (int32_t f = 0; f < faceTotal; ++f) {
            visible[f] = false;
            if (!faces[f].alive) {
                continue;
            }
            const Vec3& va = vertices[faces[f].a];
            const Vec3 normal = cross(vertices[faces[f].b] - va, vertices[faces[f].c] - va);
            if (dot(normal, point - va) > kEps) {
                visible[f] = true;
                ++visibleCount;
            }
        }
        if (visibleCount == 0) {
            continue;
        }

        int32_t* const horizonU = scratch.horizonU;
        int32_t* const horizonV = scratch.horizonV;
        int32_t horizonCount = 0;
        for (int32_t f = 0; f < faceTotal; ++f) {
            if (!faces[f].alive || !visible[f]) {
                continue;
            }
            const HullFace& face = faces[f];
            const int32_t ring[3][2] = { { face.a, face.b }, { face.b, face.c }, { face.c, face.a } };
            for (int32_t e = 0; e < 3; ++e) {
                const int32_t u = ring[e][0];
                const int32_t v = ring[e][1];
                bool sharedWithVisible = false;
                for (int32_t g = 0; g < faceTotal; ++g) {
                    if (g == f || !faces[g].alive || !visible[g]) {
                        continue;
                    }
                    if (faceHasUndirectedEdge(faces[g], u, v)) {
                        sharedWithVisible = true;
                        break;
                    }
                }
                if (sharedWithVisible) {
                    continue;
                }
                bool hasBlocking = false;
                for (int32_t g = 0; g < faceTotal; ++g) {
                    if (g == f || !faces[g].alive || visible[g]) {
                        continue;
                    }
                    if (sameDirectedEdge(faces[g], v, u)) {
                        hasBlocking = true;
                        break;
                    }
                }
                if (!hasBlocking) {
                    continue;
                }
                if (horizonCount >= kHullScratchFaces) {
                    return false;
                }
                horizonU[horizonCount] = u;
                horizonV[horizonCount] = v;
                ++horizonCount;
            }
        }

        for (int32_t f = 0; f < faceTotal; ++f) {
            if (visible[f]) {
                faces[f].alive = false;
            }
        }
        for (int32_t h = 0; h < horizonCount; ++h) {
            if (!appendFace(horizonU[h], horizonV[h], p)) {
                return false;
            }
        }
    }

    int32_t produced = 0;
    int32_t* const srcIndices = scratch.srcIndices;
    for (int32_t f = 0; f < faceTotal; ++f) {
        if (faces[f].alive) {
            if (produced >= kBulkMaxFaces) {
                return false;
            }
            srcIndices[produced * 3 + 0] = faces[f].a;
            srcIndices[produced * 3 + 1] = faces[f].b;
            srcIndices[produced * 3 + 2] = faces[f].c;
            ++produced;
        }
    }
    if (produced < 4) {
        return false;
    }

    Vec3 centroid(0.0f, 0.0f, 0.0f);
    for (int32_t i = 0; i < vertexCount; ++i) {
        centroid += vertices[i];
    }
    centroid *= 1.0f / static_cast<float>(vertexCount);

    Vec3* const srcNormals = scratch.srcNormals;
    float* const srcOffsets = scratch.srcOffsets;
    for (int32_t f = 0; f < produced; ++f) {
        const Vec3& va = vertices[srcIndices[f * 3]];
        const Vec3& vb = vertices[srcIndices[f * 3 + 1]];
        const Vec3& vc = vertices[srcIndices[f * 3 + 2]];
        Vec3 normal = cross(vb - va, vc - va);
        const float normalLengthSq = lengthSq(normal);
        if (normalLengthSq <= kEps) {
            return false;
        }
        normal = normal * (1.0f / sqrtf(normalLengthSq));
        if (dot(normal, va - centroid) < 0.0f) {
            normal = -normal;
            const int32_t swap = srcIndices[f * 3 + 1];
            srcIndices[f * 3 + 1] = srcIndices[f * 3 + 2];
            srcIndices[f * 3 + 2] = swap;
        }
        srcNormals[f] = normal;
        srcOffsets[f] = dot(normal, va);
    }

    bool* const consumed = scratch.consumed;
    for (int32_t f = 0; f < produced; ++f) {
        consumed[f] = false;
    }

    int32_t outCursor = 0;
    int32_t outFaces = 0;
    for (int32_t f = 0; f < produced; ++f) {
        if (consumed[f]) {
            continue;
        }
        int32_t mergeTarget = -1;
        int32_t mergeEdgeF = -1;
        int32_t mergeEdgeG = -1;
        for (int32_t g = f + 1; g < produced && mergeTarget < 0; ++g) {
            if (consumed[g]) {
                continue;
            }
            if (dot(srcNormals[f], srcNormals[g]) < 0.999999f) {
                continue;
            }
            const float offsetDelta = srcOffsets[f] - srcOffsets[g];
            if (offsetDelta > 1e-5f || offsetDelta < -1e-5f) {
                continue;
            }
            for (int32_t e = 0; e < 3 && mergeTarget < 0; ++e) {
                const int32_t u = srcIndices[f * 3 + e];
                const int32_t v = srcIndices[f * 3 + (e + 1) % 3];
                for (int32_t j = 0; j < 3; ++j) {
                    if (srcIndices[g * 3 + j] == v && srcIndices[g * 3 + (j + 1) % 3] == u) {
                        mergeTarget = g;
                        mergeEdgeF = e;
                        mergeEdgeG = j;
                        break;
                    }
                }
            }
        }

        if (outFaces >= kBulkMaxFaces) {
            return false;
        }
        scratch.outFaceStart[outFaces] = outCursor;
        if (mergeTarget < 0) {
            if (outCursor + 3 > kBulkMaxFaceIndices) {
                return false;
            }
            scratch.outFaceIndices[outCursor++] = srcIndices[f * 3 + 0];
            scratch.outFaceIndices[outCursor++] = srcIndices[f * 3 + 1];
            scratch.outFaceIndices[outCursor++] = srcIndices[f * 3 + 2];
        } else {
            if (outCursor + 4 > kBulkMaxFaceIndices) {
                return false;
            }
            consumed[mergeTarget] = true;
            const int32_t u = srcIndices[f * 3 + mergeEdgeF];
            const int32_t v = srcIndices[f * 3 + (mergeEdgeF + 1) % 3];
            const int32_t pf = srcIndices[f * 3 + (mergeEdgeF + 2) % 3];
            const int32_t pg = srcIndices[mergeTarget * 3 + (mergeEdgeG + 2) % 3];
            scratch.outFaceIndices[outCursor++] = v;
            scratch.outFaceIndices[outCursor++] = pf;
            scratch.outFaceIndices[outCursor++] = u;
            scratch.outFaceIndices[outCursor++] = pg;
        }
        scratch.outFaceNormals[outFaces] = srcNormals[f];
        scratch.outFaceOffsets[outFaces] = srcOffsets[f];
        ++outFaces;
    }
    scratch.outFaceStart[outFaces] = outCursor;

    if (outFaces < 4) {
        return false;
    }

    faceCount = outFaces;
    indexTotal = outCursor;
    return true;
}

}
