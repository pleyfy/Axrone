import { ICloneable } from '@axrone/utility';
import { IDisposable } from '../types';

declare const __brand: unique symbol;
export type Brand<T, K> = T & { [__brand]: K };

export type Alignment = 16 | 32 | 64;
export type ComponentCount = 2 | 3 | 4;
export type VectorType = 'vec2' | 'vec3' | 'vec4';

export type AlignedArrayBuffer = Brand<ArrayBuffer, 'AlignedBuffer'>;
export type VectorIndex = Brand<number, 'VectorIndex'>;
export type ComponentIndex = Brand<number, 'ComponentIndex'>;

export interface TypedArrayConstructor {
    new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): TypedArray;
    new (length: number): TypedArray;
    readonly BYTES_PER_ELEMENT: number;
}

export interface TypedArray extends ArrayBufferView {
    readonly length: number;
    [index: number]: number;
    set(array: ArrayLike<number>, offset?: number): void;
    subarray(begin?: number, end?: number): TypedArray;
    fill(value: number, start?: number, end?: number): void;
}

export class AlignedArrayError extends Error {
    readonly code: string;
    readonly context?: Record<string, unknown>;

    constructor(message: string, code: string, context?: Record<string, unknown>) {
        super(message);
        this.name = 'AlignedArrayError';
        this.code = code;
        this.context = context;
    }
}

export class MemoryError extends AlignedArrayError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'MEMORY_ERROR', context);
        this.name = 'MemoryError';
    }
}

export class IndexError extends AlignedArrayError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'INDEX_ERROR', context);
        this.name = 'IndexError';
    }
}

export class ValidationError extends AlignedArrayError {
    constructor(message: string, context?: Record<string, unknown>) {
        super(message, 'VALIDATION_ERROR', context);
        this.name = 'ValidationError';
    }
}

export interface ISerializable<T> {
    serialize(): T;
    deserialize(data: T): void;
}

type VectorComponentKeys<T extends ComponentCount> = T extends 2
    ? 'x' | 'y'
    : T extends 3
      ? 'x' | 'y' | 'z'
      : T extends 4
        ? 'x' | 'y' | 'z' | 'w'
        : never;

export interface IAlignedVectorArray<
    TComponents extends ComponentCount,
    TArray extends TypedArray = Float32Array,
> extends IDisposable,
        ICloneable<IAlignedVectorArray<TComponents, TArray>>,
        ISerializable<ArrayBuffer> {
    readonly buffer: AlignedArrayBuffer;
    readonly byteOffset: number;
    readonly byteLength: number;
    readonly capacity: number;
    readonly componentCount: TComponents;
    readonly alignment: Alignment;
    readonly ArrayConstructor: TypedArrayConstructor;
    readonly components: Record<VectorComponentKeys<TComponents>, TArray>;
    readonly x: TArray;
    readonly y: TArray;
    readonly z: TComponents extends 3 | 4 ? TArray : undefined;
    readonly w: TComponents extends 4 ? TArray : undefined;

    set(index: VectorIndex, x: number, y: number, z?: number, w?: number): this;
    get(index: VectorIndex): number[];
    setVector(index: VectorIndex, vector: ArrayLike<number>): this;
    getVector(index: VectorIndex, out?: number[]): number[];
    copy(srcIndex: VectorIndex, destIndex: VectorIndex): this;
    fill(value: number, start?: VectorIndex, end?: VectorIndex): this;
    clear(): this;
    resize(newCapacity: number): this;
    slice(start?: VectorIndex, end?: VectorIndex): IAlignedVectorArray<TComponents, TArray>;
    forEach(
        callback: (
            x: number,
            y: number,
            z: number | undefined,
            w: number | undefined,
            index: VectorIndex
        ) => void
    ): void;
    map<U>(
        callback: (
            x: number,
            y: number,
            z: number | undefined,
            w: number | undefined,
            index: VectorIndex
        ) => U
    ): U[];
    validate(): boolean;
}

export interface IVec2Array<TArray extends TypedArray = Float32Array>
    extends IAlignedVectorArray<2, TArray> {
    set(index: VectorIndex, x: number, y: number): this;
    setXY(index: VectorIndex, x: number, y: number): this;
    getX(index: VectorIndex): number;
    getY(index: VectorIndex): number;
    setX(index: VectorIndex, value: number): this;
    setY(index: VectorIndex, value: number): this;
}

