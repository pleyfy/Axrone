import type {
    FontBinaryFormat,
    FontFaceId,
    FontFamilyId,
    FontGlyphBitmapFormat,
    FontStyle,
    FontWeight,
    GlyphAtlasPageId,
    KerningPairKey,
} from './foundation';

export interface FontAtlasOptions {
    readonly width?: number;
    readonly height?: number;
    readonly padding?: number;
}

export interface FontGlyphMetric {
    readonly codePoint: number;
    readonly advance: number;
    readonly bearingX?: number;
    readonly bearingY?: number;
    readonly width?: number;
    readonly height?: number;
    readonly data?: ArrayBuffer | ArrayBufferView | null;
    readonly format?: FontGlyphBitmapFormat;
    readonly rowStride?: number;
    readonly distanceRange?: number;
}

export interface DynamicFontRuntimeInfo {
    readonly family: string;
    readonly face?: string;
    readonly style?: FontStyle;
    readonly weight?: FontWeight;
    readonly locale?: string;
    readonly ascent: number;
    readonly descent: number;
    readonly lineGap?: number;
    readonly unitsPerEm?: number;
    readonly defaultAdvance?: number;
    readonly fallbackCodePoint?: number;
    readonly atlas?: FontAtlasOptions;
}

export interface DynamicFontGlyphRaster {
    readonly codePoint: number;
    readonly rasterSize: number;
    readonly width: number;
    readonly height: number;
    readonly data?: ArrayBuffer | ArrayBufferView | null;
    readonly format?: FontGlyphBitmapFormat;
    readonly rowStride?: number;
    readonly distanceRange?: number;
}

export interface DynamicFontFaceRuntime {
    readonly info: DynamicFontRuntimeInfo;
    measureGlyph(codePoint: number): FontGlyphMetric | null;
    rasterizeGlyph(codePoint: number, pixelSize: number): DynamicFontGlyphRaster | null;
    getKerning?(leftCodePoint: number, rightCodePoint: number): number;
    dispose?(): void;
}

export interface StaticFontFaceAsset extends DynamicFontRuntimeInfo {
    readonly kind?: 'static';
    readonly glyphs:
        | ReadonlyArray<FontGlyphMetric>
        | ReadonlyMap<number, FontGlyphMetric>
        | Readonly<Record<string, FontGlyphMetric>>;
    readonly kernings?: Readonly<Record<KerningPairKey, number>> | ReadonlyMap<KerningPairKey, number>;
}

export interface DynamicFontFaceAsset {
    readonly kind: 'dynamic';
    readonly runtime: DynamicFontFaceRuntime;
    readonly glyphs?:
        | ReadonlyArray<FontGlyphMetric>
        | ReadonlyMap<number, FontGlyphMetric>
        | Readonly<Record<string, FontGlyphMetric>>;
    readonly kernings?: Readonly<Record<KerningPairKey, number>> | ReadonlyMap<KerningPairKey, number>;
}

export type FontFaceAsset = StaticFontFaceAsset | DynamicFontFaceAsset;

export interface FontFamilyDefinition {
    readonly name: string;
    readonly fallbacks?: readonly string[];
}

export interface FontQuery {
    readonly family?: string;
    readonly weight?: FontWeight;
    readonly style?: FontStyle;
    readonly locale?: string;
}

export interface FontAssetSourceDescriptor {
    readonly kind: 'descriptor';
    readonly asset: FontFaceAsset;
}

export interface FontAssetSourceMetadata {
    readonly family?: string;
    readonly face?: string;
    readonly style?: FontStyle;
    readonly weight?: FontWeight;
    readonly locale?: string;
    readonly fallbackCodePoint?: number;
    readonly atlas?: FontAtlasOptions;
    readonly contentType?: string;
}

export interface FontAssetSourceBuffer extends FontAssetSourceMetadata {
    readonly kind: 'buffer';
    readonly data: ArrayBuffer | ArrayBufferView;
    readonly cacheKey?: string;
}

