import { Vec3 } from '@axrone/numeric';
import type { IVec3Like } from '@axrone/numeric';
import { AABB3D } from '@axrone/geometry';
import type {
    IAABBQueryCallback,
    ISingleRaycastResult3D,
} from '../types';
import type {
    IQueryFilter3D,
    RaycastCallback3D,
    ShapeId3D,
} from '../types/physics-3d';
import type { BodyManager3D } from './physics-managers-3d';
import type { DynamicAABBTree3D } from './broadphase-3d';
import type { IShapeDescriptor3D } from './physics-world-3d-shared';
import {
    computeShapeAabb,
    rayCastShape,
    testPointShape,
} from './physics-world-3d-shape-geometry';
import {
    intersectsAabb,
    supportsQueryFilter,
} from './physics-world-3d-shared';

/**
 * Executes a raycast against all shapes, invoking the callback for each hit.
 * Returning 0 from the callback terminates early (Box2D-style contract).
 */
export function raycast(
    origin: IVec3Like,
    direction: IVec3Like,
    maxDistance: number,
    callback: RaycastCallback3D,
    shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>,
    broadphase: DynamicAABBTree3D<ShapeId3D>,
    bodyManager: BodyManager3D,
    filter?: IQueryFilter3D
): void {
    for (const result of rayCastAll(origin, direction, maxDistance, shapeDescriptors, broadphase, bodyManager, filter)) {
        const continuation = callback(
            result.shapeId,
            result.point,
            result.normal,
            result.fraction
        );
        if (continuation === 0) {
            break;
        }
    }
}

/**
 * Shared traversal for rayCastClosest / rayCastAll.
 *
 * `clip=false`: the BVH callback returns the query's `maxFraction` after every
 * hit, so no farther leaf is pruned and every overlapping shape is tested. This
 * is required for the all-hits query so that `rayCastAll` semantics are stable
 * before and after the first step (the pre-step fallback path never clipped).
 * `clip=true`: the callback returns `hit.fraction`, tightening the traversal
 * window for the closest-hit path.
 */
function collectRaycastHits(
    origin: Readonly<IVec3Like>,
    direction: Readonly<IVec3Like>,
    maxFraction: number,
    shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>,
    broadphase: DynamicAABBTree3D<ShapeId3D>,
    bodyManager: BodyManager3D,
    filter: IQueryFilter3D | undefined,
    clip: boolean
): ISingleRaycastResult3D[] {
    const results: ISingleRaycastResult3D[] = [];

    // BVH-backed ray cast: traverse tree for O(log N) candidate selection
    broadphase.rayCast(origin, direction, maxFraction, (shapeId, _frac) => {
        const descriptor = shapeDescriptors.get(shapeId);
        if (!descriptor) return maxFraction;
        if (!supportsQueryFilter(descriptor.filter, filter)) return maxFraction;
        const position = bodyManager.getPosition(descriptor.bodyId);
        const rotation = bodyManager.getRotation(descriptor.bodyId);
        const hit = rayCastShape(descriptor, origin, direction, maxFraction, position, rotation);
        if (!hit) return maxFraction;
        results.push({
            hit: true,
            bodyId: descriptor.bodyId,
            shapeId: descriptor.id,
            point: Vec3.add(origin, Vec3.multiplyScalar(direction, hit.fraction)),
            normal: hit.normal,
            fraction: hit.fraction,
        });
        // All-hits query must not prune; closest-hit query tightens with the found fraction.
        return clip ? hit.fraction : maxFraction;
    });

    // Fallback: shapes not yet in BVH (before first step)
    if (broadphase.nodeCount === 0) {
        for (const descriptor of shapeDescriptors.values()) {
            if (!supportsQueryFilter(descriptor.filter, filter)) continue;
            const position = bodyManager.getPosition(descriptor.bodyId);
            const rotation = bodyManager.getRotation(descriptor.bodyId);
            const hit = rayCastShape(descriptor, origin, direction, maxFraction, position, rotation);
            if (!hit) continue;
            results.push({
                hit: true, bodyId: descriptor.bodyId, shapeId: descriptor.id,
                point: Vec3.add(origin, Vec3.multiplyScalar(direction, hit.fraction)),
                normal: hit.normal, fraction: hit.fraction,
            });
        }
    }

    results.sort((left, right) => left.fraction - right.fraction);
    return results;
}

/**
 * Returns the closest raycast hit, or null if nothing was hit.
 * Keeps the closest-hit clipping optimization.
 */
export function rayCastClosest(
    origin: Readonly<IVec3Like>,
    direction: Readonly<IVec3Like>,
    maxFraction: number,
    shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>,
    broadphase: DynamicAABBTree3D<ShapeId3D>,
    bodyManager: BodyManager3D,
    filter?: IQueryFilter3D
): ISingleRaycastResult3D | null {
    return collectRaycastHits(origin, direction, maxFraction, shapeDescriptors, broadphase, bodyManager, filter, true)[0] ?? null;
}

/**
 * Raycasts against all shapes and returns hits sorted by ascending `fraction`.
 * The result ordering contract is: strictly ascending by hit fraction; ties are
 * preserved in the order returned by the BVH traversal / fallback scan.
 *
 * No BVH pruning on hit — every overlapping shape is tested. The pre-first-step
 * fallback path has always been non-clipping, so both paths now agree.
 */
