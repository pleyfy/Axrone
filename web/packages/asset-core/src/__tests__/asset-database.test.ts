import { describe, expect, it } from 'vitest';
import { AssetDatabase, type AssetImporter } from '@axrone/asset-core';

interface TestAssetSchema {
    readonly text: string;
    readonly bundle: {
        readonly entry: string;
    };
    readonly json: {
        readonly message: string;
    };
}

const textImporter: AssetImporter<TestAssetSchema, { kind: 'text'; data: string; uri?: string }, 'text'> = {
    id: 'test.text',
    sourceKinds: ['text'],
    extensions: ['txt'],
    import: ({ source }) => ({
        primary: {
            kind: 'text',
            data: source.data,
        },
    }),
};

const bundleImporter: AssetImporter<
    TestAssetSchema,
    { kind: 'json'; data: { text: string }; uri?: string },
    'bundle'
> = {
    id: 'test.bundle',
    sourceKinds: ['json'],
    import: ({ source }) => ({
        primary: {
            kind: 'bundle',
            data: {
                entry: 'text',
            },
            dependencies: [{ key: '#text', kind: 'text' }],
        },
        additional: [
            {
                kind: 'text',
                stableKey: '#text',
                data: source.data.text,
            },
        ],
    }),
};

describe('AssetDatabase', () => {
    it('keeps stable asset ids across reimport for the same stable key', async () => {
        const database = new AssetDatabase<TestAssetSchema>({
            importers: [textImporter],
        });

        const first = await database.import({
            kind: 'text',
            data: 'hello',
            uri: 'assets/hello.txt',
        });
        const firstRevisionReference = first.primary.versionedReference;
        const second = await database.import({
            kind: 'text',
            data: 'hello-again',
            uri: 'assets/hello.txt',
        });

        expect(second.primary.id).toBe(first.primary.id);
        expect(second.primary.revision).toBe(first.primary.revision + 1);
        expect(database.get(first.primary.reference)?.data).toBe('hello-again');
        expect(database.get(firstRevisionReference)?.data).toBe('hello');
        expect(database.get(second.primary.versionedReference)?.data).toBe('hello-again');
    });

    it('resolves aliases after moving an asset to a new canonical key', () => {
        const database = new AssetDatabase<TestAssetSchema>();

        const first = database.upsert({
            kind: 'text',
            stableKey: 'assets/original.txt',
            data: 'a',
        });
        const second = database.upsert({
            id: first.id,
            kind: 'text',
            stableKey: 'assets/renamed.txt',
            data: 'b',
        });

        expect(second.id).toBe(first.id);
        expect(database.get('assets/original.txt')?.id).toBe(first.id);
        expect(database.get('assets/renamed.txt')?.id).toBe(first.id);
        expect(database.get(first.reference)?.data).toBe('b');
    });

    it('imports sub-assets with relative keys and restores snapshots', async () => {
        const database = new AssetDatabase<TestAssetSchema>({
            importers: [bundleImporter],
        });

        const receipt = await database.import({
            kind: 'json',
            data: {
                text: 'from-bundle',
            },
            uri: 'packs/test.bundle.json',
        });

        const [dependency] = database.getDependencies(receipt.primary.reference);
        expect(dependency?.data).toBe('from-bundle');

        const snapshot = database.snapshot();
        const restored = new AssetDatabase<TestAssetSchema>();
        restored.hydrate(snapshot);

        expect(restored.get(receipt.primary.reference)?.data).toEqual({
            entry: 'text',
        });
        expect(restored.get(dependency!.reference)?.data).toBe('from-bundle');
    });

    it('preserves historical revisions across snapshot hydration', async () => {
        const database = new AssetDatabase<TestAssetSchema>({
            importers: [textImporter],
        });

        const first = await database.import({
            kind: 'text',
            data: 'v1',
            uri: 'assets/history.txt',
        });
        const second = await database.import({
            kind: 'text',
            data: 'v2',
            uri: 'assets/history.txt',
        });

        const snapshot = database.snapshot();
        expect(snapshot.version).toBe(4);
        expect(snapshot.assets[0]?.history?.length).toBe(1);

        const restored = new AssetDatabase<TestAssetSchema>();
        restored.hydrate(snapshot);

        expect(restored.get(first.primary.versionedReference)?.data).toBe('v1');
        expect(restored.get(second.primary.versionedReference)?.data).toBe('v2');
        expect(restored.get(first.primary.reference)?.data).toBe('v2');
    });
});
