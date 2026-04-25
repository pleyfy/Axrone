import { DisposedUIError, FontFaceNotFoundError, FontLoadError } from './errors';
import { createBrowserDynamicFontRuntimeFactory, createBrowserSystemFontFaceRuntime } from './font-runtime';
import { GlyphAtlas } from './font/atlas';
import type { GlyphAtlasSource } from './font/atlas';
import { BinaryFontLoader, DescriptorFontLoader, JsonFontLoader } from './font/loaders';
import {
    applyRetryDelay,
    buildSourceKey,
    isDynamicFontFaceAsset,
    normalizeGlyphMap,
    normalizeKerningMap,
    normalizeStyle,
    normalizeWeight,
    wait,
} from './font/source';
import type {
    DynamicFontFaceAsset,
    DynamicFontFaceRuntime,
    DynamicFontGlyphRaster,
    DynamicFontRuntimeFactory,
    FontAssetSource,
    FontBinaryFormat,
    FontFaceAsset,
    FontFaceId,
    FontFaceInfo,
    FontFaceSnapshot,
    FontGlyphBitmapFormat,
    FontFamilyDefinition,
    FontFamilyId,
    FontGlyphMeasurement,
    FontGlyphMetric,
    FontLoadOptions,
    FontLoader,
    FontQuery,
    FontRegistryOptions,
    FontRegistrySnapshot,
    FontStyle,
    FontWeight,
    GlyphAtlasEntry,
    GlyphAtlasPageSnapshot,
    KerningPairKey,
    RetryPolicy,
    StaticFontFaceAsset,
} from './types';

export const AXRONE_DEFAULT_UI_FONT_FAMILY = 'Roboto, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

export interface SystemFontFaceAssetOptions {
    readonly family: string;
    readonly cssFamily?: string;
    readonly face?: string;
    readonly style?: FontStyle;
    readonly weight?: FontWeight;
    readonly locale?: string;
    readonly fallbackCodePoint?: number;
}

interface ResolvedGlyphMetric {
    readonly codePoint: number;
    readonly metric: FontGlyphMetric;
}

interface InternalFontFace {
    readonly id: FontFaceId;
    readonly info: FontFaceInfo;
    readonly glyphs: Map<number, FontGlyphMetric>;
    readonly kernings: Map<KerningPairKey, number>;
    readonly atlas: GlyphAtlas;
    readonly runtime?: DynamicFontFaceRuntime;
}

interface InternalFamily {
    readonly id: FontFamilyId;
    readonly name: string;
    readonly fallbacks: readonly string[];
    readonly faces: FontFaceId[];
}

export class FontRegistry implements Disposable {
    private readonly familiesByName = new Map<string, InternalFamily>();
    private readonly facesById = new Map<number, InternalFontFace>();
    private readonly loaders: FontLoader[] = [];
    private readonly pendingLoads = new Map<string, Promise<FontFaceId>>();
    private readonly options: Required<Pick<FontRegistryOptions, 'atlasWidth' | 'atlasHeight' | 'atlasPadding'>> &
        Pick<FontRegistryOptions, 'defaultFamily' | 'retry' | 'fetch'>;
    private nextFamilyId = 1;
    private nextFaceId = 1;
    private disposed = false;
    private defaultFamily: string | null;

    constructor(options: FontRegistryOptions = {}) {
        this.options = {
            atlasWidth: options.atlasWidth ?? 1024,
            atlasHeight: options.atlasHeight ?? 1024,
            atlasPadding: options.atlasPadding ?? 1,
            defaultFamily: options.defaultFamily,
            retry: options.retry,
            fetch: options.fetch,
        };
        this.defaultFamily = options.defaultFamily ?? null;
        const dynamicRuntimeFactory = options.dynamicRuntimeFactory ?? createBrowserDynamicFontRuntimeFactory();
        this.registerLoader(new DescriptorFontLoader());
        this.registerLoader(new BinaryFontLoader(options.fetch ?? globalThis.fetch, dynamicRuntimeFactory));
        this.registerLoader(new JsonFontLoader(options.fetch ?? globalThis.fetch));
    }