export interface IVec3Array<TArray extends TypedArray = Float32Array>
    extends IAlignedVectorArray<3, TArray> {
    set(index: VectorIndex, x: number, y: number, z: number): this;
    setXYZ(index: VectorIndex, x: number, y: number, z: number): this;
    getX(index: VectorIndex): number;
    getY(index: VectorIndex): number;
    getZ(index: VectorIndex): number;
    setX(index: VectorIndex, value: number): this;
    setY(index: VectorIndex, value: number): this;
    setZ(index: VectorIndex, value: number): this;
}

export interface IVec4Array<TArray extends TypedArray = Float32Array>
    extends IAlignedVectorArray<4, TArray> {
    set(index: VectorIndex, x: number, y: number, z: number, w: number): this;
    setXYZW(index: VectorIndex, x: number, y: number, z: number, w: number): this;
    getX(index: VectorIndex): number;
    getY(index: VectorIndex): number;
    getZ(index: VectorIndex): number;
    getW(index: VectorIndex): number;
    setX(index: VectorIndex, value: number): this;
    setY(index: VectorIndex, value: number): this;
    setZ(index: VectorIndex, value: number): this;
    setW(index: VectorIndex, value: number): this;
}

export interface IAlignedArrayFactory {
    createVec2<TArray extends TypedArray = Float32Array>(
        capacity: number,
        ArrayConstructor?: TypedArrayConstructor,
        alignment?: Alignment
    ): IVec2Array<TArray>;

    createVec3<TArray extends TypedArray = Float32Array>(
        capacity: number,
        ArrayConstructor?: TypedArrayConstructor,
        alignment?: Alignment
    ): IVec3Array<TArray>;

    createVec4<TArray extends TypedArray = Float32Array>(
        capacity: number,
        ArrayConstructor?: TypedArrayConstructor,
        alignment?: Alignment
    ): IVec4Array<TArray>;
}

export interface IVectorOperations<T extends IAlignedVectorArray<ComponentCount, TypedArray>> {
    add(a: T, b: T, result?: T): T;
    subtract(a: T, b: T, result?: T): T;
    multiply(a: T, b: T, result?: T): T;
    multiplyScalar(a: T, scalar: number, result?: T): T;
    divide(a: T, b: T, result?: T): T;
    divideScalar(a: T, scalar: number, result?: T): T;
    dot(a: T, b: T, result?: Float32Array): Float32Array;
    length(a: T, result?: Float32Array): Float32Array;
    lengthSquared(a: T, result?: Float32Array): Float32Array;
    normalize(a: T, result?: T): T;
    lerp(a: T, b: T, t: number, result?: T): T;
    min(a: T, b: T, result?: T): T;
    max(a: T, b: T, result?: T): T;
    clamp(a: T, min: T, max: T, result?: T): T;
}

const isVectorIndex = (value: number): value is VectorIndex =>
    Number.isInteger(value) && value >= 0;

const asVectorIndex = (value: number): VectorIndex => {
    if (!isVectorIndex(value)) {
        throw new IndexError('Invalid vector index', { value });
    }
    return value as VectorIndex;
};

const validateCapacity = (capacity: number): void => {
    if (!Number.isInteger(capacity) || capacity <= 0) {
        throw new ValidationError('Capacity must be a positive integer', { capacity });
    }
    if (capacity > 0x7fffffff / 16) {
        throw new MemoryError('Capacity too large', { capacity });
    }
};

const validateAlignment = (alignment: number): alignment is Alignment => {
    return alignment === 16 || alignment === 32 || alignment === 64;
};

const calculateAlignedSize = (size: number, alignment: Alignment): number => {
    return Math.ceil(size / alignment) * alignment;
};

const createAlignedBuffer = (size: number, alignment: Alignment): AlignedArrayBuffer => {
    const alignedSize = calculateAlignedSize(size, alignment);
    const buffer = new ArrayBuffer(alignedSize);
    return buffer as AlignedArrayBuffer;
};

