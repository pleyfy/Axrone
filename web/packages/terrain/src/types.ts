import { TerrainError, TerrainErrorCode } from './errors';

/** Supported vertex-grid resolutions per terrain side (power-of-two + 1). */
export const TERRAIN_RESOLUTIONS = [33, 65, 129, 257] as const;

export type TerrainResolution = (typeof TERRAIN_RESOLUTIONS)[number];

export const isTerrainResolution = (value: number): value is TerrainResolution =>
    (TERRAIN_RESOLUTIONS as readonly number[]).includes(value);

export type TerrainSourceKind = 'flat' | 'noise' | 'heightmap' | 'sculpted';

/** Maximum simultaneous splat layers (one per RGBA channel). */
export const TERRAIN_MAX_LAYERS = 4;

/** Supported per-side splat weight-map resolutions. */
export const TERRAIN_SPLAT_RESOLUTIONS = [64, 128, 256] as const;

export type TerrainSplatResolution = (typeof TERRAIN_SPLAT_RESOLUTIONS)[number];

export const isTerrainSplatResolution = (value: number): value is TerrainSplatResolution =>
    (TERRAIN_SPLAT_RESOLUTIONS as readonly number[]).includes(value);

export interface TerrainLayer {
    readonly id: string;
    readonly name: string;
    /** Project-relative albedo texture path (empty until assigned). */
    readonly textureAsset: string;
    /** World-space tiling repeat across the terrain footprint. */
    readonly tiling: number;
}

/** Maximum simultaneous foliage layers per terrain. */
export const TERRAIN_MAX_FOLIAGE_LAYERS = 4;

export interface TerrainFoliageLayer {
    readonly id: string;
    readonly name: string;
    /** Project-relative mesh asset path (empty = built-in cross-quad card). */
    readonly meshAsset: string;
    /** Global density multiplier in [0, 1] applied on top of the painted map. */
    readonly density: number;
    readonly minScale: number;
    readonly maxScale: number;
    /** Tilt instances toward the surface normal instead of world up. */
    readonly alignToNormal: boolean;
    /** Instances are skipped on slopes steeper than this (degrees). */
    readonly maxSlopeDeg: number;
}

export interface TerrainFoliageInstance {
    /** Terrain-local position on the origin-centered grid. */
    readonly x: number;
    readonly y: number;
    readonly z: number;
    /** Yaw rotation in radians. */
    readonly rotationY: number;
    readonly scale: number;
}

export interface TerrainDescriptor {
    /** World-space size along the X axis. */
    readonly width: number;
    /** World-space size along the Z axis. */
    readonly length: number;
    /** World-space height applied to a normalized height of 1. */
    readonly maxHeight: number;
    /** Vertex count per side of the height grid. */
    readonly resolution: TerrainResolution;
}

export interface TerrainNoiseOptions {
    readonly seed?: number;
    readonly frequency?: number;
    readonly octaves?: number;
    readonly persistence?: number;
    readonly lacunarity?: number;
    readonly offsetX?: number;
    readonly offsetZ?: number;
}

export type ResolvedTerrainNoiseOptions = Required<TerrainNoiseOptions>;

export const DEFAULT_TERRAIN_NOISE_OPTIONS: ResolvedTerrainNoiseOptions = Object.freeze({
    seed: 1337,
    frequency: 0.02,
    octaves: 4,
    persistence: 0.5,
    lacunarity: 2.0,
    offsetX: 0,
    offsetZ: 0,
});

/**
 * Grid mesh data produced from a terrain heightmap. All buffers are laid out
 * for direct upload: positions/normals as xyz triples, uvs as uv pairs.
 */
export interface TerrainMeshData {
    readonly positions: Float32Array;
    readonly normals: Float32Array;
    readonly uvs: Float32Array;
    readonly indices: Uint16Array | Uint32Array;
    readonly vertexCount: number;
    readonly triangleCount: number;
}

