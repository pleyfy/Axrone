import type { Actor, Transform } from '@axrone/ecs-runtime';
import { Transform as TransformComponent } from '@axrone/ecs-runtime';
import type { RenderPrimitiveInstance } from '@axrone/render-core/types';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { MeshRenderer } from '../components/mesh-renderer';
import type { SceneRenderItem } from './render-item-collector';
import { createRenderCacheCameraKey } from './render-cache-key';

interface MutableViewport {
    width: number;
    height: number;
}

const growUint32 = (array: Uint32Array, size: number): Uint32Array =>
    array.length >= size ? array : new Uint32Array(Math.max(size, array.length * 2));

export interface SceneRenderListCacheParams {
    /** Render pass bucket key; one cache entry per pass. */
    readonly rendererPassId: string;
    /** Pass resource identity — re-registering a pass replaces the object. */
    readonly renderPass: object;
    readonly actors: readonly Actor[];
    readonly cameraFrame: SceneCameraFrameState;
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly materialRevision: number;
    readonly meshRevision: number;
    readonly shaderRevision: number;
    /** Runs the full collect/sort path; only invoked on a cache miss. */
    readonly collect: () => readonly SceneRenderItem[];
}

export interface SceneRenderListCacheResult {
    readonly items: readonly SceneRenderItem[];
    readonly hit: boolean;
}

interface SceneRenderListCacheEntry extends SceneRenderListCacheResult {
    hit: boolean;
    actorsRef: readonly Actor[] | null;
    renderPassRef: object | null;
    cameraKey: string | null;
    viewportWidth: number;
    viewportHeight: number;
    materialRevision: number;
    meshRevision: number;
    shaderRevision: number;
    actorCount: number;
    actorRefs: Actor[];
    transforms: (Transform | null)[];
    renderers: (MeshRenderer | null)[];
    actorRevisions: Uint32Array;
    transformRevisions: Uint32Array;
    rendererRevisions: Uint32Array;
    items: SceneRenderItem[];
}

const createRenderListCacheEntry = (): SceneRenderListCacheEntry => ({
    hit: false,
    actorsRef: null,
    renderPassRef: null,
    cameraKey: null,
    viewportWidth: 0,
    viewportHeight: 0,
    materialRevision: -1,
    meshRevision: -1,
    shaderRevision: -1,
    actorCount: 0,
    actorRefs: [],
    transforms: [],
    renderers: [],
    actorRevisions: new Uint32Array(0),
    transformRevisions: new Uint32Array(0),
    rendererRevisions: new Uint32Array(0),
    items: [],
});

/**
 * Caches the sorted render-item list per render pass and revalidates it with
 * cheap revision comparisons instead of re-running collection, frustum culling
 * and sorting every frame.
 *
 * Snapshots cover *every* actor (not only the collected items) so an actor or
 * renderer that was filtered out last frame (inactive, invisible, wrong pass,
 * culled) still invalidates the cache when it becomes renderable again.
 */
export class SceneRenderListCache {
    private readonly _entries = new Map<string, SceneRenderListCacheEntry>();
    private readonly _viewport: MutableViewport = { width: 0, height: 0 };

    resolve(params: SceneRenderListCacheParams): SceneRenderListCacheResult {
        let entry = this._entries.get(params.rendererPassId);
        if (!entry) {
            entry = createRenderListCacheEntry();
            this._entries.set(params.rendererPassId, entry);
        }

        this._viewport.width = params.viewportWidth;
        this._viewport.height = params.viewportHeight;
        const cameraKey = createRenderCacheCameraKey(params.cameraFrame, this._viewport);

        if (this._isHit(entry, params, cameraKey)) {
            entry.hit = true;
            return entry;
        }

        const collected = params.collect();
        const items = entry.items;
        items.length = collected.length;
        for (let index = 0; index < collected.length; index += 1) {
            items[index] = collected[index]!;
        }

        this._snapshotActors(entry, params.actors);
        entry.actorsRef = params.actors;
        entry.renderPassRef = params.renderPass;
        entry.cameraKey = cameraKey;
        entry.viewportWidth = params.viewportWidth;
        entry.viewportHeight = params.viewportHeight;
        entry.materialRevision = params.materialRevision;
        entry.meshRevision = params.meshRevision;
        entry.shaderRevision = params.shaderRevision;
        entry.hit = false;
        return entry;
    }

    clear(): void {
        this._entries.clear();
    }

