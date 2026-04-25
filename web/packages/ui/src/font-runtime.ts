import { FontLoadError } from './errors';
import {
    METRIC_EM_SIZE,
    buildCanvasFont,
    codePointToString,
    createCanvasContext,
    createRuntimeInfo,
    getBoundingHeight,
    getBoundingWidth,
    normalizeStyleToken,
    normalizeWeightToken,
    quantizeRasterSize,
    quoteFontFamilyToken,
    resizeCanvas,
} from './font-runtime/internals';
import type { CanvasLike, CanvasRenderingContext2DLike } from './font-runtime/internals';
import type {
    DynamicFontFaceRuntime,
    DynamicFontGlyphRaster,
    DynamicFontRuntimeFactory,
    DynamicFontRuntimeInfo,
    DynamicFontRuntimeSource,
    FontGlyphMetric,
    FontStyle,
    FontWeight,
} from './types';

let nextRuntimeId = 1;

export interface BrowserSystemFontFaceRuntimeOptions {
    readonly family: string;
    readonly cssFamily?: string;
    readonly face?: string;
    readonly style?: FontStyle;
    readonly weight?: FontWeight;
    readonly locale?: string;
    readonly fallbackCodePoint?: number;
    readonly atlas?: DynamicFontRuntimeInfo['atlas'];
}

interface CachedGlyphMetric {
    readonly metric: FontGlyphMetric;
    readonly character: string;
}

class BrowserDynamicFontFaceRuntime implements DynamicFontFaceRuntime {
    readonly info: DynamicFontRuntimeInfo;

    private readonly familyName: string;
    private readonly fontFace: FontFace;
    private readonly metricContext: CanvasRenderingContext2DLike;
    private readonly rasterCanvas: CanvasLike;
    private readonly rasterContext: CanvasRenderingContext2DLike;
    private readonly glyphs = new Map<number, CachedGlyphMetric>();
    private readonly kerningCache = new Map<string, number>();
    private disposed = false;

    private constructor(
        familyName: string,
        fontFace: FontFace,
        info: DynamicFontRuntimeInfo,
        metricContext: CanvasRenderingContext2DLike,
        rasterCanvas: CanvasLike,
        rasterContext: CanvasRenderingContext2DLike
    ) {
        this.familyName = familyName;
        this.fontFace = fontFace;
        this.info = info;
        this.metricContext = metricContext;
        this.rasterCanvas = rasterCanvas;
        this.rasterContext = rasterContext;
    }

    static async create(source: DynamicFontRuntimeSource): Promise<BrowserDynamicFontFaceRuntime> {
        if (typeof FontFace === 'undefined') {
            throw new FontLoadError('The current runtime does not expose the FontFace API.');
        }
        const familyBase = source.source.family?.trim() || `AxroneDynamicFont${nextRuntimeId}`;
        const familyName = `${familyBase}-${nextRuntimeId++}`;
        const descriptors: FontFaceDescriptors = {
            style: normalizeStyleToken(source.source.style),
            weight: normalizeWeightToken(source.source.weight),
        };
        const fontFace = new FontFace(familyName, source.bytes, descriptors);
        await fontFace.load();
        if (typeof document !== 'undefined' && 'fonts' in document && document.fonts) {
            document.fonts.add(fontFace);
        }
        const metricPair = createCanvasContext();
        const rasterPair = createCanvasContext();
        const metricContext = metricPair.context;
        metricContext.textBaseline = 'alphabetic';
        metricContext.textAlign = 'left';
        const info = createRuntimeInfo(metricContext, quoteFontFamilyToken(familyName), {
            family: source.source.family ?? familyBase,
            face: source.source.face,
            style: source.source.style,
            weight: source.source.weight,
            locale: source.source.locale,
            fallbackCodePoint: source.source.fallbackCodePoint,
            atlas: source.source.atlas,
        });
        return new BrowserDynamicFontFaceRuntime(
            familyName,
            fontFace,
            info,
            metricContext,
            rasterPair.canvas,
            rasterPair.context
        );
    }

