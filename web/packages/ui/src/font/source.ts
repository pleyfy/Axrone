import type {
    DynamicFontFaceAsset,
    FontAssetSource,
    FontBinaryFormat,
    FontFaceAsset,
    FontGlyphMetric,
    FontStyle,
    FontWeight,
    KerningPairKey,
    RetryPolicy,
    StaticFontFaceAsset,
} from '../types';

export const normalizeWeight = (weight: FontWeight | undefined): number => {
    switch (weight) {
        case 'thin':
            return 100;
        case 'extralight':
            return 200;
        case 'light':
            return 300;
        case 'normal':
            return 400;
        case 'medium':
            return 500;
        case 'semibold':
            return 600;
        case 'bold':
            return 700;
        case 'extrabold':
            return 800;
        case 'black':
            return 900;
        case undefined:
            return 400;
        default:
            return weight;
    }
};

export const normalizeStyle = (style: FontStyle | undefined): FontStyle => style ?? 'normal';

export const toByteArray = (value: ArrayBuffer | ArrayBufferView): Uint8Array => {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
};

export const toOwnedArrayBuffer = (value: ArrayBuffer | ArrayBufferView): ArrayBuffer => {
    const bytes = toByteArray(value);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
};

export const wait = async (delayMs: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });

export const applyRetryDelay = (policy: RetryPolicy | undefined, attempt: number): number => {
    const base = policy?.baseDelayMs ?? 16;
    const max = policy?.maxDelayMs ?? 250;
    const jitter = policy?.jitter ?? 0;
    const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));
    if (jitter <= 0) {
        return exponential;
    }
    const factor = 1 + (Math.random() * 2 - 1) * jitter;
    return Math.max(0, Math.round(exponential * factor));
};

export const isDynamicFontFaceAsset = (asset: FontFaceAsset): asset is DynamicFontFaceAsset => asset.kind === 'dynamic';

export const createAtlasEntryKey = (codePoint: number, rasterSize?: number): string => `${codePoint}:${rasterSize ?? 0}`;

export const detectBinaryFormatFromContentType = (contentType: string | undefined): FontBinaryFormat | null => {
    if (!contentType) {
        return null;
    }
    const normalized = contentType.toLowerCase();
    if (normalized.includes('woff2')) {
        return 'woff2';
    }
    if (normalized.includes('woff')) {
        return 'woff';
    }
    if (normalized.includes('font/otf') || normalized.includes('opentype')) {
        return 'otf';
    }
    if (normalized.includes('font/ttf') || normalized.includes('truetype') || normalized.includes('font/sfnt')) {
        return 'ttf';
    }
    return null;
};

export const detectBinaryFormatFromUrl = (url: string): FontBinaryFormat | null => {
    const normalized = url.toLowerCase().split('#')[0]!.split('?')[0]!;
    if (normalized.endsWith('.woff2')) {
        return 'woff2';
    }
    if (normalized.endsWith('.woff')) {
        return 'woff';
    }
    if (normalized.endsWith('.otf')) {
        return 'otf';
    }
    if (normalized.endsWith('.ttf')) {
        return 'ttf';
    }
    return null;
};

export const detectBinaryFormatFromBuffer = (bytes: Uint8Array): FontBinaryFormat | null => {
    if (bytes.byteLength < 4) {
        return null;
    }
    const tag = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
    if (tag === 'wOF2') {
        return 'woff2';
    }
    if (tag === 'wOFF') {
        return 'woff';
    }
    if (tag === 'OTTO') {
        return 'otf';
    }
    const sfnt =
        (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
        tag === 'true' ||
        tag === 'typ1';
    return sfnt ? 'ttf' : null;
};

export const detectSourceBinaryFormat = (source: FontAssetSource): FontBinaryFormat | null => {
    if (source.kind === 'descriptor') {
        return null;
    }
    if (source.contentType) {
        return detectBinaryFormatFromContentType(source.contentType);
    }
    if (source.kind === 'url') {
        return detectBinaryFormatFromUrl(source.url);
    }
    return detectBinaryFormatFromBuffer(toByteArray(source.data));
};

export const normalizeGlyphMap = (
    glyphs: StaticFontFaceAsset['glyphs'] | DynamicFontFaceAsset['glyphs'] | undefined
): Map<number, FontGlyphMetric> => {
    if (!glyphs) {
        return new Map<number, FontGlyphMetric>();
    }
    if (glyphs instanceof Map) {
        return new Map<number, FontGlyphMetric>(glyphs);
    }
    if (Array.isArray(glyphs)) {
        return new Map<number, FontGlyphMetric>(glyphs.map((metric) => [metric.codePoint, metric]));
    }
    return new Map<number, FontGlyphMetric>(Object.values(glyphs).map((metric) => [metric.codePoint, metric]));
};

export const normalizeKerningMap = (
    kernings: StaticFontFaceAsset['kernings'] | DynamicFontFaceAsset['kernings'] | undefined
): Map<KerningPairKey, number> => {
    if (!kernings) {
        return new Map<KerningPairKey, number>();
    }
    if (kernings instanceof Map) {
        return new Map<KerningPairKey, number>(kernings);
    }
    return new Map<KerningPairKey, number>(Object.entries(kernings) as [KerningPairKey, number][]);
};

export const buildSourceKey = (source: FontAssetSource): string => {
    const metadata = [
        source.kind !== 'descriptor' ? source.family ?? '' : '',
        source.kind !== 'descriptor' ? source.face ?? '' : '',
        source.kind !== 'descriptor' ? normalizeStyle(source.style) : '',
        source.kind !== 'descriptor' ? normalizeWeight(source.weight) : '',
        source.kind !== 'descriptor' ? source.locale ?? '' : '',
    ].join(':');
    switch (source.kind) {
        case 'descriptor':
            return `descriptor:${source.asset.kind ?? 'static'}:${source.asset.kind === 'dynamic' ? source.asset.runtime.info.family : source.asset.family}:${source.asset.kind === 'dynamic' ? source.asset.runtime.info.face ?? 'Regular' : source.asset.face ?? 'Regular'}:${source.asset.kind === 'dynamic' ? normalizeWeight(source.asset.runtime.info.weight) : normalizeWeight(source.asset.weight)}`;
        case 'buffer':
            return source.cacheKey ?? `buffer:${toByteArray(source.data).byteLength}:${source.contentType ?? 'application/octet-stream'}:${metadata}`;
        case 'url':
            return source.cacheKey ?? `url:${source.url}:${source.contentType ?? ''}:${metadata}`;
        default:
            return 'unknown';
    }
};