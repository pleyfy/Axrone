import type { IVec2Like, IVec3Like } from '@axrone/numeric';
import type { BodyId, ShapeId } from './primitives';

export type RaycastId = number & { readonly __raycastIdBrand: unique symbol };
export type LayerMask = number & { readonly __layerMaskBrand: unique symbol };

export const enum RaycastFlags {
    None = 0,
    ClosestOnly = 1 << 0,
    AllHits = 1 << 1,
    IgnoreTriggers = 1 << 2,
    IgnoreBackfaces = 1 << 3,
    PreciseHitNormal = 1 << 4,
    SortByDistance = 1 << 5,
    StopAtFirstHit = 1 << 6,
    IncludeInactive = 1 << 7,
}

export const enum RaycastLayer {
    Default = 1 << 0,
    Static = 1 << 1,
    Dynamic = 1 << 2,
    Kinematic = 1 << 3,
    Trigger = 1 << 4,
    Character = 1 << 5,
    Terrain = 1 << 6,
    Projectile = 1 << 7,
    Water = 1 << 8,
    Transparent = 1 << 9,
    All = 0xffffffff,
}

export interface IRay2D {
    readonly origin: Readonly<IVec2Like>;
    readonly direction: Readonly<IVec2Like>;
    readonly length: number;
}

export interface IRay3D {
    readonly origin: Readonly<IVec3Like>;
    readonly direction: Readonly<IVec3Like>;
    readonly length: number;
}

export interface IRaycastHit2D {
    readonly bodyId: BodyId;
    readonly shapeId: ShapeId;
    readonly point: Readonly<IVec2Like>;
    readonly normal: Readonly<IVec2Like>;
    readonly distance: number;
    readonly fraction: number;
    readonly layer: LayerMask;
}

export interface IBarycentricCoords {
    readonly u: number;
    readonly v: number;
}

export interface IRaycastHit3D {
    readonly bodyId: BodyId;
    readonly shapeId: ShapeId;
    readonly point: Readonly<IVec3Like>;
    readonly normal: Readonly<IVec3Like>;
    readonly distance: number;
    readonly fraction: number;
    readonly triangleIndex: number;
    readonly barycentric: IBarycentricCoords | null;
    readonly layer: LayerMask;
}

export interface IRaycastQuery2D {
    readonly ray: IRay2D;
    readonly layerMask: LayerMask;
    readonly flags: RaycastFlags;
    readonly maxHits: number;
}

export interface IRaycastQuery3D {
    readonly ray: IRay3D;
    readonly layerMask: LayerMask;
    readonly flags: RaycastFlags;
    readonly maxHits: number;
}

export type RaycastPredicate2D = (bodyId: BodyId, shapeId: ShapeId) => boolean;
export type RaycastPredicate3D = (bodyId: BodyId, shapeId: ShapeId) => boolean;

export interface IRaycastResult2D {
    readonly hits: readonly IRaycastHit2D[];
    readonly hitCount: number;
    readonly hasHit: boolean;
}

export interface IRaycastResult3D {
    readonly hits: readonly IRaycastHit3D[];
    readonly hitCount: number;
    readonly hasHit: boolean;
}

export const enum RayIntersectionType {
    None = 0,
    Entry = 1,
    Exit = 2,
    Tangent = 3,
}
