import type { IVec3Like, Vec3 } from '@axrone/numeric';
import type { ParticleId } from '../types';
import type { ISpatialIndex, IPoolable } from './interfaces';
import { ParticleSystemException } from './error';

interface ImmutableVec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

interface SpatialCell extends IPoolable {
    readonly bounds: { min: ImmutableVec3; max: ImmutableVec3 };
    readonly particles: ParticleId[];
    density: number;
    centerOfMass: ImmutableVec3;
}

export class UniformSpatialGrid implements ISpatialIndex {
    private readonly _cellSize: ImmutableVec3;
    private readonly _bounds: { readonly min: ImmutableVec3; readonly max: ImmutableVec3 };
    private readonly _invCellSize: ImmutableVec3;
    private readonly _dimensions: ImmutableVec3;
    private readonly _cells = new Map<bigint, SpatialCell>();
    private readonly _particleToCell = new Map<ParticleId, bigint>();
    private readonly _cellPool: SpatialCell[] = [];
    private _particleCount = 0;

    constructor(bounds: { min: IVec3Like; max: IVec3Like }, cellSize: IVec3Like) {
        this._cellSize = { x: cellSize.x, y: cellSize.y, z: cellSize.z };
        this._bounds = {
            min: { x: bounds.min.x, y: bounds.min.y, z: bounds.min.z },
            max: { x: bounds.max.x, y: bounds.max.y, z: bounds.max.z },
        };

        this._invCellSize = {
            x: 1.0 / cellSize.x,
            y: 1.0 / cellSize.y,
            z: 1.0 / cellSize.z,
        };

        this._dimensions = {
            x: Math.ceil((bounds.max.x - bounds.min.x) / cellSize.x),
            y: Math.ceil((bounds.max.y - bounds.min.y) / cellSize.y),
            z: Math.ceil((bounds.max.z - bounds.min.z) / cellSize.z),
        };

        for (let i = 0; i < 128; i++) {
            this._cellPool.push(this._createCell());
        }
    }

    get bounds(): { readonly min: ImmutableVec3; readonly max: ImmutableVec3 } {
        return this._bounds;
    }

    get cellSize(): ImmutableVec3 {
        return this._cellSize;
    }

    get particleCount(): number {
        return this._particleCount;
    }

    insert(particleId: ParticleId, position: IVec3Like): void {
        const cellHash = this._hashPosition(position);
        const existingHash = this._particleToCell.get(particleId);

        if (existingHash === cellHash) return;

        if (existingHash !== undefined) {
            this._removeFromCell(existingHash, particleId);
        }

        let cell = this._cells.get(cellHash);
        if (!cell) {
            cell = this._acquireCell(cellHash, position);
            this._cells.set(cellHash, cell);
        }

        cell.particles.push(particleId);
        this._particleToCell.set(particleId, cellHash);
        this._updateCellStats(cell, position, true);

        if (existingHash === undefined) {
            this._particleCount++;
        }
    }

    remove(particleId: ParticleId): boolean {
        const cellHash = this._particleToCell.get(particleId);
        if (cellHash === undefined) return false;

        this._removeFromCell(cellHash, particleId);
        this._particleToCell.delete(particleId);
        this._particleCount--;

        return true;
    }

    update(particleId: ParticleId, oldPosition: IVec3Like, newPosition: IVec3Like): boolean {
        const oldHash = this._hashPosition(oldPosition);
        const newHash = this._hashPosition(newPosition);

        if (oldHash === newHash) return true;

        const currentHash = this._particleToCell.get(particleId);
        if (currentHash !== oldHash) {
            this.insert(particleId, newPosition);
            return true;
        }

        this._removeFromCell(oldHash, particleId);

        let newCell = this._cells.get(newHash);
        if (!newCell) {
            newCell = this._acquireCell(newHash, newPosition);
            this._cells.set(newHash, newCell);
        }

        newCell.particles.push(particleId);
        this._particleToCell.set(particleId, newHash);
        this._updateCellStats(newCell, newPosition, true);

        return true;
    }

    query(bounds: { min: IVec3Like; max: IVec3Like }): readonly ParticleId[] {
        const result: ParticleId[] = [];
        const seen = new Set<ParticleId>();

        const minCell = this._positionToCell(bounds.min);
        const maxCell = this._positionToCell(bounds.max);

        for (let x = minCell.x; x <= maxCell.x; x++) {
            for (let y = minCell.y; y <= maxCell.y; y++) {
                for (let z = minCell.z; z <= maxCell.z; z++) {
                    const hash = this._hashCell(x, y, z);
                    const cell = this._cells.get(hash);

                    if (cell) {
                        for (const particleId of cell.particles) {
                            if (!seen.has(particleId)) {
                                seen.add(particleId);
                                result.push(particleId);
                            }
                        }
                    }
                }
            }
        }

        return result;
    }

    queryRadius(center: IVec3Like, radius: number): readonly ParticleId[] {
        const bounds = {
            min: { x: center.x - radius, y: center.y - radius, z: center.z - radius },
            max: { x: center.x + radius, y: center.y + radius, z: center.z + radius },
        };

        return this.query(bounds);
    }

