import type { IVec3Like, Vec3 } from '@axrone/numeric';
import type { ParticleId } from '../types';
import type {
    IParticleBuffer,
    IAllocatable,
    ReadonlyFloat32Array,
    ReadonlyUint32Array,
} from './interfaces';
import { ParticleSystemException } from './error';
import { MemoryManager } from './memory';

export class SOAParticleBuffer implements IParticleBuffer {
    private _capacity: number = 0;
    private _count: number = 0;
    private _allocated: boolean = false;

    private _alive!: Uint32Array;
    private _positions!: Float32Array;
    private _velocities!: Float32Array;
    private _accelerations!: Float32Array;
    private _lifetimes!: Float32Array;
    private _ages!: Float32Array;
    private _sizes!: Float32Array;
    private _colors!: Float32Array;
    private _rotations!: Float32Array;
    private _angularVelocities!: Float32Array;
    private _customData!: Float32Array[];
    private _ids!: Uint32Array;

    private _freeIndices: number[] = [];
    private _particleToIndex = new Map<ParticleId, number>();
    private _indexToParticle: ParticleId[] = [];
    private _nextParticleId: number = 1;

    get allocated(): boolean {
        return this._allocated;
    }
    get capacity(): number {
        return this._capacity;
    }
    get count(): number {
        return this._count;
    }

    get alive(): ReadonlyUint32Array {
        return this._alive as ReadonlyUint32Array;
    }
    get positions(): ReadonlyFloat32Array {
        return this._positions as ReadonlyFloat32Array;
    }
    get velocities(): ReadonlyFloat32Array {
        return this._velocities as ReadonlyFloat32Array;
    }
    get accelerations(): ReadonlyFloat32Array {
        return this._accelerations as ReadonlyFloat32Array;
    }
    get lifetimes(): ReadonlyFloat32Array {
        return this._lifetimes as ReadonlyFloat32Array;
    }
    get ages(): ReadonlyFloat32Array {
        return this._ages as ReadonlyFloat32Array;
    }
    get sizes(): ReadonlyFloat32Array {
        return this._sizes as ReadonlyFloat32Array;
    }
    get colors(): ReadonlyFloat32Array {
        return this._colors as ReadonlyFloat32Array;
    }
    get rotations(): ReadonlyFloat32Array {
        return this._rotations as ReadonlyFloat32Array;
    }
    get angularVelocities(): ReadonlyFloat32Array {
        return this._angularVelocities as ReadonlyFloat32Array;
    }
    get customData(): readonly ReadonlyFloat32Array[] {
        return this._customData as ReadonlyFloat32Array[];
    }
    get ids(): ReadonlyUint32Array {
        return this._ids as ReadonlyUint32Array;
    }

    allocate(capacity: number): boolean {
        if (this._allocated) this.deallocate();

        try {
            this._capacity = capacity;

            this._alive = new Uint32Array(capacity);
            this._positions = new Float32Array(capacity * 3);
            this._velocities = new Float32Array(capacity * 3);
            this._accelerations = new Float32Array(capacity * 3);
            this._lifetimes = new Float32Array(capacity);
            this._ages = new Float32Array(capacity);
            this._sizes = new Float32Array(capacity * 3);
            this._colors = new Float32Array(capacity * 4);
            this._rotations = new Float32Array(capacity * 3);
            this._angularVelocities = new Float32Array(capacity * 3);
            this._ids = new Uint32Array(capacity);

            this._customData = [
                new Float32Array(capacity * 4),
                new Float32Array(capacity * 4),
                new Float32Array(capacity * 4),
                new Float32Array(capacity * 4),
            ];

            this._freeIndices = Array.from({ length: capacity }, (_, i) => capacity - 1 - i);
            this._indexToParticle = new Array(capacity);

            this._allocated = true;
            return true;
        } catch (error) {
            this.deallocate();
            return false;
        }
    }

    deallocate(): void {
        if (!this._allocated) return;

        // Instead of using memory pools which have type issues, just null out references
        this._alive = null as any;
        this._positions = null as any;
        this._velocities = null as any;
        this._accelerations = null as any;
        this._lifetimes = null as any;
        this._ages = null as any;
        this._sizes = null as any;
        this._colors = null as any;
        this._rotations = null as any;
        this._angularVelocities = null as any;
        this._ids = null as any;
        this._customData = null as any;

        this._allocated = false;
        this._count = 0;
        this._capacity = 0;
        this._freeIndices.length = 0;
        this._particleToIndex.clear();
        this._indexToParticle.length = 0;
    }

