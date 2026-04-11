import type { IDisposable } from './disposable';
import type { AssetDatabase } from './database';
import type { AssetImportPipeline } from './importer';

export type AssetSchema = Readonly<Record<string, unknown>>;
export type AssetKind<TSchema extends AssetSchema = AssetSchema> = Extract<keyof TSchema, string>;
export type AssetData<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> = TSchema[TKind];

export type AssetId = string & { readonly __assetIdBrand: unique symbol };
export type AssetKey = string & { readonly __assetKeyBrand: unique symbol };
export type AssetUri = string & { readonly __assetUriBrand: unique symbol };
export type AssetFingerprint = string & { readonly __assetFingerprintBrand: unique symbol };
export type AssetRevision = number & { readonly __assetRevisionBrand: unique symbol };
export type AssetLocale = string & { readonly __assetLocaleBrand: unique symbol };
export type AssetImporterId = string & { readonly __assetImporterIdBrand: unique symbol };
export type AssetSourceIdentity = string & { readonly __assetSourceIdentityBrand: unique symbol };

export type AssetReferenceToken<TKind extends string = string> = `asset:${TKind}:${string}`;
export type AssetVersionedReferenceToken<TKind extends string = string> =
    `asset:${TKind}:${string}@${number}`;

export type AssetJsonPrimitive = string | number | boolean | null;

export interface AssetJsonObject {
    readonly [key: string]: AssetJsonValue;
}

export interface AssetJsonArray extends ReadonlyArray<AssetJsonValue> {}

export type AssetJsonValue = AssetJsonPrimitive | AssetJsonObject | AssetJsonArray;

export interface AssetInlineBinaryValue {
    readonly __asset: 'axrone.binary';
    readonly storage: 'inline';
    readonly encoding: 'base64';
    readonly data: string;
    readonly byteLength: number;
}

export interface AssetExternalBinaryValue {
    readonly __asset: 'axrone.binary';
    readonly storage: 'external';
    readonly storageKey: string;
    readonly byteLength: number;
}

export type AssetBinaryValue = AssetInlineBinaryValue | AssetExternalBinaryValue;
export type AssetSerializedValue = AssetJsonValue | AssetBinaryValue;

export interface AssetMetadataInput {
    readonly uri?: string;
    readonly mimeType?: string;
    readonly locale?: string;
    readonly tags?: readonly string[];
    readonly properties?: Readonly<Record<string, AssetJsonValue>>;
}

export interface AssetMetadata {
    readonly uri?: AssetUri;
    readonly mimeType?: string;
    readonly locale?: AssetLocale;
    readonly tags: readonly string[];
    readonly properties: Readonly<Record<string, AssetJsonValue>>;
}

export interface AssetReference<TKind extends string = string> {
    readonly kind: TKind;
    readonly id: AssetId;
    readonly token: AssetReferenceToken<TKind>;
}

export interface AssetVersionedReference<TKind extends string = string>
    extends AssetReference<TKind> {
    readonly revision: AssetRevision;
    readonly versionedToken: AssetVersionedReferenceToken<TKind>;
}

export interface AssetRecord<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly kind: TKind;
    readonly id: AssetId;
    readonly key: AssetKey;
    readonly aliases: readonly AssetKey[];
    readonly name: string;
    readonly data: AssetData<TSchema, TKind>;
    readonly revision: AssetRevision;
    readonly fingerprint: AssetFingerprint;
    readonly createdAtEpochMs: number;
    readonly updatedAtEpochMs: number;
    readonly metadata: AssetMetadata;
    readonly dependencyIds: readonly AssetId[];
    readonly reference: AssetReference<TKind>;
    readonly versionedReference: AssetVersionedReference<TKind>;
}

export interface AssetLookupByKey<TSchema extends AssetSchema = AssetSchema> {
    readonly key: string;
    readonly kind?: AssetKind<TSchema>;
}

export interface AssetSourceBinding {
    readonly sourceIdentity: AssetSourceIdentity;
    readonly assetId: AssetId;
    readonly updatedAtEpochMs: number;
}

