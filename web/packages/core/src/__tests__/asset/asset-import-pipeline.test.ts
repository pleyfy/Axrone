import { describe, expect, it } from 'vitest';
import {
    AssetDatabase,
    type AssetImporter,
    type AssetImportSource,
    type AssetImportStage,
} from '../../asset';

interface PipelineAssetSchema {
    readonly text: string;
    readonly json: {
        readonly message: string;
    };
}

type TextSource = Extract<AssetImportSource, { readonly kind: 'text' }>;
type JsonSource = Extract<AssetImportSource, { readonly kind: 'json' }>;

const assertJsonMessage = (value: unknown): asserts value is PipelineAssetSchema['json'] => {
    if (
        value === null ||
        typeof value !== 'object' ||
        typeof (value as { readonly message?: unknown }).message !== 'string'
    ) {
        throw new Error('Invalid JSON test payload');
    }
};

describe('AssetImportPipeline', () => {
    it('runs source stages before selecting the importer', async () => {
        const jsonImporter: AssetImporter<PipelineAssetSchema, JsonSource, 'json'> = {
            id: 'test.json',
            sourceKinds: ['json'],
            extensions: ['json'],
            import: ({ source }) => {
                assertJsonMessage(source.data);

                return {
                    primary: {
                        kind: 'json',
                        data: source.data,
                    },
                };
            },
        };

        const parseJsonStage: AssetImportStage<PipelineAssetSchema, TextSource, 'json'> = {
            id: 'stage.parse-json',
            phases: ['source'],
            sourceKinds: ['text'],
            run: ({ source }) => {
                const parsed = JSON.parse(source.data) as unknown;
                assertJsonMessage(parsed);

                return {
                    source: {
                        kind: 'json',
                        data: parsed,
                        uri: 'assets/message.json',
                        mimeType: 'application/json',
                    },
                    diagnostics: [
                        {
                            level: 'info',
                            code: 'stage.source',
                            message: 'source normalized',
                        },
                    ],
                };
            },
        };

        const database = new AssetDatabase<PipelineAssetSchema>({
            importers: [jsonImporter],
            stages: [parseJsonStage],
        });

        expect(database.listStages().map((stage) => stage.id)).toEqual(['stage.parse-json']);

        const receipt = await database.import({
            kind: 'text',
            data: '{"message":"hello"}',
            uri: 'assets/message.txt',
            mimeType: 'text/plain',
        });

        expect(receipt.importerId).toBe('test.json');
        expect(receipt.primary.kind).toBe('json');
        expect(receipt.primary.data).toEqual({
            message: 'hello',
        });
        expect(receipt.diagnostics.map((diagnostic) => diagnostic.code)).toContain('stage.source');
    });

    it('supports short-circuit stages before import and result transforms after import', async () => {
        let importerCalls = 0;

        const textImporter: AssetImporter<PipelineAssetSchema, TextSource, 'text'> = {
            id: 'test.text',
            sourceKinds: ['text'],
            import: ({ source }) => {
                importerCalls += 1;

                return {
                    primary: {
                        kind: 'text',
                        data: source.data,
                    },
                };
            },
        };

        const shortCircuitStage: AssetImportStage<PipelineAssetSchema, TextSource, 'text'> = {
            id: 'stage.short-circuit',
            phases: ['before-import'],
            sourceKinds: ['text'],
            run: () => ({
                result: {
                    primary: {
                        kind: 'text',
                        data: 'bypassed',
                    },
                    diagnostics: [
                        {
                            level: 'info',
                            code: 'result.before',
                            message: 'before stage produced the result',
                        },
                    ],
                },
                diagnostics: [
                    {
                        level: 'info',
                        code: 'stage.before',
                        message: 'before import',
                    },
                ],
            }),
        };

        const decorateResultStage: AssetImportStage<PipelineAssetSchema, TextSource, 'text'> = {
            id: 'stage.decorate-result',
            phases: ['after-import'],
            sourceKinds: ['text'],
            run: ({ result }) => ({
                result: {
                    ...result,
                    primary: {
                        ...result.primary,
                        data: `${result.primary.data}-after`,
                    },
                },
                diagnostics: [
                    {
                        level: 'info',
                        code: 'stage.after',
                        message: 'after import',
                    },
                ],
            }),
        };

        const database = new AssetDatabase<PipelineAssetSchema>({
            importers: [textImporter],
        });

        database.registerStage(shortCircuitStage);
        database.registerStage(decorateResultStage);

        expect(database.listStages().map((stage) => stage.id)).toEqual([
            'stage.decorate-result',
            'stage.short-circuit',
        ]);

        const receipt = await database.import({
            kind: 'text',
            data: 'original',
            uri: 'assets/original.txt',
        });

        expect(importerCalls).toBe(0);
        expect(receipt.primary.kind).toBe('text');
        expect(receipt.primary.data).toBe('bypassed-after');
        expect(receipt.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
            expect.arrayContaining(['result.before', 'stage.before', 'stage.after'])
        );
    });
});