    measureGlyph(codePoint: number): FontGlyphMetric | null {
        this.ensureActive();
        const existing = this.glyphs.get(codePoint);
        if (existing) {
            return existing.metric;
        }
        const character = codePointToString(codePoint);
        const unitsPerEm = this.info.unitsPerEm ?? METRIC_EM_SIZE;
        const defaultAdvance = this.info.defaultAdvance ?? unitsPerEm * 0.5;
        this.metricContext.font = buildCanvasFont(
            unitsPerEm,
            quoteFontFamilyToken(this.familyName),
            this.info.style,
            this.info.weight,
        );
        const metrics = this.metricContext.measureText(character);
        const advance = Math.max(1, Math.ceil(metrics.width || defaultAdvance));
        const glyphMetric: FontGlyphMetric = {
            codePoint,
            advance,
            bearingX: metrics.actualBoundingBoxLeft ?? 0,
            bearingY: metrics.actualBoundingBoxAscent ?? this.info.ascent,
            width: Math.max(1, Math.ceil(getBoundingWidth(metrics, advance))),
            height: Math.max(1, Math.ceil(getBoundingHeight(metrics, this.info.ascent + this.info.descent))),
        };
        this.glyphs.set(codePoint, { metric: glyphMetric, character });
        return glyphMetric;
    }

    rasterizeGlyph(codePoint: number, pixelSize: number): DynamicFontGlyphRaster | null {
        this.ensureActive();
        const cached = this.glyphs.get(codePoint) ?? (() => {
            const metric = this.measureGlyph(codePoint);
            return metric ? this.glyphs.get(codePoint) ?? null : null;
        })();
        if (!cached) {
            return null;
        }
        const rasterSize = quantizeRasterSize(pixelSize);
        const isWhitespace = /^\s$/u.test(cached.character);
        if (isWhitespace) {
            return {
                codePoint,
                rasterSize,
                width: 1,
                height: 1,
            };
        }
        const padding = Math.max(2, Math.ceil(rasterSize * 0.125));
        this.rasterContext.font = buildCanvasFont(
            rasterSize,
            quoteFontFamilyToken(this.familyName),
            this.info.style,
            this.info.weight,
        );
        this.rasterContext.textBaseline = 'alphabetic';
        this.rasterContext.textAlign = 'left';
        const metrics = this.rasterContext.measureText(cached.character);
        const drawWidth = Math.max(1, Math.ceil(getBoundingWidth(metrics, metrics.width || rasterSize * 0.5)));
        const drawHeight = Math.max(1, Math.ceil(getBoundingHeight(metrics, rasterSize)));
        const width = drawWidth + padding * 2;
        const height = drawHeight + padding * 2;
        resizeCanvas(this.rasterCanvas, width, height);
        this.rasterContext.clearRect(0, 0, width, height);
        this.rasterContext.font = buildCanvasFont(
            rasterSize,
            quoteFontFamilyToken(this.familyName),
            this.info.style,
            this.info.weight,
        );
        this.rasterContext.textBaseline = 'alphabetic';
        this.rasterContext.textAlign = 'left';
        this.rasterContext.fillStyle = 'rgba(255, 255, 255, 1)';
        const originX = padding + (metrics.actualBoundingBoxLeft ?? 0);
        const originY = padding + (metrics.actualBoundingBoxAscent ?? rasterSize * 0.8);
        this.rasterContext.fillText(cached.character, originX, originY);
        const image = this.rasterContext.getImageData(0, 0, width, height);
        const alpha = new Uint8Array(width * height);
        for (let index = 0, offset = 3; index < alpha.length; index += 1, offset += 4) {
            alpha[index] = image.data[offset] ?? 0;
        }
        return {
            codePoint,
            rasterSize,
            width,
            height,
            data: alpha,
            format: 'alpha8',
            rowStride: width,
        };
    }

