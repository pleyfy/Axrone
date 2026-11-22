import type { BytesLike } from '../../types';
import { writeU32LE, encodeBase64 } from '../bits';
import { u32ToHex } from '../hex';
import { asHash32, asSeed32, type Hash32, type Seed32, type HashAlgorithmMetadata } from '../types';
import type { IHasher } from '../interfaces';
import { HasherBase } from '../base';

const DJB2_METADATA: HashAlgorithmMetadata = {
    name: 'djb2',
    family: 'fast',
    category: 'non-crypto',
    outputSize: 32,
    blockSize: 1,
    seedable: false,
    keyed: false,
    cryptographicallySecure: false,
    async: false,
    description: 'DJB2 hash by Daniel J. Bernstein (hash * 33 + c)',
};

export class Djb2 extends HasherBase<Hash32> {
    readonly algorithm: string = DJB2_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = DJB2_METADATA;
    private _h: number = 5381;

    constructor() {
        super();
        this._h = 5381;
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        for (let i = offset; i < end; i++) {
            this._h = (this._h * 33 + (bytes[i]! & 0xff)) >>> 0;
        }
        this._byteLength += end - offset;
        return this;
    }

    updateString(input: string): this {
        this._checkFinalized();
        for (let i = 0; i < input.length; i++) {
            const c = input.charCodeAt(i);
            this._h = (this._h * 33 + (c & 0xff)) >>> 0;
            this._h = (this._h * 33 + ((c >>> 8) & 0xff)) >>> 0;
        }
        this._byteLength += input.length * 2;
        return this;
    }

    updateBoolean(value: boolean): this {
        this._checkFinalized();
        this._h = (this._h * 33 + (value ? 1 : 0)) >>> 0;
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
        this._h = (this._h * 33 + (v & 0xff)) >>> 0;
        this._h = (this._h * 33 + ((v >>> 8) & 0xff)) >>> 0;
        this._h = (this._h * 33 + ((v >>> 16) & 0xff)) >>> 0;
        this._h = (this._h * 33 + ((v >>> 24) & 0xff)) >>> 0;
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
            this._h = (this._h * 33) >>> 0;
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
        this._finalized = true;
        return asHash32(this._h);
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
        this._h = 5381;
        this._byteLength = 0;
        this._finalized = false;
        return this;
    }

    clone(): IHasher<Hash32> {
        const c = new Djb2();
        c._h = this._h;
        c._byteLength = this._byteLength;
        c._finalized = this._finalized;
        return c;
    }
}

const DJB2A_METADATA: HashAlgorithmMetadata = {
    ...DJB2_METADATA,
    name: 'djb2a',
    description: 'DJB2a variant (xor then multiply)',
};

export class Djb2a extends HasherBase<Hash32> {
    readonly algorithm: string = DJB2A_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = DJB2A_METADATA;
    private _h: number = 5381;

    constructor() {
        super();
        this._h = 5381;
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        for (let i = offset; i < end; i++) {
            this._h = ((this._h ^ (bytes[i]! & 0xff)) * 33) >>> 0;
        }
        this._byteLength += end - offset;
        return this;
    }

    updateString(input: string): this {
        this._checkFinalized();
        for (let i = 0; i < input.length; i++) {
            const c = input.charCodeAt(i);
            this._h = ((this._h ^ (c & 0xff)) * 33) >>> 0;
            this._h = ((this._h ^ ((c >>> 8) & 0xff)) * 33) >>> 0;
        }
        this._byteLength += input.length * 2;
        return this;
    }

    updateBoolean(value: boolean): this {
        this._checkFinalized();
        this._h = ((this._h ^ (value ? 1 : 0)) * 33) >>> 0;
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
        this._h = ((this._h ^ (v & 0xff)) * 33) >>> 0;
        this._h = ((this._h ^ ((v >>> 8) & 0xff)) * 33) >>> 0;
        this._h = ((this._h ^ ((v >>> 16) & 0xff)) * 33) >>> 0;
        this._h = ((this._h ^ ((v >>> 24) & 0xff)) * 33) >>> 0;
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
            this._h = (this._h * 33) >>> 0;
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
        this._finalized = true;
        return asHash32(this._h);
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
        this._h = 5381;
        this._byteLength = 0;
        this._finalized = false;
        return this;
    }

    clone(): IHasher<Hash32> {
        const c = new Djb2a();
        c._h = this._h;
        c._byteLength = this._byteLength;
        c._finalized = this._finalized;
        return c;
    }
}

const SDBM_METADATA: HashAlgorithmMetadata = {
    name: 'sdbm',
    family: 'fast',
    category: 'non-crypto',
    outputSize: 32,
    blockSize: 1,
    seedable: false,
    keyed: false,
    cryptographicallySecure: false,
    async: false,
    description: 'SDBM hash used by SDBM database library',
};

export class Sdbm extends HasherBase<Hash32> {
    readonly algorithm: string = SDBM_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = SDBM_METADATA;
    private _h: number = 0;

    constructor() {
        super();
        this._h = 0;
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        for (let i = offset; i < end; i++) {
            const b = bytes[i]! & 0xff;
            this._h = (b + (this._h << 6) + (this._h << 16) - this._h) >>> 0;
        }
        this._byteLength += end - offset;
        return this;
    }

    updateString(input: string): this {
        this._checkFinalized();
        for (let i = 0; i < input.length; i++) {
            const c = input.charCodeAt(i);
            this._h = ((c & 0xff) + (this._h << 6) + (this._h << 16) - this._h) >>> 0;
            this._h = (((c >>> 8) & 0xff) + (this._h << 6) + (this._h << 16) - this._h) >>> 0;
        }
        this._byteLength += input.length * 2;
        return this;
    }

    updateBoolean(value: boolean): this {
        this._checkFinalized();
        const b = value ? 1 : 0;
        this._h = (b + (this._h << 6) + (this._h << 16) - this._h) >>> 0;
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
        this._h = ((v & 0xff) + (this._h << 6) + (this._h << 16) - this._h) >>> 0;
        this._h = (((v >>> 8) & 0xff) + (this._h << 6) + (this._h << 16) - this._h) >>> 0;
        this._h = (((v >>> 16) & 0xff) + (this._h << 6) + (this._h << 16) - this._h) >>> 0;
        this._h = (((v >>> 24) & 0xff) + (this._h << 6) + (this._h << 16) - this._h) >>> 0;
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
            this._h = ((this._h << 6) + (this._h << 16) - this._h) >>> 0;
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
        this._finalized = true;
        return asHash32(this._h);
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
        this._h = 0;
        this._byteLength = 0;
        this._finalized = false;
        return this;
    }

    clone(): IHasher<Hash32> {
        const c = new Sdbm();
        c._h = this._h;
        c._byteLength = this._byteLength;
        c._finalized = this._finalized;
        return c;
    }
}