export interface AssetQuery<TSchema extends AssetSchema = AssetSchema> {
    readonly kind?: AssetKind<TSchema>;
    readonly fingerprint?: string;
    readonly uri?: string;
    readonly mimeType?: string;
    readonly locale?: string;
    readonly tags?: readonly string[];
    readonly properties?: Readonly<Record<string, AssetJsonValue>>;
}

export type AssetSelector<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> =
    | string
    | AssetReference<TKind>
    | AssetVersionedReference<TKind>
    | AssetRecord<TSchema, TKind>
    | AssetLookupByKey<TSchema>;

export type AssetDependencyInput<TSchema extends AssetSchema = AssetSchema> =
    | string
    | AssetReference<AssetKind<TSchema>>
    | AssetVersionedReference<AssetKind<TSchema>>
    | AssetRecord<TSchema>
    | AssetLookupByKey<TSchema>;

export type AssetDisposer<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> = (data: AssetData<TSchema, TKind>, record: Readonly<AssetRecord<TSchema, TKind>>) => void;

export interface AssetJsonCodec<TData> {
    readonly format?: 'json';
    serialize(data: TData): AssetJsonValue;
    deserialize(data: AssetJsonValue): TData;
}

export interface AssetBinaryCodec<TData> {
    readonly format: 'binary';
    serialize(data: TData): ArrayBuffer | ArrayBufferView | Uint8Array;
    deserialize(data: Uint8Array): TData;
}

export type AssetCodec<TData> = AssetJsonCodec<TData> | AssetBinaryCodec<TData>;

export type AssetCodecMap<TSchema extends AssetSchema> = {
    readonly [TKind in AssetKind<TSchema>]?: AssetCodec<AssetData<TSchema, TKind>>;
};

export type AssetDisposerMap<TSchema extends AssetSchema> = {
    readonly [TKind in AssetKind<TSchema>]?: AssetDisposer<TSchema, TKind>;
};

export interface AssetWriteInput<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly id?: string;
    readonly kind: TKind;
    readonly data: AssetData<TSchema, TKind>;
    readonly name?: string;
    readonly stableKey?: string;
    readonly aliases?: readonly string[];
    readonly metadata?: AssetMetadataInput;
    readonly dependencies?: readonly AssetDependencyInput<TSchema>[];
    readonly fingerprint?: string;
    readonly disposer?: AssetDisposer<TSchema, TKind>;
}

export interface AssetImportDiagnostic {
    readonly level: 'info' | 'warning' | 'error';
    readonly code?: string;
    readonly message: string;
}

export interface AssetImportResult<
    TSchema extends AssetSchema,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly primary: AssetWriteInput<TSchema, TPrimaryKind>;
    readonly additional?: readonly AssetWriteInput<TSchema>[];
    readonly diagnostics?: readonly AssetImportDiagnostic[];
}

export interface AssetSourceBase {
    readonly uri?: string;
    readonly stableKey?: string;
    readonly sourceIdentity?: string;
    readonly name?: string;
    readonly mimeType?: string;
    readonly locale?: string;
    readonly metadata?: Readonly<Record<string, AssetJsonValue>>;
}

export interface AssetBytesSource extends AssetSourceBase {
    readonly kind: 'bytes';
    readonly data: ArrayBuffer | ArrayBufferView | Uint8Array;
}

export interface AssetTextSource extends AssetSourceBase {
    readonly kind: 'text';
    readonly data: string;
}

export interface AssetJsonSource extends AssetSourceBase {
    readonly kind: 'json';
    readonly data: AssetJsonValue;
}

export interface AssetCustomSource<TData = unknown> extends AssetSourceBase {
    readonly kind: 'custom';
    readonly data: TData;
    readonly format?: string;
}

export type AssetImportSource =
    | AssetBytesSource
    | AssetTextSource
    | AssetJsonSource
    | AssetCustomSource;

export type AssetSourceKind = AssetImportSource['kind'];

export interface AssetImporterMatchContext<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> {
    readonly source: TSource;
    readonly locale: string;
    readonly database: AssetDatabase<TSchema>;
}

