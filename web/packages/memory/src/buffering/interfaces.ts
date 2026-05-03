import { ByteOrder } from './types';

export interface IReadableBuffer {
    readonly capacity: number;
    readonly position: number;
    readonly remaining: number;
    readonly order: ByteOrder;
    readonly hasRemaining: boolean;
    readonly limit: number;
    readonly isReadOnly: boolean;

    getInt8(): number;
    getUint8(): number;
    getInt16(): number;
    getUint16(): number;
    getInt32(): number;
    getUint32(): number;
    getFloat32(): number;
    getFloat64(): number;
    getBigInt64(): bigint;
    getBigUint64(): bigint;
    getString(): string;
    slice(begin?: number, end?: number): IReadableBuffer;
}

export interface IWritableBuffer extends IReadableBuffer {
    putInt8(value: number): this;
    putUint8(value: number): this;
    putInt16(value: number): this;
    putUint16(value: number): this;
    putInt32(value: number): this;
    putUint32(value: number): this;
    putFloat32(value: number): this;
    putFloat64(value: number): this;
    putBigInt64(value: bigint): this;
    putBigUint64(value: bigint): this;
    putString(str: string, encoding?: string): this;
    put(source: any | Uint8Array | number[], sourceOffset?: number, length?: number): this;
}

export interface IByteBuffer extends IWritableBuffer {
    clear(): this;
    flip(): this;
    rewind(): this;
    reset(): this;
    mark(): this;
    compact(): this;
    duplicate(): IByteBuffer;
    asReadOnlyBuffer(): IReadableBuffer;
    seek(offset: number, origin?: any): this;
}
