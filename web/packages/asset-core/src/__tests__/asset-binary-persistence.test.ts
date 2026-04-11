import { describe, expect, it } from 'vitest';
import {
    AssetDatabase,
    type AssetBinaryCodec,
    type AssetBinaryStore,
    type AssetBinaryStoreReadRequest,
    type AssetBinaryStoreWriteRequest,
} from '@axrone/asset-core';

interface BinaryAssetSchema {
    readonly bytes: Uint8Array;
    readonly image: {
        readonly width: number;
        readonly height: number;
        readonly pixels: Uint8Array;
    };
}

class MemoryBinaryStore implements AssetBinaryStore {
    private readonly _entries = new Map<string, Uint8Array>();

    write(request: Readonly<AssetBinaryStoreWriteRequest>): string {
        const storageKey = `${request.id}@${request.revision}`;
        this._entries.set(storageKey, new Uint8Array(request.bytes));
        return storageKey;
    }

    read(request: Readonly<AssetBinaryStoreReadRequest>): Uint8Array {
        const bytes = this._entries.get(request.reference.storageKey);
        if (!bytes) {
            throw new Error(`Missing payload for ${request.reference.storageKey}`);
        }

        return new Uint8Array(bytes);
    }

    peek(storageKey: string): Uint8Array | undefined {
        const bytes = this._entries.get(storageKey);
        return bytes ? new Uint8Array(bytes) : undefined;
    }
}

const imageCodec: AssetBinaryCodec<BinaryAssetSchema['image']> = {
    format: 'binary',
    serialize: (data) => {
        const bytes = new Uint8Array(2 + data.pixels.length);
        bytes[0] = data.width;
        bytes[1] = data.height;
        bytes.set(data.pixels, 2);
        return bytes;
    },
    deserialize: (bytes) => ({
        width: bytes[0] ?? 0,
        height: bytes[1] ?? 0,
        pixels: bytes.slice(2),
    }),
};

describe('Asset binary persistence', () => {
    it('serializes raw byte assets inline and restores them', () => {
        const database = new AssetDatabase<BinaryAssetSchema>();

        const created = database.upsert({
            kind: 'bytes',
            stableKey: 'assets/payload.bin',
            data: new Uint8Array([1, 2, 3, 4]),
        });

        const snapshot = database.snapshot();

        expect(snapshot.version).toBe(4);
        expect(snapshot.assets[0]?.data).toEqual({
            __asset: 'axrone.binary',
            storage: 'inline',
            encoding: 'base64',
            data: 'AQIDBA==',
            byteLength: 4,
        });

        const restored = new AssetDatabase<BinaryAssetSchema>();
        restored.hydrate(snapshot);

        expect(Array.from(restored.get(created.reference)?.data ?? [])).toEqual([1, 2, 3, 4]);
    });

    it('stores codec-backed binary payloads externally and restores them', () => {
        const store = new MemoryBinaryStore();
        const database = new AssetDatabase<BinaryAssetSchema>({
            codecs: {
                image: imageCodec,
            },
            binary: {
                mode: 'external',
                store,
            },
        });

        const created = database.upsert({
            kind: 'image',
            stableKey: 'assets/image.bin',
            data: {
                width: 2,
                height: 2,
                pixels: new Uint8Array([10, 20, 30, 40]),
            },
        });

        const snapshot = database.snapshot();
        const storedData = snapshot.assets[0]?.data;

        expect(storedData).toEqual({
            __asset: 'axrone.binary',
            storage: 'external',
            storageKey: `${created.id}@${created.revision}`,
            byteLength: 6,
        });
        expect(Array.from(store.peek(`${created.id}@${created.revision}`) ?? [])).toEqual([
            2,
            2,
            10,
            20,
            30,
            40,
        ]);

        const restored = new AssetDatabase<BinaryAssetSchema>({
            codecs: {
                image: imageCodec,
            },
            binary: {
                mode: 'external',
                store,
            },
        });
        restored.hydrate(snapshot);

        const restoredImage = restored.get(created.reference)?.data;
        expect(restoredImage?.width).toBe(2);
        expect(restoredImage?.height).toBe(2);
        expect(Array.from(restoredImage?.pixels ?? [])).toEqual([10, 20, 30, 40]);
    });
});
