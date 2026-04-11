import { IVec2Like, IVec3Like } from '@axrone/numeric';
import { ISpatialQueryResult, IRaycastHit, ISpatialConfig, INodeStats } from './types';

export interface ISpatialPartitioning<TPoint extends IVec2Like | IVec3Like, TItem> {
    insert(bounds: readonly [TPoint, TPoint], item: TItem): void;

    remove(item: TItem): boolean;

    query(bounds: readonly [TPoint, TPoint]): ISpatialQueryResult<TItem>[];

    raycast?(origin: TPoint, direction: TPoint, maxDistance?: number): IRaycastHit<TItem>[];

    clear(): void;

    readonly size: number;

    readonly stats: INodeStats;
}

export interface ISpatialPartitioning2D<TItem> extends ISpatialPartitioning<IVec2Like, TItem> {}

export interface ISpatialPartitioning3D<TItem> extends ISpatialPartitioning<IVec3Like, TItem> {}

export interface ISpatialNode<TPoint extends IVec2Like | IVec3Like, TItem> {
    readonly bounds: readonly [TPoint, TPoint];
    readonly depth: number;
    readonly isLeaf: boolean;
    readonly itemCount: number;

    insert(bounds: readonly [TPoint, TPoint], item: TItem): boolean;
    remove(item: TItem): boolean;
    query(bounds: readonly [TPoint, TPoint], result: ISpatialQueryResult<TItem>[]): void;
    clear(): void;
}
