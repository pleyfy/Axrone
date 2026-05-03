import type { IColorLike, IVec2Like } from '@axrone/numeric';

export type ShapeId = `shape_${number}`;

export type ShapeVec2Tuple = readonly [number, number];
export type ShapePointInput = Readonly<IVec2Like> | ShapeVec2Tuple;

export type ShapeColorTuple =
    | readonly [number, number, number]
    | readonly [number, number, number, number];

export type ShapeColorInput = string | Readonly<IColorLike> | ShapeColorTuple;
export type ResolvedColor = Readonly<Required<IColorLike>>;

export interface GradientStop {
    readonly offset: number;
    readonly color: ResolvedColor;
}

export interface GradientStopInput {
    readonly offset: number;
    readonly color: ShapeColorInput;
}

export type GradientSpread = 'pad' | 'repeat' | 'reflect';
export type GradientColorSpace = 'srgb' | 'linear-srgb' | 'hsl' | 'lab';
export type GradientUnits = 'local' | 'shape-bounds';

export interface SolidPaint {
    readonly kind: 'solid';
    readonly color: ResolvedColor;
}

export interface LinearGradientPaint {
    readonly kind: 'linear-gradient';
    readonly start: Readonly<IVec2Like>;
    readonly end: Readonly<IVec2Like>;
    readonly stops: readonly GradientStop[];
    readonly spread: GradientSpread;
    readonly colorSpace: GradientColorSpace;
    readonly units: GradientUnits;
}

export interface RadialGradientPaint {
    readonly kind: 'radial-gradient';
    readonly center: Readonly<IVec2Like>;
    readonly radius: number;
    readonly stops: readonly GradientStop[];
    readonly spread: GradientSpread;
    readonly colorSpace: GradientColorSpace;
    readonly units: GradientUnits;
}

export type ShapePaint = SolidPaint | LinearGradientPaint | RadialGradientPaint;

export interface LinearGradientPaintInput {
    readonly start: ShapePointInput;
    readonly end: ShapePointInput;
    readonly stops: readonly GradientStopInput[];
    readonly spread?: GradientSpread;
    readonly colorSpace?: GradientColorSpace;
    readonly units?: GradientUnits;
}

export interface RadialGradientPaintInput {
    readonly center: ShapePointInput;
    readonly radius: number;
    readonly stops: readonly GradientStopInput[];
    readonly spread?: GradientSpread;
    readonly colorSpace?: GradientColorSpace;
    readonly units?: GradientUnits;
}

export type ShapePaintInput =
    | ShapePaint
    | ShapeColorInput
    | LinearGradientPaintInput
    | RadialGradientPaintInput;

export type ShapeStrokeAlignment = 'center' | 'inside' | 'outside';

export interface ShapeStroke {
    readonly paint: ShapePaint;
    readonly width: number;
    readonly alignment: ShapeStrokeAlignment;
}

export interface ShapeStrokeInput {
    readonly paint: ShapePaintInput;
    readonly width: number;
    readonly alignment?: ShapeStrokeAlignment;
}

export interface ShapeAppearance {
    readonly fill: ShapePaint | null;
    readonly stroke: ShapeStroke | null;
    readonly opacity: number;
    readonly visible: boolean;
    readonly name?: string;
}

export interface ShapeAppearanceInput {
    readonly fill?: ShapePaintInput | null;
    readonly stroke?: ShapeStrokeInput | null;
    readonly opacity?: number;
    readonly visible?: boolean;
    readonly name?: string | null;
}

interface BaseShape<K extends string> extends ShapeAppearance {
    readonly kind: K;
}

export interface RectangleShape extends BaseShape<'rectangle'> {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface CircleShape extends BaseShape<'circle'> {
    readonly cx: number;
    readonly cy: number;
    readonly radius: number;
}

export interface EllipseShape extends BaseShape<'ellipse'> {
    readonly cx: number;
    readonly cy: number;
    readonly radiusX: number;
    readonly radiusY: number;
}

export interface TriangleShape extends BaseShape<'triangle'> {
    readonly a: Readonly<IVec2Like>;
    readonly b: Readonly<IVec2Like>;
    readonly c: Readonly<IVec2Like>;
}

export interface LineShape extends BaseShape<'line'> {
    readonly start: Readonly<IVec2Like>;
    readonly end: Readonly<IVec2Like>;
}

export interface RectangleShapeInput extends ShapeAppearanceInput {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
}

export interface CircleShapeInput extends ShapeAppearanceInput {
    readonly cx: number;
    readonly cy: number;
    readonly radius: number;
}

export interface EllipseShapeInput extends ShapeAppearanceInput {
    readonly cx: number;
    readonly cy: number;
    readonly radiusX: number;
    readonly radiusY: number;
}

export interface TriangleShapeInput extends ShapeAppearanceInput {
    readonly a: ShapePointInput;
    readonly b: ShapePointInput;
    readonly c: ShapePointInput;
}

export interface LineShapeInput extends ShapeAppearanceInput {
    readonly start: ShapePointInput;
    readonly end: ShapePointInput;
}

export interface ShapeKindMap {
    readonly rectangle: RectangleShape;
    readonly circle: CircleShape;
    readonly ellipse: EllipseShape;
    readonly triangle: TriangleShape;
    readonly line: LineShape;
}

export type ShapeKind = keyof ShapeKindMap;
export type Shape2D<K extends ShapeKind = ShapeKind> = ShapeKindMap[K];
export type ShapePaintKind = ShapePaint['kind'];
export type ShapeFingerprint<K extends ShapeKind = ShapeKind> = `${K}:${string}`;
export type SerializedShapeType<K extends ShapeKind = ShapeKind> = `shape/${K}`;
export type SerializedPaintType<K extends ShapePaintKind = ShapePaintKind> = `paint/${K}`;
export type ShapeHitTarget = 'none' | 'fill' | 'stroke';

export interface ShapeBounds {
    readonly minX: number;
    readonly minY: number;
    readonly maxX: number;
    readonly maxY: number;
    readonly width: number;
    readonly height: number;
    readonly centerX: number;
    readonly centerY: number;
}

export interface ShapeApproximationOptions {
    readonly curveTolerance?: number;
    readonly minCurveSegments?: number;
    readonly maxCurveSegments?: number;
}

export interface ShapeCompileOptions extends ShapeApproximationOptions {
    readonly includeFillMesh?: boolean;
    readonly includeStrokeMesh?: boolean;
}

export interface ShapeMesh2D {
    readonly positions: Float32Array;
    readonly indices: Uint16Array | Uint32Array;
    readonly vertexCount: number;
    readonly indexCount: number;
    readonly bounds: ShapeBounds;
}

export interface CompiledShape2D<TShape extends Shape2D = Shape2D> {
    readonly shape: TShape;
    readonly fingerprint: ShapeFingerprint<TShape['kind']>;
    readonly geometryBounds: ShapeBounds;
    readonly bounds: ShapeBounds;
    readonly area: number;
    readonly perimeter: number;
    readonly contour: Float32Array;
    readonly fillMesh: ShapeMesh2D | null;
    readonly strokeMesh: ShapeMesh2D | null;
}

export interface ShapeRegistryOptions {
    readonly maxShapes?: number;
    readonly maxCompiledEntries?: number;
    readonly curveTolerance?: number;
    readonly minCurveSegments?: number;
    readonly maxCurveSegments?: number;
}

export interface ShapeRegistryStats {
    readonly shapeCount: number;
    readonly fingerprintCount: number;
    readonly compiledCount: number;
    readonly disposed: boolean;
}
