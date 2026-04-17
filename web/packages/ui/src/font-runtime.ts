import { FontLoadError } from './errors';
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

const METRIC_EM_SIZE = 1000;
const MIN_RASTER_SIZE = 8;
const MAX_RASTER_SIZE = 256;

let nextRuntimeId = 1;

type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
type CanvasRenderingContext2DLike = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

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

const normalizeWeightToken = (weight: FontWeight | undefined): string => {
    if (weight === undefined) {
        return '400';
    }
    return String(weight);
};

const normalizeStyleToken = (style: FontStyle | undefined): string => style ?? 'normal';

const createCanvasContext = (): { canvas: CanvasLike; context: CanvasRenderingContext2DLike } => {
    if (typeof OffscreenCanvas !== 'undefined') {
        const canvas = new OffscreenCanvas(1, 1);
        const context = canvas.getContext('2d');
        if (context) {
            return { canvas, context };
        }
    }
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (context) {
            return { canvas, context };
        }
    }
    throw new FontLoadError('No 2D canvas implementation is available for dynamic font rasterization.');
};

const resizeCanvas = (canvas: CanvasLike, width: number, height: number): void => {
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
};

const codePointToString = (codePoint: number): string => String.fromCodePoint(codePoint);

const getBoundingWidth = (metrics: TextMetrics, fallbackAdvance: number): number => {
    const left = metrics.actualBoundingBoxLeft ?? 0;
    const right = metrics.actualBoundingBoxRight ?? 0;
    const bounded = left + right;
    return bounded > 0 ? bounded : Math.max(1, fallbackAdvance);
};

const getBoundingHeight = (metrics: TextMetrics, fallbackSize: number): number => {
    const ascent = metrics.actualBoundingBoxAscent ?? 0;
    const descent = metrics.actualBoundingBoxDescent ?? 0;
    const bounded = ascent + descent;
    return bounded > 0 ? bounded : Math.max(1, fallbackSize);
};

const quantizeRasterSize = (fontSize: number): number =>
    Math.max(MIN_RASTER_SIZE, Math.min(MAX_RASTER_SIZE, Math.round(fontSize)));

const quoteFontFamilyToken = (family: string): string => {
    const trimmed = family.trim();
    if (trimmed.length === 0) {
        return 'sans-serif';
    }
    if (trimmed.includes(',') || trimmed.includes('"') || trimmed.includes("'")) {
        return trimmed;
    }
    return /\s/u.test(trimmed) ? `"${trimmed}"` : trimmed;
};

const buildCanvasFont = (
    fontSize: number,
    familyToken: string,
    style: FontStyle | undefined,
    weight: FontWeight | undefined,
): string =>
    `${normalizeStyleToken(style)} ${normalizeWeightToken(weight)} ${fontSize}px ${familyToken}`;

const createRuntimeInfo = (
    metricContext: CanvasRenderingContext2DLike,
    familyToken: string,
    source: {
        readonly family: string;
        readonly face?: string;
        readonly style?: FontStyle;
        readonly weight?: FontWeight;
        readonly locale?: string;
        readonly fallbackCodePoint?: number;
        readonly atlas?: DynamicFontRuntimeInfo['atlas'];
    },
): DynamicFontRuntimeInfo => {
    const sample = 'Hg';
    metricContext.font = buildCanvasFont(METRIC_EM_SIZE, familyToken, source.style, source.weight);
    const sampleMetrics = metricContext.measureText(sample);
    const ascent = Math.max(1, Math.ceil(sampleMetrics.actualBoundingBoxAscent ?? METRIC_EM_SIZE * 0.8));
    const descent = Math.max(1, Math.ceil(sampleMetrics.actualBoundingBoxDescent ?? METRIC_EM_SIZE * 0.2));
    const lineGap = Math.max(
        0,
        Math.ceil(
            (sampleMetrics.fontBoundingBoxAscent ?? ascent) +
                (sampleMetrics.fontBoundingBoxDescent ?? descent) -
                ascent -
                descent,
        ),
    );

    return {
        family: source.family,
        face: source.face ?? 'Regular',
        style: source.style ?? 'normal',
        weight: source.weight ?? 400,
        locale: source.locale ?? '',
        ascent,
        descent,
        lineGap,
        unitsPerEm: METRIC_EM_SIZE,
        defaultAdvance: Math.max(1, Math.ceil(sampleMetrics.width / Math.max(1, sample.length))),
        fallbackCodePoint: source.fallbackCodePoint ?? 63,
        atlas: source.atlas,
    };
};

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