    private _isHit(
        entry: SceneRenderListCacheEntry,
        params: SceneRenderListCacheParams,
        cameraKey: string
    ): boolean {
        if (
            entry.actorsRef !== params.actors ||
            entry.renderPassRef !== params.renderPass ||
            entry.cameraKey !== cameraKey ||
            entry.viewportWidth !== params.viewportWidth ||
            entry.viewportHeight !== params.viewportHeight ||
            entry.materialRevision !== params.materialRevision ||
            entry.meshRevision !== params.meshRevision ||
            entry.shaderRevision !== params.shaderRevision
        ) {
            return false;
        }

        const actors = params.actors;
        if (entry.actorCount !== actors.length) {
            return false;
        }

        for (let index = 0; index < actors.length; index += 1) {
            const actor = actors[index]!;
            if (entry.actorRefs[index] !== actor || !actor.active) {
                return false;
            }
            if (entry.actorRevisions[index] !== actor.revision) {
                return false;
            }

            const transform = entry.transforms[index];
            if (transform && entry.transformRevisions[index] !== transform.revision) {
                return false;
            }

            const renderer = entry.renderers[index];
            if (renderer && entry.rendererRevisions[index] !== renderer.revision) {
                return false;
            }
        }

        return true;
    }

    private _snapshotActors(entry: SceneRenderListCacheEntry, actors: readonly Actor[]): void {
        const count = actors.length;
        entry.actorRevisions = growUint32(entry.actorRevisions, count);
        entry.transformRevisions = growUint32(entry.transformRevisions, count);
        entry.rendererRevisions = growUint32(entry.rendererRevisions, count);

        const sameActors = entry.actorsRef === actors && entry.actorCount === count;
        const actorRefs = entry.actorRefs;
        const transforms = entry.transforms;
        const renderers = entry.renderers;
        actorRefs.length = count;
        transforms.length = count;
        renderers.length = count;

        for (let index = 0; index < count; index += 1) {
            const actor = actors[index]!;
            const actorRevision = actor.revision;
            let transform = sameActors ? transforms[index] : null;
            let renderer = sameActors ? renderers[index] : null;

            // Re-query only when the actor's component set changed. Dynamic
            // transform-only motion keeps the same graph and avoids two
            // component lookups per actor on every miss frame.
            if (!sameActors || entry.actorRevisions[index] !== actorRevision) {
                transform = actor.getComponent(TransformComponent) ?? null;
                renderer = actor.getComponent(MeshRenderer) ?? null;
            }

            actorRefs[index] = actor;
            transforms[index] = transform;
            renderers[index] = renderer;
            entry.actorRevisions[index] = actorRevision;
            entry.transformRevisions[index] = transform ? transform.revision : 0;
            entry.rendererRevisions[index] = renderer ? renderer.revision : 0;
        }

        entry.actorCount = count;
    }
}

export interface ScenePrimitiveCacheParams {
    /** Render pass bucket key; one cache entry per pass. */
    readonly rendererPassId: string;
    /** Pass resource identity — re-registering a pass replaces the object. */
    readonly renderPass: object;
    readonly renderItems: readonly SceneRenderItem[];
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly materialRevision: number;
    readonly meshRevision: number;
    readonly shaderRevision: number;
    /**
     * Rebuilds primitives + id lookup; only invoked on a cache miss. Receives
     * the retained arrays so rebuilds reuse their storage.
     */
    readonly build: (
        primitives: RenderPrimitiveInstance[],
        lookup: Map<string, SceneRenderItem>
    ) => void;
    /**
     * Cheap refresh for the common "only transforms changed" case. When item
     * identities, pass, viewport and registry revisions are unchanged and no
     * renderer revision was bumped, primitives keep their ids, material
     * snapshots and bounds; only the world-matrix references need refreshing.
     * Providing it avoids string/object churn on every dynamic frame.
     */
    readonly update?: (
        primitives: readonly RenderPrimitiveInstance[],
        renderItems: readonly SceneRenderItem[]
    ) => void;
}

export interface ScenePrimitiveCacheResult {
    readonly primitives: readonly RenderPrimitiveInstance[];
    readonly lookup: ReadonlyMap<string, SceneRenderItem>;
    readonly hit: boolean;
}

interface ScenePrimitiveCacheEntry extends ScenePrimitiveCacheResult {
    hit: boolean;
    renderPassRef: object | null;
    viewportWidth: number;
    viewportHeight: number;
    materialRevision: number;
    meshRevision: number;
    shaderRevision: number;
    itemCount: number;
    transforms: Transform[];
    renderers: MeshRenderer[];
    transformRevisions: Uint32Array;
    rendererRevisions: Uint32Array;
    primitives: RenderPrimitiveInstance[];
    lookup: Map<string, SceneRenderItem>;
}

const createPrimitiveCacheEntry = (): ScenePrimitiveCacheEntry => ({
    hit: false,
    renderPassRef: null,
    viewportWidth: 0,
    viewportHeight: 0,
    materialRevision: -1,
    meshRevision: -1,
    shaderRevision: -1,
    itemCount: 0,
    transforms: [],
    renderers: [],
    transformRevisions: new Uint32Array(0),
    rendererRevisions: new Uint32Array(0),
    primitives: [],
    lookup: new Map(),
});

