import type { IMat4Like, IVec3Like } from '@axrone/numeric';
import type { Brand, ReadonlyTuple3 } from '@axrone/utility';

export type CameraId = Brand<string, 'CameraId'>;
export type CameraLocale = 'en' | 'tr' | (string & {});

export type Vector3Input = Readonly<IVec3Like> | ReadonlyTuple3<number>;

export type Matrix4Tuple = readonly [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
];

export interface CameraPose {
    readonly position: Vector3Input;
    readonly target: Vector3Input;
    readonly up?: Vector3Input;
}

export interface ResolvedCameraPose {
    readonly position: ReadonlyTuple3<number>;
    readonly target: ReadonlyTuple3<number>;
    readonly up: ReadonlyTuple3<number>;
}

export interface CameraPerspectiveProjection {
    readonly kind: 'perspective';
    readonly verticalFieldOfView: number;
    readonly aspectRatio: number;
    readonly near: number;
    readonly far: number;
}

export interface CameraOrthographicProjection {
    readonly kind: 'orthographic';
    readonly left: number;
    readonly right: number;
    readonly bottom: number;
    readonly top: number;
    readonly near: number;
    readonly far: number;
}

export type CameraProjection = CameraPerspectiveProjection | CameraOrthographicProjection;
export type CameraProjectionKind = CameraProjection['kind'];
export type CameraProjectionOf<TKind extends CameraProjectionKind = CameraProjectionKind> = Extract<
    CameraProjection,
    { readonly kind: TKind }
>;

export interface CameraOptions<TProjection extends CameraProjection = CameraProjection> {
    readonly id?: string;
    readonly locale?: CameraLocale;
    readonly projection: TProjection;
    readonly pose: CameraPose;
}

export type CameraOptionsOf<TKind extends CameraProjectionKind = CameraProjectionKind> = CameraOptions<
    CameraProjectionOf<TKind>
>;

export interface CameraSerialized<TProjection extends CameraProjection = CameraProjection> {
    readonly id: string;
    readonly locale: CameraLocale;
    readonly projection: TProjection;
    readonly pose: ResolvedCameraPose;
    readonly viewMatrix: Matrix4Tuple;
    readonly projectionMatrix: Matrix4Tuple;
    readonly viewProjectionMatrix: Matrix4Tuple;
}

export interface BoundingSphere {
    readonly kind: 'sphere';
    readonly center: Vector3Input;
    readonly radius: number;
}

export interface BoundingAabb {
    readonly kind: 'aabb';
    readonly min: Vector3Input;
    readonly max: Vector3Input;
}

export type BoundingVolume = BoundingSphere | BoundingAabb;
export type BoundingVolumeKind = BoundingVolume['kind'];
export type BoundingVolumeOf<TKind extends BoundingVolumeKind = BoundingVolumeKind> = Extract<
    BoundingVolume,
    { readonly kind: TKind }
>;

export type FrustumClassification = 'outside' | 'intersects' | 'inside';
export type PointFrustumClassification = Extract<FrustumClassification, 'outside' | 'inside'>;

export interface BoundsResolver<in TItem, out TBounds extends BoundingVolume = BoundingVolume> {
    (item: TItem): TBounds | null | undefined;
}

export interface CullingFilter<in TItem> {
    (item: TItem): boolean;
}

export interface CullingSorter<in TItem> {
    (left: TItem, right: TItem): number;
}

export type OverflowStrategy = 'trim' | 'throw';

export interface FrustumCullerOptions<TItem, TBounds extends BoundingVolume = BoundingVolume> {
    readonly locale?: CameraLocale;
    readonly bounds: BoundsResolver<TItem, TBounds>;
    readonly filter?: CullingFilter<TItem>;
    readonly sort?: CullingSorter<TItem>;
    readonly maxResults?: number;
    readonly overflow?: OverflowStrategy;
    readonly trackClassifications?: boolean;
    readonly asyncBatchSize?: number;
}

export interface FrustumCullerAsyncOptions {
    readonly batchSize?: number;
    readonly signal?: AbortSignal;
    readonly scheduler?: () => void | PromiseLike<void>;
}

export type CullingMetricKey =
    | `${BoundingVolumeKind}Count`
    | `visible${Capitalize<BoundingVolumeKind>}Count`;

export type CullingMetricRecord = {
    readonly [K in BoundingVolumeKind as `${K}Count`]: number;
} & {
    readonly [K in BoundingVolumeKind as `visible${Capitalize<K>}Count`]: number;
};

export interface CullingStats extends CullingMetricRecord {
    readonly totalCount: number;
    readonly visibleCount: number;
    readonly outsideCount: number;
    readonly insideCount: number;
    readonly intersectCount: number;
    readonly skippedCount: number;
    readonly overflowed: boolean;
}

export type MatrixLike = Readonly<IMat4Like>;