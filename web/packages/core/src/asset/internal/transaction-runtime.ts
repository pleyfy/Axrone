import {
    AssetConflictError,
    AssetDependencyError,
    AssetLifecycleError,
    resolveAssetMessage,
} from '../errors';
import {
    canonicalizeAssetKey,
    isAssetReference,
    isAssetReferenceToken,
    isAssetVersionedReference,
    isAssetVersionedReferenceToken,
    parseAssetReferenceToken,
    parseAssetVersionedReferenceToken,
    type AssetKey,
} from '../reference';
import type {
    AssetData,
    AssetDatabaseOptions,
    AssetDependencyInput,
    AssetKind,
    AssetLeafChangeEvent,
    AssetLookupByKey,
    AssetMetadata,
    AssetRecord,
    AssetSchema,
    AssetSelector,
    AssetSourceIdentity,
    AssetWriteInput,
} from '../types';
import type { AssetQuerySourceCatalog } from './query-source-catalog';
import {
    stableStringify,
    type InternalAssetDisposer,
} from './stored-asset';

export interface PreparedAssetWrite<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly id: string;
    readonly kind: TKind;
    readonly key: AssetKey;
    readonly aliases: readonly AssetKey[];
    readonly name: string;
    readonly data: TSchema[TKind];
    readonly revision: number;
    readonly fingerprint: string;
    readonly createdAtEpochMs: number;
    readonly updatedAtEpochMs: number;
    readonly metadata: AssetMetadata;
    readonly dependencyInputs: readonly AssetDependencyInput<TSchema>[];
    readonly disposer?: InternalAssetDisposer<TSchema>;
}

export interface TransactionStoredAsset<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly id: string;
    readonly kind: TKind;
    readonly key: AssetKey;
    readonly aliases: readonly AssetKey[];
    readonly name: string;
    readonly data: AssetData<TSchema>;
    readonly revision: number;
    readonly fingerprint: string;
    readonly createdAtEpochMs: number;
    readonly updatedAtEpochMs: number;
    readonly metadata: AssetMetadata;
    readonly dependencyIds: readonly string[];
    readonly disposer?: InternalAssetDisposer<TSchema>;
    toRecord(): AssetRecord<TSchema, TKind>;
}

interface AssetTransactionHost<TSchema extends AssetSchema> {
    readonly assetsById: Map<string, TransactionStoredAsset<TSchema>>;
    readonly revisionsById: Map<string, TransactionStoredAsset<TSchema>[]>;
    readonly keyIndex: Map<string, string>;
    readonly aliasIndex: Map<string, string>;
    readonly dependentsById: Map<string, Set<string>>;
    readonly catalog: Pick<
        AssetQuerySourceCatalog<TSchema>,
        'getSourceBinding' | 'indexAsset' | 'unindexAsset' | 'unbindSourceIdentitiesForAsset'
    >;
    readonly locale: string;
    readonly messageResolver: AssetDatabaseOptions<TSchema>['messageResolver'];
    readonly resolveStored: (
        selector: AssetSelector<TSchema> | AssetDependencyInput<TSchema>
    ) => TransactionStoredAsset<TSchema> | undefined;
    readonly emitLeaf: (event: AssetLeafChangeEvent<TSchema>) => void;
}

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

export class AssetTransactionRuntime<TSchema extends AssetSchema> {
    constructor(private readonly _host: AssetTransactionHost<TSchema>) {}

