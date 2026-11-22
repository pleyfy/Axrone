import type { SpriteAtlasFrame } from '@axrone/asset-2d';
import { describe, expect, it } from 'vitest';
import { SpriteRenderer } from '../components/sprite-renderer';

const frame: SpriteAtlasFrame = {
    id: 'hero/run-0',
    textureId: 'hero-atlas',
    region: { x: 0, y: 0, width: 16, height: 16 },
    sourceSize: { width: 4, height: 4 },
    uvRect: { x: 0.25, y: 0, width: 0.5, height: 1 },
    pivot: { x: 0.5, y: 0.25 },
    sliceBorder: null,
    durationMs: 100,
};

const expectBump = (mutate: (renderer: SpriteRenderer) => void): void => {
    const renderer = new SpriteRenderer({ textureId: 'hero', size: [2, 2] });
    const before = renderer.revision;

    mutate(renderer);

    expect(renderer.revision).toBeGreaterThan(before);
};

describe('SpriteRenderer revision', () => {
    it('increments for every render-relevant property setter', () => {
        expectBump((renderer) => {
            renderer.textureId = 'other-texture';
        });
        expectBump((renderer) => {
            renderer.materialId = 'mat';
        });
        expectBump((renderer) => {
            renderer.visible = false;
        });
        expectBump((renderer) => {
            renderer.renderOrder = 3;
        });
        expectBump((renderer) => {
            renderer.sortingLayer = 2;
        });
        expectBump((renderer) => {
            renderer.passId = 'overlay';
        });
        expectBump((renderer) => {
            renderer.size = [4, 5];
        });
        expectBump((renderer) => {
            renderer.sourceSize = [8, 8];
        });
        expectBump((renderer) => {
            renderer.anchor = [0, 1];
        });
        expectBump((renderer) => {
            renderer.color = { r: 1, g: 0, b: 0, a: 0.5 };
        });
        expectBump((renderer) => {
            renderer.uvRect = [0, 0, 0.5, 0.5];
        });
        expectBump((renderer) => {
            renderer.sliceBorder = [1, 1, 1, 1];
        });
        expectBump((renderer) => {
            renderer.flipX = true;
        });
        expectBump((renderer) => {
            renderer.flipY = true;
        });
    });

    it('increments for every mutating helper', () => {
        expectBump((renderer) => {
            renderer.setSize(3, 3);
        });
        expectBump((renderer) => {
            renderer.setSourceSize(6, 6);
        });
        expectBump((renderer) => {
            renderer.setAnchor(0.25, 0.75);
        });
        expectBump((renderer) => {
            renderer.setColor({ r: 0, g: 1, b: 0, a: 1 });
        });
        expectBump((renderer) => {
            renderer.setUVRect(0.5, 0.5, 0.25, 0.25);
        });
        expectBump((renderer) => {
            renderer.setSliceBorder(2, 2, 2, 2);
        });
        expectBump((renderer) => {
            renderer.applyFrame(frame);
        });
        expectBump((renderer) => {
            renderer.deserialize({ textureId: 'loaded', size: [7, 7] });
        });
    });

    it('increments when the slice border is cleared', () => {
        const renderer = new SpriteRenderer({
            textureId: 'hero',
            sliceBorder: [1, 2, 3, 4],
        });
        const before = renderer.revision;

        renderer.clearSliceBorder();

        expect(renderer.revision).toBeGreaterThan(before);
    });

    it('stays stable when a setter receives the current value', () => {
        const renderer = new SpriteRenderer({
            textureId: 'hero',
            materialId: 'mat',
            visible: true,
            renderOrder: 1,
            sortingLayer: 2,
            passId: 'main',
            size: [2, 3],
            sourceSize: [4, 6],
            anchor: [0.25, 0.75],
            color: { r: 1, g: 0.5, b: 0.25, a: 0.8 },
            uvRect: [0, 0, 1, 1],
            sliceBorder: [1, 1, 1, 1],
            flipX: true,
            flipY: true,
        });
        const before = renderer.revision;

        renderer.textureId = 'hero';
        renderer.materialId = 'mat';
        renderer.visible = true;
        renderer.renderOrder = 1;
        renderer.sortingLayer = 2;
        renderer.passId = 'main';
        renderer.size = [2, 3];
        renderer.sourceSize = [4, 6];
        renderer.anchor = [0.25, 0.75];
        renderer.color = { r: 1, g: 0.5, b: 0.25, a: 0.8 };
        renderer.uvRect = [0, 0, 1, 1];
        renderer.sliceBorder = [1, 1, 1, 1];
        renderer.flipX = true;
        renderer.flipY = true;
        renderer.setSize(2, 3);
        renderer.setSourceSize(4, 6);
        renderer.setAnchor(0.25, 0.75);
        renderer.setColor({ r: 1, g: 0.5, b: 0.25, a: 0.8 });
        renderer.setUVRect(0, 0, 1, 1);
        renderer.setSliceBorder(1, 1, 1, 1);

        expect(renderer.revision).toBe(before);
    });

    it('does not bump when the same frame is re-applied with preserved size/anchor', () => {
        const renderer = new SpriteRenderer({
            textureId: 'hero-atlas',
            size: [4, 4],
            anchor: [0.5, 0.25],
        });
        const options = { preserveSize: true, preserveAnchor: true } as const;

        renderer.applyFrame(frame, options);
        const before = renderer.revision;
        renderer.applyFrame(frame, options);

        expect(renderer.revision).toBe(before);
    });

    it('tracks in-place mutations of live value getters', () => {
        const renderer = new SpriteRenderer({
            textureId: 'hero',
            size: [2, 2],
            anchor: [0.5, 0.5],
            color: { r: 1, g: 0.5, b: 0.25, a: 1 },
            uvRect: [0, 0, 1, 1],
            sliceBorder: [1, 1, 1, 1],
        });

        const checkpoints: Array<() => void> = [
            () => {
                renderer.size.x = 3;
            },
            () => {
                renderer.sourceSize.y = 4;
            },
            () => {
                renderer.anchor.x = 0;
            },
            () => {
                renderer.color.r = 0.5;
            },
            () => {
                renderer.uvRect.width = 0.5;
            },
            () => {
                renderer.sliceBorder!.top = 2;
            },
        ];

        for (const mutate of checkpoints) {
            const before = renderer.revision;
            mutate();
            expect(renderer.revision).toBeGreaterThan(before);
        }
    });

    it('does not increment on reads', () => {
        const renderer = new SpriteRenderer({ textureId: 'hero', size: [2, 2] });
        const before = renderer.revision;

        void renderer.textureId;
        void renderer.size.x;
        void renderer.color.r;
        void renderer.hasRenderableSource;
        void renderer.isNineSlice;

        expect(renderer.revision).toBe(before);
    });
});
