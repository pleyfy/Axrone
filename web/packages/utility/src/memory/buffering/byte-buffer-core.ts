import {
    ByteOrder,
    SeekOrigin,
    BufferState,
    TypedArrayMap,
    TypedArrayConstructorMap,
} from './types';
import { IByteBuffer, IReadableBuffer, IWritableBuffer } from './interfaces';
import { BUFFER_DEFAULTS, STRING_DEFAULTS, PERFORMANCE_DEFAULTS } from './constants';
import {
    BufferOverflowError,
    BufferUnderflowError,
    ReadOnlyBufferError,
    InvalidMarkError,
    BufferAlignmentError,
    BufferReleasedError,
} from './errors';
import { BufferPool } from './buffer-pool';
import { BufferView } from './buffer-view';
import { BufferUtils } from './utils';

export class ByteBuffer implements IByteBuffer {
    private static readonly DEFAULT_ORDER = ByteOrder.Big;
    private static readonly CACHE_SIZE = PERFORMANCE_DEFAULTS.CACHE_SIZE;
    private static readonly cache: WeakMap<ArrayBuffer, ByteBuffer> = new WeakMap();
    private static readonly pool = BufferPool.getInstance();
    private static readonly viewCache = new Map<string, WeakMap<ByteBuffer, BufferView<any>>>();

    private readonly buffer: ArrayBuffer;
    private readonly view: DataView;
    private readonly u8Array: Uint8Array;
    private pos: number;
    private readonly typedArrayCache: Map<keyof TypedArrayMap, TypedArrayMap[keyof TypedArrayMap]>;
    private byteOrder: ByteOrder;
    private markPos: number;
    private limitPos: number;
    private readOnly: boolean;
    private state: BufferState;

    static alloc(
        capacity: number = BUFFER_DEFAULTS.INITIAL_CAPACITY,
        order = ByteOrder.Big,
        usePool = true
    ): ByteBuffer {
        if (capacity <= 0) throw new RangeError('Capacity must be positive');
        if (capacity > BUFFER_DEFAULTS.MAX_CAPACITY)
            throw new RangeError('Capacity exceeds maximum allowed');

        const powerOf2 = Math.ceil(Math.log2(capacity));
        const actualCapacity = Math.min(1 << powerOf2, BUFFER_DEFAULTS.MAX_CAPACITY);

        let buffer: ArrayBuffer;
        if (usePool) {
            buffer = ByteBuffer.pool.allocate(actualCapacity);
        } else {
            buffer = new ArrayBuffer(actualCapacity);
        }

        return new ByteBuffer(buffer, order, usePool);
    }

    static wrap(array: ArrayBuffer | ArrayBufferView, order = ByteOrder.Big): ByteBuffer {
        const buffer = array instanceof ArrayBuffer ? array : (array.buffer as ArrayBuffer);
        let cached = ByteBuffer.cache.get(buffer);

        if (!cached) {
            cached = new ByteBuffer(buffer, order, false);
            ByteBuffer.cache.set(buffer, cached);
        }

        return cached;
    }

    static directBuffer(
        capacity: number = BUFFER_DEFAULTS.INITIAL_CAPACITY,
        order = ByteOrder.Big
    ): ByteBuffer {
        return ByteBuffer.alloc(capacity, order, false);
    }

    asTypedView<T extends keyof TypedArrayMap>(type: T): BufferView<T> {
        const cacheKey = `${type}-${this.buffer.byteLength}`;

        if (!ByteBuffer.viewCache.has(cacheKey)) {
            ByteBuffer.viewCache.set(cacheKey, new WeakMap());
        }

        const viewMap = ByteBuffer.viewCache.get(cacheKey)!;

        if (!viewMap.has(this)) {
            viewMap.set(this, new BufferView<T>(this, type));
        }

        return viewMap.get(this)!;
    }

    private constructor(
        buffer: ArrayBuffer,
        order: ByteOrder,
        private pooled: boolean = false
    ) {
        this.buffer = buffer;
        this.view = new DataView(buffer);
        this.u8Array = new Uint8Array(buffer);
        this.pos = 0;
        this.markPos = -1;
        this.limitPos = buffer.byteLength;
        this.byteOrder = order;
        this.readOnly = false;
        this.typedArrayCache = new Map();
        this.state = BufferState.Empty;
    }

