import {
    EPSILON,
    assertFiniteNumber,
    assertPositiveNumber,
    distanceSquared,
    float32ToPoints,
    isConvexPolygon,
    isSimplePolygon,
    normalizeContourOrientation,
    pointInPolygon,
    pointsToFloat32,
    polygonAbsoluteArea,
    polygonSignedArea,
    toPoint,
} from './common';
import { ShapeValidationError } from './errors';
import { createPaint, createStroke } from './paint';
import type {
    CircleShape,
    CircleShapeInput,
    EllipseShape,
    EllipseShapeInput,
    LineShape,
    LineShapeInput,
    PolygonRing,
    PolygonRingInput,
    PolygonShape,
    PolygonShapeInput,
    PolygonWinding,
    RectangleShape,
    RectangleShapeInput,
    Shape2D,
    ShapeAppearance,
    ShapeAppearanceInput,
    ShapeKind,
    TriangleShape,
    TriangleShapeInput,
} from './types';
import { clamp01, type IVec2Like } from "@axrone/numeric";

const normalizeAppearance = (
    input: ShapeAppearanceInput = {},
    allowFill: boolean = true
): ShapeAppearance => {
    const fill = input.fill === undefined || input.fill === null ? null : createPaint(input.fill);
    if (!allowFill && fill) {
        throw new ShapeValidationError('Line shapes do not support fill paint');
    }

    const stroke =
        input.stroke === undefined || input.stroke === null ? null : createStroke(input.stroke);
    const opacity = clamp01(input.opacity ?? 1);
    const visible = input.visible ?? true;
    const name = input.name?.trim() || undefined;

    return {
        fill,
        stroke,
        opacity,
        visible,
        name,
    };
};

export const createRectangleShape = (input: RectangleShapeInput): RectangleShape => {
    const width = assertPositiveNumber(input.width, 'rectangle.width');
    const height = assertPositiveNumber(input.height, 'rectangle.height');

    return Object.freeze({
        kind: 'rectangle',
        x: assertFiniteNumber(input.x, 'rectangle.x'),
        y: assertFiniteNumber(input.y, 'rectangle.y'),
        width,
        height,
        ...normalizeAppearance(input),
    });
};

export const createCircleShape = (input: CircleShapeInput): CircleShape =>
    Object.freeze({
        kind: 'circle',
        cx: assertFiniteNumber(input.cx, 'circle.cx'),
        cy: assertFiniteNumber(input.cy, 'circle.cy'),
        radius: assertPositiveNumber(input.radius, 'circle.radius'),
        ...normalizeAppearance(input),
    });

export const createEllipseShape = (input: EllipseShapeInput): EllipseShape =>
    Object.freeze({
        kind: 'ellipse',
        cx: assertFiniteNumber(input.cx, 'ellipse.cx'),
        cy: assertFiniteNumber(input.cy, 'ellipse.cy'),
        radiusX: assertPositiveNumber(input.radiusX, 'ellipse.radiusX'),
        radiusY: assertPositiveNumber(input.radiusY, 'ellipse.radiusY'),
        ...normalizeAppearance(input),
    });

export const createTriangleShape = (input: TriangleShapeInput): TriangleShape => {
    const a = toPoint(input.a, 'triangle.a');
    const b = toPoint(input.b, 'triangle.b');
    const c = toPoint(input.c, 'triangle.c');
    const doubledArea =
        a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y);

    if (Math.abs(doubledArea) <= EPSILON) {
        throw new ShapeValidationError('Triangle points must not be collinear');
    }

    return Object.freeze({
        kind: 'triangle',
        a,
        b,
        c,
        ...normalizeAppearance(input),
    });
};

export const createLineShape = (input: LineShapeInput): LineShape => {
    const start = toPoint(input.start, 'line.start');
    const end = toPoint(input.end, 'line.end');

    if (distanceSquared(start.x, start.y, end.x, end.y) <= EPSILON && !input.stroke) {
        throw new ShapeValidationError('Zero-length lines require a stroke');
    }

    if (input.stroke && input.stroke.alignment && input.stroke.alignment !== 'center') {
        throw new ShapeValidationError(
            `line.stroke.alignment must be "center", got "${input.stroke.alignment}"`
        );
    }

    return Object.freeze({
        kind: 'line',
        start,
        end,
        ...normalizeAppearance(input, false),
    });
};

