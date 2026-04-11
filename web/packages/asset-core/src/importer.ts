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
    normalizeAssetSourceIdentity,
} from './reference';
import {
    AssetImportStageRegistry,
    AssetImporterRegistry,
    isAssetImportStage,
    isAssetImporter,
    matchesStage,
} from './internal/import-pipeline-registries';
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
    AssetSourceIdentity,
    AssetSourceKind,
} from './types';

const DEFAULT_RETRY_POLICY = {
    attempts: 1,
    baseDelayMs: 0,
    maxDelayMs: 0,
} as const satisfies Required<Pick<AssetRetryPolicy, 'attempts' | 'baseDelayMs' | 'maxDelayMs'>>;
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

export {
    AssetImportStageRegistry,
    AssetImporterRegistry,
    isAssetImportStage,
    isAssetImporter,
};

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
        const initialSourceIdentity = this._resolveSourceIdentity(source, options);
        const baseKey = this._resolveBaseKey(source, options, initialSourceIdentity);
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
                const sourceIdentity = this._resolveSourceIdentity(finalSource, options) ?? initialSourceIdentity;
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
                    ...(sourceIdentity ? { sourceIdentity } : {}),
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

    private _resolveBaseKey(
        source: AssetImportSource,
        options: AssetImportOptions<TSchema>,
        sourceIdentity?: AssetSourceIdentity
    ): AssetKey {
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

        if (sourceIdentity) {
            return canonicalizeAssetKey(
                `asset://${source.kind}/identity/${encodeURIComponent(sourceIdentity)}`
            );
        }

        this._anonymousCounter += 1;
        return canonicalizeAssetKey(`asset://${source.kind}/${this._anonymousCounter}`);
    }

    private _resolveSourceIdentity(
        source: AssetImportSource,
        options: AssetImportOptions<TSchema>
    ): AssetSourceIdentity | undefined {
        return (
            normalizeAssetSourceIdentity(options.sourceIdentity) ??
            normalizeAssetSourceIdentity(source.sourceIdentity)
        );
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
