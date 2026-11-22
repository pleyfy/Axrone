import { err, ok, type Result } from '@axrone/utility';
import {
    TilemapAssetErrorCode,
    tilemapAssetError,
    type TilemapAssetError,
} from '../errors';
import { createTilesetDefinition, type TilesetDefinition } from '../tileset';
import {
    attribute,
    childElements,
    firstChild,
    integerAttribute,
    parseXml,
    requiredAttribute,
    type XmlElement,
} from './tmx-parser';

const malformed = (
    message: string,
    details?: Readonly<Record<string, unknown>>
): Result<never, TilemapAssetError> =>
    err(
        tilemapAssetError(TilemapAssetErrorCode.MALFORMED_SOURCE, message, {
            details,
        })
    );

const propertyMap = (
    element: XmlElement | undefined
): Map<string, string> => {
    const values = new Map<string, string>();
    const properties = element === undefined ? undefined : firstChild(element, 'properties');
    if (properties === undefined) return values;
    for (const property of childElements(properties, 'property')) {
        const name = attribute(property, 'name');
        const value = attribute(property, 'value');
        if (name !== undefined && value !== undefined) values.set(name, value);
    }
    return values;
};

const readIntegerProperty = (
    properties: Map<string, string>,
    name: string
): number | undefined => {
    const value = properties.get(name);
    if (value === undefined) return undefined;
    if (value === 'true') return 1;
    if (value === 'false') return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
};

const tilesOf = (
    tileset: XmlElement,
    tileCount: number
): readonly import('@axrone/tilemap').TileDefinition[] => {
    const tiles: import('@axrone/tilemap').TileDefinition[] = [];
    for (const tile of childElements(tileset, 'tile')) {
        const idPath = integerAttribute(tile, 'id');
        if (idPath.isErr()) continue;
        const id = idPath.get();
        if (id < 0 || id >= tileCount) continue;
        const properties = propertyMap(tile);
        const animationElement = firstChild(tile, 'animation');
        const animation =
            animationElement === undefined
                ? undefined
                : childElements(animationElement, 'frame')
                      .map((frame) => {
                          const tileId = integerAttribute(frame, 'tileid');
                          const duration = integerAttribute(frame, 'duration');
                          if (tileId.isErr() || duration.isErr()) return null;
                          return {
                              tileId: tileId.get(),
                              durationMs: duration.get(),
                          };
                      })
                      .filter(
                          (
                              frame
                          ): frame is { tileId: number; durationMs: number } =>
                              frame !== null
                      );
        const definition: import('@axrone/tilemap').TileDefinition = {
            id,
            name:
                attribute(tile, 'name') ??
                attribute(tile, 'class') ??
                `tile-${id}`,
            collision: readIntegerProperty(properties, 'collision'),
            material: readIntegerProperty(properties, 'material'),
            animation:
                animation === undefined || animation.length === 0
                    ? undefined
                    : animation,
            autotileGroup: properties.get('autotileGroup'),
        };
        tiles.push(definition);
    }
    return tiles;
};

/**
 * Parses a TSX tileset (also used for inline `<tileset>` elements) into the
 * versioned `TilesetDefinition`.
 */
export const parseTsxTileset = (
    xml: string,
    options: { readonly firstGid?: number; readonly fallbackName?: string } = {}
): Result<TilesetDefinition, TilemapAssetError> => {
    const parsed = parseXml(xml);
    if (parsed.isErr()) return err(parsed.expectErr('parse tsx'));
    return parseTsxElement(parsed.get(), options);
};

/** Builds a tileset definition from an already parsed `<tileset>` element. */
export const parseTsxElement = (
    root: XmlElement,
    options: { readonly firstGid?: number; readonly fallbackName?: string } = {}
): Result<TilesetDefinition, TilemapAssetError> => {
    if (root.name !== 'tileset') {
        return malformed(`expected <tileset> root, got <${root.name}>`);
    }

    const image = firstChild(root, 'image');
    if (image === undefined) {
        return malformed('tileset is missing an <image> element');
    }
    const imageSource = requiredAttribute(image, 'source');
    const imageWidth = integerAttribute(image, 'width');
    const imageHeight = integerAttribute(image, 'height');
    const tileWidth = integerAttribute(root, 'tilewidth');
    const tileHeight = integerAttribute(root, 'tileheight');
    const columns = integerAttribute(root, 'columns');
    const tileCount = integerAttribute(root, 'tilecount');
    for (const result of [
        imageSource,
        imageWidth,
        imageHeight,
        tileWidth,
        tileHeight,
        columns,
        tileCount,
    ]) {
        if (result.isErr()) return err(result.expectErr('tileset attribute'));
    }

    const name =
        attribute(root, 'name') ??
        options.fallbackName ??
        `tileset-${options.firstGid ?? 1}`;

    const margin = integerAttribute(root, 'margin', 0);
    const spacing = integerAttribute(root, 'spacing', 0);
    if (margin.isErr()) return err(margin.expectErr('margin'));
    if (spacing.isErr()) return err(spacing.expectErr('spacing'));

    const definition = createTilesetDefinition({
        formatVersion: 1,
        name,
        image: imageSource.get(),
        tileWidth: tileWidth.get(),
        tileHeight: tileHeight.get(),
        margin: margin.get(),
        spacing: spacing.get(),
        columns: columns.get(),
        tileCount: tileCount.get(),
        imageWidth: imageWidth.get(),
        imageHeight: imageHeight.get(),
        tiles: tilesOf(root, tileCount.get()),
    });
    if (definition.isErr()) {
        return err(
            tilemapAssetError(
                TilemapAssetErrorCode.INVALID_TILESET,
                `invalid TSX tileset ${name}`,
                { cause: definition.expectErr('tsx tileset') }
            )
        );
    }
    return ok(definition.get());
};

export interface TiledTilesetEntry {
    readonly firstGid: number;
    readonly definition: TilesetDefinition;
}
