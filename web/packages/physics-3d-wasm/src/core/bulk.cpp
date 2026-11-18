#include "core/world.h"

#include "core/polytope.h"
#include "platform/math.h"
#include "platform/memory.h"
#include "runtime/arena.h"

namespace axrone::physics {

namespace {

constexpr int32_t kMeshIndexReserveBytes = kBulkMaxTriangles * 3 * static_cast<int32_t>(sizeof(uint32_t));

uintptr_t alignUp(uintptr_t value, uintptr_t alignment) {
    return (value + (alignment - 1U)) & ~(alignment - 1U);
}

int32_t alignUpBytes(int32_t value) {
    return static_cast<int32_t>((static_cast<uintptr_t>(value) + 15U) & ~static_cast<uintptr_t>(15U));
}

bool scratchRangeInside(const World& world, uintptr_t address, size_t bytes) {
    if (world.scratchBegin == 0) {
        return false;
    }
    if (address < world.scratchBegin || address > world.scratchCursor) {
        return false;
    }
    if (address + bytes < address) {
        return false;
    }
    return address + bytes <= world.scratchCursor;
}

int32_t carve(int32_t cursor) {
    return alignUpBytes(cursor);
}

uintptr_t carveAt(uintptr_t base, int32_t& cursor, int32_t bytes) {
    const int32_t aligned = carve(cursor);
    cursor = aligned + bytes;
    return base + static_cast<uintptr_t>(aligned);
}

bool resolveBulkSlot(const World& world, int32_t shapeId, int32_t& bodyId, int32_t& slot, Shape*& shape) {
    if (!world.shapeIdResolve(shapeId, bodyId, slot)) {
        return false;
    }
    shape = &world.bodies[bodyId].shapes[slot];
    return true;
}

bool floatsFinite(const float* data, int32_t count) {
    for (int32_t i = 0; i < count; ++i) {
        if (!isFinite(data[i])) {
            return false;
        }
    }
    return true;
}

int32_t dedupeVertices(const float* data, int32_t count, Vec3* out) {
    int32_t unique = 0;
    for (int32_t i = 0; i < count; ++i) {
        const Vec3 candidate(data[i * 3 + 0], data[i * 3 + 1], data[i * 3 + 2]);
        bool duplicate = false;
        for (int32_t j = 0; j < unique; ++j) {
            if (out[j].x == candidate.x && out[j].y == candidate.y && out[j].z == candidate.z) {
                duplicate = true;
                break;
            }
        }
        if (!duplicate) {
            out[unique++] = candidate;
        }
    }
    return unique;
}

void expandBounds(const Vec3& vertex, Vec3& minOut, Vec3& maxOut) {
    if (vertex.x < minOut.x) {
        minOut.x = vertex.x;
    }
    if (vertex.y < minOut.y) {
        minOut.y = vertex.y;
    }
    if (vertex.z < minOut.z) {
        minOut.z = vertex.z;
    }
    if (vertex.x > maxOut.x) {
        maxOut.x = vertex.x;
    }
    if (vertex.y > maxOut.y) {
        maxOut.y = vertex.y;
    }
    if (vertex.z > maxOut.z) {
        maxOut.z = vertex.z;
    }
}

}

bool World::ensureBulkPool() {
    if (scratchBegin != 0) {
        return true;
    }
    if (!initialized || bulkArena == nullptr) {
        return false;
    }
    if (shapeBulks == nullptr) {
        const size_t tableBytes = sizeof(ShapeBulk*) * static_cast<size_t>(maxBodies) * kMaxShapesPerBody;
        void* table = bulkArena->alloc(tableBytes, 16);
        if (table == nullptr) {
            return false;
        }
        shapeBulks = reinterpret_cast<ShapeBulk**>(table);
        memset(shapeBulks, 0, tableBytes);
    }
    void* scratch = bulkArena->alloc(kBulkScratchBytes, 64);
    if (scratch == nullptr) {
        return false;
    }
    scratchBegin = reinterpret_cast<uintptr_t>(scratch);
    scratchCursor = scratchBegin;
    scratchEnd = scratchBegin + static_cast<uintptr_t>(kBulkScratchBytes);
    bulkPoolBaseOffset = bulkArena->used();
    return true;
}

uintptr_t World::bulkAlloc(int32_t bytes) {
    if (bytes <= 0) {
        return 0;
    }
    if (!ensureBulkPool()) {
        return 0;
    }
    const uintptr_t aligned = alignUp(scratchCursor, 8U);
    if (aligned < scratchCursor || aligned > scratchEnd) {
        return 0;
    }
    if (static_cast<uintptr_t>(bytes) > scratchEnd - aligned) {
        return 0;
    }
    scratchCursor = aligned + static_cast<uintptr_t>(bytes);
    return aligned;
}

int32_t World::bulkRelease(uintptr_t address) {
    if (scratchBegin == 0 || address < scratchBegin || address > scratchCursor) {
        return -1;
    }
    scratchCursor = address;
    return 0;
}

size_t World::bulkScratchUsed() const {
    if (scratchBegin == 0) {
        return 0;
    }
    return static_cast<size_t>(scratchCursor - scratchBegin);
}

size_t World::bulkArenaUsed() const {
    if (bulkArena == nullptr) {
        return 0;
    }
    return bulkArena->used();
}

void World::clearShapeBulk(int32_t bodyId, int32_t slot) {
    if (!initialized || bodies == nullptr || shapeBulks == nullptr || slot < 0 || slot >= kMaxShapesPerBody) {
        return;
    }
    if (bodyId < 0 || bodyId >= highWater) {
        return;
    }
    Shape& shape = bodies[bodyId].shapes[slot];
    if (!isBulkKind(shape.kind)) {
        return;
    }
    ShapeBulk* bulk = shapeBulks[static_cast<size_t>(bodyId) * kMaxShapesPerBody + static_cast<size_t>(slot)];
    shape.resetBulkFields();
    setBulkAt(bodyId, slot, nullptr);
    if (bulk == nullptr || bulkArena == nullptr) {
        return;
    }
    const uintptr_t base = reinterpret_cast<uintptr_t>(bulkArena->base());
    if (bulk->blockStart < base) {
        return;
    }
    const size_t blockOffset = static_cast<size_t>(bulk->blockStart - base);
    if (bulk->blockBytes <= 0 || static_cast<size_t>(bulk->blockBytes) > static_cast<size_t>(-1) - blockOffset) {
        return;
    }
    const size_t blockEnd = blockOffset + static_cast<size_t>(bulk->blockBytes);
    if (bulkArena->used() == blockEnd) {
        bulkArena->shrinkTo(blockOffset);
    }
}

int32_t World::addBulkShape(int32_t kind, int32_t id, float density, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    if (!isActive(id) || !isFinite(density) || !isFinite(px) || !isFinite(py) || !isFinite(pz) ||
        !isFinite(qx) || !isFinite(qy) || !isFinite(qz) || !isFinite(qw) || density < 0.0f) {
        return -1;
    }
    Body& body = bodies[id];
    if ((kind == kShapeMesh || kind == kShapeHeightField) && body.state != kBodyStatic) {
        return -1;
    }
    if (body.shapeCount >= kMaxShapesPerBody) {
        return -1;
    }
    if (!ensureBulkPool()) {
        return -1;
    }

    Transform local = { 0.0f, 0.0f, 0.0f, qx, qy, qz, qw };
    normalizeQuaternion(local);

    const int32_t slot = firstFreeShapeSlot(body);
    if (slot < 0) {
        return -1;
    }

    Shape& shape = body.shapes[slot];
    setBulkAt(id, slot, nullptr);
    if (kind == kShapeHull) {
        shape.setHull(density, Vec3(px, py, pz), local.qx, local.qy, local.qz, local.qw);
    } else if (kind == kShapeMesh) {
        shape.setMesh(density, Vec3(px, py, pz), local.qx, local.qy, local.qz, local.qw);
    } else {
        shape.setHeightField(density, Vec3(px, py, pz), local.qx, local.qy, local.qz, local.qw);
    }
    bumpSlotGeneration(*this, id, slot);
    if (slot + 1 > body.shapeCount) {
        body.shapeCount = slot + 1;
    }
    recomputeMass(body);
    return slot;
}

int32_t World::addHull(int32_t id, float density, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    return addBulkShape(kShapeHull, id, density, px, py, pz, qx, qy, qz, qw);
}

int32_t World::addMesh(int32_t id, float density, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    return addBulkShape(kShapeMesh, id, density, px, py, pz, qx, qy, qz, qw);
}

int32_t World::addHeightField(int32_t id, float density, float px, float py, float pz, float qx, float qy, float qz, float qw) {
    return addBulkShape(kShapeHeightField, id, density, px, py, pz, qx, qy, qz, qw);
}

int32_t World::setShapeVertices(int32_t shapeId, uintptr_t address, int32_t count) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    Shape* shape = nullptr;
    if (!resolveBulkSlot(*this, shapeId, bodyId, slot, shape)) {
        return -1;
    }
    if (shape->kind != kShapeHull && shape->kind != kShapeMesh) {
        return -1;
    }
    if (count < 3 || count > kBulkMaxVertices) {
        return -1;
    }
    if ((address & 3U) != 0U) {
        return -1;
    }
    const size_t payloadBytes = static_cast<size_t>(count) * 3U * sizeof(float);
    if (!scratchRangeInside(*this, address, payloadBytes)) {
        return -1;
    }
    const float* source = reinterpret_cast<const float*>(address);
    if (!floatsFinite(source, count * 3)) {
        return -1;
    }

