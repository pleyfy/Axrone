import type { TerrainDescriptor, TerrainRaycastHit } from '../types';
import { TERRAIN_RAYCAST_DEFAULT_MAX_DISTANCE, TERRAIN_RAYCAST_REFINE_STEPS, validateTerrainDescriptor } from '../types';
import type { TerrainHeightmap } from '../heightmap/terrain-heightmap';

export interface TerrainRay {
    readonly origin: { readonly x: number; readonly y: number; readonly z: number };
    readonly direction: { readonly x: number; readonly y: number; readonly z: number };
}

/** Compute t range where ray is inside the XZ footprint AABB. Returns null if no intersection. */
const rayFootprintSlab = (
    origin: { readonly x: number; readonly y: number; readonly z: number },
    direction: { readonly x: number; readonly y: number; readonly z: number },
    halfWidth: number,
    halfLength: number,
    maxDistance: number
): { tMin: number; tMax: number } | null => {
    let tMin = 0;
    let tMax = maxDistance;

    // X slab
    if (Math.abs(direction.x) < 1e-8) {
        if (origin.x < -halfWidth || origin.x > halfWidth) return null;
    } else {
        const t1 = (-halfWidth - origin.x) / direction.x;
        const t2 = (halfWidth - origin.x) / direction.x;
        const tNear = Math.min(t1, t2);
        const tFar = Math.max(t1, t2);
        tMin = Math.max(tMin, tNear);
        tMax = Math.min(tMax, tFar);
        if (tMin > tMax) return null;
    }

    // Z slab
    if (Math.abs(direction.z) < 1e-8) {
        if (origin.z < -halfLength || origin.z > halfLength) return null;
    } else {
        const t1 = (-halfLength - origin.z) / direction.z;
        const t2 = (halfLength - origin.z) / direction.z;
        const tNear = Math.min(t1, t2);
        const tFar = Math.max(t1, t2);
        tMin = Math.max(tMin, tNear);
        tMax = Math.min(tMax, tFar);
        if (tMin > tMax) return null;
    }

    return { tMin: Math.max(0, tMin), tMax };
};

/** Sample terrain height at world-space XZ coordinates. */
const heightAtWorld = (
    heightmap: TerrainHeightmap,
    descriptor: TerrainDescriptor,
    halfWidth: number,
    halfLength: number,
    x: number,
    z: number
): number =>
    heightmap.sampleHeight((x + halfWidth) / descriptor.width, (z + halfLength) / descriptor.length) *
    descriptor.maxHeight;

/** Is the ray at parameter t above the terrain surface? */
const isRayAboveTerrain = (
    heightmap: TerrainHeightmap,
    descriptor: TerrainDescriptor,
    halfWidth: number,
    halfLength: number,
    origin: { readonly x: number; readonly y: number; readonly z: number },
    direction: { readonly x: number; readonly y: number; readonly z: number },
    t: number
): boolean => {
    const x = origin.x + direction.x * t;
    const z = origin.z + direction.z * t;
    const y = origin.y + direction.y * t;
    return y > heightAtWorld(heightmap, descriptor, halfWidth, halfLength, x, z);
};

/**
 * Ray-marches a terrain heightmap in terrain-local space (origin-centered
 * grid, +Y up) and returns the first surface hit. Uses ray-AABB pre-cull
 * to skip marching when the ray is outside the terrain footprint, then
 * marches with a step derived from the grid cell size followed by bisection
 * refinement, which is robust for editor picking without needing a spatial structure.
 */
export const raycastTerrainHeightmap = (
    heightmap: TerrainHeightmap,
    descriptor: TerrainDescriptor,
    ray: TerrainRay,
    maxDistance: number = TERRAIN_RAYCAST_DEFAULT_MAX_DISTANCE
): TerrainRaycastHit | null => {
    validateTerrainDescriptor(descriptor);

    const halfWidth = descriptor.width * 0.5;
    const halfLength = descriptor.length * 0.5;
    const direction = normalize(ray.direction);
    if (!direction) {
        return null;
    }

    // Pre-cull: find t range where ray is inside terrain footprint.
    const slab = rayFootprintSlab(ray.origin, direction, halfWidth, halfLength, maxDistance);
    if (!slab) {
        return null;
    }

    // March with a step proportional to the smaller cell size; clamp so very
    // large terrains still resolve in bounded iterations.
    const cellSize = Math.min(
        descriptor.width / (descriptor.resolution - 1),
        descriptor.length / (descriptor.resolution - 1)
    );
    const step = Math.max(cellSize * 0.5, (slab.tMax - slab.tMin) / 4096);

    let previousT = slab.tMin;
    let previousAbove = isRayAboveTerrain(heightmap, descriptor, halfWidth, halfLength, ray.origin, direction, slab.tMin);

    for (let t = slab.tMin + step; t <= slab.tMax; t += step) {
        const above = isRayAboveTerrain(heightmap, descriptor, halfWidth, halfLength, ray.origin, direction, t);
        if (previousAbove && !above) {
            // Crossing found — bisect [previousT, t] down to the surface.
            let low = previousT;
            let high = t;
            for (let refine = 0; refine < TERRAIN_RAYCAST_REFINE_STEPS; refine += 1) {
                const middle = (low + high) * 0.5;
                if (isRayAboveTerrain(heightmap, descriptor, halfWidth, halfLength, ray.origin, direction, middle)) {
                    low = middle;
                } else {
                    high = middle;
                }
            }

            const hitT = (low + high) * 0.5;
            const hitX = ray.origin.x + direction.x * hitT;
            const hitZ = ray.origin.z + direction.z * hitT;

            const u = (hitX + halfWidth) / descriptor.width;
            const v = (hitZ + halfLength) / descriptor.length;
            return {
                point: {
                    x: hitX,
                    y: heightAtWorld(heightmap, descriptor, halfWidth, halfLength, hitX, hitZ),
                    z: hitZ,
                },
                u,
                v,
                distance: hitT,
            };
        }

        previousAbove = above;
        previousT = t;
    }

    return null;
};

const normalize = (direction: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}): { x: number; y: number; z: number } | null => {
    const magnitude = Math.sqrt(
        direction.x * direction.x + direction.y * direction.y + direction.z * direction.z
    );
    if (!Number.isFinite(magnitude) || magnitude <= 0) {
        return null;
    }

    return {
        x: direction.x / magnitude,
        y: direction.y / magnitude,
        z: direction.z / magnitude,
    };
};