abstract class BaseAlignedVectorArray<TComponents extends ComponentCount, TArray extends TypedArray>
    implements IAlignedVectorArray<TComponents, TArray>
{
    protected _buffer: AlignedArrayBuffer;
    protected _byteOffset: number;
    protected _byteLength: number;
    protected _capacity: number;
    protected _componentCount: TComponents;
    protected _alignment: Alignment;
    protected _ArrayConstructor: TypedArrayConstructor;
    protected _components: Record<VectorComponentKeys<TComponents>, TArray>;
    protected _isDisposed = false;

    constructor(
        capacity: number,
        componentCount: TComponents,
        ArrayConstructor: TypedArrayConstructor,
        alignment: Alignment = 16
    ) {
        validateCapacity(capacity);

        if (!validateAlignment(alignment)) {
            throw new ValidationError('Invalid alignment', { alignment });
        }

        this._capacity = capacity;
        this._componentCount = componentCount;
        this._ArrayConstructor = ArrayConstructor;
        this._alignment = alignment;

        const bytesPerElement = ArrayConstructor.BYTES_PER_ELEMENT;
        const totalSize = capacity * componentCount * bytesPerElement;
        const paddedSize = calculateAlignedSize(totalSize, alignment);

        this._buffer = createAlignedBuffer(paddedSize, alignment);
        this._byteOffset = 0;
        this._byteLength = this._buffer.byteLength;

        this._components = this._createComponentViews();
    }

    protected _createComponentViews(): Record<VectorComponentKeys<TComponents>, TArray> {
        const bytesPerElement = this._ArrayConstructor.BYTES_PER_ELEMENT;
        const componentSize = this._capacity * bytesPerElement;
        const alignedComponentSize = calculateAlignedSize(componentSize, this._alignment);

        const components = {} as Record<VectorComponentKeys<TComponents>, TArray>;
        const keys: VectorComponentKeys<TComponents>[] =
            this._componentCount === 2
                ? (['x', 'y'] as any)
                : this._componentCount === 3
                  ? (['x', 'y', 'z'] as any)
                  : (['x', 'y', 'z', 'w'] as any);

        keys.forEach((key, index) => {
            const offset = index * alignedComponentSize;
            components[key] = new this._ArrayConstructor(
                this._buffer,
                offset,
                this._capacity
            ) as TArray;
        });

        return components;
    }

    protected _validateIndex(index: VectorIndex): void {
        if (this._isDisposed) {
            throw new AlignedArrayError('Array has been disposed', 'DISPOSED');
        }
        if (index < 0 || index >= this._capacity) {
            throw new IndexError('Index out of bounds', { index, capacity: this._capacity });
        }
    }

    protected _ensureNotDisposed(): void {
        if (this._isDisposed) {
            throw new AlignedArrayError('Array has been disposed', 'DISPOSED');
        }
    }

    get buffer(): AlignedArrayBuffer {
        return this._buffer;
    }
    get byteOffset(): number {
        return this._byteOffset;
    }
    get byteLength(): number {
        return this._byteLength;
    }
    get capacity(): number {
        return this._capacity;
    }
    get componentCount(): TComponents {
        return this._componentCount;
    }
    get alignment(): Alignment {
        return this._alignment;
    }
    get ArrayConstructor(): TypedArrayConstructor {
        return this._ArrayConstructor;
    }
    get components(): Record<VectorComponentKeys<TComponents>, TArray> {
        return this._components;
    }
    get isDisposed(): boolean {
        return this._isDisposed;
    }

    get x(): TArray {
        return (this._components as any).x;
    }
    get y(): TArray {
        return (this._components as any).y;
    }
    get z(): TComponents extends 3 | 4 ? TArray : undefined {
        return (this._components as any).z;
    }
    get w(): TComponents extends 4 ? TArray : undefined {
        return (this._components as any).w;
    }

    abstract set(index: VectorIndex, x: number, y: number, z?: number, w?: number): this;

    get(index: VectorIndex): number[] {
        this._validateIndex(index);
        const result: number[] = [this.x[index], this.y[index]];
        if (this._componentCount >= 3) result.push(this.z![index]);
        if (this._componentCount >= 4) result.push(this.w![index]);
        return result;
    }

    setVector(index: VectorIndex, vector: ArrayLike<number>): this {
        this._validateIndex(index);

        if (vector.length < this._componentCount) {
            throw new ValidationError('Vector length insufficient', {
                expected: this._componentCount,
                actual: vector.length,
            });
        }

        this.x[index] = vector[0];
        this.y[index] = vector[1];
        if (this._componentCount >= 3) this.z![index] = vector[2];
        if (this._componentCount >= 4) this.w![index] = vector[3];

        return this;
    }

    getVector(index: VectorIndex, out?: number[]): number[] {
        this._validateIndex(index);

        const result = out || new Array(this._componentCount);
        result[0] = this.x[index];
        result[1] = this.y[index];
        if (this._componentCount >= 3) result[2] = this.z![index];
        if (this._componentCount >= 4) result[3] = this.w![index];

        return result;
    }

    copy(srcIndex: VectorIndex, destIndex: VectorIndex): this {
        this._validateIndex(srcIndex);
        this._validateIndex(destIndex);

        this.x[destIndex] = this.x[srcIndex];
        this.y[destIndex] = this.y[srcIndex];
        if (this._componentCount >= 3) this.z![destIndex] = this.z![srcIndex];
        if (this._componentCount >= 4) this.w![destIndex] = this.w![srcIndex];

        return this;
    }

    fill(value: number, start?: VectorIndex, end?: VectorIndex): this {
        this._ensureNotDisposed();

        const s = start ?? (0 as VectorIndex);
        const e = end ?? (this._capacity as VectorIndex);

        this.x.fill(value, s, e);
        this.y.fill(value, s, e);
        if (this._componentCount >= 3) this.z!.fill(value, s, e);
        if (this._componentCount >= 4) this.w!.fill(value, s, e);

        return this;
    }

    clear(): this {
        return this.fill(0);
    }

    resize(newCapacity: number): this {
        validateCapacity(newCapacity);

        if (newCapacity === this._capacity) return this;

        const oldComponents = this._components;
        const oldCapacity = this._capacity;

        this._capacity = newCapacity;

        const bytesPerElement = this._ArrayConstructor.BYTES_PER_ELEMENT;
        const totalSize = newCapacity * this._componentCount * bytesPerElement;
        const paddedSize = calculateAlignedSize(totalSize, this._alignment);

        this._buffer = createAlignedBuffer(paddedSize, this._alignment);
        this._byteLength = this._buffer.byteLength;
        this._components = this._createComponentViews();

        const copyCount = Math.min(oldCapacity, newCapacity);
        const keys = Object.keys(oldComponents) as VectorComponentKeys<TComponents>[];

        keys.forEach((key) => {
            this._components[key].set(
                oldComponents[key].subarray(0, copyCount) as ArrayLike<number>
            );
        });

        return this;
    }

    slice(start?: VectorIndex, end?: VectorIndex): IAlignedVectorArray<TComponents, TArray> {
        this._ensureNotDisposed();

        const s = start ?? (0 as VectorIndex);
        const e = end ?? (this._capacity as VectorIndex);
        const length = e - s;

        if (length <= 0) {
            throw new ValidationError('Invalid slice range', { start: s, end: e });
        }

        const sliced = new (this.constructor as any)(
            length,
            this._componentCount,
            this._ArrayConstructor,
            this._alignment
        ) as IAlignedVectorArray<TComponents, TArray>;

        const keys = Object.keys(this._components) as VectorComponentKeys<TComponents>[];
        keys.forEach((key) => {
            (sliced.components[key] as TypedArray).set(
                this._components[key].subarray(s, e) as ArrayLike<number>
            );
        });

        return sliced;
    }

    forEach(
        callback: (
            x: number,
            y: number,
            z: number | undefined,
            w: number | undefined,
            index: VectorIndex
        ) => void
    ): void {
        this._ensureNotDisposed();

        for (let i = 0; i < this._capacity; i++) {
            const idx = i as VectorIndex;
            callback(
                this.x[i],
                this.y[i],
                this._componentCount >= 3 ? this.z![i] : undefined,
                this._componentCount >= 4 ? this.w![i] : undefined,
                idx
            );
        }
    }

    map<U>(
        callback: (
            x: number,
            y: number,
            z: number | undefined,
            w: number | undefined,
            index: VectorIndex
        ) => U
    ): U[] {
        this._ensureNotDisposed();

        const results: U[] = new Array(this._capacity);
        for (let i = 0; i < this._capacity; i++) {
            const idx = i as VectorIndex;
            results[i] = callback(
                this.x[i],
                this.y[i],
                this._componentCount >= 3 ? this.z![i] : undefined,
                this._componentCount >= 4 ? this.w![i] : undefined,
                idx
            );
        }
        return results;
    }

    validate(): boolean {
        try {
            this._ensureNotDisposed();

            if (!this._buffer || this._buffer.byteLength === 0) return false;
            if (this._capacity <= 0) return false;

            const keys = Object.keys(this._components) as VectorComponentKeys<TComponents>[];
            for (const key of keys) {
                const component = this._components[key];
                if (!component || component.length !== this._capacity) return false;
                if (component.buffer !== this._buffer) return false;
            }

            return true;
        } catch {
            return false;
        }
    }

    serialize(): ArrayBuffer {
        this._ensureNotDisposed();
        return this._buffer.slice(0);
    }

    deserialize(data: ArrayBuffer): void {
        this._ensureNotDisposed();

        if (data.byteLength !== this._byteLength) {
            throw new ValidationError('Buffer size mismatch', {
                expected: this._byteLength,
                actual: data.byteLength,
            });
        }

        new Uint8Array(this._buffer).set(new Uint8Array(data));
    }

    abstract clone(): IAlignedVectorArray<TComponents, TArray>;

    dispose(): void {
        if (this._isDisposed) return;

        this._isDisposed = true;
        this._components = {} as any;
        this._buffer = null as any;
    }
}