    if (bulkOf(bodyId, slot) != nullptr) {
        clearShapeBulk(bodyId, slot);
    }

    if (shape->kind == kShapeMesh) {
        int32_t total = alignUpBytes(static_cast<int32_t>(sizeof(ShapeBulk)));
        total += count * static_cast<int32_t>(sizeof(Vec3));
        total = alignUpBytes(total) + kMeshIndexReserveBytes;
        total = alignUpBytes(total);

        void* raw = bulkArena->alloc(static_cast<size_t>(total), 16);
        if (raw == nullptr) {
            return -1;
        }
        const uintptr_t base = reinterpret_cast<uintptr_t>(raw);
        int32_t cursor = 0;
        const uintptr_t bulkAddress = carveAt(base, cursor, static_cast<int32_t>(sizeof(ShapeBulk)));
        const uintptr_t verticesAddress = carveAt(base, cursor, count * static_cast<int32_t>(sizeof(Vec3)));
        const uintptr_t indicesAddress = carveAt(base, cursor, kMeshIndexReserveBytes);
        (void)cursor;

        ShapeBulk* bulk = reinterpret_cast<ShapeBulk*>(bulkAddress);
        bulk->blockStart = base;
        bulk->blockBytes = total;
        bulk->vertexCount = count;
        bulk->faceCount = 0;
        bulk->vertices = reinterpret_cast<Vec3*>(verticesAddress);
        bulk->faceStart = nullptr;
        bulk->faceIndices = nullptr;
        bulk->faceNormals = nullptr;
        bulk->faceOffsets = nullptr;
        bulk->triangleCount = 0;
        bulk->indices = reinterpret_cast<uint32_t*>(indicesAddress);
        bulk->heightFieldWidth = 0;
        bulk->heightFieldDepth = 0;
        bulk->heightFieldScale = Vec3();
        bulk->heights = nullptr;

        Vec3 minVertex(source[0], source[1], source[2]);
        Vec3 maxVertex = minVertex;
        for (int32_t i = 0; i < count; ++i) {
            bulk->vertices[i] = Vec3(source[i * 3 + 0], source[i * 3 + 1], source[i * 3 + 2]);
            expandBounds(bulk->vertices[i], minVertex, maxVertex);
        }

        setBulkAt(bodyId, slot, bulk);
        bulk->localMin = minVertex;
        bulk->localMax = maxVertex;
        recomputeMass(bodies[bodyId]);
        return 0;
    }