export interface AssetImportContext<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> extends AssetImporterMatchContext<TSchema, TSource> {
    readonly pipeline: AssetImportPipeline<TSchema>;
    readonly signal?: AbortSignal;
    readonly attempt: number;
    readonly nowEpochMs: number;
    readonly baseKey: AssetKey;
    readonly createSubKey: (suffix: string) => AssetKey;
    readonly resolveDependency: (
        input: AssetDependencyInput<TSchema>
    ) => AssetRecord<TSchema> | undefined;
}

export type AssetImportStagePhase = 'source' | 'before-import' | 'after-import';

export interface AssetImportStageContextBase<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> extends AssetImporterMatchContext<TSchema, TSource> {
    readonly phase: AssetImportStagePhase;
    readonly pipeline: AssetImportPipeline<TSchema>;
    readonly signal?: AbortSignal;
    readonly attempt: number;
    readonly nowEpochMs: number;
    readonly baseKey: AssetKey;
}

export interface AssetSourceStageContext<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> extends AssetImportStageContextBase<TSchema, TSource> {
    readonly phase: 'source';
}

export interface AssetBeforeImportStageContext<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> extends AssetImportStageContextBase<TSchema, TSource> {
    readonly phase: 'before-import';
    readonly importer: AssetImporter<TSchema, TSource>;
}

export interface AssetAfterImportStageContext<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> extends AssetImportStageContextBase<TSchema, TSource> {
    readonly phase: 'after-import';
    readonly importer: AssetImporter<TSchema, TSource>;
    readonly result: AssetImportResult<TSchema, TPrimaryKind>;
}

export type AssetImportStageContext<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> =
    | AssetSourceStageContext<TSchema, TSource>
    | AssetBeforeImportStageContext<TSchema, TSource>
    | AssetAfterImportStageContext<TSchema, TSource, TPrimaryKind>;

export interface AssetImportStageOutput<
    TSchema extends AssetSchema,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly source?: AssetImportSource;
    readonly result?: AssetImportResult<TSchema, TPrimaryKind>;
    readonly diagnostics?: readonly AssetImportDiagnostic[];
}

export interface AssetImportStage<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly id: string;
    readonly priority?: number;
    readonly phases?: readonly AssetImportStagePhase[];
    readonly sourceKinds?: readonly TSource['kind'][];
    canProcess?(
        context: Readonly<AssetImportStageContext<TSchema, TSource, TPrimaryKind>>
    ): boolean;
    run(
        context: Readonly<AssetImportStageContext<TSchema, TSource, TPrimaryKind>>
    ):
        | AssetImportStageOutput<TSchema, TPrimaryKind>
        | Promise<AssetImportStageOutput<TSchema, TPrimaryKind>>;
}

export interface AssetImporter<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly id: string;
    readonly priority?: number;
    readonly sourceKinds?: readonly TSource['kind'][];
    readonly extensions?: readonly string[];
    readonly mimeTypes?: readonly string[];
    canImport?(
        context: Readonly<AssetImporterMatchContext<TSchema, TSource>>
    ): boolean;
    import(
        context: Readonly<AssetImportContext<TSchema, TSource>>
    ): AssetImportResult<TSchema, TPrimaryKind> | Promise<AssetImportResult<TSchema, TPrimaryKind>>;
}

export type AssetImportedKind<TImporter> = TImporter extends AssetImporter<
    infer TSchema,
    AssetImportSource,
    infer TKind
>
    ? TKind & AssetKind<TSchema>
    : never;

export interface AssetImportFailureContext<
    TSchema extends AssetSchema = AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> {
    readonly source: TSource;
    readonly importerId: string;
    readonly attempt: number;
    readonly maxAttempts: number;
    readonly locale: string;
    readonly database: AssetDatabase<TSchema>;
    readonly baseKey: AssetKey;
}

export interface AssetRetryPolicy<
    TSchema extends AssetSchema = AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> {
    readonly attempts?: number;
    readonly baseDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly shouldRetry?: (
        error: unknown,
        context: Readonly<AssetImportFailureContext<TSchema, TSource>>
    ) => boolean;
}

export interface AssetImportOptions<
    TSchema extends AssetSchema = AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> {
    readonly stableKey?: string;
    readonly sourceIdentity?: string;
    readonly locale?: string;
    readonly signal?: AbortSignal;
    readonly retry?: AssetRetryPolicy<TSchema, TSource>;
}

