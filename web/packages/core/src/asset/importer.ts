import type { AssetDatabase } from './database';
import {
    AssetError,
    AssetConfigurationError,
    AssetDisposedError,
    AssetImportError,
    AssetImporterNotFoundError,
    resolveAssetMessage,
} from './errors';
import {
    asAssetImporterId,
    canonicalizeAssetKey,
    normalizeAssetLocale,
} from './reference';
import type {
    AssetImportContext,
    AssetImportDiagnostic,
    AssetImportFailureContext,
    AssetImporter,
    AssetImporterMatchContext,
    AssetImportOptions,
    AssetImportPipelineOptions,
    AssetImportResult,
    AssetImportSource,
    AssetImportStage,
    AssetImportStageContext,
    AssetImportStagePhase,
    AssetKind,
    AssetKey,
    AssetMessageResolver,
    AssetPipelineExecution,
    AssetRetryPolicy,
    AssetSchema,
    AssetSourceKind,
} from './types';

const DEFAULT_RETRY_POLICY = {
    attempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
} as const satisfies Required<Pick<AssetRetryPolicy, 'attempts' | 'baseDelayMs' | 'maxDelayMs'>>;
const DEFAULT_STAGE_PHASES = Object.freeze([
    'source',
    'before-import',
    'after-import',
] as const satisfies readonly AssetImportStagePhase[]);
const EMPTY_IMPORT_DIAGNOSTICS = Object.freeze([]) as readonly AssetImportDiagnostic[];

type AssetPipelineNodeKind = 'importer' | 'stage';

interface AssetStageExecutionState<
    TSchema extends AssetSchema,
    TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>,
> {
    readonly source: AssetImportSource;
    readonly result?: AssetImportResult<TSchema, TPrimaryKind>;
    readonly diagnostics: readonly AssetImportDiagnostic[];
}

const createAbortError = (): Error => {
    const error = new Error('The operation was aborted');
    error.name = 'AbortError';
    return error;
};

const ensureNotAborted = (signal?: AbortSignal): void => {
    if (signal?.aborted) {
        throw createAbortError();
    }
};

const delay = (durationMs: number, signal?: AbortSignal): Promise<void> => {
    if (durationMs <= 0) {
        return Promise.resolve();
    }

    return new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, durationMs);

        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(createAbortError());
        };

        signal?.addEventListener('abort', onAbort, { once: true });
    });
};

const normalizeExtension = (value: string): string => value.replace(/^\./, '').toLowerCase();

const getSourceExtension = (uri?: string): string | undefined => {
    if (!uri) {
        return undefined;
    }

    const path = uri.split(/[?#]/, 1)[0] ?? '';
    const lastDot = path.lastIndexOf('.');

    if (lastDot <= 0 || lastDot === path.length - 1) {
        return undefined;
    }

    return normalizeExtension(path.slice(lastDot + 1));
};

const matchesImporter = <TSchema extends AssetSchema>(
    importer: AssetImporter<TSchema>,
    context: Readonly<AssetImporterMatchContext<TSchema>>
): boolean => {
    const sourceKind = context.source.kind;
    if (importer.sourceKinds && !importer.sourceKinds.includes(sourceKind)) {
        return false;
    }

    const sourceMimeType = context.source.mimeType?.trim().toLowerCase();
    if (importer.mimeTypes?.length) {
        if (!sourceMimeType) {
            return false;
        }

        const mimeMatch = importer.mimeTypes.some(
            (value) => value.trim().toLowerCase() === sourceMimeType
        );

        if (!mimeMatch) {
            return false;
        }
    }

    if (importer.extensions?.length) {
        const sourceExtension = getSourceExtension(context.source.uri);
        if (!sourceExtension) {
            return false;
        }

        const extensionMatch = importer.extensions.some(
            (value) => normalizeExtension(value) === sourceExtension
        );

        if (!extensionMatch) {
            return false;
        }
    }

    return importer.canImport?.(context as never) ?? true;
};

const normalizeImporterPriority = (value: number | undefined): number =>
    Number.isFinite(value) ? value! : 0;

const normalizeStagePriority = (value: number | undefined): number =>
    Number.isFinite(value) ? value! : 0;

export const isAssetImporter = <TSchema extends AssetSchema = AssetSchema>(
    value: unknown
): value is AssetImporter<TSchema> =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AssetImporter<TSchema>).id === 'string' &&
    typeof (value as AssetImporter<TSchema>).import === 'function';

export const isAssetImportStage = <TSchema extends AssetSchema = AssetSchema>(
    value: unknown
): value is AssetImportStage<TSchema> =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AssetImportStage<TSchema>).id === 'string' &&
    typeof (value as AssetImportStage<TSchema>).run === 'function';

