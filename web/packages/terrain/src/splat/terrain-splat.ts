import { TerrainError, TerrainErrorCode } from '../errors';
import type {
    ResolvedTerrainBrushOptions,
    TerrainDescriptor,
    TerrainSplatResolution,
} from '../types';
import {
    TERRAIN_MAX_LAYERS,
    TERRAIN_SPLAT_STAMP_SCALE,
    isTerrainSplatResolution,
    validateTerrainDescriptor,
} from '../types';
import { smoothstep } from '../internal/math';

/**
 * Splat weight buffers: RGBA texels where each channel carries one layer's
 * blend weight. The invariant is that channel weights sum to 255 on every
 * texel, so the shader can renormalize cheaply and painting stays lossless
 * under repeated stamps.
 */
const WEIGHT_TOTAL = 255;

const assertSplatResolution = (resolution: number): void => {
    if (!isTerrainSplatResolution(resolution)) {
        throw new TerrainError(
            `Invalid splat resolution: ${resolution}.`,
            TerrainErrorCode.INVALID_RESOLUTION,
            { resolution }
        );
    }
};

const assertSplatBuffer = (splat: Uint8Array, resolution: TerrainSplatResolution): void => {
    if (splat.length !== resolution * resolution * 4) {
        throw new TerrainError(
            `Splat buffer length ${splat.length} does not match resolution ${resolution} (expected ${resolution * resolution * 4}).`,
            TerrainErrorCode.SPLAT_SIZE_MISMATCH,
            { resolution, expectedLength: resolution * resolution * 4, actualLength: splat.length }
        );
    }
};

/** Creates an RGBA weight buffer fully assigned to the first layer. */
export const createTerrainSplatBuffer = (resolution: TerrainSplatResolution): Uint8Array => {
    assertSplatResolution(resolution);

    const splat = new Uint8Array(resolution * resolution * 4);
    for (let index = 0; index < splat.length; index += 4) {
        splat[index] = WEIGHT_TOTAL;
    }

    return splat;
};

export interface TerrainSplatBrushStamp {
    readonly splat: Uint8Array;
    readonly resolution: TerrainSplatResolution;
    readonly descriptor: TerrainDescriptor;
    readonly brush: ResolvedTerrainBrushOptions;
    /** Target layer channel (0..3). */
    readonly layerIndex: number;
    readonly localX: number;
    readonly localZ: number;
}

/**
 * Paints one brush stamp of the target layer into the weight buffer in
 * place, renormalizing the remaining channels so every texel keeps the
 * 255-total invariant. Returns `true` when at least one texel changed.
 */
