import type { TilesetDefinition } from '@axrone/asset-tilemap';
import { Color } from '@axrone/numeric';
import {
    TileCodec,
    type PackedTileWord,
    type ProjectionSpec,
} from '@axrone/tilemap';
import {
    extractViewportInstances,
    gridToWorld,
    viewportGridBounds,
    ViewportTileBuffer,
    type WorldRect,
} from '@axrone/tilemap/query';
import type { TilemapRuntime } from '../scene-tilemap-runtime';

export interface TilesetFrameTable {
    readonly textureId: string;
    readonly hasFrame: Uint8Array;
    /** `[u0, v0, du, dv]` per tile id. */
    readonly uv: Float32Array;
}

export const createTilesetFrameTable = (
    tileset: TilesetDefinition
): TilesetFrameTable => {
    const hasFrame = new Uint8Array(tileset.tileCount);
    const uv = new Float32Array(tileset.tileCount * 4);
    for (let tileId = 0; tileId < tileset.tileCount; tileId++) {
        const column = tileId % tileset.columns;
        const row = Math.floor(tileId / tileset.columns);
        const x = tileset.margin + column * (tileset.tileWidth + tileset.spacing);
        const y = tileset.margin + row * (tileset.tileHeight + tileset.spacing);
        const offset = tileId * 4;
        uv[offset] = x / tileset.imageWidth;
        uv[offset + 1] = y / tileset.imageHeight;
        uv[offset + 2] = tileset.tileWidth / tileset.imageWidth;
        uv[offset + 3] = tileset.tileHeight / tileset.imageHeight;
        hasFrame[tileId] = 1;
    }
    return { textureId: tileset.image, hasFrame, uv };
};

export interface TilemapLayerView {
    readonly name: string;
    readonly visible: boolean;
    readonly opacity: number;
}

const readLayers = (
    runtime: TilemapRuntime,
    visibleLayers: readonly string[] | null
): readonly { readonly index: number; readonly view: TilemapLayerView }[] => {
    const overrides = new Map(
        runtime.layerOverrides.map((override) => [override.name, override])
    );
    const entries = runtime.definition.layers.map((layer, index) => {
        const override = overrides.get(layer.name);
        const visible =
            (layer.visible ?? true) &&
            (override?.visible ?? true) &&
            (visibleLayers === null || visibleLayers.includes(layer.name));
        return {
            index,
            zIndex: layer.zIndex ?? index,
            renderOrder: layer.renderOrder ?? 0,
            view: {
                name: layer.name,
                visible,
                opacity: Math.min(
                    1,
                    Math.max(0, override?.opacity ?? layer.opacity ?? 1)
                ),
            },
        };
    });
    entries.sort(
        (left, right) =>
            left.zIndex - right.zIndex ||
            left.renderOrder - right.renderOrder ||
            left.index - right.index
    );
    return entries.map((entry) => ({
        index: entry.index,
        view: entry.view,
    }));
};

export interface TilemapInstanceSourceOptions {
    readonly runtime: TilemapRuntime;
    readonly tileset: TilesetDefinition;
    readonly visibleLayers?: readonly string[] | null;
    readonly tint?: Color;
}

/**
 * Builds the sprite instance streams for one tilemap map without touching GL.
 * Layer order follows `zIndex`, then `renderOrder`; tiles inside a layer are
 * emitted in the engine's row-major viewport order.
 */
export class TilemapInstanceSource {
    readonly #runtime: TilemapRuntime;
    readonly #frames: TilesetFrameTable;
    readonly #visibleLayers: readonly string[] | null;
    readonly #tint: Color;
    readonly #tiles: ViewportTileBuffer = new ViewportTileBuffer();
    #transform = new Float32Array(64 * 6);
    #statics = new Float32Array(64 * 13);
    #drawCount = 0;
    #groupRanges = new Int32Array(0);
    #groupTextureOffsets = new Int32Array(0);
    #groupTextureIds: readonly string[] = Object.freeze([]);
    #staticsDirty = false;
    #lastSignature = '';

    constructor(options: TilemapInstanceSourceOptions) {
        this.#runtime = options.runtime;
        this.#frames = createTilesetFrameTable(options.tileset);
        this.#visibleLayers = options.visibleLayers ?? null;
        this.#tint = options.tint ?? Color.WHITE;
    }

    get drawCount(): number {
        return this.#drawCount;
    }

    get groupRanges(): Int32Array {
        return this.#groupRanges;
    }

    get groupTextureOffsets(): Int32Array {
        return this.#groupTextureOffsets;
    }

    get groupTextureIds(): readonly string[] {
        return this.#groupTextureIds;
    }

    get groupCount(): number {
        return this.#groupTextureIds.length;
    }

    get textureId(): string | null {
        return this.#groupTextureIds.length === 1
            ? this.#groupTextureIds[0]!
            : null;
    }

    get transformData(): Float32Array {
        return this.#transform;
    }

    get staticData(): Float32Array {
        return this.#statics;
    }

    get staticsDirty(): boolean {
        return this.#staticsDirty;
    }

