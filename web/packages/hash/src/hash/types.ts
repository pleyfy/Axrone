import type { BytesLike, Int64, UInt64 } from '../types';

declare const __hash32: unique symbol;
declare const __hash64: unique symbol;
declare const __hash128: unique symbol;
declare const __hash256: unique symbol;
declare const __hash512: unique symbol;
declare const __seed32: unique symbol;
declare const __seed64: unique symbol;
declare const __digest32: unique symbol;
declare const __digest64: unique symbol;
declare const __digest128: unique symbol;
declare const __hashBytes: unique symbol;

export type Hash32 = number & { readonly [__hash32]: true };
export type Hash64 = UInt64 & { readonly [__hash64]: true };
export type Hash128 = bigint & { readonly [__hash128]: true };
export type Hash256 = bigint & { readonly [__hash256]: true };
export type Hash512 = bigint & { readonly [__hash512]: true };

export type Seed32 = number & { readonly [__seed32]: true };
export type Seed64 = UInt64 & { readonly [__seed64]: true };

export type Digest32 = number & { readonly [__digest32]: true };
export type Digest64 = UInt64 & { readonly [__digest64]: true };
export type Digest128 = Int64 & { readonly [__digest128]: true };

export type HashValue = Hash32 | Hash64 | Hash128 | Hash256 | Hash512;
export type DigestValue = Digest32 | Digest64 | Digest128;
export type SeedValue = Seed32 | Seed64;

export type HashBytes = BytesLike & { readonly [__hashBytes]: true };

export type HashSize = 32 | 64 | 128 | 160 | 256 | 384 | 512;
export type HashCategory = 'non-crypto' | 'crypto' | 'checksum' | 'universal';

export type HashAlgorithmName =
    | 'fnv1a-32'
    | 'fnv1a-64'
    | 'fnv1-32'
    | 'djb2'
    | 'djb2a'
    | 'sdbm'
    | 'crc32'
    | 'crc32c'
    | 'murmur3-32'
    | 'murmur2-64'
    | 'xxhash32'
    | 'xxhash64'
    | 'sha-1'
    | 'sha-256'
    | 'sha-384'
    | 'sha-512';

export type HashAlgorithmFamily = 'fast' | 'cryptographic' | 'universal' | 'checksum' | 'keyed';

export interface HashAlgorithmMetadata {
    readonly name: HashAlgorithmName;
    readonly family: HashAlgorithmFamily;
    readonly category: HashCategory;
    readonly outputSize: HashSize;
    readonly blockSize: number;
    readonly seedable: boolean;
    readonly keyed: boolean;
    readonly cryptographicallySecure: boolean;
    readonly async: boolean;
    readonly description: string;
}

export function isHash32(value: unknown): value is Hash32 {
    return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (value as number) >= 0 &&
        (value as number) <= 0xffffffff
    );
}

export function isHash64(value: unknown): value is Hash64 {
    return typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffn;
}

export function isHash128(value: unknown): value is Hash128 {
    return typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffffffffffffffffffn;
}

export function isHash256(value: unknown): value is Hash256 {
    return typeof value === 'bigint' && value >= 0n && value <= 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn;
}

export function isSeed32(value: unknown): value is Seed32 {
    return isHash32(value);
}

export function isSeed64(value: unknown): value is Seed64 {
    return isHash64(value);
}

export function asHash32(value: number): Hash32 {
    if (!Number.isFinite(value)) {
        throw new TypeError(`Cannot convert non-finite value to Hash32: ${value}`);
    }
    return (value >>> 0) as Hash32;
}

export function asHash64(value: bigint | number): Hash64 {
    let n: bigint;
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) {
            throw new TypeError(`Cannot convert non-finite value to Hash64: ${value}`);
        }
        n = BigInt(value);
    } else {
        n = value;
    }
    if (n < 0n) {
        throw new TypeError(`Cannot convert negative value to Hash64: ${String(n)}`);
    }
    return (n & 0xffffffffffffffffn) as Hash64;
}

export function asHash128(value: bigint): Hash128 {
    if (value < 0n) {
        throw new TypeError(`Cannot convert negative value to Hash128: ${String(value)}`);
    }
    return (value & 0xffffffffffffffffffffffffffffffffn) as Hash128;
}

export function asHash256(value: bigint): Hash256 {
    if (value < 0n) {
        throw new TypeError(`Cannot convert negative value to Hash256: ${String(value)}`);
    }
    return (value & 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffn) as Hash256;
}

export function asHash512(value: bigint): Hash512 {
    if (value < 0n) {
        throw new TypeError(`Cannot convert negative value to Hash512: ${String(value)}`);
    }
    return value as Hash512;
}

export function asSeed32(value: number): Seed32 {
    return asHash32(value) as unknown as Seed32;
}

export function asSeed64(value: bigint | number): Seed64 {
    return asHash64(value) as unknown as Seed64;
}

export function asDigest32(value: number): Digest32 {
    return asHash32(value) as unknown as Digest32;
}

export function asDigest64(value: bigint | number): Digest64 {
    return asHash64(value) as unknown as Digest64;
}

export function asDigest128(value: bigint): Digest128 {
    return asHash128(value) as unknown as Digest128;
}

export function asHashBytes(bytes: BytesLike): HashBytes {
    return bytes as HashBytes;
}