    registerLoader(loader: FontLoader): this {
        this.ensureActive();
        this.loaders.push(loader);
        return this;
    }

    registerFamily(definition: FontFamilyDefinition): FontFamilyId {
        this.ensureActive();
        const existing = this.familiesByName.get(definition.name);
        if (existing) {
            return existing.id;
        }
        const family: InternalFamily = {
            id: this.nextFamilyId as FontFamilyId,
            name: definition.name,
            fallbacks: [...(definition.fallbacks ?? [])],
            faces: [],
        };
        this.nextFamilyId += 1;
        this.familiesByName.set(definition.name, family);
        if (!this.defaultFamily) {
            this.defaultFamily = definition.name;
        }
        return family.id;
    }

    registerFace(asset: FontFaceAsset): FontFaceId {
        this.ensureActive();
        const infoSource = isDynamicFontFaceAsset(asset) ? asset.runtime.info : asset;
        const familyId = this.registerFamily({ name: infoSource.family });
        const family = this.familiesByName.get(infoSource.family)!;
        const info: FontFaceInfo = {
            id: this.nextFaceId as FontFaceId,
            family: infoSource.family,
            face: infoSource.face ?? 'Regular',
            style: normalizeStyle(infoSource.style),
            weight: normalizeWeight(infoSource.weight),
            locale: infoSource.locale ?? '',
            ascent: infoSource.ascent,
            descent: infoSource.descent,
            lineGap: infoSource.lineGap ?? 0,
            unitsPerEm: infoSource.unitsPerEm ?? 1000,
            defaultAdvance: infoSource.defaultAdvance ?? 500,
            fallbackCodePoint: infoSource.fallbackCodePoint ?? 63,
        };
        const atlas = new GlyphAtlas(
            info.id,
            infoSource.atlas?.width ?? this.options.atlasWidth,
            infoSource.atlas?.height ?? this.options.atlasHeight,
            infoSource.atlas?.padding ?? this.options.atlasPadding
        );
        const face: InternalFontFace = {
            id: info.id,
            info,
            glyphs: normalizeGlyphMap(asset.glyphs),
            kernings: normalizeKerningMap(asset.kernings),
            atlas,
            runtime: isDynamicFontFaceAsset(asset) ? asset.runtime : undefined,
        };
        this.nextFaceId += 1;
        this.facesById.set(info.id as number, face);
        family.faces.push(info.id);
        if (!this.defaultFamily) {
            this.defaultFamily = infoSource.family;
        }
        void familyId;
        return info.id;
    }

    async load(source: FontAssetSource, options: FontLoadOptions = {}): Promise<FontFaceId> {
        this.ensureActive();
        const key = buildSourceKey(source);
        const pending = this.pendingLoads.get(key);
        if (pending) {
            return pending;
        }
        const promise = this.loadInternal(source, options).finally(() => {
            this.pendingLoads.delete(key);
        });
        this.pendingLoads.set(key, promise);
        return promise;
    }

    resolveFace(query: FontQuery = {}): FontFaceId | null {
        this.ensureActive();
        const targetFamily = query.family ?? this.defaultFamily;
        const visited = new Set<string>();
        const queue: string[] = [];
        if (targetFamily) {
            queue.push(targetFamily);
        }
        if (this.defaultFamily && this.defaultFamily !== targetFamily) {
            queue.push(this.defaultFamily);
        }
        let best: { id: FontFaceId; score: number } | null = null;
        while (queue.length > 0) {
            const familyName = queue.shift()!;
            if (visited.has(familyName)) {
                continue;
            }
            visited.add(familyName);
            const family = this.familiesByName.get(familyName);
            if (!family) {
                continue;
            }
            for (const fallback of family.fallbacks) {
                queue.push(fallback);
            }
            for (const faceId of family.faces) {
                const face = this.facesById.get(faceId as number);
                if (!face) {
                    continue;
                }
                const stylePenalty = query.style && query.style !== face.info.style ? 500 : 0;
                const localePenalty = query.locale && query.locale !== face.info.locale ? 50 : 0;
                const weightPenalty = Math.abs(normalizeWeight(query.weight) - face.info.weight);
                const score = stylePenalty + localePenalty + weightPenalty;
                if (!best || score < best.score) {
                    best = { id: faceId, score };
                }
            }
        }
        return best?.id ?? null;
    }