export class Vec2Array<TArray extends TypedArray = Float32Array>
    extends BaseAlignedVectorArray<2, TArray>
    implements IVec2Array<TArray>
{
    constructor(
        capacity: number,
        ArrayConstructor: TypedArrayConstructor = Float32Array as any,
        alignment: Alignment = 16
    ) {
        super(capacity, 2, ArrayConstructor, alignment);
    }

    set(index: VectorIndex, x: number, y: number): this {
        this._validateIndex(index);
        this.x[index] = x;
        this.y[index] = y;
        return this;
    }

    setXY(index: VectorIndex, x: number, y: number): this {
        return this.set(index, x, y);
    }

    getX(index: VectorIndex): number {
        this._validateIndex(index);
        return this.x[index];
    }

    getY(index: VectorIndex): number {
        this._validateIndex(index);
        return this.y[index];
    }

    setX(index: VectorIndex, value: number): this {
        this._validateIndex(index);
        this.x[index] = value;
        return this;
    }

    setY(index: VectorIndex, value: number): this {
        this._validateIndex(index);
        this.y[index] = value;
        return this;
    }

    clone(): IVec2Array<TArray> {
        const cloned = new Vec2Array<TArray>(
            this._capacity,
            this._ArrayConstructor,
            this._alignment
        );
        cloned.x.set(this.x as ArrayLike<number>);
        cloned.y.set(this.y as ArrayLike<number>);
        return cloned;
    }
}

