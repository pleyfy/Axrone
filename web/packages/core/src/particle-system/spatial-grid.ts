import { AABB3D } from '../geometry';
import { MemoryPool } from '@axrone/utility';
import { Vec3, IVec3Like } from '@axrone/numeric';
import { ISpatialCell, ISpatialGrid } from './interfaces';
import { ParticleId } from './types';

export class SpatialGrid implements ISpatialGrid {
    private readonly grid: {
        cells: Map<bigint, ISpatialCell>;
        cellSize: number;
        invCellSize: number;
        dimensions: Vec3;
        bounds: AABB3D;
        maxParticlesPerCell: number;
    };
    private readonly cellPool: MemoryPool<ISpatialCell>;
    private readonly hashMultiplier = BigInt(73856093);
    private readonly _particleToCell: Map<ParticleId, { cellHash: bigint; index: number }>;

    constructor(
        bounds: AABB3D,
        cellSize: number,
        maxParticlesPerCell: number = 64,
        poolInitialCapacity: number = 32
    ) {
        this.grid = {
            cells: new Map(),
            cellSize,
            invCellSize: 1 / cellSize,
            dimensions: new Vec3(
                Math.ceil((bounds.max.x - bounds.min.x) / cellSize),
                Math.ceil((bounds.max.y - bounds.min.y) / cellSize),
                Math.ceil((bounds.max.z - bounds.min.z) / cellSize)
            ),
            bounds,
            maxParticlesPerCell,
        };

        this.cellPool = new MemoryPool({
            initialCapacity: poolInitialCapacity,
            maxCapacity: Math.max(poolInitialCapacity * 8, 4096),
            preallocate: true,
            autoExpand: true,
            factory: (): ISpatialCell => {
                const cell: ISpatialCell = {
                    particles: [],
                    bounds: new AABB3D(),
                    neighborCells: [],
                    centerMass: new Vec3(0, 0, 0),
                    density: 0,
                    reset(): void {
                        this.particles.length = 0;
                        this.neighborCells.length = 0;
                        if (this.centerMass) {
                            this.centerMass.x = 0;
                            this.centerMass.y = 0;
                            this.centerMass.z = 0;
                        }
                        this.density = 0;
                    },
                    dispose(): void {
                        this.reset();
                    },
                } as any;
                return cell;
            },
        });

        this._particleToCell = new Map();
    }

    insert(particleIndex: ParticleId, position: Vec3): void {
        const cellHash = this.hashPosition(position);
        let cell = this.grid.cells.get(cellHash);

        if (!cell) {
            cell = this.cellPool.acquire();
            this.updateCellBounds(cell, position);
            this.grid.cells.set(cellHash, cell);
        }

        const idx = cell.particles.length;
        cell.particles.push(particleIndex as any);
        this._particleToCell.set(particleIndex, { cellHash, index: idx });
        this.updateCenterMass(cell, position);
    }

    get cellSize(): Vec3 {
        return new Vec3(this.grid.cellSize, this.grid.cellSize, this.grid.cellSize);
    }

    get bounds(): AABB3D {
        return new AABB3D(Vec3.from(this.grid.bounds.min), Vec3.from(this.grid.bounds.max));
    }

    remove(particleId: ParticleId): void {
        const entry = this._particleToCell.get(particleId);
        if (!entry) return;

        const cell = this.grid.cells.get(entry.cellHash);
        if (!cell) {
            this._particleToCell.delete(particleId);
            return;
        }

        const avgPos = cell.centerMass || new Vec3(0, 0, 0);
        this._removeFromCell(entry.cellHash, cell, entry.index, avgPos, particleId);
    }

    removeWithPosition(particleIndex: ParticleId, position: IVec3Like): boolean {
        const entry = this._particleToCell.get(particleIndex);
        if (!entry) {
            const cellHash = this.hashPosition(position);
            const cell = this.grid.cells.get(cellHash);
            if (!cell) return false;

            const idx = cell.particles.indexOf(particleIndex as any);
            if (idx === -1) return false;
            return this._removeFromCell(cellHash, cell, idx, position, particleIndex);
        }

        const { cellHash, index } = entry;
        const cell = this.grid.cells.get(cellHash);
        if (!cell) {
            this._particleToCell.delete(particleIndex);
            return false;
        }

        return this._removeFromCell(cellHash, cell, index, position, particleIndex);
    }