    getFaceInfo(faceId: FontFaceId | null): FontFaceInfo | null {
        if (faceId === null) {
            return null;
        }
        return this.facesById.get(faceId as number)?.info ?? null;
    }

    ensureGlyph(faceId: FontFaceId, codePoint: number, fontSize?: number): GlyphAtlasEntry | null {
        this.ensureActive();
        const face = this.facesById.get(faceId as number);
        if (!face) {
            throw new FontFaceNotFoundError({ faceId });
        }
        return this.ensureGlyphEntry(face, codePoint, fontSize);
    }

    measureGlyph(
        faceId: FontFaceId | null,
        codePoint: number,
        fontSize: number,
        nextCodePoint?: number
    ): FontGlyphMeasurement {
        this.ensureActive();
        if (faceId === null) {
            return {
                faceId: null,
                codePoint,
                advance: fontSize * 0.6,
                width: fontSize * 0.6,
                height: fontSize,
                metric: null,
                atlasEntry: null,
            };
        }
        const face = this.facesById.get(faceId as number);
        if (!face) {
            throw new FontFaceNotFoundError({ faceId });
        }
        const resolved = this.resolveMetricWithFallback(face, codePoint);
        const nextResolved =
            nextCodePoint === undefined ? null : this.resolveMetricWithFallback(face, nextCodePoint);
        const kerning =
            nextResolved && resolved
                ? this.resolveKerning(face, resolved.codePoint, nextResolved.codePoint)
                : 0;
        const scale = fontSize / face.info.unitsPerEm;
        const width = (resolved?.metric.width ?? resolved?.metric.advance ?? face.info.defaultAdvance) * scale;
        const height = (resolved?.metric.height ?? face.info.ascent + face.info.descent) * scale;
        return {
            faceId,
            codePoint,
            advance: ((resolved?.metric.advance ?? face.info.defaultAdvance) + kerning) * scale,
            width,
            height,
            metric: resolved?.metric ?? null,
            atlasEntry: resolved ? this.ensureGlyphEntry(face, resolved.codePoint, fontSize) : null,
        };
    }

    getDefaultFamily(): string | null {
        return this.defaultFamily;
    }

    snapshot(): FontRegistrySnapshot {
        this.ensureActive();
        return {
            defaultFamily: this.defaultFamily,
            families: [...this.familiesByName.values()].map((family) => ({
                name: family.name,
                fallbacks: [...family.fallbacks],
            })),
            faces: [...this.facesById.values()].map((face): FontFaceSnapshot => ({
                id: face.id as number,
                family: face.info.family,
                face: face.info.face,
                style: face.info.style,
                weight: face.info.weight,
                locale: face.info.locale,
                ascent: face.info.ascent,
                descent: face.info.descent,
                lineGap: face.info.lineGap,
                unitsPerEm: face.info.unitsPerEm,
                defaultAdvance: face.info.defaultAdvance,
                fallbackCodePoint: face.info.fallbackCodePoint,
                glyphs: [...face.glyphs.values()],
                kernings: [...face.kernings.entries()],
                atlas: face.atlas.snapshot(),
            })),
        };
    }

