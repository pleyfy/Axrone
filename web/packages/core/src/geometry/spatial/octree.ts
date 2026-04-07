import { IVec3Like } from '@axrone/numeric';
import { AABB3D, AABB } from '../aabb';
import { ISpatialPartitioning3D } from './interfaces';
import {
    ISpatialQueryResult,
    IRaycastHit,
    ISpatialConfig,
    INodeStats,
    DEFAULT_SPATIAL_CONFIG,
} from './types';
import { SpatialError, SpatialBoundsError, SpatialItemError, SpatialConfigError } from './errors';

interface IOctreeEntry<TItem> {
    readonly item: TItem;
    readonly bounds: AABB3D;
    readonly id: symbol;
}

export class Octree<TItem> implements ISpatialPartitioning3D<TItem> {
    private readonly _root: OctreeNode<TItem>;
    private readonly _config: Readonly<ISpatialConfig>;
    private readonly _itemMap = new Map<TItem, IOctreeEntry<TItem>>();
    private _nodeCount = 1;
    private _version = 0;

    constructor(bounds: readonly [IVec3Like, IVec3Like], config?: Partial<ISpatialConfig>) {
        this._config = Object.freeze({ ...DEFAULT_SPATIAL_CONFIG, ...config });
        this._validateConfig();
        this._validateBounds(bounds);

        const aabb = AABB.create3D(bounds[0], bounds[1]);
        this._root = new OctreeNode<TItem>(aabb, 0, this._config, () => ++this._nodeCount);
    }

    public get size(): number {
        return this._itemMap.size;
    }

    public get stats(): INodeStats {
        return {
            nodeCount: this._nodeCount,
            itemCount: this._itemMap.size,
            depth: this._root.maxDepth,
            memoryUsage: this._estimateMemoryUsage(),
        };
    }

    public get config(): Readonly<ISpatialConfig> {
        return this._config;
    }

    public insert(bounds: readonly [IVec3Like, IVec3Like], item: TItem): void {
        if (this._itemMap.has(item)) {
            throw new SpatialItemError('Item already exists in Octree', {
                item,
                size: this.size,
            });
        }

        this._validateBounds(bounds);

        const aabb = AABB.create3D(bounds[0], bounds[1]);
        const entry: IOctreeEntry<TItem> = {
            item,
            bounds: aabb,
            id: Symbol('oct-item'),
        };

        if (this._root.insert(entry)) {
            this._itemMap.set(item, entry);
            this._version++;
        } else {
            throw new SpatialBoundsError('Item bounds exceed tree bounds', {
                itemBounds: bounds,
                treeBounds: [this._root.bounds.min, this._root.bounds.max],
            });
        }
    }

    public remove(item: TItem): boolean {
        const entry = this._itemMap.get(item);
        if (!entry) {
            return false;
        }

        if (this._root.remove(entry)) {
            this._itemMap.delete(item);
            this._version++;
            return true;
        }

        return false;
    }

    public query(bounds: readonly [IVec3Like, IVec3Like]): ISpatialQueryResult<TItem>[] {
        this._validateBounds(bounds);

        const queryBounds = AABB.create3D(bounds[0], bounds[1]);
        const results: ISpatialQueryResult<TItem>[] = [];

        this._root.query(queryBounds, results);

        return results;
    }

    public raycast(
        origin: IVec3Like,
        direction: IVec3Like,
        maxDistance: number = Number.POSITIVE_INFINITY
    ): IRaycastHit<TItem>[] {
        const hits: IRaycastHit<TItem>[] = [];
        this._root.raycast(origin, direction, maxDistance, hits);

        hits.sort((a, b) => a.distance - b.distance);

        return hits;
    }

    public clear(): void {
        this._root.clear();
        this._itemMap.clear();
        this._nodeCount = 1;
        this._version++;
    }

    public rebuild(): void {
        const items = Array.from(this._itemMap.entries()).map(([item, entry]) => ({
            item,
            bounds: [entry.bounds.min, entry.bounds.max] as const,
        }));

        this.clear();

        for (const { item, bounds } of items) {
            this.insert(bounds, item);
        }
    }

    private _validateConfig(): void {
        const { maxDepth, maxItemsPerNode, minNodeSize, splitThreshold } = this._config;

        if (maxDepth <= 0 || maxDepth > 32) {
            throw new SpatialConfigError('maxDepth must be between 1 and 32', { maxDepth });
        }

        if (maxItemsPerNode <= 0) {
            throw new SpatialConfigError('maxItemsPerNode must be positive', { maxItemsPerNode });
        }

        if (minNodeSize <= 0) {
            throw new SpatialConfigError('minNodeSize must be positive', { minNodeSize });
        }

        if (splitThreshold <= 0 || splitThreshold > 1) {
            throw new SpatialConfigError('splitThreshold must be between 0 and 1', {
                splitThreshold,
            });
        }
    }