    resize(newCapacity: number): boolean {
        if (!this._allocated) return this.allocate(newCapacity);
        if (newCapacity <= this._capacity) return true;

        const oldData = {
            alive: new Uint32Array(this._alive),
            positions: new Float32Array(this._positions),
            velocities: new Float32Array(this._velocities),
            accelerations: new Float32Array(this._accelerations),
            lifetimes: new Float32Array(this._lifetimes),
            ages: new Float32Array(this._ages),
            sizes: new Float32Array(this._sizes),
            colors: new Float32Array(this._colors),
            rotations: new Float32Array(this._rotations),
            angularVelocities: new Float32Array(this._angularVelocities),
            ids: new Uint32Array(this._ids),
            customData: this._customData.map((arr) => new Float32Array(arr)),
        };

        this.deallocate();

        if (!this.allocate(newCapacity)) return false;

        this._alive.set(oldData.alive);
        this._positions.set(oldData.positions);
        this._velocities.set(oldData.velocities);
        this._accelerations.set(oldData.accelerations);
        this._lifetimes.set(oldData.lifetimes);
        this._ages.set(oldData.ages);
        this._sizes.set(oldData.sizes);
        this._colors.set(oldData.colors);
        this._rotations.set(oldData.rotations);
        this._angularVelocities.set(oldData.angularVelocities);
        this._ids.set(oldData.ids);

        for (let i = 0; i < this._customData.length; i++) {
            this._customData[i].set(oldData.customData[i]);
        }

        for (let i = this._count; i < newCapacity; i++) {
            this._freeIndices.push(i);
        }

        return true;
    }

    addParticle(
        position: IVec3Like,
        velocity: IVec3Like,
        lifetime: number,
        size: number,
        color: number
    ): ParticleId | null {
        if (!this._allocated) {
            throw ParticleSystemException.systemNotInitialized();
        }

        if (this._freeIndices.length === 0) {
            if (!this.resize(this._capacity * 2)) return null;
        }

        const index = this._freeIndices.pop()!;
        const particleId = this._nextParticleId++ as ParticleId;

        this._alive[index] = 1;

        const pos3 = index * 3;
        this._positions[pos3] = position.x;
        this._positions[pos3 + 1] = position.y;
        this._positions[pos3 + 2] = position.z;

        this._velocities[pos3] = velocity.x;
        this._velocities[pos3 + 1] = velocity.y;
        this._velocities[pos3 + 2] = velocity.z;

        this._accelerations[pos3] = 0;
        this._accelerations[pos3 + 1] = 0;
        this._accelerations[pos3 + 2] = 0;

        this._lifetimes[index] = lifetime;
        this._ages[index] = 0;

        this._sizes[pos3] = size;
        this._sizes[pos3 + 1] = size;
        this._sizes[pos3 + 2] = size;

        const color4 = index * 4;
        this._colors[color4] = ((color >>> 24) & 0xff) / 255;
        this._colors[color4 + 1] = ((color >>> 16) & 0xff) / 255;
        this._colors[color4 + 2] = ((color >>> 8) & 0xff) / 255;
        this._colors[color4 + 3] = (color & 0xff) / 255;

        this._rotations[pos3] = 0;
        this._rotations[pos3 + 1] = 0;
        this._rotations[pos3 + 2] = 0;

        this._angularVelocities[pos3] = 0;
        this._angularVelocities[pos3 + 1] = 0;
        this._angularVelocities[pos3 + 2] = 0;

        this._ids[index] = particleId as number;

        this._particleToIndex.set(particleId, index);
        this._indexToParticle[index] = particleId;
        this._count++;

        return particleId;
    }

    removeParticle(index: number): boolean {
        if (!this._allocated || index < 0 || index >= this._capacity || !this._alive[index]) {
            return false;
        }

        const particleId = this._indexToParticle[index];

        this._alive[index] = 0;
        this._particleToIndex.delete(particleId);
        this._indexToParticle[index] = undefined as any;
        this._freeIndices.push(index);
        this._count--;

        return true;
    }

    killParticle(particleId: ParticleId): boolean {
        const index = this._particleToIndex.get(particleId);
        return index !== undefined ? this.removeParticle(index) : false;
    }

