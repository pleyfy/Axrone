import { Vec3, IVec3Like } from '@axrone/numeric';
import { ParticleId } from './types';
import { IParticleSOA } from './interfaces';
import { ParticleMemoryManager } from './core/memory';
import { TypedArrayPools, PoolableTypedArray } from '@axrone/utility';

export interface ParticleSOAStats {
    capacity: number;
    count: number;
    activeCount: number;
    freeSlots: number;
    memoryUsage: number;
    fragmentation: number;
    averageAge: number;
    oldestParticle: number;
    youngestParticle: number;
}

export interface ParticleSOAConfig {
    capacity: number;
    enableMemoryTracking: boolean;
    enablePerformanceOptimizations: boolean;
    defragmentThreshold: number;
    autoResize: boolean;
    maxCapacity: number;
}

export class ParticleSOA implements IParticleSOA {
    private readonly _config: ParticleSOAConfig;
    private readonly _memoryManager: ParticleMemoryManager;
    private _capacity: number;
    private _count: number;
    private _activeCount: number;

    private _positions!: PoolableTypedArray<Float32Array>;
    private _velocities!: PoolableTypedArray<Float32Array>;
    private _accelerations!: PoolableTypedArray<Float32Array>;
    private _lifetimes!: PoolableTypedArray<Float32Array>;
    private _ages!: PoolableTypedArray<Float32Array>;
    private _sizes!: PoolableTypedArray<Float32Array>;
    private _colors!: PoolableTypedArray<Float32Array>;
    private _rotations!: PoolableTypedArray<Float32Array>;
    private _angularVelocities!: PoolableTypedArray<Float32Array>;
    private _customData1!: PoolableTypedArray<Float32Array>;
    private _customData2!: PoolableTypedArray<Float32Array>;

    private _ids!: PoolableTypedArray<Uint32Array>;
    private _birthTimes!: PoolableTypedArray<Float32Array>;
    private _masses!: PoolableTypedArray<Float32Array>;
    private _materialIndices!: PoolableTypedArray<Uint16Array>;
    private _emitterIndices!: PoolableTypedArray<Uint16Array>;
    private _activeFlags!: PoolableTypedArray<Uint8Array>;

    private _freeList: number[];
    private _sortedIndices!: PoolableTypedArray<Uint32Array>;
    private _compactMapping!: PoolableTypedArray<Uint32Array>;
    private _nextId: number = 0;
    private _lastDefragmentTime: number = 0;

    private readonly _stats: ParticleSOAStats = {
        capacity: 0,
        count: 0,
        activeCount: 0,
        freeSlots: 0,
        memoryUsage: 0,
        fragmentation: 0,
        averageAge: 0,
        oldestParticle: 0,
        youngestParticle: 0,
    };

    constructor(config: Partial<ParticleSOAConfig> = {}) {
        this._config = {
            capacity: 1000,
            enableMemoryTracking: true,
            enablePerformanceOptimizations: true,
            defragmentThreshold: 0.3,
            autoResize: true,
            maxCapacity: 1000000,
            ...config,
        };

        this._memoryManager = new ParticleMemoryManager();
        this._capacity = this._config.capacity;
        this._count = 0;
        this._activeCount = 0;
        this._freeList = [];

        this._allocateArrays();
    }
    private _allocateArrays(): void {
        const capacity = this._capacity;

        this._positions = this._memoryManager.allocateTypedArray(Float32Array, capacity * 3);
        this._velocities = this._memoryManager.allocateTypedArray(Float32Array, capacity * 3);
        this._accelerations = this._memoryManager.allocateTypedArray(Float32Array, capacity * 3);
        this._lifetimes = this._memoryManager.allocateTypedArray(Float32Array, capacity);
        this._ages = this._memoryManager.allocateTypedArray(Float32Array, capacity);
        this._sizes = this._memoryManager.allocateTypedArray(Float32Array, capacity * 3);
        this._colors = this._memoryManager.allocateTypedArray(Float32Array, capacity * 4);
        this._rotations = this._memoryManager.allocateTypedArray(Float32Array, capacity * 3);
        this._angularVelocities = this._memoryManager.allocateTypedArray(
            Float32Array,
            capacity * 3
        );
        this._customData1 = this._memoryManager.allocateTypedArray(Float32Array, capacity * 4);
        this._customData2 = this._memoryManager.allocateTypedArray(Float32Array, capacity * 4);

        this._ids = this._memoryManager.allocateTypedArray(Uint32Array, capacity);
        this._birthTimes = this._memoryManager.allocateTypedArray(Float32Array, capacity);
        this._masses = this._memoryManager.allocateTypedArray(Float32Array, capacity);
        this._materialIndices = this._memoryManager.allocateTypedArray(Uint16Array, capacity);
        this._emitterIndices = this._memoryManager.allocateTypedArray(Uint16Array, capacity);
        this._activeFlags = this._memoryManager.allocateTypedArray(Uint8Array, capacity);

        this._sortedIndices = this._memoryManager.allocateTypedArray(Uint32Array, capacity);
        this._compactMapping = this._memoryManager.allocateTypedArray(Uint32Array, capacity);

        this._masses.array.fill(1.0);
    }