    normalizeImportWrites(
        baseKey: AssetKey,
        sourceIdentity: AssetSourceIdentity | undefined,
        result: {
            readonly primary: AssetWriteInput<TSchema>;
            readonly additional?: readonly AssetWriteInput<TSchema>[];
        }
    ): readonly AssetWriteInput<TSchema>[] {
        const normalizeDependency = (
            dependency: AssetDependencyInput<TSchema>
        ): AssetDependencyInput<TSchema> => {
            if (typeof dependency === 'string' && dependency.startsWith('#')) {
                return `${baseKey}${dependency}`;
            }

            if (isLookupByKey(dependency) && dependency.key.startsWith('#')) {
                return {
                    key: `${baseKey}${dependency.key}`,
                    ...(dependency.kind ? { kind: dependency.kind } : {}),
                } as AssetLookupByKey<TSchema>;
            }

            return dependency;
        };

        const normalizeWrite = (
            write: AssetWriteInput<TSchema>,
            index: number,
            isPrimary: boolean
        ): AssetWriteInput<TSchema> => {
            const stableKey = write.stableKey?.trim()
                ? write.stableKey.startsWith('#')
                    ? `${baseKey}${write.stableKey}`
                    : write.stableKey
                : isPrimary
                  ? String(baseKey)
                  : `${baseKey}#${index}`;

            return Object.freeze({
                ...write,
                stableKey,
                dependencies: Object.freeze(
                    [...(write.dependencies ?? [])].map(normalizeDependency)
                ),
            });
        };

        const writes = [
            normalizeWrite(result.primary, 0, true),
            ...(result.additional ?? []).map((write, index) =>
                normalizeWrite(write, index + 1, false)
            ),
        ];

        if (!sourceIdentity || writes[0]?.id?.trim()) {
            return Object.freeze(writes);
        }

        const binding = this._host.catalog.getSourceBinding(sourceIdentity);
        if (!binding) {
            return Object.freeze(writes);
        }

        return Object.freeze([
            Object.freeze({
                ...writes[0],
                id: binding.assetId,
            }),
            ...writes.slice(1),
        ]);
    }

    applyWrites<TAsset extends TransactionStoredAsset<TSchema>>(
        inputs: readonly AssetWriteInput<TSchema>[],
        prepareWrite: (input: AssetWriteInput<TSchema>) => PreparedAssetWrite<TSchema>,
        createAsset: (
            write: PreparedAssetWrite<TSchema>,
            dependencyIds: readonly string[]
        ) => TAsset
    ): readonly AssetRecord<TSchema>[] {
        if (inputs.length === 0) {
            return Object.freeze([]);
        }

        const prepared = inputs.map((input) => prepareWrite(input));
        const stagedById = new Map<string, PreparedAssetWrite<TSchema>>();
        const stagedByKey = new Map<string, PreparedAssetWrite<TSchema>>();

        for (const write of prepared) {
            stagedById.set(write.id, write);
            stagedByKey.set(write.key, write);
            for (const alias of write.aliases) {
                stagedByKey.set(alias, write);
            }
        }

        const assets = prepared.map((write) =>
            createAsset(
                write,
                this._resolveDependencyIds(write.dependencyInputs, stagedById, stagedByKey)
            )
        );

        return this.commitStoredAssets(assets);
    }

    collectDeleteOrder(startIds: readonly string[]): readonly string[] {
        const visited = new Set<string>();
        const order: string[] = [];

        const visit = (id: string): void => {
            if (visited.has(id)) {
                return;
            }

            visited.add(id);
            for (const dependentId of this._host.dependentsById.get(id) ?? []) {
                if (this._host.assetsById.has(dependentId)) {
                    visit(dependentId);
                }
            }
            order.push(id);
        };

        for (const id of startIds) {
            if (this._host.assetsById.has(id)) {
                visit(id);
            }
        }

        return order;
    }

    deleteIds(ids: readonly string[]): void {
        const assets: TransactionStoredAsset<TSchema>[] = [];
        const disposers: TransactionStoredAsset<TSchema>[] = [];

        for (const id of ids) {
            const asset = this._host.assetsById.get(id);
            if (!asset) {
                continue;
            }

            assets.push(asset);

            if (asset.disposer) {
                disposers.push(asset);
            }
        }

        this._runDisposers(disposers);

        for (const asset of assets) {
            const id = asset.id;
            this._host.assetsById.delete(id);
            this._host.keyIndex.delete(asset.key);
            for (const alias of asset.aliases) {
                if (this._host.aliasIndex.get(alias) === id) {
                    this._host.aliasIndex.delete(alias);
                }
            }

            this._host.catalog.unindexAsset(asset);
            this._unlinkDependencies(id, asset.dependencyIds);
            this._host.dependentsById.delete(id);
            this._host.revisionsById.delete(id);
            this._host.catalog.unbindSourceIdentitiesForAsset(id);
            this._host.emitLeaf({
                type: 'delete',
                asset: asset.toRecord(),
            });
        }
    }