    private _removeFromCell(
        cellHash: bigint,
        cell: ISpatialCell,
        idx: number,
        position: IVec3Like,
        particleIndex: ParticleId
    ): boolean {
        const prevCount = cell.particles.length;
        const lastIdx = prevCount - 1;

        const lastId = cell.particles[lastIdx];
        if (idx !== lastIdx) {
            cell.particles[idx] = lastId;
            this._particleToCell.set(lastId as any as ParticleId, { cellHash, index: idx });
        }

        cell.particles.pop();
        this._particleToCell.delete(particleIndex);

        const newCount = cell.particles.length;

        if (newCount === 0) {
            this.cellPool.release(cell);
            this.grid.cells.delete(cellHash);
            return true;
        }

        if (cell.centerMass) {
            if (prevCount > 1) {
                const prev = cell.centerMass;
                prev.x = (prev.x * prevCount - position.x) / newCount;
                prev.y = (prev.y * prevCount - position.y) / newCount;
                prev.z = (prev.z * prevCount - position.z) / newCount;
            } else {
                cell.centerMass.x = 0;
                cell.centerMass.y = 0;
                cell.centerMass.z = 0;
            }
        }

        cell.density = newCount / (this.grid.cellSize * this.grid.cellSize * this.grid.cellSize);

        return true;
    }

    has(particleIndex: ParticleId, position: IVec3Like): boolean {
        const entry = this._particleToCell.get(particleIndex);
        if (!entry) return false;
        return this.grid.cells.has(entry.cellHash);
    }

    move(particleIndex: ParticleId, oldPosition: IVec3Like, newPosition: IVec3Like): void {
        const oldHash = this.hashPosition(oldPosition);
        const newHash = this.hashPosition(newPosition);

        if (oldHash === newHash) {
            const cell = this.grid.cells.get(oldHash);
            if (!cell) return;

            if (cell.centerMass) {
                const count = cell.particles.length;
                if (count > 0) {
                    const prev = cell.centerMass;
                    prev.x = (prev.x * count - oldPosition.x + newPosition.x) / count;
                    prev.y = (prev.y * count - oldPosition.y + newPosition.y) / count;
                    prev.z = (prev.z * count - oldPosition.z + newPosition.z) / count;
                }
            }
            return;
        }

        const entry = this._particleToCell.get(particleIndex as any);
        if (entry) {
            const oldCell = this.grid.cells.get(entry.cellHash);
            if (oldCell) {
                this._removeFromCell(
                    entry.cellHash,
                    oldCell,
                    entry.index,
                    oldPosition,
                    particleIndex
                );
            }
        } else {
            this.removeWithPosition(particleIndex as any, oldPosition as Vec3);
        }

        this.insert(particleIndex as any, newPosition as Vec3);
    }

    queryRadius(center: Vec3, radius: number): ParticleId[] {
        const result: ParticleId[] = [];
        this.queryRadiusCallback(center, radius, (particleIndex) => {
            result.push(particleIndex as any as ParticleId);
        });
        return result;
    }

    queryRadiusCallback(
        position: Vec3,
        radius: number,
        callback: (particleIndex: number) => void,
        getPosition?: (particleIndex: number) => IVec3Like
    ): void {
        const cellRadius = Math.ceil(radius * this.grid.invCellSize);

        const centerCell = this.worldToCell(position);
        const radiusSq = radius * radius;

        for (let dx = -cellRadius; dx <= cellRadius; dx++) {
            for (let dy = -cellRadius; dy <= cellRadius; dy++) {
                for (let dz = -cellRadius; dz <= cellRadius; dz++) {
                    const cellHash = this.hashCell(
                        centerCell.x + dx,
                        centerCell.y + dy,
                        centerCell.z + dz
                    );
                    const cell = this.grid.cells.get(cellHash);

                    if (cell) {
                        for (let i = 0; i < cell.particles.length; i++) {
                            const id = cell.particles[i] as number;
                            if (getPosition) {
                                const p = getPosition(id);
                                const dx = p.x - position.x;
                                const dy = p.y - position.y;
                                const dz = p.z - position.z;
                                if (dx * dx + dy * dy + dz * dz <= radiusSq) {
                                    callback(id);
                                }
                            } else {
                                callback(id);
                            }
                        }
                    }
                }
            }
        }
    }

