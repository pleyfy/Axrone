import { Hierarchy, Transform, type Actor, type RenderMutationClock } from '@axrone/ecs-runtime';
import { Mat4, Vec3 } from '@axrone/numeric';
import type { SceneCameraFrameState } from '../camera-frame-state';
import { SpriteMask } from '../components/sprite-mask';
import { SpriteRenderer } from '../components/sprite-renderer';
import type { SceneRenderFrameState } from './render-frame-state';
import type { SceneSpriteInstanceDrawView } from './sprite-instance-buffer-renderer';
import {
    SPRITE_STATIC_FLOATS_PER_INSTANCE,
    SPRITE_TRANSFORM_FLOATS_PER_INSTANCE,
} from './sprite-instance-buffer-renderer';

const QUAT_LENGTH_EPSILON = 1e-8;
/** Default fragment sampler budget; WebGL 2 guarantees at least 16. */
const DEFAULT_TEXTURE_SLOT_BUDGET = 16;

/**
 * Per-actor render cache entry. Holds direct component references so the
 * frame path never does `getComponent` lookups, plus the last-seen revisions
 * used to decide whether transform/static streams must be rewritten.
 */
interface SceneSpriteInstanceEntry {
    actor: Actor;
    transform: Transform;
    renderer: SpriteRenderer;
    hierarchy: Hierarchy | null;
    /** Non-self ancestors, only when the sprite is parented. */
    ancestors: Actor[] | null;
    ancestorsRevision: number[];
    isRoot: boolean;
    textureId: string;
    actorRevision: number;
    transformRevision: number;
    rendererRevision: number;
    hidden: boolean;
    culled: boolean;
    slot: number;
    sequence: number;
    textureSlot: number;
    sortingLayer: number;
    renderOrder: number;
    z: number;
    width: number;
    height: number;
    anchorX: number;
    anchorY: number;
    u0: number;
    v0: number;
    du: number;
    dv: number;
    r: number;
    g: number;
    b: number;
    a: number;
    /** Distance from the transform origin to the farthest quad point, unscaled. */
    cullRadius: number;
}

/**
 * An actor that was in the pass but produced no entry — inactive, missing
 * components, or a renderer that was disabled/invisible/sourceless at build
 * time. Revisions are snapshotted so a later revalidation can tell, without
 * component lookups, whether any of them became renderable again.
 */
interface SceneSpriteInstanceExcludedEntry {
    actor: Actor;
    transform: Transform | null;
    renderer: SpriteRenderer | null;
    actorRevision: number;
    transformRevision: number;
    rendererRevision: number;
}

export type SceneSpriteInstanceSyncStatus = 'ready' | 'empty' | 'ineligible';
type SceneSpriteInstanceReclassify = 'ok' | 'ineligible';

const createEntry = (): SceneSpriteInstanceEntry => ({
    actor: null as unknown as Actor,
    transform: null as unknown as Transform,
    renderer: null as unknown as SpriteRenderer,
    hierarchy: null,
    ancestors: null,
    ancestorsRevision: [],
    isRoot: false,
    textureId: '',
    actorRevision: -1,
    transformRevision: -1,
    rendererRevision: -1,
    hidden: false,
    culled: false,
    slot: 0,
    sequence: 0,
    textureSlot: 0,
    sortingLayer: 0,
    renderOrder: 0,
    z: Number.NaN,
    width: 1,
    height: 1,
    anchorX: 0.5,
    anchorY: 0.5,
    u0: 0,
    v0: 0,
    du: 1,
    dv: 1,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
    cullRadius: 0,
});

/**
 * Derived, per-pass instance registry for homogeneous 2D sprite passes.
 *
 * This is a render cache, not a second scene model: every entry points at the
 * actor's own `Transform`/`SpriteRenderer`, and every frame revalidates those
 * components by revision. It exists so the homogeneous path can write a
 * persistent instance stream directly instead of collecting render items,
 * sorting them and allocating one submission object per sprite every frame.
 *
 * Fallback contract: any pass that needs masks, clipping, nine-slice or
 * material-driven sprites reports `ineligible`, and the caller keeps using the
 * general batch path for it. Multi-texture passes ARE eligible: the ordered
 * stream is cut into contiguous groups of at most `textureSlotBudget` distinct
 * textures, slot-assigned per group. Because groups never reorder or overlap
 * the stream, painter order is preserved exactly — no alpha-mode or overlap
 * gating is required for texture grouping.
 */
