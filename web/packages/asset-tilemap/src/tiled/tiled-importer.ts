import type { AssetImportDiagnostic } from '@axrone/asset-core';
import {
    KEY_MAX,
    KEY_MIN,
    asChunkKey,
    chunkAreaForShift,
    isValidChunkShift,
    packChunkKey,
    packTileWord,
    validateChunkSnapshot,
    type ChunkSnapshot,
    type LayerSpec,
    type ProjectionSpec,
    type ValidChunkShift,
} from '@axrone/tilemap';
import { err, ok, type Result } from '@axrone/utility';
import {
    TilemapAssetErrorCode,
    tilemapAssetError,
    type TilemapAssetError,
} from '../errors';
import {
    createTilemapAssetDefinition,
    tilemapChunkAssetKey,
    type TilemapAssetDefinition,
} from '../tilemap-asset';
import type { TilesetDefinition } from '../tileset';
import {
    attribute,
    booleanProperty,
    childElements,
    firstChild,
    integerAttribute,
    parseXml,
    type XmlElement,
} from './tmx-parser';
import {
    parseTsxElement,
    parseTsxTileset,
    type TiledTilesetEntry,
} from './tsx-parser';

export interface TiledImportOptions {
    /** Chunk size used for the produced snapshots; defaults to 4 (16x16). */
    readonly chunkShift?: ValidChunkShift;
    /** Stable map key used in chunk asset keys; defaults to the map name. */
    readonly mapKey?: string;
    /** Loads an external TSX source; returning `undefined` is a missing tileset. */
    readonly resolveTsx?: (
        source: string
    ) => string | undefined | Promise<string | undefined>;
}

export interface TiledCollisionHint {
    readonly layer: string;
    readonly name?: string;
    readonly type?: string;
    readonly gridX: number;
    readonly gridY: number;
    readonly width: number;
    readonly height: number;
}

export interface TiledImportedChunk {
    readonly assetKey: string;
    readonly snapshot: ChunkSnapshot;
}

export interface TiledImportResult {
    readonly tilemap: TilemapAssetDefinition;
    readonly tilesets: readonly TilesetDefinition[];
    readonly chunks: readonly TiledImportedChunk[];
    readonly collisionHints: readonly TiledCollisionHint[];
    readonly diagnostics: readonly AssetImportDiagnostic[];
}

const FLIP_HORIZONTAL = 0x80000000;
const FLIP_VERTICAL = 0x40000000;
const FLIP_DIAGONAL = 0x20000000;
const GID_MASK = 0x1fffffff;

const fail = (
    code: TilemapAssetErrorCode,
    message: string,
    details?: Readonly<Record<string, unknown>>,
    cause?: unknown
): Result<never, TilemapAssetError> =>
    err(tilemapAssetError(code, message, { details, cause }));

const BASE64_ALPHABET =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = (() => {
    const table = new Int16Array(128).fill(-1);
    for (let index = 0; index < BASE64_ALPHABET.length; index++) {
        table[BASE64_ALPHABET.charCodeAt(index)] = index;
    }
    return table;
})();

export const decodeBase64 = (
    input: string
): Result<Uint8Array, TilemapAssetError> => {
    const text = input.replace(/\s+/g, '');
    if (text.length === 0 || text.length % 4 !== 0) {
        return fail(
            TilemapAssetErrorCode.MALFORMED_SOURCE,
            'base64 payload length must be a non-zero multiple of four'
        );
    }
    let padding = 0;
    if (text.endsWith('==')) padding = 2;
    else if (text.endsWith('=')) padding = 1;
    const output = new Uint8Array((text.length / 4) * 3 - padding);
    let cursor = 0;
    for (let index = 0; index < text.length; index += 4) {
        const values = [0, 0, 0, 0];
        for (let offset = 0; offset < 4; offset++) {
            const char = text[index + offset]!;
            if (char === '=') {
                values[offset] = 0;
                continue;
            }
            const code = char.charCodeAt(0);
            const value =
                code < BASE64_LOOKUP.length ? BASE64_LOOKUP[code]! : -1;
            if (value < 0) {
                return fail(
                    TilemapAssetErrorCode.MALFORMED_SOURCE,
                    'base64 payload contains an invalid character',
                    { index: index + offset }
                );
            }
            values[offset] = value;
        }
        const bits =
            (values[0]! << 18) |
            (values[1]! << 12) |
            (values[2]! << 6) |
            values[3]!;
        if (cursor < output.length) output[cursor++] = (bits >> 16) & 0xff;
        if (cursor < output.length) output[cursor++] = (bits >> 8) & 0xff;
        if (cursor < output.length) output[cursor++] = bits & 0xff;
    }
    return ok(output);
};