    restore(snapshot: FontRegistrySnapshot): void {
        this.ensureActive();
        this.clear();
        this.defaultFamily = snapshot.defaultFamily;
        for (const family of snapshot.families) {
            this.registerFamily(family);
        }
        for (const faceSnapshot of snapshot.faces) {
            const faceId = this.registerFace({
                family: faceSnapshot.family,
                face: faceSnapshot.face,
                style: faceSnapshot.style,
                weight: faceSnapshot.weight as StaticFontFaceAsset['weight'],
                locale: faceSnapshot.locale,
                ascent: faceSnapshot.ascent,
                descent: faceSnapshot.descent,
                lineGap: faceSnapshot.lineGap,
                unitsPerEm: faceSnapshot.unitsPerEm,
                defaultAdvance: faceSnapshot.defaultAdvance,
                fallbackCodePoint: faceSnapshot.fallbackCodePoint,
                glyphs: faceSnapshot.glyphs,
                kernings: Object.fromEntries(faceSnapshot.kernings),
            });
            const face = this.facesById.get(faceId as number);
            if (face) {
                face.atlas.restore(faceSnapshot.atlas);
            }
        }
    }

    clear(): void {
        for (const face of this.facesById.values()) {
            face.runtime?.dispose?.();
            face.atlas.clear();
        }
        this.familiesByName.clear();
        this.facesById.clear();
        this.pendingLoads.clear();
        this.nextFamilyId = 1;
        this.nextFaceId = 1;
    }

    dispose(): void {
        if (!this.disposed) {
            this.clear();
            this.loaders.length = 0;
            this.disposed = true;
        }
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private ensureActive(): void {
        if (this.disposed) {
            throw new DisposedUIError('FontRegistry');
        }
    }

    private resolveMetric(face: InternalFontFace, codePoint: number): FontGlyphMetric | null {
        const existing = face.glyphs.get(codePoint);
        if (existing) {
            return existing;
        }
        const runtimeMetric = face.runtime?.measureGlyph(codePoint) ?? null;
        if (runtimeMetric) {
            face.glyphs.set(codePoint, runtimeMetric);
        }
        return runtimeMetric;
    }

    private resolveMetricWithFallback(face: InternalFontFace, codePoint: number): ResolvedGlyphMetric | null {
        const metric = this.resolveMetric(face, codePoint);
        if (metric) {
            return { codePoint, metric };
        }
        if (codePoint !== face.info.fallbackCodePoint) {
            const fallbackMetric = this.resolveMetric(face, face.info.fallbackCodePoint);
            if (fallbackMetric) {
                return {
                    codePoint: face.info.fallbackCodePoint,
                    metric: fallbackMetric,
                };
            }
        }
        return null;
    }

    private resolveKerning(face: InternalFontFace, leftCodePoint: number, rightCodePoint: number): number {
        const key = `${leftCodePoint}:${rightCodePoint}` as KerningPairKey;
        const existing = face.kernings.get(key);
        if (existing !== undefined) {
            return existing;
        }
        const value = face.runtime?.getKerning?.(leftCodePoint, rightCodePoint) ?? 0;
        face.kernings.set(key, value);
        return value;
    }

    private ensureGlyphEntry(face: InternalFontFace, codePoint: number, fontSize?: number): GlyphAtlasEntry | null {
        const resolved = this.resolveMetricWithFallback(face, codePoint);
        if (!resolved) {
            return null;
        }
        if (!face.runtime) {
            const cached = face.atlas.get(resolved.codePoint);
            if (cached) {
                return cached;
            }
            return face.atlas.ensure({
                codePoint: resolved.codePoint,
                width: resolved.metric.width ?? resolved.metric.advance,
                height: resolved.metric.height ?? resolved.metric.width ?? resolved.metric.advance,
                data: resolved.metric.data ?? null,
                format: resolved.metric.format,
                rowStride: resolved.metric.rowStride,
                distanceRange: resolved.metric.distanceRange,
            });
        }
        const rasterSize = Math.max(1, Math.round(fontSize ?? 16));
        const cached = face.atlas.get(resolved.codePoint, rasterSize);
        if (cached) {
            return cached;
        }
        const raster = face.runtime.rasterizeGlyph(resolved.codePoint, rasterSize);
        if (!raster) {
            return null;
        }
        return face.atlas.ensure(this.toAtlasGlyph(raster));
    }

    private toAtlasGlyph(raster: DynamicFontGlyphRaster): GlyphAtlasSource {
        return {
            codePoint: raster.codePoint,
            rasterSize: raster.rasterSize,
            width: raster.width,
            height: raster.height,
            data: raster.data ?? null,
            format: raster.format,
            rowStride: raster.rowStride,
            distanceRange: raster.distanceRange,
        };
    }

    private async loadInternal(source: FontAssetSource, options: FontLoadOptions): Promise<FontFaceId> {
        const loader = this.loaders.find((candidate) => candidate.canLoad(source));
        if (!loader) {
            throw new FontLoadError('No font loader can handle the provided source.', { source });
        }
        const retry = options.retry ?? this.options.retry;
        const attempts = Math.max(1, retry?.attempts ?? 1);
        let lastError: unknown;
        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                const asset = await loader.load(source, options.signal);
                return this.registerFace(asset);
            } catch (error) {
                lastError = error;
                if (attempt >= attempts || options.signal?.aborted) {
                    break;
                }
                await wait(applyRetryDelay(retry, attempt));
            }
        }
        throw new FontLoadError('Font loading failed after exhausting retry attempts.', {
            source,
            cause: lastError,
        });
    }
}

