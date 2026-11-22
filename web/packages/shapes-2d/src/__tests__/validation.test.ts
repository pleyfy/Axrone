import { describe, expect, it } from 'vitest';
import { createCircleShape, createLineShape, createPolygonShape } from '../shape';
import { ShapeValidationError } from '../errors';

describe('hole containment validation', () => {
    const outerInside = [
        { x: 0, y: 0 },
        { x: 20, y: 0 },
        { x: 20, y: 20 },
        { x: 0, y: 20 },
    ];

    it('accepts a hole fully inside the outer ring', () => {
        expect(() =>
            createPolygonShape({
                points: outerInside,
                holes: [{ points: [{ x: 5, y: 5 }, { x: 5, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 5 }] }],
            })
        ).not.toThrow();
    });

    it('rejects a hole outside the outer ring', () => {
        expect(() =>
            createPolygonShape({
                points: outerInside,
                holes: [{ points: [{ x: 25, y: 25 }, { x: 25, y: 30 }, { x: 30, y: 30 }, { x: 30, y: 25 }] }],
            })
        ).toThrow(ShapeValidationError);
    });

    it('rejects overlapping holes', () => {
        expect(() =>
            createPolygonShape({
                points: outerInside,
                holes: [
                    { points: [{ x: 2, y: 2 }, { x: 2, y: 8 }, { x: 8, y: 8 }, { x: 8, y: 2 }] },
                    { points: [{ x: 4, y: 4 }, { x: 4, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 4 }] },
                ],
            })
        ).toThrow(ShapeValidationError);
    });

    it('accepts non-overlapping holes', () => {
        expect(() =>
            createPolygonShape({
                points: outerInside,
                holes: [
                    { points: [{ x: 2, y: 2 }, { x: 2, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 2 }] },
                    { points: [{ x: 12, y: 12 }, { x: 12, y: 16 }, { x: 16, y: 16 }, { x: 16, y: 12 }] },
                ],
            })
        ).not.toThrow();
    });
});

describe('line stroke alignment validation', () => {
    it('accepts center alignment for lines', () => {
        expect(() =>
            createLineShape({
                start: { x: 0, y: 0 },
                end: { x: 10, y: 0 },
                stroke: { paint: '#000', width: 2, alignment: 'center' },
            })
        ).not.toThrow();
    });

    it('accepts default alignment (no alignment specified)', () => {
        expect(() =>
            createLineShape({
                start: { x: 0, y: 0 },
                end: { x: 10, y: 0 },
                stroke: { paint: '#000', width: 2 },
            })
        ).not.toThrow();
    });

    it('rejects inside alignment for lines', () => {
        expect(() =>
            createLineShape({
                start: { x: 0, y: 0 },
                end: { x: 10, y: 0 },
                stroke: { paint: '#000', width: 2, alignment: 'inside' },
            })
        ).toThrow(ShapeValidationError);
    });

    it('rejects outside alignment for lines', () => {
        expect(() =>
            createLineShape({
                start: { x: 0, y: 0 },
                end: { x: 10, y: 0 },
                stroke: { paint: '#000', width: 2, alignment: 'outside' },
            })
        ).toThrow(ShapeValidationError);
    });
});

describe('toPoint frozen fast-path validation', () => {
    it('rejects frozen point with NaN values', () => {
        const frozen = Object.freeze({ x: NaN, y: 5 });
        expect(() =>
            createCircleShape({ cx: frozen.x, cy: frozen.y, radius: 10 })
        ).toThrow(ShapeValidationError);
    });

    it('rejects frozen point with non-numeric values', () => {
        const frozen = Object.freeze({ x: 'bad' as unknown as number, y: 5 });
        expect(() =>
            createCircleShape({ cx: frozen.x, cy: frozen.y, radius: 10 })
        ).toThrow(ShapeValidationError);
    });

    it('accepts frozen point with valid numeric values', () => {
        const frozen = Object.freeze({ x: 5, y: 10 });
        expect(() =>
            createCircleShape({ cx: frozen.x, cy: frozen.y, radius: 10 })
        ).not.toThrow();
    });
});
