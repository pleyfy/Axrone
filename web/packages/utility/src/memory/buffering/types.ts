export const enum ByteOrder {
    Little,
    Big,
}

export const enum SeekOrigin {
    Begin,
    Current,
    End,
}

export const enum Endianness {
    Little = 0,
    Big = 1,
}

export const enum BufferState {
    Allocate,
    Empty,
    Reading,
    Writing,
    Released,
}

export type Nullable<T> = T | null;

export type TypedArrayMap = {
    int8: Int8Array;
    uint8: Uint8Array;
    int16: Int16Array;
    uint16: Uint16Array;
    int32: Int32Array;
    uint32: Uint32Array;
    float32: Float32Array;
    float64: Float64Array;
    bigint64: BigInt64Array;
    biguint64: BigUint64Array;
};

export type PrimitiveTypeMap = {
    int8: number;
    uint8: number;
    int16: number;
    uint16: number;
    int32: number;
    uint32: number;
    float32: number;
    float64: number;
    bigint64: bigint;
    biguint64: bigint;
};

export type TypedArrayConstructorMap = {
    [K in keyof TypedArrayMap]: {
        new (buffer: ArrayBuffer, byteOffset?: number, length?: number): TypedArrayMap[K];
    };
};