const normalizePolygonRing = (
    ring: PolygonRingInput,
    name: string,
    target: PolygonWinding
): PolygonRing => {
    if (!Array.isArray(ring.points) || ring.points.length < 3) {
        throw new ShapeValidationError(`${name} must contain at least 3 points`);
    }
    const points: Readonly<IVec2Like>[] = ring.points.map((p, idx) =>
        toPoint(p, `${name}.points[${idx}]`)
    );
    const flat = new Float32Array(points.length * 2);
    for (let i = 0; i < points.length; i++) {
        flat[i * 2] = (points[i] as Readonly<IVec2Like>).x;
        flat[i * 2 + 1] = (points[i] as Readonly<IVec2Like>).y;
    }

    if (polygonAbsoluteArea(flat) <= EPSILON) {
        throw new ShapeValidationError(`${name} has zero signed area; ring is degenerate`);
    }
    if (!isSimplePolygon(flat)) {
        throw new ShapeValidationError(`${name} is not a simple polygon (edges self-intersect)`);
    }

    const detected: PolygonWinding = polygonSignedArea(flat) > 0 ? 'ccw' : 'cw';
    if (ring.winding !== undefined && ring.winding !== detected) {
        throw new ShapeValidationError(
            `${name} declares winding "${ring.winding}" but its geometry is wound "${detected}"`
        );
    }

    const normalized =
        detected === target ? flat : normalizeContourOrientation(flat, target === 'ccw');

    return Object.freeze({
        points: Object.freeze(float32ToPoints(normalized)),
        winding: target,
    });
};

export const createPolygonShape = (input: PolygonShapeInput): PolygonShape => {
    let outerInput: PolygonRingInput | null = null;
    if (input.outer) {
        if (input.winding !== undefined) {
            if (input.outer.winding === undefined) {
                outerInput = { ...input.outer, winding: input.winding };
            } else if (input.outer.winding !== input.winding) {
                throw new ShapeValidationError(
                    `polygon.winding ("${input.winding}") conflicts with polygon.outer.winding ("${input.outer.winding}")`
                );
            } else {
                outerInput = input.outer;
            }
        } else {
            outerInput = input.outer;
        }
    } else if (Array.isArray(input.points)) {
        outerInput = { points: input.points, winding: input.winding };
    }

    if (!outerInput) {
        throw new ShapeValidationError(
            'Polygon shape requires either "outer" ring or "points" array'
        );
    }

    const outer = normalizePolygonRing(outerInput, 'polygon.outer', 'ccw');
    const outerFlat = pointsToFloat32(outer.points);
    const convex = isConvexPolygon(outerFlat);

    const holes: PolygonRing[] = [];
    if (input.holes) {
        for (let i = 0; i < input.holes.length; i++) {
            holes.push(
                normalizePolygonRing(
                    input.holes[i] as PolygonRingInput,
                    `polygon.holes[${i}]`,
                    'cw'
                )
            );
        }

        for (let i = 0; i < holes.length; i++) {
            const holeFlat = pointsToFloat32(holes[i]!.points);
            const holePoint = { x: holeFlat[0] as number, y: holeFlat[1] as number };
            if (!pointInPolygon(outerFlat, holePoint)) {
                throw new ShapeValidationError(
                    `polygon.holes[${i}] is not contained within the outer ring`
                );
            }

            for (let j = 0; j < holes.length; j++) {
                if (i === j) continue;
                const otherFlat = pointsToFloat32(holes[j]!.points);
                if (pointInPolygon(otherFlat, holePoint)) {
                    throw new ShapeValidationError(
                        `polygon.holes[${i}] overlaps with polygon.holes[${j}]`
                    );
                }
            }
        }
    }

    const closed = input.closed ?? true;
    if (!closed) {
        throw new ShapeValidationError('Open polygons are not supported by createPolygonShape');
    }

    return Object.freeze({
        kind: 'polygon',
        outer,
        holes: Object.freeze(holes) as readonly PolygonRing[],
        closed,
        convex,
        ...normalizeAppearance(input),
    });
};

export const isPolygonShape = (value: unknown): value is PolygonShape =>
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'polygon';

export const isRectangleShape = (value: unknown): value is RectangleShape =>
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'rectangle';

export const isCircleShape = (value: unknown): value is CircleShape =>
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'circle';

export const isEllipseShape = (value: unknown): value is EllipseShape =>
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'ellipse';

export const isTriangleShape = (value: unknown): value is TriangleShape =>
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'triangle';

export const isLineShape = (value: unknown): value is LineShape =>
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'line';

export const isShape2D = (value: unknown): value is Shape2D =>
    isRectangleShape(value) ||
    isCircleShape(value) ||
    isEllipseShape(value) ||
    isTriangleShape(value) ||
    isLineShape(value) ||
    isPolygonShape(value);

export const matchShape = <TResult>(
    shape: Shape2D,
    matcher: {
        readonly rectangle: (shape: RectangleShape) => TResult;
        readonly circle: (shape: CircleShape) => TResult;
        readonly ellipse: (shape: EllipseShape) => TResult;
        readonly triangle: (shape: TriangleShape) => TResult;
        readonly line: (shape: LineShape) => TResult;
        readonly polygon: (shape: PolygonShape) => TResult;
    }
): TResult => {
    switch (shape.kind) {
        case 'rectangle':
            return matcher.rectangle(shape);
        case 'circle':
            return matcher.circle(shape);
        case 'ellipse':
            return matcher.ellipse(shape);
        case 'triangle':
            return matcher.triangle(shape);
        case 'line':
            return matcher.line(shape);
        case 'polygon':
            return matcher.polygon(shape);
    }
};
