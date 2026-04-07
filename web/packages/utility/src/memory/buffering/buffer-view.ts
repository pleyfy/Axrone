import { ByteOrder, TypedArrayMap, PrimitiveTypeMap } from './types';
import { IReadableBuffer, IByteBuffer } from './interfaces';

export class BufferView<T extends keyof TypedArrayMap> implements IReadableBuffer {
    private readonly buffer: IByteBuffer;
    private readonly arrayType: T;
    private readonly bytesPerElement: number;
    private readonly getterMethod: () => PrimitiveTypeMap[T];
    private readonly setterMethod: (value: PrimitiveTypeMap[T]) => void;

    private static readonly BYTES_PER_ELEMENT: Record<keyof TypedArrayMap, number> = {
        int8: 1,
        uint8: 1,
        int16: 2,
        uint16: 2,
        int32: 4,
        uint32: 4,
        float32: 4,
        float64: 8,
        bigint64: 8,
        biguint64: 8,
    } as const;

    constructor(buffer: IByteBuffer, arrayType: T) {
        this.buffer = buffer;
        this.arrayType = arrayType;
        this.bytesPerElement = BufferView.BYTES_PER_ELEMENT[arrayType];

        if (!this.bytesPerElement) {
            throw new TypeError(`Unsupported array type: ${arrayType}`);
        }

        this.getterMethod = this.createGetterMethod();
        this.setterMethod = this.createSetterMethod();
    }

    get capacity(): number {
        return Math.floor(this.buffer.capacity / this.bytesPerElement);
    }

    get position(): number {
        return Math.floor(this.buffer.position / this.bytesPerElement);
    }

    get remaining(): number {
        return Math.floor(this.buffer.remaining / this.bytesPerElement);
    }

    get order(): ByteOrder {
        return this.buffer.order;
    }

    get limit(): number {
        return Math.floor(this.buffer.limit / this.bytesPerElement);
    }

    get hasRemaining(): boolean {
        return this.buffer.hasRemaining;
    }

    get isReadOnly(): boolean {
        return this.buffer.isReadOnly;
    }

    private createGetterMethod(): () => PrimitiveTypeMap[T] {
        const getters = {
            int8: () => this.buffer.getInt8() as PrimitiveTypeMap[T],
            uint8: () => this.buffer.getUint8() as PrimitiveTypeMap[T],
            int16: () => this.buffer.getInt16() as PrimitiveTypeMap[T],
            uint16: () => this.buffer.getUint16() as PrimitiveTypeMap[T],
            int32: () => this.buffer.getInt32() as PrimitiveTypeMap[T],
            uint32: () => this.buffer.getUint32() as PrimitiveTypeMap[T],
            float32: () => this.buffer.getFloat32() as PrimitiveTypeMap[T],
            float64: () => this.buffer.getFloat64() as PrimitiveTypeMap[T],
            bigint64: () => this.buffer.getBigInt64() as PrimitiveTypeMap[T],
            biguint64: () => this.buffer.getBigUint64() as PrimitiveTypeMap[T],
        };
        return (
            getters[this.arrayType] ||
            (() => {
                throw new TypeError(`Unsupported: ${this.arrayType}`);
            })
        );
    }

    private createSetterMethod(): (value: PrimitiveTypeMap[T]) => void {
        const setters = {
            int8: (v: any) => this.buffer.putInt8(v),
            uint8: (v: any) => this.buffer.putUint8(v),
            int16: (v: any) => this.buffer.putInt16(v),
            uint16: (v: any) => this.buffer.putUint16(v),
            int32: (v: any) => this.buffer.putInt32(v),
            uint32: (v: any) => this.buffer.putUint32(v),
            float32: (v: any) => this.buffer.putFloat32(v),
            float64: (v: any) => this.buffer.putFloat64(v),
            bigint64: (v: any) => this.buffer.putBigInt64(v),
            biguint64: (v: any) => this.buffer.putBigUint64(v),
        };
        return (
            setters[this.arrayType] ||
            (() => {
                throw new TypeError(`Unsupported: ${this.arrayType}`);
            })
        );
    }