export class SceneSpriteInstanceRegistry implements SceneSpriteInstanceDrawView {
    private readonly _entries: SceneSpriteInstanceEntry[] = [];
    private readonly _excluded: SceneSpriteInstanceExcludedEntry[] = [];
    private _excludedCount = 0;
    private readonly _order: number[] = [];
    private _transformData = new Float32Array(0);
    private _staticData = new Float32Array(0);
    private _capacity = 0;
    private _textureId: string | null = null;
    private readonly _textureSlotBudget: number;
    /** Scratch id→slot assignment, rebuilt per grouping pass. */
    private readonly _slotMap = new Map<string, number>();
    private _groupRanges = new Int32Array(0);
    private _groupTextureOffsets = new Int32Array(0);
    private readonly _groupTextureIds: string[] = [];
    private _groupCount = 0;
    private _groupCapacity = 0;
    private _passId = '';
    private _actorsRef: readonly Actor[] | null = null;
    private _actorCount = -1;
    private _empty = false;
    private _needsRebuild = true;
    private _rebuiltThisFrame = false;
    /**
     * World render-mutation clock captured from the pass's actors. `null` when
     * the actor set has no world (mocked or detached actors), in which case
     * every refresh runs the full per-entry sweep.
     */
    private _worldClock: RenderMutationClock | null = null;
    /** Clock value at the end of the last completed refresh. */
    private _worldRevision = -1;
    private _ineligibleActorsRef: readonly Actor[] | null = null;
    private _ineligibleActorCount = -1;
    private _ineligiblePassId = '';
    private _ineligible = false;
    private _drawnCount = 0;
    private _transformDirty = false;
    private _staticsDirty = false;
    /** Entries visited by the most recent `refresh`; 0 on a settled frame. */
    private _lastRefreshScanCount = 0;
    private _cameraMatrix = new Float64Array(16);
    private _hasCameraMatrix = false;
    private readonly _inverseViewProjection = new Mat4();
    private _aabbValid = false;
    private _aabbMinX = 0;
    private _aabbMinY = 0;
    private _aabbMinZ = 0;
    private _aabbMaxX = 0;
    private _aabbMaxY = 0;
    private _aabbMaxZ = 0;

    private readonly _sphereCenter = new Vec3();
    private readonly _sphere = {
        kind: 'sphere' as const,
        center: this._sphereCenter,
        radius: 0,
    };
    private readonly _compareEntries = (left: number, right: number): number => {
        const entries = this._entries;
        const a = entries[left]!;
        const b = entries[right]!;
        if (a.sortingLayer !== b.sortingLayer) {
            return a.sortingLayer - b.sortingLayer;
        }
        if (a.renderOrder !== b.renderOrder) {
            return a.renderOrder - b.renderOrder;
        }
        if (a.z !== b.z) {
            return a.z - b.z;
        }
        return a.sequence - b.sequence;
    };

    constructor(textureSlotBudget: number = DEFAULT_TEXTURE_SLOT_BUDGET) {
        this._textureSlotBudget = Math.max(1, Math.min(32, Math.floor(textureSlotBudget)));
    }

    get drawCount(): number {
        return this._drawnCount;
    }

    get textureId(): string | null {
        return this._textureId;
    }

    /** `[start, count]` pairs over the draw-ordered stream, per texture group. */
    get groupRanges(): Int32Array {
        return this._groupRanges;
    }

    /** `groupCount + 1` slice bounds into `groupTextureIds`. */
    get groupTextureOffsets(): Int32Array {
        return this._groupTextureOffsets;
    }

    /** Slot-ordered texture ids, one contiguous slice per group. */
    get groupTextureIds(): readonly string[] {
        return this._groupTextureIds;
    }

    get groupCount(): number {
        return this._groupCount;
    }

    get transformData(): Float32Array {
        return this._transformData;
    }

    get staticData(): Float32Array {
        return this._staticData;
    }

    get transformDirty(): boolean {
        return this._transformDirty;
    }

    get staticsDirty(): boolean {
        return this._staticsDirty;
    }

    get cacheHit(): boolean {
        return !this._transformDirty && !this._staticsDirty;
    }

    /**
     * Number of registry entries the most recent `refresh` revalidated.
     * Zero on a settled frame — the world clock proved nothing changed — and
     * the full entry count whenever the sweep had to run. Exposed for tests
     * and profiling; the render path never reads it.
     */
    get lastRefreshScanCount(): number {
        return this._lastRefreshScanCount;
    }

    /** True once right after the registry rebuilds its entry list. */
    get rebuiltThisFrame(): boolean {
        return this._rebuiltThisFrame;
    }

    /**
     * Rebuilds the entry list when the actor set or pass changed. Cached
     * ineligibility is scoped to the exact actor array + pass so a scene that
     * needs the general path does not get rescanned every frame.
     */
    sync(actors: readonly Actor[], passId: string): SceneSpriteInstanceSyncStatus {
        if (
            this._ineligible &&
            this._ineligibleActorsRef === actors &&
            this._ineligibleActorCount === actors.length &&
            this._ineligiblePassId === passId
        ) {
            return 'ineligible';
        }

        if (
            !this._needsRebuild &&
            this._actorsRef === actors &&
            this._actorCount === actors.length &&
            this._passId === passId
        ) {
            return this._empty ? 'empty' : 'ready';
        }

        return this._build(actors, passId);
    }

