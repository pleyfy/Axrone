import type { IGLStateCache } from '@axrone/render-webgl2';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { Color } from '@axrone/numeric';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneRenderPassResource } from './render-pass-registry';
import type { SceneRenderStateApplier } from './render-state-applier';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import { SpriteInstanceBufferRenderer } from './sprite-instance-buffer-renderer';
import { TilemapInstanceSource } from './tilemap-instance-source';
import type { TilemapRuntime } from '../scene-tilemap-runtime';
import type { TilesetDefinition } from '@axrone/asset-tilemap';
import type { WorldRect } from '@axrone/tilemap/query';

export interface TilemapRenderRuntimeOptions {
    readonly runtime: TilemapRuntime;
    readonly tilesetId?: string;
    readonly visibleLayers?: readonly string[] | null;
    readonly tint?: Color;
    readonly gl: WebGL2RenderingContext;
    readonly resources: SceneResourceRuntime;
    readonly renderStateApplier: SceneRenderStateApplier;
    readonly stateCache?: IGLStateCache;
}

export interface TilemapRenderParams {
    readonly renderPass: SceneRenderPassResource;
    readonly cameraFrame: SceneCameraFrameState;
    readonly frameState: SceneRenderFrameState;
    readonly cameraRect: WorldRect;
    readonly limit?: number;
}

/** Runtime draw contract the scene render runtime consumes. */
export interface SceneTilemapRenderRuntimeLike {
    render(params: TilemapRenderParams): number;
}

const resolveTileset = (
    runtime: TilemapRuntime,
    tilesetId: string | undefined
): TilesetDefinition | null => {
    if (tilesetId !== undefined) {
        return runtime.tilesets.find((tileset) => tileset.name === tilesetId) ?? null;
    }
    return runtime.tilesets[0] ?? null;
};

/**
 * Draws one tilemap through the shared `SpriteInstanceBufferRenderer`. No
 * second shader or GPU path is introduced; the same 6+13 float instance
 * streams drive tile quads.
 */
export class TilemapRenderRuntime implements SceneTilemapRenderRuntimeLike {
    readonly runtime: TilemapRuntime;
    #tilesetId: string | undefined;
    #visibleLayers: readonly string[] | null;
    #tint: Color;
    #source: TilemapInstanceSource | null = null;
    #renderer: SpriteInstanceBufferRenderer | null = null;
    readonly #options: TilemapRenderRuntimeOptions;
    #diagnostic: string | null = null;

    constructor(options: TilemapRenderRuntimeOptions) {
        this.#options = options;
        this.runtime = options.runtime;
        this.#tilesetId = options.tilesetId;
        this.#visibleLayers = options.visibleLayers ?? null;
        this.#tint = options.tint ?? Color.WHITE;
    }

    get diagnostic(): string | null {
        return this.#diagnostic;
    }

    get source(): TilemapInstanceSource | null {
        return this.#source;
    }

    /** Builds and syncs the instance source without touching GL. */
    prepare(cameraRect: WorldRect): TilemapInstanceSource | null {
        const tileset = resolveTileset(this.runtime, this.#tilesetId);
        if (tileset === null) {
            this.#diagnostic = `tilemap ${this.runtime.mapId} has no tileset ${
                this.#tilesetId ?? ''
            }`;
            return null;
        }
        this.#diagnostic = null;
        if (this.#source === null) {
            this.#source = new TilemapInstanceSource({
                runtime: this.runtime,
                tileset,
                visibleLayers: this.#visibleLayers,
                tint: this.#tint,
            });
        }
        this.#source.sync(cameraRect);
        return this.#source;
    }

    setTileset(tilesetId: string | undefined): void {
        if (this.#tilesetId === tilesetId) return;
        this.#tilesetId = tilesetId;
        this.#source = null;
    }

    setVisibleLayers(visibleLayers: readonly string[] | null): void {
        this.#visibleLayers = visibleLayers;
        this.#source = null;
    }

    render(params: TilemapRenderParams): number {
        const source = this.prepare(params.cameraRect);
        if (source === null || source.drawCount === 0) return 0;
        if (this.#renderer === null) {
            this.#renderer = new SpriteInstanceBufferRenderer({
                gl: this.#options.gl,
                resources: this.#options.resources,
                renderStateApplier: this.#options.renderStateApplier,
                stateCache: this.#options.stateCache,
                textureSlotBudget: 4,
            });
        }
        this.#renderer.upload(
            source.transformData,
            source.staticData,
            source.drawCount,
            source.staticsDirty
        );
        source.markStaticsClean();
        return this.#renderer.draw(source, params.limit ?? source.drawCount, {
            renderPass: params.renderPass,
            cameraFrame: params.cameraFrame,
            frameState: params.frameState,
        });
    }

    clear(): void {
        this.#renderer?.clear();
    }
}
