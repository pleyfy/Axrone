import { FontLoadError } from '../errors';
import type {
    DynamicFontRuntimeFactory,
    FontAssetSource,
    FontFaceAsset,
    FontGlyphMetric,
    FontLoader,
    FontStyle,
    FontWeight,
    KerningPairKey,
    StaticFontFaceAsset,
} from '../types';
import {
    buildSourceKey,
    detectBinaryFormatFromBuffer,
    detectBinaryFormatFromContentType,
    detectBinaryFormatFromUrl,
    detectSourceBinaryFormat,
    normalizeStyle,
    normalizeWeight,
    toByteArray,
    toOwnedArrayBuffer,
} from './source';

export class DescriptorFontLoader implements FontLoader {
    readonly id = 'descriptor';

    canLoad(source: FontAssetSource): boolean {
        return source.kind === 'descriptor';
    }

    async load(source: FontAssetSource): Promise<FontFaceAsset> {
        if (source.kind !== 'descriptor') {
            throw new FontLoadError('DescriptorFontLoader only accepts descriptor sources.');
        }
        return source.asset;
    }
}

export class BinaryFontLoader implements FontLoader {
    readonly id = 'binary';

    private readonly fetchImpl?: typeof globalThis.fetch;
    private readonly runtimeFactory: DynamicFontRuntimeFactory;

    constructor(fetchImpl: typeof globalThis.fetch | undefined, runtimeFactory: DynamicFontRuntimeFactory) {
        this.fetchImpl = fetchImpl;
        this.runtimeFactory = runtimeFactory;
    }

    canLoad(source: FontAssetSource): boolean {
        return source.kind !== 'descriptor' && detectSourceBinaryFormat(source) !== null;
    }

    async load(source: FontAssetSource, signal?: AbortSignal): Promise<FontFaceAsset> {
        if (source.kind === 'descriptor') {
            throw new FontLoadError('BinaryFontLoader only accepts buffer or url sources.');
        }

        let bytes: ArrayBuffer;
        let format = detectSourceBinaryFormat(source);

        if (source.kind === 'buffer') {
            bytes = toOwnedArrayBuffer(source.data);
            format ??= detectBinaryFormatFromBuffer(new Uint8Array(bytes));
        } else {
            if (!this.fetchImpl) {
                throw new FontLoadError('No fetch implementation is available for URL font sources.');
            }
            const response = await this.fetchImpl.call(globalThis, source.url, {
                headers: source.headers,
                signal,
            });
            if (!response.ok) {
                throw new FontLoadError(`Font request failed with status ${response.status}.`, {
                    url: source.url,
                    status: response.status,
                });
            }
            bytes = await response.arrayBuffer();
            const responseContentType =
                typeof response.headers?.get === 'function' ? response.headers.get('content-type') ?? undefined : undefined;
            format ??= detectBinaryFormatFromContentType(responseContentType);
            format ??= detectBinaryFormatFromUrl(source.url);
            format ??= detectBinaryFormatFromBuffer(new Uint8Array(bytes));
        }

        if (!format) {
            throw new FontLoadError('Unable to determine the binary font format.', { source });
        }

        return {
            kind: 'dynamic',
            runtime: await this.runtimeFactory.create({
                source,
                bytes,
                format,
                cacheKey: buildSourceKey(source),
            }),
        };
    }
}

export class JsonFontLoader implements FontLoader {
    readonly id = 'json';
    private readonly fetchImpl?: typeof globalThis.fetch;

    constructor(fetchImpl?: typeof globalThis.fetch) {
        this.fetchImpl = fetchImpl;
    }

    canLoad(source: FontAssetSource): boolean {
        return source.kind !== 'descriptor' && detectSourceBinaryFormat(source) === null;
    }

    async load(source: FontAssetSource, signal?: AbortSignal): Promise<FontFaceAsset> {
        if (source.kind === 'buffer') {
            const text = new TextDecoder().decode(toByteArray(source.data));
            return this.normalizeParsedAsset(JSON.parse(text) as Record<string, unknown>);
        }
        if (source.kind !== 'url') {
            throw new FontLoadError('JsonFontLoader only accepts buffer or url sources.');
        }
        if (!this.fetchImpl) {
            throw new FontLoadError('No fetch implementation is available for URL font sources.');
        }
        const response = await this.fetchImpl.call(globalThis, source.url, {
            headers: source.headers,
            signal,
        });
        if (!response.ok) {
            throw new FontLoadError(`Font request failed with status ${response.status}.`, {
                url: source.url,
                status: response.status,
            });
        }
        const payload = (await response.json()) as Record<string, unknown>;
        return this.normalizeParsedAsset(payload);
    }

    private normalizeParsedAsset(payload: Record<string, unknown>): StaticFontFaceAsset {
        const glyphsValue = payload.glyphs;
        const glyphs = Array.isArray(glyphsValue)
            ? (glyphsValue as FontGlyphMetric[])
            : typeof glyphsValue === 'object' && glyphsValue !== null
              ? Object.values(glyphsValue as Record<string, FontGlyphMetric>)
              : [];
        const kerningsValue = payload.kernings;
        const kernings = kerningsValue instanceof Map
            ? kerningsValue
            : typeof kerningsValue === 'object' && kerningsValue !== null
              ? (kerningsValue as Record<KerningPairKey, number>)
              : undefined;
        return {
            family: String(payload.family ?? ''),
            face: String(payload.face ?? 'Regular'),
            style: normalizeStyle((payload.style as FontStyle | undefined) ?? 'normal'),
            weight: normalizeWeight(payload.weight as FontWeight | undefined) as StaticFontFaceAsset['weight'],
            locale: String(payload.locale ?? ''),
            ascent: Number(payload.ascent ?? 0),
            descent: Number(payload.descent ?? 0),
            lineGap: Number(payload.lineGap ?? 0),
            unitsPerEm: Number(payload.unitsPerEm ?? 1000),
            defaultAdvance: Number(payload.defaultAdvance ?? 500),
            fallbackCodePoint: Number(payload.fallbackCodePoint ?? 63),
            glyphs,
            kernings,
            atlas:
                typeof payload.atlas === 'object' && payload.atlas !== null
                    ? {
                          width: Number((payload.atlas as Record<string, unknown>).width ?? 1024),
                          height: Number((payload.atlas as Record<string, unknown>).height ?? 1024),
                          padding: Number((payload.atlas as Record<string, unknown>).padding ?? 1),
                      }
                    : undefined,
        };
    }
}