    get capacity(): number {
        this.checkState();
        return this.buffer.byteLength;
    }

    get position(): number {
        this.checkState();
        return this.pos;
    }

    get remaining(): number {
        this.checkState();
        return this.limitPos - this.pos;
    }

    get hasRemaining(): boolean {
        this.checkState();
        return this.pos < this.limitPos;
    }

    get order(): ByteOrder {
        this.checkState();
        return this.byteOrder;
    }

    get limit(): number {
        this.checkState();
        return this.limitPos;
    }

    get isReadOnly(): boolean {
        this.checkState();
        return this.readOnly;
    }

    get isPooled(): boolean {
        return this.pooled;
    }

    private checkState(): void {
        if (this.state === BufferState.Released) {
            throw new BufferReleasedError();
        }
    }

    private checkReadOnly(): void {
        if (this.readOnly) {
            throw new ReadOnlyBufferError();
        }
    }

    private ensureCapacity(required: number): void {
        this.checkState();
        this.checkReadOnly();

        if (required <= this.capacity) return;

        const newCapacity = Math.min(
            Math.max(
                this.capacity +
                    Math.max(
                        BUFFER_DEFAULTS.MIN_EXPANSION,
                        Math.floor(this.capacity * BUFFER_DEFAULTS.EXPANSION_FACTOR)
                    ),
                required
            ),
            BUFFER_DEFAULTS.MAX_CAPACITY
        );

        if (newCapacity > BUFFER_DEFAULTS.MAX_CAPACITY) {
            throw new BufferOverflowError('Required capacity exceeds maximum allowed');
        }

        const newBuffer = this.pooled
            ? ByteBuffer.pool.allocate(newCapacity)
            : new ArrayBuffer(newCapacity);

        new Uint8Array(newBuffer).set(this.u8Array);

        if (this.pooled) {
            ByteBuffer.pool.release(this.buffer);
        }

        Object.assign(this, {
            buffer: newBuffer,
            view: new DataView(newBuffer),
            u8Array: new Uint8Array(newBuffer),
        });

        this.typedArrayCache.clear();
    }

    private checkReadableBytes(count: number): void {
        this.checkState();
        if (this.pos + count > this.limitPos) {
            throw new BufferUnderflowError(
                `Required ${count} bytes, but only ${this.remaining} available`
            );
        }
    }

    private movePosition(count: number): void {
        this.checkState();
        this.pos = Math.min(this.pos + count, this.limitPos);
    }

    setLimit(newLimit: number): this {
        this.checkState();
        if (newLimit < 0 || newLimit > this.capacity) {
            throw new RangeError('Limit out of bounds');
        }
        if (this.pos > newLimit) {
            this.pos = newLimit;
        }
        if (this.markPos > newLimit) {
            this.markPos = -1;
        }
        this.limitPos = newLimit;
        return this;
    }

    hasAvailable(count: number): boolean {
        this.checkState();
        return this.pos + count <= this.limitPos;
    }

    release(): void {
        if (!this.pooled || this.state === BufferState.Released) return;

        ByteBuffer.pool.release(this.buffer);
        this.state = BufferState.Released;
        this.typedArrayCache.clear();
    }