export function rayCastAll(
    origin: Readonly<IVec3Like>,
    direction: Readonly<IVec3Like>,
    maxFraction: number,
    shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>,
    broadphase: DynamicAABBTree3D<ShapeId3D>,
    bodyManager: BodyManager3D,
    filter?: IQueryFilter3D
): readonly ISingleRaycastResult3D[] {
    return collectRaycastHits(origin, direction, maxFraction, shapeDescriptors, broadphase, bodyManager, filter, false);
}

/**
 * Queries shapes overlapping an AABB, invoking the callback for each.
 * Returning false from the callback terminates early.
 */
export function queryAABB(
    min: Readonly<IVec3Like>,
    max: Readonly<IVec3Like>,
    callback: IAABBQueryCallback,
    shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>,
    broadphase: DynamicAABBTree3D<ShapeId3D>,
    bodyManager: BodyManager3D
): void {
    for (const shapeId of queryAABBAll(min, max, undefined, shapeDescriptors, broadphase, bodyManager)) {
        if (!callback(shapeId)) {
            break;
        }
    }
}

/**
 * Returns all shape IDs overlapping the given AABB.
 */
export function queryAABBAll(
    min: Readonly<IVec3Like>,
    max: Readonly<IVec3Like>,
    filter: IQueryFilter3D | undefined,
    shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>,
    broadphase: DynamicAABBTree3D<ShapeId3D>,
    bodyManager: BodyManager3D
): readonly ShapeId3D[] {
    const queryBounds = { min: Vec3.copy(min), max: Vec3.copy(max) };
    const shapeIds: ShapeId3D[] = [];

    if (broadphase.nodeCount > 0) {
        // BVH-backed: broadphase candidate generation
        const bvhQuery = new AABB3D(min, max);
        const seen = new Set<ShapeId3D>();
        broadphase.queryAABBAll(bvhQuery, (shapeId: ShapeId3D) => {
            if (seen.has(shapeId)) return true;
            seen.add(shapeId);
            const descriptor = shapeDescriptors.get(shapeId);
            if (!descriptor) return true;
            if (!supportsQueryFilter(descriptor.filter, filter)) return true;
            const position = bodyManager.getPosition(descriptor.bodyId);
            const rotation = bodyManager.getRotation(descriptor.bodyId);
            if (intersectsAabb(computeShapeAabb(descriptor, position, rotation), queryBounds)) {
                shapeIds.push(descriptor.id);
            }
            return true;
        });
    } else {
        // Fallback: linear scan before first step
        for (const descriptor of shapeDescriptors.values()) {
            if (!supportsQueryFilter(descriptor.filter, filter)) continue;
            const position = bodyManager.getPosition(descriptor.bodyId);
            const rotation = bodyManager.getRotation(descriptor.bodyId);
            if (intersectsAabb(computeShapeAabb(descriptor, position, rotation), queryBounds)) {
                shapeIds.push(descriptor.id);
            }
        }
    }

    return shapeIds;
}

/**
 * Queries shapes containing a point, invoking the callback for each.
 * Returning false from the callback terminates early.
 */
export function queryPoint(
    point: Readonly<IVec3Like>,
    callback: IAABBQueryCallback,
    shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>,
    broadphase: DynamicAABBTree3D<ShapeId3D>,
    bodyManager: BodyManager3D
): void {
    for (const shapeId of queryPointAll(point, undefined, shapeDescriptors, broadphase, bodyManager)) {
        if (!callback(shapeId)) {
            break;
        }
    }
}

/**
 * Returns all shape IDs containing the given point.
 */
export function queryPointAll(
    point: Readonly<IVec3Like>,
    filter: IQueryFilter3D | undefined,
    shapeDescriptors: ReadonlyMap<ShapeId3D, IShapeDescriptor3D>,
    broadphase: DynamicAABBTree3D<ShapeId3D>,
    bodyManager: BodyManager3D
): readonly ShapeId3D[] {
    const shapeIds: ShapeId3D[] = [];

    if (broadphase.nodeCount > 0) {
        // BVH-backed: broadphase candidate generation
        const seen = new Set<ShapeId3D>();
        broadphase.queryPointAll(point, (shapeId: ShapeId3D) => {
            if (seen.has(shapeId)) return true;
            seen.add(shapeId);
            const descriptor = shapeDescriptors.get(shapeId);
            if (!descriptor) return true;
            if (!supportsQueryFilter(descriptor.filter, filter)) return true;
            const position = bodyManager.getPosition(descriptor.bodyId);
            const rotation = bodyManager.getRotation(descriptor.bodyId);
            if (testPointShape(descriptor, point, position, rotation)) {
                shapeIds.push(descriptor.id);
            }
            return true;
        });
    } else {
        // Fallback: linear scan before first step
        for (const descriptor of shapeDescriptors.values()) {
            if (!supportsQueryFilter(descriptor.filter, filter)) continue;
            const position = bodyManager.getPosition(descriptor.bodyId);
            const rotation = bodyManager.getRotation(descriptor.bodyId);
            if (testPointShape(descriptor, point, position, rotation)) {
                shapeIds.push(descriptor.id);
            }
        }
    }

    return shapeIds;
}

/**
 * Shifts the world origin, adjusting all body positions accordingly.
 */
export function shiftOrigin(
    newOrigin: Readonly<IVec3Like>,
    bodyManager: BodyManager3D
): void {
    for (const bodyId of bodyManager.getBodyIds()) {
        const position = bodyManager.getPosition(bodyId);
        bodyManager.setPosition(bodyId, Vec3.subtract(position, newOrigin));
    }
}
