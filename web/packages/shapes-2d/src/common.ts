import type { IVec2Like } from '@axrone/numeric';
import type {
    GradientSpread,
    ShapeApproximationOptions,
    ShapeBounds,
    ShapeFingerprint,
    ShapePointInput,
} from './types';
import { PaintValidationError, ShapeValidationError } from './errors';

export const EPSILON = 1e-9;
export const TAU = Math.PI * 2;
export const DEFAULT_CURVE_TOLERANCE = 0.25;
export const DEFAULT_MIN_CURVE_SEGMENTS = 16;
export const DEFAULT_MAX_CURVE_SEGMENTS = 128;
export const DEFAULT_GRADIENT_LOOKUP_SIZE = 256;
export const DEFAULT_REGISTRY_MAX_SHAPES = 2048;
export const DEFAULT_REGISTRY_MAX_COMPILED = 4096;

export const clamp = (value: number, min: number, max: number): number =>
    value < min ? min : value > max ? max : value;

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

export const normalizeNumberKey = (value: number): string =>
    Object.is(value, -0) ? '0' : Number.isInteger(value) ? `${value}` : `${value}`;

export const assertFiniteNumber = (value: unknown, name: string): number => {
    if (!isFiniteNumber(value)) {
        throw new ShapeValidationError(`${name} must be a finite number`);
    }
    return value;
};

export const assertPositiveNumber = (value: unknown, name: string): number => {
    const normalized = assertFiniteNumber(value, name);
    if (normalized <= 0) {
        throw new ShapeValidationError(`${name} must be greater than 0`);
    }
    return normalized;
};

export const assertNonNegativeNumber = (value: unknown, name: string): number => {
    const normalized = assertFiniteNumber(value, name);
    if (normalized < 0) {
        throw new ShapeValidationError(`${name} must be greater than or equal to 0`);
    }
    return normalized;
};

export const toPoint = (value: ShapePointInput, name: string): Readonly<IVec2Like> => {
    if (Array.isArray(value)) {
        if (value.length < 2) {
            throw new ShapeValidationError(`${name} must have at least two numeric values`);
        }

        return Object.freeze({
            x: assertFiniteNumber(value[0], `${name}[0]`),
            y: assertFiniteNumber(value[1], `${name}[1]`),
        });
    }

    if (value && typeof value === 'object' && 'x' in value && 'y' in value) {
        return Object.freeze({
            x: assertFiniteNumber(value.x, `${name}.x`),
            y: assertFiniteNumber(value.y, `${name}.y`),
        });
    }

    throw new ShapeValidationError(`${name} must be a point-like value`);
};

export const createBounds = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number
): ShapeBounds => {
    const safeMinX = Math.min(minX, maxX);
    const safeMaxX = Math.max(minX, maxX);
    const safeMinY = Math.min(minY, maxY);
    const safeMaxY = Math.max(minY, maxY);

    return Object.freeze({
        minX: safeMinX,
        minY: safeMinY,
        maxX: safeMaxX,
        maxY: safeMaxY,
        width: safeMaxX - safeMinX,
        height: safeMaxY - safeMinY,
        centerX: (safeMinX + safeMaxX) * 0.5,
        centerY: (safeMinY + safeMaxY) * 0.5,
    });
};

export const expandBounds = (bounds: ShapeBounds, amount: number): ShapeBounds =>
    createBounds(
        bounds.minX - amount,
        bounds.minY - amount,
        bounds.maxX + amount,
        bounds.maxY + amount
    );

export const pointInBounds = (bounds: ShapeBounds, point: Readonly<IVec2Like>): boolean =>
    point.x >= bounds.minX - EPSILON &&
    point.x <= bounds.maxX + EPSILON &&
    point.y >= bounds.minY - EPSILON &&
    point.y <= bounds.maxY + EPSILON;

export const distanceSquared = (
    ax: number,
    ay: number,
    bx: number,
    by: number
): number => {
    const dx = bx - ax;
    const dy = by - ay;
    return dx * dx + dy * dy;
};

export const distance = (ax: number, ay: number, bx: number, by: number): number =>
    Math.sqrt(distanceSquared(ax, ay, bx, by));