    getKerning(leftCodePoint: number, rightCodePoint: number): number {
        this.ensureActive();
        const key = `${leftCodePoint}:${rightCodePoint}`;
        const cached = this.kerningCache.get(key);
        if (cached !== undefined) {
            return cached;
        }
        const left = this.measureGlyph(leftCodePoint);
        const right = this.measureGlyph(rightCodePoint);
        if (!left || !right) {
            this.kerningCache.set(key, 0);
            return 0;
        }
        const pairText = `${codePointToString(leftCodePoint)}${codePointToString(rightCodePoint)}`;
        this.metricContext.font = buildCanvasFont(
            this.info.unitsPerEm ?? METRIC_EM_SIZE,
            quoteFontFamilyToken(this.familyName),
            this.info.style,
            this.info.weight,
        );
        const pairAdvance = this.metricContext.measureText(pairText).width;
        const kerning = Math.round(pairAdvance - left.advance - right.advance);
        this.kerningCache.set(key, kerning);
        return kerning;
    }

    dispose(): void {
        if (!this.disposed) {
            if (typeof document !== 'undefined' && 'fonts' in document && document.fonts && typeof document.fonts.delete === 'function') {
                document.fonts.delete(this.fontFace);
            }
            this.glyphs.clear();
            this.kerningCache.clear();
            this.disposed = true;
        }
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private ensureActive(): void {
        if (this.disposed) {
            throw new FontLoadError('The dynamic font runtime has already been disposed.');
        }
    }
}

class BrowserSystemFontFaceRuntime implements DynamicFontFaceRuntime {
    readonly info: DynamicFontRuntimeInfo;

    private readonly familyToken: string;
    private readonly metricContext: CanvasRenderingContext2DLike;
    private readonly rasterCanvas: CanvasLike;
    private readonly rasterContext: CanvasRenderingContext2DLike;
    private readonly glyphs = new Map<number, CachedGlyphMetric>();
    private readonly kerningCache = new Map<string, number>();
    private disposed = false;

    private constructor(
        familyToken: string,
        info: DynamicFontRuntimeInfo,
        metricContext: CanvasRenderingContext2DLike,
        rasterCanvas: CanvasLike,
        rasterContext: CanvasRenderingContext2DLike,
    ) {
        this.familyToken = familyToken;
        this.info = info;
        this.metricContext = metricContext;
        this.rasterCanvas = rasterCanvas;
        this.rasterContext = rasterContext;
    }

    static create(options: BrowserSystemFontFaceRuntimeOptions): BrowserSystemFontFaceRuntime {
        const metricPair = createCanvasContext();
        const rasterPair = createCanvasContext();
        const metricContext = metricPair.context;
        metricContext.textBaseline = 'alphabetic';
        metricContext.textAlign = 'left';

        const familyToken = quoteFontFamilyToken(options.cssFamily ?? options.family);
        const info = createRuntimeInfo(metricContext, familyToken, options);

        return new BrowserSystemFontFaceRuntime(
            familyToken,
            info,
            metricContext,
            rasterPair.canvas,
            rasterPair.context,
        );
    }

    measureGlyph(codePoint: number): FontGlyphMetric | null {
        this.ensureActive();
        const existing = this.glyphs.get(codePoint);
        if (existing) {
            return existing.metric;
        }

        const character = codePointToString(codePoint);
        const unitsPerEm = this.info.unitsPerEm ?? METRIC_EM_SIZE;
        const defaultAdvance = this.info.defaultAdvance ?? unitsPerEm * 0.5;
        this.metricContext.font = buildCanvasFont(unitsPerEm, this.familyToken, this.info.style, this.info.weight);
        const metrics = this.metricContext.measureText(character);
        const glyphMetric: FontGlyphMetric = {
            codePoint,
            advance: Math.max(1, Math.ceil(metrics.width || defaultAdvance)),
            bearingX: metrics.actualBoundingBoxLeft ?? 0,
            bearingY: metrics.actualBoundingBoxAscent ?? this.info.ascent,
            width: Math.max(1, Math.ceil(getBoundingWidth(metrics, metrics.width || defaultAdvance))),
            height: Math.max(1, Math.ceil(getBoundingHeight(metrics, this.info.ascent + this.info.descent))),
        };

        this.glyphs.set(codePoint, { metric: glyphMetric, character });
        return glyphMetric;
    }