    /**
     * Revalidates every entry against its component revisions and updates the
     * instance streams. Returns false when the entry list must be rebuilt (a
     * component set changed or the pass became ineligible mid-frame).
     */
    refresh(cameraFrame: SceneCameraFrameState): boolean {
        const cameraChanged = this._updateCamera(cameraFrame);
        const clock = this._worldClock;

        // Settled frame: no component in this pass has mutated since the last
        // completed refresh and the camera has not moved, so the instance
        // streams, cull flags and draw order are still exact. The per-entry
        // revision sweep exists only to discover such mutations, so it is
        // skipped entirely — a static pass costs one clock comparison.
        if (
            !cameraChanged &&
            !this._needsRebuild &&
            clock !== null &&
            clock.value === this._worldRevision
        ) {
            this._lastRefreshScanCount = 0;
            return true;
        }

        // An actor that was not renderable when the entries were built can
        // become renderable again (activated, enabled, given a texture or a
        // `SpriteRenderer`) without any of the existing entries changing, and
        // it is not represented in the sweep below. Revisions are compared
        // instead of components so this stays allocation-free; scenes with no
        // excluded actors pay nothing.
        if (this._excludedChanged()) {
            this._needsRebuild = true;
            return false;
        }

        const entries = this._entries;
        const count = entries.length;
        this._lastRefreshScanCount = count;
        const frustum = cameraFrame.camera3D.frustum;
        const grew = this._ensureCapacity(count);
        const transforms = this._transformData;
        const statics = this._staticData;
        const sphere = this._sphere;
        const center = this._sphereCenter;

        if (grew) {
            this._transformDirty = true;
            this._staticsDirty = true;
            this._rebuiltThisFrame = true;
        }

        let orderDirty = false;
        let transformDirty = this._transformDirty;
        let staticsDirty = this._staticsDirty;

        for (let index = 0; index < count; index += 1) {
            const entry = entries[index]!;

            if (entry.actor.revision !== entry.actorRevision) {
                this._needsRebuild = true;
                return false;
            }

            if (entry.ancestors && this._ancestorsChanged(entry)) {
                this._needsRebuild = true;
                return false;
            }

            if (entry.renderer.revision !== entry.rendererRevision) {
                const result = this._reclassifyRenderer(entry);
                if (result === 'ineligible') {
                    this._markIneligible();
                    return false;
                }
                staticsDirty = true;
                orderDirty = true;
            }
            if (entry.hidden) {
                continue;
            }

            const transformRevision = entry.transform.revision;
            const transformChanged = transformRevision !== entry.transformRevision;
            if (!transformChanged && !cameraChanged) {
                continue;
            }

            // Re-parenting bumps the transform revision, so the root/child
            // classification only needs rechecking when a transform changed.
            const parent = entry.hierarchy ? entry.hierarchy.parent : undefined;
            const isRoot = parent === undefined || parent === null;
            if (isRoot !== entry.isRoot) {
                this._needsRebuild = true;
                return false;
            }

            let z: number;
            let maxScale: number;
            // A culled entry is never written by `_writeAll`; if it has no
            // cached z yet, force one so cull bookkeeping stays stable when
            // only the camera moves.
            const writeTransform = transformChanged || !Number.isFinite(entry.z);
            if (writeTransform) {
                entry.transformRevision = transformRevision;
            }
            if (entry.isRoot) {
                if (writeTransform) {
                    z = this._writeRootTransform(entry, transforms);
                    transformDirty = true;
                } else {
                    z = entry.z;
                }
                const scale = entry.transform.scale;
                maxScale = Math.max(Math.abs(scale.x), Math.abs(scale.y));
                const position = entry.transform.position;
                center.x = position.x;
                center.y = position.y;
            } else {
                if (writeTransform) {
                    z = this._writeWorldTransform(entry, transforms);
                    transformDirty = true;
                } else {
                    z = entry.z;
                }
                const worldScale = entry.transform.worldScale;
                maxScale = Math.max(Math.abs(worldScale.x), Math.abs(worldScale.y));
                const worldPosition = entry.transform.worldPosition;
                center.x = worldPosition.x;
                center.y = worldPosition.y;
            }
            if (z !== entry.z) {
                entry.z = z;
                orderDirty = true;
            }

            center.z = z;
            sphere.radius = entry.cullRadius * maxScale;
            let culled: boolean;
            if (this._aabbValid) {
                // Conservative test against the frustum's world-space AABB:
                // cheaper than a plane test per sprite and never culls a
                // sphere that a plane test would keep.
                const radius = sphere.radius;
                culled =
                    center.x + radius < this._aabbMinX ||
                    center.x - radius > this._aabbMaxX ||
                    center.y + radius < this._aabbMinY ||
                    center.y - radius > this._aabbMaxY ||
                    center.z + radius < this._aabbMinZ ||
                    center.z - radius > this._aabbMaxZ;
            } else {
                culled = !frustum.intersectsSphere(sphere);
            }
            if (culled !== entry.culled) {
                entry.culled = culled;
                orderDirty = true;
            }
        }

        if (orderDirty || grew) {
            this._rebuildOrder();
            this._rebuildGroups();
            this._writeAll(transforms, statics);
            transformDirty = true;
            staticsDirty = true;
        }

        this._transformDirty = transformDirty;
        this._staticsDirty = staticsDirty;
        // Read the clock after the sweep so a mutation that landed while the
        // sweep ran is still detected on the next frame.
        if (clock !== null) {
            this._worldRevision = clock.value;
        }
        return true;
    }