    getParticleIndex(particleId: ParticleId): number {
        return this._particleToIndex.get(particleId) ?? -1;
    }

    getParticleId(index: number): ParticleId {
        return this._indexToParticle[index] ?? (0 as ParticleId);
    }

    getPosition(index: number): Vec3 {
        const pos3 = index * 3;
        return {
            x: this._positions[pos3],
            y: this._positions[pos3 + 1],
            z: this._positions[pos3 + 2],
        } as Vec3;
    }

    setPosition(index: number, position: IVec3Like): void {
        const pos3 = index * 3;
        this._positions[pos3] = position.x;
        this._positions[pos3 + 1] = position.y;
        this._positions[pos3 + 2] = position.z;
    }

    getVelocity(index: number): Vec3 {
        const pos3 = index * 3;
        return {
            x: this._velocities[pos3],
            y: this._velocities[pos3 + 1],
            z: this._velocities[pos3 + 2],
        } as Vec3;
    }

    setVelocity(index: number, velocity: IVec3Like): void {
        const pos3 = index * 3;
        this._velocities[pos3] = velocity.x;
        this._velocities[pos3 + 1] = velocity.y;
        this._velocities[pos3 + 2] = velocity.z;
    }

    getLifetime(index: number): number {
        return this._lifetimes[index];
    }

    setLifetime(index: number, lifetime: number): void {
        this._lifetimes[index] = lifetime;
    }

    getAge(index: number): number {
        return this._ages[index];
    }

    setAge(index: number, age: number): void {
        this._ages[index] = age;
    }

    getSize(index: number): number {
        return this._sizes[index * 3];
    }

    setSize(index: number, size: number): void {
        const pos3 = index * 3;
        this._sizes[pos3] = size;
        this._sizes[pos3 + 1] = size;
        this._sizes[pos3 + 2] = size;
    }

    getColor(index: number): number {
        const color4 = index * 4;
        const r = Math.round(this._colors[color4] * 255);
        const g = Math.round(this._colors[color4 + 1] * 255);
        const b = Math.round(this._colors[color4 + 2] * 255);
        const a = Math.round(this._colors[color4 + 3] * 255);
        return (r << 24) | (g << 16) | (b << 8) | a;
    }

    setColor(index: number, color: number): void {
        const color4 = index * 4;
        this._colors[color4] = ((color >>> 24) & 0xff) / 255;
        this._colors[color4 + 1] = ((color >>> 16) & 0xff) / 255;
        this._colors[color4 + 2] = ((color >>> 8) & 0xff) / 255;
        this._colors[color4 + 3] = (color & 0xff) / 255;
    }

    getCustomData(index: number, slot: number): ReadonlyFloat32Array {
        if (slot < 0 || slot >= this._customData.length) {
            throw new Error(`Invalid custom data slot: ${slot}`);
        }
        const data4 = index * 4;
        return this._customData[slot].subarray(data4, data4 + 4) as ReadonlyFloat32Array;
    }

    setCustomData(index: number, slot: number, data: Float32Array): void {
        if (slot < 0 || slot >= this._customData.length) {
            throw new Error(`Invalid custom data slot: ${slot}`);
        }
        const data4 = index * 4;
        this._customData[slot].set(data, data4);
    }

    clear(): void {
        if (!this._allocated) return;

        this._count = 0;
        this._alive.fill(0);
        this._particleToIndex.clear();
        this._indexToParticle.fill(undefined as any);
        this._freeIndices = Array.from(
            { length: this._capacity },
            (_, i) => this._capacity - 1 - i
        );
    }

    compact(): void {
        if (!this._allocated || this._count === 0) return;

        let writeIndex = 0;

        for (let readIndex = 0; readIndex < this._capacity; readIndex++) {
            if (!this._alive[readIndex]) continue;

            if (readIndex !== writeIndex) {
                this._copyParticle(readIndex, writeIndex);
                const particleId = this._indexToParticle[readIndex];
                this._particleToIndex.set(particleId, writeIndex);
                this._indexToParticle[writeIndex] = particleId;
                this._indexToParticle[readIndex] = undefined as any;
            }
            writeIndex++;
        }

        for (let i = writeIndex; i < this._capacity; i++) {
            this._alive[i] = 0;
        }

        this._freeIndices = Array.from(
            { length: this._capacity - this._count },
            (_, i) => this._count + i
        );
    }

