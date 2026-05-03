import { describe, expect, it } from 'vitest';
import {
    createCircleShape,
    createLinearGradientPaint,
    createRectangleShape,
    createSolidPaint,
} from '../index';

describe('@axrone/shapes-2d primitives', () => {
    it('creates rectangle shapes with appearance data', () => {
        const shape = createRectangleShape({
            x: 10,
            y: 20,
            width: 100,
            height: 50,
            fill: '#ff0000',
            stroke: {
                paint: '#000000',
                width: 10,
            },
        });

        expect(shape.kind).toBe('rectangle');
        expect(shape.fill?.kind).toBe('solid');
        expect(shape.stroke?.paint.kind).toBe('solid');
        expect(shape.opacity).toBe(1);
    });

    it('creates circles and paint descriptors', () => {
        const fill = createLinearGradientPaint({
            start: [0, 0],
            end: [1, 0],
            stops: [
                { offset: 0, color: '#ff0000' },
                { offset: 1, color: '#0000ff' },
            ],
        });

        const shape = createCircleShape({
            cx: 0,
            cy: 0,
            radius: 24,
            fill,
            stroke: {
                paint: '#ffffff',
                width: 6,
            },
        });

        expect(shape.kind).toBe('circle');
        expect(shape.fill?.kind).toBe('linear-gradient');
        expect(shape.stroke?.paint.kind).toBe('solid');
        expect(createSolidPaint('#ffffff').kind).toBe('solid');
    });
});