    /** Marks drawn renderers active; only used when the frame tracks them. */
    markActive(frameState: SceneRenderFrameState): void {
        const entries = this._entries;
        const order = this._order;
        for (let slot = 0; slot < this._drawnCount; slot += 1) {
            frameState.markActiveRenderer(entries[order[slot]!]!.renderer.id);
        }
    }

    /** Clears the per-frame dirty flags after the streams were uploaded. */
    commit(): void {
        this._transformDirty = false;
        this._staticsDirty = false;
        this._rebuiltThisFrame = false;
    }

    reset(): void {
        this._entries.length = 0;
        this._excluded.length = 0;
        this._excludedCount = 0;
        this._order.length = 0;
        this._transformData = new Float32Array(0);
        this._staticData = new Float32Array(0);
        this._capacity = 0;
        this._textureId = null;
        this._passId = '';
        this._actorsRef = null;
        this._actorCount = -1;
        this._empty = false;
        this._needsRebuild = true;
        this._rebuiltThisFrame = false;
        this._worldClock = null;
        this._worldRevision = -1;
        this._ineligibleActorsRef = null;
        this._ineligibleActorCount = -1;
        this._ineligiblePassId = '';
        this._ineligible = false;
        this._drawnCount = 0;
        this._groupCount = 0;
        this._groupTextureIds.length = 0;
        this._slotMap.clear();
        this._transformDirty = false;
        this._staticsDirty = false;
        this._hasCameraMatrix = false;
    }

    private _build(actors: readonly Actor[], passId: string): SceneSpriteInstanceSyncStatus {
        this._passId = passId;
        this._actorsRef = actors;
        this._actorCount = actors.length;
        this._needsRebuild = false;
        this._empty = false;
        this._ineligible = false;
        this._textureId = null;
        this._drawnCount = 0;
        this._worldClock = resolveRenderMutationClock(actors[0]);

        const entries = this._entries;
        let count = 0;
        let excludedCount = 0;
        const hierarchyType = resolveHierarchyType(actors[0]);

        for (let index = 0; index < actors.length; index += 1) {
            const actor = actors[index]!;
            if (!actor.active) {
                excludedCount = this._recordExcluded(excludedCount, actor, null, null);
                continue;
            }

            const transform = actor.getComponent(Transform);
            const renderer = actor.getComponent(SpriteRenderer);
            if (!transform || !renderer) {
                excludedCount = this._recordExcluded(excludedCount, actor, transform ?? null, renderer ?? null);
                continue;
            }
            if (
                !renderer.enabled ||
                !renderer.visible ||
                !renderer.hasRenderableSource ||
                renderer.passId !== passId
            ) {
                excludedCount = this._recordExcluded(excludedCount, actor, transform, renderer);
                continue;
            }
            if (renderer.materialId !== null || renderer.textureId === null) {
                return this._markIneligible();
            }
            if (renderer.isNineSlice) {
                return this._markIneligible();
            }

            const hierarchy = hierarchyType ? actor.getComponent(hierarchyType) ?? null : null;
            const chain = this._resolveMaskChain(actor);
            if (!chain) {
                return this._markIneligible();
            }

            let entry = entries[count];
            if (!entry) {
                entry = createEntry();
                entries[count] = entry;
            }

            entry.actor = actor;
            entry.transform = transform;
            entry.renderer = renderer;
            entry.hierarchy = hierarchy;
            entry.ancestors = chain.ancestors;
            entry.isRoot = chain.isRoot;
            if (chain.ancestors) {
                const revisions = entry.ancestorsRevision;
                revisions.length = chain.ancestors.length;
                for (let a = 0; a < chain.ancestors.length; a += 1) {
                    revisions[a] = chain.ancestors[a]!.revision;
                }
            } else {
                entry.ancestorsRevision.length = 0;
            }
            entry.textureId = renderer.textureId;
            entry.actorRevision = actor.revision;
            entry.transformRevision = transform.revision;
            entry.rendererRevision = renderer.revision;
            entry.hidden = false;
            entry.culled = false;
            entry.slot = count;
            entry.sequence = count;
            entry.z = Number.NaN;
            this._refreshStatic(entry);
            count += 1;
        }

        entries.length = count;
        this._excludedCount = excludedCount;

        // Snapshot the clock after the build so a mutation that landed while
        // the entries were being created still forces a refresh next frame.
        this._worldRevision = this._worldClock?.value ?? -1;

        if (count === 0) {
            this._empty = true;
            this._order.length = 0;
            this._drawnCount = 0;
            this._groupCount = 0;
            this._groupTextureIds.length = 0;
            this._textureId = null;
            this._transformDirty = false;
            this._staticsDirty = false;
            return 'empty';
        }

        this._ensureCapacity(count);
        this._rebuiltThisFrame = true;
        this._rebuildOrder();
        this._rebuildGroups();
        this._writeAll(this._transformData, this._staticData);
        this._transformDirty = true;
        this._staticsDirty = true;
        return 'ready';
    }

