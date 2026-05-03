import {
    EPSILON,
    assertFiniteNumber,
    assertPositiveNumber,
    clamp01,
    distanceSquared,
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
    RectangleShape,
    RectangleShapeInput,
    Shape2D,
    ShapeAppearance,
    ShapeAppearanceInput,
    ShapeKind,
    TriangleShape,
    TriangleShapeInput,
} from './types';

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

    return Object.freeze({
        kind: 'line',
        start,
        end,
        ...normalizeAppearance(input, false),
    });
};

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
    isLineShape(value);

export const matchShape = <TResult>(
    shape: Shape2D,
    matcher: {
        readonly rectangle: (shape: RectangleShape) => TResult;
        readonly circle: (shape: CircleShape) => TResult;
        readonly ellipse: (shape: EllipseShape) => TResult;
        readonly triangle: (shape: TriangleShape) => TResult;
        readonly line: (shape: LineShape) => TResult;
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
    }
};
