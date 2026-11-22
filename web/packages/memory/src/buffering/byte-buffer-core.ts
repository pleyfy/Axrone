import { ByteOrder, SeekOrigin, BufferState, TypedArrayMap } from './types';
import { IByteBuffer, IReadableBuffer } from './interfaces';
import { BUFFER_DEFAULTS, STRING_DEFAULTS, PERFORMANCE_DEFAULTS } from './constants';
import {
    BufferOverflowError,
    BufferUnderflowError,
    ReadOnlyBufferError,
    InvalidMarkError,
    BufferAlignmentError,
    BufferReleasedError,
} from './errors';
import { ByteChunkPoolSet } from './byte-chunk';
import type { ByteChunk } from './byte-chunk';
import { BufferView } from './buffer-view';
import { BufferUtils } from './utils';
import { writeJson, readJson } from './varint';

/**
 * Pooled, endianness-aware binary buffer for reading and writing typed data.
 *
 * Wraps an ArrayBuffer with position/limit/capacity semantics (similar to Java's ByteBuffer).
 * Supports automatic pooling via BufferPool for zero-allocation hot paths, configurable
 * byte order (big/little endian), and typed array views. Buffers can be allocated from
 * the pool ({@link ByteBuffer.alloc}) or wrap existing memory ({@link ByteBuffer.wrap}).
 *
 * Key patterns:
 * - Use `alloc()` for pooled buffers, `directBuffer()` for non-pooled, `wrap()` for existing memory.
 * - Call `flip()` after writing to prepare for reading; call `compact()` to discard read bytes.
 * - Always call `release()` on pooled buffers to return them to the pool.
 *
 * @example
 * const buf = ByteBuffer.alloc(64);
 * buf.putInt32(42).putFloat64(3.14).putString("hello");
 * buf.flip();
 * const n = buf.getInt32();     // 42
 * const f = buf.getFloat64();   // 3.14
 * const s = buf.getString();    // "hello"
 * buf.release();
 *
 * @stable
 */
export class ByteBuffer implements IByteBuffer {
    private static readonly DEFAULT_ORDER = ByteOrder.Big;
    private static readonly VIEW_CACHE_CAPACITY = PERFORMANCE_DEFAULTS.CACHE_SIZE ?? 256;
    private static readonly viewCache = new Map<string, WeakMap<ByteBuffer, BufferView<any>>>();

    private buffer: ArrayBuffer;
    private view: DataView;
    private u8Array: Uint8Array;
    private chunk: ByteChunk | null;
    private pos: number;
    private byteOrder: ByteOrder;
    private markPos: number;
    private limitPos: number;
    private readOnly: boolean;
    private state: BufferState;
    private readonly littleEndian: boolean;

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

        if (usePool) {
            const chunk = ByteChunkPoolSet.getInstance().acquireChunk(actualCapacity);
            return new ByteBuffer(chunk.buffer, order, true, chunk);
        }