export interface AssetImportManyOptions<
    TSchema extends AssetSchema = AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> extends AssetImportOptions<TSchema, TSource> {
    readonly concurrency?: number;
}

export interface AssetPipelineExecution<
    TSchema extends AssetSchema,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly importerId: AssetImporterId;
    readonly importer: AssetImporter<TSchema>;
    readonly baseKey: AssetKey;
    readonly sourceIdentity?: AssetSourceIdentity;
    readonly importedAtEpochMs: number;
    readonly diagnostics: readonly AssetImportDiagnostic[];
    readonly result: AssetImportResult<TSchema, TPrimaryKind>;
}

export interface AssetImportReceipt<
    TSchema extends AssetSchema,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly importerId: AssetImporterId;
    readonly sourceKind: AssetSourceKind;
    readonly sourceUri?: AssetUri;
    readonly baseKey: AssetKey;
    readonly sourceIdentity?: AssetSourceIdentity;
    readonly importedAtEpochMs: number;
    readonly diagnostics: readonly AssetImportDiagnostic[];
    readonly primary: AssetRecord<TSchema, TPrimaryKind>;
    readonly assets: readonly AssetRecord<TSchema>[];
}

export type AssetValidationMessageCode =
    | `asset.invalid-${'id' | 'importer' | 'key' | 'kind' | 'revision' | 'source' | 'source-identity' | 'stage'}`
    | `asset.conflict.${'key-bound' | 'kind-mismatch'}`
    | 'asset.dependency.missing';

export type AssetRuntimeMessageCode =
    | 'asset.disposed'
    | 'asset.import.failed'
    | 'asset.importer.not-found'
    | 'asset.lifecycle.dispose-failed'
    | 'asset.reference.invalid'
    | 'asset.snapshot.invalid';

export type AssetMessageCode = AssetValidationMessageCode | AssetRuntimeMessageCode;

export type AssetMessageDescriptor =
    | {
          readonly code: 'asset.invalid-id';
          readonly value: unknown;
      }
    | {
          readonly code: 'asset.invalid-importer';
          readonly value: unknown;
      }
    | {
          readonly code: 'asset.invalid-key';
          readonly value: unknown;
      }
    | {
          readonly code: 'asset.invalid-kind';
          readonly value: unknown;
      }
    | {
          readonly code: 'asset.invalid-revision';
          readonly value: unknown;
      }
    | {
          readonly code: 'asset.invalid-source';
          readonly value: unknown;
      }
    | {
          readonly code: 'asset.invalid-source-identity';
          readonly value: unknown;
      }
    | {
          readonly code: 'asset.invalid-stage';
          readonly value: unknown;
      }
    | {
          readonly code: 'asset.conflict.key-bound';
          readonly key: string;
          readonly currentId: string;
          readonly requestedId: string;
      }
    | {
          readonly code: 'asset.conflict.kind-mismatch';
          readonly id: string;
          readonly expected: string;
          readonly received: string;
      }
    | {
          readonly code: 'asset.dependency.missing';
          readonly dependency: string;
      }
    | {
          readonly code: 'asset.disposed';
      }
    | {
          readonly code: 'asset.import.failed';
          readonly importerId: string;
          readonly attempt: number;
          readonly reason: unknown;
      }
    | {
          readonly code: 'asset.importer.not-found';
          readonly sourceKind: AssetSourceKind;
          readonly uri?: string;
          readonly mimeType?: string;
      }
    | {
          readonly code: 'asset.lifecycle.dispose-failed';
          readonly id: string;
          readonly kind: string;
          readonly reason: unknown;
      }
    | {
          readonly code: 'asset.reference.invalid';
          readonly value: unknown;
      }
    | {
          readonly code: 'asset.snapshot.invalid';
          readonly reason: string;
      };

export type AssetMessageResolver = (
    descriptor: Readonly<AssetMessageDescriptor>,
    locale: string
) => string | undefined;

export type AssetLeafChangeEvent<TSchema extends AssetSchema> =
    | {
          readonly type: 'upsert';
          readonly asset: AssetRecord<TSchema>;
          readonly previous?: AssetRecord<TSchema>;
      }
    | {
          readonly type: 'delete';
          readonly asset: AssetRecord<TSchema>;
      }
    | {
          readonly type: 'import';
          readonly receipt: AssetImportReceipt<TSchema>;
      };

