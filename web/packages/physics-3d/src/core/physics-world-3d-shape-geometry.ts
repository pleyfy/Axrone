import { Vec3, Quat } from '@axrone/numeric';
import type { IQuatLike, IVec3Like } from '@axrone/numeric';
import type { BodyId3D, IHeightFieldShapeDef3D } from '../types/physics-3d';
import {
    IDENTITY_ROTATION,
    SHAPE_TYPE_BOX,
    SHAPE_TYPE_CAPSULE,
    SHAPE_TYPE_CONE,
    SHAPE_TYPE_CONVEX_HULL,
    SHAPE_TYPE_CYLINDER,
    SHAPE_TYPE_HEIGHTFIELD,
    SHAPE_TYPE_SPHERE,
    SHAPE_TYPE_TRIANGLE_MESH,
    type IAabb3D,
    type IShapeDescriptor3D,
    type IShapeFrame3D,
    type IShapeRayHit3D,
    cylinderConeLocalHalfExtents,
    expandAabb,
    getBoxWorldExtents,
    getHeightFieldLocalVertex,
    inverseTransformPoint3D,
    isBoxDef,
    linePointDistanceSquared,
    midpointVec3,
    rayAabbHit,
    raySphereHit,
    rayTriangleHit,
    transformPoint3D,
} from './physics-world-3d-shared';
import { computeLocalConvexBounds, computeLocalHeightFieldBounds } from './physics-world-3d-shape-mass-properties';

/**
 * Samples the interpolated height of a heightfield at local (x, z).
 * Returns null if the point is outside the heightfield grid.
 */
export function sampleHeightFieldHeight(
    def: Readonly<IHeightFieldShapeDef3D>,
    x: number,
    z: number
): number | null {
    if (def.width < 2 || def.depth < 2 || def.scaleX <= 0 || def.scaleZ <= 0) {
        return null;
    }

    const halfWidth = (def.width - 1) * 0.5;
    const halfDepth = (def.depth - 1) * 0.5;
    const gridX = x / def.scaleX + halfWidth;
    const gridZ = z / def.scaleZ + halfDepth;

    if (gridX < 0 || gridZ < 0 || gridX > def.width - 1 || gridZ > def.depth - 1) {
        return null;
    }

    const x0 = Math.min(def.width - 2, Math.max(0, Math.floor(gridX)));
    const z0 = Math.min(def.depth - 2, Math.max(0, Math.floor(gridZ)));
    const localX = gridX - x0;
    const localZ = gridZ - z0;

    const topLeft = def.heights[z0 * def.width + x0] * def.scaleY;
    const topRight = def.heights[z0 * def.width + x0 + 1] * def.scaleY;
    const bottomLeft = def.heights[(z0 + 1) * def.width + x0] * def.scaleY;
    const bottomRight = def.heights[(z0 + 1) * def.width + x0 + 1] * def.scaleY;

    if (localX + localZ <= 1) {
        return topLeft + (topRight - topLeft) * localX + (bottomLeft - topLeft) * localZ;
    }

    const u = 1 - localX;
    const v = 1 - localZ;
    return bottomRight + (bottomLeft - bottomRight) * u + (topRight - bottomRight) * v;
}

/** Unit basis vectors used to derive a box's world-space face axes. */
const AXIS_X = { x: 1, y: 0, z: 0 };
const AXIS_Y = { x: 0, y: 1, z: 0 };
const AXIS_Z = { x: 0, y: 0, z: 1 };

const createShapeFrame = (): IShapeFrame3D => ({
    bodyPosition: { x: 0, y: 0, z: 0 },
    bodyRotation: { x: 0, y: 0, z: 0, w: 1 },
    center: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0, w: 1 },
    axes: [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }],
    generation: -1,
});

/**
 * Refreshes the per-step transform frame of a box shape, writing into objects
 * that are allocated once per shape.
 *
 * Every expression matches the allocating helpers the narrowphase used to call
 * directly: `transformPoint3D` is `Vec3.add(Quat.rotateVector(...), position)`
 * and the world rotation is `Quat.multiply(bodyRotation, shapeRotation)`. Only
 * box shapes carry a frame; other kinds return null and keep their existing
 * computation.
 */
