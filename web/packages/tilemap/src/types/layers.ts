import { TilemapErrorCode, TilemapFault } from '../errors';
import { asPackedTileWord, type PackedTileWord } from './brands';

/**
 * Declarative layer description. Layers are ordered: index 0 is the lowest
 * layer. The engine stores one word per tile per layer.
 */
export interface LayerSpec {
    readonly name: string;
    /** Word used for tiles that were never written; defaults to empty. */
    readonly defaultWord?: PackedTileWord | number;
    readonly visible?: boolean;
    /** Marks the layer as a collision source for `TilemapCollider2D`. */
    readonly collision?: boolean;
    readonly zIndex?: number;
    readonly renderOrder?: number;
    readonly opacity?: number;
}

export type LayerName<TSpec extends LayerSpec> = TSpec['name'];

/** All names of a layer tuple. */
export type LayerNames<L extends readonly LayerSpec[]> = L[number]['name'];

type DuplicateLayerName<
    L extends readonly LayerSpec[],
    Seen extends string = never,
> = L extends readonly [
    infer Head extends LayerSpec,
    ...infer Tail extends readonly LayerSpec[],
]
    ? Head['name'] extends Seen
        ? Head['name']
        : DuplicateLayerName<Tail, Seen | Head['name']>
    : never;

/**
 * Rejects a layer tuple with duplicate names at compile time: the parameter
 * type resolves to `never`, so the call does not typecheck.
 */
export type AssertUniqueLayerNames<L extends readonly LayerSpec[]> =
    DuplicateLayerName<L> extends never ? L : never;

/** A layer can be addressed by index or by name. */
export type LayerReference<L extends readonly LayerSpec[]> =
    | number
    | LayerNames<L>;

const MAX_LAYER_INDEX = 63;

export const createLayerSpec = (spec: LayerSpec): Readonly<LayerSpec> => {
    if (typeof spec.name !== 'string' || spec.name.length === 0) {
        throw new TilemapFault(
            'layer name must be a non-empty string',
            TilemapErrorCode.INVALID_CONFIGURATION,
            { name: spec.name }
        );
    }
    if (spec.defaultWord !== undefined) {
        asPackedTileWord(spec.defaultWord);
    }
    if (spec.opacity !== undefined) {
        if (
            !Number.isFinite(spec.opacity) ||
            spec.opacity < 0 ||
            spec.opacity > 1
        ) {
            throw new TilemapFault(
                'layer opacity must be in [0, 1]',
                TilemapErrorCode.INVALID_CONFIGURATION,
                { name: spec.name, opacity: spec.opacity }
            );
        }
    }
    return Object.freeze({ ...spec });
};

export const createLayerSpecs = (
    layers: readonly LayerSpec[]
): readonly Readonly<LayerSpec>[] => {
    if (layers.length === 0) {
        throw new TilemapFault(
            'a tilemap needs at least one layer',
            TilemapErrorCode.INVALID_CONFIGURATION
        );
    }
    if (layers.length > MAX_LAYER_INDEX + 1) {
        throw new TilemapFault(
            `a tilemap supports at most ${MAX_LAYER_INDEX + 1} layers`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { layerCount: layers.length }
        );
    }
    const seen = new Set<string>();
    for (const layer of layers) {
        if (seen.has(layer.name)) {
            throw new TilemapFault(
                `duplicate layer name: ${layer.name}`,
                TilemapErrorCode.INVALID_CONFIGURATION,
                { name: layer.name }
            );
        }
        seen.add(layer.name);
    }
    return Object.freeze(layers.map(createLayerSpec));
};

/** Per-layer default words, indexed by layer. */
export const resolveLayerDefaultWords = (
    layers: readonly LayerSpec[]
): Uint32Array => {
    const words = new Uint32Array(layers.length);
    for (let index = 0; index < layers.length; index++) {
        const spec = layers[index]!;
        words[index] =
            spec.defaultWord === undefined
                ? 0
                : (asPackedTileWord(spec.defaultWord) as unknown as number);
    }
    return words;
};

export const findLayerIndex = (
    layers: readonly LayerSpec[],
    name: string
): number => {
    for (let index = 0; index < layers.length; index++) {
        if (layers[index]!.name === name) return index;
    }
    return -1;
};