    getValue(index: number): PrimitiveTypeMap[T] {
        if (index < 0 || index >= this.capacity) {
            throw new RangeError(`Index ${index} out of bounds [0, ${this.capacity})`);
        }
        this.buffer.seek(index * this.bytesPerElement);
        return this.getterMethod();
    }

    setValue(index: number, value: PrimitiveTypeMap[T]): void {
        if (this.isReadOnly) {
            throw new Error('Cannot modify read-only buffer');
        }
        if (index < 0 || index >= this.capacity) {
            throw new RangeError(`Index ${index} out of bounds [0, ${this.capacity})`);
        }
        this.buffer.seek(index * this.bytesPerElement);
        this.setterMethod(value);
    }

    getValues(startIndex: number, count: number): PrimitiveTypeMap[T][] {
        if (startIndex < 0 || startIndex + count > this.capacity) {
            throw new RangeError('Read operation out of bounds');
        }
        const result: PrimitiveTypeMap[T][] = new Array(count);
        this.buffer.seek(startIndex * this.bytesPerElement);
        for (let i = 0; i < count; i++) {
            result[i] = this.getterMethod();
        }
        return result;
    }

    setValues(startIndex: number, values: readonly PrimitiveTypeMap[T][]): void {
        if (this.isReadOnly) {
            throw new Error('Cannot modify read-only buffer');
        }
        if (startIndex < 0 || startIndex + values.length > this.capacity) {
            throw new RangeError('Write operation out of bounds');
        }
        this.buffer.seek(startIndex * this.bytesPerElement);
        for (const value of values) {
            this.setterMethod(value);
        }
    }

    getInt8(): number {
        return this.arrayType === 'int8'
            ? (this.getValue(this.position) as number)
            : this.throwUnsupportedOperation('getInt8');
    }

    getUint8(): number {
        return this.arrayType === 'uint8'
            ? (this.getValue(this.position) as number)
            : this.throwUnsupportedOperation('getUint8');
    }

    getInt16(): number {
        return this.arrayType === 'int16'
            ? (this.getValue(this.position) as number)
            : this.throwUnsupportedOperation('getInt16');
    }

    getUint16(): number {
        return this.arrayType === 'uint16'
            ? (this.getValue(this.position) as number)
            : this.throwUnsupportedOperation('getUint16');
    }

    getInt32(): number {
        return this.arrayType === 'int32'
            ? (this.getValue(this.position) as number)
            : this.throwUnsupportedOperation('getInt32');
    }

    getUint32(): number {
        return this.arrayType === 'uint32'
            ? (this.getValue(this.position) as number)
            : this.throwUnsupportedOperation('getUint32');
    }

    getFloat32(): number {
        return this.arrayType === 'float32'
            ? (this.getValue(this.position) as number)
            : this.throwUnsupportedOperation('getFloat32');
    }

    getFloat64(): number {
        return this.arrayType === 'float64'
            ? (this.getValue(this.position) as number)
            : this.throwUnsupportedOperation('getFloat64');
    }

    getBigInt64(): bigint {
        return this.arrayType === 'bigint64'
            ? (this.getValue(this.position) as bigint)
            : this.throwUnsupportedOperation('getBigInt64');
    }

    getBigUint64(): bigint {
        return this.arrayType === 'biguint64'
            ? (this.getValue(this.position) as bigint)
            : this.throwUnsupportedOperation('getBigUint64');
    }

    getString(): string {
        throw new Error('String operations not supported on typed buffer views');
    }

    private throwUnsupportedOperation(operation: string): never {
        throw new Error(`${operation}() not supported on ${this.arrayType} buffer view`);
    }

    slice(begin?: number, end?: number): BufferView<T> {
        const startIndex = begin ?? 0;
        const endIndex = end ?? this.limit;

        if (startIndex < 0 || endIndex > this.limit || startIndex > endIndex) {
            throw new RangeError('Invalid slice bounds');
        }

        const byteBegin = startIndex * this.bytesPerElement;
        const byteEnd = endIndex * this.bytesPerElement;
        const sliced = this.buffer.slice(byteBegin, byteEnd) as IByteBuffer;

        return new BufferView(sliced, this.arrayType);
    }