export function refreshShapeFrame(
    descriptor: IShapeDescriptor3D,
    position: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>,
    generation: number
): IShapeFrame3D | null {
    if (!isBoxDef(descriptor.def)) {
        return null;
    }
    const def = descriptor.def;

    let frame = descriptor.frame;
    if (!frame) {
        frame = createShapeFrame();
        descriptor.frame = frame;
    }

    frame.bodyPosition.x = position.x;
    frame.bodyPosition.y = position.y;
    frame.bodyPosition.z = position.z;
    frame.bodyRotation.x = rotation.x;
    frame.bodyRotation.y = rotation.y;
    frame.bodyRotation.z = rotation.z;
    frame.bodyRotation.w = rotation.w;

    // center = transformPoint3D(def.center, position, rotation)
    Quat.rotateVector(rotation, def.center, frame.center);
    frame.center.x += position.x;
    frame.center.y += position.y;
    frame.center.z += position.z;

    Quat.multiply(rotation, def.rotation ?? IDENTITY_ROTATION, frame.rotation);

    Quat.rotateVector(frame.rotation, AXIS_X, frame.axes[0]);
    Quat.rotateVector(frame.rotation, AXIS_Y, frame.axes[1]);
    Quat.rotateVector(frame.rotation, AXIS_Z, frame.axes[2]);

    frame.generation = generation;
    return frame;
}

/**
 * Returns the current-step frame for a shape, refreshing it when the broadphase
 * pass has not filled it yet. Returns null for shape kinds without a frame.
 */
export function resolveShapeFrame(
    descriptor: IShapeDescriptor3D,
    bodyManager: {
        getPosition(bodyId: BodyId3D): IVec3Like;
        getRotation(bodyId: BodyId3D): IQuatLike;
    },
    generation: number
): IShapeFrame3D | null {
    const existing = descriptor.frame;
    if (existing && existing.generation === generation) {
        return existing;
    }
    return refreshShapeFrame(
        descriptor,
        bodyManager.getPosition(descriptor.bodyId),
        bodyManager.getRotation(descriptor.bodyId),
        generation
    );
}

/**
 * Computes the world-space AABB for a shape descriptor given its body transform.
 *
 * `frame` is the already-refreshed transform frame for this step: the box branch
 * reuses its centre and world rotation instead of recomputing them, so a box
 * shape pays for that derivation once per step rather than once per consumer.
 */