    private _resolveDependencyIds(
        inputs: readonly AssetDependencyInput<TSchema>[],
        stagedById: ReadonlyMap<string, PreparedAssetWrite<TSchema>>,
        stagedByKey: ReadonlyMap<string, PreparedAssetWrite<TSchema>>
    ): readonly string[] {
        if (inputs.length === 0) {
            return Object.freeze([]);
        }

        const ids: string[] = [];
        const seen = new Set<string>();

        for (const input of inputs) {
            const resolved =
                this._resolveDependencyInput(input, stagedById, stagedByKey) ??
                this._host.resolveStored(input)?.id;

            if (!resolved) {
                const descriptor =
                    typeof input === 'string'
                        ? input
                        : isLookupByKey(input)
                          ? input.key
                          : isAssetReference(input) || isAssetVersionedReference(input)
                            ? input.id
                            : isAssetRecordValue(input)
                              ? input.id
                              : stableStringify(input);

                throw new AssetDependencyError(
                    resolveAssetMessage(
                        {
                            code: 'asset.dependency.missing',
                            dependency: descriptor,
                        },
                        this._host.locale,
                        this._host.messageResolver
                    ),
                    descriptor
                );
            }

            if (!seen.has(resolved)) {
                seen.add(resolved);
                ids.push(resolved);
            }
        }

        return Object.freeze(ids);
    }

    private _resolveDependencyInput(
        input: AssetDependencyInput<TSchema>,
        stagedById: ReadonlyMap<string, PreparedAssetWrite<TSchema>>,
        stagedByKey: ReadonlyMap<string, PreparedAssetWrite<TSchema>>
    ): string | undefined {
        if (typeof input === 'string') {
            if (isAssetVersionedReferenceToken(input)) {
                return parseAssetVersionedReferenceToken(input)?.id;
            }

            if (isAssetReferenceToken(input)) {
                return parseAssetReferenceToken(input)?.id;
            }

            return (
                stagedById.get(input)?.id ??
                stagedByKey.get(canonicalizeAssetKey(input))?.id ??
                this._host.resolveStored(input)?.id
            );
        }

        if (
            isAssetVersionedReference(input) ||
            isAssetReference(input) ||
            isAssetRecordValue(input)
        ) {
            return input.id;
        }

        if (isLookupByKey(input)) {
            const resolved = stagedByKey.get(canonicalizeAssetKey(input.key));
            if (resolved && (!input.kind || resolved.kind === input.kind)) {
                return resolved.id;
            }

            const existing = this._host.resolveStored(input);
            return existing && (!input.kind || existing.kind === input.kind)
                ? existing.id
                : undefined;
        }

        return undefined;
    }

    commitStoredAssets(
        assets: readonly TransactionStoredAsset<TSchema>[]
    ): readonly AssetRecord<TSchema>[] {
        const previousById = new Map<string, TransactionStoredAsset<TSchema> | undefined>();
        const disposers: TransactionStoredAsset<TSchema>[] = [];
        const records: AssetRecord<TSchema>[] = [];

        for (const asset of assets) {
            this._assertKeyOwnership(asset);

            const previous = this._host.assetsById.get(asset.id);
            previousById.set(asset.id, previous);

            if (previous?.disposer && previous.data !== asset.data) {
                disposers.push(previous);
            }
        }

        this._runDisposers(disposers);

        for (const asset of assets) {
            const previous = previousById.get(asset.id);
            if (previous) {
                this._unlinkDependencies(previous.id, previous.dependencyIds);
                this._host.catalog.unindexAsset(previous);
                this._host.keyIndex.delete(previous.key);
                for (const alias of previous.aliases) {
                    if (this._host.aliasIndex.get(alias) === previous.id) {
                        this._host.aliasIndex.delete(alias);
                    }
                }
            }

            this._storeRevision(asset, previous);
            this._host.assetsById.set(asset.id, asset);
            this._host.keyIndex.set(asset.key, asset.id);
            this._host.aliasIndex.delete(asset.key);
            for (const alias of asset.aliases) {
                this._host.aliasIndex.set(alias, asset.id);
            }
            this._host.catalog.indexAsset(asset);
            this._linkDependencies(asset.id, asset.dependencyIds);
            const record = asset.toRecord();
            records.push(record);
            this._host.emitLeaf({
                type: 'upsert',
                asset: record,
                previous: previous?.toRecord(),
            });
        }

        return Object.freeze(records);
    }

