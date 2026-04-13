import { describe, expect, it } from 'vitest';
import {
    buildFillMesh,
    buildStrokeMesh,
    compileShape,
    containsPoint,
    createRectangleShape,
    getShapeArea,
    getShapeBounds,
    getShapeCentroid,
    getShapePerimeter,
    hitTestShape,
} from '../index';

describe('@axrone/shapes-2d geometry and mesh', () => {
    it('computes geometry and hit testing for rectangles', () => {
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

        expect(getShapeArea(shape)).toBe(5000);
        expect(getShapePerimeter(shape)).toBe(300);
        expect(getShapeCentroid(shape)).toEqual({ x: 60, y: 45 });
        expect(containsPoint(shape, [60, 45])).toBe(true);
        expect(hitTestShape(shape, [60, 45])).toBe('fill');
        expect(hitTestShape(shape, [10, 25])).toBe('stroke');
        expect(hitTestShape(shape, [0, 0])).toBe('none');

        const bounds = getShapeBounds(shape);
        expect(bounds).toMatchObject({
            minX: 5,
            minY: 15,
            maxX: 115,
            maxY: 75,
        });
    });

    it('builds meshes and compiled snapshots', () => {
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

        const fillMesh = buildFillMesh(shape);
        const strokeMesh = buildStrokeMesh(shape);
        const compiled = compileShape(shape);

        expect(fillMesh?.vertexCount).toBe(4);
        expect(fillMesh?.indexCount).toBe(6);
        expect(strokeMesh?.vertexCount).toBe(8);
        expect(strokeMesh?.indexCount).toBe(24);
        expect(compiled.fingerprint.startsWith('rectangle:')).toBe(true);
        expect(compiled.fillMesh?.vertexCount).toBe(4);
        expect(compiled.strokeMesh?.vertexCount).toBe(8);
    });
});