export class AssetImporterRegistry<TSchema extends AssetSchema = AssetSchema> {
    private readonly _byId = new Map<string, AssetImporter<TSchema>>();
    private readonly _kindIndex = new Map<AssetSourceKind, AssetImporter<TSchema>[]>();
    private readonly _mimeTypeIndex = new Map<string, AssetImporter<TSchema>[]>();
    private readonly _extensionIndex = new Map<string, AssetImporter<TSchema>[]>();
    private _sorted: readonly AssetImporter<TSchema>[] = Object.freeze([]);
    private _wildcardImporters: readonly AssetImporter<TSchema>[] = Object.freeze([]);
    private _disposed = false;

    get isDisposed(): boolean {
        return this._disposed;
    }

    register(importer: AssetImporter<TSchema>): this {
        if (this._disposed) {
            throw new AssetDisposedError('Cannot register an importer on a disposed registry');
        }

        if (!isAssetImporter(importer) || !importer.id.trim()) {
            throw new AssetConfigurationError(
                'asset.invalid-importer',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-importer',
                        value: importer,
                    },
                    'en-US'
                )
            );
        }

        this._byId.set(importer.id, importer);
        this._rebuild();
        return this;
    }

    unregister(importerId: string): boolean {
        if (this._disposed) {
            return false;
        }

        const deleted = this._byId.delete(importerId);
        if (deleted) {
            this._rebuild();
        }

        return deleted;
    }

    clear(): void {
        if (this._disposed) {
            return;
        }

        this._byId.clear();
        this._rebuild();
    }

    list(): readonly AssetImporter<TSchema>[] {
        return this._sorted;
    }

    find(
        context: Readonly<AssetImporterMatchContext<TSchema>>
    ): AssetImporter<TSchema> | undefined {
        if (this._disposed) {
            throw new AssetDisposedError('Cannot query a disposed importer registry');
        }

        const candidates: AssetImporter<TSchema>[] = [];
        const seen = new Set<AssetImporter<TSchema>>();
        const sourceMimeType = context.source.mimeType?.trim().toLowerCase();
        const sourceExtension = getSourceExtension(context.source.uri);

        const append = (values?: readonly AssetImporter<TSchema>[]): void => {
            for (const importer of values ?? []) {
                if (!seen.has(importer)) {
                    seen.add(importer);
                    candidates.push(importer);
                }
            }
        };

        append(this._kindIndex.get(context.source.kind));
        if (sourceMimeType) {
            append(this._mimeTypeIndex.get(sourceMimeType));
        }
        if (sourceExtension) {
            append(this._extensionIndex.get(sourceExtension));
        }
        append(this._wildcardImporters);

        return candidates.find((importer) => matchesImporter(importer, context));
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._byId.clear();
        this._kindIndex.clear();
        this._mimeTypeIndex.clear();
        this._extensionIndex.clear();
        this._sorted = Object.freeze([]);
        this._wildcardImporters = Object.freeze([]);
    }

    private _rebuild(): void {
        const sorted = [...this._byId.values()].sort((left, right) => {
            const priorityDelta =
                normalizeImporterPriority(right.priority) - normalizeImporterPriority(left.priority);

            if (priorityDelta !== 0) {
                return priorityDelta;
            }

            return left.id.localeCompare(right.id);
        });

        this._kindIndex.clear();
        this._mimeTypeIndex.clear();
        this._extensionIndex.clear();

        const wildcards: AssetImporter<TSchema>[] = [];

        for (const importer of sorted) {
            if (importer.sourceKinds?.length) {
                for (const kind of importer.sourceKinds) {
                    const bucket = this._kindIndex.get(kind) ?? [];
                    bucket.push(importer);
                    this._kindIndex.set(kind, bucket);
                }
            } else {
                wildcards.push(importer);
            }

            for (const mimeType of importer.mimeTypes ?? []) {
                const normalized = mimeType.trim().toLowerCase();
                if (!normalized) {
                    continue;
                }

                const bucket = this._mimeTypeIndex.get(normalized) ?? [];
                bucket.push(importer);
                this._mimeTypeIndex.set(normalized, bucket);
            }

            for (const extension of importer.extensions ?? []) {
                const normalized = normalizeExtension(extension);
                if (!normalized) {
                    continue;
                }

                const bucket = this._extensionIndex.get(normalized) ?? [];
                bucket.push(importer);
                this._extensionIndex.set(normalized, bucket);
            }
        }

        this._sorted = Object.freeze(sorted);
        this._wildcardImporters = Object.freeze(wildcards);
    }
}