export const createSystemFontFaceAsset = (options: SystemFontFaceAssetOptions): DynamicFontFaceAsset => ({
    kind: 'dynamic',
    runtime: createBrowserSystemFontFaceRuntime({
        family: options.family,
        cssFamily: options.cssFamily ?? options.family,
        face: options.face,
        style: options.style,
        weight: options.weight,
        locale: options.locale,
        fallbackCodePoint: options.fallbackCodePoint,
    }),
});

export const createDefaultUIFontAsset = (
    family = AXRONE_DEFAULT_UI_FONT_FAMILY,
): DynamicFontFaceAsset =>
    createSystemFontFaceAsset({
        family,
        cssFamily: family,
    });

export const ensureSystemUIFont = (
    fonts: Pick<FontRegistry, 'getDefaultFamily' | 'registerFace' | 'resolveFace'>,
    family: string,
    cssFamily = family,
): string => {
    if (!fonts.resolveFace({ family })) {
        fonts.registerFace(
            createSystemFontFaceAsset({
                family,
                cssFamily,
            }),
        );
    }
    return fonts.getDefaultFamily() ?? family;
};

export const ensureDefaultUIFont = (
    fonts: Pick<FontRegistry, 'getDefaultFamily' | 'registerFace' | 'resolveFace'>,
    family = AXRONE_DEFAULT_UI_FONT_FAMILY,
): string => ensureSystemUIFont(fonts, family, family);

export type {
    DynamicFontFaceAsset,
    DynamicFontFaceRuntime,
    DynamicFontGlyphRaster,
    DynamicFontRuntimeFactory,
    FontAssetSource,
    FontBinaryFormat,
    FontFaceAsset,
    FontFaceId,
    FontFaceInfo,
    FontFamilyDefinition,
    FontGlyphBitmapFormat,
    FontFamilyId,
    FontGlyphMeasurement,
    FontGlyphMetric,
    FontLoadOptions,
    FontLoader,
    FontQuery,
    FontRegistryOptions,
    FontRegistrySnapshot,
    GlyphAtlasEntry,
    GlyphAtlasPageSnapshot,
    KerningPairKey,
    RetryPolicy,
    StaticFontFaceAsset,
};

export { createBrowserDynamicFontRuntimeFactory, createBrowserSystemFontFaceRuntime };
