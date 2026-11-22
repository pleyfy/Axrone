import { describe, expect, it } from 'vitest';
import {
    createPolygonShape,
    deserializeShape,
    polygonSignedArea,
    serializeShape,
    type PolygonShape,
} from '../index';
import { ShapeValidationError } from '../errors';

const CCW_SQUARE = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
];

const CW_SQUARE = [...CCW_SQUARE].reverse();

const ringPoints = (shape: PolygonShape): { x: number; y: number }[] =>
    shape.outer.points.map((p) => ({ x: p.x, y: p.y }));

describe('polygon outer winding normalization', () => {
    it('creates a polygon from a clockwise ring without crashing and normalizes it to ccw', () => {
        const shape = createPolygonShape({ points: CW_SQUARE });
        expect(shape.outer.winding).toBe('ccw');
        expect(polygonSignedArea(
            new Float32Array(ringPoints(shape).flatMap((p) => [p.x, p.y]))
        )).toBeGreaterThan(0);
        expect(new Set(ringPoints(shape).map((p) => `${p.x},${p.y}`))).toEqual(
            new Set(CW_SQUARE.map((p) => `${p.x},${p.y}`))
        );
    });

    it('keeps a correctly declared clockwise ring and normalizes it to ccw', () => {
        const shape = createPolygonShape({
            outer: { points: CW_SQUARE, winding: 'cw' },
        });
        expect(shape.outer.winding).toBe('ccw');
    });

    it('keeps a counterclockwise ring unchanged', () => {
        const shape = createPolygonShape({
            outer: { points: CCW_SQUARE, winding: 'ccw' },
        });
        expect(shape.outer.winding).toBe('ccw');
        expect(ringPoints(shape)[0]).toEqual({ x: 0, y: 0 });
    });

    it('rejects a mislabeled ring declaration with a validation error, not a TypeError', () => {
        expect(() =>
            createPolygonShape({ outer: { points: CW_SQUARE, winding: 'ccw' } })
        ).toThrow(ShapeValidationError);
        expect(() =>
            createPolygonShape({ outer: { points: CCW_SQUARE, winding: 'cw' } })
        ).toThrow(/declares winding "cw" but its geometry is wound "ccw"/);
    });

    it('applies the top-level winding shorthand to the points form', () => {
        expect(createPolygonShape({ points: CW_SQUARE, winding: 'cw' }).outer.winding).toBe('ccw');
        expect(() =>
            createPolygonShape({ points: CW_SQUARE, winding: 'ccw' })
        ).toThrow(ShapeValidationError);
    });

    it('validates the top-level winding against an explicit outer ring', () => {
        expect(() =>
            createPolygonShape({
                outer: { points: CW_SQUARE, winding: 'ccw' },
                winding: 'cw',
            })
        ).toThrow(/conflicts with polygon.outer.winding/);
        expect(
            createPolygonShape({ outer: { points: CW_SQUARE }, winding: 'cw' }).outer.winding
        ).toBe('ccw');
    });
});

describe('polygon hole winding normalization', () => {
    const OUTER = {
        points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
        ],
        winding: 'ccw' as const,
    };

    it('auto-normalizes a counterclockwise hole ring to clockwise', () => {
        const shape = createPolygonShape({
            outer: OUTER,
            holes: [
                {
                    points: [
                        { x: 4, y: 4 },
                        { x: 6, y: 4 },
                        { x: 6, y: 6 },
                        { x: 4, y: 6 },
                    ],
                },
            ],
        });
        expect(shape.holes[0]!.winding).toBe('cw');
    });

    it('accepts a correctly declared clockwise hole ring', () => {
        const shape = createPolygonShape({
            outer: OUTER,
            holes: [
                {
                    points: [
                        { x: 4, y: 4 },
                        { x: 4, y: 6 },
                        { x: 6, y: 6 },
                        { x: 6, y: 4 },
                    ],
                    winding: 'cw',
                },
            ],
        });
        expect(shape.holes[0]!.winding).toBe('cw');
    });

    it('rejects a mislabeled hole declaration', () => {
        expect(() =>
            createPolygonShape({
                outer: OUTER,
                holes: [
                    {
                        points: [
                            { x: 4, y: 4 },
                            { x: 6, y: 4 },
                            { x: 6, y: 6 },
                            { x: 4, y: 6 },
                        ],
                        winding: 'cw',
                    },
                ],
            })
        ).toThrow(/polygon.holes\[0\] declares winding "cw" but its geometry is wound "ccw"/);
    });
});

describe('winding round-trip through serialization', () => {
    it('preserves normalized geometry for a clockwise-created polygon', () => {
        const shape = createPolygonShape({ points: CW_SQUARE });
        const restored = deserializeShape(serializeShape(shape)) as PolygonShape;
        expect(restored.outer.winding).toBe('ccw');
        expect(new Set(restored.outer.points.map((p) => `${p.x},${p.y}`))).toEqual(
            new Set(ringPoints(shape).map((p) => `${p.x},${p.y}`))
        );
    });
});
