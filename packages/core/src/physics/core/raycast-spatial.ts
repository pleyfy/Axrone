import { Vec3, IVec3Like, EPSILON } from '@axrone/numeric';

const GRID_INITIAL_CAPACITY = 256;

interface GridCell<T> {
    readonly items: T[];
}

export class SpatialHashGrid3D<T> {
    private readonly _cellSize: number;
    private readonly _invCellSize: number;
    private readonly _grid: Map<string, GridCell<T>>;
    private readonly _itemCells: Map<T, Set<string>>;

    constructor(cellSize: number) {
        if (cellSize <= 0) {
            throw new Error('Cell size must be positive');
        }

        this._cellSize = cellSize;
        this._invCellSize = 1.0 / cellSize;
        this._grid = new Map();
        this._itemCells = new Map();
    }

    public insert(item: T, min: Readonly<IVec3Like>, max: Readonly<IVec3Like>): void {
        const cellKeys = this._getCellKeys(min, max);
        
        if (!this._itemCells.has(item)) {
            this._itemCells.set(item, new Set());
        }

        const itemCells = this._itemCells.get(item)!;

        for (const key of cellKeys) {
            if (!this._grid.has(key)) {
                this._grid.set(key, { items: [] });
            }

            const cell = this._grid.get(key)!;
            if (!cell.items.includes(item)) {
                cell.items.push(item);
            }

            itemCells.add(key);
        }
    }

    public remove(item: T): void {
        const itemCells = this._itemCells.get(item);
        if (!itemCells) return;

        for (const key of itemCells) {
            const cell = this._grid.get(key);
            if (cell) {
                const index = cell.items.indexOf(item);
                if (index !== -1) {
                    cell.items.splice(index, 1);
                }

                if (cell.items.length === 0) {
                    this._grid.delete(key);
                }
            }
        }

        this._itemCells.delete(item);
    }

    public update(item: T, min: Readonly<IVec3Like>, max: Readonly<IVec3Like>): void {
        this.remove(item);
        this.insert(item, min, max);
    }

    public query(min: Readonly<IVec3Like>, max: Readonly<IVec3Like>): T[] {
        const cellKeys = this._getCellKeys(min, max);
        const results = new Set<T>();

        for (const key of cellKeys) {
            const cell = this._grid.get(key);
            if (cell) {
                for (const item of cell.items) {
                    results.add(item);
                }
            }
        }

        return Array.from(results);
    }

    public queryRay(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number
    ): T[] {
        const results = new Set<T>();
        const endPoint = Vec3.add(origin, Vec3.multiplyScalar(direction, maxDistance));

        const startCell = this._getCellCoords(origin);
        const endCell = this._getCellCoords(endPoint);

        const dx = Math.abs(endCell.x - startCell.x);
        const dy = Math.abs(endCell.y - startCell.y);
        const dz = Math.abs(endCell.z - startCell.z);

        const sx = startCell.x < endCell.x ? 1 : -1;
        const sy = startCell.y < endCell.y ? 1 : -1;
        const sz = startCell.z < endCell.z ? 1 : -1;

        let x = startCell.x;
        let y = startCell.y;
        let z = startCell.z;

        let tMaxX = dx > 0 ? Math.abs((this._cellBoundary(x, sx) - origin.x) / direction.x) : Number.MAX_VALUE;
        let tMaxY = dy > 0 ? Math.abs((this._cellBoundary(y, sy) - origin.y) / direction.y) : Number.MAX_VALUE;
        let tMaxZ = dz > 0 ? Math.abs((this._cellBoundary(z, sz) - origin.z) / direction.z) : Number.MAX_VALUE;

        const tDeltaX = dx > 0 ? this._cellSize / Math.abs(direction.x) : Number.MAX_VALUE;
        const tDeltaY = dy > 0 ? this._cellSize / Math.abs(direction.y) : Number.MAX_VALUE;
        const tDeltaZ = dz > 0 ? this._cellSize / Math.abs(direction.z) : Number.MAX_VALUE;

        const maxSteps = dx + dy + dz + 1;
        let step = 0;

        while (step < maxSteps) {
            const key = this._cellKey(x, y, z);
            const cell = this._grid.get(key);

            if (cell) {
                for (const item of cell.items) {
                    results.add(item);
                }
            }

            if (tMaxX < tMaxY) {
                if (tMaxX < tMaxZ) {
                    if (tMaxX > maxDistance) break;
                    x += sx;
                    tMaxX += tDeltaX;
                } else {
                    if (tMaxZ > maxDistance) break;
                    z += sz;
                    tMaxZ += tDeltaZ;
                }
            } else {
                if (tMaxY < tMaxZ) {
                    if (tMaxY > maxDistance) break;
                    y += sy;
                    tMaxY += tDeltaY;
                } else {
                    if (tMaxZ > maxDistance) break;
                    z += sz;
                    tMaxZ += tDeltaZ;
                }
            }

            step++;
        }

        return Array.from(results);
    }