    private _validateBounds(bounds: readonly [IVec3Like, IVec3Like]): void {
        if (bounds.length !== 2) {
            throw new SpatialBoundsError('Bounds must contain exactly 2 points', { bounds });
        }

        const [min, max] = bounds;
        if (min.x > max.x || min.y > max.y || min.z > max.z) {
            throw new SpatialBoundsError('Invalid bounds: min must be <= max', { min, max });
        }
    }

    private _estimateMemoryUsage(): number {
        return this._nodeCount * 300 + this._itemMap.size * 150;
    }
}

class OctreeNode<TItem> {
    private _children:
        | readonly [
              OctreeNode<TItem>,
              OctreeNode<TItem>,
              OctreeNode<TItem>,
              OctreeNode<TItem>,
              OctreeNode<TItem>,
              OctreeNode<TItem>,
              OctreeNode<TItem>,
              OctreeNode<TItem>,
          ]
        | null = null;

    private readonly _entries = new Set<IOctreeEntry<TItem>>();

    constructor(
        public readonly bounds: AABB3D,
        public readonly depth: number,
        private readonly _config: Readonly<ISpatialConfig>,
        private readonly _onNodeCreate: () => number
    ) {}

    public get isLeaf(): boolean {
        return this._children === null;
    }

    public get itemCount(): number {
        return this._entries.size;
    }

    public get maxDepth(): number {
        if (this.isLeaf) {
            return this.depth;
        }

        return Math.max(
            this._children![0].maxDepth,
            this._children![1].maxDepth,
            this._children![2].maxDepth,
            this._children![3].maxDepth,
            this._children![4].maxDepth,
            this._children![5].maxDepth,
            this._children![6].maxDepth,
            this._children![7].maxDepth
        );
    }

    public insert(entry: IOctreeEntry<TItem>): boolean {
        if (!this.bounds.intersectsAABB(entry.bounds)) {
            return false;
        }

        if (this.isLeaf) {
            if (
                this.depth >= this._config.maxDepth ||
                this._entries.size < this._config.maxItemsPerNode ||
                !this._canSubdivide()
            ) {
                this._entries.add(entry);
                return true;
            }

            this._subdivide();
        }

        if (!this.isLeaf) {
            for (const child of this._children!) {
                if (child.insert(entry)) {
                    return true;
                }
            }
        }

        this._entries.add(entry);
        return true;
    }

    public remove(entry: IOctreeEntry<TItem>): boolean {
        if (this._entries.has(entry)) {
            this._entries.delete(entry);
            return true;
        }

        if (!this.isLeaf) {
            for (const child of this._children!) {
                if (child.remove(entry)) {
                    return true;
                }
            }
        }

        return false;
    }

    public query(queryBounds: AABB3D, results: ISpatialQueryResult<TItem>[]): void {
        if (!this.bounds.intersectsAABB(queryBounds)) {
            return;
        }

        for (const entry of this._entries) {
            if (entry.bounds.intersectsAABB(queryBounds)) {
                results.push({
                    item: entry.item,
                    bounds: {
                        min: entry.bounds.min,
                        max: entry.bounds.max,
                    },
                });
            }
        }

        if (!this.isLeaf) {
            for (const child of this._children!) {
                child.query(queryBounds, results);
            }
        }
    }