    private _initializeFreeList(): void {
        this._freeList.length = 0;
        for (let i = this._capacity - 1; i >= 0; i--) {
            this._freeList.push(i);
            this._sortedIndices.array[i] = i;
        }
    }

    get capacity(): number {
        return this._capacity;
    }
    get count(): number {
        return this._count;
    }
    get activeCount(): number {
        return this._activeCount;
    }
    get positions(): Float32Array {
        return this._positions.array;
    }
    get velocities(): Float32Array {
        return this._velocities.array;
    }
    get accelerations(): Float32Array {
        return this._accelerations.array;
    }
    get lifetimes(): Float32Array {
        return this._lifetimes.array;
    }
    get ages(): Float32Array {
        return this._ages.array;
    }
    get sizes(): Float32Array {
        return this._sizes.array;
    }
    get colors(): Float32Array {
        return this._colors.array;
    }
    get rotations(): Float32Array {
        return this._rotations.array;
    }
    get angularVelocities(): Float32Array {
        return this._angularVelocities.array;
    }
    get customData1(): Float32Array {
        return this._customData1.array;
    }
    get customData2(): Float32Array {
        return this._customData2.array;
    }
    get ids(): Uint32Array {
        return this._ids.array;
    }
    get birthTimes(): Float32Array {
        return this._birthTimes.array;
    }
    get masses(): Float32Array {
        return this._masses.array;
    }
    get materialIndices(): Uint16Array {
        return this._materialIndices.array;
    }
    get emitterIndices(): Uint16Array {
        return this._emitterIndices.array;
    }
    get activeFlags(): Uint8Array {
        return this._activeFlags.array;
    }