export class Vec3Array<TArray extends TypedArray = Float32Array>
    extends BaseAlignedVectorArray<3, TArray>
    implements IVec3Array<TArray>
{
    constructor(
        capacity: number,
        ArrayConstructor: TypedArrayConstructor = Float32Array as any,
        alignment: Alignment = 16
    ) {
        super(capacity, 3, ArrayConstructor, alignment);
    }

    set(index: VectorIndex, x: number, y: number, z: number): this {
        this._validateIndex(index);
        this.x[index] = x;
        this.y[index] = y;
        this.z![index] = z;
        return this;
    }

    setXYZ(index: VectorIndex, x: number, y: number, z: number): this {
        return this.set(index, x, y, z);
    }

    getX(index: VectorIndex): number {
        this._validateIndex(index);
        return this.x[index];
    }

    getY(index: VectorIndex): number {
        this._validateIndex(index);
        return this.y[index];
    }

    getZ(index: VectorIndex): number {
        this._validateIndex(index);
        return this.z![index];
    }

    setX(index: VectorIndex, value: number): this {
        this._validateIndex(index);
        this.x[index] = value;
        return this;
    }

    setY(index: VectorIndex, value: number): this {
        this._validateIndex(index);
        this.y[index] = value;
        return this;
    }

    setZ(index: VectorIndex, value: number): this {
        this._validateIndex(index);
        this.z![index] = value;
        return this;
    }

    clone(): IVec3Array<TArray> {
        const cloned = new Vec3Array<TArray>(
            this._capacity,
            this._ArrayConstructor,
            this._alignment
        );
        cloned.x.set(this.x as ArrayLike<number>);
        cloned.y.set(this.y as ArrayLike<number>);
        cloned.z!.set(this.z! as ArrayLike<number>);
        return cloned;
    }
}

export class Vec4Array<TArray extends TypedArray = Float32Array>
    extends BaseAlignedVectorArray<4, TArray>
    implements IVec4Array<TArray>
{
    constructor(
        capacity: number,
        ArrayConstructor: TypedArrayConstructor = Float32Array as any,
        alignment: Alignment = 16
    ) {
        super(capacity, 4, ArrayConstructor, alignment);
    }

    set(index: VectorIndex, x: number, y: number, z: number, w: number): this {
        this._validateIndex(index);
        this.x[index] = x;
        this.y[index] = y;
        this.z![index] = z;
        this.w![index] = w;
        return this;
    }

    setXYZW(index: VectorIndex, x: number, y: number, z: number, w: number): this {
        return this.set(index, x, y, z, w);
    }

    getX(index: VectorIndex): number {
        this._validateIndex(index);
        return this.x[index];
    }

    getY(index: VectorIndex): number {
        this._validateIndex(index);
        return this.y[index];
    }

    getZ(index: VectorIndex): number {
        this._validateIndex(index);
        return this.z![index];
    }

    getW(index: VectorIndex): number {
        this._validateIndex(index);
        return this.w![index];
    }

    setX(index: VectorIndex, value: number): this {
        this._validateIndex(index);
        this.x[index] = value;
        return this;
    }

    setY(index: VectorIndex, value: number): this {
        this._validateIndex(index);
        this.y[index] = value;
        return this;
    }

    setZ(index: VectorIndex, value: number): this {
        this._validateIndex(index);
        this.z![index] = value;
        return this;
    }

    setW(index: VectorIndex, value: number): this {
        this._validateIndex(index);
        this.w![index] = value;
        return this;
    }

    clone(): IVec4Array<TArray> {
        const cloned = new Vec4Array<TArray>(
            this._capacity,
            this._ArrayConstructor,
            this._alignment
        );
        cloned.x.set(this.x as ArrayLike<number>);
        cloned.y.set(this.y as ArrayLike<number>);
        cloned.z!.set(this.z! as ArrayLike<number>);
        cloned.w!.set(this.w! as ArrayLike<number>);
        return cloned;
    }
}

