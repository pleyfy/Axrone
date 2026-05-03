import { describe, expect, it } from 'vitest';
import {
    createSpriteAtlas,
    serializeSpriteAtlasDefinition,
} from '../sprite-atlas';

describe('createSpriteAtlas', () => {
    it('normalizes regions into uv space and resolves animation clips', () => {
        const atlas = createSpriteAtlas({
            id: 'atlas/ui',
            textureId: 'ui-atlas',
            textureSize: { width: 128, height: 64 },
            frames: [
                {
                    id: 'idle/0',
                    region: { x: 0, y: 0, width: 32, height: 16 },
                    sourceSize: { width: 32, height: 16 },
                    sliceBorder: { left: 4, right: 4, top: 4, bottom: 4 },
                },
                {
                    id: 'idle/1',
                    region: { x: 32, y: 0, width: 32, height: 16 },
                    durationMs: 40,
                },
            ],
            animations: [
                {
                    id: 'idle',
                    fps: 10,
                    frames: ['idle/0', { frameId: 'idle/1', durationMs: 80 }],
                },
            ],
        });

        const firstFrame = atlas.getFrame('idle/0');
        const clip = atlas.getAnimation('idle');

        expect(firstFrame?.textureId).toBe('ui-atlas');
        expect(firstFrame?.uvRect.x).toBe(0);
        expect(firstFrame?.uvRect.y).toBe(0);
        expect(firstFrame?.uvRect.width).toBe(0.25);
        expect(firstFrame?.uvRect.height).toBe(0.25);
        expect(firstFrame?.sliceBorder?.left).toBe(4);

        expect(clip?.frames).toHaveLength(2);
        expect(clip?.frames[0]?.durationMs).toBe(100);
        expect(clip?.frames[1]?.durationMs).toBe(80);
        expect(clip?.durationMs).toBe(180);
        expect(clip?.loop).toBe(true);
    });

    it('rejects duplicate frame ids', () => {
        expect(() =>
            createSpriteAtlas({
                id: 'atlas/dup',
                textureId: 'dup',
                textureSize: { width: 64, height: 64 },
                frames: [
                    { id: 'frame', region: { x: 0, y: 0, width: 16, height: 16 } },
                    { id: 'frame', region: { x: 16, y: 0, width: 16, height: 16 } },
                ],
            })
        ).toThrow(/Duplicate sprite atlas frame id/);
    });

    it('round-trips atlas definitions through serialization', () => {
        const atlas = createSpriteAtlas({
            id: 'atlas/panel',
            textureId: 'panel-texture',
            textureSize: { width: 36, height: 18 },
            frames: [
                {
                    id: 'panel/default',
                    region: { x: 0, y: 0, width: 18, height: 18 },
                    sourceSize: { width: 18, height: 18 },
                    sliceBorder: { left: 6, right: 6, top: 6, bottom: 6 },
                },
            ],
            animations: [
                {
                    id: 'pulse',
                    loop: false,
                    frames: [{ frameId: 'panel/default', durationMs: 120 }],
                },
            ],
        });

        const cloned = createSpriteAtlas(serializeSpriteAtlasDefinition(atlas));

        expect(cloned.textureId).toBe('panel-texture');
        expect(cloned.frames[0]?.sliceBorder).toEqual({
            left: 6,
            right: 6,
            top: 6,
            bottom: 6,
        });
        expect(cloned.animations[0]?.frames[0]?.durationMs).toBe(120);
    });
});