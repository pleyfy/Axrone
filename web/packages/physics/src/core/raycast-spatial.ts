import { Vec3, IVec3Like, EPSILON } from '@axrone/numeric';
import { Octree } from '@axrone/geometry';

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

        let tMaxX =
            dx > 0
                ? Math.abs((this._cellBoundary(x, sx) - origin.x) / direction.x)
                : Number.MAX_VALUE;
        let tMaxY =
            dy > 0
                ? Math.abs((this._cellBoundary(y, sy) - origin.y) / direction.y)
                : Number.MAX_VALUE;
        let tMaxZ =
            dz > 0
                ? Math.abs((this._cellBoundary(z, sz) - origin.z) / direction.z)
                : Number.MAX_VALUE;

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
            z: Math.floor(point.z * this._invCellSize),
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

export class SpatialOctree<T> {
    private readonly _octree: Octree<T>;
    private readonly _itemBounds = new Map<T, readonly [IVec3Like, IVec3Like]>();

    constructor(
        center: Readonly<IVec3Like>,
        halfSize: number,
        maxDepth: number = 8,
        maxItemsPerNode: number = 8,
        minNodeSize: number = 1.0
    ) {
        const min = {
            x: center.x - halfSize,
            y: center.y - halfSize,
            z: center.z - halfSize,
        };
        const max = {
            x: center.x + halfSize,
            y: center.y + halfSize,
            z: center.z + halfSize,
        };

        this._octree = new Octree<T>([min, max], {
            maxDepth,
            maxItemsPerNode,
            minNodeSize,
            splitThreshold: 0.8,
        });
    }

    public insert(item: T, min: Readonly<IVec3Like>, max: Readonly<IVec3Like>): void {
        this._itemBounds.set(item, [min, max]);
        this._octree.insert([min, max], item);
    }

    public query(min: Readonly<IVec3Like>, max: Readonly<IVec3Like>): T[] {
        const results = this._octree.query([min, max]);
        return results.map((result) => result.item);
    }

    public queryRay(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxDistance: number
    ): T[] {
        const results = this._octree.raycast(origin, direction, maxDistance);
        return results.map((result) => result.item);
    }

    public clear(): void {
        this._octree.clear();
        this._itemBounds.clear();
    }

    public get itemCount(): number {
        return this._octree.size;
    }
}
