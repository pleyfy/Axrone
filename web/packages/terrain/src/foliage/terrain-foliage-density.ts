import { TerrainError, TerrainErrorCode } from '../errors';
import { encode as encodeBytesToBase64, decode as decodeBase64ToBytes } from '@axrone/utility';
import type {
    ResolvedTerrainBrushOptions,
    TerrainDescriptor,
    TerrainSplatResolution,
} from '../types';
import { TERRAIN_FOLIAGE_DENSITY_STAMP_SCALE, isTerrainSplatResolution, validateTerrainDescriptor } from '../types';
import { smoothstep } from '../internal/math';

/**
 * Foliage density maps: single-channel Uint8 buffers (one per foliage layer)
 * painted with the shared terrain brush. Density 255 means the layer's full
 * `density` multiplier applies at that texel; 0 means no instances. Reuses
 * the splat resolution set so paint and foliage tooling stay symmetric.
 */
const DENSITY_DATA_PREFIX = 'atfl1:';

const assertDensityResolution = (resolution: number): void => {
    if (!isTerrainSplatResolution(resolution)) {
        throw new TerrainError(
            `Invalid foliage density resolution: ${resolution}.`,
            TerrainErrorCode.INVALID_RESOLUTION,
            { resolution }
        );
    }
};

const assertDensityBuffer = (
    density: Uint8Array,
    resolution: TerrainSplatResolution
): void => {
    if (density.length !== resolution * resolution) {
        throw new TerrainError(
            `Density buffer length ${density.length} does not match resolution ${resolution} (expected ${resolution * resolution}).`,
            TerrainErrorCode.SPLAT_SIZE_MISMATCH,
            { resolution, expectedLength: resolution * resolution, actualLength: density.length }
        );
    }
};

/** Creates an empty (all-zero) density buffer. */
export const createTerrainFoliageDensityBuffer = (
    resolution: TerrainSplatResolution
): Uint8Array => {
    assertDensityResolution(resolution);
    return new Uint8Array(resolution * resolution);
};

export interface TerrainFoliageDensityStamp {
    readonly density: Uint8Array;
    readonly resolution: TerrainSplatResolution;
    readonly descriptor: TerrainDescriptor;
    readonly brush: ResolvedTerrainBrushOptions;
    /** Terrain-local stamp center. */
    readonly localX: number;
    readonly localZ: number;
    /** True removes density instead of adding it (eraser). */
    readonly erase?: boolean;
}

/**
 * Paints one density stamp in place. Returns `true` when at least one texel
 * changed, mirroring the sculpt/splat stamp contracts.
 */
export const applyTerrainFoliageDensityStamp = ({
    density,
    resolution,
    descriptor,
    brush,
    localX,
    localZ,
    erase = false,
}: TerrainFoliageDensityStamp): boolean => {
    validateTerrainDescriptor(descriptor);
    assertDensityResolution(resolution);
    assertDensityBuffer(density, resolution);

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

    // Strength 1 at full weight approaches target by TERRAIN_FOLIAGE_DENSITY_STAMP_SCALE per stamp.
    const stampScale = brush.strength * TERRAIN_FOLIAGE_DENSITY_STAMP_SCALE;
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

            const index = texelZ * resolution + texelX;
            const current = density[index]!;
            const target = erase
                ? Math.max(0, Math.round(current - 255 * stampScale * weight))
                : Math.min(255, Math.round(current + (255 - current) * stampScale * weight));
            if (target !== current) {
                density[index] = target;
                changed = true;
            }
        }
    }

    return changed;
};

/** Bilinear density sample at normalized [0, 1] coordinates → [0, 1]. */
export const sampleTerrainFoliageDensity = (
    density: Uint8Array,
    resolution: TerrainSplatResolution,
    u: number,
    v: number
): number => {
    assertDensityResolution(resolution);
    assertDensityBuffer(density, resolution);

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

    const topLeft = density[z0 * resolution + x0]!;
    const topRight = density[z0 * resolution + x1]!;
    const bottomLeft = density[z1 * resolution + x0]!;
    const bottomRight = density[z1 * resolution + x1]!;
    const top = topLeft + (topRight - topLeft) * tx;
    const bottom = bottomLeft + (bottomRight - bottomLeft) * tx;
    return (top + (bottom - top) * tz) / 255;
};

/** Serializes a density buffer into a versioned base64 payload. */
export const encodeTerrainFoliageDensity = (density: Readonly<Uint8Array>): string =>
    `${DENSITY_DATA_PREFIX}${encodeBytesToBase64(density as Uint8Array)}`;

/** Parses a payload produced by {@link encodeTerrainFoliageDensity}. */
export const decodeTerrainFoliageDensity = (
    value: string,
    resolution: TerrainSplatResolution
): Uint8Array => {
    assertDensityResolution(resolution);

    if (!value.startsWith(DENSITY_DATA_PREFIX)) {
        throw new TerrainError(
            'Foliage density payload is missing the expected version prefix.',
            TerrainErrorCode.SOURCE_DECODE_FAILED,
            { prefix: value.slice(0, 8) }
        );
    }

    let bytes: Uint8Array;
    try {
        bytes = decodeBase64ToBytes(value.slice(DENSITY_DATA_PREFIX.length));
    } catch {
        throw new TerrainError(
            'Payload contains an invalid base64 character.',
            TerrainErrorCode.SOURCE_DECODE_FAILED,
        );
    }
    if (bytes.length !== resolution * resolution) {
        throw new TerrainError(
            `Foliage density payload length ${bytes.length} does not match resolution ${resolution} (expected ${resolution * resolution} bytes).`,
            TerrainErrorCode.SPLAT_SIZE_MISMATCH,
            { resolution, expectedBytes: resolution * resolution, actualBytes: bytes.length }
        );
    }

    return bytes;
};

/** Cheap shape check usable by editors before attempting a full decode. */
export const isTerrainFoliageDensityPayload = (value: unknown): value is string =>
    typeof value === 'string' && value.startsWith(DENSITY_DATA_PREFIX);