    private _markIneligible(): 'ineligible' {
        this._ineligible = true;
        this._ineligibleActorsRef = this._actorsRef;
        this._ineligibleActorCount = this._actorCount;
        this._ineligiblePassId = this._passId;
        this._entries.length = 0;
        this._excluded.length = 0;
        this._excludedCount = 0;
        this._order.length = 0;
        this._drawnCount = 0;
        this._groupCount = 0;
        this._groupTextureIds.length = 0;
        this._slotMap.clear();
        this._empty = false;
        this._textureId = null;
        return 'ineligible';
    }

    /**
     * Walks the ancestor chain once per rebuild. Any `SpriteMask` anywhere in
     * the chain (enabled or not) disqualifies the pass: enabling it later does
     * not bump the sprite's own revision, so the registry refuses the pass up
     * front instead of risking an unmasked frame.
     */
    private _resolveMaskChain(
        actor: Actor
    ): { isRoot: boolean; ancestors: Actor[] | null } | null {
        if (actor.getComponent(SpriteMask)) {
            return null;
        }

        const firstParent = actor.parent;
        if (!firstParent) {
            // Hierarchy is a core component on every actor; a missing one still
            // means "no parent" for the frame check below.
            return { isRoot: true, ancestors: null };
        }

        const ancestors: Actor[] = [];
        let current: Actor | undefined = firstParent;
        while (current) {
            if (current.getComponent(SpriteMask)) {
                return null;
            }
            ancestors.push(current);
            current = current.parent;
        }

        return { isRoot: false, ancestors };
    }

    private _recordExcluded(
        count: number,
        actor: Actor,
        transform: Transform | null,
        renderer: SpriteRenderer | null
    ): number {
        const excluded = this._excluded;
        let entry = excluded[count];
        if (!entry) {
            entry = {
                actor: null as unknown as Actor,
                transform: null,
                renderer: null,
                actorRevision: -1,
                transformRevision: -1,
                rendererRevision: -1,
            };
            excluded[count] = entry;
        }

        entry.actor = actor;
        entry.transform = transform;
        entry.renderer = renderer;
        entry.actorRevision = actor.revision;
        entry.transformRevision = transform ? transform.revision : -1;
        entry.rendererRevision = renderer ? renderer.revision : -1;
        return count + 1;
    }

    /**
     * True when an excluded actor gained something that can make it
     * renderable again. Transform revisions are deliberately ignored: moving a
     * deactivated/pooled sprite cannot change why it was excluded, and
     * checking it would force a rebuild on every frame a sprite pool idles.
     */
    private _excludedChanged(): boolean {
        const excluded = this._excluded;
        for (let index = 0; index < this._excludedCount; index += 1) {
            const entry = excluded[index]!;
            if (entry.actor.revision !== entry.actorRevision) {
                return true;
            }
            if (entry.renderer !== null && entry.renderer.revision !== entry.rendererRevision) {
                return true;
            }
        }
        return false;
    }

    private _ancestorsChanged(entry: SceneSpriteInstanceEntry): boolean {
        const ancestors = entry.ancestors!;
        const revisions = entry.ancestorsRevision;
        for (let index = 0; index < ancestors.length; index += 1) {
            if (ancestors[index]!.revision !== revisions[index]) {
                return true;
            }
        }
        return false;
    }

