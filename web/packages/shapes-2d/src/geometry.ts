import type { IVec2Like } from '@axrone/numeric';
import {
    EPSILON,
    TAU,
    approximateCurveSegments,
    createBounds,
    distance,
    distanceSquared,
    distanceToSegmentSquared,
    expandBounds,
    normalizeContourOrientation,
    pointInConvexPolygon,
    pointInBounds,
    polygonSignedArea,
    toIndexArray,
} from './common';
import type {
    CircleShape,
    EllipseShape,
    LineShape,
    RectangleShape,
    Shape2D,
    ShapeApproximationOptions,
    ShapeBounds,
    ShapeMesh2D,
    ShapeStroke,
    TriangleShape,
} from './types';

const getContourBounds = (contour: Float32Array): ShapeBounds => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (let index = 0; index < contour.length; index += 2) {
        const x = contour[index]!;
        const y = contour[index + 1]!;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
    }

    return createBounds(minX, minY, maxX, maxY);
};

const createMesh = (
    positions: Float32Array,
    indices: readonly number[]
): ShapeMesh2D => ({
    positions,
    indices: toIndexArray(indices, positions.length / 2),
    vertexCount: positions.length / 2,
    indexCount: indices.length,
    bounds: getContourBounds(positions),
});

const buildConvexFanMesh = (contour: Float32Array): ShapeMesh2D => {
    const indices: number[] = [];
    const count = contour.length / 2;

    for (let index = 1; index < count - 1; index++) {
        indices.push(0, index, index + 1);
    }

    return createMesh(contour.slice(), indices);
};

const buildRingMesh = (outer: Float32Array, inner: Float32Array | null): ShapeMesh2D => {
    if (!inner || Math.abs(polygonSignedArea(inner)) <= EPSILON) {
        return buildConvexFanMesh(outer);
    }

    const count = outer.length / 2;
    const positions = new Float32Array(outer.length + inner.length);
    positions.set(outer, 0);
    positions.set(inner, outer.length);

    const indices: number[] = [];

    for (let index = 0; index < count; index++) {
        const next = (index + 1) % count;
        const innerIndex = index + count;
        const innerNext = next + count;
        indices.push(index, next, innerNext, index, innerNext, innerIndex);
    }

    return createMesh(positions, indices);
};

const getStrokeOffsets = (
    stroke: ShapeStroke
): { readonly outer: number; readonly inner: number } => {
    switch (stroke.alignment) {
        case 'inside':
            return { outer: 0, inner: stroke.width };
        case 'outside':
            return { outer: stroke.width, inner: 0 };
        default:
            return { outer: stroke.width * 0.5, inner: stroke.width * 0.5 };
    }
};

const normalizeEdge = (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number
): readonly [number, number] => {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length <= EPSILON) {
        return [0, 0];
    }
    return [dx / length, dy / length];
};

const offsetConvexContour = (contour: Float32Array, distanceValue: number): Float32Array => {
    const count = contour.length / 2;
    const area = polygonSignedArea(contour);
    const winding = area >= 0 ? 1 : -1;
    const offset = new Float32Array(contour.length);

    for (let index = 0; index < count; index++) {
        const previous = (index + count - 1) % count;
        const next = (index + 1) % count;

        const px = contour[index * 2]!;
        const py = contour[index * 2 + 1]!;
        const prevX = contour[previous * 2]!;
        const prevY = contour[previous * 2 + 1]!;
        const nextX = contour[next * 2]!;
        const nextY = contour[next * 2 + 1]!;

        const [prevDirX, prevDirY] = normalizeEdge(prevX, prevY, px, py);
        const [nextDirX, nextDirY] = normalizeEdge(px, py, nextX, nextY);

        const prevNormalX = winding >= 0 ? prevDirY : -prevDirY;
        const prevNormalY = winding >= 0 ? -prevDirX : prevDirX;
        const nextNormalX = winding >= 0 ? nextDirY : -nextDirY;
        const nextNormalY = winding >= 0 ? -nextDirX : nextDirX;

        const miterX = prevNormalX + nextNormalX;
        const miterY = prevNormalY + nextNormalY;
        const miterLength = Math.sqrt(miterX * miterX + miterY * miterY);

        if (miterLength <= EPSILON) {
            offset[index * 2] = px + prevNormalX * distanceValue;
            offset[index * 2 + 1] = py + prevNormalY * distanceValue;
            continue;
        }

        const normalizedMiterX = miterX / miterLength;
        const normalizedMiterY = miterY / miterLength;
        const projection = normalizedMiterX * prevNormalX + normalizedMiterY * prevNormalY;

        if (Math.abs(projection) <= EPSILON) {
            offset[index * 2] = px + prevNormalX * distanceValue;
            offset[index * 2 + 1] = py + prevNormalY * distanceValue;
            continue;
        }

        const scale = distanceValue / projection;
        offset[index * 2] = px + normalizedMiterX * scale;
        offset[index * 2 + 1] = py + normalizedMiterY * scale;
    }

    return offset;
};

