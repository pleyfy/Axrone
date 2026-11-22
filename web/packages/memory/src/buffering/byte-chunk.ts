/**
 * ByteChunk: pooled, epoch-guarded byte buffer used by ByteBuffer.
 * Built on @axrone/utility Result/Brand primitives.
 */

import { Brand, err, ok, type Result } from '@axrone/utility';

export type ByteOffset = Brand<number, 'ByteOffset'>;
export type ByteLength = Brand<number, 'ByteLength'>;
export type ChunkId = Brand<string, 'ChunkId'>;

export function ByteOffset(n: number): ByteOffset {
    return (n | 0) as ByteOffset;
}

export function ByteLength(n: number): ByteLength {
    return (n | 0) as ByteLength;
}

export function ChunkId(id: string): ChunkId {
    return id as ChunkId;
}

export const VOID_OK: Result<void, never> = ok();

export const MemoryErrorCode = {
    OUT_OF_BOUNDS: 1,
    ACCESS_VIOLATION: 2,
    DISPOSED: 3,
    ALLOCATION_FAILED: 4,
    ACTIVE_LEASES: 5,
    ABORTED: 6,
    ALIGNMENT_FAULT: 7,
    BUFFER_OVERFLOW: 8,
} as const;

export type MemoryErrorCode = (typeof MemoryErrorCode)[keyof typeof MemoryErrorCode];

export interface MemoryError {
    readonly code: MemoryErrorCode;
    readonly message: string;
    readonly offset: number;
    readonly required: number;
    readonly limit: number;
}

export const ERR_DISPOSED: Result<never, MemoryError> = err({
    code: MemoryErrorCode.DISPOSED,
    message: 'ByteChunk is unallocated or already reclaimed',
    offset: 0,
    required: 0,
    limit: 0,
});

export const ERR_READ_ONLY: Result<never, MemoryError> = err({
    code: MemoryErrorCode.ACCESS_VIOLATION,
    message: 'Mutation attempted on an immutable ByteChunk instance',
    offset: 0,
    required: 0,
    limit: 0,
});

function coldOutOfBounds(offset: number, required: number, limit: number): Result<never, MemoryError> {
    return err({
        code: MemoryErrorCode.OUT_OF_BOUNDS,
        message: 'Index out of bounded physical memory range',
        offset,
        required,
        limit,
    });
}

function coldAborted(reason: unknown): Result<never, MemoryError> {
    return err({
        code: MemoryErrorCode.ABORTED,
        message: reason instanceof Error ? reason.message : 'ByteChunk operation cancelled',
        offset: 0,
        required: 0,
        limit: 0,
    });
}

function coldVarIntOverflow(offset: number, bytesRead: number, limit: number): Result<never, MemoryError> {
    return err({
        code: MemoryErrorCode.BUFFER_OVERFLOW,
        message: 'Malformed LEB128 varint32 sequence exceeds 5 bytes',
        offset,
        required: bytesRead,
        limit,
    });
}

function coldUtf8Error(cause: unknown, offset: number, required: number, limit: number): Result<never, MemoryError> {
    return err({
        code: MemoryErrorCode.BUFFER_OVERFLOW,
        message: cause instanceof Error ? cause.message : 'UTF-8 decoding fault',
        offset,
        required,
        limit,
    });
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });

function safeDecodeUtf8(
    bytes: Uint8Array,
    offset: number,
    length: number,
    limit: number
): Result<string, MemoryError> {
    try {
        return ok(TEXT_DECODER.decode(bytes));
    } catch (err: unknown) {
        return coldUtf8Error(err, offset, length, limit);
    }
}

export type Mutability = 'MUT' | 'IMMUT';
export type Ownership = 'OWNED' | 'BORROWED';

export type PrimitiveType =
    | 'u8'
    | 'i8'
    | 'u16'
    | 'i16'
    | 'u32'
    | 'i32'
    | 'f32'
    | 'f64'
    | 'u64'
    | 'i64';

export type TypeSize<T extends PrimitiveType> =
    T extends 'u8' | 'i8' ? 1 :
    T extends 'u16' | 'i16' ? 2 :
    T extends 'u32' | 'i32' | 'f32' ? 4 :
    T extends 'f64' | 'u64' | 'i64' ? 8 : never;

export type NativeTypeOf<T extends PrimitiveType> = T extends 'u64' | 'i64' ? bigint : number;

export type TupleOfLength<L extends number, Acc extends readonly unknown[] = []> =
    Acc['length'] extends L ? Acc : TupleOfLength<L, readonly [...Acc, unknown]>;

export type ComputeLayout<
    Entries extends readonly (readonly [string, PrimitiveType])[],
    CurrentOffset extends readonly unknown[] = [],
    Acc extends readonly (readonly [string, number, PrimitiveType])[] = []
> = Entries extends readonly [
    readonly [infer Name extends string, infer Type extends PrimitiveType],
    ...infer Rest extends readonly (readonly [string, PrimitiveType])[],
]
    ? ComputeLayout<
          Rest,
          [...CurrentOffset, ...TupleOfLength<TypeSize<Type>>],
          readonly [...Acc, readonly [Name, CurrentOffset['length'], Type]]
      >
    : Acc;

export type FindField<
    TLayout extends readonly (readonly [string, number, PrimitiveType])[],
    TKey extends string,
> = TLayout extends readonly [
    readonly [infer Name, infer Offset extends number, infer Type extends PrimitiveType],
    ...infer Rest extends readonly (readonly [string, number, PrimitiveType])[],
]
    ? Name extends TKey
        ? { readonly offset: Offset; readonly type: Type }
        : FindField<Rest, TKey>
    : never;

export function assertNever(x: never): never {
    throw new Error(`Exhaustive assertion breach: ${JSON.stringify(x)}`);
}

export function primitiveByteSize(type: PrimitiveType): number {
    switch (type) {
        case 'u8':
        case 'i8':
            return 1;
        case 'u16':
        case 'i16':
            return 2;
        case 'u32':
        case 'i32':
        case 'f32':
            return 4;
        case 'f64':
        case 'u64':
        case 'i64':
            return 8;
        default:
            return assertNever(type);
    }
}

export type ChunkLifecycleEvent =
    | { readonly kind: 'alloc'; readonly id: ChunkId; readonly bytes: number; readonly epoch: number }
    | { readonly kind: 'slice'; readonly id: ChunkId; readonly bytes: number; readonly epoch: number }
    | { readonly kind: 'retain'; readonly id: ChunkId; readonly count: number; readonly epoch: number }
    | { readonly kind: 'release'; readonly id: ChunkId; readonly count: number; readonly epoch: number }
    | { readonly kind: 'free'; readonly id: ChunkId; readonly epoch: number };