/**
 * Plain heightfield collider source. Structurally compatible with the
 * physics-3d `IHeightFieldShapeDef3D` contract without importing it, so the
 * terrain package stays independent of the physics split.
 */
export interface TerrainHeightfieldSource {
    readonly heights: Float32Array;
    readonly width: number;
    readonly depth: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly scaleZ: number;
}

export type TerrainBrushKind = 'raise' | 'lower' | 'smooth' | 'flatten';

/** All supported brush kinds as a runtime array (single source of truth). */
export const TERRAIN_BRUSH_KINDS: readonly TerrainBrushKind[] = ['raise', 'lower', 'smooth', 'flatten'] as const;

/** Height brush: strength 1 moves a sample by this fraction of full height range per stamp. */
export const TERRAIN_BRUSH_HEIGHT_STAMP_SCALE = 0.04;

/** Splat paint: strength 1 at full weight approaches target by this fraction per stamp. */
export const TERRAIN_SPLAT_STAMP_SCALE = 0.35;

/** Foliage density: strength 1 at full weight approaches target by this fraction per stamp. */
export const TERRAIN_FOLIAGE_DENSITY_STAMP_SCALE = 0.45;

/** Foliage scatter: candidate points evaluated per density texel at density 1. */
export const TERRAIN_FOLIAGE_CANDIDATES_PER_TEXEL = 0.35;

/** Raycast: bisection refinement iterations after marching step crossing. */
export const TERRAIN_RAYCAST_REFINE_STEPS = 24;

/** Raycast: default maximum march distance in world units. */
export const TERRAIN_RAYCAST_DEFAULT_MAX_DISTANCE = 10_000;

export interface TerrainBrushOptions {
    readonly kind?: TerrainBrushKind;
    /** World-space brush radius. */
    readonly radius?: number;
    /** Normalized stamp intensity in (0, 1]. */
    readonly strength?: number;
    /** Falloff exponent shaping the brush edge; 1 = smoothstep. */
    readonly falloff?: number;
    /** Normalized target height for the flatten brush. */
    readonly flattenTarget?: number;
}

export type ResolvedTerrainBrushOptions = Required<TerrainBrushOptions>;

export const DEFAULT_TERRAIN_BRUSH_OPTIONS: ResolvedTerrainBrushOptions = Object.freeze({
    kind: 'raise',
    radius: 8,
    strength: 0.5,
    falloff: 1,
    flattenTarget: 0,
});

export interface TerrainRaycastHit {
    /** Hit position in terrain-local space (origin-centered grid). */
    readonly point: { readonly x: number; readonly y: number; readonly z: number };
    /** Normalized [0, 1] grid coordinates of the hit. */
    readonly u: number;
    readonly v: number;
    /** Ray parameter at the hit. */
    readonly distance: number;
}

export const validateTerrainDescriptor = (descriptor: TerrainDescriptor): void => {
    if (!Number.isFinite(descriptor.width) || descriptor.width <= 0) {
        throw new TerrainError(
            `Invalid width: ${descriptor.width}`,
            TerrainErrorCode.INVALID_DIMENSIONS,
            { width: descriptor.width }
        );
    }

    if (!Number.isFinite(descriptor.length) || descriptor.length <= 0) {
        throw new TerrainError(
            `Invalid length: ${descriptor.length}`,
            TerrainErrorCode.INVALID_DIMENSIONS,
            { length: descriptor.length }
        );
    }

    if (!Number.isFinite(descriptor.maxHeight) || descriptor.maxHeight < 0) {
        throw new TerrainError(
            `Invalid maxHeight: ${descriptor.maxHeight}`,
            TerrainErrorCode.INVALID_DIMENSIONS,
            { maxHeight: descriptor.maxHeight }
        );
    }

    if (!isTerrainResolution(descriptor.resolution)) {
        throw new TerrainError(
            `Invalid resolution: ${descriptor.resolution}. Expected one of ${TERRAIN_RESOLUTIONS.join(', ')}.`,
            TerrainErrorCode.INVALID_RESOLUTION,
            { resolution: descriptor.resolution }
        );
    }
};