const isValidContour = (contour: Float32Array | null): contour is Float32Array =>
    !!contour &&
    contour.length >= 6 &&
    contour.every((value) => Number.isFinite(value)) &&
    Math.abs(polygonSignedArea(contour)) > EPSILON;

const createEllipseContour = (
    cx: number,
    cy: number,
    radiusX: number,
    radiusY: number,
    options: ShapeApproximationOptions = {}
): Float32Array => {
    const segments = approximateCurveSegments(radiusX, radiusY, options);
    const contour = new Float32Array(segments * 2);

    for (let index = 0; index < segments; index++) {
        const angle = (index / segments) * TAU;
        contour[index * 2] = cx + Math.cos(angle) * radiusX;
        contour[index * 2 + 1] = cy + Math.sin(angle) * radiusY;
    }

    return contour;
};

const createRectangleContour = (shape: RectangleShape): Float32Array =>
    new Float32Array([
        shape.x,
        shape.y,
        shape.x + shape.width,
        shape.y,
        shape.x + shape.width,
        shape.y + shape.height,
        shape.x,
        shape.y + shape.height,
    ]);

const createTriangleContour = (shape: TriangleShape): Float32Array =>
    normalizeContourOrientation(
        new Float32Array([
            shape.a.x,
            shape.a.y,
            shape.b.x,
            shape.b.y,
            shape.c.x,
            shape.c.y,
        ])
    );

export const getShapeContour = (
    shape: Shape2D,
    options: ShapeApproximationOptions = {}
): Float32Array => {
    switch (shape.kind) {
        case 'rectangle':
            return createRectangleContour(shape);
        case 'circle':
            return createEllipseContour(shape.cx, shape.cy, shape.radius, shape.radius, options);
        case 'ellipse':
            return createEllipseContour(shape.cx, shape.cy, shape.radiusX, shape.radiusY, options);
        case 'triangle':
            return createTriangleContour(shape);
        case 'line':
            return new Float32Array([shape.start.x, shape.start.y, shape.end.x, shape.end.y]);
    }
};

export const getGeometryBounds = (shape: Shape2D): ShapeBounds => {
    switch (shape.kind) {
        case 'rectangle':
            return createBounds(shape.x, shape.y, shape.x + shape.width, shape.y + shape.height);
        case 'circle':
            return createBounds(
                shape.cx - shape.radius,
                shape.cy - shape.radius,
                shape.cx + shape.radius,
                shape.cy + shape.radius
            );
        case 'ellipse':
            return createBounds(
                shape.cx - shape.radiusX,
                shape.cy - shape.radiusY,
                shape.cx + shape.radiusX,
                shape.cy + shape.radiusY
            );
        case 'triangle':
            return createBounds(
                Math.min(shape.a.x, shape.b.x, shape.c.x),
                Math.min(shape.a.y, shape.b.y, shape.c.y),
                Math.max(shape.a.x, shape.b.x, shape.c.x),
                Math.max(shape.a.y, shape.b.y, shape.c.y)
            );
        case 'line':
            return createBounds(shape.start.x, shape.start.y, shape.end.x, shape.end.y);
    }
};