    sort(compareFn?: (a: number, b: number) => number): void {
        if (!this._allocated || this._count <= 1) return;

        const aliveIndices: number[] = [];
        for (let i = 0; i < this._capacity; i++) {
            if (this._alive[i]) aliveIndices.push(i);
        }

        if (compareFn) {
            aliveIndices.sort(compareFn);
        } else {
            aliveIndices.sort((a, b) => this._ages[a] - this._ages[b]);
        }

        const tempData = this._createTempArrays();

        for (let i = 0; i < aliveIndices.length; i++) {
            const oldIndex = aliveIndices[i];
            this._copyParticleToTemp(oldIndex, i, tempData);
        }

        for (let i = 0; i < aliveIndices.length; i++) {
            this._copyParticleFromTemp(i, i, tempData);
            const particleId = tempData.ids[i] as ParticleId;
            this._particleToIndex.set(particleId, i);
            this._indexToParticle[i] = particleId;
        }

        for (let i = aliveIndices.length; i < this._capacity; i++) {
            this._alive[i] = 0;
            this._indexToParticle[i] = undefined as any;
        }

        this._freeIndices = Array.from(
            { length: this._capacity - this._count },
            (_, i) => this._count + i
        );
    }

    private _copyParticle(from: number, to: number): void {
        this._alive[to] = this._alive[from];

        const from3 = from * 3;
        const to3 = to * 3;

        this._positions[to3] = this._positions[from3];
        this._positions[to3 + 1] = this._positions[from3 + 1];
        this._positions[to3 + 2] = this._positions[from3 + 2];

        this._velocities[to3] = this._velocities[from3];
        this._velocities[to3 + 1] = this._velocities[from3 + 1];
        this._velocities[to3 + 2] = this._velocities[from3 + 2];

        this._accelerations[to3] = this._accelerations[from3];
        this._accelerations[to3 + 1] = this._accelerations[from3 + 1];
        this._accelerations[to3 + 2] = this._accelerations[from3 + 2];

        this._sizes[to3] = this._sizes[from3];
        this._sizes[to3 + 1] = this._sizes[from3 + 1];
        this._sizes[to3 + 2] = this._sizes[from3 + 2];

        this._rotations[to3] = this._rotations[from3];
        this._rotations[to3 + 1] = this._rotations[from3 + 1];
        this._rotations[to3 + 2] = this._rotations[from3 + 2];

        this._angularVelocities[to3] = this._angularVelocities[from3];
        this._angularVelocities[to3 + 1] = this._angularVelocities[from3 + 1];
        this._angularVelocities[to3 + 2] = this._angularVelocities[from3 + 2];

        const from4 = from * 4;
        const to4 = to * 4;

        this._colors[to4] = this._colors[from4];
        this._colors[to4 + 1] = this._colors[from4 + 1];
        this._colors[to4 + 2] = this._colors[from4 + 2];
        this._colors[to4 + 3] = this._colors[from4 + 3];

        for (let i = 0; i < this._customData.length; i++) {
            this._customData[i][to4] = this._customData[i][from4];
            this._customData[i][to4 + 1] = this._customData[i][from4 + 1];
            this._customData[i][to4 + 2] = this._customData[i][from4 + 2];
            this._customData[i][to4 + 3] = this._customData[i][from4 + 3];
        }

        this._lifetimes[to] = this._lifetimes[from];
        this._ages[to] = this._ages[from];
        this._ids[to] = this._ids[from];
    }

    private _createTempArrays() {
        return {
            alive: new Uint32Array(this._count),
            positions: new Float32Array(this._count * 3),
            velocities: new Float32Array(this._count * 3),
            accelerations: new Float32Array(this._count * 3),
            sizes: new Float32Array(this._count * 3),
            colors: new Float32Array(this._count * 4),
            rotations: new Float32Array(this._count * 3),
            angularVelocities: new Float32Array(this._count * 3),
            customData: this._customData.map(() => new Float32Array(this._count * 4)),
            lifetimes: new Float32Array(this._count),
            ages: new Float32Array(this._count),
            ids: new Uint32Array(this._count),
        };
    }