export interface FontAssetSourceUrl extends FontAssetSourceMetadata {
    readonly kind: 'url';
    readonly url: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly cacheKey?: string;
}

export type FontAssetSource = FontAssetSourceDescriptor | FontAssetSourceBuffer | FontAssetSourceUrl;

export interface RetryPolicy {
    readonly attempts?: number;
    readonly baseDelayMs?: number;
    readonly maxDelayMs?: number;
    readonly jitter?: number;
}

export interface FontLoadOptions {
    readonly signal?: AbortSignal;
    readonly retry?: RetryPolicy;
}

export interface FontLoader {
    readonly id: string;
    canLoad(source: FontAssetSource): boolean;
    load(source: FontAssetSource, signal?: AbortSignal): Promise<FontFaceAsset>;
}

export interface FontRegistryOptions {
    readonly atlasWidth?: number;
    readonly atlasHeight?: number;
    readonly atlasPadding?: number;
    readonly defaultFamily?: string;
    readonly retry?: RetryPolicy;
    readonly fetch?: typeof globalThis.fetch;
    readonly dynamicRuntimeFactory?: DynamicFontRuntimeFactory;
}

export interface DynamicFontRuntimeSource {
    readonly source: FontAssetSourceBuffer | FontAssetSourceUrl;
    readonly bytes: ArrayBuffer;
    readonly format: FontBinaryFormat;
    readonly cacheKey: string;
}

export interface DynamicFontRuntimeFactory {
    create(source: DynamicFontRuntimeSource): Promise<DynamicFontFaceRuntime>;
}

export interface GlyphAtlasEntry {
    readonly faceId: FontFaceId;
    readonly page: GlyphAtlasPageId;
    readonly pageWidth: number;
    readonly pageHeight: number;
    readonly codePoint: number;
    readonly rasterSize?: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly format: FontGlyphBitmapFormat;
    readonly rowStride: number;
    readonly distanceRange: number;
    readonly u0: number;
    readonly v0: number;
    readonly u1: number;
    readonly v1: number;
    readonly data?: ArrayBuffer | ArrayBufferView | null;
}

export interface GlyphAtlasPageSnapshot {
    readonly id: number;
    readonly width: number;
    readonly height: number;
    readonly entries: readonly GlyphAtlasEntry[];
}

export interface FontFaceInfo {
    readonly id: FontFaceId;
    readonly family: string;
    readonly face: string;
    readonly style: FontStyle;
    readonly weight: number;
    readonly locale: string;
    readonly ascent: number;
    readonly descent: number;
    readonly lineGap: number;
    readonly unitsPerEm: number;
    readonly defaultAdvance: number;
    readonly fallbackCodePoint: number;
}

export interface FontGlyphMeasurement {
    readonly faceId: FontFaceId | null;
    readonly codePoint: number;
    readonly advance: number;
    readonly width: number;
    readonly height: number;
    readonly metric: FontGlyphMetric | null;
    readonly atlasEntry: GlyphAtlasEntry | null;
}

export interface FontFaceSnapshot {
    readonly id: number;
    readonly family: string;
    readonly face: string;
    readonly style: FontStyle;
    readonly weight: number;
    readonly locale: string;
    readonly ascent: number;
    readonly descent: number;
    readonly lineGap: number;
    readonly unitsPerEm: number;
    readonly defaultAdvance: number;
    readonly fallbackCodePoint: number;
    readonly glyphs: readonly FontGlyphMetric[];
    readonly kernings: readonly [KerningPairKey, number][];
    readonly atlas: readonly GlyphAtlasPageSnapshot[];
}

export interface FontRegistrySnapshot {
    readonly defaultFamily: string | null;
    readonly families: readonly FontFamilyDefinition[];
    readonly faces: readonly FontFaceSnapshot[];
}