    private _reclassifyRenderer(entry: SceneSpriteInstanceEntry): SceneSpriteInstanceReclassify {
        const renderer = entry.renderer;
        entry.rendererRevision = renderer.revision;

        if (
            !renderer.enabled ||
            !renderer.visible ||
            !renderer.hasRenderableSource ||
            renderer.passId !== this._passId
        ) {
            entry.hidden = true;
            return 'ok';
        }

        if (renderer.materialId !== null || renderer.textureId === null) {
            return 'ineligible';
        }
        if (renderer.isNineSlice) {
            return 'ineligible';
        }
        if (entry.actor.getComponent(SpriteMask)) {
            return 'ineligible';
        }
        // A texture swap no longer rebuilds the pass: the entry adopts the new
        // id and the group/slot layout is recomputed with the order stream.
        entry.textureId = renderer.textureId;

        if (entry.hidden) {
            entry.hidden = false;
            // Force a transform + cull refresh for the newly visible sprite.
            entry.transformRevision = -1;
            entry.z = Number.NaN;
        }

        this._refreshStatic(entry);
        return 'ok';
    }

    private _refreshStatic(entry: SceneSpriteInstanceEntry): void {
        const renderer = entry.renderer;
        const size = renderer.getRenderSize();
        const anchor = renderer.getRenderAnchor();
        const uv = renderer.getRenderUvRect();
        const color = renderer.getRenderColor();

        entry.width = size.x;
        entry.height = size.y;
        entry.anchorX = anchor.x;
        entry.anchorY = anchor.y;

        let u0 = uv.x;
        let v0 = uv.y;
        let u1 = uv.x + uv.width;
        let v1 = uv.y + uv.height;
        if (renderer.flipX) {
            const swap = u0;
            u0 = u1;
            u1 = swap;
        }
        if (renderer.flipY) {
            const swap = v0;
            v0 = v1;
            v1 = swap;
        }
        entry.u0 = u0;
        entry.v0 = v0;
        entry.du = u1 - u0;
        entry.dv = v1 - v0;

        entry.r = color.r;
        entry.g = color.g;
        entry.b = color.b;
        entry.a = color.a;

        const localCenterX = (0.5 - anchor.x) * size.x;
        const localCenterY = (0.5 - anchor.y) * size.y;
        entry.cullRadius =
            Math.hypot(localCenterX, localCenterY) + 0.5 * Math.hypot(size.x, size.y);

        entry.sortingLayer = renderer.sortingLayer;
        entry.renderOrder = renderer.renderOrder;
    }

    private _rebuildOrder(): void {
        const entries = this._entries;
        const order = this._order;
        order.length = 0;
        for (let index = 0; index < entries.length; index += 1) {
            const entry = entries[index]!;
            if (entry.hidden || entry.culled) {
                continue;
            }
            order.push(index);
        }
        order.sort(this._compareEntries);
        for (let slot = 0; slot < order.length; slot += 1) {
            entries[order[slot]!]!.slot = slot;
        }
        this._drawnCount = order.length;
    }

    /**
     * Cuts the draw-ordered stream into contiguous texture groups. Each group
     * keeps at most `textureSlotBudget` distinct textures bound as sampler
     * slots; a sprite whose texture is already slotted extends the current
     * group without cost, so texture reuse collapses batches. Groups are
     * consecutive ranges of the order stream — painter order is preserved
     * exactly across group boundaries, and within a group the instance order
     * inside the single draw call matches it too.
     */
    private _rebuildGroups(): void {
        const count = this._drawnCount;
        const order = this._order;
        const entries = this._entries;
        this._ensureGroupCapacity(count);
        const ranges = this._groupRanges;
        const offsets = this._groupTextureOffsets;
        const ids = this._groupTextureIds;
        const slotMap = this._slotMap;
        const budget = this._textureSlotBudget;

        ids.length = 0;
        slotMap.clear();
        offsets[0] = 0;
        let groupCount = 0;
        let groupStart = 0;

        for (let slot = 0; slot < count; slot += 1) {
            const entry = entries[order[slot]!]!;
            let textureSlot = slotMap.get(entry.textureId);
            if (textureSlot === undefined) {
                if (slotMap.size >= budget) {
                    ranges[groupCount * 2] = groupStart;
                    ranges[groupCount * 2 + 1] = slot - groupStart;
                    groupCount += 1;
                    offsets[groupCount] = ids.length;
                    groupStart = slot;
                    slotMap.clear();
                }
                textureSlot = slotMap.size;
                slotMap.set(entry.textureId, textureSlot);
                ids.push(entry.textureId);
            }
            entry.textureSlot = textureSlot;
        }

        if (count > 0) {
            ranges[groupCount * 2] = groupStart;
            ranges[groupCount * 2 + 1] = count - groupStart;
            groupCount += 1;
            offsets[groupCount] = ids.length;
        }

        this._groupCount = groupCount;
        this._textureId = groupCount === 1 && ids.length === 1 ? ids[0]! : null;
    }