export const distanceToSegmentSquared = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
): number => {
    const abx = bx - ax;
    const aby = by - ay;
    const abLengthSquared = abx * abx + aby * aby;

    if (abLengthSquared <= EPSILON) {
        return distanceSquared(px, py, ax, ay);
    }

    const t = clamp(((px - ax) * abx + (py - ay) * aby) / abLengthSquared, 0, 1);
    const cx = ax + abx * t;
    const cy = ay + aby * t;
    return distanceSquared(px, py, cx, cy);
};

export const polygonSignedArea = (points: ArrayLike<number>): number => {
    const count = Math.floor(points.length / 2);
    let area = 0;

    for (let index = 0; index < count; index++) {
        const current = index * 2;
        const next = ((index + 1) % count) * 2;
        area += points[current] * points[next + 1] - points[current + 1] * points[next];
    }

    return area * 0.5;
};

export const pointInConvexPolygon = (
    points: ArrayLike<number>,
    point: Readonly<IVec2Like>
): boolean => {
    const count = Math.floor(points.length / 2);
    if (count < 3) {
        return false;
    }

    const winding = polygonSignedArea(points) >= 0 ? 1 : -1;

    for (let index = 0; index < count; index++) {
        const current = index * 2;
        const next = ((index + 1) % count) * 2;
        const edgeX = points[next] - points[current];
        const edgeY = points[next + 1] - points[current + 1];
        const pointX = point.x - points[current];
        const pointY = point.y - points[current + 1];
        const cross = edgeX * pointY - edgeY * pointX;

        if (cross * winding < -EPSILON) {
            return false;
        }
    }

    return true;
};

export const normalizeContourOrientation = (
    contour: Float32Array,
    ccw: boolean = true
): Float32Array => {
    const area = polygonSignedArea(contour);
    const isCcw = area >= 0;
    if (isCcw === ccw) {
        return contour;
    }

    const reversed = new Float32Array(contour.length);
    const count = contour.length / 2;

    for (let index = 0; index < count; index++) {
        const source = ((count - index) % count) * 2;
        const target = index * 2;
        reversed[target] = contour[source];
        reversed[target + 1] = contour[source + 1];
    }

    return reversed;
};

export const toIndexArray = (
    indices: readonly number[],
    vertexCount: number
): Uint16Array | Uint32Array =>
    vertexCount <= 65535 ? new Uint16Array(indices) : new Uint32Array(indices);

export const approximateCurveSegments = (
    radiusX: number,
    radiusY: number,
    options: ShapeApproximationOptions = {}
): number => {
    const tolerance = Math.max(options.curveTolerance ?? DEFAULT_CURVE_TOLERANCE, EPSILON);
    const minSegments = Math.max(3, Math.floor(options.minCurveSegments ?? DEFAULT_MIN_CURVE_SEGMENTS));
    const maxSegments = Math.max(
        minSegments,
        Math.floor(options.maxCurveSegments ?? DEFAULT_MAX_CURVE_SEGMENTS)
    );
    const radius = Math.max(Math.abs(radiusX), Math.abs(radiusY));

    if (radius <= EPSILON) {
        return minSegments;
    }

    const ratio = clamp(1 - tolerance / radius, -1, 1);
    const theta = Math.max(EPSILON, 2 * Math.acos(ratio));
    const segments = Math.ceil(TAU / theta);
    return clamp(segments, minSegments, maxSegments);
};

export const applyGradientSpread = (value: number, spread: GradientSpread): number => {
    if (!Number.isFinite(value)) {
        throw new PaintValidationError('Gradient sample value must be finite');
    }

    switch (spread) {
        case 'pad':
            return clamp01(value);
        case 'repeat': {
            const normalized = value % 1;
            return normalized < 0 ? normalized + 1 : normalized;
        }
        case 'reflect': {
            const wrapped = Math.abs(value % 2);
            return wrapped > 1 ? 2 - wrapped : wrapped;
        }
        default:
            return clamp01(value);
    }
};

export const hashString = (value: string): string => {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
};

export const formatPointKey = (point: Readonly<IVec2Like>): string =>
    `${normalizeNumberKey(point.x)},${normalizeNumberKey(point.y)}`;

export const formatBoundsKey = (bounds: ShapeBounds): string =>
    `${normalizeNumberKey(bounds.minX)},${normalizeNumberKey(bounds.minY)},${normalizeNumberKey(bounds.maxX)},${normalizeNumberKey(bounds.maxY)}`;

export const withFingerprintPrefix = <K extends string>(
    prefix: K,
    value: string
): `${K}:${string}` => `${prefix}:${value}`;