const matchesStage = <TSchema extends AssetSchema>(
    stage: AssetImportStage<TSchema>,
    phase: AssetImportStagePhase,
    sourceKind: AssetSourceKind,
    context: Readonly<AssetImportStageContext<TSchema>>
): boolean => {
    if (stage.phases?.length && !stage.phases.includes(phase)) {
        return false;
    }

    if (stage.sourceKinds?.length && !stage.sourceKinds.includes(sourceKind)) {
        return false;
    }

    return stage.canProcess?.(context as never) ?? true;
};

export class AssetImportStageRegistry<TSchema extends AssetSchema = AssetSchema> {
    private readonly _byId = new Map<string, AssetImportStage<TSchema>>();
    private readonly _byPhase = new Map<AssetImportStagePhase, AssetImportStage<TSchema>[]>();
    private _sorted: readonly AssetImportStage<TSchema>[] = Object.freeze([]);
    private _disposed = false;

    constructor() {
        for (const phase of DEFAULT_STAGE_PHASES) {
            this._byPhase.set(phase, []);
        }
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    register(stage: AssetImportStage<TSchema>): this {
        if (this._disposed) {
            throw new AssetDisposedError('Cannot register a stage on a disposed asset pipeline');
        }

        if (!isAssetImportStage(stage) || !stage.id.trim()) {
            throw new AssetConfigurationError(
                'asset.invalid-stage',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-stage',
                        value: stage,
                    },
                    'en-US'
                )
            );
        }

        this._byId.set(stage.id, stage);
        this._rebuild();
        return this;
    }

    unregister(stageId: string): boolean {
        if (this._disposed) {
            return false;
        }

        const deleted = this._byId.delete(stageId);
        if (deleted) {
            this._rebuild();
        }

        return deleted;
    }

    clear(): void {
        if (this._disposed) {
            return;
        }

        this._byId.clear();
        this._rebuild();
    }

    list(): readonly AssetImportStage<TSchema>[] {
        return this._sorted;
    }

    listByPhase(phase: AssetImportStagePhase): readonly AssetImportStage<TSchema>[] {
        return this._byPhase.get(phase) ?? [];
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._byId.clear();
        this._sorted = Object.freeze([]);
        for (const phase of DEFAULT_STAGE_PHASES) {
            this._byPhase.set(phase, []);
        }
    }

    private _rebuild(): void {
        const sorted = [...this._byId.values()].sort((left, right) => {
            const priorityDelta =
                normalizeStagePriority(right.priority) - normalizeStagePriority(left.priority);

            if (priorityDelta !== 0) {
                return priorityDelta;
            }

            return left.id.localeCompare(right.id);
        });

        for (const phase of DEFAULT_STAGE_PHASES) {
            this._byPhase.set(phase, []);
        }

        for (const stage of sorted) {
            const phases = stage.phases?.length ? stage.phases : DEFAULT_STAGE_PHASES;

            for (const phase of phases) {
                const bucket = this._byPhase.get(phase)!;
                bucket.push(stage);
            }
        }

        this._sorted = Object.freeze(sorted);
    }
}

