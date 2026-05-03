import type { IVec2Like } from '@axrone/numeric';
import { createBounds, toPoint } from './common';
import { modulatePaintAlpha, samplePaint } from './paint';
import {
    containsGeometryPoint,
    containsStrokePoint,
    getGeometryBounds,
    getShapeArea as getShapeAreaInternal,
    getShapeBounds as getShapeBoundsInternal,
    getShapeCentroid as getShapeCentroidInternal,
    getShapePerimeter as getShapePerimeterInternal,
} from './geometry';
import type {
    Shape2D,
    ShapeApproximationOptions,
    ShapeBounds,
    ResolvedColor,
    ShapeHitTarget,
    ShapePointInput,
} from './types';

export interface ShapeBoundsQueryOptions extends ShapeApproximationOptions {
    readonly includeStroke?: boolean;
}

export const getShapeBounds = (
    shape: Shape2D,
    options: ShapeBoundsQueryOptions = {}
): ShapeBounds =>
    options.includeStroke === false
        ? getGeometryBounds(shape)
        : getShapeBoundsInternal(shape, options);

export const getShapeArea = (shape: Shape2D): number => getShapeAreaInternal(shape);

export const getShapePerimeter = (shape: Shape2D): number => getShapePerimeterInternal(shape);

export const getShapeCentroid = (shape: Shape2D): Readonly<IVec2Like> =>
    getShapeCentroidInternal(shape);

export const containsPoint = (shape: Shape2D, point: ShapePointInput): boolean =>
    containsGeometryPoint(shape, toPoint(point, 'shape point'));

export const hitTestShape = (
    shape: Shape2D,
    point: ShapePointInput,
    options: ShapeApproximationOptions = {}
): ShapeHitTarget => {
    if (!shape.visible || shape.opacity <= 0) {
        return 'none';
    }

    const normalizedPoint = toPoint(point, 'shape point');

    if (shape.stroke && containsStrokePoint(shape, normalizedPoint, options)) {
        return 'stroke';
    }

    if (shape.fill && containsGeometryPoint(shape, normalizedPoint)) {
        return 'fill';
    }

    return 'none';
};

export const sampleShapePaint = (
    shape: Shape2D,
    target: Exclude<ShapeHitTarget, 'none'>,
    point: ShapePointInput,
    options: ShapeApproximationOptions = {}
): ResolvedColor | null => {
    if (!shape.visible || shape.opacity <= 0) {
        return null;
    }

    const normalizedPoint = toPoint(point, 'shape paint point');
    if (target === 'fill') {
        if (!shape.fill || !containsGeometryPoint(shape, normalizedPoint)) {
            return null;
        }

        return modulatePaintAlpha(
            samplePaint(shape.fill, normalizedPoint, getGeometryBounds(shape)),
            shape.opacity
        );
    }

    if (!shape.stroke || !containsStrokePoint(shape, normalizedPoint, options)) {
        return null;
    }

    return modulatePaintAlpha(
        samplePaint(shape.stroke.paint, normalizedPoint, getShapeBoundsInternal(shape, options)),
        shape.opacity
    );
};