    get frames(): TilesetFrameTable {
        return this.#frames;
    }

    sync(camera: WorldRect): number {
        const signature = `${this.#runtime.revision}|${this.#visibleLayers?.join(',') ?? '*'}|${this.#tint.r},${this.#tint.g},${this.#tint.b},${this.#tint.a}|${camera.x},${camera.y},${camera.width},${camera.height}`;
        if (signature === this.#lastSignature) {
            return this.#drawCount;
        }
        this.#lastSignature = signature;
        const projection = this.#runtime.engine.projection;
        const bounds = viewportGridBounds(projection, camera);
        const layers = readLayers(this.#runtime, this.#visibleLayers);
        let count = 0;
        for (const layer of layers) {
            if (!layer.view.visible) continue;
            extractViewportInstances(
                this.#runtime.engine,
                layer.view.name,
                bounds,
                this.#tiles
            );
            for (let index = 0; index < this.#tiles.count; index++) {
                const word = this.#tiles.words[index]! as PackedTileWord;
                const tileId = TileCodec.unpackTileId(word);
                if (
                    tileId >= this.#frames.hasFrame.length ||
                    this.#frames.hasFrame[tileId] === 0
                ) {
                    continue;
                }
                this.#ensureCapacity(count + 1);
                this.#writeInstance(
                    count,
                    projection,
                    this.#tiles.gridXs[index]!,
                    this.#tiles.gridYs[index]!,
                    word,
                    tileId,
                    layer.view.opacity
                );
                count++;
            }
        }
        this.#drawCount = count;
        if (count > 0) {
            this.#groupRanges = Int32Array.of(0, count);
            this.#groupTextureOffsets = Int32Array.of(0, 1);
            this.#groupTextureIds = Object.freeze([this.#frames.textureId]);
        } else {
            this.#groupRanges = new Int32Array(0);
            this.#groupTextureOffsets = new Int32Array(0);
            this.#groupTextureIds = Object.freeze([]);
        }
        this.#staticsDirty = true;
        return count;
    }

    #ensureCapacity(capacity: number): void {
        if (capacity * 6 <= this.#transform.length) return;
        let next = Math.max(64, this.#transform.length / 6);
        while (next < capacity) next *= 2;
        const transform = new Float32Array(next * 6);
        transform.set(this.#transform);
        const statics = new Float32Array(next * 13);
        statics.set(this.#statics);
        this.#transform = transform;
        this.#statics = statics;
    }

    #writeInstance(
        slot: number,
        projection: ProjectionSpec,
        gridX: number,
        gridY: number,
        word: PackedTileWord,
        tileId: number,
        layerOpacity: number
    ): void {
        const flags = TileCodec.unpackTransform(word);
        let a = 1;
        let b = 0;
        let c = 0;
        let d = 1;
        if ((flags & 4) !== 0) {
            a = 0;
            b = 1;
            c = -1;
            d = 0;
        }
        if ((flags & 1) !== 0) {
            a = -a;
            c = -c;
        }
        if ((flags & 2) !== 0) {
            b = -b;
            d = -d;
        }
        const tileWidth = projection.tileWidth;
        const tileHeight = projection.tileHeight;
        const world = gridToWorld(projection, gridX, gridY);
        const centerX =
            projection.kind === 'isometric'
                ? world.worldX
                : world.worldX + tileWidth / 2;
        const centerY = world.worldY + tileHeight / 2;
        const transformOffset = slot * 6;
        this.#transform[transformOffset] = a;
        this.#transform[transformOffset + 1] = b;
        this.#transform[transformOffset + 2] = c;
        this.#transform[transformOffset + 3] = d;
        this.#transform[transformOffset + 4] = centerX;
        this.#transform[transformOffset + 5] = centerY;

        const uvOffset = tileId * 4;
        let du = this.#frames.uv[uvOffset + 2]!;
        let dv = this.#frames.uv[uvOffset + 3]!;
        if ((flags & 1) !== 0) du = -du;
        if ((flags & 2) !== 0) dv = -dv;
        const staticOffset = slot * 13;
        this.#statics[staticOffset] = tileWidth;
        this.#statics[staticOffset + 1] = tileHeight;
        this.#statics[staticOffset + 2] = 0.5;
        this.#statics[staticOffset + 3] = 0.5;
        this.#statics[staticOffset + 4] = this.#frames.uv[uvOffset]!;
        this.#statics[staticOffset + 5] = this.#frames.uv[uvOffset + 1]!;
        this.#statics[staticOffset + 6] = du;
        this.#statics[staticOffset + 7] = dv;
        this.#statics[staticOffset + 8] = this.#tint.r;
        this.#statics[staticOffset + 9] = this.#tint.g;
        this.#statics[staticOffset + 10] = this.#tint.b;
        this.#statics[staticOffset + 11] = this.#tint.a * layerOpacity;
        this.#statics[staticOffset + 12] = 0;
    }

    markStaticsClean(): void {
        this.#staticsDirty = false;
    }
}