    private _ensureGroupCapacity(count: number): void {
        if (this._groupCapacity >= count) {
            return;
        }
        let capacity = Math.max(64, this._groupCapacity);
        while (capacity < count) {
            capacity *= 2;
        }
        this._groupCapacity = capacity;
        this._groupRanges = new Int32Array(capacity * 2);
        this._groupTextureOffsets = new Int32Array(capacity + 1);
    }

    /**
     * Rewrites the full instance streams in draw order. Only runs when the
     * entry set or draw order changed, never on a settled static frame.
     */
    private _writeAll(transforms: Float32Array, statics: Float32Array): void {
        const entries = this._entries;
        const order = this._order;
        for (let slot = 0; slot < order.length; slot += 1) {
            const entry = entries[order[slot]!]!;
            entry.z = entry.isRoot
                ? this._writeRootTransform(entry, transforms)
                : this._writeWorldTransform(entry, transforms);
            this._writeStatic(entry, statics);
        }
    }

    private _writeStatic(entry: SceneSpriteInstanceEntry, statics: Float32Array): void {
        const offset = entry.slot * SPRITE_STATIC_FLOATS_PER_INSTANCE;
        statics[offset] = entry.width;
        statics[offset + 1] = entry.height;
        statics[offset + 2] = entry.anchorX;
        statics[offset + 3] = entry.anchorY;
        statics[offset + 4] = entry.u0;
        statics[offset + 5] = entry.v0;
        statics[offset + 6] = entry.du;
        statics[offset + 7] = entry.dv;
        statics[offset + 8] = entry.r;
        statics[offset + 9] = entry.g;
        statics[offset + 10] = entry.b;
        statics[offset + 11] = entry.a;
        statics[offset + 12] = entry.textureSlot;
    }

    /**
     * Writes the 2D affine for a root transform straight from its local TRS.
     * Root world matrices are exactly the local matrix, so this reproduces
     * `Mat4.fromTRS` without building a 4×4 or resolving the hierarchy.
     */
    private _writeRootTransform(entry: SceneSpriteInstanceEntry, transforms: Float32Array): number {
        const transform = entry.transform;
        const position = transform.position;
        const scale = transform.scale;
        const rotation = transform.rotation;

        const qx = rotation.x;
        const qy = rotation.y;
        const qz = rotation.z;
        const qw = rotation.w;
        const sx = scale.x;
        const sy = scale.y;
        const offset = entry.slot * SPRITE_TRANSFORM_FLOATS_PER_INSTANCE;

        // Z-only rotation is the overwhelmingly common 2D case: the affine
        // collapses to cos/sin scaled per axis, no x/y cross terms.
        if (qx === 0 && qy === 0) {
            const lengthSq = qz * qz + qw * qw;
            if (lengthSq < QUAT_LENGTH_EPSILON) {
                return this._writeWorldTransform(entry, transforms);
            }
            const inverseLength = 1 / Math.sqrt(lengthSq);
            const nz = qz * inverseLength;
            const nw = qw * inverseLength;
            const cos = 1 - 2 * nz * nz;
            const sin = 2 * nw * nz;
            transforms[offset] = cos * sx;
            transforms[offset + 1] = -sin * sy;
            transforms[offset + 2] = sin * sx;
            transforms[offset + 3] = cos * sy;
            transforms[offset + 4] = position.x;
            transforms[offset + 5] = position.y;
            return position.z;
        }

        const lengthSq = qx * qx + qy * qy + qz * qz + qw * qw;

        if (lengthSq < QUAT_LENGTH_EPSILON) {
            return this._writeWorldTransform(entry, transforms);
        }

        const inverseLength = 1 / Math.sqrt(lengthSq);
        const nx = qx * inverseLength;
        const ny = qy * inverseLength;
        const nz = qz * inverseLength;
        const nw = qw * inverseLength;

        const x2 = nx + nx;
        const y2 = ny + ny;
        const z2 = nz + nz;
        const xx = nx * x2;
        const xy = nx * y2;
        const yy = ny * y2;
        const zz = nz * z2;
        const wz = nw * z2;

        transforms[offset] = (1 - (yy + zz)) * sx;
        transforms[offset + 1] = (xy - wz) * sy;
        transforms[offset + 2] = (xy + wz) * sx;
        transforms[offset + 3] = (1 - (xx + zz)) * sy;
        transforms[offset + 4] = position.x;
        transforms[offset + 5] = position.y;

        return position.z;
    }

    private _writeWorldTransform(entry: SceneSpriteInstanceEntry, transforms: Float32Array): number {
        const matrix = entry.transform.worldMatrix.data;
        const offset = entry.slot * SPRITE_TRANSFORM_FLOATS_PER_INSTANCE;
        transforms[offset] = matrix[0] ?? 0;
        transforms[offset + 1] = matrix[1] ?? 0;
        transforms[offset + 2] = matrix[4] ?? 0;
        transforms[offset + 3] = matrix[5] ?? 0;
        transforms[offset + 4] = matrix[3] ?? 0;
        transforms[offset + 5] = matrix[7] ?? 0;
        return matrix[11] ?? 0;
    }