export class AlignedArrayFactory implements IAlignedArrayFactory {
    static readonly instance = new AlignedArrayFactory();

    private constructor() {}

    createVec2<TArray extends TypedArray = Float32Array>(
        capacity: number,
        ArrayConstructor: TypedArrayConstructor = Float32Array as any,
        alignment: Alignment = 16
    ): IVec2Array<TArray> {
        return new Vec2Array<TArray>(capacity, ArrayConstructor, alignment);
    }

    createVec3<TArray extends TypedArray = Float32Array>(
        capacity: number,
        ArrayConstructor: TypedArrayConstructor = Float32Array as any,
        alignment: Alignment = 16
    ): IVec3Array<TArray> {
        return new Vec3Array<TArray>(capacity, ArrayConstructor, alignment);
    }

    createVec4<TArray extends TypedArray = Float32Array>(
        capacity: number,
        ArrayConstructor: TypedArrayConstructor = Float32Array as any,
        alignment: Alignment = 16
    ): IVec4Array<TArray> {
        return new Vec4Array<TArray>(capacity, ArrayConstructor, alignment);
    }
}

export class VectorOperations<T extends IAlignedVectorArray<ComponentCount, TypedArray>>
    implements IVectorOperations<T>
{
    private _validateSameStructure(a: T, b: T): void {
        if (a.capacity !== b.capacity || a.componentCount !== b.componentCount) {
            throw new ValidationError('Arrays must have same structure', {
                aCapacity: a.capacity,
                bCapacity: b.capacity,
                aComponents: a.componentCount,
                bComponents: b.componentCount,
            });
        }
    }

    private _ensureResult(a: T, result?: T): T {
        if (result) {
            this._validateSameStructure(a, result);
            return result;
        }
        return a.clone() as T;
    }

    add(a: T, b: T, result?: T): T {
        this._validateSameStructure(a, b);
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = a.x[i] + b.x[i];
            output.y[i] = a.y[i] + b.y[i];
            if (a.componentCount >= 3) {
                output.z![i] = a.z![i] + b.z![i];
            }
            if (a.componentCount >= 4) {
                output.w![i] = a.w![i] + b.w![i];
            }
        }

        return output;
    }

    subtract(a: T, b: T, result?: T): T {
        this._validateSameStructure(a, b);
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = a.x[i] - b.x[i];
            output.y[i] = a.y[i] - b.y[i];
            if (a.componentCount >= 3) {
                output.z![i] = a.z![i] - b.z![i];
            }
            if (a.componentCount >= 4) {
                output.w![i] = a.w![i] - b.w![i];
            }
        }

        return output;
    }

    multiply(a: T, b: T, result?: T): T {
        this._validateSameStructure(a, b);
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = a.x[i] * b.x[i];
            output.y[i] = a.y[i] * b.y[i];
            if (a.componentCount >= 3) {
                output.z![i] = a.z![i] * b.z![i];
            }
            if (a.componentCount >= 4) {
                output.w![i] = a.w![i] * b.w![i];
            }
        }

        return output;
    }

    multiplyScalar(a: T, scalar: number, result?: T): T {
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = a.x[i] * scalar;
            output.y[i] = a.y[i] * scalar;
            if (a.componentCount >= 3) {
                output.z![i] = a.z![i] * scalar;
            }
            if (a.componentCount >= 4) {
                output.w![i] = a.w![i] * scalar;
            }
        }

        return output;
    }

    divide(a: T, b: T, result?: T): T {
        this._validateSameStructure(a, b);
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = a.x[i] / b.x[i];
            output.y[i] = a.y[i] / b.y[i];
            if (a.componentCount >= 3) {
                output.z![i] = a.z![i] / b.z![i];
            }
            if (a.componentCount >= 4) {
                output.w![i] = a.w![i] / b.w![i];
            }
        }

        return output;
    }

    divideScalar(a: T, scalar: number, result?: T): T {
        const output = this._ensureResult(a, result);
        const invScalar = 1.0 / scalar;

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = a.x[i] * invScalar;
            output.y[i] = a.y[i] * invScalar;
            if (a.componentCount >= 3) {
                output.z![i] = a.z![i] * invScalar;
            }
            if (a.componentCount >= 4) {
                output.w![i] = a.w![i] * invScalar;
            }
        }

        return output;
    }

    dot(a: T, b: T, result?: Float32Array): Float32Array {
        this._validateSameStructure(a, b);
        const output = result || new Float32Array(a.capacity);

        for (let i = 0; i < a.capacity; i++) {
            let dot = a.x[i] * b.x[i] + a.y[i] * b.y[i];
            if (a.componentCount >= 3) {
                dot += a.z![i] * b.z![i];
            }
            if (a.componentCount >= 4) {
                dot += a.w![i] * b.w![i];
            }
            output[i] = dot;
        }

        return output;
    }

    length(a: T, result?: Float32Array): Float32Array {
        const output = result || new Float32Array(a.capacity);

        for (let i = 0; i < a.capacity; i++) {
            let lengthSq = a.x[i] * a.x[i] + a.y[i] * a.y[i];
            if (a.componentCount >= 3) {
                lengthSq += a.z![i] * a.z![i];
            }
            if (a.componentCount >= 4) {
                lengthSq += a.w![i] * a.w![i];
            }
            output[i] = Math.sqrt(lengthSq);
        }

        return output;
    }

    lengthSquared(a: T, result?: Float32Array): Float32Array {
        const output = result || new Float32Array(a.capacity);

        for (let i = 0; i < a.capacity; i++) {
            let lengthSq = a.x[i] * a.x[i] + a.y[i] * a.y[i];
            if (a.componentCount >= 3) {
                lengthSq += a.z![i] * a.z![i];
            }
            if (a.componentCount >= 4) {
                lengthSq += a.w![i] * a.w![i];
            }
            output[i] = lengthSq;
        }

        return output;
    }

    normalize(a: T, result?: T): T {
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            let lengthSq = a.x[i] * a.x[i] + a.y[i] * a.y[i];
            if (a.componentCount >= 3) {
                lengthSq += a.z![i] * a.z![i];
            }
            if (a.componentCount >= 4) {
                lengthSq += a.w![i] * a.w![i];
            }

            if (lengthSq > 0) {
                const invLength = 1.0 / Math.sqrt(lengthSq);
                output.x[i] = a.x[i] * invLength;
                output.y[i] = a.y[i] * invLength;
                if (a.componentCount >= 3) {
                    output.z![i] = a.z![i] * invLength;
                }
                if (a.componentCount >= 4) {
                    output.w![i] = a.w![i] * invLength;
                }
            } else {
                output.x[i] = 0;
                output.y[i] = 0;
                if (a.componentCount >= 3) {
                    output.z![i] = 0;
                }
                if (a.componentCount >= 4) {
                    output.w![i] = 0;
                }
            }
        }

        return output;
    }

    lerp(a: T, b: T, t: number, result?: T): T {
        this._validateSameStructure(a, b);
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = a.x[i] + (b.x[i] - a.x[i]) * t;
            output.y[i] = a.y[i] + (b.y[i] - a.y[i]) * t;
            if (a.componentCount >= 3) {
                output.z![i] = a.z![i] + (b.z![i] - a.z![i]) * t;
            }
            if (a.componentCount >= 4) {
                output.w![i] = a.w![i] + (b.w![i] - a.w![i]) * t;
            }
        }

        return output;
    }

    min(a: T, b: T, result?: T): T {
        this._validateSameStructure(a, b);
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = Math.min(a.x[i], b.x[i]);
            output.y[i] = Math.min(a.y[i], b.y[i]);
            if (a.componentCount >= 3) {
                output.z![i] = Math.min(a.z![i], b.z![i]);
            }
            if (a.componentCount >= 4) {
                output.w![i] = Math.min(a.w![i], b.w![i]);
            }
        }

        return output;
    }

    max(a: T, b: T, result?: T): T {
        this._validateSameStructure(a, b);
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = Math.max(a.x[i], b.x[i]);
            output.y[i] = Math.max(a.y[i], b.y[i]);
            if (a.componentCount >= 3) {
                output.z![i] = Math.max(a.z![i], b.z![i]);
            }
            if (a.componentCount >= 4) {
                output.w![i] = Math.max(a.w![i], b.w![i]);
            }
        }

        return output;
    }

    clamp(a: T, min: T, max: T, result?: T): T {
        this._validateSameStructure(a, min);
        this._validateSameStructure(a, max);
        const output = this._ensureResult(a, result);

        for (let i = 0; i < a.capacity; i++) {
            output.x[i] = Math.max(min.x[i], Math.min(max.x[i], a.x[i]));
            output.y[i] = Math.max(min.y[i], Math.min(max.y[i], a.y[i]));
            if (a.componentCount >= 3) {
                output.z![i] = Math.max(min.z![i], Math.min(max.z![i], a.z![i]));
            }
            if (a.componentCount >= 4) {
                output.w![i] = Math.max(min.w![i], Math.min(max.w![i], a.w![i]));
            }
        }

        return output;
    }
}

