import { clamp01 } from '@axrone/numeric';
import { TerrainError, TerrainErrorCode } from '../errors';
import type {
    ResolvedTerrainBrushOptions,
    TerrainDescriptor,
} from '../types';
import { validateTerrainDescriptor, TERRAIN_BRUSH_HEIGHT_STAMP_SCALE } from '../types';
import { smoothstep } from '../internal/math';

/**
 * Working-buffer brush stamp. Sculpt sessions hold a mutable copy of the
 * heightmap; each pointer step applies one stamp in place, and the session is
 * committed back into an immutable `TerrainHeightmap` when the drag ends.
 *
 * `localX`/`localZ` are terrain-local coordinates on the origin-centered
 * grid — the same space produced by `raycastTerrainHeightmap`.
 */
export interface TerrainBrushStamp {
    readonly heights: Float32Array;
    readonly descriptor: TerrainDescriptor;
    readonly brush: ResolvedTerrainBrushOptions;
    readonly localX: number;
    readonly localZ: number;
}

/**
 * Applies a single brush stamp in place. Returns `true` when at least one
 * height sample changed, so callers can skip redundant mesh rebuilds.
 */
export const applyTerrainBrushStamp = ({
    heights,
    descriptor,
    brush,
    localX,
    localZ,
}: TerrainBrushStamp): boolean => {
    validateTerrainDescriptor(descriptor);

    const resolution = descriptor.resolution;
    if (heights.length !== resolution * resolution) {
        throw new TerrainError(
            `Working buffer length ${heights.length} does not match resolution ${resolution}.`,
            TerrainErrorCode.HEIGHTMAP_SIZE_MISMATCH,
            { resolution, actualLength: heights.length }
        );
    }

    const lastIndex = resolution - 1;
    const stepX = descriptor.width / lastIndex;
    const stepZ = descriptor.length / lastIndex;

    // Local space -> grid space (origin-centered grid).
    const gridCenterX = (localX + descriptor.width * 0.5) / stepX;
    const gridCenterZ = (localZ + descriptor.length * 0.5) / stepZ;
    const gridRadiusX = brush.radius / stepX;
    const gridRadiusZ = brush.radius / stepZ;

    const minX = Math.max(0, Math.floor(gridCenterX - gridRadiusX));
    const maxX = Math.min(lastIndex, Math.ceil(gridCenterX + gridRadiusX));
    const minZ = Math.max(0, Math.floor(gridCenterZ - gridRadiusZ));
    const maxZ = Math.min(lastIndex, Math.ceil(gridCenterZ + gridRadiusZ));
    if (minX > maxX || minZ > maxZ) {
        return false;
    }

    // Normalized step magnitude: strength 1 moves a sample by TERRAIN_BRUSH_HEIGHT_STAMP_SCALE
    // of the full height range per stamp, keeping drags controllable.
    const stampDelta = brush.strength * TERRAIN_BRUSH_HEIGHT_STAMP_SCALE;
    let changed = false;

    // Flatten/smooth reference values are derived from the pre-stamp buffer.
    let flattenTarget = brush.flattenTarget;
    if (brush.kind === 'flatten') {
        const sampleX = Math.round(Math.min(Math.max(gridCenterX, 0), lastIndex));
        const sampleZ = Math.round(Math.min(Math.max(gridCenterZ, 0), lastIndex));
        flattenTarget = heights[sampleZ * resolution + sampleX]!;
    }

    // For smooth brush, snapshot only the region we'll read (expanded AABB for 3×3 neighborhoods).
    let source: Float32Array;
    let sourceOffsetX = 0;
    let sourceOffsetZ = 0;
    let sourceWidth = 0;

    if (brush.kind === 'smooth') {
        const snapMinX = Math.max(0, minX - 1);
        const snapMaxX = Math.min(lastIndex, maxX + 1);
        const snapMinZ = Math.max(0, minZ - 1);
        const snapMaxZ = Math.min(lastIndex, maxZ + 1);
        sourceWidth = snapMaxX - snapMinX + 1;
        const sourceHeight = snapMaxZ - snapMinZ + 1;
        source = new Float32Array(sourceWidth * sourceHeight);
        sourceOffsetX = snapMinX;
        sourceOffsetZ = snapMinZ;

        for (let z = snapMinZ; z <= snapMaxZ; z += 1) {
            const srcRow = z * resolution + snapMinX;
            const dstRow = (z - snapMinZ) * sourceWidth;
            for (let x = 0; x < sourceWidth; x += 1) {
                source[dstRow + x] = heights[srcRow + x]!;
            }
        }
    } else {
        source = heights;
    }

    for (let gridZ = minZ; gridZ <= maxZ; gridZ += 1) {
        for (let gridX = minX; gridX <= maxX; gridX += 1) {
            const worldDx = (gridX - gridCenterX) * stepX;
            const worldDz = (gridZ - gridCenterZ) * stepZ;
            const distance = Math.sqrt(worldDx * worldDx + worldDz * worldDz);
            if (distance > brush.radius) {
                continue;
            }

            const weight = Math.pow(
                smoothstep(1 - distance / brush.radius),
                brush.falloff
            );
            if (weight <= 0) {
                continue;
            }

            const index = gridZ * resolution + gridX;
            const current = heights[index]!;
            let next = current;

            switch (brush.kind) {
                case 'raise':
                    next = current + stampDelta * weight;
                    break;
                case 'lower':
                    next = current - stampDelta * weight;
                    break;
                case 'flatten':
                    next = current + (flattenTarget - current) * brush.strength * weight;
                    break;
                case 'smooth': {
                    let total = 0;
                    let count = 0;
                    for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
                        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
                            const neighborX = gridX + offsetX;
                            const neighborZ = gridZ + offsetZ;
                            if (
                                neighborX < 0 ||
                                neighborZ < 0 ||
                                neighborX > lastIndex ||
                                neighborZ > lastIndex
                            ) {
                                continue;
                            }

                            // Read from snapshot with adjusted coordinates.
                            const snapX = neighborX - sourceOffsetX;
                            const snapZ = neighborZ - sourceOffsetZ;
                            total += source[snapZ * sourceWidth + snapX]!;
                            count += 1;
                        }
                    }

                    const average = total / count;
                    next = current + (average - current) * brush.strength * weight;
                    break;
                }
            }

            next = clamp01(next);
            if (next !== current) {
                heights[index] = next;
                changed = true;
            }
        }
    }

    return changed;
};