    private _ensureCapacity(count: number): boolean {
        if (count <= this._capacity) {
            return false;
        }

        let capacity = Math.max(64, this._capacity);
        while (capacity < count) {
            capacity *= 2;
        }
        this._capacity = capacity;
        this._transformData = new Float32Array(capacity * SPRITE_TRANSFORM_FLOATS_PER_INSTANCE);
        this._staticData = new Float32Array(capacity * SPRITE_STATIC_FLOATS_PER_INSTANCE);
        return true;
    }

    private _updateCamera(cameraFrame: SceneCameraFrameState): boolean {
        const source = cameraFrame.viewProjectionMatrix.data;
        const cached = this._cameraMatrix;
        if (this._hasCameraMatrix) {
            let same = true;
            for (let index = 0; index < 16; index += 1) {
                if (cached[index] !== (source[index] ?? 0)) {
                    same = false;
                    break;
                }
            }
            if (same) {
                return false;
            }
        }

        for (let index = 0; index < 16; index += 1) {
            cached[index] = source[index] ?? 0;
        }
        this._hasCameraMatrix = true;
        this._updateFrustumAabb(cameraFrame);
        return true;
    }

    /**
     * Unprojects the NDC cube through the inverse view-projection once per
     * camera change. The resulting world AABB bounds the frustum, so sprites
     * can be culled with six comparisons instead of a plane test each.
     */
    private _updateFrustumAabb(cameraFrame: SceneCameraFrameState): void {
        this._aabbValid = false;

        let inverse: Mat4;
        try {
            inverse = Mat4.invert(
                cameraFrame.viewProjectionMatrix,
                this._inverseViewProjection
            ) as Mat4;
        } catch {
            return;
        }

        const data = inverse.data;
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let minZ = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let maxZ = Number.NEGATIVE_INFINITY;

        for (let corner = 0; corner < 8; corner += 1) {
            const ndcX = (corner & 1) === 0 ? -1 : 1;
            const ndcY = (corner & 2) === 0 ? -1 : 1;
            const ndcZ = (corner & 4) === 0 ? -1 : 1;

            const clipX =
                (data[0] ?? 0) * ndcX + (data[1] ?? 0) * ndcY + (data[2] ?? 0) * ndcZ + (data[3] ?? 0);
            const clipY =
                (data[4] ?? 0) * ndcX + (data[5] ?? 0) * ndcY + (data[6] ?? 0) * ndcZ + (data[7] ?? 0);
            const clipZ =
                (data[8] ?? 0) * ndcX + (data[9] ?? 0) * ndcY + (data[10] ?? 0) * ndcZ + (data[11] ?? 0);
            const clipW =
                (data[12] ?? 0) * ndcX + (data[13] ?? 0) * ndcY + (data[14] ?? 0) * ndcZ + (data[15] ?? 0);

            if (!Number.isFinite(clipW) || Math.abs(clipW) < 1e-6) {
                return;
            }

            const worldX = clipX / clipW;
            const worldY = clipY / clipW;
            const worldZ = clipZ / clipW;
            if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(worldZ)) {
                return;
            }

            if (worldX < minX) minX = worldX;
            if (worldY < minY) minY = worldY;
            if (worldZ < minZ) minZ = worldZ;
            if (worldX > maxX) maxX = worldX;
            if (worldY > maxY) maxY = worldY;
            if (worldZ > maxZ) maxZ = worldZ;
        }

        this._aabbMinX = minX;
        this._aabbMinY = minY;
        this._aabbMinZ = minZ;
        this._aabbMaxX = maxX;
        this._aabbMaxY = maxY;
        this._aabbMaxZ = maxZ;
        this._aabbValid = true;
    }
}

/**
 * Resolves the world render-mutation clock from an actor. Detached or mocked
 * actors have no world clock; the registry then keeps the conservative
 * full-sweep behaviour instead of skipping work it cannot prove unnecessary.
 */
const resolveRenderMutationClock = (actor: Actor | undefined): RenderMutationClock | null => {
    if (!actor) {
        return null;
    }

    const world = (
        actor as unknown as { world?: { renderMutationClock?: RenderMutationClock } }
    ).world;
    return world?.renderMutationClock ?? null;
};

/** Resolves the world-registered Hierarchy type (falls back to the core class). */
const resolveHierarchyType = (actor: Actor | undefined): typeof Hierarchy | null => {
    const registry = actor
        ? (actor.world as unknown as { registry?: Record<string, unknown> } | undefined)?.registry
        : undefined;
    const registered = registry?.Hierarchy as typeof Hierarchy | undefined;
    return registered ?? (Hierarchy as typeof Hierarchy) ?? null;
};
