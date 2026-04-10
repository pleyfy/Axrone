export type AssetSchema = Readonly<Record<string, unknown>>;
export type AssetKind<TSchema extends AssetSchema = AssetSchema> = Extract<keyof TSchema, string>;
export type AssetData<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> = TSchema[TKind];

export type AssetJsonPrimitive = string | number | boolean | null;

export interface AssetJsonObject {
    readonly [key: string]: AssetJsonValue;
}

export interface AssetJsonArray extends ReadonlyArray<AssetJsonValue> {}

export type AssetJsonValue = AssetJsonPrimitive | AssetJsonObject | AssetJsonArray;

export interface AssetMetadataInput {
    readonly uri?: string;
    readonly mimeType?: string;
    readonly locale?: string;
    readonly tags?: readonly string[];
    readonly properties?: Readonly<Record<string, AssetJsonValue>>;
}

export interface AssetReference<TKind extends string = string> {
    readonly kind: TKind;
    readonly id: string;
    readonly token: `asset:${TKind}:${string}`;
}

export interface AssetVersionedReference<TKind extends string = string>
    extends AssetReference<TKind> {
    readonly revision: number;
    readonly versionedToken: `asset:${TKind}:${string}@${number}`;
}

export interface AssetRecord<
    TSchema extends AssetSchema,
    TKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly kind: TKind;
    readonly id: string;
    readonly key: string;
    readonly aliases: readonly string[];
    readonly name: string;
    readonly data: AssetData<TSchema, TKind>;
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
    readonly reference: AssetReference<TKind>;
    readonly versionedReference: AssetVersionedReference<TKind>;
}

export interface AssetLookupByKey<TSchema extends AssetSchema = AssetSchema> {
    readonly key: string;
    readonly kind?: AssetKind<TSchema>;
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

export interface AssetImporterMatchContext<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> {
    readonly source: TSource;
}

export interface AssetImportContext<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
> extends AssetImporterMatchContext<TSchema, TSource> {
    readonly createSubKey: (suffix: string) => string;
    readonly signal?: AbortSignal;
}

export type AssetImportStagePhase = 'source' | 'before-import' | 'after-import';

export type AssetImportStageContext<
    TSchema extends AssetSchema,
    TSource extends AssetImportSource = AssetImportSource,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> =
    | (AssetImporterMatchContext<TSchema, TSource> & {
          readonly phase: 'source';
          readonly signal?: AbortSignal;
      })
    | (AssetImporterMatchContext<TSchema, TSource> & {
          readonly phase: 'before-import';
          readonly importer: AssetImporter<TSchema, TSource, TPrimaryKind>;
          readonly signal?: AbortSignal;
      })
    | (AssetImporterMatchContext<TSchema, TSource> & {
          readonly phase: 'after-import';
          readonly importer: AssetImporter<TSchema, TSource, TPrimaryKind>;
          readonly result: AssetImportResult<TSchema, TPrimaryKind>;
          readonly signal?: AbortSignal;
      });

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

export interface AssetDatabase<TSchema extends AssetSchema = AssetSchema> {
    require<TKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        selector: AssetSelector<TSchema, TKind>
    ): AssetRecord<TSchema, TKind>;
}
