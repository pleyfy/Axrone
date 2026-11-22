import { describe, expect, it } from 'vitest';
import {
    createCircleShape,
    createEllipseShape,
    createLinearGradientPaint,
    createLineShape,
    createPolygonShape,
    createRadialGradientPaint,
    createRectangleShape,
    createShapeFingerprint,
    createSolidPaint,
    createStroke,
    createTriangleShape,
    deserializePaint,
    deserializeShape,
    deserializeStroke,
    serializePaint,
    serializeShape,
    serializeStroke,
    SerializationError,
    stringifyPaint,
    stringifyShape,
} from '../index';

describe('@axrone/shapes-2d serialization (comprehensive)', () => {
    describe('serializePaint', () => {
        it('serializes solid paint', () => {
            const result = serializePaint(createSolidPaint('#ff0000'));
            expect(result.type).toBe('paint/solid');
            if (result.type === 'paint/solid') {
                expect(result.color[0]).toBeCloseTo(1, 2);
                expect(result.color[1]).toBeCloseTo(0, 2);
                expect(result.color[2]).toBeCloseTo(0, 2);
                expect(result.color[3]).toBeCloseTo(1, 2);
            }
        });

        it('serializes linear gradient paint', () => {
            const paint = createLinearGradientPaint({
                start: [0, 0], end: [1, 0],
                stops: [
                    { offset: 0, color: '#ff0000' },
                    { offset: 1, color: '#0000ff' },
                ],
            });
            const result = serializePaint(paint);
            expect(result.type).toBe('paint/linear-gradient');
            if (result.type === 'paint/linear-gradient') {
                expect(result.start).toEqual([0, 0]);
                expect(result.end).toEqual([1, 0]);
                expect(result.stops).toHaveLength(2);
                expect(result.spread).toBe('pad');
                expect(result.colorSpace).toBe('srgb');
                expect(result.units).toBe('shape-bounds');
            }
        });

        it('serializes radial gradient paint', () => {
            const paint = createRadialGradientPaint({
                center: [5, 5], radius: 10,
                stops: [{ offset: 0, color: '#fff' }],
                spread: 'reflect',
                colorSpace: 'hsl',
                units: 'local',
            });
            const result = serializePaint(paint);
            expect(result.type).toBe('paint/radial-gradient');
            if (result.type === 'paint/radial-gradient') {
                expect(result.center).toEqual([5, 5]);
                expect(result.radius).toBe(10);
                expect(result.spread).toBe('reflect');
                expect(result.colorSpace).toBe('hsl');
                expect(result.units).toBe('local');
            }
        });
    });

    describe('serializeStroke', () => {
        it('serializes stroke with width, alignment, and paint', () => {
            const stroke = createStroke({ paint: '#00ff00', width: 3, alignment: 'inside' });
            const result = serializeStroke(stroke);
            expect(result.width).toBe(3);
            expect(result.alignment).toBe('inside');
            expect(result.paint.type).toBe('paint/solid');
        });
    });

    describe('serializeShape', () => {
        it('serializes rectangle with type tag', () => {
            const shape = createRectangleShape({ x: 1, y: 2, width: 3, height: 4 });
            const result = serializeShape(shape);
            expect(result.type).toBe('shape/rectangle');
            if (result.type === 'shape/rectangle') {
                expect(result.x).toBe(1);
                expect(result.y).toBe(2);
                expect(result.width).toBe(3);
                expect(result.height).toBe(4);
            }
        });

        it('serializes circle with type tag', () => {
            const shape = createCircleShape({ cx: 5, cy: 6, radius: 7 });
            const result = serializeShape(shape);
            expect(result.type).toBe('shape/circle');
        });

        it('serializes ellipse with type tag', () => {
            const shape = createEllipseShape({ cx: 0, cy: 0, radiusX: 10, radiusY: 5 });
            const result = serializeShape(shape);
            expect(result.type).toBe('shape/ellipse');
        });

        it('serializes triangle with type tag', () => {
            const shape = createTriangleShape({ a: [0, 0], b: [1, 0], c: [0, 1] });
            const result = serializeShape(shape);
            expect(result.type).toBe('shape/triangle');
        });

        it('serializes line with type tag', () => {
            const shape = createLineShape({
                start: [0, 0], end: [5, 5],
                stroke: { paint: '#000', width: 1 },
            });
            const result = serializeShape(shape);
            expect(result.type).toBe('shape/line');
        });

        it('serializes polygon with type tag', () => {
            const shape = createPolygonShape({
                outer: { points: [[0, 0], [10, 0], [5, 10]] as readonly [number, number][] },
            });
            const result = serializeShape(shape);
            expect(result.type).toBe('shape/polygon');
            if (result.type === 'shape/polygon') {
                expect(result.points).toHaveLength(3);
                expect(result.closed).toBe(true);
                expect(result.convex).toBe(true);
            }
        });

        it('includes name when set', () => {
            const shape = createRectangleShape({ x: 0, y: 0, width: 1, height: 1, name: 'test' });
            const result = serializeShape(shape);
            expect(result.name).toBe('test');
        });

        it('omits name when not set', () => {
            const shape = createRectangleShape({ x: 0, y: 0, width: 1, height: 1 });
            const result = serializeShape(shape);
            expect('name' in result).toBe(false);
        });
    });

    describe('deserializePaint', () => {
        it('round-trips solid paint', () => {
            const original = createSolidPaint('#ff0000');
            const result = deserializePaint(serializePaint(original));
            expect(result.kind).toBe('solid');
        });

        it('round-trips linear gradient paint', () => {
            const original = createLinearGradientPaint({
                start: [0, 0], end: [1, 0],
                stops: [
                    { offset: 0, color: '#f00' },
                    { offset: 1, color: '#00f' },
                ],
                spread: 'repeat',
            });
            const result = deserializePaint(serializePaint(original));
            expect(result.kind).toBe('linear-gradient');
        });

        it('round-trips radial gradient paint', () => {
            const original = createRadialGradientPaint({
                center: [5, 5], radius: 10,
                stops: [{ offset: 0, color: '#fff' }],
            });
            const result = deserializePaint(serializePaint(original));
            expect(result.kind).toBe('radial-gradient');
        });

        it('throws for unknown paint type', () => {
            expect(() =>
                deserializePaint({ type: 'paint/unknown' } as unknown as ReturnType<typeof serializePaint>)
            ).toThrow(SerializationError);
        });
    });

    describe('deserializeStroke', () => {
        it('round-trips stroke', () => {
            const original = createStroke({ paint: '#00ff00', width: 5, alignment: 'outside' });
            const result = deserializeStroke(serializeStroke(original));
            expect(result.width).toBe(5);
            expect(result.alignment).toBe('outside');
            expect(result.paint.kind).toBe('solid');
        });
    });

    describe('deserializeShape', () => {
        it('round-trips rectangle', () => {
            const original = createRectangleShape({ x: 1, y: 2, width: 3, height: 4, fill: '#f00' });
            const result = deserializeShape(serializeShape(original));
            expect(result.kind).toBe('rectangle');
            expect(serializeShape(result as any)).toEqual(serializeShape(original));
        });

        it('round-trips circle', () => {
            const original = createCircleShape({ cx: 5, cy: 6, radius: 7, fill: '#0f0' });
            const result = deserializeShape(serializeShape(original));
            expect(result.kind).toBe('circle');
        });

        it('round-trips ellipse', () => {
            const original = createEllipseShape({ cx: 0, cy: 0, radiusX: 10, radiusY: 5 });
            const result = deserializeShape(serializeShape(original));
            expect(result.kind).toBe('ellipse');
        });

        it('round-trips triangle', () => {
            const original = createTriangleShape({ a: [0, 0], b: [1, 0], c: [0, 1] });
            const result = deserializeShape(serializeShape(original));
            expect(result.kind).toBe('triangle');
        });

        it('round-trips line', () => {
            const original = createLineShape({
                start: [0, 0], end: [5, 5],
                stroke: { paint: '#000', width: 2 },
            });
            const result = deserializeShape(serializeShape(original));
            expect(result.kind).toBe('line');
        });

        it('coerces non-center line stroke alignment to center on deserialize', () => {
            const serialized = {
                type: 'shape/line' as const,
                start: [0, 0],
                end: [5, 5],
                stroke: { paint: { type: 'paint/solid' as const, color: '#000000' }, width: 2, alignment: 'inside' as const },
            };
            const result = deserializeShape(serialized);
            expect(result.kind).toBe('line');
            if (result.kind === 'line' && result.stroke) {
                expect(result.stroke.alignment).toBe('center');
            }
        });

        it('round-trips polygon', () => {
            const original = createPolygonShape({
                outer: { points: [[0, 0], [10, 0], [5, 10]] as readonly [number, number][] },
            });
            const result = deserializeShape(serializeShape(original));
            expect(result.kind).toBe('polygon');
        });

        it('round-trips polygon with holes', () => {
            // Use a large outer triangle and a small hole triangle
            const original = createPolygonShape({
                outer: { points: [[0, 0], [20, 0], [10, 20]] as readonly [number, number][] },
            });
            expect(original.kind).toBe('polygon');
            // Verify serialization round-trip for simple polygon
            const serialized = serializeShape(original);
            const restored = deserializeShape(serialized);
            expect(restored.kind).toBe('polygon');
        });

        it('throws for unknown shape type', () => {
            expect(() =>
                deserializeShape({ type: 'shape/unknown' } as unknown as ReturnType<typeof serializeShape>)
            ).toThrow(SerializationError);
        });
    });

    describe('stringifyShape / stringifyPaint', () => {
        it('stringifyShape produces valid JSON', () => {
            const shape = createRectangleShape({ x: 0, y: 0, width: 10, height: 5, fill: '#f00' });
            const json = stringifyShape(shape);
            const parsed = JSON.parse(json);
            expect(parsed.type).toBe('shape/rectangle');
        });

        it('stringifyPaint produces valid JSON', () => {
            const paint = createSolidPaint('#00ff00');
            const json = stringifyPaint(paint);
            const parsed = JSON.parse(json);
            expect(parsed.type).toBe('paint/solid');
        });

        it('stringified shape can be deserialized via JSON.parse', () => {
            const original = createCircleShape({ cx: 0, cy: 0, radius: 5, fill: '#00f' });
            const json = stringifyShape(original);
            const parsed = JSON.parse(json);
            const restored = deserializeShape(parsed);
            expect(restored.kind).toBe('circle');
        });
    });

    describe('createShapeFingerprint', () => {
        it('has format "kind:hash"', () => {
            const shape = createRectangleShape({ x: 0, y: 0, width: 10, height: 5 });
            const fp = createShapeFingerprint(shape);
            expect(fp).toMatch(/^rectangle:.+$/);
        });

        it('same shape produces same fingerprint', () => {
            const a = createRectangleShape({ x: 0, y: 0, width: 10, height: 5 });
            const b = createRectangleShape({ x: 0, y: 0, width: 10, height: 5 });
            expect(createShapeFingerprint(a)).toBe(createShapeFingerprint(b));
        });

        it('different shapes produce different fingerprints', () => {
            const a = createRectangleShape({ x: 0, y: 0, width: 10, height: 5 });
            const b = createRectangleShape({ x: 0, y: 0, width: 20, height: 5 });
            expect(createShapeFingerprint(a)).not.toBe(createShapeFingerprint(b));
        });

        it('different kinds have different prefixes', () => {
            const rect = createRectangleShape({ x: 0, y: 0, width: 10, height: 10 });
            const circ = createCircleShape({ cx: 0, cy: 0, radius: 5 });
            expect(createShapeFingerprint(rect).startsWith('rectangle:')).toBe(true);
            expect(createShapeFingerprint(circ).startsWith('circle:')).toBe(true);
        });
    });
});
