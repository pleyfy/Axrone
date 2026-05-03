import { hashString } from './common';
import { SerializationError } from './errors';
import { createPaint, createStroke } from './paint';
import {
    createCircleShape,
    createEllipseShape,
    createLineShape,
    createRectangleShape,
    createTriangleShape,
} from './shape';
import type {
    GradientStopInput,
    ResolvedColor,
    Shape2D,
    ShapeFingerprint,
    ShapePaint,
    ShapeStroke,
    ShapeStrokeAlignment,
} from './types';

export interface SerializedSolidPaint {
    readonly type: 'paint/solid';
    readonly color: readonly [number, number, number, number];
}

export interface SerializedLinearGradientPaint {
    readonly type: 'paint/linear-gradient';
    readonly start: readonly [number, number];
    readonly end: readonly [number, number];
    readonly stops: readonly {
        readonly offset: number;
        readonly color: readonly [number, number, number, number];
    }[];
    readonly spread: 'pad' | 'repeat' | 'reflect';
    readonly colorSpace: 'srgb' | 'linear-srgb' | 'hsl' | 'lab';
    readonly units: 'local' | 'shape-bounds';
}

export interface SerializedRadialGradientPaint {
    readonly type: 'paint/radial-gradient';
    readonly center: readonly [number, number];
    readonly radius: number;
    readonly stops: readonly {
        readonly offset: number;
        readonly color: readonly [number, number, number, number];
    }[];
    readonly spread: 'pad' | 'repeat' | 'reflect';
    readonly colorSpace: 'srgb' | 'linear-srgb' | 'hsl' | 'lab';
    readonly units: 'local' | 'shape-bounds';
}

export type SerializedPaint =
    | SerializedSolidPaint
    | SerializedLinearGradientPaint
    | SerializedRadialGradientPaint;

export interface SerializedStroke {
    readonly width: number;
    readonly alignment: ShapeStrokeAlignment;
    readonly paint: SerializedPaint;
}

interface SerializedAppearance {
    readonly fill: SerializedPaint | null;
    readonly stroke: SerializedStroke | null;
    readonly opacity: number;
    readonly visible: boolean;
    readonly name?: string;
}