export interface IMetricsSink<in TEvent> {
    emit(event: TEvent): void;
}

export interface IChunkLease<out TChunk> extends Disposable {
    readonly chunk: TChunk;
}

export interface AllocationOptions<TMode extends Mutability> {
    readonly capacity: number;
    readonly mutability: TMode;
    readonly id?: ChunkId | undefined;
    readonly metrics?: IMetricsSink<ChunkLifecycleEvent> | undefined;
}

let nextChunkSeq = 1;
function generateFastChunkId(prefix: string): ChunkId {
    const seq = (nextChunkSeq = (nextChunkSeq + 1) >>> 0);
    return ChunkId(`${prefix}_${seq.toString(36)}`);
}

const FLAG_ACTIVE = 0;
const FLAG_DISPOSED = 1 << 0;
const FLAG_IMMUTABLE = 1 << 1;

export interface IChunkPoolRecycler {
    recycle(chunk: ByteChunk<any, any>): void;
}

export class ByteChunkLease<out M extends Mutability, out O extends Ownership>
    implements IChunkLease<ByteChunk<M, O>>
{
    private _chunk: ByteChunk<M, O> | null;
    private _disposer: (() => void) | null;
    private readonly _epoch: number;

    public constructor(chunk: ByteChunk<M, O>, disposer: () => void) {
        this._chunk = chunk;
        this._disposer = disposer;
        this._epoch = chunk.epoch;
    }

    public get chunk(): ByteChunk<M, O> {
        const ref = this._chunk;
        if (ref === null || ref.epoch !== this._epoch || ref.isDisposed) {
            throw new Error('Use-after-free: Lease has expired or was returned to pool');
        }
        return ref;
    }

    public [Symbol.dispose](): void {
        const fn = this._disposer;
        if (fn !== null) {
            this._disposer = null;
            this._chunk = null;
            fn();
        }
    }
}