    Vec3 scratchVertices[kBulkMaxVertices];
    const int32_t uniqueCount = dedupeVertices(source, count, scratchVertices);
    if (uniqueCount < 4) {
        return -1;
    }

    Vec3 minVertex(scratchVertices[0].x, scratchVertices[0].y, scratchVertices[0].z);
    Vec3 maxVertex = minVertex;
    for (int32_t i = 1; i < uniqueCount; ++i) {
        expandBounds(scratchVertices[i], minVertex, maxVertex);
    }
    const Vec3 middle(
        (minVertex.x + maxVertex.x) * 0.5f,
        (minVertex.y + maxVertex.y) * 0.5f,
        (minVertex.z + maxVertex.z) * 0.5f
    );
    const Vec3 half(
        (maxVertex.x - minVertex.x) * 0.5f,
        (maxVertex.y - minVertex.y) * 0.5f,
        (maxVertex.z - minVertex.z) * 0.5f
    );
    if (half.x <= 0.0f || half.y <= 0.0f || half.z <= 0.0f) {
        return -1;
    }
    for (int32_t i = 0; i < uniqueCount; ++i) {
        scratchVertices[i] = scratchVertices[i] - middle;
    }

    int32_t faceIndices[kBulkMaxFaceIndices];
    int32_t faceStart[kBulkMaxFaces + 1];
    Vec3 faceNormals[kBulkMaxFaces];
    float faceOffsets[kBulkMaxFaces];
    int32_t faceCount = 0;
    int32_t indexTotal = 0;
    if (!buildUserHullFaces(scratchVertices, uniqueCount, faceIndices, faceStart, faceNormals, faceOffsets, kBulkMaxFaces, faceCount, indexTotal)) {
        return -1;
    }
    const int32_t indexCount = indexTotal;

