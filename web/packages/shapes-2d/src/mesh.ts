import {
    buildFillMeshInternal,
    buildStrokeMeshInternal,
    getGeometryBounds,
    getShapeBounds,
    getShapeContour,
    getShapePerimeter,
    getShapeArea,
} from './geometry';
import { createShapeFingerprint } from './serialization';
import type {
    CompiledShape2D,
    Shape2D,
    ShapeCompileOptions,
    ShapeMesh2D,
} from './types';

export const buildFillMesh = (
    shape: Shape2D,
    options: ShapeCompileOptions = {}
): ShapeMesh2D | null => buildFillMeshInternal(shape, options);

export const buildStrokeMesh = (
    shape: Shape2D,
    options: ShapeCompileOptions = {}
): ShapeMesh2D | null => buildStrokeMeshInternal(shape, options);

export const compileShape = <TShape extends Shape2D>(
    shape: TShape,
    options: ShapeCompileOptions = {}
): CompiledShape2D<TShape> => ({
    shape,
    fingerprint: createShapeFingerprint(shape),
    geometryBounds: getGeometryBounds(shape),
    bounds: getShapeBounds(shape, options),
    area: getShapeArea(shape),
    perimeter: getShapePerimeter(shape),
    contour: getShapeContour(shape, options),
    fillMesh: options.includeFillMesh === false ? null : buildFillMeshInternal(shape, options),
    strokeMesh:
        options.includeStrokeMesh === false ? null : buildStrokeMeshInternal(shape, options),
});