export class ByteChunk<M extends Mutability = 'MUT', O extends Ownership = 'OWNED'>
    implements Disposable, AsyncDisposable
{
    public readonly id: ChunkId;
    public readonly byteLength: ByteLength;
    public readonly byteOffset: ByteOffset;
    public readonly buffer: ArrayBuffer;

    public readonly _u8: Uint8Array;
    public readonly _view: DataView;
    private _mutability: M;
    private _flags: number;
    private _refCount: number;
    private _epoch: number;
    private _parent: ByteChunk<Mutability, Ownership> | null;
    private _drainWaiters: Set<() => void> | null;
    private readonly _metrics: IMetricsSink<ChunkLifecycleEvent> | null;
    private _recycler: IChunkPoolRecycler | null;
    private _poolTag: number;

    public constructor(
        id: ChunkId,
        buffer: ArrayBuffer,
        byteOffset: ByteOffset,
        byteLength: ByteLength,
        mutability: M,
        parent: ByteChunk<Mutability, Ownership> | null,
        metrics: IMetricsSink<ChunkLifecycleEvent> | null,
        recycler: IChunkPoolRecycler | null = null,
        poolTag: number = 0
    ) {
        this.id = id;
        this.byteLength = byteLength;
        this.byteOffset = byteOffset;
        this.buffer = buffer;

        const offset = byteOffset | 0;
        const length = byteLength | 0;

        this._u8 = new Uint8Array(buffer, offset, length);
        this._view = new DataView(buffer, offset, length);
        this._mutability = mutability;
        this._flags = mutability === 'IMMUT' ? FLAG_IMMUTABLE : FLAG_ACTIVE;
        this._refCount = 1;
        this._epoch = 1;
        this._parent = parent;
        this._drainWaiters = null;
        this._metrics = metrics;
        this._recycler = recycler;
        this._poolTag = poolTag;
    }

    public static allocate<TMode extends Mutability = 'MUT'>(
        options: AllocationOptions<TMode>
    ): ByteChunk<TMode, 'OWNED'> {
        const capacity = options.capacity | 0;
        if (capacity <= 0 || !Number.isSafeInteger(options.capacity)) {
            throw new RangeError('Capacity must be a positive safe integer');
        }

        const rawBuffer = new ArrayBuffer(capacity);
        const chunkId = options.id ?? generateFastChunkId('chk');

        const chunk = new ByteChunk<TMode, 'OWNED'>(
            chunkId,
            rawBuffer,
            ByteOffset(0),
            ByteLength(capacity),
            options.mutability,
            null,
            options.metrics ?? null,
            null,
            0
        );

        options.metrics?.emit({ kind: 'alloc', id: chunkId, bytes: capacity, epoch: 1 });
        return chunk;
    }

    public static wrap<TMode extends Mutability = 'MUT'>(
        buffer: ArrayBuffer,
        offset: ByteOffset = ByteOffset(0),
        length?: ByteLength,
        mutability: TMode = 'MUT' as TMode,
        metrics?: IMetricsSink<ChunkLifecycleEvent>
    ): ByteChunk<TMode, 'OWNED'> {
        const rawLen = buffer.byteLength | 0;
        const off = offset | 0;
        const len = length === undefined ? (rawLen - off) | 0 : length | 0;

        if (off < 0 || len < 0 || off + len > rawLen) {
            throw new RangeError('Wrapped bounds exceed base ArrayBuffer allocation');
        }

        return new ByteChunk<TMode, 'OWNED'>(
            generateFastChunkId('wrap'),
            buffer,
            offset,
            ByteLength(len),
            mutability,
            null,
            metrics ?? null,
            null,
            0
        );
    }

    public get referenceCount(): number {
        return this._refCount;
    }

    public get isDisposed(): boolean {
        return (this._flags & FLAG_DISPOSED) !== 0;
    }

    public get isSlice(): boolean {
        return this._parent !== null;
    }

    public get mutability(): M {
        return this._mutability;
    }

    public get epoch(): number {
        return this._epoch;
    }

    public asUint8Array(): Uint8Array {
        if ((this._flags & FLAG_DISPOSED) !== 0) {
            return new Uint8Array(this.buffer, 0, 0);
        }
        return this._u8;
    }

    public subarray(offset: number = 0, length?: number): Uint8Array {
        if ((this._flags & FLAG_DISPOSED) !== 0) {
            return new Uint8Array(this.buffer, 0, 0);
        }
        const off = offset | 0;
        const maxAvailable = (this.byteLength - off) | 0;
        const len = length === undefined ? maxAvailable : length | 0;
        return this._u8.subarray(off, (off + len) | 0);
    }

    public cursor(initialOffset: ByteOffset = ByteOffset(0)): ByteCursor {
        return new ByteCursor(this, initialOffset);
    }

    public freeze(): ByteChunk<'IMMUT', O> {
        this._flags |= FLAG_IMMUTABLE;
        this._refCount = (this._refCount + 1) | 0;
        return new ByteChunk<'IMMUT', O>(
            this.id,
            this.buffer,
            this.byteOffset,
            this.byteLength,
            'IMMUT',
            this,
            this._metrics,
            null,
            0
        );
    }

    private _coldWriteCheck(): Result<never, MemoryError> {
        if ((this._flags & FLAG_DISPOSED) !== 0) return ERR_DISPOSED;
        return ERR_READ_ONLY;
    }

    public getUint8(offset: number): number {
        return this._u8[offset]!;
    }

    public setUint8(this: ByteChunk<'MUT', any>, offset: number, value: number): void {
        this._u8[offset] = value;
    }

    public getInt8(offset: number): number {
        return (this._u8[offset]! << 24) >> 24;
    }

    public setInt8(this: ByteChunk<'MUT', any>, offset: number, value: number): void {
        this._u8[offset] = value;
    }

    public getUint16(offset: number, le: boolean = true): number {
        return this._view.getUint16(offset, le);
    }

    public setUint16(this: ByteChunk<'MUT', any>, offset: number, value: number, le: boolean = true): void {
        this._view.setUint16(offset, value, le);
    }

    public getInt16(offset: number, le: boolean = true): number {
        return this._view.getInt16(offset, le);
    }

    public setInt16(this: ByteChunk<'MUT', any>, offset: number, value: number, le: boolean = true): void {
        this._view.setInt16(offset, value, le);
    }

    public getUint32(offset: number, le: boolean = true): number {
        return this._view.getUint32(offset, le);
    }

    public setUint32(this: ByteChunk<'MUT', any>, offset: number, value: number, le: boolean = true): void {
        this._view.setUint32(offset, value, le);
    }

    public getInt32(offset: number, le: boolean = true): number {
        return this._view.getInt32(offset, le);
    }

    public setInt32(this: ByteChunk<'MUT', any>, offset: number, value: number, le: boolean = true): void {
        this._view.setInt32(offset, value, le);
    }

    public getFloat32(offset: number, le: boolean = true): number {
        return this._view.getFloat32(offset, le);
    }

    public setFloat32(this: ByteChunk<'MUT', any>, offset: number, value: number, le: boolean = true): void {
        this._view.setFloat32(offset, value, le);
    }

    public getFloat64(offset: number, le: boolean = true): number {
        return this._view.getFloat64(offset, le);
    }

    public setFloat64(this: ByteChunk<'MUT', any>, offset: number, value: number, le: boolean = true): void {
        this._view.setFloat64(offset, value, le);
    }

    public getBigUint64(offset: number, le: boolean = true): bigint {
        return this._view.getBigUint64(offset, le);
    }

    public setBigUint64(this: ByteChunk<'MUT', any>, offset: number, value: bigint, le: boolean = true): void {
        this._view.setBigUint64(offset, value, le);
    }

    public getBigInt64(offset: number, le: boolean = true): bigint {
        return this._view.getBigInt64(offset, le);
    }

    public setBigInt64(this: ByteChunk<'MUT', any>, offset: number, value: bigint, le: boolean = true): void {
        this._view.setBigInt64(offset, value, le);
    }

    public readUint8(offset: ByteOffset): Result<number, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) >= (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 1, this.byteLength);
        }
        return ok(this._u8[off]!);
    }

    public readInt8(offset: ByteOffset): Result<number, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) >= (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 1, this.byteLength);
        }
        return ok((this._u8[off]! << 24) >> 24);
    }

    public readUint16(offset: ByteOffset, le: boolean = true): Result<number, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 2 > (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 2, this.byteLength);
        }
        return ok(this._view.getUint16(off, le));
    }

    public readInt16(offset: ByteOffset, le: boolean = true): Result<number, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 2 > (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 2, this.byteLength);
        }
        return ok(this._view.getInt16(off, le));
    }

    public readUint32(offset: ByteOffset, le: boolean = true): Result<number, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 4 > (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 4, this.byteLength);
        }
        return ok(this._view.getUint32(off, le));
    }

    public readInt32(offset: ByteOffset, le: boolean = true): Result<number, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 4 > (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 4, this.byteLength);
        }
        return ok(this._view.getInt32(off, le));
    }

    public readFloat32(offset: ByteOffset, le: boolean = true): Result<number, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 4 > (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 4, this.byteLength);
        }
        return ok(this._view.getFloat32(off, le));
    }

    public readFloat64(offset: ByteOffset, le: boolean = true): Result<number, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 8 > (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 8, this.byteLength);
        }
        return ok(this._view.getFloat64(off, le));
    }

    public readBigUint64(offset: ByteOffset, le: boolean = true): Result<bigint, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 8 > (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 8, this.byteLength);
        }
        return ok(this._view.getBigUint64(off, le));
    }

    public readBigInt64(offset: ByteOffset, le: boolean = true): Result<bigint, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 8 > (this.byteLength >>> 0) || (this._flags & FLAG_DISPOSED) !== 0) {
            return (this._flags & FLAG_DISPOSED) !== 0
                ? ERR_DISPOSED
                : coldOutOfBounds(off, 8, this.byteLength);
        }
        return ok(this._view.getBigInt64(off, le));
    }

    public readVarUint32(
        offset: ByteOffset
    ): Result<{ readonly value: number; readonly bytesRead: number }, MemoryError> {
        if ((this._flags & FLAG_DISPOSED) !== 0) return ERR_DISPOSED;
        let off = offset | 0;
        const limit = this.byteLength | 0;
        let result = 0;
        let shift = 0;
        let bytesRead = 0;

        while (shift < 35) {
            if ((off >>> 0) >= (limit >>> 0)) {
                return coldOutOfBounds(off, 1, limit);
            }
            const byte = this._u8[off]!;
            off = (off + 1) | 0;
            bytesRead = (bytesRead + 1) | 0;
            result = (result | ((byte & 0x7f) << shift)) >>> 0;
            if ((byte & 0x80) === 0) {
                return ok({ value: result, bytesRead });
            }
            shift = (shift + 7) | 0;
        }

        return coldVarIntOverflow(offset | 0, bytesRead, limit);
    }

    public readUtf8(offset: ByteOffset, length: ByteLength): Result<string, MemoryError> {
        if ((this._flags & FLAG_DISPOSED) !== 0) return ERR_DISPOSED;
        const off = offset | 0;
        const len = length | 0;
        const chunkLen = this.byteLength | 0;

        if (off < 0 || len < 0 || off + len > chunkLen) {
            return coldOutOfBounds(off, len, chunkLen);
        }

        return safeDecodeUtf8(this._u8.subarray(off, (off + len) | 0), off, len, chunkLen);
    }

    public writeUint8(this: ByteChunk<'MUT', any>, offset: ByteOffset, value: number): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) >= (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 1, this.byteLength);
        }
        this._u8[off] = value;
        return VOID_OK;
    }

    public writeInt8(this: ByteChunk<'MUT', any>, offset: ByteOffset, value: number): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) >= (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 1, this.byteLength);
        }
        this._u8[off] = value;
        return VOID_OK;
    }

    public writeUint16(
        this: ByteChunk<'MUT', any>,
        offset: ByteOffset,
        value: number,
        le: boolean = true
    ): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 2 > (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 2, this.byteLength);
        }
        this._view.setUint16(off, value, le);
        return VOID_OK;
    }

    public writeInt16(
        this: ByteChunk<'MUT', any>,
        offset: ByteOffset,
        value: number,
        le: boolean = true
    ): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 2 > (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 2, this.byteLength);
        }
        this._view.setInt16(off, value, le);
        return VOID_OK;
    }

    public writeUint32(
        this: ByteChunk<'MUT', any>,
        offset: ByteOffset,
        value: number,
        le: boolean = true
    ): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 4 > (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 4, this.byteLength);
        }
        this._view.setUint32(off, value, le);
        return VOID_OK;
    }

    public writeInt32(
        this: ByteChunk<'MUT', any>,
        offset: ByteOffset,
        value: number,
        le: boolean = true
    ): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 4 > (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 4, this.byteLength);
        }
        this._view.setInt32(off, value, le);
        return VOID_OK;
    }

    public writeFloat32(
        this: ByteChunk<'MUT', any>,
        offset: ByteOffset,
        value: number,
        le: boolean = true
    ): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 4 > (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 4, this.byteLength);
        }
        this._view.setFloat32(off, value, le);
        return VOID_OK;
    }

    public writeFloat64(
        this: ByteChunk<'MUT', any>,
        offset: ByteOffset,
        value: number,
        le: boolean = true
    ): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 8 > (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 8, this.byteLength);
        }
        this._view.setFloat64(off, value, le);
        return VOID_OK;
    }

    public writeBigUint64(
        this: ByteChunk<'MUT', any>,
        offset: ByteOffset,
        value: bigint,
        le: boolean = true
    ): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 8 > (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 8, this.byteLength);
        }
        this._view.setBigUint64(off, value, le);
        return VOID_OK;
    }

    public writeBigInt64(
        this: ByteChunk<'MUT', any>,
        offset: ByteOffset,
        value: bigint,
        le: boolean = true
    ): Result<void, MemoryError> {
        const off = offset | 0;
        if ((off >>> 0) + 8 > (this.byteLength >>> 0) || this._flags !== 0) {
            return this._flags !== 0 ? this._coldWriteCheck() : coldOutOfBounds(off, 8, this.byteLength);
        }
        this._view.setBigInt64(off, value, le);
        return VOID_OK;
    }

    public writeVarUint32(
        this: ByteChunk<'MUT', any>,
        offset: ByteOffset,
        value: number
    ): Result<number, MemoryError> {
        if (this._flags !== 0) return this._coldWriteCheck();
        let off = offset | 0;
        let v = value >>> 0;
        let bytesWritten = 0;
        const limit = this.byteLength | 0;

        while (v >= 0x80) {
            if ((off >>> 0) >= (limit >>> 0)) {
                return coldOutOfBounds(off, 1, limit);
            }
            this._u8[off] = (v & 0x7f) | 0x80;
            off = (off + 1) | 0;
            bytesWritten = (bytesWritten + 1) | 0;
            v >>>= 7;
        }

        if ((off >>> 0) >= (limit >>> 0)) {
            return coldOutOfBounds(off, 1, limit);
        }
        this._u8[off] = v & 0x7f;
        bytesWritten = (bytesWritten + 1) | 0;

        return ok(bytesWritten);
    }

    public writeUtf8(this: ByteChunk<'MUT', any>, offset: ByteOffset, text: string): Result<number, MemoryError> {
        if (this._flags !== 0) return this._coldWriteCheck();
        const off = offset | 0;
        const chunkLen = this.byteLength | 0;
        if ((off >>> 0) >= (chunkLen >>> 0)) {
            return coldOutOfBounds(off, 0, chunkLen);
        }

        const dest = this._u8.subarray(off);
        const encodeResult = TEXT_ENCODER.encodeInto(text, dest);
        return ok(encodeResult.written ?? 0);
    }

    public copyTo(
        target: Uint8Array,
        sourceOffset: ByteOffset = ByteOffset(0),
        length?: ByteLength
    ): Result<number, MemoryError> {
        if ((this._flags & FLAG_DISPOSED) !== 0) return ERR_DISPOSED;
        const srcOff = sourceOffset | 0;
        const chunkLen = this.byteLength | 0;

        if (srcOff < 0 || srcOff > chunkLen) {
            return coldOutOfBounds(srcOff, 0, chunkLen);
        }

        const maxAvailable = (chunkLen - srcOff) | 0;
        const requested = length === undefined ? maxAvailable : length | 0;
        if (requested < 0) {
            return coldOutOfBounds(srcOff, requested, chunkLen);
        }

        const targetCap = target.byteLength | 0;
        const count = requested < targetCap ? requested : targetCap;
        const finalCount = count < maxAvailable ? count : maxAvailable;

        if (finalCount > 0) {
            target.set(this._u8.subarray(srcOff, (srcOff + finalCount) | 0), 0);
        }
        return ok(finalCount);
    }

    public copyFrom(
        this: ByteChunk<'MUT', any>,
        source: Uint8Array,
        targetOffset: ByteOffset = ByteOffset(0)
    ): Result<number, MemoryError> {
        if (this._flags !== 0) return this._coldWriteCheck();
        const off = targetOffset | 0;
        const srcLen = source.byteLength | 0;
        const chunkLen = this.byteLength | 0;

        if (off < 0 || srcLen < 0 || off + srcLen > chunkLen) {
            return coldOutOfBounds(off, srcLen, chunkLen);
        }

        this._u8.set(source, off);
        return ok(srcLen);
    }

    public fill(
        this: ByteChunk<'MUT', any>,
        value: number,
        offset: ByteOffset = ByteOffset(0),
        length?: NoInfer<ByteLength>
    ): Result<void, MemoryError> {
        if (this._flags !== 0) return this._coldWriteCheck();
        const s = offset | 0;
        const chunkLen = this.byteLength | 0;

        if ((s >>> 0) > (chunkLen >>> 0)) {
            return coldOutOfBounds(s, 0, chunkLen);
        }

        const available = (chunkLen - s) | 0;
        const l = length === undefined ? available : length | 0;

        if (l < 0 || s + l > chunkLen) {
            return coldOutOfBounds(s, l, chunkLen);
        }

        this._u8.fill(value & 0xff, s, (s + l) | 0);
        return VOID_OK;
    }

    public readStructField(
        layout: readonly (readonly [string, PrimitiveType])[],
        name: string,
        baseOffset: ByteOffset = ByteOffset(0)
    ): Result<number | bigint, MemoryError> {
        const meta = getOrComputeFieldMeta(layout, name);
        if (meta === null) {
            return coldOutOfBounds(baseOffset, 0, this.byteLength);
        }

        const targetOffset = ByteOffset((baseOffset | 0) + meta.offset);

        switch (meta.type) {
            case 'u8':
                return this.readUint8(targetOffset);
            case 'i8':
                return this.readInt8(targetOffset);
            case 'u16':
                return this.readUint16(targetOffset);
            case 'i16':
                return this.readInt16(targetOffset);
            case 'u32':
                return this.readUint32(targetOffset);
            case 'i32':
                return this.readInt32(targetOffset);
            case 'f32':
                return this.readFloat32(targetOffset);
            case 'f64':
                return this.readFloat64(targetOffset);
            case 'u64':
                return this.readBigUint64(targetOffset);
            case 'i64':
                return this.readBigInt64(targetOffset);
            default:
                return assertNever(meta.type);
        }
    }

    public writeStructField(
        this: ByteChunk<'MUT', any>,
        layout: readonly (readonly [string, PrimitiveType])[],
        name: string,
        value: number | bigint,
        baseOffset: ByteOffset = ByteOffset(0)
    ): Result<void, MemoryError> {
        const meta = getOrComputeFieldMeta(layout, name);
        if (meta === null) {
            return coldOutOfBounds(baseOffset, 0, this.byteLength);
        }

        const targetOffset = ByteOffset((baseOffset | 0) + meta.offset);

        switch (meta.type) {
            case 'u8':
                return this.writeUint8(targetOffset, value as number);
            case 'i8':
                return this.writeInt8(targetOffset, value as number);
            case 'u16':
                return this.writeUint16(targetOffset, value as number);
            case 'i16':
                return this.writeInt16(targetOffset, value as number);
            case 'u32':
                return this.writeUint32(targetOffset, value as number);
            case 'i32':
                return this.writeInt32(targetOffset, value as number);
            case 'f32':
                return this.writeFloat32(targetOffset, value as number);
            case 'f64':
                return this.writeFloat64(targetOffset, value as number);
            case 'u64':
                return this.writeBigUint64(targetOffset, value as bigint);
            case 'i64':
                return this.writeBigInt64(targetOffset, value as bigint);
            default:
                return assertNever(meta.type);
        }
    }

    public slice(offset: ByteOffset, length: ByteLength): Result<ByteChunk<M, 'BORROWED'>, MemoryError> {
        if ((this._flags & FLAG_DISPOSED) !== 0) return ERR_DISPOSED;
        const off = offset | 0;
        const len = length | 0;
        const parentLen = this.byteLength | 0;

        if (off < 0 || len < 0 || off + len > parentLen) {
            return coldOutOfBounds(off, len, parentLen);
        }

        this._refCount = (this._refCount + 1) | 0;
        this._metrics?.emit({ kind: 'retain', id: this.id, count: this._refCount, epoch: this._epoch });

        const subChunk = new ByteChunk<M, 'BORROWED'>(
            ChunkId(`${this.id}#${off}:${len}`),
            this.buffer,
            ByteOffset((this.byteOffset | 0) + off),
            ByteLength(len),
            this._mutability,
            this,
            this._metrics,
            null,
            0
        );

        this._metrics?.emit({ kind: 'slice', id: subChunk.id, bytes: len, epoch: 1 });
        return ok(subChunk);
    }

    public acquireLease(): Result<ByteChunkLease<M, O>, MemoryError> {
        if ((this._flags & FLAG_DISPOSED) !== 0) return ERR_DISPOSED;

        this._refCount = (this._refCount + 1) | 0;
        this._metrics?.emit({ kind: 'retain', id: this.id, count: this._refCount, epoch: this._epoch });

        let returned = false;
        const lease = new ByteChunkLease<M, O>(this, () => {
            if (!returned) {
                returned = true;
                this._releaseInternal(this._epoch);
            }
        });

        return ok(lease);
    }

    private _releaseInternal(epoch: number = this._epoch): void {
        if (this._refCount > 0) {
            this._refCount = (this._refCount - 1) | 0;
            this._metrics?.emit({ kind: 'release', id: this.id, count: this._refCount, epoch });

            if (this._refCount <= 1 && this._drainWaiters !== null) {
                const waiters = this._drainWaiters;
                this._drainWaiters = null;
                for (const cb of waiters) cb();
            }
        }
    }

    public async drain(signal?: AbortSignal): Promise<Result<void, MemoryError>> {
        if ((this._flags & FLAG_DISPOSED) !== 0) return VOID_OK;
        if (signal?.aborted) return coldAborted(signal.reason);

        if (this._refCount <= 1) {
            this.dispose();
            return VOID_OK;
        }

        return new Promise<Result<void, MemoryError>>((resolve) => {
            const onAbort = (): void => {
                detach();
                resolve(coldAborted(signal?.reason));
            };
            const onDrained = (): void => {
                detach();
                this.dispose();
                resolve(VOID_OK);
            };
            const detach = (): void => {
                signal?.removeEventListener('abort', onAbort);
                if (this._drainWaiters !== null) {
                    this._drainWaiters.delete(onDrained);
                }
            };

            signal?.addEventListener('abort', onAbort, { once: true });
            if (this._drainWaiters === null) this._drainWaiters = new Set();
            this._drainWaiters.add(onDrained);
        });
    }

    public close(error?: Error): Result<void, MemoryError> {
        if ((this._flags & FLAG_DISPOSED) !== 0) return VOID_OK;
        if (this._refCount > 1) {
            return err({
                code: MemoryErrorCode.ACTIVE_LEASES,
                message: error ? error.message : 'Active leases or borrowed slices prevent synchronous closure',
                offset: 0,
                required: this._refCount,
                limit: 1,
            });
        }
        this.dispose();
        return VOID_OK;
    }

    public dispose(): void {
        if ((this._flags & FLAG_DISPOSED) === 0) {
            const lifeEpoch = this._epoch;
            this._flags |= FLAG_DISPOSED;
            this._epoch = (this._epoch + 1) >>> 0;
            this._metrics?.emit({ kind: 'free', id: this.id, epoch: lifeEpoch });

            const p = this._parent;
            if (p !== null) {
                this._parent = null;
                p._releaseInternal(p._epoch);
            }

            this._releaseInternal(lifeEpoch);

            if (this._drainWaiters !== null) {
                const waiters = this._drainWaiters;
                this._drainWaiters = null;
                for (const cb of waiters) cb();
            }

            if (this._recycler !== null) {
                this._recycler.recycle(this);
            }
        }
    }

    public [Symbol.dispose](): void {
        this.dispose();
    }

    public async [Symbol.asyncDispose](): Promise<void> {
        await this.drain();
    }
}

