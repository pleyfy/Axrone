import { createRandom } from '@axrone/random';
import { AssetImportPipeline } from './importer';
import {
    ASSET_SNAPSHOT_VERSION,
    deserializeAssetSnapshotData,
    isAssetDatabaseSnapshot,
    serializeAssetSnapshotData,
    type AssetSnapshotSerializationContext,
} from './internal/snapshot-serialization';
import { AssetQuerySourceCatalog } from './internal/query-source-catalog';
import {
    StoredAsset,
    computeFingerprint,
    inferAssetName,
    normalizeMetadata,
    type InternalAssetDisposer,
    type StoredAssetConfig,
} from './internal/stored-asset';
import {
    AssetTransactionRuntime,
    type PreparedAssetWrite,
} from './internal/transaction-runtime';
import {
    AssetConflictError,
    AssetConfigurationError,
    AssetDependencyError,
    AssetDisposedError,
    AssetLifecycleError,
    AssetReferenceError,
    AssetSnapshotError,
    resolveAssetMessage,
} from './errors';
import {
    asAssetFingerprint,
    asAssetSourceIdentity,
    canonicalizeAssetKey,
    isAssetReference,
    isAssetReferenceToken,
    isAssetVersionedReference,
    isAssetVersionedReferenceToken,
    normalizeAssetLocale,
    normalizeAssetSourceIdentity,
    normalizeAssetUri,
    parseAssetReferenceToken,
    parseAssetVersionedReferenceToken,
} from './reference';
import type {
    AssetBinaryPersistenceOptions,
    AssetChangeEvent,
    AssetCodecMap,
    AssetData,
    AssetDatabaseOptions,
    AssetDatabaseSnapshot,
    AssetDeleteOptions,
    AssetDependencyInput,
    AssetDisposer,
    AssetDisposerMap,
    AssetHydrateOptions,
    AssetImporter,
    AssetImportManyOptions,
    AssetImportReceipt,
    AssetImportSource,
    AssetKind,
    AssetKey,
    AssetLeafChangeEvent,
    AssetListener,
    AssetLookupByKey,
    AssetQuery,
    AssetRecord,
    AssetReference,
    AssetSchema,
    AssetSelector,
    AssetSnapshotRecord,
    AssetSnapshotRevisionRecord,
    AssetSnapshotSourceBindingRecord,
    AssetSourceBinding,
    AssetSourceIdentity,
    AssetSubscription,
    AssetVersionedReference,
    AssetWriteInput,
} from './types';

export { isAssetDatabaseSnapshot };

const DEFAULT_BINARY_INLINE_THRESHOLD_BYTES = 64 * 1024;
const EMPTY_STRING_ARRAY = Object.freeze([]) as readonly string[];
const RANDOM = createRandom();

const isLookupByKey = <TSchema extends AssetSchema>(
    value: unknown
): value is AssetLookupByKey<TSchema> =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AssetLookupByKey<TSchema>).key === 'string';

const isAssetRecordValue = <TSchema extends AssetSchema>(
    value: unknown
): value is AssetRecord<TSchema> =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AssetRecord<TSchema>).kind === 'string' &&
    typeof (value as AssetRecord<TSchema>).id === 'string' &&
    typeof (value as AssetRecord<TSchema>).key === 'string' &&
    'reference' in (value as AssetRecord<TSchema>);

export class AssetDatabase<TSchema extends AssetSchema = AssetSchema> {
    private readonly _assetsById = new Map<string, StoredAsset<TSchema>>();
    private readonly _revisionsById = new Map<string, StoredAsset<TSchema>[]>();
    private readonly _keyIndex = new Map<string, string>();
    private readonly _aliasIndex = new Map<string, string>();
    private readonly _catalog = new AssetQuerySourceCatalog<TSchema>();
    private readonly _dependentsById = new Map<string, Set<string>>();
    private readonly _listeners = new Set<AssetListener<TSchema>>();
    private readonly _codecs: AssetCodecMap<TSchema>;
    private readonly _disposers: AssetDisposerMap<TSchema>;
    private readonly _binary: Required<
        Pick<AssetBinaryPersistenceOptions, 'mode' | 'inlineThresholdBytes'>
    > &
        Pick<AssetBinaryPersistenceOptions, 'store'>;
    private readonly _transactions: AssetTransactionRuntime<TSchema>;
    private readonly _pipeline: AssetImportPipeline<TSchema>;
    private readonly _ownPipeline: boolean;
    private readonly _messageResolver: AssetDatabaseOptions<TSchema>['messageResolver'];
    private readonly _now: () => number;
    private readonly _locale: string;
    private readonly _createdAtEpochMs: number;
    private _disposed = false;
    private _batchDepth = 0;
    private _pendingEvents: AssetLeafChangeEvent<TSchema>[] = [];
    private _flushScheduled = false;