export type AssetChangeEvent<TSchema extends AssetSchema> =
    | AssetLeafChangeEvent<TSchema>
    | {
          readonly type: 'batch';
          readonly events: readonly AssetLeafChangeEvent<TSchema>[];
      };

export type AssetListener<TSchema extends AssetSchema> = (
    event: Readonly<AssetChangeEvent<TSchema>>
) => void;

export interface AssetSubscription extends IDisposable {}

export interface AssetDeleteOptions {
    readonly cascade?: boolean;
}

export interface AssetSnapshotRevisionRecord<TKind extends string = string> {
    readonly kind: TKind;
    readonly id: string;
    readonly key: string;
    readonly aliases: readonly string[];
    readonly name: string;
    readonly revision: number;
    readonly fingerprint: string;
    readonly createdAtEpochMs: number;
    readonly updatedAtEpochMs: number;
    readonly metadata: {
        readonly uri?: string;
        readonly mimeType?: string;
        readonly locale?: string;
        readonly tags: readonly string[];
        readonly properties: Readonly<Record<string, AssetJsonValue>>;
    };
    readonly dependencyIds: readonly string[];
    readonly data: AssetSerializedValue;
}

export interface AssetSnapshotRecord<TKind extends string = string>
    extends AssetSnapshotRevisionRecord<TKind> {
    readonly history?: readonly AssetSnapshotRevisionRecord<TKind>[];
}

export interface AssetSnapshotSourceBindingRecord {
    readonly sourceIdentity: string;
    readonly assetId: string;
    readonly updatedAtEpochMs: number;
}

export interface AssetDatabaseSnapshot<TKind extends string = string> {
    readonly version: 4;
    readonly locale: string;
    readonly capturedAtEpochMs: number;
    readonly assets: readonly AssetSnapshotRecord<TKind>[];
    readonly sourceBindings?: readonly AssetSnapshotSourceBindingRecord[];
}

export interface AssetHydrateOptions {
    readonly replace?: boolean;
}

export interface AssetImportPipelineOptions<TSchema extends AssetSchema> {
    readonly importers?: readonly AssetImporter<TSchema>[];
    readonly stages?: readonly AssetImportStage<TSchema>[];
    readonly locale?: string;
    readonly retry?: AssetRetryPolicy<TSchema>;
    readonly messageResolver?: AssetMessageResolver;
    readonly now?: () => number;
}

export interface AssetBinaryStoreWriteRequest {
    readonly kind: string;
    readonly id: string;
    readonly key: string;
    readonly revision: number;
    readonly fingerprint: string;
    readonly metadata: AssetMetadata;
    readonly bytes: Uint8Array;
}

export interface AssetBinaryStoreReadRequest {
    readonly kind: string;
    readonly id: string;
    readonly key: string;
    readonly revision: number;
    readonly fingerprint: string;
    readonly metadata: AssetMetadata;
    readonly reference: AssetExternalBinaryValue;
}

export interface AssetBinaryStore {
    write(request: Readonly<AssetBinaryStoreWriteRequest>): string;
    read(request: Readonly<AssetBinaryStoreReadRequest>): ArrayBuffer | ArrayBufferView | Uint8Array;
}

export interface AssetBinaryPersistenceOptions {
    readonly mode?: 'inline' | 'external' | 'auto';
    readonly inlineThresholdBytes?: number;
    readonly store?: AssetBinaryStore;
}

export interface AssetDatabaseOptions<TSchema extends AssetSchema> {
    readonly locale?: string;
    readonly importers?: readonly AssetImporter<TSchema>[];
    readonly stages?: readonly AssetImportStage<TSchema>[];
    readonly binary?: AssetBinaryPersistenceOptions;
    readonly pipeline?: AssetImportPipeline<TSchema>;
    readonly retry?: AssetRetryPolicy<TSchema>;
    readonly codecs?: AssetCodecMap<TSchema>;
    readonly disposers?: AssetDisposerMap<TSchema>;
    readonly messageResolver?: AssetMessageResolver;
    readonly now?: () => number;
}
