import { Color } from '@axrone/numeric';
import type { IColorLike, IVec2Like } from '@axrone/numeric';
import {
    DEFAULT_GRADIENT_LOOKUP_SIZE,
    EPSILON,
    applyGradientSpread,
    assertFiniteNumber,
    assertPositiveNumber,
    clamp01,
    formatPointKey,
    hashString,
    normalizeNumberKey,
    toPoint,
} from './common';
import { PaintValidationError } from './errors';
import type {
    GradientColorSpace,
    GradientStop,
    GradientStopInput,
    LinearGradientPaint,
    LinearGradientPaintInput,
    RadialGradientPaint,
    RadialGradientPaintInput,
    ResolvedColor,
    ShapeBounds,
    ShapeColorInput,
    ShapePaint,
    ShapePaintInput,
    ShapePointInput,
    ShapeStroke,
    ShapeStrokeInput,
    SolidPaint,
} from './types';

const gradientLookupCache = new WeakMap<
    LinearGradientPaint | RadialGradientPaint,
    Map<number, Float32Array>
>();

const isColorLikeObject = (value: unknown): value is ShapeColorInput =>
    typeof value === 'string' ||
    Array.isArray(value) ||
    !!(
        value &&
        typeof value === 'object' &&
        'r' in value &&
        'g' in value &&
        'b' in value &&
        !('kind' in value)
    );

const asResolvedColor = (color: Color): ResolvedColor =>
    Object.freeze({
        r: color.r,
        g: color.g,
        b: color.b,
        a: color.a,
    });

const normalizeColorSpace = (value: GradientColorSpace | undefined): GradientColorSpace =>
    value ?? 'srgb';

const resolveBoundsPoint = (
    point: Readonly<IVec2Like>,
    bounds: ShapeBounds,
    units: 'local' | 'shape-bounds'
): Readonly<IVec2Like> =>
    units === 'local'
        ? point
        : {
              x: bounds.minX + bounds.width * point.x,
              y: bounds.minY + bounds.height * point.y,
          };

const resolveBoundsRadius = (
    radius: number,
    bounds: ShapeBounds,
    units: 'local' | 'shape-bounds'
): number => (units === 'local' ? radius : Math.max(bounds.width, bounds.height) * radius);

const interpolateLinearSrgb = (
    left: ResolvedColor,
    right: ResolvedColor,
    factor: number
): ResolvedColor => {
    const toLinear = (value: number): number =>
        value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    const toSrgb = (value: number): number =>
        value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
    const lR = toLinear(left.r);
    const lG = toLinear(left.g);
    const lB = toLinear(left.b);
    const rR = toLinear(right.r);
    const rG = toLinear(right.g);
    const rB = toLinear(right.b);

    return {
        r: clamp01(toSrgb(lR + (rR - lR) * factor)),
        g: clamp01(toSrgb(lG + (rG - lG) * factor)),
        b: clamp01(toSrgb(lB + (rB - lB) * factor)),
        a: clamp01(left.a + (right.a - left.a) * factor),
    };
};

const interpolateColor = (
    left: ResolvedColor,
    right: ResolvedColor,
    factor: number,
    colorSpace: GradientColorSpace
): ResolvedColor => {
    switch (colorSpace) {
        case 'linear-srgb':
            return interpolateLinearSrgb(left, right, factor);
        case 'hsl':
            return Color.lerpHSL(left, right, factor);
        case 'lab':
            return Color.lerpLab(left, right, factor);
        default:
            return Color.lerp(left, right, factor);
    }
};

const normalizeGradientStop = (input: GradientStopInput): GradientStop => {
    const offset = assertFiniteNumber(input.offset, 'gradient stop offset');
    if (offset < 0 || offset > 1) {
        throw new PaintValidationError('Gradient stop offset must be between 0 and 1');
    }

    return Object.freeze({
        offset,
        color: createColor(input.color),
    });
};

const normalizeStops = (stops: readonly GradientStopInput[]): readonly GradientStop[] => {
    if (stops.length === 0) {
        throw new PaintValidationError('Gradient must have at least one color stop');
    }

    return Object.freeze(
        stops
            .map(normalizeGradientStop)
            .slice()
            .sort((left, right) => left.offset - right.offset)
    );
};

