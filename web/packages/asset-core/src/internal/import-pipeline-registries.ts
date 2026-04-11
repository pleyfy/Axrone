import {
    AssetConfigurationError,
    AssetDisposedError,
    resolveAssetMessage,
} from '../errors';
import type {
    AssetImportStage,
    AssetImportStageContext,
    AssetImportStagePhase,
    AssetImporter,
    AssetImporterMatchContext,
    AssetSchema,
    AssetSourceKind,
} from '../types';

const DEFAULT_STAGE_PHASES = Object.freeze([
    'source',
    'before-import',
    'after-import',
] as const satisfies readonly AssetImportStagePhase[]);

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

export const matchesStage = <TSchema extends AssetSchema>(
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

    findMatching(
        phase: AssetImportStagePhase,
        sourceKind: AssetSourceKind,
        context: Readonly<AssetImportStageContext<TSchema>>
    ): readonly AssetImportStage<TSchema>[] {
        return this.listByPhase(phase).filter((stage) => matchesStage(stage, phase, sourceKind, context));
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