interface ParsedField {
    readonly offset: number;
    readonly type: PrimitiveType;
}

const STRUCT_METADATA_CACHE = new WeakMap<object, Map<string, ParsedField>>();

function getOrComputeFieldMeta(
    layout: readonly (readonly [string, PrimitiveType])[],
    fieldName: string
): ParsedField | null {
    let map = STRUCT_METADATA_CACHE.get(layout);
    if (map === undefined) {
        map = new Map<string, ParsedField>();
        let offsetAcc = 0;
        const len = layout.length | 0;
        for (let i = 0; i < len; i = (i + 1) | 0) {
            const field = layout[i];
            if (!field) break;
            map.set(field[0], { offset: offsetAcc, type: field[1] });
            offsetAcc = (offsetAcc + primitiveByteSize(field[1])) | 0;
        }
        STRUCT_METADATA_CACHE.set(layout, map);
    }
    return map.get(fieldName) ?? null;
}

interface ChunkInternals {
    _mutability: Mutability;
    _flags: number;
    _refCount: number;
    _epoch: number;
    _parent: ByteChunk<Mutability, Ownership> | null;
    _drainWaiters: Set<() => void> | null;
    _recycler: IChunkPoolRecycler | null;
    _poolTag: number;
}

function friendReinitializeChunk<M extends Mutability>(chunk: ByteChunk<any, any>, mutability: M): void {
    const internals = chunk as unknown as ChunkInternals;
    internals._mutability = mutability;
    internals._flags = mutability === 'IMMUT' ? FLAG_IMMUTABLE : FLAG_ACTIVE;
    internals._refCount = 1;
    internals._epoch = (internals._epoch + 1) >>> 0;
    internals._parent = null;
    internals._drainWaiters = null;
}