export const applyTerrainSplatBrushStamp = ({
    splat,
    resolution,
    descriptor,
    brush,
    layerIndex,
    localX,
    localZ,
}: TerrainSplatBrushStamp): boolean => {
    validateTerrainDescriptor(descriptor);
    assertSplatResolution(resolution);
    assertSplatBuffer(splat, resolution);

    if (!Number.isInteger(layerIndex) || layerIndex < 0 || layerIndex >= TERRAIN_MAX_LAYERS) {
        throw new TerrainError(
            `Invalid splat layer index: ${layerIndex}. Expected an integer in [0, ${TERRAIN_MAX_LAYERS - 1}].`,
            TerrainErrorCode.VALIDATION_FAILED,
            { layerIndex }
        );
    }

    const lastTexel = resolution - 1;
    const texelSizeX = descriptor.width / lastTexel;
    const texelSizeZ = descriptor.length / lastTexel;

    const texelCenterX = (localX + descriptor.width * 0.5) / texelSizeX;
    const texelCenterZ = (localZ + descriptor.length * 0.5) / texelSizeZ;
    const texelRadiusX = brush.radius / texelSizeX;
    const texelRadiusZ = brush.radius / texelSizeZ;

    const minX = Math.max(0, Math.floor(texelCenterX - texelRadiusX));
    const maxX = Math.min(lastTexel, Math.ceil(texelCenterX + texelRadiusX));
    const minZ = Math.max(0, Math.floor(texelCenterZ - texelRadiusZ));
    const maxZ = Math.min(lastTexel, Math.ceil(texelCenterZ + texelRadiusZ));
    if (minX > maxX || minZ > maxZ) {
        return false;
    }

    let changed = false;

    for (let texelZ = minZ; texelZ <= maxZ; texelZ += 1) {
        for (let texelX = minX; texelX <= maxX; texelX += 1) {
            const worldDx = (texelX - texelCenterX) * texelSizeX;
            const worldDz = (texelZ - texelCenterZ) * texelSizeZ;
            const distance = Math.sqrt(worldDx * worldDx + worldDz * worldDz);
            if (distance > brush.radius) {
                continue;
            }

            const weight = Math.pow(smoothstep(1 - distance / brush.radius), brush.falloff);
            if (weight <= 0) {
                continue;
            }

            const offset = (texelZ * resolution + texelX) * 4;
            const current = splat[offset + layerIndex]!;
            // Strength 1 at full weight approaches target by TERRAIN_SPLAT_STAMP_SCALE per stamp.
            const target = Math.min(
                WEIGHT_TOTAL,
                Math.round(current + (WEIGHT_TOTAL - current) * brush.strength * weight * TERRAIN_SPLAT_STAMP_SCALE)
            );
            if (target === current) {
                continue;
            }

            splat[offset + layerIndex] = target;
            const remaining = WEIGHT_TOTAL - target;
            const othersTotal = WEIGHT_TOTAL - current;

            let distributed = 0;
            let lastOtherChannel = -1;
            for (let channel = 0; channel < 4; channel += 1) {
                if (channel === layerIndex) {
                    continue;
                }
                lastOtherChannel = channel;
                const value = splat[offset + channel]!;
                const scaled =
                    othersTotal > 0
                        ? Math.round((value / othersTotal) * remaining)
                        : channel === (layerIndex + 1) % 4
                          ? remaining
                          : 0;
                splat[offset + channel] = scaled;
                distributed += scaled;
            }

            // Absorb rounding remainder into the last other channel.
            const remainder = remaining - distributed;
            if (remainder !== 0 && lastOtherChannel >= 0) {
                splat[offset + lastOtherChannel] = Math.max(
                    0,
                    splat[offset + lastOtherChannel]! + remainder
                );
            }

            changed = true;
        }
    }

    return changed;
};

/** Bilinear weight sample at normalized [0, 1] coordinates (per channel). */
export const sampleTerrainSplatWeights = (
    splat: Uint8Array,
    resolution: TerrainSplatResolution,
    u: number,
    v: number
): [number, number, number, number] => {
    assertSplatResolution(resolution);
    assertSplatBuffer(splat, resolution);

    const clampedU = u < 0 ? 0 : u > 1 ? 1 : u;
    const clampedV = v < 0 ? 0 : v > 1 ? 1 : v;
    const texelX = clampedU * (resolution - 1);
    const texelZ = clampedV * (resolution - 1);
    const x0 = Math.floor(texelX);
    const z0 = Math.floor(texelZ);
    const x1 = Math.min(x0 + 1, resolution - 1);
    const z1 = Math.min(z0 + 1, resolution - 1);
    const tx = texelX - x0;
    const tz = texelZ - z0;

    const weights: [number, number, number, number] = [0, 0, 0, 0];
    for (let channel = 0; channel < 4; channel += 1) {
        const topLeft = splat[(z0 * resolution + x0) * 4 + channel]!;
        const topRight = splat[(z0 * resolution + x1) * 4 + channel]!;
        const bottomLeft = splat[(z1 * resolution + x0) * 4 + channel]!;
        const bottomRight = splat[(z1 * resolution + x1) * 4 + channel]!;
        const top = topLeft + (topRight - topLeft) * tx;
        const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
        weights[channel] = (top + (bottom - top) * tz) / WEIGHT_TOTAL;
    }

    return weights;
};
