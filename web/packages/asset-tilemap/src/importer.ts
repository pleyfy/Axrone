import {
    AssetImportPipeline,
    type AssetImportPipelineOptions,
    type AssetImportResult,
    type AssetImportSource,
    type AssetImporter,
} from '@axrone/asset-core';
import type { AssetTilemapSchema } from './index';
import { createTilemapAssetDefinition } from './tilemap-asset';
import {
    importTiledMap,
    type TiledImportOptions,
} from './tiled/tiled-importer';

export type AssetTilemapImportResult = AssetImportResult<
    AssetTilemapSchema,
    'tilemap'
>;

const basenameWithoutExtension = (value: string): string => {
    const leaf = value.split(/[\\/]/).pop() ?? value;
    return leaf.replace(/\.[^.]+$/, '') || value;
};

const nativePayload = (source: AssetImportSource): unknown => {
    if (source.kind === 'json') return source.data;
    if (source.kind === 'text') {
        return JSON.parse(source.data) as unknown;
    }
    if (source.kind === 'custom') return source.data;
    throw new Error(`unsupported native tilemap source: ${source.kind}`);
};

/**
 * Imports the native `TilemapAssetDefinition` JSON/text source. Chunk words
 * live in separate chunk assets, so the primary asset is the map definition.
 */
export const createNativeTilemapImporter =
    (): AssetImporter<AssetTilemapSchema, AssetImportSource> => ({
        id: 'axrone.tilemap.native',
        sourceKinds: ['json', 'text', 'custom'],
        extensions: ['tilemap.json'],
        canImport(context) {
            if (context.source.kind === 'custom') {
                return context.source.format === 'axrone-tilemap';
            }
            return true;
        },
        import(context): AssetImportResult<AssetTilemapSchema> {
            const data = nativePayload(context.source);
            const definition = createTilemapAssetDefinition(data);
            if (definition.isErr()) {
                const error = definition.expectErr('native tilemap');
                throw new Error(`${error.code}: ${error.message}`);
            }
            const tilemap = definition.get();
            return {
                primary: {
                    kind: 'tilemap',
                    data: tilemap,
                    name: context.source.name ?? String(context.baseKey),
                    stableKey: String(context.baseKey),
                    metadata: context.source.uri
                        ? {
                              uri: context.source.uri,
                              mimeType: context.source.mimeType,
                          }
                        : undefined,
                },
            };
        },
    });

export interface TiledTilemapImporterOptions extends TiledImportOptions {
    /** Overrides the map key used for chunk asset keys. */
    readonly mapKey?: string;
}

/**
 * Imports a Tiled TMX text source through `importTiledMap` and registers the
 * tileset definitions and chunk snapshots as additional asset writes.
 */
export const createTiledTilemapImporter = (
    options: TiledTilemapImporterOptions = {}
): AssetImporter<AssetTilemapSchema, AssetImportSource> => ({
    id: 'axrone.tilemap.tiled',
    priority: 10,
    sourceKinds: ['text'],
    extensions: ['tmx'],
    mimeTypes: ['application/x-tmx+xml', 'text/xml', 'application/xml'],
    async import(context): Promise<AssetImportResult<AssetTilemapSchema>> {
        if (context.source.kind !== 'text') {
            throw new Error('Tiled import requires a text source');
        }
        const mapKey =
            options.mapKey ??
            (context.source.name ??
                (context.source.uri
                    ? basenameWithoutExtension(context.source.uri)
                    : String(context.baseKey)));
        const imported = await importTiledMap(context.source.data, {
            ...options,
            mapKey,
        });
        if (imported.isErr()) {
            const error = imported.expectErr('tiled map');
            throw new Error(`${error.code}: ${error.message}`);
        }
        const result = imported.get();
        return {
            primary: {
                kind: 'tilemap',
                data: result.tilemap,
                name: mapKey,
                stableKey: String(context.baseKey),
                metadata: context.source.uri
                    ? {
                          uri: context.source.uri,
                          mimeType: context.source.mimeType,
                      }
                    : undefined,
            },
            additional: [
                ...result.tilesets.map((tileset) => ({
                    kind: 'tileset' as const,
                    data: tileset,
                    name: tileset.name,
                    stableKey: `tileset:${tileset.name}`,
                })),
                ...result.chunks.map((chunk) => ({
                    kind: 'tilemap-chunk' as const,
                    data: chunk.snapshot,
                    name: chunk.assetKey,
                    stableKey: chunk.assetKey,
                })),
            ],
            diagnostics: result.diagnostics,
        };
    },
});

export interface AssetTilemapImportPipelineOptions
    extends Omit<AssetImportPipelineOptions<AssetTilemapSchema>, 'importers'> {
    readonly importers?: readonly AssetImporter<AssetTilemapSchema>[];
    readonly tiled?: TiledTilemapImporterOptions;
}

/** Opt-in import pipeline; does not extend `createAsset2DImportPipeline`. */
export const createAssetTilemapImportPipeline = (
    options: AssetTilemapImportPipelineOptions = {}
): AssetImportPipeline<AssetTilemapSchema> =>
    new AssetImportPipeline<AssetTilemapSchema>({
        ...options,
        importers: [
            createTiledTilemapImporter(options.tiled),
            createNativeTilemapImporter(),
            ...(options.importers ?? []),
        ],
    });