function friendAttachRecycler(
    chunk: ByteChunk<any, any>,
    recycler: IChunkPoolRecycler | null,
    poolTag: number
): void {
    const internals = chunk as unknown as ChunkInternals;
    internals._recycler = recycler;
    internals._poolTag = poolTag;
}

export class ByteCursor implements Disposable {
    private readonly _chunk: ByteChunk<any, any>;
    private readonly _u8: Uint8Array;
    private readonly _view: DataView;
    private readonly _limit: number;
    private readonly _epoch: number;
    private _pos: number;

    public constructor(chunk: ByteChunk<any, any>, initialOffset: ByteOffset = ByteOffset(0)) {
        this._chunk = chunk;
        this._u8 = chunk._u8;
        this._view = chunk._view;
        this._limit = chunk.byteLength | 0;
        this._epoch = chunk.epoch;
        this._pos = initialOffset | 0;
    }

    private _assertActive(): void {
        if (this._epoch !== this._chunk.epoch || this._chunk.isDisposed) {
            throw new Error('Use-after-free: ByteCursor invoked on recycled or disposed ByteChunk');
        }
    }

    public get position(): ByteOffset {
        return ByteOffset(this._pos);
    }

    public get remaining(): number {
        return (this._limit - this._pos) | 0;
    }