interface IMemoryPool {
    acquire<T extends IAlignedVectorArray<ComponentCount, TypedArray>>(
        type: new (...args: any[]) => T,
        capacity: number,
        ArrayConstructor?: TypedArrayConstructor,
        alignment?: Alignment
    ): T;

    release<T extends IAlignedVectorArray<ComponentCount, TypedArray>>(array: T): void;
    clear(): void;
    readonly size: number;
}

export class MemoryPool implements IMemoryPool {
    private readonly _pools = new Map<string, IAlignedVectorArray<ComponentCount, TypedArray>[]>();
    private readonly _maxPoolSize: number;

    constructor(maxPoolSize = 100) {
        this._maxPoolSize = maxPoolSize;
    }

    private _getPoolKey(
        type: string,
        capacity: number,
        ArrayConstructor: TypedArrayConstructor,
        alignment: Alignment
    ): string {
        return `${type}-${capacity}-${ArrayConstructor.name}-${alignment}`;
    }

    acquire<T extends IAlignedVectorArray<ComponentCount, TypedArray>>(
        type: new (...args: any[]) => T,
        capacity: number,
        ArrayConstructor: TypedArrayConstructor = Float32Array as any,
        alignment: Alignment = 16
    ): T {
        const key = this._getPoolKey(type.name, capacity, ArrayConstructor, alignment);
        const pool = this._pools.get(key) || [];

        if (pool.length > 0) {
            const array = pool.pop()! as T;
            array.clear();
            return array;
        }

        return new type(capacity, ArrayConstructor, alignment);
    }

