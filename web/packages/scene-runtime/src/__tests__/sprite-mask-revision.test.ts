import { describe, expect, it } from 'vitest';
import { SpriteMask } from '../components/sprite-mask';

describe('SpriteMask revision', () => {
    it('increments for mask property mutations and live value writes', () => {
        const mask = new SpriteMask({ size: [4, 4], anchor: [0.5, 0.5], shape: 'rect' });
        const checkpoints: Array<() => void> = [
            () => {
                mask.size = [2, 3];
            },
            () => {
                mask.anchor = [0, 1];
            },
            () => {
                mask.shape = 'circle';
            },
            () => {
                mask.cornerRadius = 0.5;
            },
            () => {
                mask.size.x = 5;
            },
            () => {
                mask.anchor.y = 0.25;
            },
            () => {
                mask.setSize(6, 7);
            },
            () => {
                mask.setAnchor(0.2, 0.8);
            },
            () => {
                mask.setShape('rounded-rect');
            },
            () => {
                mask.setCornerRadius(1);
            },
            () => {
                mask.deserialize({ size: [8, 8], shape: 'circle' });
            },
        ];

        for (const mutate of checkpoints) {
            const before = mask.revision;
            mutate();
            expect(mask.revision).toBeGreaterThan(before);
        }
    });

    it('stays stable on reads and same-value setters', () => {
        const mask = new SpriteMask({
            size: [4, 4],
            anchor: [0.5, 0.5],
            shape: 'rect',
            cornerRadius: null,
        });
        const before = mask.revision;

        void mask.size.x;
        void mask.anchor.y;
        void mask.shape;
        mask.size = [4, 4];
        mask.anchor = [0.5, 0.5];
        mask.shape = 'rect';
        mask.cornerRadius = null;

        expect(mask.revision).toBe(before);
    });
});