export function computeShapeAabb(
    descriptor: IShapeDescriptor3D,
    position: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>,
    frame?: IShapeFrame3D | null
): IAabb3D {
    switch (descriptor.def.kind) {
        case SHAPE_TYPE_SPHERE: {
            const center = transformPoint3D(descriptor.def.center, position, rotation);
            const radius = descriptor.def.radius;
            return {
                min: { x: center.x - radius, y: center.y - radius, z: center.z - radius },
                max: { x: center.x + radius, y: center.y + radius, z: center.z + radius },
            };
        }
        case SHAPE_TYPE_BOX: {
            const center = frame
                ? frame.center
                : transformPoint3D(descriptor.def.center, position, rotation);
            const worldRotation = frame
                ? frame.rotation
                : Quat.multiply(rotation, descriptor.def.rotation ?? IDENTITY_ROTATION);
            const extents = getBoxWorldExtents(descriptor.def.halfExtents, worldRotation);
            return {
                min: Vec3.subtract(center, extents),
                max: Vec3.add(center, extents),
            };
        }
        case SHAPE_TYPE_CAPSULE: {
            const p1 = transformPoint3D(descriptor.def.p1, position, rotation);
            const p2 = transformPoint3D(descriptor.def.p2, position, rotation);
            const radius = descriptor.def.radius;
            return {
                min: {
                    x: Math.min(p1.x, p2.x) - radius,
                    y: Math.min(p1.y, p2.y) - radius,
                    z: Math.min(p1.z, p2.z) - radius,
                },
                max: {
                    x: Math.max(p1.x, p2.x) + radius,
                    y: Math.max(p1.y, p2.y) + radius,
                    z: Math.max(p1.z, p2.z) + radius,
                },
            };
        }
        case SHAPE_TYPE_CYLINDER: {
            const center = transformPoint3D(descriptor.def.center, position, rotation);
            const axis = descriptor.def.axis ?? 1;
            const localHalfExtents = cylinderConeLocalHalfExtents(axis, descriptor.def.radius, descriptor.def.height);
            const extents = getBoxWorldExtents(localHalfExtents, rotation);
            return {
                min: Vec3.subtract(center, extents),
                max: Vec3.add(center, extents),
            };
        }
        case SHAPE_TYPE_CONE: {
            const center = transformPoint3D(descriptor.def.center, position, rotation);
            const axis = descriptor.def.axis ?? 1;
            const localHalfExtents = cylinderConeLocalHalfExtents(axis, descriptor.def.radius, descriptor.def.height);
            const extents = getBoxWorldExtents(localHalfExtents, rotation);
            return {
                min: Vec3.subtract(center, extents),
                max: Vec3.add(center, extents),
            };
        }
        case SHAPE_TYPE_CONVEX_HULL:
        case SHAPE_TYPE_TRIANGLE_MESH: {
            let bounds: IAabb3D | null = null;
            for (const vertex of descriptor.def.vertices) {
                const worldVertex = transformPoint3D(vertex, position, rotation);
                bounds = bounds
                    ? expandAabb(bounds, worldVertex)
                    : { min: Vec3.copy(worldVertex), max: Vec3.copy(worldVertex) };
            }
            return bounds ?? { min: Vec3.copy(position), max: Vec3.copy(position) };
        }
        case SHAPE_TYPE_HEIGHTFIELD: {
            const localBounds = computeLocalHeightFieldBounds(descriptor.def);
            const corners: readonly IVec3Like[] = [
                { x: localBounds.min.x, y: localBounds.min.y, z: localBounds.min.z },
                { x: localBounds.min.x, y: localBounds.min.y, z: localBounds.max.z },
                { x: localBounds.min.x, y: localBounds.max.y, z: localBounds.min.z },
                { x: localBounds.min.x, y: localBounds.max.y, z: localBounds.max.z },
                { x: localBounds.max.x, y: localBounds.min.y, z: localBounds.min.z },
                { x: localBounds.max.x, y: localBounds.min.y, z: localBounds.max.z },
                { x: localBounds.max.x, y: localBounds.max.y, z: localBounds.min.z },
                { x: localBounds.max.x, y: localBounds.max.y, z: localBounds.max.z },
            ];
            let bounds: IAabb3D | null = null;
            for (const corner of corners) {
                const worldCorner = transformPoint3D(corner, position, rotation);
                bounds = bounds
                    ? expandAabb(bounds, worldCorner)
                    : { min: Vec3.copy(worldCorner), max: Vec3.copy(worldCorner) };
            }
            return bounds ?? { min: Vec3.copy(position), max: Vec3.copy(position) };
        }
        default:
            return { min: Vec3.copy(position), max: Vec3.copy(position) };
    }
}

/**
 * Tests whether a world-space point is inside a shape.
 */