    queryNearest(position: IVec3Like, count: number): readonly ParticleId[] {
        if (count <= 0) return [];

        const result: { particleId: ParticleId; distanceSq: number }[] = [];
        const searchRadius = Math.max(this._cellSize.x, this._cellSize.y, this._cellSize.z);
        let currentRadius = searchRadius;

        while (result.length < count && currentRadius < 1000) {
            const candidates = this.queryRadius(position, currentRadius);

            for (const particleId of candidates) {
                if (result.find((r) => r.particleId === particleId)) continue;

                const cell = this._cells.get(this._particleToCell.get(particleId)!);
                if (!cell) continue;

                const dx = cell.centerOfMass.x - position.x;
                const dy = cell.centerOfMass.y - position.y;
                const dz = cell.centerOfMass.z - position.z;
                const distanceSq = dx * dx + dy * dy + dz * dz;

                result.push({ particleId, distanceSq });
            }

            if (result.length >= count) break;
            currentRadius *= 2;
        }

        result.sort((a, b) => a.distanceSq - b.distanceSq);
        return result.slice(0, count).map((r) => r.particleId);
    }

    clear(): void {
        for (const cell of this._cells.values()) {
            this._releaseCell(cell);
        }

        this._cells.clear();
        this._particleToCell.clear();
        this._particleCount = 0;
    }

    optimize(): void {
        const emptyHashes: bigint[] = [];

        for (const [hash, cell] of this._cells.entries()) {
            if (cell.particles.length === 0) {
                emptyHashes.push(hash);
            }
        }

        for (const hash of emptyHashes) {
            const cell = this._cells.get(hash)!;
            this._cells.delete(hash);
            this._releaseCell(cell);
        }
    }

    private _hashPosition(position: IVec3Like): bigint {
        const cell = this._positionToCell(position);
        return this._hashCell(cell.x, cell.y, cell.z);
    }

    private _positionToCell(position: IVec3Like): { x: number; y: number; z: number } {
        return {
            x: Math.floor((position.x - this._bounds.min.x) * this._invCellSize.x),
            y: Math.floor((position.y - this._bounds.min.y) * this._invCellSize.y),
            z: Math.floor((position.z - this._bounds.min.z) * this._invCellSize.z),
        };
    }

    private _hashCell(x: number, y: number, z: number): bigint {
        const p1 = BigInt(73856093);
        const p2 = BigInt(19349663);
        const p3 = BigInt(83492791);

        return (BigInt(x) * p1) ^ (BigInt(y) * p2) ^ (BigInt(z) * p3);
    }

    private _cellToPosition(x: number, y: number, z: number): ImmutableVec3 {
        return {
            x: this._bounds.min.x + (x + 0.5) * this._cellSize.x,
            y: this._bounds.min.y + (y + 0.5) * this._cellSize.y,
            z: this._bounds.min.z + (z + 0.5) * this._cellSize.z,
        };
    }

    private _createCell(): SpatialCell {
        return {
            bounds: {
                min: { x: 0, y: 0, z: 0 },
                max: { x: 0, y: 0, z: 0 },
            },
            particles: [],
            density: 0,
            centerOfMass: { x: 0, y: 0, z: 0 },

            reset(): void {
                this.particles.length = 0;
                this.density = 0;
                (this.centerOfMass as any).x = 0;
                (this.centerOfMass as any).y = 0;
                (this.centerOfMass as any).z = 0;
            },

            dispose(): void {
                this.reset();
            },
        };
    }

    private _acquireCell(hash: bigint, position: IVec3Like): SpatialCell {
        let cell = this._cellPool.pop();

        if (!cell) {
            cell = this._createCell();
        } else {
            cell.reset();
        }

        const cellCoords = this._positionToCell(position);
        const cellPos = this._cellToPosition(cellCoords.x, cellCoords.y, cellCoords.z);

        (cell.bounds as any) = {
            min: {
                x: cellPos.x - this._cellSize.x * 0.5,
                y: cellPos.y - this._cellSize.y * 0.5,
                z: cellPos.z - this._cellSize.z * 0.5,
            },
            max: {
                x: cellPos.x + this._cellSize.x * 0.5,
                y: cellPos.y + this._cellSize.y * 0.5,
                z: cellPos.z + this._cellSize.z * 0.5,
            },
        };

        return cell;
    }

    private _releaseCell(cell: SpatialCell): void {
        if (this._cellPool.length < 256) {
            cell.reset();
            this._cellPool.push(cell);
        }
    }

    private _removeFromCell(cellHash: bigint, particleId: ParticleId): void {
        const cell = this._cells.get(cellHash);
        if (!cell) return;

        const index = cell.particles.indexOf(particleId);
        if (index === -1) return;

        const lastIndex = cell.particles.length - 1;
        if (index !== lastIndex) {
            cell.particles[index] = cell.particles[lastIndex];
        }
        cell.particles.pop();

        this._updateCellStats(cell, cell.centerOfMass, false);

        if (cell.particles.length === 0 && this._cellPool.length < 256) {
            this._cells.delete(cellHash);
            this._releaseCell(cell);
        }
    }

    private _updateCellStats(cell: SpatialCell, position: IVec3Like, isAdd: boolean): void {
        const count = cell.particles.length;

        if (count === 0) {
            cell.density = 0;
            (cell.centerOfMass as any).x = 0;
            (cell.centerOfMass as any).y = 0;
            (cell.centerOfMass as any).z = 0;
            return;
        }

        if (isAdd) {
            const prevCount = count - 1;
            if (prevCount === 0) {
                (cell.centerOfMass as any).x = position.x;
                (cell.centerOfMass as any).y = position.y;
                (cell.centerOfMass as any).z = position.z;
            } else {
                (cell.centerOfMass as any).x =
                    (cell.centerOfMass.x * prevCount + position.x) / count;
                (cell.centerOfMass as any).y =
                    (cell.centerOfMass.y * prevCount + position.y) / count;
                (cell.centerOfMass as any).z =
                    (cell.centerOfMass.z * prevCount + position.z) / count;
            }
        }

        const cellVolume = this._cellSize.x * this._cellSize.y * this._cellSize.z;
        cell.density = count / cellVolume;
    }
}
