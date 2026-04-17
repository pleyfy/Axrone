import { DisposedUIError, FontFaceNotFoundError, FontLoadError } from './errors';
import { createBrowserDynamicFontRuntimeFactory } from './font-runtime';
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
    GlyphAtlasPageId,
    GlyphAtlasPageSnapshot,
    KerningPairKey,
    RetryPolicy,
    StaticFontFaceAsset,
} from './types';

const normalizeWeight = (weight: FontWeight | undefined): number => {
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

const normalizeStyle = (style: FontStyle | undefined): FontStyle => style ?? 'normal';

const toByteArray = (value: ArrayBuffer | ArrayBufferView): Uint8Array => {
    if (value instanceof ArrayBuffer) {
        return new Uint8Array(value);
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
};

const toOwnedArrayBuffer = (value: ArrayBuffer | ArrayBufferView): ArrayBuffer => {
    const bytes = toByteArray(value);
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    return copy.buffer;
};

const wait = async (delayMs: number): Promise<void> =>
    new Promise((resolve) => {
        setTimeout(resolve, delayMs);
    });

const applyRetryDelay = (policy: RetryPolicy | undefined, attempt: number): number => {
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

const isDynamicFontFaceAsset = (asset: FontFaceAsset): asset is DynamicFontFaceAsset => asset.kind === 'dynamic';

const createAtlasEntryKey = (codePoint: number, rasterSize?: number): string => `${codePoint}:${rasterSize ?? 0}`;

const detectBinaryFormatFromContentType = (contentType: string | undefined): FontBinaryFormat | null => {
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

const detectBinaryFormatFromUrl = (url: string): FontBinaryFormat | null => {
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

const detectBinaryFormatFromBuffer = (bytes: Uint8Array): FontBinaryFormat | null => {
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

const detectSourceBinaryFormat = (source: FontAssetSource): FontBinaryFormat | null => {
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

const normalizeGlyphMap = (
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

const normalizeKerningMap = (
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

const buildSourceKey = (source: FontAssetSource): string => {
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

interface GlyphAtlasSource {
    readonly codePoint: number;
    readonly rasterSize?: number;
    readonly width: number;
    readonly height: number;
    readonly data?: ArrayBuffer | ArrayBufferView | null;
    readonly format?: FontGlyphBitmapFormat;
    readonly rowStride?: number;
    readonly distanceRange?: number;
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

interface AtlasPage {
    readonly id: GlyphAtlasPageId;
    readonly width: number;
    readonly height: number;
    cursorX: number;
    cursorY: number;
    rowHeight: number;
    readonly entries: Map<string, GlyphAtlasEntry>;
}

class GlyphAtlas {
    private readonly faceId: FontFaceId;
    private readonly width: number;
    private readonly height: number;
    private readonly padding: number;
    private readonly pages: AtlasPage[] = [];
    private readonly entries = new Map<string, GlyphAtlasEntry>();
    private nextPageId = 1;

    constructor(faceId: FontFaceId, width: number, height: number, padding: number) {
        this.faceId = faceId;
        this.width = Math.max(8, Math.floor(width));
        this.height = Math.max(8, Math.floor(height));
        this.padding = Math.max(0, Math.floor(padding));
    }

    get(codePoint: number, rasterSize?: number): GlyphAtlasEntry | null {
        return this.entries.get(createAtlasEntryKey(codePoint, rasterSize)) ?? null;
    }

    ensure(glyph: GlyphAtlasSource): GlyphAtlasEntry {
        const key = createAtlasEntryKey(glyph.codePoint, glyph.rasterSize);
        const existing = this.entries.get(key);
        if (existing) {
            return existing;
        }
        const width = Math.max(1, Math.ceil(glyph.width));
        const height = Math.max(1, Math.ceil(glyph.height));
        const paddedWidth = width + this.padding * 2;
        const paddedHeight = height + this.padding * 2;
        let page = this.pages[this.pages.length - 1];
        if (!page) {
            page = this.createPage();
        }
        if (page.cursorX + paddedWidth > page.width) {
            page.cursorX = 0;
            page.cursorY += page.rowHeight;
            page.rowHeight = 0;
        }
        if (page.cursorY + paddedHeight > page.height) {
            page = this.createPage();
        }
        const x = page.cursorX + this.padding;
        const y = page.cursorY + this.padding;
        const format: FontGlyphBitmapFormat = glyph.format ?? 'alpha8';
        const rowStride = glyph.rowStride ?? width * (format === 'rgba8' ? 4 : 1);
        const entry: GlyphAtlasEntry = {
            faceId: this.faceId,
            page: page.id,
            pageWidth: page.width,
            pageHeight: page.height,
            codePoint: glyph.codePoint,
            rasterSize: glyph.rasterSize,
            x,
            y,
            width,
            height,
            format,
            rowStride,
            distanceRange: glyph.distanceRange ?? 1,
            u0: x / page.width,
            v0: y / page.height,
            u1: (x + width) / page.width,
            v1: (y + height) / page.height,
            data: glyph.data ?? null,
        };
        page.entries.set(key, entry);
        this.entries.set(key, entry);
        page.cursorX += paddedWidth;
        page.rowHeight = Math.max(page.rowHeight, paddedHeight);
        return entry;
    }

    snapshot(): readonly GlyphAtlasPageSnapshot[] {
        return this.pages.map((page) => ({
            id: page.id as number,
            width: page.width,
            height: page.height,
            entries: [...page.entries.values()],
        }));
    }

    restore(pages: readonly GlyphAtlasPageSnapshot[]): void {
        this.pages.length = 0;
        this.entries.clear();
        let maxPageId = 0;
        for (const pageSnapshot of pages) {
            const page: AtlasPage = {
                id: pageSnapshot.id as GlyphAtlasPageId,
                width: pageSnapshot.width,
                height: pageSnapshot.height,
                cursorX: 0,
                cursorY: 0,
                rowHeight: 0,
                entries: new Map<string, GlyphAtlasEntry>(),
            };
            for (const entry of pageSnapshot.entries) {
                const key = createAtlasEntryKey(entry.codePoint, entry.rasterSize);
                page.entries.set(key, entry);
                this.entries.set(key, entry);
                page.cursorX = Math.max(page.cursorX, entry.x + entry.width + this.padding);
                page.cursorY = Math.max(page.cursorY, entry.y);
                page.rowHeight = Math.max(page.rowHeight, entry.height + this.padding * 2);
            }
            this.pages.push(page);
            maxPageId = Math.max(maxPageId, pageSnapshot.id);
        }
        this.nextPageId = maxPageId + 1;
    }

    clear(): void {
        this.pages.length = 0;
        this.entries.clear();
        this.nextPageId = 1;
    }

    private createPage(): AtlasPage {
        const page: AtlasPage = {
            id: this.nextPageId as GlyphAtlasPageId,
            width: this.width,
            height: this.height,
            cursorX: 0,
            cursorY: 0,
            rowHeight: 0,
            entries: new Map<string, GlyphAtlasEntry>(),
        };
        this.nextPageId += 1;
        this.pages.push(page);
        return page;
    }
}

class DescriptorFontLoader implements FontLoader {
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

class BinaryFontLoader implements FontLoader {
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

class JsonFontLoader implements FontLoader {
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

export { createBrowserDynamicFontRuntimeFactory };