    public raycast(
        origin: IVec3Like,
        direction: IVec3Like,
        maxDistance: number,
        hits: IRaycastHit<TItem>[]
    ): void {
        const invDir = {
            x: 1 / direction.x,
            y: 1 / direction.y,
            z: 1 / direction.z,
        };

        const t1 = (this.bounds.min.x - origin.x) * invDir.x;
        const t2 = (this.bounds.max.x - origin.x) * invDir.x;
        const t3 = (this.bounds.min.y - origin.y) * invDir.y;
        const t4 = (this.bounds.max.y - origin.y) * invDir.y;
        const t5 = (this.bounds.min.z - origin.z) * invDir.z;
        const t6 = (this.bounds.max.z - origin.z) * invDir.z;

        const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4), Math.min(t5, t6));
        const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4), Math.max(t5, t6));

        if (tmax < 0 || tmin > tmax || tmin > maxDistance) {
            return;
        }

        for (const entry of this._entries) {
            const distance = Math.sqrt(
                Math.pow(entry.bounds.center.x - origin.x, 2) +
                    Math.pow(entry.bounds.center.y - origin.y, 2) +
                    Math.pow(entry.bounds.center.z - origin.z, 2)
            );

            if (distance <= maxDistance) {
                hits.push({
                    item: entry.item,
                    distance,
                    point: entry.bounds.center,
                });
            }
        }

        if (!this.isLeaf) {
            for (const child of this._children!) {
                child.raycast(origin, direction, maxDistance, hits);
            }
        }
    }

    public clear(): void {
        this._entries.clear();
        this._children = null;
    }

    private _canSubdivide(): boolean {
        const extents = this.bounds.extents;
        return (
            extents.x >= this._config.minNodeSize &&
            extents.y >= this._config.minNodeSize &&
            extents.z >= this._config.minNodeSize
        );
    }

    private _subdivide(): void {
        if (!this._canSubdivide()) {
            return;
        }

        const center = this.bounds.center;
        const extents = this.bounds.extents;
        const childExtents = {
            x: extents.x * 0.5,
            y: extents.y * 0.5,
            z: extents.z * 0.5,
        };

        const childConfigs: readonly [IVec3Like, IVec3Like][] = [
            [
                {
                    x: center.x - childExtents.x,
                    y: center.y - childExtents.y,
                    z: center.z - childExtents.z,
                },
                childExtents,
            ],
            [
                {
                    x: center.x + childExtents.x,
                    y: center.y - childExtents.y,
                    z: center.z - childExtents.z,
                },
                childExtents,
            ],
            [
                {
                    x: center.x - childExtents.x,
                    y: center.y + childExtents.y,
                    z: center.z - childExtents.z,
                },
                childExtents,
            ],
            [
                {
                    x: center.x + childExtents.x,
                    y: center.y + childExtents.y,
                    z: center.z - childExtents.z,
                },
                childExtents,
            ],

            [
                {
                    x: center.x - childExtents.x,
                    y: center.y - childExtents.y,
                    z: center.z + childExtents.z,
                },
                childExtents,
            ],
            [
                {
                    x: center.x + childExtents.x,
                    y: center.y - childExtents.y,
                    z: center.z + childExtents.z,
                },
                childExtents,
            ],
            [
                {
                    x: center.x - childExtents.x,
                    y: center.y + childExtents.y,
                    z: center.z + childExtents.z,
                },
                childExtents,
            ],
            [
                {
                    x: center.x + childExtents.x,
                    y: center.y + childExtents.y,
                    z: center.z + childExtents.z,
                },
                childExtents,
            ],
        ] as const;

        this._children = childConfigs.map(([childCenter, childExtents]) => {
            this._onNodeCreate();
            return new OctreeNode<TItem>(
                AABB.fromCenterAndExtents3D(childCenter, childExtents),
                this.depth + 1,
                this._config,
                this._onNodeCreate
            );
        }) as unknown as readonly [
            OctreeNode<TItem>,
            OctreeNode<TItem>,
            OctreeNode<TItem>,
            OctreeNode<TItem>,
            OctreeNode<TItem>,
            OctreeNode<TItem>,
            OctreeNode<TItem>,
            OctreeNode<TItem>,
        ];

        const entriesToRedistribute = Array.from(this._entries);
        this._entries.clear();

        for (const entry of entriesToRedistribute) {
            let inserted = false;
            for (const child of this._children) {
                if (child.insert(entry)) {
                    inserted = true;
                    break;
                }
            }

            if (!inserted) {
                this._entries.add(entry);
            }
        }
    }
}

export namespace Octree {
    export function create<TItem>(bounds: readonly [IVec3Like, IVec3Like]): Octree<TItem> {
        return new Octree<TItem>(bounds);
    }

    export function createForSmallObjects<TItem>(
        bounds: readonly [IVec3Like, IVec3Like]
    ): Octree<TItem> {
        return new Octree<TItem>(bounds, {
            maxDepth: 8,
            maxItemsPerNode: 32,
            minNodeSize: 0.5,
            splitThreshold: 0.9,
        });
    }

    export function createForLargeObjects<TItem>(
        bounds: readonly [IVec3Like, IVec3Like]
    ): Octree<TItem> {
        return new Octree<TItem>(bounds, {
            maxDepth: 6,
            maxItemsPerNode: 8,
            minNodeSize: 2.0,
            splitThreshold: 0.7,
        });
    }
}