const decompress = async (
    bytes: Uint8Array,
    format: 'gzip' | 'zlib'
): Promise<Result<Uint8Array, TilemapAssetError>> => {
    if (typeof DecompressionStream === 'undefined') {
        return fail(
            TilemapAssetErrorCode.UNSUPPORTED_COMPRESSION,
            `this environment has no DecompressionStream for ${format}`
        );
    }
    try {
        const stream = new DecompressionStream(
            format === 'gzip' ? 'gzip' : 'deflate'
        );
        const writer = stream.writable.getWriter();
        await writer.write(bytes);
        await writer.close();
        const reader = stream.readable.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.length;
        }
        const output = new Uint8Array(total);
        let cursor = 0;
        for (const chunk of chunks) {
            output.set(chunk, cursor);
            cursor += chunk.length;
        }
        return ok(output);
    } catch (cause) {
        return fail(
            TilemapAssetErrorCode.MALFORMED_SOURCE,
            `failed to decompress ${format} tile data`,
            undefined,
            cause
        );
    }
};

const decodeDataBytes = async (
    data: Uint8Array,
    compression: string
): Promise<Result<Uint8Array, TilemapAssetError>> => {
    if (compression === '' || compression === 'none') return ok(data);
    if (compression === 'zlib') return decompress(data, 'zlib');
    if (compression === 'gzip') return decompress(data, 'gzip');
    return fail(
        TilemapAssetErrorCode.UNSUPPORTED_COMPRESSION,
        `unsupported tile data compression: ${compression}`,
        { compression }
    );
};

const readTileValues = async (
    data: XmlElement,
    encoding: string,
    compression: string,
    expectedCount: number
): Promise<Result<Uint32Array, TilemapAssetError>> => {
    if (encoding === 'csv') {
        const tokens = data.text
            .trim()
            .split(',')
            .map((token) => token.trim())
            .filter((token) => token.length > 0);
        if (tokens.length !== expectedCount) {
            return fail(
                TilemapAssetErrorCode.MALFORMED_SOURCE,
                'CSV tile data has the wrong number of entries',
                { expected: expectedCount, actual: tokens.length }
            );
        }
        const values = new Uint32Array(tokens.length);
        for (let index = 0; index < tokens.length; index++) {
            const value = Number(tokens[index]);
            if (!Number.isInteger(value) || value < 0) {
                return fail(
                    TilemapAssetErrorCode.MALFORMED_SOURCE,
                    `invalid CSV tile gid at index ${index}`,
                    { index, value: tokens[index] }
                );
            }
            values[index] = value >>> 0;
        }
        return ok(values);
    }
    if (encoding === 'base64') {
        const decoded = decodeBase64(data.text);
        if (decoded.isErr()) return err(decoded.expectErr('base64'));
        const bytes = await decodeDataBytes(decoded.get(), compression);
        if (bytes.isErr()) return err(bytes.expectErr('compression'));
        const buffer = bytes.get();
        if (buffer.length !== expectedCount * 4) {
            return fail(
                TilemapAssetErrorCode.MALFORMED_SOURCE,
                'tile data byte length does not match the layer dimensions',
                { expected: expectedCount * 4, actual: buffer.length }
            );
        }
        const values = new Uint32Array(expectedCount);
        const view = new DataView(
            buffer.buffer,
            buffer.byteOffset,
            buffer.byteLength
        );
        for (let index = 0; index < expectedCount; index++) {
            values[index] = view.getUint32(index * 4, true);
        }
        return ok(values);
    }
    return fail(
        TilemapAssetErrorCode.UNSUPPORTED_ENCODING,
        `unsupported tile data encoding: ${encoding || '(xml)'}`,
        { encoding }
    );
};

const tileTransformFlags = (gid: number): number =>
    ((gid & FLIP_HORIZONTAL) !== 0 ? 1 : 0) |
    ((gid & FLIP_VERTICAL) !== 0 ? 2 : 0) |
    ((gid & FLIP_DIAGONAL) !== 0 ? 4 : 0);