export const resolveTerrainNoiseOptions = (
    options: TerrainNoiseOptions = {}
): ResolvedTerrainNoiseOptions => {
    const resolved: ResolvedTerrainNoiseOptions = {
        ...DEFAULT_TERRAIN_NOISE_OPTIONS,
        ...options,
    };

    validateTerrainNoiseOptions(resolved);
    return Object.freeze(resolved);
};

export const validateTerrainNoiseOptions = (options: ResolvedTerrainNoiseOptions): void => {
    if (!Number.isFinite(options.seed)) {
        throw new TerrainError(
            `Invalid noise seed: ${options.seed}`,
            TerrainErrorCode.VALIDATION_FAILED,
            { seed: options.seed }
        );
    }

    if (!Number.isFinite(options.frequency) || options.frequency <= 0) {
        throw new TerrainError(
            `Invalid noise frequency: ${options.frequency}`,
            TerrainErrorCode.VALIDATION_FAILED,
            { frequency: options.frequency }
        );
    }

    if (!Number.isInteger(options.octaves) || options.octaves < 1 || options.octaves > 8) {
        throw new TerrainError(
            `Invalid noise octaves: ${options.octaves}. Expected an integer in [1, 8].`,
            TerrainErrorCode.VALIDATION_FAILED,
            { octaves: options.octaves }
        );
    }

    if (
        !Number.isFinite(options.persistence) ||
        options.persistence <= 0 ||
        options.persistence > 1
    ) {
        throw new TerrainError(
            `Invalid noise persistence: ${options.persistence}. Expected a value in (0, 1].`,
            TerrainErrorCode.VALIDATION_FAILED,
            { persistence: options.persistence }
        );
    }

    if (!Number.isFinite(options.lacunarity) || options.lacunarity < 1) {
        throw new TerrainError(
            `Invalid noise lacunarity: ${options.lacunarity}. Expected a value >= 1.`,
            TerrainErrorCode.VALIDATION_FAILED,
            { lacunarity: options.lacunarity }
        );
    }

    if (!Number.isFinite(options.offsetX) || !Number.isFinite(options.offsetZ)) {
        throw new TerrainError(
            `Invalid noise offset: (${options.offsetX}, ${options.offsetZ})`,
            TerrainErrorCode.VALIDATION_FAILED,
            { offsetX: options.offsetX, offsetZ: options.offsetZ }
        );
    }
};

export const resolveTerrainBrushOptions = (
    options: TerrainBrushOptions = {}
): ResolvedTerrainBrushOptions => {
    const resolved: ResolvedTerrainBrushOptions = {
        ...DEFAULT_TERRAIN_BRUSH_OPTIONS,
        ...options,
    };

    validateTerrainBrushOptions(resolved);
    return Object.freeze(resolved);
};

export const validateTerrainBrushOptions = (options: ResolvedTerrainBrushOptions): void => {
    if (!TERRAIN_BRUSH_KINDS.includes(options.kind)) {
        throw new TerrainError(
            `Invalid brush kind: ${options.kind}`,
            TerrainErrorCode.VALIDATION_FAILED,
            { kind: options.kind }
        );
    }

    if (!Number.isFinite(options.radius) || options.radius <= 0) {
        throw new TerrainError(
            `Invalid brush radius: ${options.radius}`,
            TerrainErrorCode.VALIDATION_FAILED,
            { radius: options.radius }
        );
    }

    if (!Number.isFinite(options.strength) || options.strength <= 0 || options.strength > 1) {
        throw new TerrainError(
            `Invalid brush strength: ${options.strength}. Expected a value in (0, 1].`,
            TerrainErrorCode.VALIDATION_FAILED,
            { strength: options.strength }
        );
    }

    if (!Number.isFinite(options.falloff) || options.falloff <= 0 || options.falloff > 8) {
        throw new TerrainError(
            `Invalid brush falloff: ${options.falloff}. Expected a value in (0, 8].`,
            TerrainErrorCode.VALIDATION_FAILED,
            { falloff: options.falloff }
        );
    }

    if (
        !Number.isFinite(options.flattenTarget) ||
        options.flattenTarget < 0 ||
        options.flattenTarget > 1
    ) {
        throw new TerrainError(
            `Invalid flatten target: ${options.flattenTarget}. Expected a value in [0, 1].`,
            TerrainErrorCode.VALIDATION_FAILED,
            { flattenTarget: options.flattenTarget }
        );
    }
};

