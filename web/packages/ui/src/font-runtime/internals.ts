import { FontLoadError } from '../errors';
import type { DynamicFontRuntimeInfo, FontStyle, FontWeight } from '../types';

export const METRIC_EM_SIZE = 1000;
const MIN_RASTER_SIZE = 8;
const MAX_RASTER_SIZE = 256;

export type CanvasLike = HTMLCanvasElement | OffscreenCanvas;
export type CanvasRenderingContext2DLike = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export const normalizeWeightToken = (weight: FontWeight | undefined): string => {
    if (weight === undefined) {
        return '400';
    }
    return String(weight);
};

export const normalizeStyleToken = (style: FontStyle | undefined): string => style ?? 'normal';

export const createCanvasContext = (): { canvas: CanvasLike; context: CanvasRenderingContext2DLike } => {
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

export const resizeCanvas = (canvas: CanvasLike, width: number, height: number): void => {
    canvas.width = Math.max(1, Math.ceil(width));
    canvas.height = Math.max(1, Math.ceil(height));
};

export const codePointToString = (codePoint: number): string => String.fromCodePoint(codePoint);

export const getBoundingWidth = (metrics: TextMetrics, fallbackAdvance: number): number => {
    const left = metrics.actualBoundingBoxLeft ?? 0;
    const right = metrics.actualBoundingBoxRight ?? 0;
    const bounded = left + right;
    return bounded > 0 ? bounded : Math.max(1, fallbackAdvance);
};

export const getBoundingHeight = (metrics: TextMetrics, fallbackSize: number): number => {
    const ascent = metrics.actualBoundingBoxAscent ?? 0;
    const descent = metrics.actualBoundingBoxDescent ?? 0;
    const bounded = ascent + descent;
    return bounded > 0 ? bounded : Math.max(1, fallbackSize);
};

export const quantizeRasterSize = (fontSize: number): number =>
    Math.max(MIN_RASTER_SIZE, Math.min(MAX_RASTER_SIZE, Math.round(fontSize)));

export const quoteFontFamilyToken = (family: string): string => {
    const trimmed = family.trim();
    if (trimmed.length === 0) {
        return 'sans-serif';
    }
    if (trimmed.includes(',') || trimmed.includes('"') || trimmed.includes("'")) {
        return trimmed;
    }
    return /\s/u.test(trimmed) ? `"${trimmed}"` : trimmed;
};

export const buildCanvasFont = (
    fontSize: number,
    familyToken: string,
    style: FontStyle | undefined,
    weight: FontWeight | undefined,
): string =>
    `${normalizeStyleToken(style)} ${normalizeWeightToken(weight)} ${fontSize}px ${familyToken}`;

export const createRuntimeInfo = (
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