/**
 * Caches `RenderPrimitiveInstance` records and the primitive-id → render-item
 * lookup per render pass. `RenderPipeline.renderImmediate` only reads the
 * primitives array, so the retained array can be re-submitted untouched.
 */
export class ScenePrimitiveCache {
    private readonly _entries = new Map<string, ScenePrimitiveCacheEntry>();

    resolve(params: ScenePrimitiveCacheParams): ScenePrimitiveCacheResult {
        let entry = this._entries.get(params.rendererPassId);
        if (!entry) {
            entry = createPrimitiveCacheEntry();
            this._entries.set(params.rendererPassId, entry);
        }

        if (this._isHit(entry, params)) {
            entry.hit = true;
            return entry;
        }

        if (params.update && this._canUpdateInPlace(entry, params)) {
            // Structure, pass, viewport and registry revisions are unchanged
            // and no renderer was bumped — only transforms moved. Refresh the
            // retained primitives instead of rebuilding ids/snapshots/bounds.
            params.update(entry.primitives, params.renderItems);
            this._snapshotItems(entry, params.renderItems);
            entry.hit = false;
            return entry;
        }

        entry.primitives.length = 0;
        entry.lookup.clear();
        params.build(entry.primitives, entry.lookup);

        this._snapshotItems(entry, params.renderItems);
        entry.renderPassRef = params.renderPass;
        entry.viewportWidth = params.viewportWidth;
        entry.viewportHeight = params.viewportHeight;
        entry.materialRevision = params.materialRevision;
        entry.meshRevision = params.meshRevision;
        entry.shaderRevision = params.shaderRevision;
        entry.hit = false;
        return entry;
    }

    clear(): void {
        this._entries.clear();
    }

    private _isHit(entry: ScenePrimitiveCacheEntry, params: ScenePrimitiveCacheParams): boolean {
        if (
            entry.renderPassRef !== params.renderPass ||
            entry.viewportWidth !== params.viewportWidth ||
            entry.viewportHeight !== params.viewportHeight ||
            entry.materialRevision !== params.materialRevision ||
            entry.meshRevision !== params.meshRevision ||
            entry.shaderRevision !== params.shaderRevision ||
            entry.itemCount !== params.renderItems.length
        ) {
            return false;
        }

        for (let index = 0; index < params.renderItems.length; index += 1) {
            const item = params.renderItems[index]!;
            if (entry.transformRevisions[index] !== item.transform.revision) {
                return false;
            }
            if (entry.rendererRevisions[index] !== item.renderer.revision) {
                return false;
            }
            if (
                entry.transforms[index] !== item.transform ||
                entry.renderers[index] !== item.renderer
            ) {
                return false;
            }
        }

        return true;
    }

    private _canUpdateInPlace(
        entry: ScenePrimitiveCacheEntry,
        params: ScenePrimitiveCacheParams
    ): boolean {
        if (
            entry.renderPassRef !== params.renderPass ||
            entry.viewportWidth !== params.viewportWidth ||
            entry.viewportHeight !== params.viewportHeight ||
            entry.materialRevision !== params.materialRevision ||
            entry.meshRevision !== params.meshRevision ||
            entry.shaderRevision !== params.shaderRevision ||
            entry.itemCount !== params.renderItems.length ||
            entry.primitives.length !== params.renderItems.length
        ) {
            return false;
        }

        for (let index = 0; index < params.renderItems.length; index += 1) {
            const item = params.renderItems[index]!;
            if (
                entry.transforms[index] !== item.transform ||
                entry.renderers[index] !== item.renderer
            ) {
                return false;
            }
            // Renderer revisions drive mesh/material/visibility/sort changes,
            // which require a rebuild. Transform revisions only affect the
            // world matrix, which the update callback refreshes.
            if (entry.rendererRevisions[index] !== item.renderer.revision) {
                return false;
            }
        }

        return true;
    }

    private _snapshotItems(
        entry: ScenePrimitiveCacheEntry,
        renderItems: readonly SceneRenderItem[]
    ): void {
        const count = renderItems.length;
        entry.transformRevisions = growUint32(entry.transformRevisions, count);
        entry.rendererRevisions = growUint32(entry.rendererRevisions, count);

        const transforms = entry.transforms;
        const renderers = entry.renderers;
        transforms.length = count;
        renderers.length = count;

        for (let index = 0; index < count; index += 1) {
            const item = renderItems[index]!;
            transforms[index] = item.transform;
            renderers[index] = item.renderer;
            entry.transformRevisions[index] = item.transform.revision;
            entry.rendererRevisions[index] = item.renderer.revision;
        }

        entry.itemCount = count;
    }
}
