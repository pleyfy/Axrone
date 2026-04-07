import type { AssetDatabase } from './database';
import {
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
    AssetImportFailureContext,
    AssetImporter,
    AssetImporterMatchContext,
    AssetImportOptions,
    AssetImportPipelineOptions,
    AssetImportSource,
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

export const isAssetImporter = <TSchema extends AssetSchema = AssetSchema>(
    value: unknown
): value is AssetImporter<TSchema> =>
    value !== null &&
    typeof value === 'object' &&
    typeof (value as AssetImporter<TSchema>).id === 'string' &&
    typeof (value as AssetImporter<TSchema>).import === 'function';

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

export class AssetImportPipeline<TSchema extends AssetSchema = AssetSchema> {
    private readonly _registry: AssetImporterRegistry<TSchema>;
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
        const importer = this._registry.find({
            source,
            locale,
            database,
        });

        if (!importer) {
            throw new AssetImporterNotFoundError(
                resolveAssetMessage(
                    {
                        code: 'asset.importer.not-found',
                        sourceKind: source.kind,
                        uri: source.uri,
                        mimeType: source.mimeType,
                    },
                    locale,
                    this._messageResolver
                )
            );
        }

        const importerId = asAssetImporterId(importer.id);
        const retry = options.retry;
        const maxAttempts = Math.max(1, Math.trunc(retry?.attempts ?? this._retry.attempts));
        const baseDelayMs = Math.max(0, retry?.baseDelayMs ?? this._retry.baseDelayMs);
        const maxDelayMs = Math.max(baseDelayMs, retry?.maxDelayMs ?? this._retry.maxDelayMs);
        const shouldRetry = retry?.shouldRetry ?? this._retry.shouldRetry;

        for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
            ensureNotAborted(options.signal);

            try {
                const result = await importer.import({
                    source,
                    locale,
                    database,
                    pipeline: this,
                    signal: options.signal,
                    attempt,
                    nowEpochMs: this._now(),
                    baseKey,
                    createSubKey: (suffix: string) =>
                        canonicalizeAssetKey(`${baseKey}#${suffix.trim()}`),
                    resolveDependency: (input) => database.get(input),
                } as Readonly<AssetImportContext<TSchema>>);

                if (!result || typeof result !== 'object' || !result.primary) {
                    throw new AssetConfigurationError(
                        'asset.invalid-importer',
                        resolveAssetMessage(
                            {
                                code: 'asset.invalid-importer',
                                value: importer,
                            },
                            locale,
                            this._messageResolver
                        )
                    );
                }

                return Object.freeze({
                    importerId,
                    importer,
                    baseKey,
                    importedAtEpochMs: this._now(),
                    diagnostics: Object.freeze([...(result.diagnostics ?? [])]),
                    result,
                }) as unknown as AssetPipelineExecution<TSchema, TPrimaryKind>;
            } catch (error) {
                ensureNotAborted(options.signal);

                const failureContext: AssetImportFailureContext<TSchema> = {
                    source,
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
                        (error instanceof AssetImportError === false &&
                            error instanceof AssetConfigurationError === false &&
                            (error as Error | undefined)?.name !== 'AbortError'));

                if (!canRetry) {
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
                    importerId,
                    attempt: maxAttempts,
                    reason: 'retry-exhausted',
                },
                locale,
                this._messageResolver
            ),
            importerId,
            maxAttempts
        );
    }

    dispose(): void {
        if (this._disposed) {
            return;
        }

        this._disposed = true;
        this._registry.dispose();
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
