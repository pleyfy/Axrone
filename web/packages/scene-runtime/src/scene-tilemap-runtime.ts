import type { AssetDatabase } from '@axrone/asset-core';
import {
    AssetChunkPager,
    chunkAssetCodec,
    type AssetTilemapSchema,
    type TilemapAssetDefinition,
    type TilesetDefinition,
} from '@axrone/asset-tilemap';
import type {
    ComponentRegistry,
    System,
    SystemQuery,
} from '@axrone/ecs-runtime';
import { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import {
    TilemapBuilder,
    packChunkKey,
    type ChunkSnapshot,
    type LayerSpec,
    type TilemapEngine,
} from '@axrone/tilemap';
import {
    viewportGridBounds,
    type WorldRect,
} from '@axrone/tilemap/query';
import { findPath, type PathOptions, type PathResult } from '@axrone/tilemap/path';
import { decode, encode, err, ok, type Result } from '@axrone/utility';
import {
    TilemapAssetErrorCode,
    tilemapAssetError,
    type TilemapAssetError,
} from '@axrone/asset-tilemap';
import { TilemapAgent } from './components/tilemap-agent';

export interface TilemapLayerOverride {
    readonly name: string;
    readonly visible?: boolean;
    readonly opacity?: number;
}

export interface TilemapRuntimeConfig {
    readonly mapId: string;
    /** Asset database key of the native tilemap definition; defaults to mapId. */
    readonly definitionKey?: string;
    readonly maxLoadedChunks?: number;
    readonly maxDirtyChunks?: number;
}

export interface TilemapRuntimeSnapshot {
    readonly mapId: string;
    readonly definitionKey: string;
    readonly revision: number;
    readonly layerOverrides: readonly TilemapLayerOverride[];
    readonly dirtyChunks: readonly { readonly key: number; readonly data: string }[];
}

const fail = (message: string, cause?: unknown): Result<never, TilemapAssetError> =>
    err(
        tilemapAssetError(TilemapAssetErrorCode.ASSET_IO_ERROR, message, {
            cause,
        })
    );

const findTileset = (
    database: AssetDatabase<AssetTilemapSchema>,
    name: string
): TilesetDefinition | undefined => {
    const direct = database.get({ kind: 'tileset', key: name });
    if (direct !== undefined) return direct.data as TilesetDefinition;
    return database
        .find({ kind: 'tileset' })
        .map((record) => record.data as TilesetDefinition)
        .find((tileset) => tileset.name === name);
};

/**
 * One loaded tilemap: engine + pager + tilesets + layer overrides. Chunk
 * streaming and snapshots live here so components stay serializable data.
 */
export class TilemapRuntime {
    readonly mapId: string;
    readonly definitionKey: string;
    readonly definition: TilemapAssetDefinition;
    readonly engine: TilemapEngine<readonly LayerSpec[]>;
    readonly pager: AssetChunkPager;
    readonly tilesets: readonly TilesetDefinition[];
    readonly #overrides = new Map<string, TilemapLayerOverride>();
    readonly #trackedChunks = new Map<number, { chunkX: number; chunkY: number }>();
    readonly #pendingChunks = new Set<number>();
    #revision = 0;

    private constructor(
        database: AssetDatabase<AssetTilemapSchema>,
        config: TilemapRuntimeConfig,
        definition: TilemapAssetDefinition,
        tilesets: readonly TilesetDefinition[],
        engine: TilemapEngine<readonly LayerSpec[]>,
        pager: AssetChunkPager
    ) {
        this.mapId = config.mapId;
        this.definitionKey = config.definitionKey ?? config.mapId;
        this.definition = definition;
        this.tilesets = tilesets;
        this.engine = engine;
        this.pager = pager;
        for (const layer of definition.layers) {
            this.#overrides.set(layer.name, { name: layer.name });
        }
    }

    static async open(
        database: AssetDatabase<AssetTilemapSchema>,
        config: TilemapRuntimeConfig
    ): Promise<Result<TilemapRuntime, TilemapAssetError>> {
        const definitionKey = config.definitionKey ?? config.mapId;
        try {
            const record = database.get({ kind: 'tilemap', key: definitionKey });
            if (record === undefined) {
                return fail(`tilemap definition ${definitionKey} is not loaded`);
            }
            const definition = record.data as TilemapAssetDefinition;
            const tilesets: TilesetDefinition[] = [];
            for (const name of definition.tilesets) {
                const tileset = findTileset(database, name);
                if (tileset === undefined) {
                    return fail(`tileset ${name} is not loaded`);
                }
                tilesets.push(tileset);
            }
            const pager = new AssetChunkPager(database, {
                mapKey: config.mapId,
                chunkShift: definition.chunkShift,
                layerCount: definition.layers.length,
            });
            const built = TilemapBuilder.create()
                .withProjection(definition.projection)
                .withChunkShift(definition.chunkShift)
                .withCapacity(config.maxLoadedChunks ?? 128)
                .withDirtyBudget(config.maxDirtyChunks ?? 32)
                .withPager(pager)
                .withLayers(definition.layers as readonly LayerSpec[])
                .build();
            if (built.isErr()) {
                return fail(
                    `tilemap engine for ${config.mapId} is invalid`,
                    built.expectErr('engine')
                );
            }
            return ok(
                new TilemapRuntime(
                    database,
                    config,
                    definition,
                    tilesets,
                    built.get(),
                    pager
                )
            );
        } catch (cause) {
            return fail(`failed to open tilemap ${config.mapId}`, cause);
        }
    }

    get revision(): number {
        return this.#revision;
    }

    get layerOverrides(): readonly TilemapLayerOverride[] {
        return [...this.#overrides.values()];
    }

    get pendingChunkLoads(): number {
        return this.#pendingChunks.size;
    }

    setLayerOverride(name: string, override: Omit<TilemapLayerOverride, 'name'>): void {
        const current = this.#overrides.get(name);
        if (current === undefined) return;
        this.#overrides.set(name, { ...current, name, ...override });
        this.#revision++;
    }

    write(
        layer: string | number,
        gridX: number,
        gridY: number,
        word: Parameters<TilemapEngine<readonly LayerSpec[]>['write']>[3]
    ): ReturnType<TilemapEngine<readonly LayerSpec[]>['write']> {
        const result = this.engine.write(layer, gridX, gridY, word);
        if (result.isOk()) this.#revision++;
        return result;
    }

    fillRect(
        layer: string | number,
        gridX: number,
        gridY: number,
        width: number,
        height: number,
        word: Parameters<TilemapEngine<readonly LayerSpec[]>['fillRect']>[5]
    ): ReturnType<TilemapEngine<readonly LayerSpec[]>['fillRect']> {
        const result = this.engine.fillRect(layer, gridX, gridY, width, height, word);
        if (result.isOk() && result.get() > 0) this.#revision++;
        return result;
    }

    path(
        startX: number,
        startY: number,
        goalX: number,
        goalY: number,
        options: PathOptions = {}
    ): PathResult {
        const layer =
            this.definition.layers.find((entry) => entry.collision)?.name ?? 0;
        return findPath(this.engine, layer, startX, startY, goalX, goalY, options);
    }

    /** Loads chunks around the camera; resolves with the number newly loaded. */
    async prefetchAround(camera: WorldRect, radiusChunks = 2): Promise<number> {
        const bounds = viewportGridBounds(this.engine.projection, camera);
        const chunkSize = this.engine.chunkSize;
        const startX = Math.floor(bounds.x / chunkSize) - radiusChunks;
        const startY = Math.floor(bounds.y / chunkSize) - radiusChunks;
        const endX = Math.floor((bounds.x + bounds.width) / chunkSize) + radiusChunks;
        const endY = Math.floor((bounds.y + bounds.height) / chunkSize) + radiusChunks;
        const referenced = new Set(
            this.definition.chunks.map(
                (chunk) => packChunkKey(chunk.chunkX, chunk.chunkY) >>> 0
            )
        );
        const loads: Promise<void>[] = [];
        let loaded = 0;
        for (let chunkY = startY; chunkY <= endY; chunkY++) {
            for (let chunkX = startX; chunkX <= endX; chunkX++) {
                const numericKey = packChunkKey(chunkX, chunkY) >>> 0;
                if (!referenced.has(numericKey)) continue;
                if (this.#pendingChunks.has(numericKey)) continue;
                if (this.engine.isChunkResidentAt(chunkX * chunkSize, chunkY * chunkSize)) {
                    continue;
                }
                this.#pendingChunks.add(numericKey);
                loads.push(
                    this.engine
                        .loadChunk(chunkX, chunkY)
                        .then((result) => {
                            if (result.isOk() && result.get()) {
                                this.#trackedChunks.set(numericKey, { chunkX, chunkY });
                                loaded++;
                                this.#revision++;
                            }
                        })
                        .catch(() => undefined)
                        .finally(() => this.#pendingChunks.delete(numericKey))
                );
            }
        }
        await Promise.all(loads);
        return loaded;
    }

    /** Evicts tracked chunks outside the camera window, writing them back. */
    async trimOutside(camera: WorldRect, radiusChunks = 2): Promise<number> {
        const bounds = viewportGridBounds(this.engine.projection, camera);
        const chunkSize = this.engine.chunkSize;
        const startX = Math.floor(bounds.x / chunkSize) - radiusChunks;
        const startY = Math.floor(bounds.y / chunkSize) - radiusChunks;
        const endX = Math.floor((bounds.x + bounds.width) / chunkSize) + radiusChunks;
        const endY = Math.floor((bounds.y + bounds.height) / chunkSize) + radiusChunks;
        let evicted = 0;
        for (const [key, chunk] of this.#trackedChunks) {
            if (
                chunk.chunkX >= startX &&
                chunk.chunkX <= endX &&
                chunk.chunkY >= startY &&
                chunk.chunkY <= endY
            ) {
                continue;
            }
            const result = await this.engine.unloadChunk(
                chunk.chunkX,
                chunk.chunkY,
                'write-back'
            );
            if (result.isOk() && result.get()) {
                this.#trackedChunks.delete(key);
                evicted++;
            }
        }
        if (evicted > 0) this.#revision++;
        return evicted;
    }

    async flush(): Promise<ReturnType<TilemapEngine<readonly LayerSpec[]>['flushDirty']>> {
        return this.engine.flushDirty();
    }

    serializeSnapshot(): Result<TilemapRuntimeSnapshot, TilemapAssetError> {
        const exported = this.engine.exportDirtySnapshots();
        if (exported.isErr()) {
            return fail(
                `failed to export dirty chunks for ${this.mapId}`,
                exported.expectErr('dirty chunks')
            );
        }
        const dirtyChunks = exported.get().map((snapshot) => {
            const bytes = chunkAssetCodec.serialize(snapshot) as Uint8Array;
            return {
                key: snapshot.key as unknown as number,
                data: encode(bytes),
            };
        });
        return ok({
            mapId: this.mapId,
            definitionKey: this.definitionKey,
            revision: this.#revision,
            layerOverrides: this.layerOverrides,
            dirtyChunks,
        });
    }

    async applySnapshot(
        snapshot: TilemapRuntimeSnapshot
    ): Promise<Result<void, TilemapAssetError>> {
        if (snapshot.mapId !== this.mapId) {
            return fail(
                `snapshot map ${snapshot.mapId} does not match ${this.mapId}`
            );
        }
        try {
            for (const chunk of snapshot.dirtyChunks) {
                const bytes = decode(chunk.data);
                const decoded = chunkAssetCodec.deserialize(bytes);
                const imported = this.engine.importSnapshot(decoded, { force: true });
                if (imported.isErr()) {
                    return fail(
                        `failed to apply chunk ${chunk.key}`,
                        imported.expectErr('import chunk')
                    );
                }
                const saved = await this.pager.save(decoded);
                if (saved.isErr()) {
                    return fail(
                        `failed to persist chunk ${chunk.key}`,
                        saved.expectErr('save chunk')
                    );
                }
            }
            for (const override of snapshot.layerOverrides) {
                this.setLayerOverride(override.name, override);
            }
            this.#revision++;
            return ok(undefined);
        } catch (cause) {
            return fail(`failed to apply snapshot for ${this.mapId}`, cause);
        }
    }

    async dispose(): Promise<void> {
        this.engine.close();
        await this.engine.drain();
        this.engine.dispose();
        this.#trackedChunks.clear();
        this.#pendingChunks.clear();
    }
}

/** Owns every tilemap runtime of one scene, keyed by map id. */
export class TilemapRuntimeSet {
    readonly #database: AssetDatabase<AssetTilemapSchema>;
    readonly #runtimes = new Map<string, TilemapRuntime>();

    constructor(database: AssetDatabase<AssetTilemapSchema>) {
        this.#database = database;
    }

    get size(): number {
        return this.#runtimes.size;
    }

    get(mapId: string): TilemapRuntime | undefined {
        return this.#runtimes.get(mapId);
    }

    require(mapId: string): TilemapRuntime {
        const runtime = this.#runtimes.get(mapId);
        if (runtime === undefined) {
            throw new Error(`tilemap runtime ${mapId} is not loaded`);
        }
        return runtime;
    }

    async load(
        config: TilemapRuntimeConfig
    ): Promise<Result<TilemapRuntime, TilemapAssetError>> {
        const runtime = await TilemapRuntime.open(this.#database, config);
        if (runtime.isOk()) this.#runtimes.set(config.mapId, runtime.get());
        return runtime;
    }

    async preUpdate(camera: WorldRect): Promise<void> {
        await Promise.all(
            [...this.#runtimes.values()].map((runtime) =>
                runtime.prefetchAround(camera)
            )
        );
    }

    async postUpdate(camera: WorldRect): Promise<void> {
        await Promise.all(
            [...this.#runtimes.values()].map((runtime) =>
                runtime.trimOutside(camera)
            )
        );
    }

    serializeSnapshots(): Result<readonly TilemapRuntimeSnapshot[], TilemapAssetError> {
        const snapshots: TilemapRuntimeSnapshot[] = [];
        for (const runtime of this.#runtimes.values()) {
            const snapshot = runtime.serializeSnapshot();
            if (snapshot.isErr()) {
                return err(snapshot.expectErr('runtime snapshot'));
            }
            snapshots.push(snapshot.get());
        }
        return ok(snapshots);
    }

    async applySnapshots(
        snapshots: readonly TilemapRuntimeSnapshot[]
    ): Promise<Result<void, TilemapAssetError>> {
        for (const snapshot of snapshots) {
            const runtime = this.#runtimes.get(snapshot.mapId);
            if (runtime === undefined) continue;
            const applied = await runtime.applySnapshot(snapshot);
            if (applied.isErr()) return err(applied.expectErr('apply snapshot'));
        }
        return ok(undefined);
    }

    async flushAll(): Promise<void> {
        await Promise.all(
            [...this.#runtimes.values()].map((runtime) => runtime.flush())
        );
    }

    async dispose(): Promise<void> {
        await Promise.all(
            [...this.#runtimes.values()].map((runtime) => runtime.dispose())
        );
        this.#runtimes.clear();
    }
}

export interface TilemapCameraRectProvider {
    (): WorldRect | null;
}

const emptyQuery: SystemQuery<ComponentRegistry> = [];

/** Moves `TilemapAgent` actors along their world-space waypoints. */
export const createTilemapAgentSystem = (
    _runtimes: TilemapRuntimeSet
): System<ComponentRegistry, typeof emptyQuery> => {
    const system = {
        id: 'tilemap.agent',
        priority: 0,
        enabled: true,
        query: ['TilemapAgent', 'Transform'] as const,
        execute(
            entities: readonly {
                readonly components: {
                    readonly TilemapAgent: TilemapAgent;
                    readonly Transform: Transform;
                };
            }[],
            deltaTime: number
        ): void {
            for (const entity of entities) {
                const agent = entity.components.TilemapAgent;
                const transform = entity.components.Transform;
                while (agent.moving) {
                    const waypoint = agent.waypointAt(agent.waypointIndex);
                    if (waypoint === null) {
                        agent.clearPath();
                        break;
                    }
                    const position = transform.worldPosition;
                    const dx = waypoint.x - position.x;
                    const dy = waypoint.y - position.y;
                    const distance = Math.hypot(dx, dy);
                    const step = Math.max(0, agent.speed) * deltaTime;
                    if (distance <= step || distance < 1e-6) {
                        transform.position = new Vec3(
                            waypoint.x,
                            waypoint.y,
                            position.z
                        );
                        agent.advanceWaypoint();
                        if (deltaTime === 0) break;
                        continue;
                    }
                    const scale = step / distance;
                    transform.position = new Vec3(
                        position.x + dx * scale,
                        position.y + dy * scale,
                        position.z
                    );
                    break;
                }
            }
        },
    };
    return system as unknown as System<ComponentRegistry, typeof emptyQuery>;
};

export const createTilemapPagingPreSystem = (
    runtimes: TilemapRuntimeSet,
    camera: TilemapCameraRectProvider
): System<ComponentRegistry, typeof emptyQuery> =>
    ({
        id: 'tilemap.paging.pre',
        priority: 0,
        enabled: true,
        query: [],
        execute(): void {
            const rect = camera();
            if (rect !== null) void runtimes.preUpdate(rect);
        },
    }) as unknown as System<ComponentRegistry, typeof emptyQuery>;

export const createTilemapPagingPostSystem = (
    runtimes: TilemapRuntimeSet,
    camera: TilemapCameraRectProvider
): System<ComponentRegistry, typeof emptyQuery> =>
    ({
        id: 'tilemap.paging.post',
        priority: 0,
        enabled: true,
        query: [],
        execute(): void {
            const rect = camera();
            if (rect !== null) void runtimes.postUpdate(rect);
        },
    }) as unknown as System<ComponentRegistry, typeof emptyQuery>;