    addParticle(
        position: IVec3Like,
        velocity: IVec3Like = { x: 0, y: 0, z: 0 },
        lifetime: number = 5.0,
        size: number | IVec3Like = 1.0,
        color: number | [number, number, number, number] = 0xffffffff,
        emitterIndex: number = 0,
        materialIndex: number = 0,
        mass: number = 1.0
    ): ParticleId | null {
        if (this._freeList.length === 0) {
            if (this._config.autoResize && this._capacity < this._config.maxCapacity) {
                this._resize(Math.min(this._capacity * 2, this._config.maxCapacity));
            } else {
                return null;
            }
        }

        const index = this._freeList.pop()!;
        const particleId = this._nextId++ as ParticleId;
        const currentTime = performance.now();

        this._ids.array[index] = particleId;
        this._birthTimes.array[index] = currentTime;
        this._masses.array[index] = mass;
        this._materialIndices.array[index] = materialIndex;
        this._emitterIndices.array[index] = emitterIndex;
        this._activeFlags.array[index] = 1;

        const posOffset = index * 3;
        this._positions.array[posOffset] = position.x;
        this._positions.array[posOffset + 1] = position.y;
        this._positions.array[posOffset + 2] = position.z;

        const velOffset = index * 3;
        this._velocities.array[velOffset] = velocity.x;
        this._velocities.array[velOffset + 1] = velocity.y;
        this._velocities.array[velOffset + 2] = velocity.z;

        this._accelerations.array[velOffset] = 0;
        this._accelerations.array[velOffset + 1] = 0;
        this._accelerations.array[velOffset + 2] = 0;

        this._lifetimes.array[index] = lifetime;
        this._ages.array[index] = 0;

        const sizeOffset = index * 3;
        if (typeof size === 'number') {
            this._sizes.array[sizeOffset] = size;
            this._sizes.array[sizeOffset + 1] = size;
            this._sizes.array[sizeOffset + 2] = size;
        } else {
            this._sizes.array[sizeOffset] = size.x;
            this._sizes.array[sizeOffset + 1] = size.y;
            this._sizes.array[sizeOffset + 2] = size.z;
        }

        const colorOffset = index * 4;
        if (typeof color === 'number') {
            const r = (color >>> 24) & 0xff;
            const g = (color >>> 16) & 0xff;
            const b = (color >>> 8) & 0xff;
            const a = color & 0xff;
            this._colors.array[colorOffset] = r / 255.0;
            this._colors.array[colorOffset + 1] = g / 255.0;
            this._colors.array[colorOffset + 2] = b / 255.0;
            this._colors.array[colorOffset + 3] = a / 255.0;
        } else {
            this._colors.array[colorOffset] = color[0];
            this._colors.array[colorOffset + 1] = color[1];
            this._colors.array[colorOffset + 2] = color[2];
            this._colors.array[colorOffset + 3] = color[3];
        }

        const rotOffset = index * 3;
        this._rotations.array[rotOffset] = 0;
        this._rotations.array[rotOffset + 1] = 0;
        this._rotations.array[rotOffset + 2] = 0;
        this._angularVelocities.array[rotOffset] = 0;
        this._angularVelocities.array[rotOffset + 1] = 0;
        this._angularVelocities.array[rotOffset + 2] = 0;

        const customOffset = index * 4;
        for (let i = 0; i < 4; i++) {
            this._customData1.array[customOffset + i] = 0;
            this._customData2.array[customOffset + i] = 0;
        }

        this._count++;
        this._activeCount++;
        return particleId;
    }

    removeParticle(index: number): void {
        if (index < 0 || index >= this._capacity || !this._activeFlags.array[index]) {
            return;
        }

        this._activeFlags.array[index] = 0;
        this._freeList.push(index);
        this._count--;
        this._activeCount--;
        this._ids.array[index] = 0;

        if (this._config.enablePerformanceOptimizations) {
            const fragmentation = this._calculateFragmentation();
            if (fragmentation > this._config.defragmentThreshold) {
                this._scheduleDefragmentation();
            }
        }
    }

    removeParticleById(particleId: ParticleId): boolean {
        const index = this._findParticleIndex(particleId);
        if (index !== -1) {
            this.removeParticle(index);
            return true;
        }
        return false;
    }

    private _findParticleIndex(particleId: ParticleId): number {
        for (let i = 0; i < this._capacity; i++) {
            if (this._activeFlags.array[i] && this._ids.array[i] === particleId) {
                return i;
            }
        }
        return -1;
    }

    updateAges(deltaTime: number): void {
        for (let i = 0; i < this._capacity; i++) {
            if (this._activeFlags.array[i]) {
                this._ages.array[i] += deltaTime;

                if (this._ages.array[i] >= this._lifetimes.array[i]) {
                    this.removeParticle(i);
                }
            }
        }
    }

    updatePositions(deltaTime: number): void {
        for (let i = 0; i < this._capacity; i++) {
            if (this._activeFlags.array[i]) {
                const offset = i * 3;
                this._positions.array[offset] += this._velocities.array[offset] * deltaTime;
                this._positions.array[offset + 1] += this._velocities.array[offset + 1] * deltaTime;
                this._positions.array[offset + 2] += this._velocities.array[offset + 2] * deltaTime;
            }
        }
    }