    queryAABB(bounds: AABB3D, callback: (particleIndex: number) => void): void {
        const minCell = this.worldToCell(bounds.min);
        const maxCell = this.worldToCell(bounds.max);

        for (let x = minCell.x; x <= maxCell.x; x++) {
            for (let y = minCell.y; y <= maxCell.y; y++) {
                for (let z = minCell.z; z <= maxCell.z; z++) {
                    const cellHash = this.hashCell(x, y, z);
                    const cell = this.grid.cells.get(cellHash);

                    if (cell) {
                        for (let i = 0; i < cell.particles.length; i++) {
                            callback(cell.particles[i]);
                        }
                    }
                }
            }
        }
    }

    update(particleId: ParticleId, oldPosition: Vec3, newPosition: Vec3): void {
        this.move(particleId, oldPosition, newPosition);
    }

    query(bounds: AABB3D): ParticleId[] {
        const result: ParticleId[] = [];
        this.queryAABB(bounds, (particleIndex) => {
            result.push(particleIndex as any as ParticleId);
        });
        return result;
    }

    getCellAt(position: Vec3): ISpatialCell | null {
        const cellHash = this.hashPosition(position);
        return this.grid.cells.get(cellHash) || null;
    }

    getNeighborCells(cell: ISpatialCell): ISpatialCell[] {
        if (!cell.bounds) return [];

        const center = Vec3.from(cell.bounds.center);
        const neighbors: ISpatialCell[] = [];
        const cellCoords = this.worldToCell(center);

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;

                    const neighborHash = this.hashCell(
                        cellCoords.x + dx,
                        cellCoords.y + dy,
                        cellCoords.z + dz
                    );

                    const neighborCell = this.grid.cells.get(neighborHash);
                    if (neighborCell) {
                        neighbors.push(neighborCell);
                    }
                }
            }
        }

        return neighbors;
    }

    clear(): void {
        for (const cell of this.grid.cells.values()) {
            this.cellPool.release(cell);
        }
        this.grid.cells.clear();
    }

    private hashPosition(position: IVec3Like): bigint {
        const cell = this.worldToCell(position);
        return this.hashCell(cell.x, cell.y, cell.z);
    }

    private hashCell(x: number, y: number, z: number): bigint {
        return (
            BigInt(x) * this.hashMultiplier +
            BigInt(y) * this.hashMultiplier * 2n +
            BigInt(z) * this.hashMultiplier * 3n
        );
    }

    private worldToCell(position: IVec3Like): { x: number; y: number; z: number } {
        return {
            x: Math.floor((position.x - this.grid.bounds.min.x) * this.grid.invCellSize),
            y: Math.floor((position.y - this.grid.bounds.min.y) * this.grid.invCellSize),
            z: Math.floor((position.z - this.grid.bounds.min.z) * this.grid.invCellSize),
        };
    }

    private updateCellBounds(cell: ISpatialCell, position: IVec3Like): void {
        const cellPos = this.worldToCell(position);
        const minX = this.grid.bounds.min.x + cellPos.x * this.grid.cellSize;
        const minY = this.grid.bounds.min.y + cellPos.y * this.grid.cellSize;
        const minZ = this.grid.bounds.min.z + cellPos.z * this.grid.cellSize;

        const min = new Vec3(minX, minY, minZ);
        const max = new Vec3(
            minX + this.grid.cellSize,
            minY + this.grid.cellSize,
            minZ + this.grid.cellSize
        );
        cell.bounds = new AABB3D(min, max);
    }

    private updateCenterMass(cell: ISpatialCell, position: Vec3): void {
        const count = cell.particles.length;
        if (!cell.centerMass) cell.centerMass = new Vec3(0, 0, 0);

        if (count === 1) {
            cell.centerMass.x = position.x;
            cell.centerMass.y = position.y;
            cell.centerMass.z = position.z;
        } else {
            const prev = cell.centerMass;
            prev.x = (prev.x * (count - 1) + position.x) / count;
            prev.y = (prev.y * (count - 1) + position.y) / count;
            prev.z = (prev.z * (count - 1) + position.z) / count;
        }

        cell.density = count / (this.grid.cellSize * this.grid.cellSize * this.grid.cellSize);
    }

    getDensityAtPosition(position: IVec3Like): number {
        const cellHash = this.hashPosition(position);
        const cell = this.grid.cells.get(cellHash);
        return cell ? (cell as any).density || 0 : 0;
    }

    getCellCount(): number {
        return this.grid.cells.size;
    }

    getAverageParticlesPerCell(): number {
        let totalParticles = 0;
        for (const cell of this.grid.cells.values()) {
            totalParticles += cell.particles.length;
        }
        return this.grid.cells.size > 0 ? totalParticles / this.grid.cells.size : 0;
    }
}