export const validateTerrainLayers = (layers: readonly TerrainLayer[]): void => {
    if (layers.length > TERRAIN_MAX_LAYERS) {
        throw new TerrainError(
            `Terrain supports at most ${TERRAIN_MAX_LAYERS} splat layers, received ${layers.length}.`,
            TerrainErrorCode.VALIDATION_FAILED,
            { layerCount: layers.length }
        );
    }

    for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]!;
        if (typeof layer.id !== 'string' || layer.id.length === 0) {
            throw new TerrainError(
                `Terrain layer at index ${index} is missing a stable id.`,
                TerrainErrorCode.VALIDATION_FAILED,
                { index }
            );
        }

        if (!Number.isFinite(layer.tiling) || layer.tiling <= 0) {
            throw new TerrainError(
                `Terrain layer '${layer.id}' has an invalid tiling value: ${layer.tiling}.`,
                TerrainErrorCode.VALIDATION_FAILED,
                { index, tiling: layer.tiling }
            );
        }
    }
};

export const validateTerrainFoliageLayers = (
    layers: readonly TerrainFoliageLayer[]
): void => {
    if (layers.length > TERRAIN_MAX_FOLIAGE_LAYERS) {
        throw new TerrainError(
            `Terrain supports at most ${TERRAIN_MAX_FOLIAGE_LAYERS} foliage layers, received ${layers.length}.`,
            TerrainErrorCode.VALIDATION_FAILED,
            { layerCount: layers.length }
        );
    }

    for (let index = 0; index < layers.length; index += 1) {
        const layer = layers[index]!;
        if (typeof layer.id !== 'string' || layer.id.length === 0) {
            throw new TerrainError(
                `Foliage layer at index ${index} is missing a stable id.`,
                TerrainErrorCode.VALIDATION_FAILED,
                { index }
            );
        }

        if (!Number.isFinite(layer.density) || layer.density < 0 || layer.density > 1) {
            throw new TerrainError(
                `Foliage layer '${layer.id}' has an invalid density: ${layer.density}. Expected a value in [0, 1].`,
                TerrainErrorCode.VALIDATION_FAILED,
                { index, density: layer.density }
            );
        }

        if (
            !Number.isFinite(layer.minScale) ||
            !Number.isFinite(layer.maxScale) ||
            layer.minScale <= 0 ||
            layer.maxScale < layer.minScale
        ) {
            throw new TerrainError(
                `Foliage layer '${layer.id}' has an invalid scale range: [${layer.minScale}, ${layer.maxScale}].`,
                TerrainErrorCode.VALIDATION_FAILED,
                { index, minScale: layer.minScale, maxScale: layer.maxScale }
            );
        }

        if (
            !Number.isFinite(layer.maxSlopeDeg) ||
            layer.maxSlopeDeg < 0 ||
            layer.maxSlopeDeg > 90
        ) {
            throw new TerrainError(
                `Foliage layer '${layer.id}' has an invalid max slope: ${layer.maxSlopeDeg}. Expected degrees in [0, 90].`,
                TerrainErrorCode.VALIDATION_FAILED,
                { index, maxSlopeDeg: layer.maxSlopeDeg }
            );
        }
    }
};