    constructor(options: AssetDatabaseOptions<TSchema> = {}) {
        this._locale = normalizeAssetLocale(options.locale) ?? 'en-US';
        this._now = options.now ?? Date.now;
        this._createdAtEpochMs = this._now();
        this._messageResolver = options.messageResolver;
        this._codecs = Object.freeze({ ...(options.codecs ?? {}) }) as AssetCodecMap<TSchema>;
        this._disposers = Object.freeze({
            ...(options.disposers ?? {}),
        }) as AssetDisposerMap<TSchema>;
        this._binary = Object.freeze({
            mode: options.binary?.mode ?? 'auto',
            inlineThresholdBytes: Math.max(
                0,
                Math.trunc(
                    options.binary?.inlineThresholdBytes ?? DEFAULT_BINARY_INLINE_THRESHOLD_BYTES
                )
            ),
            store: options.binary?.store,
        });
        this._transactions = new AssetTransactionRuntime<TSchema>({
            assetsById: this._assetsById,
            revisionsById: this._revisionsById,
            keyIndex: this._keyIndex,
            aliasIndex: this._aliasIndex,
            dependentsById: this._dependentsById,
            catalog: this._catalog,
            locale: this._locale,
            messageResolver: this._messageResolver,
            resolveStored: (selector) => this._resolveStored(selector),
            emitLeaf: (event) => this._emitLeaf(event),
        });
        this._ownPipeline = !options.pipeline;
        this._pipeline =
            options.pipeline ??
            new AssetImportPipeline<TSchema>({
                importers: options.importers,
                stages: options.stages,
                locale: this._locale,
                retry: options.retry,
                messageResolver: options.messageResolver,
                now: this._now,
            });

        if (options.pipeline && options.importers?.length) {
            for (const importer of options.importers) {
                this._pipeline.register(importer);
            }
        }

        if (options.pipeline && options.stages?.length) {
            for (const stage of options.stages) {
                this._pipeline.registerStage(stage);
            }
        }
    }

    get size(): number {
        return this._assetsById.size;
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    get locale(): string {
        return this._locale;
    }

    registerImporter(importer: Parameters<AssetImportPipeline<TSchema>['register']>[0]): this {
        this._assertNotDisposed();
        this._pipeline.register(importer);
        return this;
    }

    unregisterImporter(importerId: string): boolean {
        this._assertNotDisposed();
        return this._pipeline.unregister(importerId);
    }

    listImporters(): readonly AssetImporter<TSchema>[] {
        this._assertNotDisposed();
        return this._pipeline.listImporters();
    }

    registerStage(stage: Parameters<AssetImportPipeline<TSchema>['registerStage']>[0]): this {
        this._assertNotDisposed();
        this._pipeline.registerStage(stage);
        return this;
    }

    unregisterStage(stageId: string): boolean {
        this._assertNotDisposed();
        return this._pipeline.unregisterStage(stageId);
    }

    listStages(): ReturnType<AssetImportPipeline<TSchema>['listStages']> {
        this._assertNotDisposed();
        return this._pipeline.listStages();
    }

    resolveSourceIdentity(identity: string): AssetRecord<TSchema> | undefined {
        this._assertNotDisposed();

        const normalized = this._validateSourceIdentity(identity);
        const assetId = this._catalog.resolveSourceIdentityId(normalized);
        return assetId ? this._assetsById.get(assetId)?.toRecord() : undefined;
    }

    bindSourceIdentity(identity: string, selector: AssetSelector<TSchema>): this {
        this._assertNotDisposed();

        const asset = this.require(selector);
        this._catalog.bindSourceIdentity(this._validateSourceIdentity(identity), asset.id, this._now());
        return this;
    }

    unbindSourceIdentity(identity: string): boolean {
        this._assertNotDisposed();
        return this._catalog.unbindSourceIdentity(this._validateSourceIdentity(identity));
    }

    listSourceBindings(): readonly AssetSourceBinding[] {
        this._assertNotDisposed();
        return this._catalog.listSourceBindings();
    }

    subscribe(listener: AssetListener<TSchema>): AssetSubscription {
        this._assertNotDisposed();
        this._listeners.add(listener);

        let disposed = false;

        return {
            get isDisposed(): boolean {
                return disposed;
            },
            dispose: () => {
                if (disposed) {
                    return;
                }

                disposed = true;
                this._listeners.delete(listener);
            },
        };
    }

    has(selector: AssetSelector<TSchema>): boolean {
        return this._resolveStored(selector) !== undefined;
    }

    get<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): AssetRecord<TSchema, TKind> | undefined {
        const stored = this._resolveStored(selector);
        if (!stored) {
            return undefined;
        }

        return stored.toRecord() as AssetRecord<TSchema, TKind>;
    }