const sampleStops = (
    stops: readonly GradientStop[],
    sample: number,
    colorSpace: GradientColorSpace
): ResolvedColor => {
    if (stops.length === 1) {
        const single = stops[0];
        return {
            r: single.color.r,
            g: single.color.g,
            b: single.color.b,
            a: single.color.a,
        };
    }

    if (sample <= stops[0]!.offset) {
        const first = stops[0]!;
        return {
            r: first.color.r,
            g: first.color.g,
            b: first.color.b,
            a: first.color.a,
        };
    }

    const last = stops[stops.length - 1]!;
    if (sample >= last.offset) {
        return {
            r: last.color.r,
            g: last.color.g,
            b: last.color.b,
            a: last.color.a,
        };
    }

    for (let index = 0; index < stops.length - 1; index++) {
        const left = stops[index]!;
        const right = stops[index + 1]!;
        if (sample >= left.offset && sample <= right.offset) {
            const range = right.offset - left.offset;
            const factor = range <= EPSILON ? 0 : (sample - left.offset) / range;
            return interpolateColor(left.color, right.color, factor, colorSpace);
        }
    }

    return {
        r: last.color.r,
        g: last.color.g,
        b: last.color.b,
        a: last.color.a,
    };
};

const createGradientCacheKey = (
    paint: LinearGradientPaint | RadialGradientPaint,
    size: number
): number => {
    if (size < 2 || !Number.isFinite(size)) {
        throw new PaintValidationError('Gradient lookup table size must be at least 2');
    }
    return Math.floor(size);
};

export const createColor = (value: ShapeColorInput): ResolvedColor => {
    if (typeof value === 'string') {
        const normalized = value.trim();
        if (normalized.length === 0) {
            throw new PaintValidationError('Color string must not be empty');
        }

        try {
            if (normalized.startsWith('#')) {
                return asResolvedColor(Color.fromHex(normalized));
            }
            return asResolvedColor(Color.fromNamedColor(normalized));
        } catch (error) {
            throw new PaintValidationError(`Unsupported color string: ${normalized}`, {
                cause: error,
            });
        }
    }

    if (Array.isArray(value)) {
        if (value.length < 3) {
            throw new PaintValidationError('Color tuple must include at least three channels');
        }

        const r = assertFiniteNumber(value[0], 'color[0]');
        const g = assertFiniteNumber(value[1], 'color[1]');
        const b = assertFiniteNumber(value[2], 'color[2]');
        const a = value.length > 3 ? assertFiniteNumber(value[3], 'color[3]') : 1;
        return asResolvedColor(Color.fromRGB(r, g, b, a));
    }

    if (value && typeof value === 'object' && 'r' in value && 'g' in value && 'b' in value) {
        const alpha = 'a' in value ? value.a : 1;
        return asResolvedColor(
            Color.fromRGB(
                assertFiniteNumber(value.r, 'color.r'),
                assertFiniteNumber(value.g, 'color.g'),
                assertFiniteNumber(value.b, 'color.b'),
                assertFiniteNumber(alpha, 'color.a')
            )
        );
    }

    throw new PaintValidationError('Unsupported color input');
};

export const isSolidPaint = (value: unknown): value is SolidPaint =>
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'solid';

export const isLinearGradientPaint = (value: unknown): value is LinearGradientPaint =>
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'linear-gradient';

export const isRadialGradientPaint = (value: unknown): value is RadialGradientPaint =>
    !!value && typeof value === 'object' && 'kind' in value && value.kind === 'radial-gradient';

export const isGradientPaint = (
    value: unknown
): value is LinearGradientPaint | RadialGradientPaint =>
    isLinearGradientPaint(value) || isRadialGradientPaint(value);

export const isShapePaint = (value: unknown): value is ShapePaint =>
    isSolidPaint(value) || isLinearGradientPaint(value) || isRadialGradientPaint(value);