export const getShapeBounds = (
    shape: Shape2D,
    options: ShapeApproximationOptions = {}
): ShapeBounds => {
    const geometryBounds = getGeometryBounds(shape);
    if (!shape.stroke) {
        return geometryBounds;
    }

    const { outer } = getStrokeOffsets(shape.stroke);
    if (outer <= EPSILON) {
        return geometryBounds;
    }

    switch (shape.kind) {
        case 'rectangle':
        case 'circle':
        case 'ellipse':
            return expandBounds(geometryBounds, outer);
        case 'line':
            return expandBounds(geometryBounds, shape.stroke.width * 0.5);
        case 'triangle': {
            const contour = getShapeContour(shape, options);
            return getContourBounds(offsetConvexContour(contour, outer));
        }
    }
};

export const getShapeArea = (shape: Shape2D): number => {
    switch (shape.kind) {
        case 'rectangle':
            return shape.width * shape.height;
        case 'circle':
            return Math.PI * shape.radius * shape.radius;
        case 'ellipse':
            return Math.PI * shape.radiusX * shape.radiusY;
        case 'triangle':
            return (
                Math.abs(
                    shape.a.x * (shape.b.y - shape.c.y) +
                        shape.b.x * (shape.c.y - shape.a.y) +
                        shape.c.x * (shape.a.y - shape.b.y)
                ) * 0.5
            );
        case 'line':
            return 0;
    }
};

export const getShapePerimeter = (shape: Shape2D): number => {
    switch (shape.kind) {
        case 'rectangle':
            return (shape.width + shape.height) * 2;
        case 'circle':
            return TAU * shape.radius;
        case 'ellipse': {
            const a = Math.max(shape.radiusX, shape.radiusY);
            const b = Math.min(shape.radiusX, shape.radiusY);
            return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
        }
        case 'triangle':
            return (
                distance(shape.a.x, shape.a.y, shape.b.x, shape.b.y) +
                distance(shape.b.x, shape.b.y, shape.c.x, shape.c.y) +
                distance(shape.c.x, shape.c.y, shape.a.x, shape.a.y)
            );
        case 'line':
            return distance(shape.start.x, shape.start.y, shape.end.x, shape.end.y);
    }
};

export const getShapeCentroid = (shape: Shape2D): Readonly<IVec2Like> => {
    switch (shape.kind) {
        case 'rectangle':
            return Object.freeze({
                x: shape.x + shape.width * 0.5,
                y: shape.y + shape.height * 0.5,
            });
        case 'circle':
        case 'ellipse':
            return Object.freeze({ x: shape.cx, y: shape.cy });
        case 'triangle':
            return Object.freeze({
                x: (shape.a.x + shape.b.x + shape.c.x) / 3,
                y: (shape.a.y + shape.b.y + shape.c.y) / 3,
            });
        case 'line':
            return Object.freeze({
                x: (shape.start.x + shape.end.x) * 0.5,
                y: (shape.start.y + shape.end.y) * 0.5,
            });
    }
};

const containsPointInTriangle = (shape: TriangleShape, point: Readonly<IVec2Like>): boolean => {
    const d1 =
        (point.x - shape.b.x) * (shape.a.y - shape.b.y) -
        (shape.a.x - shape.b.x) * (point.y - shape.b.y);
    const d2 =
        (point.x - shape.c.x) * (shape.b.y - shape.c.y) -
        (shape.b.x - shape.c.x) * (point.y - shape.c.y);
    const d3 =
        (point.x - shape.a.x) * (shape.c.y - shape.a.y) -
        (shape.c.x - shape.a.x) * (point.y - shape.a.y);
    const hasNegative = d1 < -EPSILON || d2 < -EPSILON || d3 < -EPSILON;
    const hasPositive = d1 > EPSILON || d2 > EPSILON || d3 > EPSILON;
    return !(hasNegative && hasPositive);
};