export class AssetImportPipeline<TSchema extends AssetSchema = AssetSchema> {
    private readonly _registry: AssetImporterRegistry<TSchema>;
    private readonly _stageRegistry: AssetImportStageRegistry<TSchema>;
    private readonly _locale: string;
    private readonly _messageResolver?: AssetMessageResolver;
    private readonly _now: () => number;
    private readonly _retry: Required<
        Pick<AssetRetryPolicy<TSchema>, 'attempts' | 'baseDelayMs' | 'maxDelayMs'>
    > &
        Pick<AssetRetryPolicy<TSchema>, 'shouldRetry'>;
    private _disposed = false;
    private _anonymousCounter = 0;

    constructor(options: AssetImportPipelineOptions<TSchema> = {}) {
        this._registry = new AssetImporterRegistry<TSchema>();
        this._stageRegistry = new AssetImportStageRegistry<TSchema>();
        this._locale = normalizeAssetLocale(options.locale) ?? 'en-US';
        this._messageResolver = options.messageResolver;
        this._now = options.now ?? Date.now;
        this._retry = {
            attempts: Math.max(
                1,
                Math.trunc(options.retry?.attempts ?? DEFAULT_RETRY_POLICY.attempts)
            ),
            baseDelayMs: Math.max(0, options.retry?.baseDelayMs ?? DEFAULT_RETRY_POLICY.baseDelayMs),
            maxDelayMs: Math.max(0, options.retry?.maxDelayMs ?? DEFAULT_RETRY_POLICY.maxDelayMs),
            shouldRetry: options.retry?.shouldRetry,
        };

        for (const importer of options.importers ?? []) {
            this._registry.register(importer);
        }

        for (const stage of options.stages ?? []) {
            this._stageRegistry.register(stage);
        }
    }

    get isDisposed(): boolean {
        return this._disposed;
    }

    register(importer: AssetImporter<TSchema>): this {
        this._assertNotDisposed();
        this._registry.register(importer);
        return this;
    }

    unregister(importerId: string): boolean {
        this._assertNotDisposed();
        return this._registry.unregister(importerId);
    }

    listImporters(): readonly AssetImporter<TSchema>[] {
        this._assertNotDisposed();
        return this._registry.list();
    }

    registerStage(stage: AssetImportStage<TSchema>): this {
        this._assertNotDisposed();
        this._stageRegistry.register(stage);
        return this;
    }

    unregisterStage(stageId: string): boolean {
        this._assertNotDisposed();
        return this._stageRegistry.unregister(stageId);
    }

    listStages(): readonly AssetImportStage<TSchema>[] {
        this._assertNotDisposed();
        return this._stageRegistry.list();
    }