    public clear(): void {
        this._grid.clear();
        this._itemCells.clear();
    }

    public get cellCount(): number {
        return this._grid.size;
    }

    public get itemCount(): number {
        return this._itemCells.size;
    }

    private _getCellCoords(point: Readonly<IVec3Like>): { x: number; y: number; z: number } {
        return {
            x: Math.floor(point.x * this._invCellSize),
            y: Math.floor(point.y * this._invCellSize),
            z: Math.floor(point.z * this._invCellSize)
        };
    }

    private _getCellKeys(min: Readonly<IVec3Like>, max: Readonly<IVec3Like>): string[] {
        const minCell = this._getCellCoords(min);
        const maxCell = this._getCellCoords(max);
        const keys: string[] = [];

        for (let x = minCell.x; x <= maxCell.x; x++) {
            for (let y = minCell.y; y <= maxCell.y; y++) {
                for (let z = minCell.z; z <= maxCell.z; z++) {
                    keys.push(this._cellKey(x, y, z));
                }
            }
        }

        return keys;
    }

    private _cellKey(x: number, y: number, z: number): string {
        return `${x},${y},${z}`;
    }

    private _cellBoundary(cell: number, direction: number): number {
        return (cell + (direction > 0 ? 1 : 0)) * this._cellSize;
    }
}

export class OctreeNode<T> {
    public readonly center: Vec3;
    public readonly halfSize: number;
    public readonly items: Array<{ item: T; min: IVec3Like; max: IVec3Like }> = [];
    public children: OctreeNode<T>[] | null = null;
    public readonly depth: number;

    constructor(center: Readonly<IVec3Like>, halfSize: number, depth: number) {
        this.center = Vec3.from(center);
        this.halfSize = halfSize;
        this.depth = depth;
    }

    public isLeaf(): boolean {
        return this.children === null;
    }
}

export class Octree<T> {
    private readonly _root: OctreeNode<T>;
    private readonly _maxDepth: number;
    private readonly _maxItemsPerNode: number;
    private readonly _minNodeSize: number;
    private _itemCount: number = 0;

    constructor(
        center: Readonly<IVec3Like>,
        halfSize: number,
        maxDepth: number = 8,
        maxItemsPerNode: number = 8,
        minNodeSize: number = 1.0
    ) {
        this._root = new OctreeNode(center, halfSize, 0);
        this._maxDepth = maxDepth;
        this._maxItemsPerNode = maxItemsPerNode;
        this._minNodeSize = minNodeSize;
    }

    public insert(item: T, min: Readonly<IVec3Like>, max: Readonly<IVec3Like>): void {
        this._insertIntoNode(this._root, item, min, max);
        this._itemCount++;
    }

    public query(min: Readonly<IVec3Like>, max: Readonly<IVec3Like>): T[] {
        const results: T[] = [];
        this._queryNode(this._root, min, max, results);
        return results;
    }

    public queryRay(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number
    ): T[] {
        const results: T[] = [];
        const invDirection = Vec3.create(
            Math.abs(direction.x) > EPSILON ? 1.0 / direction.x : Number.MAX_VALUE,
            Math.abs(direction.y) > EPSILON ? 1.0 / direction.y : Number.MAX_VALUE,
            Math.abs(direction.z) > EPSILON ? 1.0 / direction.z : Number.MAX_VALUE
        );

        this._queryRayNode(this._root, origin, invDirection, maxDistance, results);
        return results;
    }

    public clear(): void {
        this._clearNode(this._root);
        this._itemCount = 0;
    }

    public get itemCount(): number {
        return this._itemCount;
    }

    private _insertIntoNode(
        node: OctreeNode<T>,
        item: T,
        min: Readonly<IVec3Like>,
        max: Readonly<IVec3Like>
    ): void {
        if (!this._intersectsNode(node, min, max)) {
            return;
        }

        if (node.isLeaf()) {
            node.items.push({ item, min, max });

            if (
                node.items.length > this._maxItemsPerNode &&
                node.depth < this._maxDepth &&
                node.halfSize > this._minNodeSize
            ) {
                this._subdivideNode(node);
            }
        } else {
            for (const child of node.children!) {
                this._insertIntoNode(child, item, min, max);
            }
        }
    }