export function testPointShape(
    descriptor: IShapeDescriptor3D,
    point: Readonly<IVec3Like>,
    position: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>
): boolean {
    switch (descriptor.def.kind) {
        case SHAPE_TYPE_SPHERE: {
            const center = transformPoint3D(descriptor.def.center, position, rotation);
            return Vec3.lengthSquared(Vec3.subtract(point, center)) <= descriptor.def.radius ** 2;
        }
        case SHAPE_TYPE_BOX: {
            const bodyLocal = inverseTransformPoint3D(point, position, rotation);
            const centered = Vec3.subtract(bodyLocal, descriptor.def.center);
            const localRotation = descriptor.def.rotation ?? IDENTITY_ROTATION;
            const localPoint = Quat.rotateVector(Quat.conjugate(localRotation), centered);
            return (
                Math.abs(localPoint.x) <= descriptor.def.halfExtents.x &&
                Math.abs(localPoint.y) <= descriptor.def.halfExtents.y &&
                Math.abs(localPoint.z) <= descriptor.def.halfExtents.z
            );
        }
        case SHAPE_TYPE_CAPSULE: {
            const localPoint = inverseTransformPoint3D(point, position, rotation);
            return (
                linePointDistanceSquared(localPoint, descriptor.def.p1, descriptor.def.p2) <=
                descriptor.def.radius ** 2
            );
        }
        case SHAPE_TYPE_CYLINDER: {
            const localPoint = inverseTransformPoint3D(point, position, rotation);
            const centered = Vec3.subtract(localPoint, descriptor.def.center);
            const axis = descriptor.def.axis ?? 1;
            const halfHeight = descriptor.def.height * 0.5;
            if (axis === 0) {
                return (
                    Math.abs(centered.x) <= halfHeight &&
                    centered.y * centered.y + centered.z * centered.z <= descriptor.def.radius ** 2
                );
            }
            if (axis === 2) {
                return (
                    Math.abs(centered.z) <= halfHeight &&
                    centered.x * centered.x + centered.y * centered.y <= descriptor.def.radius ** 2
                );
            }
            return (
                Math.abs(centered.y) <= halfHeight &&
                centered.x * centered.x + centered.z * centered.z <= descriptor.def.radius ** 2
            );
        }
        case SHAPE_TYPE_CONE: {
            const localPoint = inverseTransformPoint3D(point, position, rotation);
            const centered = Vec3.subtract(localPoint, descriptor.def.center);
            const axis = descriptor.def.axis ?? 1;
            const halfHeight = descriptor.def.height * 0.5;
            const axial = axis === 0 ? centered.x : axis === 2 ? centered.z : centered.y;
            if (axial < -halfHeight || axial > halfHeight) {
                return false;
            }
            const normalizedHeight = (axial + halfHeight) / descriptor.def.height;
            const allowedRadius = descriptor.def.radius * (1 - normalizedHeight);
            const radialSquared =
                axis === 0
                    ? centered.y * centered.y + centered.z * centered.z
                    : axis === 2
                      ? centered.x * centered.x + centered.y * centered.y
                      : centered.x * centered.x + centered.z * centered.z;
            return radialSquared <= allowedRadius * allowedRadius;
        }
        case SHAPE_TYPE_CONVEX_HULL: {
            const localPoint = inverseTransformPoint3D(point, position, rotation);
            const bounds = computeLocalConvexBounds(descriptor.def.vertices);
            return (
                localPoint.x >= bounds.min.x &&
                localPoint.x <= bounds.max.x &&
                localPoint.y >= bounds.min.y &&
                localPoint.y <= bounds.max.y &&
                localPoint.z >= bounds.min.z &&
                localPoint.z <= bounds.max.z
            );
        }
        case SHAPE_TYPE_TRIANGLE_MESH: {
            const localPoint = inverseTransformPoint3D(point, position, rotation);
            const bounds = computeLocalConvexBounds(descriptor.def.vertices);
            if (
                localPoint.x < bounds.min.x ||
                localPoint.x > bounds.max.x ||
                localPoint.y < bounds.min.y ||
                localPoint.y > bounds.max.y ||
                localPoint.z < bounds.min.z ||
                localPoint.z > bounds.max.z
            ) {
                return false;
            }

            let hitCount = 0;
            const localDirection = { x: 1, y: 0, z: 0 };
            for (let index = 0; index + 2 < descriptor.def.indices.length; index += 3) {
                const a = descriptor.def.vertices[descriptor.def.indices[index]];
                const b = descriptor.def.vertices[descriptor.def.indices[index + 1]];
                const c = descriptor.def.vertices[descriptor.def.indices[index + 2]];
                const hit = rayTriangleHit(
                    localPoint,
                    localDirection,
                    a,
                    b,
                    c,
                    Number.POSITIVE_INFINITY
                );
                if (hit && hit.fraction <= 1e-6) {
                    return true;
                }
                if (hit) {
                    hitCount += 1;
                }
            }

            return (hitCount & 1) === 1;
        }
        case SHAPE_TYPE_HEIGHTFIELD: {
            const localPoint = inverseTransformPoint3D(point, position, rotation);
            const sampledHeight = sampleHeightFieldHeight(descriptor.def, localPoint.x, localPoint.z);
            return sampledHeight !== null && localPoint.y <= sampledHeight + 1e-4;
        }
        default:
            return false;
    }
}

/**
 * Raycasts against a single shape, returning the closest hit or null.
 */