const resolveTileset = (
    tilesets: readonly TiledTilesetEntry[],
    gid: number
): TiledTilesetEntry | undefined => {
    let found: TiledTilesetEntry | undefined;
    for (const entry of tilesets) {
        if (entry.firstGid <= gid) {
            if (found === undefined || entry.firstGid > found.firstGid) {
                found = entry;
            }
        }
    }
    return found;
};

const gidToWord = (
    tilesets: readonly TiledTilesetEntry[],
    gid: number
): Result<number, TilemapAssetError> => {
    const flags = tileTransformFlags(gid);
    const rawGid = gid & GID_MASK;
    if (rawGid === 0) return ok(0);
    const tileset = resolveTileset(tilesets, rawGid);
    if (tileset === undefined) {
        return fail(
            TilemapAssetErrorCode.MISSING_TILESET,
            `no tileset owns gid ${rawGid}`,
            { gid: rawGid }
        );
    }
    const tileId = rawGid - tileset.firstGid;
    if (tileId >= tileset.definition.tileCount) {
        return fail(
            TilemapAssetErrorCode.TILED_ID_OUT_OF_RANGE,
            `tile id ${tileId} is outside tileset ${tileset.definition.name}`,
            {
                gid: rawGid,
                firstGid: tileset.firstGid,
                tileId,
                tileCount: tileset.definition.tileCount,
            }
        );
    }
    if (tileId > 0xffff) {
        return fail(
            TilemapAssetErrorCode.TILED_ID_OUT_OF_RANGE,
            `tile id ${tileId} exceeds the 16-bit packed word ABI`,
            { tileId }
        );
    }
    try {
        return ok(packTileWord(tileId, flags) as number);
    } catch (cause) {
        return fail(
            TilemapAssetErrorCode.TILED_ID_OUT_OF_RANGE,
            `cannot pack tile id ${tileId}`,
            undefined,
            cause
        );
    }
};

interface LayerSource {
    readonly element: XmlElement;
    readonly name: string;
    readonly width: number;
    readonly height: number;
    readonly collision: boolean;
    readonly visible: boolean;
    readonly opacity?: number;
}

interface DecodedLayer extends LayerSource {
    readonly words: Uint32Array;
}

const basename = (value: string): string => {
    const leaf = value.split(/[\\/]/).pop() ?? value;
    return leaf.replace(/\.[^.]+$/, '') || value;
};

const readBooleanProperty = (element: XmlElement, name: string): boolean => {
    const properties = firstChild(element, 'properties');
    if (properties === undefined) return false;
    for (const property of childElements(properties, 'property')) {
        if (attribute(property, 'name') !== name) continue;
        return booleanProperty(attribute(property, 'value') ?? '');
    }
    return false;
};

const collectLayerSources = (
    element: XmlElement,
    mapWidth: number,
    mapHeight: number,
    diagnostics: AssetImportDiagnostic[],
    out: LayerSource[]
): void => {
    for (const child of element.children) {
        if (child.name === 'group') {
            collectLayerSources(child, mapWidth, mapHeight, diagnostics, out);
            continue;
        }
        if (child.name === 'imagelayer') {
            diagnostics.push({
                level: 'warning',
                code: 'UNSUPPORTED_LAYER_TYPE',
                message: `image layer "${attribute(child, 'name') ?? ''}" is imported as a diagnostic only`,
            });
            continue;
        }
        if (child.name !== 'layer') continue;
        const width = integerAttribute(child, 'width', mapWidth);
        const height = integerAttribute(child, 'height', mapHeight);
        if (width.isErr() || height.isErr()) continue;
        const opacityRaw = attribute(child, 'opacity');
        const opacity =
            opacityRaw === undefined ? undefined : Number(opacityRaw);
        out.push({
            element: child,
            name: attribute(child, 'name') ?? `layer-${out.length}`,
            width: width.get(),
            height: height.get(),
            collision: readBooleanProperty(child, 'collision'),
            visible: attribute(child, 'visible') !== '0',
            opacity:
                opacity !== undefined && Number.isFinite(opacity)
                    ? Math.min(1, Math.max(0, opacity))
                    : undefined,
        });
    }
};

const decodeLayer = async (
    source: LayerSource
): Promise<Result<DecodedLayer, TilemapAssetError>> => {
    const data = firstChild(source.element, 'data');
    if (data === undefined) {
        return fail(
            TilemapAssetErrorCode.MALFORMED_SOURCE,
            `layer ${source.name} has no data element`,
            { layer: source.name }
        );
    }
    const encoding = attribute(data, 'encoding') ?? '';
    const compression = attribute(data, 'compression') ?? '';
    const values = await readTileValues(
        data,
        encoding,
        compression,
        source.width * source.height
    );
    if (values.isErr()) return err(values.expectErr('tile values'));
    return ok({ ...source, words: values.get() });
};