    private _subdivideNode(node: OctreeNode<T>): void {
        const quarterSize = node.halfSize * 0.5;
        node.children = [];

        const offsets = [
            [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
            [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1]
        ];

        for (const [ox, oy, oz] of offsets) {
            const childCenter = Vec3.create(
                node.center.x + ox * quarterSize,
                node.center.y + oy * quarterSize,
                node.center.z + oz * quarterSize
            );
            node.children.push(new OctreeNode(childCenter, quarterSize, node.depth + 1));
        }

        for (const { item, min, max } of node.items) {
            for (const child of node.children) {
                this._insertIntoNode(child, item, min, max);
            }
        }

        node.items.length = 0;
    }

    private _queryNode(
        node: OctreeNode<T>,
        min: Readonly<IVec3Like>,
        max: Readonly<IVec3Like>,
        results: T[]
    ): void {
        if (!this._intersectsNode(node, min, max)) {
            return;
        }

        if (node.isLeaf()) {
            for (const { item, min: itemMin, max: itemMax } of node.items) {
                if (this._aabbIntersects(min, max, itemMin, itemMax)) {
                    results.push(item);
                }
            }
        } else {
            for (const child of node.children!) {
                this._queryNode(child, min, max, results);
            }
        }
    }

    private _queryRayNode(
        node: OctreeNode<T>,
        origin: Readonly<IVec3Like>,
        invDirection: Readonly<IVec3Like>,
        maxDistance: number,
        results: T[]
    ): void {
        const nodeMin = Vec3.create(
            node.center.x - node.halfSize,
            node.center.y - node.halfSize,
            node.center.z - node.halfSize
        );
        const nodeMax = Vec3.create(
            node.center.x + node.halfSize,
            node.center.y + node.halfSize,
            node.center.z + node.halfSize
        );

        if (!this._rayIntersectsAABB(origin, invDirection, nodeMin, nodeMax, maxDistance)) {
            return;
        }

        if (node.isLeaf()) {
            for (const { item } of node.items) {
                if (!results.includes(item)) {
                    results.push(item);
                }
            }
        } else {
            for (const child of node.children!) {
                this._queryRayNode(child, origin, invDirection, maxDistance, results);
            }
        }
    }

    private _clearNode(node: OctreeNode<T>): void {
        node.items.length = 0;
        if (!node.isLeaf()) {
            for (const child of node.children!) {
                this._clearNode(child);
            }
            node.children = null;
        }
    }

    private _intersectsNode(
        node: OctreeNode<T>,
        min: Readonly<IVec3Like>,
        max: Readonly<IVec3Like>
    ): boolean {
        const nodeMin = {
            x: node.center.x - node.halfSize,
            y: node.center.y - node.halfSize,
            z: node.center.z - node.halfSize
        };
        const nodeMax = {
            x: node.center.x + node.halfSize,
            y: node.center.y + node.halfSize,
            z: node.center.z + node.halfSize
        };

        return this._aabbIntersects(min, max, nodeMin, nodeMax);
    }

    private _aabbIntersects(
        min1: Readonly<IVec3Like>,
        max1: Readonly<IVec3Like>,
        min2: Readonly<IVec3Like>,
        max2: Readonly<IVec3Like>
    ): boolean {
        return (
            min1.x <= max2.x && max1.x >= min2.x &&
            min1.y <= max2.y && max1.y >= min2.y &&
            min1.z <= max2.z && max1.z >= min2.z
        );
    }

    private _rayIntersectsAABB(
        origin: Readonly<IVec3Like>,
        invDirection: Readonly<IVec3Like>,
        min: Readonly<IVec3Like>,
        max: Readonly<IVec3Like>,
        maxDistance: number
    ): boolean {
        let tMin = 0;
        let tMax = maxDistance;

        {
            const t1 = (min.x - origin.x) * invDirection.x;
            const t2 = (max.x - origin.x) * invDirection.x;
            tMin = Math.max(tMin, Math.min(t1, t2));
            tMax = Math.min(tMax, Math.max(t1, t2));
        }

        {
            const t1 = (min.y - origin.y) * invDirection.y;
            const t2 = (max.y - origin.y) * invDirection.y;
            tMin = Math.max(tMin, Math.min(t1, t2));
            tMax = Math.min(tMax, Math.max(t1, t2));
        }

        {
            const t1 = (min.z - origin.z) * invDirection.z;
            const t2 = (max.z - origin.z) * invDirection.z;
            tMin = Math.max(tMin, Math.min(t1, t2));
            tMax = Math.min(tMax, Math.max(t1, t2));
        }

        return tMax >= tMin && tMax >= 0;
    }
}