    rasterizeGlyph(codePoint: number, pixelSize: number): DynamicFontGlyphRaster | null {
        this.ensureActive();
        const cached = this.glyphs.get(codePoint) ?? (() => {
            const metric = this.measureGlyph(codePoint);
            return metric ? this.glyphs.get(codePoint) ?? null : null;
        })();
        if (!cached) {
            return null;
        }

        const rasterSize = quantizeRasterSize(pixelSize);
        const isWhitespace = /^\s$/u.test(cached.character);
        if (isWhitespace) {
            return {
                codePoint,
                rasterSize,
                width: 1,
                height: 1,
            };
        }

        const padding = Math.max(2, Math.ceil(rasterSize * 0.125));
        this.rasterContext.font = buildCanvasFont(rasterSize, this.familyToken, this.info.style, this.info.weight);
        this.rasterContext.textBaseline = 'alphabetic';
        this.rasterContext.textAlign = 'left';
        const metrics = this.rasterContext.measureText(cached.character);
        const drawWidth = Math.max(1, Math.ceil(getBoundingWidth(metrics, metrics.width || rasterSize * 0.5)));
        const drawHeight = Math.max(1, Math.ceil(getBoundingHeight(metrics, rasterSize)));
        const width = drawWidth + padding * 2;
        const height = drawHeight + padding * 2;

        resizeCanvas(this.rasterCanvas, width, height);
        this.rasterContext.clearRect(0, 0, width, height);
        this.rasterContext.font = buildCanvasFont(rasterSize, this.familyToken, this.info.style, this.info.weight);
        this.rasterContext.textBaseline = 'alphabetic';
        this.rasterContext.textAlign = 'left';
        this.rasterContext.fillStyle = 'rgba(255, 255, 255, 1)';

        const originX = padding + (metrics.actualBoundingBoxLeft ?? 0);
        const originY = padding + (metrics.actualBoundingBoxAscent ?? rasterSize * 0.8);
        this.rasterContext.fillText(cached.character, originX, originY);

        const image = this.rasterContext.getImageData(0, 0, width, height);
        const alpha = new Uint8Array(width * height);
        for (let index = 0, offset = 3; index < alpha.length; index += 1, offset += 4) {
            alpha[index] = image.data[offset] ?? 0;
        }

        return {
            codePoint,
            rasterSize,
            width,
            height,
            data: alpha,
            format: 'alpha8',
            rowStride: width,
        };
    }

    getKerning(leftCodePoint: number, rightCodePoint: number): number {
        this.ensureActive();
        const key = `${leftCodePoint}:${rightCodePoint}`;
        const cached = this.kerningCache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const left = this.measureGlyph(leftCodePoint);
        const right = this.measureGlyph(rightCodePoint);
        if (!left || !right) {
            this.kerningCache.set(key, 0);
            return 0;
        }

        const pairText = `${codePointToString(leftCodePoint)}${codePointToString(rightCodePoint)}`;
        this.metricContext.font = buildCanvasFont(
            this.info.unitsPerEm ?? METRIC_EM_SIZE,
            this.familyToken,
            this.info.style,
            this.info.weight,
        );
        const pairAdvance = this.metricContext.measureText(pairText).width;
        const kerning = Math.round(pairAdvance - left.advance - right.advance);
        this.kerningCache.set(key, kerning);
        return kerning;
    }

    dispose(): void {
        if (!this.disposed) {
            this.glyphs.clear();
            this.kerningCache.clear();
            this.disposed = true;
        }
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private ensureActive(): void {
        if (this.disposed) {
            throw new FontLoadError('The system font runtime has already been disposed.');
        }
    }
}

export const createBrowserDynamicFontRuntimeFactory = (): DynamicFontRuntimeFactory => ({
    async create(source: DynamicFontRuntimeSource): Promise<DynamicFontFaceRuntime> {
        return BrowserDynamicFontFaceRuntime.create(source);
    },
});

export const createBrowserSystemFontFaceRuntime = (
    options: BrowserSystemFontFaceRuntimeOptions,
): DynamicFontFaceRuntime => BrowserSystemFontFaceRuntime.create(options);