        return new ByteBuffer(new ArrayBuffer(actualCapacity), order, false);
    }

    static wrap(array: ArrayBuffer | ArrayBufferView, order = ByteOrder.Big): ByteBuffer {
        const buffer = array instanceof ArrayBuffer ? array : (array.buffer as ArrayBuffer);
        return new ByteBuffer(buffer, order, false);
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
            if (ByteBuffer.viewCache.size >= ByteBuffer.VIEW_CACHE_CAPACITY) {
                const oldestKey = ByteBuffer.viewCache.keys().next().value;
                if (oldestKey !== undefined) ByteBuffer.viewCache.delete(oldestKey);
            }
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
        private pooled: boolean = false,
        chunk: ByteChunk | null = null
    ) {
        this.buffer = buffer;
        this.chunk = chunk;
        this.view = chunk !== null ? chunk._view : new DataView(buffer);
        this.u8Array = chunk !== null ? chunk._u8 : new Uint8Array(buffer);
        this.pos = 0;
        this.markPos = -1;
        this.limitPos = buffer.byteLength;
        this.byteOrder = order;
        this.littleEndian = order === ByteOrder.Little;
        this.readOnly = false;
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

    getBuffer(): ArrayBuffer {
        this.checkState();
        return this.buffer;
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

        const oldCapacity = this.buffer.byteLength;
        const limitTracksCapacity = this.limitPos === oldCapacity;

        const newChunk = this.pooled
            ? ByteChunkPoolSet.getInstance().acquireChunk(newCapacity)
            : null;
        const newBuffer = newChunk !== null ? newChunk.buffer : new ArrayBuffer(newCapacity);

        new Uint8Array(newBuffer).set(this.u8Array);

        if (this.pooled) {
            const oldChunk = this.chunk;
            this.chunk = null;
            if (oldChunk !== null) {
                oldChunk.dispose();
            } else {
                ByteChunkPoolSet.getInstance().release(this.buffer);
            }
        }

        this.buffer = newBuffer;
        this.chunk = newChunk;
        this.view = newChunk !== null ? newChunk._view : new DataView(newBuffer);
        this.u8Array = newChunk !== null ? newChunk._u8 : new Uint8Array(newBuffer);

        if (limitTracksCapacity) {
            this.limitPos = newBuffer.byteLength;
        }
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

        const chunk = this.chunk;
        this.chunk = null;
        this.pooled = false;

        if (chunk !== null) {
            chunk.dispose();
        } else {
            ByteChunkPoolSet.getInstance().release(this.buffer);
        }

        this.state = BufferState.Released;
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

    /**
     * Zero-copy view over [begin, end). Does not change position or limit.
     * The view aliases the pooled buffer: do not retain it past `release()`.
     */
    subarray(begin: number = this.pos, end: number = this.limitPos): Uint8Array {
        this.checkState();
        const start = Math.max(0, Math.min(begin, this.limitPos));
        const stop = Math.max(start, Math.min(end, this.limitPos));
        return this.u8Array.subarray(start, stop);
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

        const bytes = BufferUtils.encodeString(str, encoding);

        if (bytes.length > STRING_DEFAULTS.MAX_WRITE_LENGTH) {
            throw new BufferOverflowError(
                `String exceeds maximum allowed length: ${bytes.length} > ${STRING_DEFAULTS.MAX_WRITE_LENGTH}`
            );
        }

        const pos = this.pos;
        const required = pos + 4 + bytes.length;
        if (required > this.limitPos) {
            this.ensureCapacity(required);
        }

        this.view.setInt32(pos, bytes.length, this.littleEndian);
        this.u8Array.set(bytes, pos + 4);

        this.pos = required <= this.limitPos ? required : this.limitPos;
        return this;
    }

    getString(encoding: 'utf8' | 'utf16' = 'utf8'): string {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 4 > this.limitPos) this.checkReadableBytes(4);

        const length = this.view.getInt32(pos, this.littleEndian);
        if (length < 0 || length > STRING_DEFAULTS.MAX_WRITE_LENGTH) {
            throw new BufferUnderflowError(`Invalid string length: ${length}`);
        }

        const start = pos + 4;
        if (start + length > this.limitPos) {
            this.checkReadableBytes(4 + length);
        }

        this.pos = start + length;
        return BufferUtils.decodeString(this.u8Array.subarray(start, start + length), encoding);
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

    putInt8(value: number): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 1 > this.limitPos) this.ensureCapacity(pos + 1);
        this.view.setInt8(pos, value);
        const next = pos + 1;
        this.pos = next <= this.limitPos ? next : this.limitPos;
        return this;
    }

    putUint8(value: number): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 1 > this.limitPos) this.ensureCapacity(pos + 1);
        this.view.setUint8(pos, value);
        const next = pos + 1;
        this.pos = next <= this.limitPos ? next : this.limitPos;
        return this;
    }

    putInt16(value: number): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 2 > this.limitPos) this.ensureCapacity(pos + 2);
        this.view.setInt16(pos, value, this.littleEndian);
        const next = pos + 2;
        this.pos = next <= this.limitPos ? next : this.limitPos;
        return this;
    }

    putUint16(value: number): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 2 > this.limitPos) this.ensureCapacity(pos + 2);
        this.view.setUint16(pos, value, this.littleEndian);
        const next = pos + 2;
        this.pos = next <= this.limitPos ? next : this.limitPos;
        return this;
    }

    putInt32(value: number): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 4 > this.limitPos) this.ensureCapacity(pos + 4);
        this.view.setInt32(pos, value, this.littleEndian);
        const next = pos + 4;
        this.pos = next <= this.limitPos ? next : this.limitPos;
        return this;
    }

    putUint32(value: number): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 4 > this.limitPos) this.ensureCapacity(pos + 4);
        this.view.setUint32(pos, value, this.littleEndian);
        const next = pos + 4;
        this.pos = next <= this.limitPos ? next : this.limitPos;
        return this;
    }

    putBigInt64(value: bigint): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 8 > this.limitPos) this.ensureCapacity(pos + 8);
        this.view.setBigInt64(pos, value, this.littleEndian);
        const next = pos + 8;
        this.pos = next <= this.limitPos ? next : this.limitPos;
        return this;
    }

    putBigUint64(value: bigint): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 8 > this.limitPos) this.ensureCapacity(pos + 8);
        this.view.setBigUint64(pos, value, this.littleEndian);
        const next = pos + 8;
        this.pos = next <= this.limitPos ? next : this.limitPos;
        return this;
    }

    putFloat32(value: number): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 4 > this.limitPos) this.ensureCapacity(pos + 4);
        this.view.setFloat32(pos, value, this.littleEndian);
        const next = pos + 4;
        this.pos = next <= this.limitPos ? next : this.limitPos;
        return this;
    }

    putFloat64(value: number): this {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 8 > this.limitPos) this.ensureCapacity(pos + 8);
        this.view.setFloat64(pos, value, this.littleEndian);
        const next = pos + 8;
        this.pos = next <= this.limitPos ? next : this.limitPos;
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
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 1 > this.limitPos) this.checkReadableBytes(1);
        const value = this.view.getInt8(pos);
        this.pos = pos + 1;
        return value;
    }

    getUint8(): number {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 1 > this.limitPos) this.checkReadableBytes(1);
        const value = this.view.getUint8(pos);
        this.pos = pos + 1;
        return value;
    }

    getInt16(): number {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 2 > this.limitPos) this.checkReadableBytes(2);
        const value = this.view.getInt16(pos, this.littleEndian);
        this.pos = pos + 2;
        return value;
    }

    getUint16(): number {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 2 > this.limitPos) this.checkReadableBytes(2);
        const value = this.view.getUint16(pos, this.littleEndian);
        this.pos = pos + 2;
        return value;
    }

    getInt32(): number {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 4 > this.limitPos) this.checkReadableBytes(4);
        const value = this.view.getInt32(pos, this.littleEndian);
        this.pos = pos + 4;
        return value;
    }

    getUint32(): number {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 4 > this.limitPos) this.checkReadableBytes(4);
        const value = this.view.getUint32(pos, this.littleEndian);
        this.pos = pos + 4;
        return value;
    }

    getBigInt64(): bigint {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 8 > this.limitPos) this.checkReadableBytes(8);
        const value = this.view.getBigInt64(pos, this.littleEndian);
        this.pos = pos + 8;
        return value;
    }

    getBigUint64(): bigint {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 8 > this.limitPos) this.checkReadableBytes(8);
        const value = this.view.getBigUint64(pos, this.littleEndian);
        this.pos = pos + 8;
        return value;
    }

    getFloat32(): number {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 4 > this.limitPos) this.checkReadableBytes(4);
        const value = this.view.getFloat32(pos, this.littleEndian);
        this.pos = pos + 4;
        return value;
    }

    getFloat64(): number {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (pos + 8 > this.limitPos) this.checkReadableBytes(8);
        const value = this.view.getFloat64(pos, this.littleEndian);
        this.pos = pos + 8;
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
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();
        if (this.readOnly) this.checkReadOnly();
        if (pos + 5 > this.limitPos) this.ensureCapacity(pos + 5);

        const u8 = this.u8Array;
        let temp = value >>> 0;
        let p = pos;

        do {
            let b = temp & 0x7f;
            temp >>>= 7;
            if (temp !== 0) b |= 0x80;
            u8[p++] = b;
        } while (temp !== 0);

        this.pos = p <= this.limitPos ? p : this.limitPos;
        return this;
    }

    getVarInt(): number {
        const pos = this.pos;
        if (this.state === BufferState.Released) this.checkState();

        const u8 = this.u8Array;
        const limit = this.limitPos;
        let p = pos;
        let result = 0;
        let shift = 0;
        let b = 0;

        do {
            if (p >= limit) {
                this.pos = p;
                throw new BufferUnderflowError('VarInt exceeds readable range');
            }
            if (shift >= 32) {
                this.pos = p;
                throw new BufferUnderflowError('VarInt is too big');
            }
            b = u8[p++];
            result |= (b & 0x7f) << shift;
            shift += 7;
        } while ((b & 0x80) !== 0);

        this.pos = p;
        return result >>> 0;
    }

    putJson<T>(value: T): this {
        writeJson(this, value);
        return this;
    }

    getJson<T>(): T {
        return readJson<T>(this);
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

        return a.u8Array
            .subarray(a.pos, a.limitPos)
            .every((value, i) => value === b.u8Array[b.pos + i]);
    }

    static concat(buffers: ByteBuffer[], order = ByteOrder.Big): ByteBuffer {
        if (buffers.length === 0) {
            return new ByteBuffer(new ArrayBuffer(0), order, false);
        }

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