    release<T extends IAlignedVectorArray<ComponentCount, TypedArray>>(array: T): void {
        if (array.isDisposed || !array.validate()) return;

        const key = this._getPoolKey(
            array.constructor.name,
            array.capacity,
            array.ArrayConstructor,
            array.alignment
        );

        const pool = this._pools.get(key) || [];

        if (pool.length < this._maxPoolSize) {
            pool.push(array);
            this._pools.set(key, pool);
        } else {
            array.dispose();
        }
    }

    clear(): void {
        for (const pool of this._pools.values()) {
            pool.forEach((array) => array.dispose());
            pool.length = 0;
        }
        this._pools.clear();
    }

    get size(): number {
        return Array.from(this._pools.values()).reduce((sum, pool) => sum + pool.length, 0);
    }
}

export const createVec2 = <TArray extends TypedArray = Float32Array>(
    capacity: number,
    ArrayConstructor?: TypedArrayConstructor,
    alignment?: Alignment
) => AlignedArrayFactory.instance.createVec2<TArray>(capacity, ArrayConstructor, alignment);

export const createVec3 = <TArray extends TypedArray = Float32Array>(
    capacity: number,
    ArrayConstructor?: TypedArrayConstructor,
    alignment?: Alignment
) => AlignedArrayFactory.instance.createVec3<TArray>(capacity, ArrayConstructor, alignment);

export const createVec4 = <TArray extends TypedArray = Float32Array>(
    capacity: number,
    ArrayConstructor?: TypedArrayConstructor,
    alignment?: Alignment
) => AlignedArrayFactory.instance.createVec4<TArray>(capacity, ArrayConstructor, alignment);

export const vectorOps = new VectorOperations();
export const memoryPool = new MemoryPool();

export {
    asVectorIndex,
    isVectorIndex,
    validateCapacity,
    validateAlignment,
    calculateAlignedSize,
    createAlignedBuffer,
};

export default AlignedArrayFactory;