const collectCollisionHints = (
    element: XmlElement,
    mapTileWidth: number,
    mapTileHeight: number,
    out: TiledCollisionHint[]
): void => {
    for (const child of element.children) {
        if (child.name === 'objectgroup') {
            const layerName = attribute(child, 'name') ?? 'collision';
            for (const object of childElements(child, 'object')) {
                const x = Number(attribute(object, 'x') ?? '');
                const y = Number(attribute(object, 'y') ?? '');
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                const width = Number(attribute(object, 'width') ?? '0');
                const height = Number(attribute(object, 'height') ?? '0');
                out.push({
                    layer: layerName,
                    name: attribute(object, 'name'),
                    type: attribute(object, 'type') ?? attribute(object, 'class'),
                    gridX: Math.floor(x / mapTileWidth),
                    gridY: Math.floor(y / mapTileHeight),
                    width: Math.max(
                        0,
                        Math.ceil((Number.isFinite(width) ? width : 0) / mapTileWidth)
                    ),
                    height: Math.max(
                        0,
                        Math.ceil((Number.isFinite(height) ? height : 0) / mapTileHeight)
                    ),
                });
            }
        }
        if (child.name === 'group' || child.name === 'layer') {
            collectCollisionHints(child, mapTileWidth, mapTileHeight, out);
        }
    }
};

const parseProjection = (
    map: XmlElement,
    tileWidth: number,
    tileHeight: number
): Result<ProjectionSpec, TilemapAssetError> => {
    const orientation = attribute(map, 'orientation') ?? 'orthogonal';
    if (orientation === 'orthogonal') {
        return ok({ kind: 'orthogonal', tileWidth, tileHeight });
    }
    if (orientation === 'isometric') {
        return ok({ kind: 'isometric', tileWidth, tileHeight });
    }
    if (orientation === 'staggered') {
        const staggerAxis = attribute(map, 'staggeraxis');
        const staggerIndex = attribute(map, 'staggerindex');
        return ok({
            kind: 'staggered-isometric',
            tileWidth,
            tileHeight,
            staggerAxis: staggerAxis === 'x' ? 'x' : 'y',
            staggerIndex: staggerIndex === 'even' ? 'even' : 'odd',
        });
    }
    return fail(
        TilemapAssetErrorCode.UNSUPPORTED_PROJECTION,
        `unsupported Tiled orientation: ${orientation}`,
        { orientation }
    );
};

const resetTilesetName = (
    definition: TilesetDefinition,
    name: string
): TilesetDefinition =>
    Object.freeze({ ...definition, name });

/**
 * Imports a finite Tiled TMX map (CSV or base64 zlib/gzip data) plus external
 * or inline TSX tilesets into the native tilemap definition and chunk
 * snapshots. Object groups are read-only collision hints; image layers are
 * reported as diagnostics.
 */
