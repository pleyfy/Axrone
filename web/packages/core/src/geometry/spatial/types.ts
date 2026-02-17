import { IVec2Like, IVec3Like } from '@axrone/numeric';

export type SpatialItemId = string & { readonly __brand: unique symbol };

export interface IBounds2D {
    readonly min: IVec2Like;
    readonly max: IVec2Like;
}

export interface IBounds3D {
    readonly min: IVec3Like;
    readonly max: IVec3Like;
}

export interface ISpatialQueryResult<T> {
    readonly item: T;
    readonly bounds: IBounds2D | IBounds3D;
    readonly distance?: number;
}

export interface IRaycastHit<T> {
    readonly item: T;
    readonly distance: number;
    readonly point: IVec2Like | IVec3Like;
    readonly normal?: IVec2Like | IVec3Like;
}

export interface ISpatialConfig {
    readonly maxDepth: number;
    readonly maxItemsPerNode: number;
    readonly minNodeSize: number;
    readonly splitThreshold: number;
}

export interface INodeStats {
    readonly nodeCount: number;
    readonly itemCount: number;
    readonly depth: number;
    readonly memoryUsage: number;
}

export const DEFAULT_SPATIAL_CONFIG: Readonly<ISpatialConfig> = {
    maxDepth: 10,
    maxItemsPerNode: 16,
    minNodeSize: 1.0,
    splitThreshold: 0.8,
} as const;