    updateVelocities(deltaTime: number): void {
        for (let i = 0; i < this._capacity; i++) {
            if (this._activeFlags.array[i]) {
                const offset = i * 3;
                this._velocities.array[offset] += this._accelerations.array[offset] * deltaTime;
                this._velocities.array[offset + 1] +=
                    this._accelerations.array[offset + 1] * deltaTime;
                this._velocities.array[offset + 2] +=
                    this._accelerations.array[offset + 2] * deltaTime;
            }
        }
    }

    getParticlePosition(index: number): Vec3 {
        const offset = index * 3;
        return new Vec3(
            this._positions.array[offset],
            this._positions.array[offset + 1],
            this._positions.array[offset + 2]
        );
    }

    setParticlePosition(index: number, position: IVec3Like): void {
        const offset = index * 3;
        this._positions.array[offset] = position.x;
        this._positions.array[offset + 1] = position.y;
        this._positions.array[offset + 2] = position.z;
    }

    getParticleVelocity(index: number): Vec3 {
        const offset = index * 3;
        return new Vec3(
            this._velocities.array[offset],
            this._velocities.array[offset + 1],
            this._velocities.array[offset + 2]
        );
    }

    setParticleVelocity(index: number, velocity: IVec3Like): void {
        const offset = index * 3;
        this._velocities.array[offset] = velocity.x;
        this._velocities.array[offset + 1] = velocity.y;
        this._velocities.array[offset + 2] = velocity.z;
    }

    getActiveIndices(): number[] {
        const activeIndices: number[] = [];
        for (let i = 0; i < this._capacity; i++) {
            if (this._activeFlags.array[i]) {
                activeIndices.push(i);
            }
        }
        return activeIndices;
    }

    getCompactData(): {
        positions: Float32Array;
        colors: Float32Array;
        sizes: Float32Array;
        count: number;
    } {
        const count = this._activeCount;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 4);
        const sizes = new Float32Array(count * 3);

        let writeIndex = 0;
        for (let i = 0; i < this._capacity; i++) {
            if (this._activeFlags.array[i]) {
                const posOffset = i * 3;
                const writePos = writeIndex * 3;
                positions[writePos] = this._positions.array[posOffset];
                positions[writePos + 1] = this._positions.array[posOffset + 1];
                positions[writePos + 2] = this._positions.array[posOffset + 2];

                const colorOffset = i * 4;
                const writeColor = writeIndex * 4;
                colors[writeColor] = this._colors.array[colorOffset];
                colors[writeColor + 1] = this._colors.array[colorOffset + 1];
                colors[writeColor + 2] = this._colors.array[colorOffset + 2];
                colors[writeColor + 3] = this._colors.array[colorOffset + 3];

                const sizeOffset = i * 3;
                const writeSize = writeIndex * 3;
                sizes[writeSize] = this._sizes.array[sizeOffset];
                sizes[writeSize + 1] = this._sizes.array[sizeOffset + 1];
                sizes[writeSize + 2] = this._sizes.array[sizeOffset + 2];

                writeIndex++;
            }
        }