    public seek(offset: ByteOffset): void {
        this._assertActive();
        const p = offset | 0;
        if (p < 0 || p > this._limit) throw new RangeError('Seek offset out of bounded range');
        this._pos = p;
    }

    public readUint8(): number {
        this._assertActive();
        if (this._pos >= this._limit) throw new RangeError('Unexpected EOF reading uint8');
        return this._u8[this._pos++]!;
    }

    public writeUint8(value: number): void {
        this._assertActive();
        if (this._pos >= this._limit) throw new RangeError('Unexpected EOF writing uint8');
        this._u8[this._pos++] = value;
    }

    public readUint32(le: boolean = true): number {
        this._assertActive();
        const p = this._pos | 0;
        if (p + 4 > this._limit) throw new RangeError('Unexpected EOF reading uint32');
        const val = this._view.getUint32(p, le);
        this._pos = (p + 4) | 0;
        return val;
    }

    public writeUint32(value: number, le: boolean = true): void {
        this._assertActive();
        const p = this._pos | 0;
        if (p + 4 > this._limit) throw new RangeError('Unexpected EOF writing uint32');
        this._view.setUint32(p, value, le);
        this._pos = (p + 4) | 0;
    }

    public readVarUint32(): number {
        this._assertActive();
        let pos = this._pos | 0;
        const limit = this._limit | 0;
        const u8 = this._u8;
        let result = 0;
        let shift = 0;

        while (shift < 35) {
            if (pos >= limit) {
                this._pos = pos;
                throw new RangeError('Unexpected EOF decoding varint32');
            }
            const byte = u8[pos++]!;
            result = (result | ((byte & 0x7f) << shift)) >>> 0;
            if ((byte & 0x80) === 0) {
                this._pos = pos;
                return result;
            }
            shift = (shift + 7) | 0;
        }

        this._pos = pos;
        throw new RangeError('Malformed LEB128 varint32 sequence exceeds 5 bytes');
    }

    public writeVarUint32(value: number): number {
        this._assertActive();
        let pos = this._pos | 0;
        const limit = this._limit | 0;
        const u8 = this._u8;
        let v = value >>> 0;
        const start = pos;

        while (v >= 0x80) {
            if (pos >= limit) {
                this._pos = pos;
                throw new RangeError('Unexpected EOF encoding varint32');
            }
            u8[pos++] = (v & 0x7f) | 0x80;
            v >>>= 7;
        }

        if (pos >= limit) {
            this._pos = pos;
            throw new RangeError('Unexpected EOF encoding varint32');
        }
        u8[pos++] = v & 0x7f;
        this._pos = pos;
        return (pos - start) | 0;
    }

    public [Symbol.dispose](): void {
        this._pos = this._limit;
    }
}