    require<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): AssetRecord<TSchema, TKind> {
        const record = this.get(selector);
        if (!record) {
            throw new AssetReferenceError(
                resolveAssetMessage(
                    {
                        code: 'asset.reference.invalid',
                        value: selector,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return record;
    }

    list(): readonly AssetRecord<TSchema>[];
    list<TKind extends AssetKind<TSchema>>(kind: TKind): readonly AssetRecord<TSchema, TKind>[];
    list<TKind extends AssetKind<TSchema>>(
        kind?: TKind
    ): readonly AssetRecord<TSchema>[] | readonly AssetRecord<TSchema, TKind>[] {
        this._assertNotDisposed();

        const result: AssetRecord<TSchema>[] = [];

        for (const asset of this._assetsById.values()) {
            if (!kind || asset.kind === kind) {
                result.push(asset.toRecord());
            }
        }

        return Object.freeze(result);
    }

    find(query: AssetQuery<TSchema> = {}): readonly AssetRecord<TSchema>[] {
        this._assertNotDisposed();

        const candidateIds = this._catalog.findCandidateIds(query);
        if (candidateIds && candidateIds.size === 0) {
            return Object.freeze([]);
        }

        const result: AssetRecord<TSchema>[] = [];

        for (const asset of this._assetsById.values()) {
            if (candidateIds && !candidateIds.has(asset.id)) {
                continue;
            }

            if (query.kind && asset.kind !== query.kind) {
                continue;
            }

            result.push(asset.toRecord());
        }

        return Object.freeze(result);
    }

    reference<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): AssetReference<TKind> {
        return this.require(selector).reference;
    }

    versionedReference<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): AssetVersionedReference<TKind> {
        return this.require(selector).versionedReference;
    }

    getDependencies<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): readonly AssetRecord<TSchema>[] {
        const asset = this.require(selector);
        const dependencies: AssetRecord<TSchema>[] = [];

        for (const dependencyId of asset.dependencyIds) {
            const dependency = this._assetsById.get(dependencyId);
            if (dependency) {
                dependencies.push(dependency.toRecord());
            }
        }

        return Object.freeze(dependencies);
    }

    getDependents<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): readonly AssetRecord<TSchema>[] {
        const asset = this.require(selector);
        const dependents = this._dependentsById.get(asset.id);
        if (!dependents?.size) {
            return Object.freeze([]);
        }

        const result: AssetRecord<TSchema>[] = [];
        for (const dependentId of dependents) {
            const dependent = this._assetsById.get(dependentId);
            if (dependent) {
                result.push(dependent.toRecord());
            }
        }

        return Object.freeze(result);
    }

    upsert<TKind extends AssetKind<TSchema>>(
        input: AssetWriteInput<TSchema, TKind>
    ): AssetRecord<TSchema, TKind> {
        this._assertNotDisposed();
        this._beginBatch();

        try {
            const [record] = this._applyWrites([input as unknown as AssetWriteInput<TSchema>]);
            return record as unknown as AssetRecord<TSchema, TKind>;
        } finally {
            this._endBatch();
        }
    }

    upsertMany(inputs: readonly AssetWriteInput<TSchema>[]): readonly AssetRecord<TSchema>[] {
        this._assertNotDisposed();
        this._beginBatch();

        try {
            return this._applyWrites(inputs);
        } finally {
            this._endBatch();
        }
    }

    async import<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        source: AssetImportSource,
        options: AssetImportManyOptions<TSchema> = {}
    ): Promise<AssetImportReceipt<TSchema, TKind>> {
        this._assertNotDisposed();

        const execution = await this._pipeline.import<TKind>(this, source, options);
        const writes = this._normalizeImportWrites(
            execution.baseKey,
            execution.sourceIdentity,
            execution.result as unknown as {
                readonly primary: AssetWriteInput<TSchema>;
                readonly additional?: readonly AssetWriteInput<TSchema>[];
            }
        );

        this._beginBatch();

        try {
            const assets = this._applyWrites(writes);
            const receipt = Object.freeze({
                importerId: execution.importerId,
                sourceKind: source.kind,
                sourceUri: normalizeAssetUri(source.uri),
                baseKey: execution.baseKey,
                sourceIdentity: execution.sourceIdentity,
                importedAtEpochMs: execution.importedAtEpochMs,
                diagnostics: execution.diagnostics,
                primary: assets[0] as unknown as AssetRecord<TSchema, TKind>,
                assets,
            }) as unknown as AssetImportReceipt<TSchema, TKind>;

            if (execution.sourceIdentity) {
                this._catalog.bindSourceIdentity(
                    execution.sourceIdentity,
                    receipt.primary.id,
                    execution.importedAtEpochMs
                );
            }

            this._emitLeaf({
                type: 'import',
                receipt,
            });

            return receipt;
        } finally {
            this._endBatch();
        }
    }

    async importMany(
        sources: readonly AssetImportSource[],
        options: AssetImportManyOptions<TSchema> = {}
    ): Promise<readonly AssetImportReceipt<TSchema>[]> {
        this._assertNotDisposed();

        if (sources.length === 0) {
            return Object.freeze([]);
        }

        const concurrency = Math.max(1, Math.trunc(options.concurrency ?? 4));
        const results = new Array<AssetImportReceipt<TSchema>>(sources.length);
        let cursor = 0;

        const worker = async (): Promise<void> => {
            while (true) {
                const index = cursor;
                cursor += 1;

                if (index >= sources.length) {
                    return;
                }

                results[index] = await this.import(sources[index]!, options);
            }
        };

        const workerCount = Math.min(concurrency, sources.length);
        await Promise.all(Array.from({ length: workerCount }, () => worker()));

        return Object.freeze(results);
    }

    delete(selector: AssetSelector<TSchema>, options: AssetDeleteOptions = {}): boolean {
        this._assertNotDisposed();

        const asset = this._resolveStored(selector);
        if (!asset) {
            return false;
        }

        if (!options.cascade) {
            const directDependents = [...(this._dependentsById.get(asset.id) ?? [])].filter((id) =>
                this._assetsById.has(id)
            );
            if (directDependents.length > 0) {
                throw new AssetDependencyError(
                    resolveAssetMessage(
                        {
                            code: 'asset.dependency.missing',
                            dependency: directDependents.join(','),
                        },
                        this._locale,
                        this._messageResolver
                    ),
                    directDependents.join(',')
                );
            }
        }

        this._beginBatch();

        try {
            const order = options.cascade
                ? this._transactions.collectDeleteOrder([asset.id])
                : [asset.id];
            this._transactions.deleteIds(order);
            return true;
        } finally {
            this._endBatch();
        }
    }

    clear(): void {
        this._assertNotDisposed();
        if (this._assetsById.size === 0) {
            return;
        }

        this._beginBatch();

        try {
            this._transactions.deleteIds(
                this._transactions.collectDeleteOrder([...this._assetsById.keys()])
            );
        } finally {
            this._endBatch();
        }
    }

    snapshot(): AssetDatabaseSnapshot<AssetKind<TSchema>> {
        this._assertNotDisposed();

        const assets = [...this._assetsById.values()]
            .sort((left, right) =>
                left.kind === right.kind
                    ? String(left.key).localeCompare(String(right.key))
                    : left.kind.localeCompare(right.kind)
            )
            .map((asset) => {
                const revisions = this._revisionsById.get(asset.id);
                const history =
                    revisions && revisions.length > 1
                        ? Object.freeze(
                              revisions
                                  .slice(0, Math.max(0, asset.revision - 1))
                                  .filter(
                                      (
                                          revision
                                      ): revision is StoredAsset<TSchema> => revision !== undefined
                                  )
                                  .map((revision) => this._serializeSnapshotRevision(revision))
                          )
                        : undefined;

                return Object.freeze({
                    ...this._serializeSnapshotRevision(asset),
                    ...(history && history.length > 0 ? { history } : {}),
                }) as AssetSnapshotRecord<AssetKind<TSchema>>;
            });

        return Object.freeze({
            version: ASSET_SNAPSHOT_VERSION,
            locale: this._locale,
            capturedAtEpochMs: this._now(),
            assets: Object.freeze(assets),
            ...(this._catalog.snapshotSourceBindings().length > 0
                ? {
                      sourceBindings: Object.freeze(
                          this._catalog.snapshotSourceBindings().map(
                              (binding) =>
                                  Object.freeze(binding) as AssetSnapshotSourceBindingRecord
                          )
                      ),
                  }
                : {}),
        });
    }

    hydrate(
        snapshot: AssetDatabaseSnapshot<AssetKind<TSchema>>,
        options: AssetHydrateOptions = {}
    ): readonly AssetRecord<TSchema>[] {
        this._assertNotDisposed();

        if (!isAssetDatabaseSnapshot(snapshot)) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: 'snapshot-shape',
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        const replace = options.replace ?? true;

        this._beginBatch();

        try {
            if (replace) {
                this._transactions.deleteIds(
                    this._transactions.collectDeleteOrder([...this._assetsById.keys()])
                );
            }

            const staged = new Map<string, StoredAsset<TSchema>>();
            const stagedRevisions = new Map<string, StoredAsset<TSchema>[]>();
            const stagedSourceBindings: AssetSnapshotSourceBindingRecord[] = [];

            for (const entry of snapshot.assets) {
                const history = entry.history ?? [];
                let previousRevision = 0;

                for (const historicalEntry of history) {
                    const historicalAsset = this._createStoredAssetFromSnapshotRecord(historicalEntry);

                    if (historicalAsset.id !== entry.id || historicalAsset.kind !== entry.kind) {
                        throw new AssetSnapshotError(
                            resolveAssetMessage(
                                {
                                    code: 'asset.snapshot.invalid',
                                    reason: `history mismatch for asset ${entry.id}`,
                                },
                                this._locale,
                                this._messageResolver
                            )
                        );
                    }

                    if (historicalAsset.revision <= previousRevision) {
                        throw new AssetSnapshotError(
                            resolveAssetMessage(
                                {
                                    code: 'asset.snapshot.invalid',
                                    reason: `non-monotonic revision history for asset ${entry.id}`,
                                },
                                this._locale,
                                this._messageResolver
                            )
                        );
                    }

                    this._stageRevisionAsset(stagedRevisions, historicalAsset);
                    previousRevision = historicalAsset.revision;
                }

                const currentAsset = this._createStoredAssetFromSnapshotRecord(entry);

                if (history.length > 0 && currentAsset.revision <= previousRevision) {
                    throw new AssetSnapshotError(
                        resolveAssetMessage(
                            {
                                code: 'asset.snapshot.invalid',
                                reason: `current revision is not newer than history for asset ${entry.id}`,
                            },
                            this._locale,
                            this._messageResolver
                        )
                    );
                }

                staged.set(currentAsset.id, currentAsset);
            }

            for (const [id, revisions] of stagedRevisions) {
                this._revisionsById.set(id, revisions);
            }

            const availableIds = new Set<string>([...this._assetsById.keys(), ...staged.keys()]);

            for (const asset of staged.values()) {
                for (const dependencyId of asset.dependencyIds) {
                    if (!availableIds.has(dependencyId)) {
                        throw new AssetSnapshotError(
                            resolveAssetMessage(
                                {
                                    code: 'asset.snapshot.invalid',
                                    reason: `missing dependency ${dependencyId}`,
                                },
                                this._locale,
                                this._messageResolver
                            )
                        );
                    }
                }
            }

            for (const binding of snapshot.sourceBindings ?? []) {
                const sourceIdentity = this._validateSourceIdentity(binding.sourceIdentity);
                const assetId = this._validateId(binding.assetId);
                const updatedAtEpochMs = this._validateEpochMs(binding.updatedAtEpochMs);

                if (!availableIds.has(assetId)) {
                    throw new AssetSnapshotError(
                        resolveAssetMessage(
                            {
                                code: 'asset.snapshot.invalid',
                                reason: `missing source binding asset ${assetId}`,
                            },
                            this._locale,
                            this._messageResolver
                        )
                    );
                }

                stagedSourceBindings.push({
                    sourceIdentity,
                    assetId,
                    updatedAtEpochMs,
                });
            }

            const records = this._transactions.commitStoredAssets([...staged.values()]);

            for (const binding of stagedSourceBindings) {
                this._catalog.bindSourceIdentity(
                    asAssetSourceIdentity(binding.sourceIdentity),
                    binding.assetId,
                    binding.updatedAtEpochMs
                );
            }

            return records;
        } finally {
            this._endBatch();
        }
    }

    private _serializeSnapshotRevision(
        asset: StoredAsset<TSchema>
    ): AssetSnapshotRevisionRecord<AssetKind<TSchema>> {
        return Object.freeze({
            kind: asset.kind,
            id: asset.id,
            key: asset.key,
            aliases: asset.aliases,
            name: asset.name,
            revision: asset.revision,
            fingerprint: asset.fingerprint,
            createdAtEpochMs: asset.createdAtEpochMs,
            updatedAtEpochMs: asset.updatedAtEpochMs,
            metadata: Object.freeze({
                uri: asset.metadata.uri,
                mimeType: asset.metadata.mimeType,
                locale: asset.metadata.locale,
                tags: asset.metadata.tags,
                properties: asset.metadata.properties,
            }),
            dependencyIds: asset.dependencyIds,
            data: serializeAssetSnapshotData(asset, this._getSnapshotSerializationContext()),
        });
    }

    private _createStoredAssetFromSnapshotRecord(
        entry: AssetSnapshotRevisionRecord<AssetKind<TSchema>>
    ): StoredAsset<TSchema> {
        const kind = this._validateKind(entry.kind);
        const id = this._validateId(entry.id);
        const key = this._validateKey(entry.key);
        const revision = this._validateRevision(entry.revision);
        const metadata = normalizeMetadata({
            uri: entry.metadata.uri,
            mimeType: entry.metadata.mimeType,
            locale: entry.metadata.locale,
            tags: entry.metadata.tags,
            properties: entry.metadata.properties,
        });
        const data = deserializeAssetSnapshotData(
            entry,
            kind,
            {
                kind,
                id,
                key,
                revision,
                fingerprint: entry.fingerprint,
                metadata,
            },
            this._getSnapshotSerializationContext()
        );
        const aliases = this._normalizeAliases(entry.aliases, key);
        const disposer = this._disposers?.[kind]
            ? (value: unknown, record: Readonly<AssetRecord<TSchema>>) =>
                  (
                      this._disposers?.[kind] as (
                          data: TSchema[typeof kind],
                          record: Readonly<AssetRecord<TSchema, typeof kind>>
                      ) => void
                  )(value as TSchema[typeof kind], record as AssetRecord<TSchema, typeof kind>)
            : undefined;

        return new StoredAsset<TSchema>({
            id,
            kind,
            key,
            aliases,
            name: inferAssetName(kind, key, entry.name),
            data,
            revision,
            fingerprint: entry.fingerprint,
            createdAtEpochMs: entry.createdAtEpochMs,
            updatedAtEpochMs: entry.updatedAtEpochMs,
            metadata,
            dependencyIds: [...entry.dependencyIds],
            disposer,
        });
    }

    private _stageRevisionAsset(
        stagedRevisions: Map<string, StoredAsset<TSchema>[]>,
        asset: StoredAsset<TSchema>
    ): void {
        const revisions = stagedRevisions.get(asset.id) ?? [];
        if (!stagedRevisions.has(asset.id)) {
            stagedRevisions.set(asset.id, revisions);
        }

        revisions[asset.revision - 1] = asset;

        if (revisions.length < asset.revision) {
            revisions.length = asset.revision;
        }
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        let lifecycleError: unknown;

        try {
            this.clear();
        } catch (error) {
            lifecycleError = error;
        } finally {
            this._disposed = true;
            this._listeners.clear();
            this._pendingEvents = [];
            if (this._ownPipeline) {
                this._pipeline.dispose();
            }
        }

        if (lifecycleError) {
            throw lifecycleError;
        }
    }

    private _assertNotDisposed(): void {
        if (this._disposed) {
            throw new AssetDisposedError(
                resolveAssetMessage(
                    {
                        code: 'asset.disposed',
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }
    }

    private _validateId(value: unknown): string {
        if (typeof value !== 'string' || !value.trim()) {
            throw new AssetConfigurationError(
                'asset.invalid-id',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-id',
                        value,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return value.trim();
    }

    private _validateKind<TKind extends AssetKind<TSchema>>(value: unknown): TKind {
        if (typeof value !== 'string' || !value.trim()) {
            throw new AssetConfigurationError(
                'asset.invalid-kind',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-kind',
                        value,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return value as TKind;
    }

    private _validateKey(value: unknown): AssetKey {
        if (typeof value !== 'string' || !value.trim()) {
            throw new AssetConfigurationError(
                'asset.invalid-key',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-key',
                        value,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return canonicalizeAssetKey(value);
    }

    private _validateRevision(value: unknown): number {
        if (!Number.isSafeInteger(value) || Number(value) < 1) {
            throw new AssetConfigurationError(
                'asset.invalid-revision',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-revision',
                        value,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return Number(value);
    }

    private _validateSourceIdentity(value: unknown): AssetSourceIdentity {
        const normalized = normalizeAssetSourceIdentity(
            typeof value === 'string' ? value : undefined
        );

        if (!normalized) {
            throw new AssetConfigurationError(
                'asset.invalid-source-identity',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-source-identity',
                        value,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return normalized;
    }

    private _validateEpochMs(value: unknown): number {
        if (!Number.isSafeInteger(value) || Number(value) < 0) {
            throw new AssetSnapshotError(
                resolveAssetMessage(
                    {
                        code: 'asset.snapshot.invalid',
                        reason: `invalid timestamp ${String(value)}`,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        return Number(value);
    }

    private _resolveStored(
        selector: AssetSelector<TSchema> | AssetDependencyInput<TSchema>
    ): StoredAsset<TSchema> | undefined {
        if (typeof selector === 'string') {
            if (isAssetVersionedReferenceToken(selector)) {
                const reference = parseAssetVersionedReferenceToken(selector);
                return reference ? this._resolveVersionedReference(reference) : undefined;
            }

            if (isAssetReferenceToken(selector)) {
                const reference = parseAssetReferenceToken(selector);
                return reference ? this._assetsById.get(reference.id) : undefined;
            }

            return this._assetsById.get(selector) ?? this._resolveByKey(selector);
        }

        if (isAssetVersionedReference(selector)) {
            return this._resolveVersionedReference(selector);
        }

        if (isAssetReference(selector)) {
            return this._assetsById.get(selector.id);
        }

        if (isAssetRecordValue(selector)) {
            return this._assetsById.get(selector.id);
        }

        if (isLookupByKey(selector)) {
            const resolved = this._resolveByKey(selector.key);
            if (!resolved) {
                return undefined;
            }

            return selector.kind && resolved.kind !== selector.kind ? undefined : resolved;
        }

        return undefined;
    }

    private _resolveVersionedReference(
        reference: AssetVersionedReference
    ): StoredAsset<TSchema> | undefined {
        const revisions = this._revisionsById.get(reference.id);
        if (!revisions) {
            return undefined;
        }

        return revisions[reference.revision - 1];
    }

    private _resolveByKey(key: string): StoredAsset<TSchema> | undefined {
        const normalized = canonicalizeAssetKey(key);
        const id = this._keyIndex.get(normalized) ?? this._aliasIndex.get(normalized);
        return id ? this._assetsById.get(id) : undefined;
    }

    private _normalizeAliases(
        values: readonly string[] | undefined,
        key: AssetKey
    ): readonly AssetKey[] {
        if (!values?.length) {
            return Object.freeze([]);
        }

        const result: AssetKey[] = [];
        const seen = new Set<string>();

        for (const value of values) {
            const alias = canonicalizeAssetKey(value);
            if (alias === key || seen.has(alias)) {
                continue;
            }

            seen.add(alias);
            result.push(alias);
        }

        return Object.freeze(result);
    }

    private _normalizeImportWrites(
        baseKey: AssetKey,
        sourceIdentity: AssetSourceIdentity | undefined,
        result: {
            readonly primary: AssetWriteInput<TSchema>;
            readonly additional?: readonly AssetWriteInput<TSchema>[];
        }
    ): readonly AssetWriteInput<TSchema>[] {
        return this._transactions.normalizeImportWrites(baseKey, sourceIdentity, result);
    }

    private _prepareWrite(input: AssetWriteInput<TSchema>): PreparedAssetWrite<TSchema> {
        const kind = this._validateKind(input.kind);
        const metadata = normalizeMetadata(input.metadata);
        const explicitId = input.id ? this._validateId(input.id) : undefined;
        const explicitKey = input.stableKey?.trim()
            ? canonicalizeAssetKey(input.stableKey)
            : undefined;
        const previousById = explicitId ? this._assetsById.get(explicitId) : undefined;
        const previousByKey = explicitKey ? this._resolveByKey(explicitKey) : undefined;

        if (previousById && previousByKey && previousById.id !== previousByKey.id) {
            throw new AssetConflictError(
                'asset.conflict.key-bound',
                resolveAssetMessage(
                    {
                        code: 'asset.conflict.key-bound',
                        key: explicitKey!,
                        currentId: previousByKey.id,
                        requestedId: previousById.id,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        const previous = previousById ?? previousByKey;
        const id = previous?.id ?? explicitId ?? RANDOM.uuid();
        const key = explicitKey ?? previous?.key ?? canonicalizeAssetKey(`asset://${kind}/${id}`);

        if (previous && previous.kind !== kind) {
            throw new AssetConflictError(
                'asset.conflict.kind-mismatch',
                resolveAssetMessage(
                    {
                        code: 'asset.conflict.kind-mismatch',
                        id: previous.id,
                        expected: previous.kind,
                        received: kind,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }

        const revision = previous ? previous.revision + 1 : 1;
        const nowEpochMs = this._now();
        const aliases = this._normalizeAliases(
            [
                ...(input.aliases ?? EMPTY_STRING_ARRAY),
                ...(previous ? [String(previous.key), ...previous.aliases] : EMPTY_STRING_ARRAY),
                ...(metadata.uri && String(metadata.uri) !== String(key)
                    ? [String(metadata.uri)]
                    : EMPTY_STRING_ARRAY),
            ],
            key
        );
        const specificDisposer = input.disposer
            ? (data: unknown, record: Readonly<AssetRecord<TSchema>>) =>
                  (
                      input.disposer as (
                          data: TSchema[typeof kind],
                          record: Readonly<AssetRecord<TSchema, typeof kind>>
                      ) => void
                  )(data as TSchema[typeof kind], record as AssetRecord<TSchema, typeof kind>)
            : undefined;
        const mappedDisposer = this._disposers?.[kind]
            ? (data: unknown, record: Readonly<AssetRecord<TSchema>>) =>
                  (
                      this._disposers?.[kind] as (
                          data: TSchema[typeof kind],
                          record: Readonly<AssetRecord<TSchema, typeof kind>>
                      ) => void
                  )(data as TSchema[typeof kind], record as AssetRecord<TSchema, typeof kind>)
            : undefined;
        const disposer = specificDisposer ?? mappedDisposer ?? previous?.disposer;
        const fingerprint = asAssetFingerprint(
            input.fingerprint?.trim() || computeFingerprint(kind, key, input.data, metadata)
        );

        return Object.freeze({
            id,
            kind,
            key,
            aliases,
            name: inferAssetName(kind, key, input.name),
            data: input.data as AssetData<TSchema>,
            revision,
            fingerprint,
            createdAtEpochMs: previous?.createdAtEpochMs ?? nowEpochMs,
            updatedAtEpochMs: nowEpochMs,
            metadata,
            dependencyInputs: Object.freeze([...(input.dependencies ?? [])]),
            disposer,
        });
    }

    private _applyWrites(
        inputs: readonly AssetWriteInput<TSchema>[]
    ): readonly AssetRecord<TSchema>[] {
        return this._transactions.applyWrites(
            inputs,
            (input) => this._prepareWrite(input),
            (write, dependencyIds) =>
                new StoredAsset<TSchema>({
                    id: write.id,
                    kind: write.kind,
                    key: write.key,
                    aliases: write.aliases,
                    name: write.name,
                    data: write.data,
                    revision: write.revision,
                    fingerprint: write.fingerprint,
                    createdAtEpochMs: write.createdAtEpochMs,
                    updatedAtEpochMs: write.updatedAtEpochMs,
                    metadata: write.metadata,
                    dependencyIds,
                    disposer: write.disposer,
                })
        );
    }

    private _getSnapshotSerializationContext(): AssetSnapshotSerializationContext<TSchema> {
        return {
            locale: this._locale,
            messageResolver: this._messageResolver,
            codecs: this._codecs,
            binary: this._binary,
        };
    }

    private _beginBatch(): void {
        this._batchDepth += 1;
    }

    private _endBatch(): void {
        this._batchDepth -= 1;
        if (this._batchDepth <= 0) {
            this._batchDepth = 0;
            this._scheduleFlush();
        }
    }

    private _emitLeaf(event: AssetLeafChangeEvent<TSchema>): void {
        this._pendingEvents.push(event);
        if (this._batchDepth === 0) {
            this._scheduleFlush();
        }
    }

    private _scheduleFlush(): void {
        if (this._flushScheduled || this._pendingEvents.length === 0) {
            return;
        }

        this._flushScheduled = true;
        queueMicrotask(() => {
            this._flushScheduled = false;
            this._flushEvents();
        });
    }

    private _flushEvents(): void {
        if (this._pendingEvents.length === 0 || this._listeners.size === 0) {
            this._pendingEvents = [];
            return;
        }

        const events = this._pendingEvents;
        this._pendingEvents = [];

        const payload: AssetChangeEvent<TSchema> =
            events.length === 1
                ? events[0]!
                : Object.freeze({
                      type: 'batch',
                      events: Object.freeze([...events]),
                  });

        for (const listener of this._listeners) {
            try {
                listener(payload);
            } catch (error) {
                queueMicrotask(() => {
                    throw error;
                });
            }
        }
    }
}

export const createAssetDatabase = <TSchema extends AssetSchema = AssetSchema>(
    options?: AssetDatabaseOptions<TSchema>
): AssetDatabase<TSchema> => new AssetDatabase<TSchema>(options);