export const createGradientStop = (offset: number, color: ShapeColorInput): GradientStop =>
    normalizeGradientStop({ offset, color });

export const createSolidPaint = (color: ShapeColorInput): SolidPaint =>
    Object.freeze({
        kind: 'solid',
        color: createColor(color),
    });

export const createLinearGradientPaint = (input: LinearGradientPaintInput): LinearGradientPaint =>
    Object.freeze({
        kind: 'linear-gradient',
        start: toPoint(input.start, 'linearGradient.start'),
        end: toPoint(input.end, 'linearGradient.end'),
        stops: normalizeStops(input.stops),
        spread: input.spread ?? 'pad',
        colorSpace: normalizeColorSpace(input.colorSpace),
        units: input.units ?? 'shape-bounds',
    });

export const createRadialGradientPaint = (input: RadialGradientPaintInput): RadialGradientPaint =>
    Object.freeze({
        kind: 'radial-gradient',
        center: toPoint(input.center, 'radialGradient.center'),
        radius: assertPositiveNumber(input.radius, 'radialGradient.radius'),
        stops: normalizeStops(input.stops),
        spread: input.spread ?? 'pad',
        colorSpace: normalizeColorSpace(input.colorSpace),
        units: input.units ?? 'shape-bounds',
    });

export const createPaint = (input: ShapePaintInput): ShapePaint => {
    if (isSolidPaint(input)) {
        return createSolidPaint(input.color);
    }

    if (isLinearGradientPaint(input)) {
        return createLinearGradientPaint(input);
    }

    if (isRadialGradientPaint(input)) {
        return createRadialGradientPaint(input);
    }

    if (isColorLikeObject(input)) {
        return createSolidPaint(input);
    }

    if (input && typeof input === 'object' && 'start' in input && 'end' in input) {
        return createLinearGradientPaint(input as LinearGradientPaintInput);
    }

    if (input && typeof input === 'object' && 'center' in input && 'radius' in input) {
        return createRadialGradientPaint(input as RadialGradientPaintInput);
    }

    throw new PaintValidationError('Unsupported paint input');
};

export const createStroke = (input: ShapeStrokeInput): ShapeStroke =>
    Object.freeze({
        paint: createPaint(input.paint),
        width: assertPositiveNumber(input.width, 'stroke.width'),
        alignment: input.alignment ?? 'center',
    });

export const createGradientLookupTable = (
    paint: LinearGradientPaint | RadialGradientPaint,
    size: number = DEFAULT_GRADIENT_LOOKUP_SIZE
): Float32Array => {
    const cacheKey = createGradientCacheKey(paint, size);
    let cacheBySize = gradientLookupCache.get(paint);
    if (!cacheBySize) {
        cacheBySize = new Map<number, Float32Array>();
        gradientLookupCache.set(paint, cacheBySize);
    }

    const cached = cacheBySize.get(cacheKey);
    if (cached) {
        return cached;
    }

    const table = new Float32Array(cacheKey * 4);

    for (let index = 0; index < cacheKey; index++) {
        const time = cacheKey === 1 ? 0 : index / (cacheKey - 1);
        const sampled = sampleStops(paint.stops, time, paint.colorSpace);
        const offset = index * 4;
        table[offset] = sampled.r;
        table[offset + 1] = sampled.g;
        table[offset + 2] = sampled.b;
        table[offset + 3] = sampled.a;
    }

    cacheBySize.set(cacheKey, table);
    return table;
};

const sampleLookupTable = (
    table: Float32Array,
    sample: number
): ResolvedColor => {
    const position = clamp01(sample) * (table.length / 4 - 1);
    const leftIndex = Math.floor(position);
    const rightIndex = Math.min(leftIndex + 1, table.length / 4 - 1);
    const factor = position - leftIndex;
    const leftOffset = leftIndex * 4;
    const rightOffset = rightIndex * 4;

    return {
        r: table[leftOffset] + (table[rightOffset] - table[leftOffset]) * factor,
        g: table[leftOffset + 1] + (table[rightOffset + 1] - table[leftOffset + 1]) * factor,
        b: table[leftOffset + 2] + (table[rightOffset + 2] - table[leftOffset + 2]) * factor,
        a: table[leftOffset + 3] + (table[rightOffset + 3] - table[leftOffset + 3]) * factor,
    };
};