export interface SerializedRectangleShape extends SerializedAppearance {
    readonly type: 'shape/rectangle';
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface SerializedCircleShape extends SerializedAppearance {
    readonly type: 'shape/circle';
    readonly cx: number;
    readonly cy: number;
    readonly radius: number;
}

export interface SerializedEllipseShape extends SerializedAppearance {
    readonly type: 'shape/ellipse';
    readonly cx: number;
    readonly cy: number;
    readonly radiusX: number;
    readonly radiusY: number;
}

export interface SerializedTriangleShape extends SerializedAppearance {
    readonly type: 'shape/triangle';
    readonly a: readonly [number, number];
    readonly b: readonly [number, number];
    readonly c: readonly [number, number];
}

export interface SerializedLineShape extends SerializedAppearance {
    readonly type: 'shape/line';
    readonly start: readonly [number, number];
    readonly end: readonly [number, number];
}

export type SerializedShape =
    | SerializedRectangleShape
    | SerializedCircleShape
    | SerializedEllipseShape
    | SerializedTriangleShape
    | SerializedLineShape;

const serializeColor = (color: ResolvedColor): readonly [number, number, number, number] => [
    color.r,
    color.g,
    color.b,
    color.a,
] as const;

const serializeStops = (
    stops: readonly {
        readonly offset: number;
        readonly color: ResolvedColor;
    }[]
): readonly {
    readonly offset: number;
    readonly color: readonly [number, number, number, number];
}[] =>
    stops.map((stop) => ({
        offset: stop.offset,
        color: serializeColor(stop.color),
    })) as readonly {
        readonly offset: number;
        readonly color: readonly [number, number, number, number];
    }[];

export const serializePaint = (paint: ShapePaint): SerializedPaint => {
    switch (paint.kind) {
        case 'solid':
            return {
                type: 'paint/solid',
                color: serializeColor(paint.color),
            };
        case 'linear-gradient':
            return {
                type: 'paint/linear-gradient',
                start: [paint.start.x, paint.start.y] as const,
                end: [paint.end.x, paint.end.y] as const,
                stops: serializeStops(paint.stops),
                spread: paint.spread,
                colorSpace: paint.colorSpace,
                units: paint.units,
            };
        case 'radial-gradient':
            return {
                type: 'paint/radial-gradient',
                center: [paint.center.x, paint.center.y] as const,
                radius: paint.radius,
                stops: serializeStops(paint.stops),
                spread: paint.spread,
                colorSpace: paint.colorSpace,
                units: paint.units,
            };
    }
};

export const serializeStroke = (stroke: ShapeStroke): SerializedStroke => ({
    width: stroke.width,
    alignment: stroke.alignment,
    paint: serializePaint(stroke.paint),
});

export const serializeShape = (shape: Shape2D): SerializedShape => {
    const appearance = {
        fill: shape.fill ? serializePaint(shape.fill) : null,
        stroke: shape.stroke ? serializeStroke(shape.stroke) : null,
        opacity: shape.opacity,
        visible: shape.visible,
        ...(shape.name ? { name: shape.name } : {}),
    };

    switch (shape.kind) {
        case 'rectangle':
            return {
                type: 'shape/rectangle',
                x: shape.x,
                y: shape.y,
                width: shape.width,
                height: shape.height,
                ...appearance,
            };
        case 'circle':
            return {
                type: 'shape/circle',
                cx: shape.cx,
                cy: shape.cy,
                radius: shape.radius,
                ...appearance,
            };
        case 'ellipse':
            return {
                type: 'shape/ellipse',
                cx: shape.cx,
                cy: shape.cy,
                radiusX: shape.radiusX,
                radiusY: shape.radiusY,
                ...appearance,
            };
        case 'triangle':
            return {
                type: 'shape/triangle',
                a: [shape.a.x, shape.a.y] as const,
                b: [shape.b.x, shape.b.y] as const,
                c: [shape.c.x, shape.c.y] as const,
                ...appearance,
            };
        case 'line':
            return {
                type: 'shape/line',
                start: [shape.start.x, shape.start.y] as const,
                end: [shape.end.x, shape.end.y] as const,
                ...appearance,
            };
    }
};

const asStops = (
    stops: readonly {
        readonly offset: number;
        readonly color: readonly [number, number, number, number];
    }[]
): readonly GradientStopInput[] =>
    stops.map((stop) => ({
        offset: stop.offset,
        color: stop.color,
    }));

export const deserializePaint = (paint: SerializedPaint): ShapePaint => {
    switch (paint.type) {
        case 'paint/solid':
            return createPaint(paint.color);
        case 'paint/linear-gradient':
            return createPaint({
                start: paint.start,
                end: paint.end,
                stops: asStops(paint.stops),
                spread: paint.spread,
                colorSpace: paint.colorSpace,
                units: paint.units,
            });
        case 'paint/radial-gradient':
            return createPaint({
                center: paint.center,
                radius: paint.radius,
                stops: asStops(paint.stops),
                spread: paint.spread,
                colorSpace: paint.colorSpace,
                units: paint.units,
            });
        default:
            throw new SerializationError('Unsupported serialized paint type');
    }
};

export const deserializeStroke = (stroke: SerializedStroke): ShapeStroke =>
    createStroke({
        width: stroke.width,
        alignment: stroke.alignment,
        paint: deserializePaint(stroke.paint),
    });

export const deserializeShape = (shape: SerializedShape): Shape2D => {
    const appearance = {
        fill: shape.fill ? deserializePaint(shape.fill) : null,
        stroke: shape.stroke ? deserializeStroke(shape.stroke) : null,
        opacity: shape.opacity,
        visible: shape.visible,
        name: shape.name,
    };

    switch (shape.type) {
        case 'shape/rectangle':
            return createRectangleShape({
                x: shape.x,
                y: shape.y,
                width: shape.width,
                height: shape.height,
                ...appearance,
            });
        case 'shape/circle':
            return createCircleShape({
                cx: shape.cx,
                cy: shape.cy,
                radius: shape.radius,
                ...appearance,
            });
        case 'shape/ellipse':
            return createEllipseShape({
                cx: shape.cx,
                cy: shape.cy,
                radiusX: shape.radiusX,
                radiusY: shape.radiusY,
                ...appearance,
            });
        case 'shape/triangle':
            return createTriangleShape({
                a: shape.a,
                b: shape.b,
                c: shape.c,
                ...appearance,
            });
        case 'shape/line':
            return createLineShape({
                start: shape.start,
                end: shape.end,
                ...appearance,
            });
        default:
            throw new SerializationError('Unsupported serialized shape type');
    }
};

export const stringifyPaint = (paint: ShapePaint): string => JSON.stringify(serializePaint(paint));

export const stringifyShape = (shape: Shape2D): string => JSON.stringify(serializeShape(shape));

export const createShapeFingerprint = <TShape extends Shape2D>(
    shape: TShape
): ShapeFingerprint<TShape['kind']> =>
    `${shape.kind}:${hashString(stringifyShape(shape))}` as ShapeFingerprint<TShape['kind']>;
