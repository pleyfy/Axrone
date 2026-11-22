import { TilemapErrorCode, TilemapFault } from '../errors';
import {
    TILE_COLLISION_MAX,
    TILE_ID_MAX,
    TILE_MATERIAL_MAX,
} from './tile-word-abi';

export interface TileAnimationFrame {
    readonly tileId: number;
    readonly durationMs: number;
}

/** Static data for one tile id. */
export interface TileDefinition {
    readonly id: number;
    readonly name: string;
    /** Default collision mask applied when the tile is placed. */
    readonly collision?: number;
    /** Material id used by pathfinding costs. */
    readonly material?: number;
    readonly animation?: readonly TileAnimationFrame[];
    /** Name of the autotile group this tile belongs to. */
    readonly autotileGroup?: string;
}

export interface TileDefinitionTable {
    readonly size: number;
    get(id: number): TileDefinition | undefined;
    /**
     * Selects the animation frame at `elapsedMs`, cycling through the frame
     * durations. Returns `null` when the definition has no animation.
     */
    frameAt(id: number, elapsedMs: number): TileAnimationFrame | null;
}

const validateDefinition = (definition: TileDefinition): void => {
    if (
        !Number.isInteger(definition.id) ||
        definition.id < 0 ||
        definition.id > TILE_ID_MAX
    ) {
        throw new TilemapFault(
            `tile definition id must be in [0, ${TILE_ID_MAX}], got ${definition.id}`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { id: definition.id }
        );
    }
    if (definition.name.length === 0) {
        throw new TilemapFault(
            `tile definition ${definition.id} needs a name`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { id: definition.id }
        );
    }
    if (
        definition.collision !== undefined &&
        (!Number.isInteger(definition.collision) ||
            definition.collision < 0 ||
            definition.collision > TILE_COLLISION_MAX)
    ) {
        throw new TilemapFault(
            `tile definition ${definition.id} collision must be in [0, ${TILE_COLLISION_MAX}]`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { id: definition.id, collision: definition.collision }
        );
    }
    if (
        definition.material !== undefined &&
        (!Number.isInteger(definition.material) ||
            definition.material < 0 ||
            definition.material > TILE_MATERIAL_MAX)
    ) {
        throw new TilemapFault(
            `tile definition ${definition.id} material must be in [0, ${TILE_MATERIAL_MAX}]`,
            TilemapErrorCode.INVALID_CONFIGURATION,
            { id: definition.id, material: definition.material }
        );
    }
    for (const frame of definition.animation ?? []) {
        if (!Number.isFinite(frame.durationMs) || frame.durationMs <= 0) {
            throw new TilemapFault(
                `tile definition ${definition.id} animation durations must be positive`,
                TilemapErrorCode.INVALID_CONFIGURATION,
                { id: definition.id, durationMs: frame.durationMs }
            );
        }
        if (
            !Number.isInteger(frame.tileId) ||
            frame.tileId < 0 ||
            frame.tileId > TILE_ID_MAX
        ) {
            throw new TilemapFault(
                `tile definition ${definition.id} animation tileId is invalid`,
                TilemapErrorCode.INVALID_CONFIGURATION,
                { id: definition.id, tileId: frame.tileId }
            );
        }
    }
};

/** Builds an immutable lookup table, rejecting duplicate ids and bad data. */
export const createTileDefinitionTable = (
    definitions: readonly TileDefinition[]
): TileDefinitionTable => {
    const byId = new Map<number, TileDefinition>();
    const totals = new Map<number, number>();
    for (const definition of definitions) {
        validateDefinition(definition);
        if (byId.has(definition.id)) {
            throw new TilemapFault(
                `duplicate tile definition id ${definition.id}`,
                TilemapErrorCode.INVALID_CONFIGURATION,
                { id: definition.id }
            );
        }
        const frozen: TileDefinition = Object.freeze({
            ...definition,
            animation:
                definition.animation === undefined
                    ? undefined
                    : Object.freeze(
                          definition.animation.map((frame) =>
                              Object.freeze({ ...frame })
                          )
                      ),
        });
        byId.set(definition.id, frozen);
        if (frozen.animation !== undefined && frozen.animation.length > 0) {
            totals.set(
                definition.id,
                frozen.animation.reduce(
                    (total, frame) => total + frame.durationMs,
                    0
                )
            );
        }
    }
    return Object.freeze({
        size: byId.size,
        get(id: number): TileDefinition | undefined {
            return byId.get(id);
        },
        frameAt(id: number, elapsedMs: number): TileAnimationFrame | null {
            const definition = byId.get(id);
            const animation = definition?.animation;
            if (animation === undefined || animation.length === 0) return null;
            const total = totals.get(id)!;
            const time = Number.isFinite(elapsedMs)
                ? ((elapsedMs % total) + total) % total
                : 0;
            let cursor = 0;
            for (const frame of animation) {
                cursor += frame.durationMs;
                if (time < cursor) return frame;
            }
            return animation[animation.length - 1]!;
        },
    });
};
