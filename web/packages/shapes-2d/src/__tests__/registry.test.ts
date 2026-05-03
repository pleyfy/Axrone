import { describe, expect, it } from 'vitest';
import { ShapeRegistry, createEllipseShape } from '../index';

describe('@axrone/shapes-2d registry', () => {
    it('interns identical shapes and reuses compiled entries', () => {
        const registry = new ShapeRegistry({
            maxShapes: 8,
            maxCompiledEntries: 4,
        });

        const shapeA = createEllipseShape({
            cx: 16,
            cy: 24,
            radiusX: 12,
            radiusY: 8,
            fill: '#3366ff',
            stroke: {
                paint: '#ffffff',
                width: 3,
            },
        });

        const shapeB = createEllipseShape({
            cx: 16,
            cy: 24,
            radiusX: 12,
            radiusY: 8,
            fill: '#3366ff',
            stroke: {
                paint: '#ffffff',
                width: 3,
            },
        });

        const idA = registry.register(shapeA);
        const idB = registry.register(shapeB);

        expect(idA).toBe(idB);

        const compiledA = registry.compile(idA);
        const compiledB = registry.compile(shapeB);

        expect(compiledA).toBe(compiledB);

        registry.dispose();
        expect(registry.stats.disposed).toBe(true);
    });
});
