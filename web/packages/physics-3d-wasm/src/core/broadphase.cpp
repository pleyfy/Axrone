#include "core/broadphase.h"

#include "core/narrowphase.h"
#include "platform/math.h"

namespace axrone::physics {

namespace {

bool sweepLess(const World& world, int32_t left, int32_t right) {
    const float leftMin = world.sweepRecords[left].minX;
    const float rightMin = world.sweepRecords[right].minX;
    if (leftMin < rightMin) {
        return true;
    }
    if (rightMin < leftMin) {
        return false;
    }
    return left < right;
}

float selectExtent(const Vec3& half, int32_t axis) {
    if (axis == 0) {
        return half.x;
    }
    if (axis == 1) {
        return half.y;
    }
    return half.z;
}

}

void updateBounds(World& world) {
    for (int32_t i = 0; i < world.highWater; ++i) {
        Body& body = world.bodies[i];
        SweepRecord& record = world.sweepRecords[i];
        const int32_t slots = shapeSlots(body);
        if (body.state == kBodyFree || slots == 0) {
            body.aabb = { 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f };
            record = { 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0, 0 };
            continue;
        }
        record.filter = sweepFilterCode(body.state, slots);

        const Vec3 position = transformPosition(world.transforms[i]);
        const Mat3& rotation = body.rotation;
        AABB bounds = { kBig, kBig, kBig, -kBig, -kBig, -kBig };
        bool covered = false;

        for (int32_t slot = 0; slot < slots; ++slot) {
            const Shape& shape = body.shapes[slot];
            if (!shapeValid(shape)) {
                continue;
            }

            const Vec3 center = shapeCenter(position, rotation, shape);
            float ex = 0.0f;
            float ey = 0.0f;
            float ez = 0.0f;

            if (shape.kind == kShapeSphere) {
                ex = shape.extents.x;
                ey = ex;
                ez = ex;
            } else if (shape.kind == kShapeMesh || shape.kind == kShapeHeightField) {
                const ShapeBulk* bulk = world.bulkOf(i, slot);
                if (bulk == nullptr) {
                    continue;
                }
                Mat3 worldRotation;
                shapeWorldRotation(rotation, shape, worldRotation);
                const Vec3& localMin = bulk->localMin;
                const Vec3& localMax = bulk->localMax;
                for (int32_t corner = 0; corner < 8; ++corner) {
                    const Vec3 localPoint(
                        (corner & 1) != 0 ? localMax.x : localMin.x,
                        (corner & 2) != 0 ? localMax.y : localMin.y,
                        (corner & 4) != 0 ? localMax.z : localMin.z
                    );
                    const Vec3 worldPoint = center + worldRotation.transform(localPoint);
                    if (worldPoint.x - bounds.minX < 0.0f) {
                        bounds.minX = worldPoint.x;
                    }
                    if (worldPoint.y - bounds.minY < 0.0f) {
                        bounds.minY = worldPoint.y;
                    }
                    if (worldPoint.z - bounds.minZ < 0.0f) {
                        bounds.minZ = worldPoint.z;
                    }
                    if (worldPoint.x - bounds.maxX > 0.0f) {
                        bounds.maxX = worldPoint.x;
                    }
                    if (worldPoint.y - bounds.maxY > 0.0f) {
                        bounds.maxY = worldPoint.y;
                    }
                    if (worldPoint.z - bounds.maxZ > 0.0f) {
                        bounds.maxZ = worldPoint.z;
                    }
                }
                covered = true;
                continue;
            } else if (shape.kind == kShapeCapsule) {
                Mat3 worldRotation;
                shapeWorldRotation(rotation, shape, worldRotation);
                const Vec3 halfAxis(worldRotation.m[1] * shape.extents.y,
                                     worldRotation.m[4] * shape.extents.y,
                                     worldRotation.m[7] * shape.extents.y);
                const float radius = shape.extents.x;
                ex = fabsf(halfAxis.x) + radius;
                ey = fabsf(halfAxis.y) + radius;
                ez = fabsf(halfAxis.z) + radius;
            } else {
                Vec3 half = shape.extents;
                if (shape.kind == kShapeCylinder || shape.kind == kShapeCone) {
                    half.z = shape.extents.x;
                }
                Mat3 worldRotation;
                shapeWorldRotation(rotation, shape, worldRotation);
                ex = fabsf(worldRotation.m[0]) * selectExtent(half, 0) +
                     fabsf(worldRotation.m[1]) * selectExtent(half, 1) +
                     fabsf(worldRotation.m[2]) * selectExtent(half, 2);
                ey = fabsf(worldRotation.m[3]) * selectExtent(half, 0) +
                     fabsf(worldRotation.m[4]) * selectExtent(half, 1) +
                     fabsf(worldRotation.m[5]) * selectExtent(half, 2);
                ez = fabsf(worldRotation.m[6]) * selectExtent(half, 0) +
                     fabsf(worldRotation.m[7]) * selectExtent(half, 1) +
                     fabsf(worldRotation.m[8]) * selectExtent(half, 2);
            }

            if (center.x - ex < bounds.minX) {
                bounds.minX = center.x - ex;
            }
            if (center.y - ey < bounds.minY) {
                bounds.minY = center.y - ey;
            }
            if (center.z - ez < bounds.minZ) {
                bounds.minZ = center.z - ez;
            }
            if (center.x + ex > bounds.maxX) {
                bounds.maxX = center.x + ex;
            }
            if (center.y + ey > bounds.maxY) {
                bounds.maxY = center.y + ey;
            }
            if (center.z + ez > bounds.maxZ) {
                bounds.maxZ = center.z + ez;
            }
            covered = true;
        }

        const AABB final = covered ? bounds : AABB{ 0.0f, 0.0f, 0.0f, 0.0f, 0.0f, 0.0f };
        body.aabb = final;
        record.minX = final.minX;
        record.minY = final.minY;
        record.minZ = final.minZ;
        record.maxX = final.maxX;
        record.maxY = final.maxY;
        record.maxZ = final.maxZ;
    }
}

int32_t buildSweep(World& world) {
    int32_t count = 0;
    for (int32_t i = 0; i < world.highWater; ++i) {
        if (sweepQueryableFilter(world.sweepRecords[i].filter)) {
            world.sweepOrder[count++] = i;
        }
    }

    int32_t gap = count >> 1;
    while (gap > 0) {
        for (int32_t i = gap; i < count; ++i) {
            const int32_t item = world.sweepOrder[i];
            int32_t j = i;
            while (j >= gap && sweepLess(world, item, world.sweepOrder[j - gap])) {
                world.sweepOrder[j] = world.sweepOrder[j - gap];
                j -= gap;
            }
            world.sweepOrder[j] = item;
        }
        gap >>= 1;
    }
    return count;
}

void broadphase(World& world) {
    int32_t count = 0;
    AXRONE_PHASE(sweepSortScope, world.m_phaseNanoseconds.sweepSort);
    count = buildSweep(world);
    AXRONE_PHASE_CLOSE(sweepSortScope);

    world.statsShapePairs = 0;
    int64_t broadphasePairs = 0;

    AXRONE_PHASE(pairLoopScope, world.m_phaseNanoseconds.pairLoop);
    for (int32_t i = 0; i < count; ++i) {
        const int32_t a = world.sweepOrder[i];
        const SweepRecord& boundsA = world.sweepRecords[a];
        const int32_t filterA = boundsA.filter;
        const int32_t stateA = sweepFilterState(filterA);
        const bool aDynamic = stateA == kBodyDynamic;
        const bool aKinematic = stateA == kBodyKinematic;

        for (int32_t j = i + 1; j < count; ++j) {
            const int32_t b = world.sweepOrder[j];
            const SweepRecord& boundsB = world.sweepRecords[b];

            if (boundsB.minX > boundsA.maxX) {
                break;
            }
            if (boundsB.minY > boundsA.maxY || boundsB.maxY < boundsA.minY) {
                continue;
            }
            if (boundsB.minZ > boundsA.maxZ || boundsB.maxZ < boundsA.minZ) {
                continue;
            }
            const int32_t stateB = sweepFilterState(boundsB.filter);
            const bool bKinematic = stateB == kBodyKinematic;
            if (!aDynamic && stateB != kBodyDynamic && aKinematic == bKinematic) {
                continue;
            }

            ++broadphasePairs;
            AXRONE_PHASE(collideScope, world.m_phaseNanoseconds.collide);
            collidePair(world, a, b);
            AXRONE_PHASE_CLOSE(collideScope);
        }
    }
    AXRONE_PHASE_CLOSE(pairLoopScope);

    world.statsBroadphasePairs = broadphasePairs;
    world.statsSerialPlusOne = world.stepSerial + 1;
}

}