export function rayCastShape(
    descriptor: IShapeDescriptor3D,
    origin: Readonly<IVec3Like>,
    direction: Readonly<IVec3Like>,
    maxFraction: number,
    position: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>
): IShapeRayHit3D | null {
    switch (descriptor.def.kind) {
        case SHAPE_TYPE_SPHERE: {
            const center = transformPoint3D(descriptor.def.center, position, rotation);
            return raySphereHit(origin, direction, center, descriptor.def.radius, maxFraction);
        }
        case SHAPE_TYPE_BOX: {
            const worldRotation = Quat.multiply(rotation, descriptor.def.rotation ?? IDENTITY_ROTATION);
            const center = transformPoint3D(descriptor.def.center, position, rotation);
            const localOrigin = inverseTransformPoint3D(origin, center, worldRotation);
            const localDirection = Quat.rotateVector(Quat.conjugate(worldRotation), direction);
            const hit = rayAabbHit(
                localOrigin,
                localDirection,
                Vec3.multiplyScalar(descriptor.def.halfExtents, -1),
                descriptor.def.halfExtents,
                maxFraction
            );
            if (!hit) {
                return null;
            }
            return { fraction: hit.fraction, normal: Quat.rotateVector(worldRotation, hit.normal) };
        }
        case SHAPE_TYPE_TRIANGLE_MESH: {
            let closestHit: IShapeRayHit3D | null = null;
            for (let index = 0; index + 2 < descriptor.def.indices.length; index += 3) {
                const a = transformPoint3D(
                    descriptor.def.vertices[descriptor.def.indices[index]],
                    position,
                    rotation
                );
                const b = transformPoint3D(
                    descriptor.def.vertices[descriptor.def.indices[index + 1]],
                    position,
                    rotation
                );
                const c = transformPoint3D(
                    descriptor.def.vertices[descriptor.def.indices[index + 2]],
                    position,
                    rotation
                );
                const hit = rayTriangleHit(origin, direction, a, b, c, maxFraction);
                if (!hit || (closestHit && hit.fraction >= closestHit.fraction)) {
                    continue;
                }
                closestHit = hit;
            }
            return closestHit;
        }
        case SHAPE_TYPE_HEIGHTFIELD: {
            let closestHit: IShapeRayHit3D | null = null;
            for (let zIndex = 0; zIndex < descriptor.def.depth - 1; zIndex += 1) {
                for (let xIndex = 0; xIndex < descriptor.def.width - 1; xIndex += 1) {
                    const topLeft = transformPoint3D(
                        getHeightFieldLocalVertex(descriptor.def, xIndex, zIndex),
                        position,
                        rotation
                    );
                    const topRight = transformPoint3D(
                        getHeightFieldLocalVertex(descriptor.def, xIndex + 1, zIndex),
                        position,
                        rotation
                    );
                    const bottomLeft = transformPoint3D(
                        getHeightFieldLocalVertex(descriptor.def, xIndex, zIndex + 1),
                        position,
                        rotation
                    );
                    const bottomRight = transformPoint3D(
                        getHeightFieldLocalVertex(descriptor.def, xIndex + 1, zIndex + 1),
                        position,
                        rotation
                    );

                    const firstHit = rayTriangleHit(
                        origin,
                        direction,
                        topLeft,
                        topRight,
                        bottomLeft,
                        maxFraction
                    );
                    if (firstHit && (!closestHit || firstHit.fraction < closestHit.fraction)) {
                        closestHit = firstHit;
                    }

                    const secondHit = rayTriangleHit(
                        origin,
                        direction,
                        bottomLeft,
                        topRight,
                        bottomRight,
                        maxFraction
                    );
                    if (secondHit && (!closestHit || secondHit.fraction < closestHit.fraction)) {
                        closestHit = secondHit;
                    }
                }
            }
            return closestHit;
        }
        default: {
            const aabb = computeShapeAabb(descriptor, position, rotation);
            const hit = rayAabbHit(origin, direction, aabb.min, aabb.max, maxFraction);
            return hit ? { fraction: hit.fraction, normal: hit.normal } : null;
        }
    }
}

/**
 * Computes the world-space center of a shape.
 */
export function getShapeWorldCenter(
    descriptor: IShapeDescriptor3D,
    position: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>
): IVec3Like {
    switch (descriptor.def.kind) {
        case SHAPE_TYPE_SPHERE:
        case SHAPE_TYPE_BOX:
        case SHAPE_TYPE_CYLINDER:
        case SHAPE_TYPE_CONE:
            return transformPoint3D(descriptor.def.center, position, rotation);
        case SHAPE_TYPE_CAPSULE:
            return transformPoint3D(midpointVec3(descriptor.def.p1, descriptor.def.p2), position, rotation);
        case SHAPE_TYPE_CONVEX_HULL: {
            const bounds = computeLocalConvexBounds(descriptor.def.vertices);
            return transformPoint3D(midpointVec3(bounds.min, bounds.max), position, rotation);
        }
        case SHAPE_TYPE_TRIANGLE_MESH: {
            const bounds = computeLocalConvexBounds(descriptor.def.vertices);
            return transformPoint3D(midpointVec3(bounds.min, bounds.max), position, rotation);
        }
        case SHAPE_TYPE_HEIGHTFIELD: {
            const bounds = computeLocalHeightFieldBounds(descriptor.def);
            return transformPoint3D(midpointVec3(bounds.min, bounds.max), position, rotation);
        }
        default:
            return Vec3.copy(position);
    }
}