    int32_t total = alignUpBytes(static_cast<int32_t>(sizeof(ShapeBulk)));
    total += uniqueCount * static_cast<int32_t>(sizeof(Vec3));
    total = alignUpBytes(total) + (faceCount + 1) * static_cast<int32_t>(sizeof(int32_t));
    total = alignUpBytes(total) + indexCount * static_cast<int32_t>(sizeof(int32_t));
    total = alignUpBytes(total) + faceCount * static_cast<int32_t>(sizeof(Vec3));
    total = alignUpBytes(total) + faceCount * static_cast<int32_t>(sizeof(float));
    total = alignUpBytes(total);

    void* raw = bulkArena->alloc(static_cast<size_t>(total), 16);
    if (raw == nullptr) {
        return -1;
    }
    const uintptr_t base = reinterpret_cast<uintptr_t>(raw);
    int32_t cursor = 0;
    const uintptr_t bulkAddress = carveAt(base, cursor, static_cast<int32_t>(sizeof(ShapeBulk)));
    const uintptr_t verticesAddress = carveAt(base, cursor, uniqueCount * static_cast<int32_t>(sizeof(Vec3)));
    const uintptr_t faceStartAddress = carveAt(base, cursor, (faceCount + 1) * static_cast<int32_t>(sizeof(int32_t)));
    const uintptr_t faceIndicesAddress = carveAt(base, cursor, indexCount * static_cast<int32_t>(sizeof(int32_t)));
    const uintptr_t faceNormalsAddress = carveAt(base, cursor, faceCount * static_cast<int32_t>(sizeof(Vec3)));
    const uintptr_t faceOffsetsAddress = carveAt(base, cursor, faceCount * static_cast<int32_t>(sizeof(float)));
    (void)cursor;

    ShapeBulk* bulk = reinterpret_cast<ShapeBulk*>(bulkAddress);
    bulk->blockStart = base;
    bulk->blockBytes = total;
    bulk->vertexCount = uniqueCount;
    bulk->faceCount = faceCount;
    bulk->vertices = reinterpret_cast<Vec3*>(verticesAddress);
    bulk->faceStart = reinterpret_cast<int32_t*>(faceStartAddress);
    bulk->faceIndices = reinterpret_cast<int32_t*>(faceIndicesAddress);
    bulk->faceNormals = reinterpret_cast<Vec3*>(faceNormalsAddress);
    bulk->faceOffsets = reinterpret_cast<float*>(faceOffsetsAddress);
    bulk->triangleCount = 0;
    bulk->indices = nullptr;
    bulk->heightFieldWidth = 0;
    bulk->heightFieldDepth = 0;
    bulk->heightFieldScale = Vec3();
    bulk->heights = nullptr;

    for (int32_t f = 0; f <= faceCount; ++f) {
        bulk->faceStart[f] = faceStart[f];
    }
    for (int32_t i = 0; i < indexCount; ++i) {
        bulk->faceIndices[i] = faceIndices[i];
    }
    for (int32_t i = 0; i < uniqueCount; ++i) {
        bulk->vertices[i] = scratchVertices[i];
    }
    for (int32_t f = 0; f < faceCount; ++f) {
        bulk->faceNormals[f] = faceNormals[f];
        bulk->faceOffsets[f] = faceOffsets[f];
    }

    setBulkAt(bodyId, slot, bulk);
    shape->extents = half;
    bulk->localMin = -half;
    bulk->localMax = half;
    shape->offset = shape->offset + shape->rotation.transform(middle);
    recomputeMass(bodies[bodyId]);
    return 0;
}