    fillBytes(value: number, count: number): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + count);

        if (value === 0) {
            this.u8Array.fill(0, this.pos, this.pos + count);
        } else {
            for (let i = 0; i < count; i++) {
                this.u8Array[this.pos + i] = value;
            }
        }

        this.movePosition(count);
        return this;
    }

    seek(offset: number, origin: SeekOrigin = SeekOrigin.Begin): this {
        this.checkState();
        let newPosition: number;

        switch (origin) {
            case SeekOrigin.Begin:
                newPosition = offset;
                break;
            case SeekOrigin.Current:
                newPosition = this.pos + offset;
                break;
            case SeekOrigin.End:
                newPosition = this.limitPos + offset;
                break;
            default:
                throw new TypeError('Invalid seek origin');
        }

        if (newPosition < 0 || newPosition > this.limitPos) {
            throw new RangeError(`Position out of bounds: ${newPosition}, limit: ${this.limitPos}`);
        }

        this.pos = newPosition;
        return this;
    }

    slice(begin?: number, end?: number): ByteBuffer {
        this.checkState();
        const start = begin ?? this.pos;
        const endPos = end ?? this.limitPos;

        if (start < 0 || endPos > this.limitPos || start > endPos) {
            throw new RangeError('Invalid slice bounds');
        }

        const slicedBuffer = new ByteBuffer(
            this.buffer.slice(start, endPos),
            this.byteOrder,
            false
        );

        if (this.readOnly) {
            slicedBuffer.readOnly = true;
        }

        return slicedBuffer;
    }

    compact(): this {
        this.checkState();
        this.checkReadOnly();

        if (this.pos === 0) return this;

        this.u8Array.copyWithin(0, this.pos, this.limitPos);

        const newLimit = this.limitPos - this.pos;
        this.pos = 0;
        this.limitPos = newLimit;
        this.markPos = -1;

        return this;
    }

    duplicate(): IByteBuffer {
        this.checkState();
        const duplicated = new ByteBuffer(this.buffer, this.byteOrder, false);

        duplicated.pos = this.pos;
        duplicated.limitPos = this.limitPos;
        duplicated.markPos = this.markPos;
        duplicated.readOnly = this.readOnly;
        duplicated.state = this.state;

        return duplicated;
    }

    clear(): this {
        this.checkState();
        this.pos = 0;
        this.limitPos = this.capacity;
        this.markPos = -1;
        return this;
    }

    flip(): this {
        this.checkState();
        this.limitPos = this.pos;
        this.pos = 0;
        this.markPos = -1;
        return this;
    }

    rewind(): this {
        this.checkState();
        this.pos = 0;
        this.markPos = -1;
        return this;
    }

    reset(): this {
        this.checkState();
        if (this.markPos < 0) {
            throw new InvalidMarkError();
        }
        this.pos = this.markPos;
        return this;
    }

    mark(): this {
        this.checkState();
        this.markPos = this.pos;
        return this;
    }

    asReadOnlyBuffer(): IReadableBuffer {
        this.checkState();
        const buffer = this.duplicate() as ByteBuffer;
        buffer.readOnly = true;
        return buffer;
    }

    asImmutableBuffer(): IReadableBuffer {
        return this.asReadOnlyBuffer();
    }

    toUint8Array(): Uint8Array {
        this.checkState();
        return new Uint8Array(this.buffer, this.pos, this.limitPos - this.pos);
    }

    align(alignment: number): this {
        this.checkState();
        if (alignment <= 0 || (alignment & (alignment - 1)) !== 0) {
            throw new BufferAlignmentError('Alignment must be a positive power of 2');
        }

        const mask = alignment - 1;
        const aligned = (this.pos + mask) & ~mask;
        const padding = aligned - this.pos;

        if (padding > 0) {
            this.pos = aligned;
        }

        return this;
    }

    sliceRange(length: number): ByteBuffer {
        this.checkState();
        this.checkReadableBytes(length);

        const slice = this.slice(this.pos, this.pos + length);
        this.movePosition(length);
        return slice;
    }

    put(
        source: ByteBuffer | Uint8Array | number[] | ArrayBuffer,
        sourceOffset = 0,
        length?: number
    ): this {
        this.checkState();
        this.checkReadOnly();

        let data: Uint8Array;
        if (source instanceof ByteBuffer) {
            data = source.u8Array.subarray(source.position, source.limit);
            sourceOffset = 0;
        } else if (source instanceof Uint8Array) {
            data = source;
        } else if (source instanceof ArrayBuffer) {
            data = new Uint8Array(source);
        } else {
            data = new Uint8Array(source);
        }

        const actualLength = length ?? data.length - sourceOffset;

        if (actualLength === 0) return this;

        this.ensureCapacity(this.pos + actualLength);

        this.u8Array.set(data.subarray(sourceOffset, sourceOffset + actualLength), this.pos);
        this.movePosition(actualLength);
        return this;
    }

    putBuffer(source: ByteBuffer): this {
        this.checkState();
        source.checkState();

        if (source.remaining === 0) return this;

        const data = source.u8Array.subarray(source.position, source.limit);
        this.put(data);

        source.seek(source.limit);

        return this;
    }

    putString(str: string, encoding: 'utf8' | 'utf16' = 'utf8'): this {
        this.checkState();
        this.checkReadOnly();

        const bytes = BufferUtils.encodeString(str);

        if (bytes.length > STRING_DEFAULTS.MAX_WRITE_LENGTH) {
            throw new BufferOverflowError(
                `String exceeds maximum allowed length: ${bytes.length} > ${STRING_DEFAULTS.MAX_WRITE_LENGTH}`
            );
        }

        this.putInt32(bytes.length);
        return this.put(bytes);
    }

    getString(): string {
        this.checkState();

        const length = this.getInt32();
        if (length < 0 || length > STRING_DEFAULTS.MAX_WRITE_LENGTH) {
            throw new BufferUnderflowError(`Invalid string length: ${length}`);
        }

        this.checkReadableBytes(length);
        const bytes = this.u8Array.subarray(this.pos, this.pos + length);
        this.movePosition(length);

        return BufferUtils.decodeString(bytes);
    }

    putCString(str: string): this {
        this.checkState();
        this.checkReadOnly();

        const bytes = BufferUtils.encodeString(str);
        this.ensureCapacity(this.pos + bytes.length + 1);
        this.u8Array.set(bytes, this.pos);
        this.u8Array[this.pos + bytes.length] = 0; // Null terminator
        this.movePosition(bytes.length + 1);
        return this;
    }

    getCString(): string {
        this.checkState();

        let end = this.pos;
        while (end < this.limitPos && this.u8Array[end] !== 0) {
            end++;
        }

        if (end >= this.limitPos) {
            throw new BufferUnderflowError('No null terminator found');
        }

        const bytes = this.u8Array.subarray(this.pos, end);
        this.movePosition(end - this.pos + 1);

        return BufferUtils.decodeString(bytes);
    }

    putAll(elements: number[]): this;
    putAll<T extends keyof TypedArrayMap>(array: TypedArrayMap[T]): this;
    putAll(data: any): this {
        this.checkState();
        this.checkReadOnly();

        if (Array.isArray(data)) {
            this.ensureCapacity(this.pos + data.length);
            for (let i = 0; i < data.length; i++) {
                this.u8Array[this.pos + i] = data[i] & 0xff;
            }
            this.movePosition(data.length);
        } else if (ArrayBuffer.isView(data)) {
            const byteLength = data.byteLength;
            this.ensureCapacity(this.pos + byteLength);

            new Uint8Array(this.buffer, this.pos, byteLength).set(
                new Uint8Array(data.buffer, data.byteOffset, byteLength)
            );

            this.movePosition(byteLength);
        }

        return this;
    }

    private getTypedArray<K extends keyof TypedArrayMap>(
        key: K,
        constructor: TypedArrayConstructorMap[K]
    ): TypedArrayMap[K] {
        this.checkState();

        let array = this.typedArrayCache.get(key) as TypedArrayMap[K];
        if (!array) {
            array = new constructor(this.buffer);
            this.typedArrayCache.set(key, array);
        }
        return array;
    }

    putInt8(value: number): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 1);
        this.view.setInt8(this.pos, value);
        this.movePosition(1);
        return this;
    }

    putUint8(value: number): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 1);
        this.view.setUint8(this.pos, value);
        this.movePosition(1);
        return this;
    }

    putInt16(value: number): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 2);
        this.view.setInt16(this.pos, value, this.byteOrder === ByteOrder.Little);
        this.movePosition(2);
        return this;
    }

    putUint16(value: number): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 2);
        this.view.setUint16(this.pos, value, this.byteOrder === ByteOrder.Little);
        this.movePosition(2);
        return this;
    }

    putInt32(value: number): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 4);
        this.view.setInt32(this.pos, value, this.byteOrder === ByteOrder.Little);
        this.movePosition(4);
        return this;
    }

    putUint32(value: number): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 4);
        this.view.setUint32(this.pos, value, this.byteOrder === ByteOrder.Little);
        this.movePosition(4);
        return this;
    }

    putBigInt64(value: bigint): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 8);
        this.view.setBigInt64(this.pos, value, this.byteOrder === ByteOrder.Little);
        this.movePosition(8);
        return this;
    }

    putBigUint64(value: bigint): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 8);
        this.view.setBigUint64(this.pos, value, this.byteOrder === ByteOrder.Little);
        this.movePosition(8);
        return this;
    }

    putFloat32(value: number): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 4);
        this.view.setFloat32(this.pos, value, this.byteOrder === ByteOrder.Little);
        this.movePosition(4);
        return this;
    }

    putFloat64(value: number): this {
        this.checkState();
        this.checkReadOnly();
        this.ensureCapacity(this.pos + 8);
        this.view.setFloat64(this.pos, value, this.byteOrder === ByteOrder.Little);
        this.movePosition(8);
        return this;
    }

    putInt8Array(values: Int8Array | number[]): this {
        this.checkState();
        this.checkReadOnly();

        const length = values.length;
        this.ensureCapacity(this.pos + length);

        if (values instanceof Int8Array) {
            new Int8Array(this.buffer, this.pos, length).set(values);
        } else {
            const view = new Int8Array(this.buffer, this.pos, length);
            for (let i = 0; i < length; i++) {
                view[i] = values[i];
            }
        }

        this.movePosition(length);
        return this;
    }

    putInt32Array(values: Int32Array | number[]): this {
        this.checkState();
        this.checkReadOnly();

        const length = values.length;
        const byteLength = length * 4;
        this.ensureCapacity(this.pos + byteLength);

        if (values instanceof Int32Array) {
            if (
                this.byteOrder === ByteOrder.Little &&
                BufferUtils.nativeEndianness() === ByteOrder.Little
            ) {
                new Int32Array(this.buffer, this.pos, length).set(values);
            } else {
                for (let i = 0; i < length; i++) {
                    this.view.setInt32(
                        this.pos + i * 4,
                        values[i],
                        this.byteOrder === ByteOrder.Little
                    );
                }
            }
        } else {
            for (let i = 0; i < length; i++) {
                this.view.setInt32(
                    this.pos + i * 4,
                    values[i],
                    this.byteOrder === ByteOrder.Little
                );
            }
        }

        this.movePosition(byteLength);
        return this;
    }

    getInt8(): number {
        this.checkReadableBytes(1);
        const value = this.view.getInt8(this.pos);
        this.movePosition(1);
        return value;
    }

    getUint8(): number {
        this.checkReadableBytes(1);
        const value = this.view.getUint8(this.pos);
        this.movePosition(1);
        return value;
    }

    getInt16(): number {
        this.checkReadableBytes(2);
        const value = this.view.getInt16(this.pos, this.byteOrder === ByteOrder.Little);
        this.movePosition(2);
        return value;
    }

    getUint16(): number {
        this.checkReadableBytes(2);
        const value = this.view.getUint16(this.pos, this.byteOrder === ByteOrder.Little);
        this.movePosition(2);
        return value;
    }

    getInt32(): number {
        this.checkReadableBytes(4);
        const value = this.view.getInt32(this.pos, this.byteOrder === ByteOrder.Little);
        this.movePosition(4);
        return value;
    }

    getUint32(): number {
        this.checkReadableBytes(4);
        const value = this.view.getUint32(this.pos, this.byteOrder === ByteOrder.Little);
        this.movePosition(4);
        return value;
    }

    getBigInt64(): bigint {
        this.checkReadableBytes(8);
        const value = this.view.getBigInt64(this.pos, this.byteOrder === ByteOrder.Little);
        this.movePosition(8);
        return value;
    }

    getBigUint64(): bigint {
        this.checkReadableBytes(8);
        const value = this.view.getBigUint64(this.pos, this.byteOrder === ByteOrder.Little);
        this.movePosition(8);
        return value;
    }

    getFloat32(): number {
        this.checkReadableBytes(4);
        const value = this.view.getFloat32(this.pos, this.byteOrder === ByteOrder.Little);
        this.movePosition(4);
        return value;
    }

    getFloat64(): number {
        this.checkReadableBytes(8);
        const value = this.view.getFloat64(this.pos, this.byteOrder === ByteOrder.Little);
        this.movePosition(8);
        return value;
    }

    getInt8Array(length: number): Int8Array {
        this.checkReadableBytes(length);

        const array = new Int8Array(this.buffer, this.pos, length);
        this.movePosition(length);

        return new Int8Array(array);
    }

    getInt32Array(length: number): Int32Array {
        const byteLength = length * 4;
        this.checkReadableBytes(byteLength);

        let result: Int32Array;

        if (
            this.byteOrder === ByteOrder.Little &&
            BufferUtils.nativeEndianness() === ByteOrder.Little
        ) {
            result = new Int32Array(this.buffer.slice(this.pos, this.pos + byteLength));
        } else {
            result = new Int32Array(length);
            for (let i = 0; i < length; i++) {
                result[i] = this.view.getInt32(
                    this.pos + i * 4,
                    this.byteOrder === ByteOrder.Little
                );
            }
        }

        this.movePosition(byteLength);
        return result;
    }

    putVarInt(value: number): this {
        this.checkState();
        this.checkReadOnly();

        let temp = value >>> 0;

        do {
            let b = temp & 0x7f;
            temp >>>= 7;
            if (temp !== 0) {
                b |= 0x80;
            }
            this.putUint8(b);
        } while (temp !== 0);

        return this;
    }

    getVarInt(): number {
        this.checkState();

        let result = 0;
        let shift = 0;
        let b: number;

        do {
            if (shift >= 32) {
                throw new BufferUnderflowError('VarInt is too big');
            }

            b = this.getUint8();
            result |= (b & 0x7f) << shift;
            shift += 7;
        } while ((b & 0x80) !== 0);

        return result >>> 0;
    }

    putJson<T>(value: T): this {
        return this.putString(JSON.stringify(value));
    }

    getJson<T>(): T {
        return JSON.parse(this.getString());
    }

    hash(): number {
        this.checkState();

        const view = this.u8Array.subarray(this.pos, this.limitPos);
        return BufferUtils.calculateHash(view);
    }

    crc32(): number {
        this.checkState();

        const data = this.u8Array.subarray(this.pos, this.limitPos);
        return BufferUtils.calculateCrc32(data);
    }

    static align(buffer: ByteBuffer, alignment: number): void {
        buffer.checkState();

        if (alignment <= 0 || (alignment & (alignment - 1)) !== 0) {
            throw new BufferAlignmentError('Alignment must be a positive power of 2');
        }

        const mask = alignment - 1;
        const pos = buffer.position;
        const alignedPos = (pos + mask) & ~mask;

        if (alignedPos > buffer.limit) {
            throw new BufferOverflowError('Cannot align beyond buffer limit');
        }

        buffer.seek(alignedPos - pos, SeekOrigin.Current);
    }

    static compare(a: ByteBuffer, b: ByteBuffer): number {
        a.checkState();
        b.checkState();

        const len = Math.min(a.remaining, b.remaining);

        {
            for (let i = 0; i < len; i++) {
                const diff = a.u8Array[a.pos + i] - b.u8Array[b.pos + i];
                if (diff !== 0) return diff;
            }
        }

        return a.remaining - b.remaining;
    }

    static equals(a: ByteBuffer, b: ByteBuffer): boolean {
        a.checkState();
        b.checkState();

        if (a.remaining !== b.remaining) return false;

        if (typeof Uint8Array.prototype.every === 'function') {
            return a.u8Array
                .subarray(a.pos, a.limitPos)
                .every((value, i) => value === b.u8Array[b.pos + i]);
        } else {
            const len = a.remaining;
            for (let i = 0; i < len; i++) {
                if (a.u8Array[a.pos + i] !== b.u8Array[b.pos + i]) {
                    return false;
                }
            }
            return true;
        }
    }

    static concat(buffers: ByteBuffer[], order = ByteOrder.Big): ByteBuffer {
        if (buffers.length === 0) return ByteBuffer.alloc(0, order);

        let totalCapacity = 0;
        for (const buffer of buffers) {
            buffer.checkState();
            totalCapacity += buffer.remaining;
        }

        const result = ByteBuffer.alloc(totalCapacity, order);

        for (const buffer of buffers) {
            result.put(buffer.u8Array.subarray(buffer.pos, buffer.limitPos));
        }

        result.flip();

        return result;
    }

    static copyOf(original: ByteBuffer, newCapacity: number = original.capacity): ByteBuffer {
        original.checkState();

        if (newCapacity < original.remaining) {
            throw new RangeError('New capacity is too small');
        }

        const copy = ByteBuffer.alloc(newCapacity, original.order);
        copy.put(original.u8Array.subarray(original.pos, original.limitPos));
        copy.flip();

        return copy;
    }
}