    private _storeRevision(
        asset: TransactionStoredAsset<TSchema>,
        previous?: TransactionStoredAsset<TSchema>
    ): void {
        const revisions = this._host.revisionsById.get(asset.id) ?? [];

        if (!this._host.revisionsById.has(asset.id)) {
            this._host.revisionsById.set(asset.id, revisions);
        }

        if (previous) {
            revisions[previous.revision - 1] = previous;
        }

        revisions[asset.revision - 1] = asset;

        if (revisions.length < asset.revision) {
            revisions.length = asset.revision;
        }
    }

    private _assertKeyOwnership(asset: TransactionStoredAsset<TSchema>): void {
        const keyOwner = this._host.keyIndex.get(asset.key) ?? this._host.aliasIndex.get(asset.key);
        if (keyOwner && keyOwner !== asset.id) {
            throw new AssetConflictError(
                'asset.conflict.key-bound',
                resolveAssetMessage(
                    {
                        code: 'asset.conflict.key-bound',
                        key: asset.key,
                        currentId: keyOwner,
                        requestedId: asset.id,
                    },
                    this._host.locale,
                    this._host.messageResolver
                )
            );
        }

        for (const alias of asset.aliases) {
            const aliasOwner =
                this._host.keyIndex.get(alias) ?? this._host.aliasIndex.get(alias);
            if (aliasOwner && aliasOwner !== asset.id) {
                throw new AssetConflictError(
                    'asset.conflict.key-bound',
                    resolveAssetMessage(
                        {
                            code: 'asset.conflict.key-bound',
                            key: alias,
                            currentId: aliasOwner,
                            requestedId: asset.id,
                        },
                        this._host.locale,
                        this._host.messageResolver
                    )
                );
            }
        }
    }

    private _linkDependencies(assetId: string, dependencyIds: readonly string[]): void {
        for (const dependencyId of dependencyIds) {
            const dependents = this._host.dependentsById.get(dependencyId) ?? new Set<string>();
            dependents.add(assetId);
            this._host.dependentsById.set(dependencyId, dependents);
        }
    }

    private _unlinkDependencies(assetId: string, dependencyIds: readonly string[]): void {
        for (const dependencyId of dependencyIds) {
            const dependents = this._host.dependentsById.get(dependencyId);
            if (!dependents) {
                continue;
            }

            dependents.delete(assetId);
            if (dependents.size === 0) {
                this._host.dependentsById.delete(dependencyId);
            }
        }
    }

    private _runDisposers(assets: readonly TransactionStoredAsset<TSchema>[]): void {
        let firstError: AssetLifecycleError | undefined;

        for (const asset of assets) {
            try {
                asset.disposer?.(asset.data, asset.toRecord());
            } catch (error) {
                firstError ??= new AssetLifecycleError(
                    resolveAssetMessage(
                        {
                            code: 'asset.lifecycle.dispose-failed',
                            id: asset.id,
                            kind: asset.kind,
                            reason: error,
                        },
                        this._host.locale,
                        this._host.messageResolver
                    ),
                    asset.id,
                    asset.kind,
                    {
                        cause: error,
                    }
                );
            }
        }

        if (firstError) {
            throw firstError;
        }
    }
}