        return { positions, colors, sizes, count };
    }

    clear(): void {
        this._count = 0;
        this._activeCount = 0;
        this._nextId = 0;
        this._activeFlags.fill(0);
        this._initializeFreeList();
    }

    resize(newCapacity: number): void {
        this._resize(newCapacity);
    }

    private _resize(newCapacity: number): void {
        if (newCapacity === this._capacity) {
            return;
        }

        const oldCapacity = this._capacity;
        this._capacity = newCapacity;

        const newPositions = this._memoryManager.allocateTypedArray(Float32Array, newCapacity * 3);
        const newVelocities = this._memoryManager.allocateTypedArray(Float32Array, newCapacity * 3);
        const newAccelerations = this._memoryManager.allocateTypedArray(
            Float32Array,
            newCapacity * 3
        );
        const newLifetimes = this._memoryManager.allocateTypedArray(Float32Array, newCapacity);
        const newAges = this._memoryManager.allocateTypedArray(Float32Array, newCapacity);
        const newSizes = this._memoryManager.allocateTypedArray(Float32Array, newCapacity * 3);
        const newColors = this._memoryManager.allocateTypedArray(Float32Array, newCapacity * 4);
        const newRotations = this._memoryManager.allocateTypedArray(Float32Array, newCapacity * 3);
        const newAngularVelocities = this._memoryManager.allocateTypedArray(
            Float32Array,
            newCapacity * 3
        );
        const newCustomData1 = this._memoryManager.allocateTypedArray(
            Float32Array,
            newCapacity * 4
        );
        const newCustomData2 = this._memoryManager.allocateTypedArray(
            Float32Array,
            newCapacity * 4
        );
        const newIds = this._memoryManager.allocateTypedArray(Uint32Array, newCapacity);
        const newBirthTimes = this._memoryManager.allocateTypedArray(Float32Array, newCapacity);
        const newMasses = this._memoryManager.allocateTypedArray(Float32Array, newCapacity);
        const newMaterialIndices = this._memoryManager.allocateTypedArray(Uint16Array, newCapacity);
        const newEmitterIndices = this._memoryManager.allocateTypedArray(Uint16Array, newCapacity);
        const newActiveFlags = this._memoryManager.allocateTypedArray(Uint8Array, newCapacity);
        const newSortedIndices = this._memoryManager.allocateTypedArray(Uint32Array, newCapacity);
        const newCompactMapping = this._memoryManager.allocateTypedArray(Uint32Array, newCapacity);

        const copyCount = Math.min(oldCapacity, newCapacity);
        newPositions.array.set(this._positions.array.subarray(0, copyCount * 3));
        newVelocities.array.set(this._velocities.array.subarray(0, copyCount * 3));
        newAccelerations.array.set(this._accelerations.array.subarray(0, copyCount * 3));
        newLifetimes.array.set(this._lifetimes.array.subarray(0, copyCount));
        newAges.array.set(this._ages.array.subarray(0, copyCount));
        newSizes.array.set(this._sizes.array.subarray(0, copyCount * 3));
        newColors.array.set(this._colors.array.subarray(0, copyCount * 4));
        newRotations.array.set(this._rotations.array.subarray(0, copyCount * 3));
        newAngularVelocities.array.set(this._angularVelocities.array.subarray(0, copyCount * 3));
        newCustomData1.array.set(this._customData1.array.subarray(0, copyCount * 4));
        newCustomData2.array.set(this._customData2.array.subarray(0, copyCount * 4));
        newIds.array.set(this._ids.array.subarray(0, copyCount));
        newBirthTimes.array.set(this._birthTimes.array.subarray(0, copyCount));
        newMasses.array.set(this._masses.array.subarray(0, copyCount));
        newMaterialIndices.array.set(this._materialIndices.array.subarray(0, copyCount));
        newEmitterIndices.array.set(this._emitterIndices.array.subarray(0, copyCount));
        newActiveFlags.array.set(this._activeFlags.array.subarray(0, copyCount));
        newSortedIndices.array.set(this._sortedIndices.array.subarray(0, copyCount));
        newCompactMapping.array.set(this._compactMapping.array.subarray(0, copyCount));

        for (let i = oldCapacity; i < newCapacity; i++) {
            newMasses.array[i] = 1.0;
        }

        this._memoryManager.releaseTypedArray(this._positions);
        this._memoryManager.releaseTypedArray(this._velocities);
        this._memoryManager.releaseTypedArray(this._accelerations);
        this._memoryManager.releaseTypedArray(this._lifetimes);
        this._memoryManager.releaseTypedArray(this._ages);
        this._memoryManager.releaseTypedArray(this._sizes);
        this._memoryManager.releaseTypedArray(this._colors);
        this._memoryManager.releaseTypedArray(this._rotations);
        this._memoryManager.releaseTypedArray(this._angularVelocities);
        this._memoryManager.releaseTypedArray(this._customData1);
        this._memoryManager.releaseTypedArray(this._customData2);
        this._memoryManager.releaseTypedArray(this._ids);
        this._memoryManager.releaseTypedArray(this._birthTimes);
        this._memoryManager.releaseTypedArray(this._masses);
        this._memoryManager.releaseTypedArray(this._materialIndices);
        this._memoryManager.releaseTypedArray(this._emitterIndices);
        this._memoryManager.releaseTypedArray(this._activeFlags);
        this._memoryManager.releaseTypedArray(this._sortedIndices);
        this._memoryManager.releaseTypedArray(this._compactMapping);

        this._positions = newPositions;
        this._velocities = newVelocities;
        this._accelerations = newAccelerations;
        this._lifetimes = newLifetimes;
        this._ages = newAges;
        this._sizes = newSizes;
        this._colors = newColors;
        this._rotations = newRotations;
        this._angularVelocities = newAngularVelocities;
        this._customData1 = newCustomData1;
        this._customData2 = newCustomData2;
        this._ids = newIds;
        this._birthTimes = newBirthTimes;
        this._masses = newMasses;
        this._materialIndices = newMaterialIndices;
        this._emitterIndices = newEmitterIndices;
        this._activeFlags = newActiveFlags;
        this._sortedIndices = newSortedIndices;
        this._compactMapping = newCompactMapping;

        this._freeList = this._freeList.filter((index) => index < newCapacity);
        if (newCapacity > oldCapacity) {
            for (let i = newCapacity - 1; i >= oldCapacity; i--) {
                this._freeList.push(i);
            }
        }
    }

    private _calculateFragmentation(): number {
        if (this._capacity === 0) return 0;

        let fragmentedSlots = 0;
        let inactiveSequence = false;

        for (let i = 0; i < this._capacity; i++) {
            if (!this._activeFlags.array[i]) {
                if (!inactiveSequence) {
                    fragmentedSlots++;
                    inactiveSequence = true;
                }
            } else {
                inactiveSequence = false;
            }
        }

        return fragmentedSlots / this._capacity;
    }

    private _scheduleDefragmentation(): void {
        const now = performance.now();
        if (now - this._lastDefragmentTime > 1000) {
            setTimeout(() => this._defragment(), 0);
            this._lastDefragmentTime = now;
        }
    }

    private _defragment(): void {
        let writeIndex = 0;

        for (let readIndex = 0; readIndex < this._capacity; readIndex++) {
            if (this._activeFlags.array[readIndex]) {
                if (writeIndex !== readIndex) {
                    this._copyParticle(readIndex, writeIndex);
                    this._activeFlags.array[writeIndex] = 1;
                    this._activeFlags.array[readIndex] = 0;
                }
                this._compactMapping.array[readIndex] = writeIndex;
                writeIndex++;
            }
        }

        this._freeList.length = 0;
        for (let i = this._capacity - 1; i >= writeIndex; i--) {
            this._freeList.push(i);
        }
    }

    private _copyParticle(fromIndex: number, toIndex: number): void {
        const fromPos = fromIndex * 3;
        const toPos = toIndex * 3;
        this._positions.array[toPos] = this._positions.array[fromPos];
        this._positions.array[toPos + 1] = this._positions.array[fromPos + 1];
        this._positions.array[toPos + 2] = this._positions.array[fromPos + 2];

        this._velocities.array[toPos] = this._velocities.array[fromPos];
        this._velocities.array[toPos + 1] = this._velocities.array[fromPos + 1];
        this._velocities.array[toPos + 2] = this._velocities.array[fromPos + 2];

        this._accelerations.array[toPos] = this._accelerations.array[fromPos];
        this._accelerations.array[toPos + 1] = this._accelerations.array[fromPos + 1];
        this._accelerations.array[toPos + 2] = this._accelerations.array[fromPos + 2];

        this._sizes.array[toPos] = this._sizes.array[fromPos];
        this._sizes.array[toPos + 1] = this._sizes.array[fromPos + 1];
        this._sizes.array[toPos + 2] = this._sizes.array[fromPos + 2];

        const fromColor = fromIndex * 4;
        const toColor = toIndex * 4;
        this._colors.array[toColor] = this._colors.array[fromColor];
        this._colors.array[toColor + 1] = this._colors.array[fromColor + 1];
        this._colors.array[toColor + 2] = this._colors.array[fromColor + 2];
        this._colors.array[toColor + 3] = this._colors.array[fromColor + 3];

        this._rotations.array[toPos] = this._rotations.array[fromPos];
        this._rotations.array[toPos + 1] = this._rotations.array[fromPos + 1];
        this._rotations.array[toPos + 2] = this._rotations.array[fromPos + 2];

        this._angularVelocities.array[toPos] = this._angularVelocities.array[fromPos];
        this._angularVelocities.array[toPos + 1] = this._angularVelocities.array[fromPos + 1];
        this._angularVelocities.array[toPos + 2] = this._angularVelocities.array[fromPos + 2];

        const fromCustom = fromIndex * 4;
        const toCustom = toIndex * 4;
        this._customData1.array[toCustom] = this._customData1.array[fromCustom];
        this._customData1.array[toCustom + 1] = this._customData1.array[fromCustom + 1];
        this._customData1.array[toCustom + 2] = this._customData1.array[fromCustom + 2];
        this._customData1.array[toCustom + 3] = this._customData1.array[fromCustom + 3];

        this._customData2.array[toCustom] = this._customData2.array[fromCustom];
        this._customData2.array[toCustom + 1] = this._customData2.array[fromCustom + 1];
        this._customData2.array[toCustom + 2] = this._customData2.array[fromCustom + 2];
        this._customData2.array[toCustom + 3] = this._customData2.array[fromCustom + 3];

        this._ids.array[toIndex] = this._ids.array[fromIndex];
        this._lifetimes.array[toIndex] = this._lifetimes.array[fromIndex];
        this._ages.array[toIndex] = this._ages.array[fromIndex];
        this._birthTimes.array[toIndex] = this._birthTimes.array[fromIndex];
        this._masses.array[toIndex] = this._masses.array[fromIndex];
        this._materialIndices.array[toIndex] = this._materialIndices.array[fromIndex];
        this._emitterIndices.array[toIndex] = this._emitterIndices.array[fromIndex];
    }

    getStats(): ParticleSOAStats {
        this._updateStats();
        return { ...this._stats };
    }

    private _updateStats(): void {
        this._stats.capacity = this._capacity;
        this._stats.count = this._count;
        this._stats.activeCount = this._activeCount;
        this._stats.freeSlots = this._freeList.length;
        this._stats.fragmentation = this._calculateFragmentation();

        if (this._config.enableMemoryTracking) {
            this._stats.memoryUsage = this._calculateMemoryUsage();
        }

        let totalAge = 0;
        let oldestAge = 0;
        let youngestAge = Infinity;
        let ageCount = 0;

        for (let i = 0; i < this._capacity; i++) {
            if (this._activeFlags.array[i]) {
                const age = this._ages.array[i];
                totalAge += age;
                oldestAge = Math.max(oldestAge, age);
                youngestAge = Math.min(youngestAge, age);
                ageCount++;
            }
        }

        this._stats.averageAge = ageCount > 0 ? totalAge / ageCount : 0;
        this._stats.oldestParticle = ageCount > 0 ? oldestAge : 0;
        this._stats.youngestParticle = ageCount > 0 && youngestAge !== Infinity ? youngestAge : 0;
    }

    private _calculateMemoryUsage(): number {
        let totalBytes = 0;

        totalBytes += this._positions.byteLength;
        totalBytes += this._velocities.byteLength;
        totalBytes += this._accelerations.byteLength;
        totalBytes += this._lifetimes.byteLength;
        totalBytes += this._ages.byteLength;
        totalBytes += this._sizes.byteLength;
        totalBytes += this._colors.byteLength;
        totalBytes += this._rotations.byteLength;
        totalBytes += this._angularVelocities.byteLength;
        totalBytes += this._customData1.byteLength;
        totalBytes += this._customData2.byteLength;

        totalBytes += this._ids.byteLength;
        totalBytes += this._birthTimes.byteLength;
        totalBytes += this._masses.byteLength;
        totalBytes += this._materialIndices.byteLength;
        totalBytes += this._emitterIndices.byteLength;
        totalBytes += this._activeFlags.byteLength;

        totalBytes += this._sortedIndices.byteLength;
        totalBytes += this._compactMapping.byteLength;

        totalBytes += this._freeList.length * 4;

        return totalBytes;
    }

    getConfig(): ParticleSOAConfig {
        return { ...this._config };
    }
}