export interface ByteChunkPoolOptions {
    readonly chunkSize?: number | undefined;
    readonly maxIdle?: number | undefined;
    readonly maxTotal?: number | undefined;
    readonly preallocate?: number | undefined;
    readonly clearOnRelease?: boolean | undefined;
    readonly ttl?: number | undefined;
    readonly validator?: ((chunk: ByteChunk<'MUT', 'OWNED'>) => boolean) | null;
    readonly onAcquire?: ((chunk: ByteChunk<'MUT', 'OWNED'>) => void) | null;
    readonly onRelease?: ((chunk: ByteChunk<'MUT', 'OWNED'>) => void) | null;
    readonly onEvict?: ((chunk: ByteChunk<'MUT', 'OWNED'>) => void) | null;
    readonly metrics?: IMetricsSink<ChunkLifecycleEvent> | undefined;
}

export class ByteChunkPoolExhaustedError extends Error {
    constructor(limit: number) {
        super(`ByteChunkPool exhausted: ${limit} chunks already created`);
        this.name = 'ByteChunkPoolExhaustedError';
    }
}

let nextPoolTag = 1;

export class ByteChunkPool implements IChunkPoolRecycler {
    private readonly _chunkSize: number;
    private readonly _maxIdle: number;
    private _maxTotal: number;
    private readonly _clearOnRelease: boolean;
    private readonly _ttl: number;
    private readonly _validator: ((chunk: ByteChunk<'MUT', 'OWNED'>) => boolean) | null;
    private readonly _onAcquire: ((chunk: ByteChunk<'MUT', 'OWNED'>) => void) | null;
    private readonly _onRelease: ((chunk: ByteChunk<'MUT', 'OWNED'>) => void) | null;
    private readonly _onEvict: ((chunk: ByteChunk<'MUT', 'OWNED'>) => void) | null;
    private readonly _metrics: IMetricsSink<ChunkLifecycleEvent> | null;
    private readonly _idleStack: ByteChunk<'MUT', 'OWNED'>[] = [];
    private readonly _idleSince: number[] = [];
    private readonly _poolTag: number;
    private _totalCreated = 0;
    private _activeAllocated = 0;
    private _allocations = 0;
    private _releases = 0;
    private _hits = 0;
    private _evictions = 0;
    private _isDisposed = false;

    public constructor(options: ByteChunkPoolOptions = {}) {
        this._chunkSize = (options.chunkSize ?? 512) | 0;
        this._maxIdle = options.maxIdle ?? 1024;
        this._maxTotal = options.maxTotal ?? Number.POSITIVE_INFINITY;
        this._clearOnRelease = options.clearOnRelease ?? false;
        this._ttl = options.ttl ?? 0;
        this._validator = options.validator ?? null;
        this._onAcquire = options.onAcquire ?? null;
        this._onRelease = options.onRelease ?? null;
        this._onEvict = options.onEvict ?? null;
        this._metrics = options.metrics ?? null;
        this._poolTag = (nextPoolTag = (nextPoolTag + 1) >>> 0);

        const preallocate = Math.min(
            options.preallocate ?? 0,
            this._maxIdle,
            this._maxTotal,
            this._chunkSize <= 1 << 20 ? Number.MAX_SAFE_INTEGER : 0
        );
        const now = Date.now();
        for (let i = 0; i < preallocate; i++) {
            this._idleStack.push(ByteChunk.allocate({ capacity: this._chunkSize, mutability: 'MUT' }));
            this._idleSince.push(now);
            this._totalCreated = (this._totalCreated + 1) >>> 0;
        }
    }

    public acquire(): ByteChunk<'MUT', 'OWNED'> {
        if (this._isDisposed) {
            throw new Error('Cannot acquire from disposed ByteChunkPool');
        }

        const cached = this._takeIdle();
        if (cached !== null) {
            this._allocations = (this._allocations + 1) >>> 0;
            this._hits = (this._hits + 1) >>> 0;
            this._activate(cached);
            return cached;
        }

        if (this._totalCreated >= this._maxTotal) {
            throw new ByteChunkPoolExhaustedError(this._maxTotal);
        }

        this._allocations = (this._allocations + 1) >>> 0;
        const chunk = ByteChunk.allocate({ capacity: this._chunkSize, mutability: 'MUT' });
        this._totalCreated = (this._totalCreated + 1) >>> 0;
        this._activate(chunk, true);
        return chunk;
    }

    public tryAcquire(): ByteChunk<'MUT', 'OWNED'> | null {
        if (this._isDisposed) {
            return null;
        }

        const cached = this._takeIdle();
        if (cached === null) {
            return null;
        }

        this._allocations = (this._allocations + 1) >>> 0;
        this._hits = (this._hits + 1) >>> 0;
        this._activate(cached);
        return cached;
    }

    public release(chunk: ByteChunk<any, any>): void {
        if (this._isDisposed) return;

        const internals = chunk as unknown as ChunkInternals;
        if (internals._poolTag !== this._poolTag || chunk.byteLength !== this._chunkSize || chunk.isSlice) {
            return;
        }

        // Idempotence guard: a second release no longer matches the pool tag.
        internals._poolTag = 0;
        this._activeAllocated = (this._activeAllocated - 1) >>> 0;
        this._releases = (this._releases + 1) >>> 0;
        this._onRelease?.(chunk as ByteChunk<'MUT', 'OWNED'>);

        if (this._idleStack.length >= this._maxIdle) {
            this._evictions = (this._evictions + 1) >>> 0;
            this._onEvict?.(chunk as ByteChunk<'MUT', 'OWNED'>);
            return;
        }

        if (this._clearOnRelease) {
            chunk._u8.fill(0);
        }

        this._idleStack.push(chunk as ByteChunk<'MUT', 'OWNED'>);
        this._idleSince.push(Date.now());
    }

    public recycle(chunk: ByteChunk<any, any>): void {
        this.release(chunk);
    }

    public getAvailableCount(): number {
        return this._idleStack.length;
    }

    public getAllocatedCount(): number {
        return this._activeAllocated;
    }

    public getTotalCount(): number {
        return this._totalCreated;
    }

    public getAllocations(): number {
        return this._allocations;
    }

    public getReleases(): number {
        return this._releases;
    }

    public getHits(): number {
        return this._hits;
    }

    public getEvictions(): number {
        return this._evictions;
    }

    public getHitRatio(): number {
        return this._allocations > 0 ? this._hits / this._allocations : 0;
    }

    public resize(maxTotal: number): void {
        this._maxTotal = Math.max(0, maxTotal);
    }

    public clear(): void {
        while (this._idleStack.length > 0) {
            const chunk = this._idleStack.pop()!;
            this._idleSince.pop();
            this._evictions = (this._evictions + 1) >>> 0;
            this._onEvict?.(chunk);
        }
    }