export const importTiledMap = async (
    tmx: string,
    options: TiledImportOptions = {}
): Promise<Result<TiledImportResult, TilemapAssetError>> => {
    try {
        const parsed = parseXml(tmx);
        if (parsed.isErr()) return err(parsed.expectErr('parse tmx'));
        const map = parsed.get();
        if (map.name !== 'map') {
            return fail(
                TilemapAssetErrorCode.MALFORMED_SOURCE,
                `expected <map> root, got <${map.name}>`
            );
        }

        const mapWidth = integerAttribute(map, 'width');
        const mapHeight = integerAttribute(map, 'height');
        const tileWidth = integerAttribute(map, 'tilewidth');
        const tileHeight = integerAttribute(map, 'tileheight');
        for (const result of [mapWidth, mapHeight, tileWidth, tileHeight]) {
            if (result.isErr()) return err(result.expectErr('map attribute'));
        }
        if (
            mapWidth.get() <= 0 ||
            mapHeight.get() <= 0 ||
            tileWidth.get() <= 0 ||
            tileHeight.get() <= 0
        ) {
            return fail(
                TilemapAssetErrorCode.MALFORMED_SOURCE,
                'map and tile dimensions must be positive'
            );
        }
        if (attribute(map, 'infinite') === '1') {
            return fail(
                TilemapAssetErrorCode.UNSUPPORTED_ENCODING,
                'infinite Tiled maps are not supported by the finite importer'
            );
        }
        const projection = parseProjection(map, tileWidth.get(), tileHeight.get());
        if (projection.isErr()) return err(projection.expectErr('projection'));

        const chunkShift = options.chunkShift ?? 4;
        if (!isValidChunkShift(chunkShift)) {
            return fail(
                TilemapAssetErrorCode.INVALID_TILEMAP,
                `invalid chunkShift: ${String(options.chunkShift)}`
            );
        }

        const diagnostics: AssetImportDiagnostic[] = [];
        const tilesets: TiledTilesetEntry[] = [];
        for (const tilesetElement of childElements(map, 'tileset')) {
            const firstGid = integerAttribute(tilesetElement, 'firstgid');
            if (firstGid.isErr()) {
                return err(firstGid.expectErr('firstgid'));
            }
            const source = attribute(tilesetElement, 'source');
            let definition: Result<TilesetDefinition, TilemapAssetError>;
            if (source !== undefined) {
                if (options.resolveTsx === undefined) {
                    return fail(
                        TilemapAssetErrorCode.MISSING_TILESET,
                        `external tileset ${source} needs a resolveTsx loader`,
                        { source }
                    );
                }
                const xml = await options.resolveTsx(source);
                if (xml === undefined || xml.length === 0) {
                    return fail(
                        TilemapAssetErrorCode.MISSING_TILESET,
                        `external tileset ${source} could not be resolved`,
                        { source }
                    );
                }
                definition = parseTsxTileset(xml, {
                    firstGid: firstGid.get(),
                    fallbackName: basename(source),
                });
            } else {
                definition = parseTsxElement(tilesetElement, {
                    firstGid: firstGid.get(),
                    fallbackName: `tileset-${firstGid.get()}`,
                });
            }
            if (definition.isErr()) {
                return err(definition.expectErr('tileset'));
            }
            tilesets.push({
                firstGid: firstGid.get(),
                definition: definition.get(),
            });
        }
        if (tilesets.length === 0) {
            return fail(
                TilemapAssetErrorCode.MISSING_TILESET,
                'map has no tilesets'
            );
        }
        tilesets.sort((left, right) => left.firstGid - right.firstGid);
        for (let index = 1; index < tilesets.length; index++) {
            if (tilesets[index]!.firstGid === tilesets[index - 1]!.firstGid) {
                return fail(
                    TilemapAssetErrorCode.MALFORMED_SOURCE,
                    `duplicate tileset firstgid ${tilesets[index]!.firstGid}`
                );
            }
        }

        const layerSources: LayerSource[] = [];
        collectLayerSources(
            map,
            mapWidth.get(),
            mapHeight.get(),
            diagnostics,
            layerSources
        );
        if (layerSources.length === 0) {
            return fail(
                TilemapAssetErrorCode.INVALID_TILEMAP,
                'map has no tile layers'
            );
        }
        const usedNames = new Map<string, number>();
        for (const layer of layerSources) {
            const count = usedNames.get(layer.name) ?? 0;
            usedNames.set(layer.name, count + 1);
        }
        const layerNames = new Map<string, number>();
        const layers: DecodedLayer[] = [];
        for (const source of layerSources) {
            const decoded = await decodeLayer(source);
            if (decoded.isErr()) return err(decoded.expectErr('layer'));
            const layer = decoded.get();
            const seen = layerNames.get(layer.name) ?? 0;
            layerNames.set(layer.name, seen + 1);
            const uniqueName =
                (usedNames.get(layer.name) ?? 0) > 1 && seen > 0
                    ? `${layer.name}#${seen + 1}`
                    : layer.name;
            layers.push({ ...layer, name: uniqueName });
        }

        const chunkSize = 1 << chunkShift;
        const chunkArea = chunkAreaForShift(chunkShift);
        const layerCount = layers.length;
        const chunks = new Map<
            number,
            { chunkX: number; chunkY: number; words: Uint32Array }
        >();
        for (let layerIndex = 0; layerIndex < layers.length; layerIndex++) {
            const layer = layers[layerIndex]!;
            for (let tileIndex = 0; tileIndex < layer.words.length; tileIndex++) {
                const gid = layer.words[tileIndex]!;
                const word = gidToWord(tilesets, gid);
                if (word.isErr()) return err(word.expectErr('gid'));
                if (word.get() === 0) continue;
                const gridX = tileIndex % layer.width;
                const gridY = Math.floor(tileIndex / layer.width);
                if (gridX > KEY_MAX || gridY > KEY_MAX) {
                    return fail(
                        TilemapAssetErrorCode.INVALID_TILEMAP,
                        'map dimensions exceed the signed 16-bit grid limits',
                        { gridX, gridY }
                    );
                }
                const chunkX = gridX >> chunkShift;
                const chunkY = gridY >> chunkShift;
                const key = packChunkKey(chunkX, chunkY);
                let entry = chunks.get(key);
                if (entry === undefined) {
                    entry = {
                        chunkX,
                        chunkY,
                        words: new Uint32Array(chunkArea * layerCount),
                    };
                    chunks.set(key, entry);
                }
                const localIndex =
                    (gridY & (chunkSize - 1)) * chunkSize +
                    (gridX & (chunkSize - 1));
                entry.words[layerIndex * chunkArea + localIndex] =
                    word.get() >>> 0;
            }
        }

        const mapKey =
            options.mapKey ??
            attribute(map, 'name') ??
            'tilemap';
        if (mapKey.trim().length === 0) {
            return fail(
                TilemapAssetErrorCode.INVALID_TILEMAP,
                'map key must be non-empty'
            );
        }

        const chunkEntries = [...chunks.values()]
            .filter((chunk) => chunk.words.some((word) => word !== 0))
            .sort(
                (left, right) =>
                    left.chunkY - right.chunkY || left.chunkX - right.chunkX
            );
        const importedChunks: TiledImportedChunk[] = [];
        const chunkReferences: {
            chunkX: number;
            chunkY: number;
            asset: string;
        }[] = [];
        for (const chunk of chunkEntries) {
            const snapshot: ChunkSnapshot = {
                key: asChunkKey(packChunkKey(chunk.chunkX, chunk.chunkY)),
                chunkShift,
                layerCount,
                words: chunk.words,
            };
            const valid = validateChunkSnapshot(snapshot);
            if (valid.isErr()) {
                return fail(
                    TilemapAssetErrorCode.INVALID_CHUNK_ASSET,
                    'imported chunk snapshot failed validation',
                    undefined,
                    valid.expectErr('chunk snapshot')
                );
            }
            const assetKey = tilemapChunkAssetKey(
                mapKey,
                chunk.chunkX,
                chunk.chunkY
            );
            importedChunks.push({ assetKey, snapshot });
            chunkReferences.push({
                chunkX: chunk.chunkX,
                chunkY: chunk.chunkY,
                asset: assetKey,
            });
        }

        const tilesetNames = new Map<string, number>();
        const tilesetsOut: TilesetDefinition[] = [];
        for (const entry of tilesets) {
            const baseName = entry.definition.name;
            const seen = tilesetNames.get(baseName) ?? 0;
            tilesetNames.set(baseName, seen + 1);
            tilesetsOut.push(
                seen === 0
                    ? entry.definition
                    : resetTilesetName(
                          entry.definition,
                          `${baseName}@${entry.firstGid}`
                      )
            );
        }

        const layerSpecs: LayerSpec[] = layers.map((layer, index) => ({
            name: layer.name,
            visible: layer.visible,
            collision: layer.collision,
            opacity: layer.opacity,
            zIndex: index,
        }));
        const tilemap = createTilemapAssetDefinition({
            formatVersion: 1,
            projection: projection.get(),
            chunkShift,
            tilesets: tilesetsOut.map((tileset) => tileset.name),
            layers: layerSpecs,
            chunks: chunkReferences,
        });
        if (tilemap.isErr()) {
            return err(tilemap.expectErr('tilemap definition'));
        }

        const collisionHints: TiledCollisionHint[] = [];
        collectCollisionHints(
            map,
            tileWidth.get(),
            tileHeight.get(),
            collisionHints
        );

        return ok({
            tilemap: tilemap.get(),
            tilesets: Object.freeze(tilesetsOut),
            chunks: Object.freeze(importedChunks),
            collisionHints: Object.freeze(collisionHints),
            diagnostics: Object.freeze(diagnostics),
        });
    } catch (cause) {
        return fail(
            TilemapAssetErrorCode.MALFORMED_SOURCE,
            'unexpected failure while importing the Tiled map',
            undefined,
            cause
        );
    }
};
