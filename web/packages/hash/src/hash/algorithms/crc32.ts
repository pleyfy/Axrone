import type { BytesLike } from '../../types';
import { writeU32LE, encodeBase64 } from '../bits';
import { u32ToHex } from '../hex';
import { asHash32, asSeed32, type Hash32, type Seed32, type HashAlgorithmMetadata } from '../types';
import type { IHasher } from '../interfaces';
import { HasherBase } from '../base';

const CRC32_METADATA: HashAlgorithmMetadata = {
    name: 'crc32',
    family: 'checksum',
    category: 'checksum',
    outputSize: 32,
    blockSize: 1,
    seedable: true,
    keyed: false,
    cryptographicallySecure: false,
    async: false,
    description: 'CRC-32 (IEEE 802.3, used in zlib/PNG)',
};

const CRC32_TABLE: Uint32Array = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
        t[i] = c >>> 0;
    }
    return t;
})();

export class Crc32 extends HasherBase<Hash32> {
    readonly algorithm: string = CRC32_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = CRC32_METADATA;
    private _h: number = 0;
    private _initialSeed: number = 0;
    private _finalDigest: Hash32 | undefined;

    constructor(seed: Seed32 = asSeed32(0)) {
        super();
        this._initialSeed = (seed as number) >>> 0;
        this._h = this._initialSeed ^ 0xffffffff;
    }

    get seed(): Seed32 { return asSeed32(this._initialSeed); }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        for (let i = offset; i < end; i++) {
            this._h = ((this._h >>> 8) ^ CRC32_TABLE[(this._h ^ (bytes[i]! & 0xff)) & 0xff]!) >>> 0;
        }
        this._byteLength += end - offset;
        return this;
    }

    updateString(input: string): this {
        this._checkFinalized();
        for (let i = 0; i < input.length; i++) {
            const c = input.charCodeAt(i);
            this._h = ((this._h >>> 8) ^ CRC32_TABLE[(this._h ^ (c & 0xff)) & 0xff]!) >>> 0;
            this._h = ((this._h >>> 8) ^ CRC32_TABLE[(this._h ^ ((c >>> 8) & 0xff)) & 0xff]!) >>> 0;
        }
        this._byteLength += input.length * 2;
        return this;
    }

    updateBoolean(value: boolean): this {
        this._checkFinalized();
        this._h = ((this._h >>> 8) ^ CRC32_TABLE[(this._h ^ (value ? 1 : 0)) & 0xff]!) >>> 0;
        this._byteLength += 1;
        return this;
    }

    updateI64(value: bigint): this {
        this._checkFinalized();
        const buf = new Uint8Array(8);
        let v = value;
        for (let i = 0; i < 8; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
        return this.updateBytes(buf);
    }

    updateU32(value: number): this {
        this._checkFinalized();
        const v = value >>> 0;
        this._h = ((this._h >>> 8) ^ CRC32_TABLE[(this._h ^ (v & 0xff)) & 0xff]!) >>> 0;
        this._h = ((this._h >>> 8) ^ CRC32_TABLE[(this._h ^ ((v >>> 8) & 0xff)) & 0xff]!) >>> 0;
        this._h = ((this._h >>> 8) ^ CRC32_TABLE[(this._h ^ ((v >>> 16) & 0xff)) & 0xff]!) >>> 0;
        this._h = ((this._h >>> 8) ^ CRC32_TABLE[(this._h ^ ((v >>> 24) & 0xff)) & 0xff]!) >>> 0;
        this._byteLength += 4;
        return this;
    }

    updateHash(value: Hash32 | bigint): this {
        this._checkFinalized();
        if (typeof value === 'number') return this.updateU32(value);
        const buf = new Uint8Array(8);
        let v = value;
        for (let i = 0; i < 8; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
        return this.updateBytes(buf);
    }

    updateHashable<H2 extends import('../types').HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this {
        value.hashInto(this as unknown as IHasher<H2>);
        return this;
    }

    updateAny(value: unknown): this {
        if (value === null || value === undefined) {
            this._h = ((this._h >>> 8) ^ CRC32_TABLE[this._h & 0xff]!) >>> 0;
            this._byteLength += 1;
            return this;
        }
        if (typeof value === 'number') {
            if (Number.isInteger(value)) return this.updateI32(value);
            return this.updateF64(value);
        }
        if (typeof value === 'bigint') return this.updateI64(value);
        if (typeof value === 'string') return this.updateString(value);
        if (typeof value === 'boolean') return this.updateBoolean(value);
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return this.updateBytes(value as unknown as ArrayLike<number>);
        return this;
    }

    digest(): Hash32 {
        if (this._finalDigest !== undefined) return this._finalDigest;
        this._finalized = true;
        this._finalDigest = asHash32(this._h ^ 0xffffffff);
        return this._finalDigest;
    }

    digestBytes(): Uint8Array {
        const h = this.digest();
        const out = new Uint8Array(4);
        writeU32LE(h as number, out, 0);
        return out;
    }

    digestHex(uppercase: boolean = false): string {
        return u32ToHex(this.digest() as number, uppercase);
    }

    digestBase64(): string {
        return encodeBase64(this.digestBytes());
    }

    digestBigInt<H2 extends bigint = bigint>(): H2 {
        return BigInt(this.digest() as number) as H2;
    }

    reset(seed: Seed32 = asSeed32(0)): this {
        this._initialSeed = (seed as number) >>> 0;
        this._h = this._initialSeed ^ 0xffffffff;
        this._byteLength = 0;
        this._finalized = false;
        this._finalDigest = undefined;
        return this;
    }

    clone(): IHasher<Hash32> {
        const c = new Crc32(this.seed);
        c._h = this._h;
        c._byteLength = this._byteLength;
        c._finalized = this._finalized;
        if (this._finalDigest !== undefined) c._finalDigest = this._finalDigest;
        return c;
    }
}

const CRC32C_METADATA: HashAlgorithmMetadata = {
    ...CRC32_METADATA,
    name: 'crc32c',
    description: 'CRC-32C (Castagnoli polynomial, used in iSCSI, SCTP)',
};

const CRC32C_TABLE: Uint32Array = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0x82f63b78 ^ (c >>> 1) : c >>> 1;
        }
        t[i] = c >>> 0;
    }
    return t;
})();