    async import<TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        database: AssetDatabase<TSchema>,
        source: AssetImportSource,
        options: AssetImportOptions<TSchema> = {}
    ): Promise<AssetPipelineExecution<TSchema, TPrimaryKind>> {
        this._assertNotDisposed();
        this._assertValidSource(source);
        ensureNotAborted(options.signal);

        const locale = normalizeAssetLocale(options.locale) ?? this._locale;
        const baseKey = this._resolveBaseKey(source, options);
        const retry = options.retry;
        const maxAttempts = Math.max(1, Math.trunc(retry?.attempts ?? this._retry.attempts));
        const baseDelayMs = Math.max(0, retry?.baseDelayMs ?? this._retry.baseDelayMs);
        const maxDelayMs = Math.max(baseDelayMs, retry?.maxDelayMs ?? this._retry.maxDelayMs);
        const shouldRetry = retry?.shouldRetry ?? this._retry.shouldRetry;
        let lastImporterId = 'unknown';

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            ensureNotAborted(options.signal);
            let currentSource = source;
            let importerId = lastImporterId;

            try {
                const nowEpochMs = this._now();
                const sourceStageOutput = await this._runStages('source', {
                    source,
                    locale,
                    database,
                    signal: options.signal,
                    attempt,
                    nowEpochMs,
                    baseKey,
                    createContext: (state) => ({
                        phase: 'source',
                        source: state.source,
                        locale,
                        database,
                        pipeline: this,
                        signal: options.signal,
                        attempt,
                        nowEpochMs,
                        baseKey,
                    }),
                });
                const sourceForImport = sourceStageOutput.source;
                currentSource = sourceForImport;
                const importer = this._registry.find({
                    source: sourceForImport,
                    locale,
                    database,
                });

                if (!importer) {
                    throw new AssetImporterNotFoundError(
                        resolveAssetMessage(
                            {
                                code: 'asset.importer.not-found',
                                sourceKind: sourceForImport.kind,
                                uri: sourceForImport.uri,
                                mimeType: sourceForImport.mimeType,
                            },
                            locale,
                            this._messageResolver
                        )
                    );
                }

                importerId = importer.id;
                lastImporterId = importerId;
                const beforeImportOutput = await this._runStages<TPrimaryKind>('before-import', {
                    locale,
                    database,
                    signal: options.signal,
                    attempt,
                    nowEpochMs,
                    baseKey,
                    source: sourceForImport,
                    createContext: (state) => ({
                        phase: 'before-import',
                        source: state.source,
                        locale,
                        database,
                        pipeline: this,
                        signal: options.signal,
                        attempt,
                        nowEpochMs,
                        baseKey,
                        importer,
                    }),
                });
                const finalSource = beforeImportOutput.source;
                currentSource = finalSource;
                let result = beforeImportOutput.result;

                if (result === undefined) {
                    const importedResult = await importer.import({
                        source: finalSource,
                        locale,
                        database,
                        pipeline: this,
                        signal: options.signal,
                        attempt,
                        nowEpochMs,
                        baseKey,
                        createSubKey: (suffix: string) =>
                            canonicalizeAssetKey(`${baseKey}#${suffix.trim()}`),
                        resolveDependency: (input) => database.get(input),
                    } as Readonly<AssetImportContext<TSchema>>);
                    this._assertValidImportResult<TPrimaryKind>(
                        importedResult,
                        'importer',
                        importer,
                        locale
                    );
                    result = importedResult;
                }

                this._assertValidImportResult<TPrimaryKind>(result, 'importer', importer, locale);
                const afterImportOutput = await this._runStages<TPrimaryKind>('after-import', {
                    locale,
                    database,
                    signal: options.signal,
                    attempt,
                    nowEpochMs,
                    baseKey,
                    source: finalSource,
                    result,
                    createContext: (state) => ({
                        phase: 'after-import',
                        source: state.source,
                        locale,
                        database,
                        pipeline: this,
                        signal: options.signal,
                        attempt,
                        nowEpochMs,
                        baseKey,
                        importer,
                        result: state.result!,
                    }),
                });
                result = afterImportOutput.result ?? result;

                return Object.freeze({
                    importerId: asAssetImporterId(importerId),
                    importer,
                    baseKey,
                    importedAtEpochMs: this._now(),
                    diagnostics: Object.freeze([
                        ...sourceStageOutput.diagnostics,
                        ...beforeImportOutput.diagnostics,
                        ...(result.diagnostics ?? []),
                        ...afterImportOutput.diagnostics,
                    ]),
                    result,
                });
            } catch (error) {
                ensureNotAborted(options.signal);

                const failureContext: AssetImportFailureContext<TSchema> = {
                    source: currentSource,
                    importerId,
                    attempt,
                    maxAttempts,
                    locale,
                    database,
                    baseKey,
                };

                const canRetry =
                    attempt < maxAttempts &&
                    (shouldRetry?.(error, failureContext) ??
                        (error instanceof AssetError === false &&
                            (error as Error | undefined)?.name !== 'AbortError'));

                if (!canRetry) {
                    if (error instanceof AssetError) {
                        throw error;
                    }

                    throw new AssetImportError(
                        resolveAssetMessage(
                            {
                                code: 'asset.import.failed',
                                importerId,
                                attempt,
                                reason: error,
                            },
                            locale,
                            this._messageResolver
                        ),
                        importerId,
                        attempt,
                        {
                            cause: error,
                        }
                    );
                }

                const durationMs = Math.min(maxDelayMs, baseDelayMs * attempt);
                await delay(durationMs, options.signal);
            }
        }

        throw new AssetImportError(
            resolveAssetMessage(
                {
                    code: 'asset.import.failed',
                    importerId: lastImporterId,
                    attempt: maxAttempts,
                    reason: 'retry-exhausted',
                },
                locale,
                this._messageResolver
            ),
            lastImporterId,
            maxAttempts
        );
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._registry.dispose();
        this._stageRegistry.dispose();
    }

    private async _runStages<TPrimaryKind extends AssetKind<TSchema> = AssetKind<TSchema>>(
        phase: AssetImportStagePhase,
        options: {
            readonly source: AssetImportSource;
            readonly locale: string;
            readonly database: AssetDatabase<TSchema>;
            readonly signal?: AbortSignal;
            readonly attempt: number;
            readonly nowEpochMs: number;
            readonly baseKey: AssetKey;
            readonly result?: AssetImportResult<TSchema, TPrimaryKind>;
            readonly createContext: (
                state: Readonly<{
                    source: AssetImportSource;
                    result?: AssetImportResult<TSchema, TPrimaryKind>;
                }>
            ) => AssetImportStageContext<TSchema, AssetImportSource, TPrimaryKind>;
        }
    ): Promise<AssetStageExecutionState<TSchema, TPrimaryKind>> {
        const stages = this._stageRegistry.listByPhase(phase);
        if (stages.length === 0) {
            return {
                source: options.source,
                result: options.result,
                diagnostics: EMPTY_IMPORT_DIAGNOSTICS,
            };
        }

        let currentSource = options.source;
        let currentResult = options.result;
        const diagnostics: AssetImportDiagnostic[] = [];

        for (const stage of stages) {
            ensureNotAborted(options.signal);

            const context = options.createContext({
                source: currentSource,
                result: currentResult,
            });

            if (
                !matchesStage(
                    stage,
                    phase,
                    currentSource.kind,
                    context as Readonly<AssetImportStageContext<TSchema>>
                )
            ) {
                continue;
            }

            const output = await stage.run(context as never);
            if (output === undefined) {
                continue;
            }

            if (output === null || typeof output !== 'object') {
                this._throwInvalidPipelineValue(
                    'stage',
                    {
                        phase,
                        stageId: stage.id,
                        output,
                    },
                    options.locale
                );
            }

            if (output.source !== undefined) {
                this._assertValidSource(output.source);
                currentSource = output.source;
            }

            if (output.result !== undefined) {
                if (phase === 'source') {
                    this._throwInvalidPipelineValue(
                        'stage',
                        {
                            phase,
                            stageId: stage.id,
                            output,
                        },
                        options.locale
                    );
                }

                this._assertValidImportResult<TPrimaryKind>(
                    output.result,
                    'stage',
                    {
                        phase,
                        stageId: stage.id,
                        output,
                    },
                    options.locale
                );
                currentResult = output.result;
            }

            this._appendDiagnostics(
                output.diagnostics,
                diagnostics,
                'stage',
                {
                    phase,
                    stageId: stage.id,
                    output,
                },
                options.locale
            );
        }

        return {
            source: currentSource,
            result: currentResult,
            diagnostics: diagnostics.length === 0 ? EMPTY_IMPORT_DIAGNOSTICS : Object.freeze(diagnostics),
        };
    }

    private _assertValidSource(source: AssetImportSource): void {
        if (!source || typeof source !== 'object' || typeof source.kind !== 'string') {
            throw new AssetConfigurationError(
                'asset.invalid-source',
                resolveAssetMessage(
                    {
                        code: 'asset.invalid-source',
                        value: source,
                    },
                    this._locale,
                    this._messageResolver
                )
            );
        }
    }

    private _assertValidImportResult<TPrimaryKind extends AssetKind<TSchema>>(
        result: unknown,
        nodeKind: AssetPipelineNodeKind,
        value: unknown,
        locale: string
    ): asserts result is AssetImportResult<TSchema, TPrimaryKind> {
        if (!result || typeof result !== 'object') {
            this._throwInvalidPipelineValue(nodeKind, value, locale);
        }

        const primary = (result as { readonly primary?: unknown }).primary;
        if (!this._isValidWriteInput(primary)) {
            this._throwInvalidPipelineValue(nodeKind, value, locale);
        }

        const additional = (result as { readonly additional?: unknown }).additional;
        if (
            additional !== undefined &&
            (!Array.isArray(additional) || additional.some((entry) => !this._isValidWriteInput(entry)))
        ) {
            this._throwInvalidPipelineValue(nodeKind, value, locale);
        }

        this._assertValidDiagnostics(
            (result as { readonly diagnostics?: unknown }).diagnostics,
            nodeKind,
            value,
            locale
        );
    }

    private _isValidWriteInput(value: unknown): value is AssetImportResult<TSchema>['primary'] {
        return (
            value !== null &&
            typeof value === 'object' &&
            typeof (value as { readonly kind?: unknown }).kind === 'string' &&
            'data' in value
        );
    }

    private _appendDiagnostics(
        diagnostics: unknown,
        target: AssetImportDiagnostic[],
        nodeKind: AssetPipelineNodeKind,
        value: unknown,
        locale: string
    ): void {
        this._assertValidDiagnostics(diagnostics, nodeKind, value, locale);
        target.push(...(diagnostics ?? EMPTY_IMPORT_DIAGNOSTICS));
    }

    private _assertValidDiagnostics(
        diagnostics: unknown,
        nodeKind: AssetPipelineNodeKind,
        value: unknown,
        locale: string
    ): asserts diagnostics is readonly AssetImportDiagnostic[] | undefined {
        if (diagnostics === undefined) {
            return;
        }

        if (!Array.isArray(diagnostics)) {
            this._throwInvalidPipelineValue(nodeKind, value, locale);
        }

        for (const diagnostic of diagnostics) {
            if (!this._isValidDiagnostic(diagnostic)) {
                this._throwInvalidPipelineValue(nodeKind, value, locale);
            }
        }
    }

    private _isValidDiagnostic(value: unknown): value is AssetImportDiagnostic {
        return (
            value !== null &&
            typeof value === 'object' &&
            typeof (value as { readonly message?: unknown }).message === 'string' &&
            ((value as { readonly code?: unknown }).code === undefined ||
                typeof (value as { readonly code?: unknown }).code === 'string') &&
            ((value as { readonly level?: unknown }).level === 'info' ||
                (value as { readonly level?: unknown }).level === 'warning' ||
                (value as { readonly level?: unknown }).level === 'error')
        );
    }

    private _throwInvalidPipelineValue(
        nodeKind: AssetPipelineNodeKind,
        value: unknown,
        locale: string
    ): never {
        const descriptor =
            nodeKind === 'stage'
                ? {
                      code: 'asset.invalid-stage' as const,
                      value,
                  }
                : {
                      code: 'asset.invalid-importer' as const,
                      value,
                  };

        throw new AssetConfigurationError(
            descriptor.code,
            resolveAssetMessage(descriptor, locale, this._messageResolver)
        );
    }

    private _resolveBaseKey(source: AssetImportSource, options: AssetImportOptions<TSchema>): AssetKey {
        const explicitKey = options.stableKey?.trim();
        if (explicitKey) {
            return canonicalizeAssetKey(explicitKey);
        }

        const sourceKey = source.stableKey?.trim();
        if (sourceKey) {
            return canonicalizeAssetKey(sourceKey);
        }

        if (source.uri?.trim()) {
            return canonicalizeAssetKey(source.uri);
        }

        this._anonymousCounter += 1;
        return canonicalizeAssetKey(`asset://${source.kind}/${this._anonymousCounter}`);
    }

    private _assertNotDisposed(): void {
        if (this._disposed) {
            throw new AssetDisposedError('Cannot use a disposed asset import pipeline');
        }
    }
}

export const createAssetImportPipeline = <TSchema extends AssetSchema = AssetSchema>(
    options?: AssetImportPipelineOptions<TSchema>
): AssetImportPipeline<TSchema> => new AssetImportPipeline<TSchema>(options);
