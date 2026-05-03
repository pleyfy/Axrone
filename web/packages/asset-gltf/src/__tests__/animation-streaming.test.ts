import { describe, expect, it } from 'vitest';
import { decodeAnimationClipStreamingChunkPayload } from '@axrone/animation';
import {
    createPortableAnimationManifestResource,
    createPortableAnimationStreamingClipBundle,
    DEFAULT_ANIMATION_STREAMING_CHUNK_MIME_TYPE,
} from '@axrone/asset-gltf';

describe('portable animation streaming authoring', () => {
    it('builds chunk resources and manifest-ready clip metadata from animation tracks', () => {
        const bundle = createPortableAnimationStreamingClipBundle({
            clip: {
                id: 'Move',
                duration: 2,
                tags: ['locomotion'],
                tracks: [
                    {
                        target: 'node/1',
                        path: 'translation',
                        interpolation: 'LINEAR',
                        times: new Float32Array([0, 0.5, 1, 1.5, 2]),
                        values: new Float32Array([
                            0, 0, 0,
                            0.5, 0, 0,
                            1, 0, 0,
                            1.5, 0, 0,
                            2, 0, 0,
                        ]),
                    },
                ],
                streaming: {
                    chunkDuration: 1,
                    preloadWindow: 0.5,
                    priority: 4,
                },
            },
            sourceUri: 'clips/move.bin',
        });

        expect(bundle.clip).toMatchObject({
            id: 'Move',
            tags: ['locomotion'],
            streaming: expect.objectContaining({
                mode: 'streamed',
                sourceUri: 'clips/move.bin',
                chunkDuration: 1,
                preloadWindow: 0.5,
                priority: 4,
                catalog: expect.objectContaining({
                    id: 'move-stream',
                    chunks: [
                        expect.objectContaining({
                            id: 'move-0',
                            uri: 'clips/move.0.bin',
                            startTime: 0,
                            endTime: 1,
                            mimeType: DEFAULT_ANIMATION_STREAMING_CHUNK_MIME_TYPE,
                        }),
                        expect.objectContaining({
                            id: 'move-1',
                            uri: 'clips/move.1.bin',
                            startTime: 1,
                            endTime: 2,
                            mimeType: DEFAULT_ANIMATION_STREAMING_CHUNK_MIME_TYPE,
                        }),
                    ],
                }),
            }),
        });
        expect(bundle.resources).toHaveLength(2);
        expect(bundle.resources[0]?.data).toBeInstanceOf(Uint8Array);
        expect(bundle.resources[1]?.data).toBeInstanceOf(Uint8Array);

        const firstPayload = decodeAnimationClipStreamingChunkPayload(bundle.resources[0]!.data as Uint8Array);
        const secondPayload = decodeAnimationClipStreamingChunkPayload(bundle.resources[1]!.data as Uint8Array);

        expect(firstPayload).toMatchObject({
            version: 1,
            clipId: 'Move',
            startTime: 0,
            endTime: 1,
            duration: 2,
        });
        expect(Array.from(firstPayload.tracks[0]!.times)).toEqual([0, 0.5, 1, 1.5]);
        expect(Array.from(secondPayload.tracks[0]!.times)).toEqual([0.5, 1, 1.5, 2]);

        const manifestResource = createPortableAnimationManifestResource('rig.animation-manifest.json', {
            clips: [bundle.clip],
        });

        expect(manifestResource.mimeType).toBe('application/json');
        expect(JSON.parse(manifestResource.data as string)).toMatchObject({
            clips: [
                {
                    id: 'Move',
                    streaming: expect.objectContaining({
                        catalog: expect.objectContaining({
                            chunks: [
                                expect.objectContaining({
                                    uri: 'clips/move.0.bin',
                                }),
                                expect.objectContaining({
                                    uri: 'clips/move.1.bin',
                                }),
                            ],
                        }),
                    }),
                },
            ],
        });
    });
});