export class Crc32c extends HasherBase<Hash32> {
    readonly algorithm: string = CRC32C_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = CRC32C_METADATA;
    private _h: number = 0;
    private _initialSeed: number = 0;
    private _finalDigest: Hash32 | undefined;

    constructor(seed: Seed32 = asSeed32(0)) {
        super();
        this._initialSeed = (seed as number) >>> 0;
        this._h = this._initialSeed ^ 0xffffffff;
    }

    get seed(): Seed32 { return asSeed32(this._initialSeed); }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        for (let i = offset; i < end; i++) {
            this._h = ((this._h >>> 8) ^ CRC32C_TABLE[(this._h ^ (bytes[i]! & 0xff)) & 0xff]!) >>> 0;
        }
        this._byteLength += end - offset;
        return this;
    }

    updateString(input: string): this {
        this._checkFinalized();
        for (let i = 0; i < input.length; i++) {
            const c = input.charCodeAt(i);
            this._h = ((this._h >>> 8) ^ CRC32C_TABLE[(this._h ^ (c & 0xff)) & 0xff]!) >>> 0;
            this._h = ((this._h >>> 8) ^ CRC32C_TABLE[(this._h ^ ((c >>> 8) & 0xff)) & 0xff]!) >>> 0;
        }
        this._byteLength += input.length * 2;
        return this;
    }

    updateBoolean(value: boolean): this {
        this._checkFinalized();
        this._h = ((this._h >>> 8) ^ CRC32C_TABLE[(this._h ^ (value ? 1 : 0)) & 0xff]!) >>> 0;
        this._byteLength += 1;
        return this;
    }

    updateI64(value: bigint): this {
        this._checkFinalized();
        const buf = new Uint8Array(8);
        let v = value;
        for (let i = 0; i < 8; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
        return this.updateBytes(buf);
    }

    updateU32(value: number): this {
        this._checkFinalized();
        const v = value >>> 0;
        this._h = ((this._h >>> 8) ^ CRC32C_TABLE[(this._h ^ (v & 0xff)) & 0xff]!) >>> 0;
        this._h = ((this._h >>> 8) ^ CRC32C_TABLE[(this._h ^ ((v >>> 8) & 0xff)) & 0xff]!) >>> 0;
        this._h = ((this._h >>> 8) ^ CRC32C_TABLE[(this._h ^ ((v >>> 16) & 0xff)) & 0xff]!) >>> 0;
        this._h = ((this._h >>> 8) ^ CRC32C_TABLE[(this._h ^ ((v >>> 24) & 0xff)) & 0xff]!) >>> 0;
        this._byteLength += 4;
        return this;
    }

    updateHash(value: Hash32 | bigint): this {
        this._checkFinalized();
        if (typeof value === 'number') return this.updateU32(value);
        const buf = new Uint8Array(8);
        let v = value;
        for (let i = 0; i < 8; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
        return this.updateBytes(buf);
    }

    updateHashable<H2 extends import('../types').HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this {
        value.hashInto(this as unknown as IHasher<H2>);
        return this;
    }

    updateAny(value: unknown): this {
        if (value === null || value === undefined) {
            this._h = ((this._h >>> 8) ^ CRC32C_TABLE[this._h & 0xff]!) >>> 0;
            this._byteLength += 1;
            return this;
        }
        if (typeof value === 'number') {
            if (Number.isInteger(value)) return this.updateI32(value);
            return this.updateF64(value);
        }
        if (typeof value === 'bigint') return this.updateI64(value);
        if (typeof value === 'string') return this.updateString(value);
        if (typeof value === 'boolean') return this.updateBoolean(value);
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) return this.updateBytes(value as unknown as ArrayLike<number>);
        return this;
    }

    digest(): Hash32 {
        if (this._finalDigest !== undefined) return this._finalDigest;
        this._finalized = true;
        this._finalDigest = asHash32(this._h ^ 0xffffffff);
        return this._finalDigest;
    }

    digestBytes(): Uint8Array {
        const h = this.digest();
        const out = new Uint8Array(4);
        writeU32LE(h as number, out, 0);
        return out;
    }

    digestHex(uppercase: boolean = false): string {
        return u32ToHex(this.digest() as number, uppercase);
    }

    digestBase64(): string {
        return encodeBase64(this.digestBytes());
    }

    digestBigInt<H2 extends bigint = bigint>(): H2 {
        return BigInt(this.digest() as number) as H2;
    }

    reset(seed: Seed32 = asSeed32(0)): this {
        this._initialSeed = (seed as number) >>> 0;
        this._h = this._initialSeed ^ 0xffffffff;
        this._byteLength = 0;
        this._finalized = false;
        this._finalDigest = undefined;
        return this;
    }

    clone(): IHasher<Hash32> {
        const c = new Crc32c(this.seed);
        c._h = this._h;
        c._byteLength = this._byteLength;
        c._finalized = this._finalized;
        if (this._finalDigest !== undefined) c._finalDigest = this._finalDigest;
        return c;
    }
}