    public [Symbol.dispose](): void {
        if (!this._isDisposed) {
            this._isDisposed = true;
            this.clear();
        }
    }

    private _takeIdle(): ByteChunk<'MUT', 'OWNED'> | null {
        const now = Date.now();

        while (this._idleStack.length > 0) {
            const chunk = this._idleStack.pop()!;
            const since = this._idleSince.pop()!;

            if (this._ttl > 0 && now - since > this._ttl) {
                this._evictions = (this._evictions + 1) >>> 0;
                this._onEvict?.(chunk);
                continue;
            }

            if (this._validator !== null && !this._validator(chunk)) {
                this._evictions = (this._evictions + 1) >>> 0;
                this._onEvict?.(chunk);
                continue;
            }

            return chunk;
        }

        return null;
    }

    private _activate(chunk: ByteChunk<'MUT', 'OWNED'>, attached = false): void {
        this._activeAllocated = (this._activeAllocated + 1) >>> 0;
        friendReinitializeChunk(chunk, 'MUT');
        if (!attached) {
            friendAttachRecycler(chunk, this, this._poolTag);
        } else {
            friendAttachRecycler(chunk, this, this._poolTag);
        }
        if (this._metrics !== null) {
            this._metrics.emit({ kind: 'retain', id: chunk.id, count: 1, epoch: chunk.epoch });
        }
        this._onAcquire?.(chunk);
    }
}

const MIN_CHUNK_BUCKET = 32;
const MAX_POOLED_BUCKET = 1 << 30;

export interface ByteChunkPoolSetOptions {
    /** Zero buffers on release. Default true to match BufferPool semantics. */
    readonly clearOnRelease?: boolean;
    /** Maximum idle chunks retained per size bucket. */
    readonly maxIdlePerBucket?: number;
    /** Maximum concurrently checked-out chunks per size bucket. */
    readonly maxTotalPerBucket?: number;
}

/**
 * Power-of-two bucket set of ByteChunkPool instances. This is the backing pool
 * for ByteBuffer: allocate() returns a pooled ArrayBuffer, release() returns it.
 */
export class ByteChunkPoolSet implements Disposable {
    private static _instance: ByteChunkPoolSet | undefined;

    private readonly _pools = new Map<number, ByteChunkPool>();
    private _chunkByBuffer = new WeakMap<ArrayBuffer, ByteChunk<'MUT', 'OWNED'>>();
    private readonly _clearOnRelease: boolean;
    private readonly _maxIdlePerBucket: number;
    private readonly _maxTotalPerBucket: number;
    private _isDisposed = false;

    public constructor(options: ByteChunkPoolSetOptions = {}) {
        this._clearOnRelease = options.clearOnRelease ?? true;
        this._maxIdlePerBucket = options.maxIdlePerBucket ?? 256;
        this._maxTotalPerBucket = options.maxTotalPerBucket ?? 1024;
    }

    public static getInstance(): ByteChunkPoolSet {
        if (ByteChunkPoolSet._instance === undefined) {
            ByteChunkPoolSet._instance = new ByteChunkPoolSet();
        }
        return ByteChunkPoolSet._instance;
    }

    public static resetInstance(): void {
        if (ByteChunkPoolSet._instance !== undefined) {
            ByteChunkPoolSet._instance[Symbol.dispose]();
            ByteChunkPoolSet._instance = undefined;
        }
    }

    public acquireChunk(requestedSize: number): ByteChunk<'MUT', 'OWNED'> {
        if (requestedSize <= 0) {
            throw new Error('Requested size must be positive');
        }

        if (requestedSize > MAX_POOLED_BUCKET) {
            return ByteChunk.allocate({ capacity: requestedSize, mutability: 'MUT' });
        }

        const bucket = bucketSizeFor(requestedSize);
        const pool = this._poolFor(bucket);

        // Bounded pool: beyond the per-bucket limit, hand out an unpooled chunk.
        if (pool.getAllocatedCount() >= this._maxTotalPerBucket && pool.getAvailableCount() === 0) {
            return ByteChunk.allocate({ capacity: bucket, mutability: 'MUT' });
        }

        return pool.acquire();
    }

    public allocate(requestedSize: number): ArrayBuffer {
        if (requestedSize <= 0) {
            throw new Error('Requested size must be positive');
        }

        if (requestedSize > MAX_POOLED_BUCKET) {
            return new ArrayBuffer(requestedSize);
        }

        const bucket = bucketSizeFor(requestedSize);
        const chunk = this._poolFor(bucket).acquire();
        this._chunkByBuffer.set(chunk.buffer, chunk);
        return chunk.buffer;
    }

    public tryAllocate(requestedSize: number): ArrayBuffer | null {
        if (requestedSize <= 0 || requestedSize > MAX_POOLED_BUCKET) {
            return null;
        }

        const bucket = bucketSizeFor(requestedSize);
        const chunk = this._poolFor(bucket).tryAcquire();
        if (chunk === null) {
            return null;
        }

        this._chunkByBuffer.set(chunk.buffer, chunk);
        return chunk.buffer;
    }

    public release(buffer: ArrayBuffer): void {
        const chunk = this._chunkByBuffer.get(buffer);
        if (chunk === undefined) {
            return;
        }

        this._chunkByBuffer.delete(buffer);
        chunk.dispose();
    }

    public clear(): void {
        for (const pool of this._pools.values()) {
            pool.clear();
        }
    }

    public getAvailableCount(): number {
        let total = 0;
        for (const pool of this._pools.values()) {
            total += pool.getAvailableCount();
        }
        return total;
    }

    public getTotalCount(): number {
        let total = 0;
        for (const pool of this._pools.values()) {
            total += pool.getTotalCount();
        }
        return total;
    }

    public [Symbol.dispose](): void {
        if (this._isDisposed) {
            return;
        }
        this._isDisposed = true;
        for (const pool of this._pools.values()) {
            pool[Symbol.dispose]();
        }
        this._pools.clear();
        this._chunkByBuffer = new WeakMap();
    }

    private _poolFor(bucket: number): ByteChunkPool {
        let pool = this._pools.get(bucket);
        if (pool === undefined) {
            pool = new ByteChunkPool({
                chunkSize: bucket,
                maxIdle: this._maxIdlePerBucket,
                clearOnRelease: this._clearOnRelease,
            });
            this._pools.set(bucket, pool);
        }
        return pool;
    }
}

function bucketSizeFor(requestedSize: number): number {
    let bucket = MIN_CHUNK_BUCKET;
    while (bucket < requestedSize) {
        bucket *= 2;
    }
    return Math.min(bucket, MAX_POOLED_BUCKET);
}


