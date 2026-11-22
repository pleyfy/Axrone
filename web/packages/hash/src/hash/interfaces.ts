import type { BytesLike } from '../types';
import type { Hash32, Hash64, Hash128, Hash256, Hash512, HashValue, Seed32, Seed64 } from './types';
import type { HashAlgorithmMetadata } from './types';

export interface IHasher<H extends HashValue = Hash32> {
    readonly algorithm: string;
    readonly metadata: Readonly<HashAlgorithmMetadata>;
    readonly seed: Seed32 | Seed64 | undefined;
    readonly byteLength: number;
    readonly finalized: boolean;

    updateBytes(bytes: BytesLike, offset?: number, length?: number): this;
    updateString(input: string): this;
    updateStringUtf16(input: string): this;
    updateBoolean(value: boolean): this;
    updateI8(value: number): this;
    updateI16(value: number): this;
    updateI32(value: number): this;
    updateI64(value: bigint): this;
    updateU8(value: number): this;
    updateU16(value: number): this;
    updateU32(value: number): this;
    updateU64(value: bigint): this;
    updateF32(value: number): this;
    updateF64(value: number): this;
    updateHash(value: HashValue): this;
    updateHashable<H2 extends HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this;
    updateAny(value: unknown): this;

    digest(): H;
    digestBytes(): Uint8Array;
    digestHex(uppercase?: boolean): string;
    digestBase64(): string;
    digestBigInt(): bigint;

    reset(seed?: Seed32 | Seed64): this;
    clone(): IHasher<H>;
}

export interface IDigestAsync<H extends HashValue> {
    digestAsync(): Promise<H>;
}

export interface IHashable<H extends HashValue = Hash32> {
    hashInto<H2 extends HashValue = H>(hasher: IHasher<H2>): void;
    getHashCode(hasher?: IHasher<H>): H;
}

export interface IHMAC<H extends HashValue = Hash32> {
    readonly algorithm: string;
    readonly key: BytesLike;
    update(bytes: BytesLike, offset?: number, length?: number): this;
    updateString(input: string): this;
    updateStringUtf16(input: string): this;
    digest(): H;
    digestBytes(): Uint8Array;
    digestHex(): string;
    reset(): this;
    clone(): IHMAC<H>;
    withKey(key: BytesLike): IHMAC<H>;
}

export interface IHashFactory<H extends HashValue = Hash32> {
    readonly metadata: Readonly<HashAlgorithmMetadata>;
    create(options?: HashFactoryOptions): IHasher<H>;
    hash(input: BytesLike | string, options?: HashFactoryOptions): H;
    hashBytes(input: BytesLike, options?: HashFactoryOptions): H;
    hashString(input: string, options?: HashFactoryOptions): H;
    hashAsync(input: BytesLike | string, options?: HashFactoryOptions): Promise<H>;
    hashBytesAsync(input: BytesLike, options?: HashFactoryOptions): Promise<H>;
    hashStringAsync(input: string, options?: HashFactoryOptions): Promise<H>;
}

export interface HashFactoryOptions {
    seed?: Seed32 | Seed64;
    key?: BytesLike;
    domain?: string;
    initialState?: HashValue;
}

export interface IDomainSeparation {
    readonly tag: string;
    hash<H extends HashValue>(data: BytesLike): H;
    hashString<H extends HashValue>(input: string): H;
    reset(): this;
    withTag(tag: string): IDomainSeparation;
}