export const containsGeometryPoint = (
    shape: Shape2D,
    point: Readonly<IVec2Like>
): boolean => {
    switch (shape.kind) {
        case 'rectangle':
            return pointInBounds(getGeometryBounds(shape), point);
        case 'circle':
            return (
                distanceSquared(point.x, point.y, shape.cx, shape.cy) <=
                shape.radius * shape.radius + EPSILON
            );
        case 'ellipse': {
            const dx = (point.x - shape.cx) / shape.radiusX;
            const dy = (point.y - shape.cy) / shape.radiusY;
            return dx * dx + dy * dy <= 1 + EPSILON;
        }
        case 'triangle':
            return containsPointInTriangle(shape, point);
        case 'line':
            return false;
    }
};

export const containsStrokePoint = (
    shape: Shape2D,
    point: Readonly<IVec2Like>,
    options: ShapeApproximationOptions = {}
): boolean => {
    if (!shape.stroke) {
        return false;
    }

    if (shape.kind === 'line') {
        return (
            distanceToSegmentSquared(
                point.x,
                point.y,
                shape.start.x,
                shape.start.y,
                shape.end.x,
                shape.end.y
            ) <=
            (shape.stroke.width * 0.5) * (shape.stroke.width * 0.5) + EPSILON
        );
    }

    const contour = getShapeContour(shape, options);
    const { outer, inner } = getStrokeOffsets(shape.stroke);
    const outerContour = outer <= EPSILON ? contour : offsetConvexContour(contour, outer);
    if (!pointInConvexPolygon(outerContour, point)) {
        return false;
    }

    if (inner <= EPSILON) {
        return true;
    }

    const innerContour = offsetConvexContour(contour, -inner);
    if (!isValidContour(innerContour)) {
        return true;
    }

    return !pointInConvexPolygon(innerContour, point);
};

const buildLineStrokeMesh = (shape: LineShape): ShapeMesh2D | null => {
    if (!shape.stroke) {
        return null;
    }

    const halfWidth = shape.stroke.width * 0.5;
    const dx = shape.end.x - shape.start.x;
    const dy = shape.end.y - shape.start.y;
    const length = Math.sqrt(dx * dx + dy * dy);

    if (length <= EPSILON) {
        return buildConvexFanMesh(
            new Float32Array([
                shape.start.x - halfWidth,
                shape.start.y - halfWidth,
                shape.start.x + halfWidth,
                shape.start.y - halfWidth,
                shape.start.x + halfWidth,
                shape.start.y + halfWidth,
                shape.start.x - halfWidth,
                shape.start.y + halfWidth,
            ])
        );
    }

    const normalX = (-dy / length) * halfWidth;
    const normalY = (dx / length) * halfWidth;

    return createMesh(
        new Float32Array([
            shape.start.x + normalX,
            shape.start.y + normalY,
            shape.end.x + normalX,
            shape.end.y + normalY,
            shape.end.x - normalX,
            shape.end.y - normalY,
            shape.start.x - normalX,
            shape.start.y - normalY,
        ]),
        [0, 1, 2, 0, 2, 3]
    );
};

export const buildFillMeshInternal = (
    shape: Shape2D,
    options: ShapeApproximationOptions = {}
): ShapeMesh2D | null => {
    if (shape.kind === 'line') {
        return null;
    }

    return buildConvexFanMesh(getShapeContour(shape, options));
};

export const buildStrokeMeshInternal = (
    shape: Shape2D,
    options: ShapeApproximationOptions = {}
): ShapeMesh2D | null => {
    if (!shape.stroke) {
        return null;
    }

    if (shape.kind === 'line') {
        return buildLineStrokeMesh(shape);
    }

    const contour = getShapeContour(shape, options);
    const { outer, inner } = getStrokeOffsets(shape.stroke);
    const outerContour = outer <= EPSILON ? contour : offsetConvexContour(contour, outer);
    const innerContour = inner <= EPSILON ? null : offsetConvexContour(contour, -inner);
    return buildRingMesh(outerContour, isValidContour(innerContour) ? innerContour : null);
};
