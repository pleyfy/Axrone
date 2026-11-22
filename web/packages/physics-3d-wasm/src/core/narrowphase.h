#pragma once

#include <stdint.h>

#include "core/world.h"

namespace axrone::physics {

// Per-World narrowphase working set. This used to live inline in World and is
// now arena-backed so a World descriptor stays small and cheap to reset.
struct NarrowphaseScratch {
    Vec3 axesA[3];
    Vec3 axesB[3];
    Vec3 faceVertices[4];
    Vec3 clipA[kBoxClipCapacity];
    Vec3 clipB[kBoxClipCapacity];
    Vec3 hullVerticesA[kBulkMaxVertices];
    Vec3 hullVerticesB[kBulkMaxVertices];
    Vec3 hullNormalsA[kBulkMaxFaces];
    Vec3 hullNormalsB[kBulkMaxFaces];
    float hullOffsetsA[kBulkMaxFaces];
    float hullOffsetsB[kBulkMaxFaces];
    int32_t hullStartA[kBulkMaxFaces + 1];
    int32_t hullStartB[kBulkMaxFaces + 1];
    int32_t hullIndicesA[kBulkMaxFaceIndices];
    int32_t hullIndicesB[kBulkMaxFaceIndices];
};

void collidePair(World& world, int32_t a, int32_t b);

}