export const samplePaint = (
    paint: ShapePaint,
    point: ShapePointInput,
    bounds?: ShapeBounds,
    lookupTableSize: number = DEFAULT_GRADIENT_LOOKUP_SIZE
): ResolvedColor => {
    if (paint.kind === 'solid') {
        return {
            r: paint.color.r,
            g: paint.color.g,
            b: paint.color.b,
            a: paint.color.a,
        };
    }

    const resolvedPoint = toPoint(point, 'paint sample point');

    if (!bounds && paint.units === 'shape-bounds') {
        throw new PaintValidationError('Bounds are required when sampling a bounds-relative paint');
    }

    if (paint.kind === 'linear-gradient') {
        const start = bounds ? resolveBoundsPoint(paint.start, bounds, paint.units) : paint.start;
        const end = bounds ? resolveBoundsPoint(paint.end, bounds, paint.units) : paint.end;
        const dirX = end.x - start.x;
        const dirY = end.y - start.y;
        const lengthSquared = dirX * dirX + dirY * dirY;
        const rawSample =
            lengthSquared <= EPSILON
                ? 0
                : ((resolvedPoint.x - start.x) * dirX + (resolvedPoint.y - start.y) * dirY) /
                  lengthSquared;
        const sample = applyGradientSpread(rawSample, paint.spread);
        const table = createGradientLookupTable(paint, lookupTableSize);
        return sampleLookupTable(table, sample);
    }

    const center = bounds ? resolveBoundsPoint(paint.center, bounds, paint.units) : paint.center;
    const radius = bounds
        ? resolveBoundsRadius(paint.radius, bounds, paint.units)
        : paint.radius;
    const safeRadius = Math.max(radius, EPSILON);
    const rawSample =
        Math.sqrt(
            (resolvedPoint.x - center.x) * (resolvedPoint.x - center.x) +
                (resolvedPoint.y - center.y) * (resolvedPoint.y - center.y)
        ) / safeRadius;
    const sample = applyGradientSpread(rawSample, paint.spread);
    const table = createGradientLookupTable(paint, lookupTableSize);
    return sampleLookupTable(table, sample);
};

export const modulatePaintAlpha = (color: Readonly<IColorLike>, opacity: number): ResolvedColor => ({
    r: color.r,
    g: color.g,
    b: color.b,
    a: clamp01((color.a ?? 1) * clamp01(opacity)),
});

export const createPaintFingerprint = (paint: ShapePaint): string => {
    if (paint.kind === 'solid') {
        return `solid:${normalizeNumberKey(paint.color.r)}:${normalizeNumberKey(paint.color.g)}:${normalizeNumberKey(paint.color.b)}:${normalizeNumberKey(paint.color.a)}`;
    }

    if (paint.kind === 'linear-gradient') {
        const stops = paint.stops
            .map(
                (stop) =>
                    `${normalizeNumberKey(stop.offset)}:${normalizeNumberKey(stop.color.r)}:${normalizeNumberKey(stop.color.g)}:${normalizeNumberKey(stop.color.b)}:${normalizeNumberKey(stop.color.a)}`
            )
            .join('|');
        return `linear:${formatPointKey(paint.start)}:${formatPointKey(paint.end)}:${paint.units}:${paint.spread}:${paint.colorSpace}:${hashString(stops)}`;
    }

    const stops = paint.stops
        .map(
            (stop) =>
                `${normalizeNumberKey(stop.offset)}:${normalizeNumberKey(stop.color.r)}:${normalizeNumberKey(stop.color.g)}:${normalizeNumberKey(stop.color.b)}:${normalizeNumberKey(stop.color.a)}`
        )
        .join('|');
    return `radial:${formatPointKey(paint.center)}:${normalizeNumberKey(paint.radius)}:${paint.units}:${paint.spread}:${paint.colorSpace}:${hashString(stops)}`;
};
