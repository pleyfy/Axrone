import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '../../asset';

interface CleanupAssetSchema {
    readonly text: string;
}

describe('Asset cleanup transactions', () => {
    it('keeps the previous asset when replacement disposal fails', () => {
        const database = new AssetDatabase<CleanupAssetSchema>();

        const first = database.upsert({
            kind: 'text',
            stableKey: 'assets/replacement.txt',
            data: 'before',
            disposer: () => {
                throw new Error('replacement cleanup failed');
            },
        });

        expect(() =>
            database.upsert({
                id: first.id,
                kind: 'text',
                stableKey: 'assets/replacement.txt',
                data: 'after',
            })
        ).toThrow('replacement cleanup failed');

        const current = database.get(first.reference);
        expect(current?.data).toBe('before');
        expect(current?.revision).toBe(first.revision);
    });

    it('keeps the asset accessible when delete disposal fails', () => {
        const database = new AssetDatabase<CleanupAssetSchema>();

        const created = database.upsert({
            kind: 'text',
            stableKey: 'assets/delete.txt',
            data: 'value',
            disposer: () => {
                throw new Error('delete cleanup failed');
            },
        });

        expect(() => database.delete(created.reference)).toThrow('delete cleanup failed');
        expect(database.get(created.reference)?.data).toBe('value');
        expect(database.has(created.reference)).toBe(true);
    });
});
