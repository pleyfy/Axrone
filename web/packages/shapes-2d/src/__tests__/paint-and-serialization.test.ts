import { describe, expect, it } from 'vitest';
import {
    createLinearGradientPaint,
    createRectangleShape,
    deserializeShape,
    sampleShapePaint,
    serializeShape,
} from '../index';

describe('@axrone/shapes-2d paint and serialization', () => {
    it('samples linear gradients relative to shape bounds', () => {
        const fill = createLinearGradientPaint({
            start: [0, 0.5],
            end: [1, 0.5],
            units: 'shape-bounds',
            stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 1, color: '#0000ff' },
            ],
        });

        const shape = createRectangleShape({
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            fill,
        });

        const left = sampleShapePaint(shape, 'fill', [0, 50]);
        const center = sampleShapePaint(shape, 'fill', [50, 50]);
        const right = sampleShapePaint(shape, 'fill', [100, 50]);

        expect(left?.r ?? 0).toBeGreaterThan(0.9);
        expect(right?.b ?? 0).toBeGreaterThan(0.9);
        expect(center?.r ?? 0).toBeCloseTo(center?.b ?? 0, 1);
    });

    it('round-trips serialized shapes', () => {
        const shape = createRectangleShape({
            x: 4,
            y: 8,
            width: 32,
            height: 16,
            fill: '#00ff00',
            stroke: {
                paint: '#000000',
                width: 2,
                alignment: 'inside',
            },
            opacity: 0.75,
            name: 'hud-card',
        });

        const serialized = serializeShape(shape);
        const restored = deserializeShape(serialized);
        const restoredSerialized = serializeShape(restored);

        expect(restoredSerialized).toEqual(serialized);
    });
});
