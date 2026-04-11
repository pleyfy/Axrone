import { describe, expect, it } from 'vitest';
import { AssetDatabase, type AssetImporter } from '@axrone/asset-core';

interface SourceIdentityAssetSchema {
    readonly text: string;
}

const textImporter: AssetImporter<
    SourceIdentityAssetSchema,
    { kind: 'text'; data: string; uri?: string; sourceIdentity?: string },
    'text'
> = {
    id: 'test.text',
    sourceKinds: ['text'],
    import: ({ source }) => ({
        primary: {
            kind: 'text',
            data: source.data,
        },
    }),
};

describe('Asset source identity', () => {
    it('keeps the same asset alive when the source moves to a new key', async () => {
        const database = new AssetDatabase<SourceIdentityAssetSchema>({
            importers: [textImporter],
        });

        const first = await database.import({
            kind: 'text',
            data: 'v1',
            uri: 'copy/title.txt',
            sourceIdentity: 'copy:title:main',
        });
        const second = await database.import({
            kind: 'text',
            data: 'v2',
            uri: 'copy/ui/title-renamed.txt',
            sourceIdentity: 'copy:title:main',
        });

        expect(second.primary.id).toBe(first.primary.id);
        expect(String(second.primary.key)).toBe('copy/ui/title-renamed.txt');
        expect(database.get('copy/title.txt')?.id).toBe(first.primary.id);
        expect(database.resolveSourceIdentity('copy:title:main')?.id).toBe(first.primary.id);
        expect(database.listSourceBindings()).toEqual([
            {
                sourceIdentity: 'copy:title:main',
                assetId: first.primary.id,
                updatedAtEpochMs: second.importedAtEpochMs,
            },
        ]);
    });

    it('uses source identity as a stable fallback when there is no path-like key', async () => {
        const database = new AssetDatabase<SourceIdentityAssetSchema>({
            importers: [textImporter],
        });

        const first = await database.import({
            kind: 'text',
            data: 'hello',
            sourceIdentity: 'generated:welcome-copy',
        });
        const second = await database.import({
            kind: 'text',
            data: 'hello-again',
            sourceIdentity: 'generated:welcome-copy',
        });

        expect(second.primary.id).toBe(first.primary.id);
        expect(String(second.primary.key)).toBe(String(first.primary.key));
        expect(String(first.primary.key)).toContain(
            'asset://text/identity/generated%3Awelcome-copy'
        );
    });

    it('restores source identity bindings from snapshots and drops them on delete', async () => {
        const database = new AssetDatabase<SourceIdentityAssetSchema>({
            importers: [textImporter],
        });

        const receipt = await database.import({
            kind: 'text',
            data: 'snapshot',
            uri: 'copy/snapshot.txt',
            sourceIdentity: 'copy:snapshot',
        });

        const snapshot = database.snapshot();
        expect(snapshot.version).toBe(4);
        expect(snapshot.sourceBindings).toEqual([
            {
                sourceIdentity: 'copy:snapshot',
                assetId: receipt.primary.id,
                updatedAtEpochMs: receipt.importedAtEpochMs,
            },
        ]);

        const restored = new AssetDatabase<SourceIdentityAssetSchema>();
        restored.hydrate(snapshot);

        expect(restored.resolveSourceIdentity('copy:snapshot')?.id).toBe(receipt.primary.id);
        expect(restored.delete(receipt.primary.reference)).toBe(true);
        expect(restored.resolveSourceIdentity('copy:snapshot')).toBeUndefined();
        expect(restored.listSourceBindings()).toEqual([]);
    });
});
