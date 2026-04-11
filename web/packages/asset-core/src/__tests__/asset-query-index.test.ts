import { describe, expect, it } from 'vitest';
import { AssetDatabase } from '@axrone/asset-core';

interface QueryAssetSchema {
    readonly text: string;
}

describe('Asset metadata indexes', () => {
    it('finds assets through fingerprint and metadata filters', () => {
        const database = new AssetDatabase<QueryAssetSchema>();

        const uiCopy = database.upsert({
            kind: 'text',
            stableKey: 'copy/ui/title.txt',
            data: 'Hello',
            metadata: {
                uri: 'texts/ui/title.txt',
                mimeType: 'text/plain',
                locale: 'en-US',
                tags: ['ui', 'hero'],
                properties: {
                    group: 'ui',
                    slot: 'hero',
                },
            },
        });
        const legalCopy = database.upsert({
            kind: 'text',
            stableKey: 'copy/legal/terms.txt',
            data: 'Terms',
            metadata: {
                uri: 'texts/legal/terms.txt',
                mimeType: 'text/plain',
                locale: 'tr-TR',
                tags: ['legal'],
                properties: {
                    group: 'legal',
                },
            },
        });

        expect(database.find({ uri: 'texts/ui/title.txt' }).map((asset) => asset.id)).toEqual([
            uiCopy.id,
        ]);
        expect(
            database
                .find({
                    mimeType: 'text/plain',
                    tags: ['ui', 'hero'],
                    properties: {
                        group: 'ui',
                        slot: 'hero',
                    },
                })
                .map((asset) => asset.id)
        ).toEqual([uiCopy.id]);
        expect(database.find({ locale: 'tr-TR' }).map((asset) => asset.id)).toEqual([
            legalCopy.id,
        ]);
        expect(database.find({ fingerprint: uiCopy.fingerprint }).map((asset) => asset.id)).toEqual(
            [uiCopy.id]
        );
    });

    it('drops stale index entries when asset metadata changes', () => {
        const database = new AssetDatabase<QueryAssetSchema>();

        const first = database.upsert({
            kind: 'text',
            stableKey: 'copy/landing.txt',
            data: 'Landing',
            metadata: {
                uri: 'texts/landing.txt',
                mimeType: 'text/plain',
                locale: 'en-US',
                tags: ['landing'],
                properties: {
                    group: 'landing',
                },
            },
        });

        const updated = database.upsert({
            id: first.id,
            kind: 'text',
            stableKey: 'copy/landing.txt',
            data: 'Campaign',
            metadata: {
                uri: 'texts/campaign.txt',
                mimeType: 'text/markdown',
                locale: 'en-US',
                tags: ['campaign'],
                properties: {
                    group: 'campaign',
                },
            },
        });

        expect(database.find({ uri: 'texts/landing.txt' })).toHaveLength(0);
        expect(database.find({ tags: ['landing'] })).toHaveLength(0);
        expect(
            database.find({
                properties: {
                    group: 'landing',
                },
            })
        ).toHaveLength(0);
        expect(database.find({ fingerprint: first.fingerprint })).toHaveLength(0);
        expect(
            database
                .find({
                    uri: 'texts/campaign.txt',
                    mimeType: 'text/markdown',
                    tags: ['campaign'],
                    properties: {
                        group: 'campaign',
                    },
                })
                .map((asset) => asset.id)
        ).toEqual([updated.id]);
        expect(database.find({ fingerprint: updated.fingerprint }).map((asset) => asset.id)).toEqual(
            [updated.id]
        );
    });
});