    toTypedArray(): TypedArrayMap[T] {
        const ArrayConstructor = this.getTypedArrayConstructor();
        const arrayBuffer = this.buffer.asReadOnlyBuffer();
        return new ArrayConstructor(arrayBuffer as any, 0, this.capacity);
    }

    private getTypedArrayConstructor(): new (
        buffer: ArrayBuffer,
        byteOffset?: number,
        length?: number
    ) => TypedArrayMap[T] {
        const constructors = {
            int8: Int8Array,
            uint8: Uint8Array,
            int16: Int16Array,
            uint16: Uint16Array,
            int32: Int32Array,
            uint32: Uint32Array,
            float32: Float32Array,
            float64: Float64Array,
            bigint64: BigInt64Array,
            biguint64: BigUint64Array,
        } as const;
        return constructors[this.arrayType] as any;
    }

    *[Symbol.iterator](): Iterator<PrimitiveTypeMap[T]> {
        for (let i = 0; i < this.capacity; i++) {
            yield this.getValue(i);
        }
    }

    get elementType(): T {
        return this.arrayType;
    }

    get elementSize(): number {
        return this.bytesPerElement;
    }

    static createInt8View(buffer: IByteBuffer): BufferView<'int8'> {
        return new BufferView(buffer, 'int8');
    }

    static createUint8View(buffer: IByteBuffer): BufferView<'uint8'> {
        return new BufferView(buffer, 'uint8');
    }

    static createInt16View(buffer: IByteBuffer): BufferView<'int16'> {
        return new BufferView(buffer, 'int16');
    }

    static createUint16View(buffer: IByteBuffer): BufferView<'uint16'> {
        return new BufferView(buffer, 'uint16');
    }

    static createInt32View(buffer: IByteBuffer): BufferView<'int32'> {
        return new BufferView(buffer, 'int32');
    }

    static createUint32View(buffer: IByteBuffer): BufferView<'uint32'> {
        return new BufferView(buffer, 'uint32');
    }

    static createFloat32View(buffer: IByteBuffer): BufferView<'float32'> {
        return new BufferView(buffer, 'float32');
    }

    static createFloat64View(buffer: IByteBuffer): BufferView<'float64'> {
        return new BufferView(buffer, 'float64');
    }

    static createBigInt64View(buffer: IByteBuffer): BufferView<'bigint64'> {
        return new BufferView(buffer, 'bigint64');
    }

    static createBigUint64View(buffer: IByteBuffer): BufferView<'biguint64'> {
        return new BufferView(buffer, 'biguint64');
    }

    static create<K extends keyof TypedArrayMap>(buffer: IByteBuffer, type: K): BufferView<K> {
        return new BufferView(buffer, type);
    }

    static fromTypedArray<K extends keyof TypedArrayMap>(
        typedArray: TypedArrayMap[K],
        buffer: IByteBuffer
    ): BufferView<K> {
        const type = BufferView.getArrayTypeFromConstructor(typedArray.constructor) as K;
        return new BufferView(buffer, type);
    }

    private static getArrayTypeFromConstructor(constructor: Function): keyof TypedArrayMap {
        const typeMap = {
            [Int8Array.name]: 'int8',
            [Uint8Array.name]: 'uint8',
            [Int16Array.name]: 'int16',
            [Uint16Array.name]: 'uint16',
            [Int32Array.name]: 'int32',
            [Uint32Array.name]: 'uint32',
            [Float32Array.name]: 'float32',
            [Float64Array.name]: 'float64',
            [BigInt64Array.name]: 'bigint64',
            [BigUint64Array.name]: 'biguint64',
        } as const;

        const typeName = constructor.name as keyof typeof typeMap;
        const arrayType = typeMap[typeName];

        if (!arrayType) {
            throw new TypeError(`Unsupported TypedArray constructor: ${constructor.name}`);
        }

        return arrayType;
    }
}