    private _copyParticleToTemp(
        from: number,
        to: number,
        temp: ReturnType<typeof this._createTempArrays>
    ): void {
        temp.alive[to] = this._alive[from];

        const from3 = from * 3;
        const to3 = to * 3;

        temp.positions[to3] = this._positions[from3];
        temp.positions[to3 + 1] = this._positions[from3 + 1];
        temp.positions[to3 + 2] = this._positions[from3 + 2];

        temp.velocities[to3] = this._velocities[from3];
        temp.velocities[to3 + 1] = this._velocities[from3 + 1];
        temp.velocities[to3 + 2] = this._velocities[from3 + 2];

        temp.accelerations[to3] = this._accelerations[from3];
        temp.accelerations[to3 + 1] = this._accelerations[from3 + 1];
        temp.accelerations[to3 + 2] = this._accelerations[from3 + 2];

        temp.sizes[to3] = this._sizes[from3];
        temp.sizes[to3 + 1] = this._sizes[from3 + 1];
        temp.sizes[to3 + 2] = this._sizes[from3 + 2];

        temp.rotations[to3] = this._rotations[from3];
        temp.rotations[to3 + 1] = this._rotations[from3 + 1];
        temp.rotations[to3 + 2] = this._rotations[from3 + 2];

        temp.angularVelocities[to3] = this._angularVelocities[from3];
        temp.angularVelocities[to3 + 1] = this._angularVelocities[from3 + 1];
        temp.angularVelocities[to3 + 2] = this._angularVelocities[from3 + 2];

        const from4 = from * 4;
        const to4 = to * 4;

        temp.colors[to4] = this._colors[from4];
        temp.colors[to4 + 1] = this._colors[from4 + 1];
        temp.colors[to4 + 2] = this._colors[from4 + 2];
        temp.colors[to4 + 3] = this._colors[from4 + 3];

        for (let i = 0; i < this._customData.length; i++) {
            temp.customData[i][to4] = this._customData[i][from4];
            temp.customData[i][to4 + 1] = this._customData[i][from4 + 1];
            temp.customData[i][to4 + 2] = this._customData[i][from4 + 2];
            temp.customData[i][to4 + 3] = this._customData[i][from4 + 3];
        }

        temp.lifetimes[to] = this._lifetimes[from];
        temp.ages[to] = this._ages[from];
        temp.ids[to] = this._ids[from];
    }

    private _copyParticleFromTemp(
        from: number,
        to: number,
        temp: ReturnType<typeof this._createTempArrays>
    ): void {
        this._alive[to] = temp.alive[from];

        const from3 = from * 3;
        const to3 = to * 3;

        this._positions[to3] = temp.positions[from3];
        this._positions[to3 + 1] = temp.positions[from3 + 1];
        this._positions[to3 + 2] = temp.positions[from3 + 2];

        this._velocities[to3] = temp.velocities[from3];
        this._velocities[to3 + 1] = temp.velocities[from3 + 1];
        this._velocities[to3 + 2] = temp.velocities[from3 + 2];

        this._accelerations[to3] = temp.accelerations[from3];
        this._accelerations[to3 + 1] = temp.accelerations[from3 + 1];
        this._accelerations[to3 + 2] = temp.accelerations[from3 + 2];

        this._sizes[to3] = temp.sizes[from3];
        this._sizes[to3 + 1] = temp.sizes[from3 + 1];
        this._sizes[to3 + 2] = temp.sizes[from3 + 2];

        this._rotations[to3] = temp.rotations[from3];
        this._rotations[to3 + 1] = temp.rotations[from3 + 1];
        this._rotations[to3 + 2] = temp.rotations[from3 + 2];

        this._angularVelocities[to3] = temp.angularVelocities[from3];
        this._angularVelocities[to3 + 1] = temp.angularVelocities[from3 + 1];
        this._angularVelocities[to3 + 2] = temp.angularVelocities[from3 + 2];

        const from4 = from * 4;
        const to4 = to * 4;

        this._colors[to4] = temp.colors[from4];
        this._colors[to4 + 1] = temp.colors[from4 + 1];
        this._colors[to4 + 2] = temp.colors[from4 + 2];
        this._colors[to4 + 3] = temp.colors[from4 + 3];

        for (let i = 0; i < this._customData.length; i++) {
            this._customData[i][to4] = temp.customData[i][from4];
            this._customData[i][to4 + 1] = temp.customData[i][from4 + 1];
            this._customData[i][to4 + 2] = temp.customData[i][from4 + 2];
            this._customData[i][to4 + 3] = temp.customData[i][from4 + 3];
        }

        this._lifetimes[to] = temp.lifetimes[from];
        this._ages[to] = temp.ages[from];
        this._ids[to] = temp.ids[from];
    }
}