int32_t World::setShapeIndices(int32_t shapeId, uintptr_t address, int32_t count) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    Shape* shape = nullptr;
    if (!resolveBulkSlot(*this, shapeId, bodyId, slot, shape)) {
        return -1;
    }
    ShapeBulk* bulk = bulkOf(bodyId, slot);
    if (shape->kind != kShapeMesh || bulk == nullptr || bulk->vertexCount <= 0) {
        return -1;
    }
    if (count < 1 || count > kBulkMaxTriangles) {
        return -1;
    }
    if ((address & 3U) != 0U) {
        return -1;
    }
    const size_t payloadBytes = static_cast<size_t>(count) * 3U * sizeof(uint32_t);
    if (!scratchRangeInside(*this, address, payloadBytes)) {
        return -1;
    }
    const uint32_t* source = reinterpret_cast<const uint32_t*>(address);
    const uint32_t vertexCount = static_cast<uint32_t>(bulk->vertexCount);
    for (int32_t i = 0; i < count * 3; ++i) {
        // Unsigned comparison is deliberate: a high-bit index must be rejected,
        // not wrapped into a negative value by an int32_t cast.
        if (source[i] >= vertexCount) {
            return -1;
        }
    }

    for (int32_t i = 0; i < count * 3; ++i) {
        bulk->indices[i] = source[i];
    }
    bulk->triangleCount = count;
    recomputeMass(bodies[bodyId]);
    return 0;
}

int32_t World::setShapeHeightField(
    int32_t shapeId,
    uintptr_t address,
    int32_t width,
    int32_t depth,
    float scaleX,
    float scaleY,
    float scaleZ
) {
    int32_t bodyId = 0;
    int32_t slot = 0;
    Shape* shape = nullptr;
    if (!resolveBulkSlot(*this, shapeId, bodyId, slot, shape)) {
        return -1;
    }
    if (shape->kind != kShapeHeightField) {
        return -1;
    }
    if (width < 2 || depth < 2 || width > kBulkMaxHeightFieldSide || depth > kBulkMaxHeightFieldSide) {
        return -1;
    }
    if (!isFinite(scaleX) || !isFinite(scaleY) || !isFinite(scaleZ) ||
        scaleX <= 0.0f || scaleY <= 0.0f || scaleZ <= 0.0f) {
        return -1;
    }
    if ((address & 3U) != 0U) {
        return -1;
    }
    const int32_t cellCount = width * depth;
    const size_t payloadBytes = static_cast<size_t>(cellCount) * sizeof(float);
    if (!scratchRangeInside(*this, address, payloadBytes)) {
        return -1;
    }
    const float* source = reinterpret_cast<const float*>(address);
    if (!floatsFinite(source, cellCount)) {
        return -1;
    }

    if (bulkOf(bodyId, slot) != nullptr) {
        clearShapeBulk(bodyId, slot);
    }

    int32_t total = alignUpBytes(static_cast<int32_t>(sizeof(ShapeBulk)));
    total = alignUpBytes(total) + cellCount * static_cast<int32_t>(sizeof(float));
    total = alignUpBytes(total);

    void* raw = bulkArena->alloc(static_cast<size_t>(total), 16);
    if (raw == nullptr) {
        return -1;
    }
    const uintptr_t base = reinterpret_cast<uintptr_t>(raw);
    int32_t cursor = 0;
    const uintptr_t bulkAddress = carveAt(base, cursor, static_cast<int32_t>(sizeof(ShapeBulk)));
    const uintptr_t heightsAddress = carveAt(base, cursor, cellCount * static_cast<int32_t>(sizeof(float)));
    (void)cursor;

    ShapeBulk* bulk = reinterpret_cast<ShapeBulk*>(bulkAddress);
    bulk->blockStart = base;
    bulk->blockBytes = total;
    bulk->vertexCount = 0;
    bulk->faceCount = 0;
    bulk->vertices = nullptr;
    bulk->faceStart = nullptr;
    bulk->faceIndices = nullptr;
    bulk->faceNormals = nullptr;
    bulk->faceOffsets = nullptr;
    bulk->triangleCount = 0;
    bulk->indices = nullptr;
    bulk->heightFieldWidth = width;
    bulk->heightFieldDepth = depth;
    bulk->heightFieldScale = Vec3(scaleX, scaleY, scaleZ);
    bulk->heights = reinterpret_cast<float*>(heightsAddress);

    float minHeight = source[0];
    float maxHeight = source[0];
    for (int32_t i = 0; i < cellCount; ++i) {
        bulk->heights[i] = source[i];
        if (source[i] < minHeight) {
            minHeight = source[i];
        }
        if (source[i] > maxHeight) {
            maxHeight = source[i];
        }
    }

    const float halfWidth = static_cast<float>(width - 1) * 0.5f * scaleX;
    const float halfDepth = static_cast<float>(depth - 1) * 0.5f * scaleZ;
    setBulkAt(bodyId, slot, bulk);
    bulk->localMin = Vec3(-halfWidth, minHeight * scaleY, -halfDepth);
    bulk->localMax = Vec3(halfWidth, maxHeight * scaleY, halfDepth);
    recomputeMass(bodies[bodyId]);
    return 0;
}

}
