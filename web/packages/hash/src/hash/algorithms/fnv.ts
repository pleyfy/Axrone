import type { BytesLike } from '../../types';
import { writeU32LE, encodeBase64 } from '../bits';
import { fnv1aMix32, fnv1aMixBytes32, FNV_PRIME_32 } from '../mixing';
import { u32ToHex, bigIntToHex } from '../hex';
import { asHash32, asHash64, asSeed32, type Hash32, type Hash64, type Seed32, type HashAlgorithmMetadata } from '../types';
import type { IHasher } from '../interfaces';
import { HasherBase } from '../base';
import { HashAlreadyFinalizedError } from '../errors';

const FNV_METADATA: HashAlgorithmMetadata = {
    name: 'fnv1a-32',
    family: 'fast',
    category: 'non-crypto',
    outputSize: 32,
    blockSize: 1,
    seedable: true,
    keyed: false,
    cryptographicallySecure: false,
    description: 'FNV-1a 32-bit non-cryptographic hash (Fowler-Noll-Voy)',
};

abstract class Fnv1a32Base extends HasherBase<Hash32> {
    protected _h: number = 0;
    protected _initialSeed: number = 0;

    get seed(): Seed32 { return asSeed32(this._initialSeed); }

    updateString(input: string): this {
        this._checkFinalized();
        for (let i = 0; i < input.length; i++) {
            const c = input.charCodeAt(i);
            this._h = fnv1aMix32(this._h, c & 0xff);
            this._h = fnv1aMix32(this._h, (c >>> 8) & 0xff);
        }
        this._byteLength += input.length * 2;
        return this;
    }

    updateBoolean(value: boolean): this {
        this._checkFinalized();
        this._h = fnv1aMix32(this._h, value ? 1 : 0);
        this._byteLength += 1;
        return this;
    }

    updateI64(value: bigint): this {
        this._checkFinalized();
        let v = value;
        for (let i = 0; i < 8; i++) {
            this._h = fnv1aMix32(this._h, Number(v & 0xffn));
            v >>= 8n;
        }
        this._byteLength += 8;
        return this;
    }

    updateU32(value: number): this {
        this._checkFinalized();
        this._h = fnv1aMix32(this._h, value & 0xff);
        this._h = fnv1aMix32(this._h, (value >>> 8) & 0xff);
        this._h = fnv1aMix32(this._h, (value >>> 16) & 0xff);
        this._h = fnv1aMix32(this._h, (value >>> 24) & 0xff);
        this._byteLength += 4;
        return this;
    }

    updateHash(value: Hash32 | Hash64 | bigint): this {
        this._checkFinalized();
        if (typeof value === 'number') return this.updateU32(value);
        let v = value as bigint;
        for (let i = 0; i < 8; i++) {
            this._h = fnv1aMix32(this._h, Number(v & 0xffn));
            v >>= 8n;
        }
        this._byteLength += 8;
        return this;
    }

    updateHashable<H2 extends import('../types').HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this {
        value.hashInto(this as unknown as IHasher<H2>);
        return this;
    }

    updateAny(value: unknown): this {
        if (value === null || value === undefined) { this._h = fnv1aMix32(this._h, 0); return this; }
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
}

export class Fnv1a32 extends Fnv1a32Base {
    readonly algorithm: string = FNV_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = FNV_METADATA;

    constructor(seed: Seed32 = asSeed32(0)) {
        super();
        this._initialSeed = (seed as number) >>> 0;
        this._h = (this._initialSeed ^ 0x811c9dc5) >>> 0;
    }

    protected override _checkFinalized(): void {
        if (this._finalized) throw new HashAlreadyFinalizedError(`Fnv1a32: cannot update after digest()`);
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const len = length === undefined ? bytes.length - offset : length;
        this._h = fnv1aMixBytes32(this._h, bytes, offset, len);
        this._byteLength += len;
        return this;
    }

    reset(seed: Seed32 = asSeed32(0)): this {
        this._initialSeed = (seed as number) >>> 0;
        this._h = (this._initialSeed ^ 0x811c9dc5) >>> 0;
        this._byteLength = 0;
        this._finalized = false;
        return this;
    }

    clone(): IHasher<Hash32> {
        const c = new Fnv1a32(this.seed);
        c._h = this._h;
        c._byteLength = this._byteLength;
        c._finalized = this._finalized;
        return c;
    }
}

const FNV1_METADATA: HashAlgorithmMetadata = {
    ...FNV_METADATA,
    name: 'fnv1-32',
    description: 'FNV-1 32-bit (multiply first, then XOR)',
};

export class Fnv1_32 extends Fnv1a32Base {
    readonly algorithm: string = FNV1_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = FNV1_METADATA;

    constructor(seed: Seed32 = asSeed32(0)) {
        super();
        this._initialSeed = (seed as number) >>> 0;
        this._h = (this._initialSeed ^ 0x811c9dc5) >>> 0;
    }

    protected override _checkFinalized(): void {
        if (this._finalized) throw new HashAlreadyFinalizedError(`Fnv1_32: cannot update after digest()`);
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        for (let i = offset; i < end; i++) {
            this._h = (Math.imul(this._h, FNV_PRIME_32) ^ (bytes[i]! & 0xff)) >>> 0;
        }
        this._byteLength += end - offset;
        return this;
    }

    override updateString(input: string): this {
        this._checkFinalized();
        for (let i = 0; i < input.length; i++) {
            const c = input.charCodeAt(i);
            this._h = (Math.imul(this._h, FNV_PRIME_32) ^ (c & 0xff)) >>> 0;
            this._h = (Math.imul(this._h, FNV_PRIME_32) ^ ((c >>> 8) & 0xff)) >>> 0;
        }
        this._byteLength += input.length * 2;
        return this;
    }

    reset(seed: Seed32 = asSeed32(0)): this {
        this._initialSeed = (seed as number) >>> 0;
        this._h = (this._initialSeed ^ 0x811c9dc5) >>> 0;
        this._byteLength = 0;
        this._finalized = false;
        return this;
    }

    clone(): IHasher<Hash32> {
        const c = new Fnv1_32(this.seed);
        c._h = this._h;
        c._byteLength = this._byteLength;
        c._finalized = this._finalized;
        return c;
    }
}

const FNV64_METADATA: HashAlgorithmMetadata = {
    name: 'fnv1a-64',
    family: 'fast',
    category: 'non-crypto',
    outputSize: 64,
    blockSize: 1,
    seedable: true,
    keyed: false,
    cryptographicallySecure: false,
    description: 'FNV-1a 64-bit non-cryptographic hash (u32-lane)',
};

// FNV-1a 64-bit offset basis: 0xcbf29ce484222325
const FNV64_BASIS_HI = 0xcbf29ce4;
const FNV64_BASIS_LO = 0x84222325;

export class Fnv1a64 extends HasherBase<Hash64> {
    readonly algorithm: string = FNV64_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = FNV64_METADATA;
    private _hHi: number = 0;
    private _hLo: number = 0;
    private _initialSeed: number = 0;

    constructor(seed: Seed32 = asSeed32(0)) {
        super();
        this._initialSeed = (seed as number) >>> 0;
        this._hHi = FNV64_BASIS_HI;
        this._hLo = (this._initialSeed ^ FNV64_BASIS_LO) >>> 0;
    }

    get seed(): Seed32 { return asSeed32(this._initialSeed); }

    protected override _checkFinalized(): void {
        if (this._finalized) throw new HashAlreadyFinalizedError(`Fnv1a64: cannot update after digest()`);
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        let hHi = this._hHi;
        let hLo = this._hLo;
        for (let i = offset; i < end; i++) {
            hLo ^= (bytes[i]! & 0xff);
            // Multiply (hHi, hLo) by FNV prime (0x100, 0x1b3) — u32-lane schoolbook
            const a0 = hLo & 0xffff;
            const a1 = hLo >>> 16;
            const p0 = a0 * 0x1b3;
            const p1 = a1 * 0x1b3;
            const mid = (p0 >>> 16) + (p1 & 0xffff);
            const newLo = (((mid & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
            hHi = (Math.imul(hHi, 0x1b3) + ((hLo << 8) >>> 0) + (p1 >>> 16) + (mid >>> 16)) >>> 0;
            hLo = newLo;
        }
        this._hHi = hHi;
        this._hLo = hLo;
        this._byteLength += end - offset;
        return this;
    }

    updateString(input: string): this {
        this._checkFinalized();
        let hHi = this._hHi;
        let hLo = this._hLo;
        for (let i = 0; i < input.length; i++) {
            const c = input.charCodeAt(i);
            // Low byte
            hLo ^= (c & 0xff);
            {
                const a0 = hLo & 0xffff; const a1 = hLo >>> 16;
                const p0 = a0 * 0x1b3; const p1 = a1 * 0x1b3;
                const mid = (p0 >>> 16) + (p1 & 0xffff);
                const newLo = (((mid & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
                hHi = (Math.imul(hHi, 0x1b3) + ((hLo << 8) >>> 0) + (p1 >>> 16) + (mid >>> 16)) >>> 0;
                hLo = newLo;
            }
            // High byte
            hLo ^= ((c >>> 8) & 0xff);
            {
                const a0 = hLo & 0xffff; const a1 = hLo >>> 16;
                const p0 = a0 * 0x1b3; const p1 = a1 * 0x1b3;
                const mid = (p0 >>> 16) + (p1 & 0xffff);
                const newLo = (((mid & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
                hHi = (Math.imul(hHi, 0x1b3) + ((hLo << 8) >>> 0) + (p1 >>> 16) + (mid >>> 16)) >>> 0;
                hLo = newLo;
            }
        }
        this._hHi = hHi;
        this._hLo = hLo;
        this._byteLength += input.length * 2;
        return this;
    }

    updateBoolean(value: boolean): this {
        this._checkFinalized();
        let hLo = this._hLo ^ (value ? 1 : 0);
        const hHi = this._hHi;
        const a0 = hLo & 0xffff; const a1 = hLo >>> 16;
        const p0 = a0 * 0x1b3; const p1 = a1 * 0x1b3;
        const mid = (p0 >>> 16) + (p1 & 0xffff);
        this._hLo = (((mid & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
        this._hHi = (Math.imul(hHi, 0x1b3) + ((hLo << 8) >>> 0) + (p1 >>> 16) + (mid >>> 16)) >>> 0;
        this._byteLength += 1;
        return this;
    }

    updateI64(value: bigint): this {
        this._checkFinalized();
        let hHi = this._hHi;
        let hLo = this._hLo;
        let v = value & 0xffffffffffffffffn;
        for (let i = 0; i < 8; i++) {
            hLo ^= Number(v & 0xffn);
            const a0 = hLo & 0xffff; const a1 = hLo >>> 16;
            const p0 = a0 * 0x1b3; const p1 = a1 * 0x1b3;
            const mid = (p0 >>> 16) + (p1 & 0xffff);
            const newLo = (((mid & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
            hHi = (Math.imul(hHi, 0x1b3) + ((hLo << 8) >>> 0) + (p1 >>> 16) + (mid >>> 16)) >>> 0;
            hLo = newLo;
            v >>= 8n;
        }
        this._hHi = hHi;
        this._hLo = hLo;
        this._byteLength += 8;
        return this;
    }

    updateU32(value: number): this {
        this._checkFinalized();
        let hHi = this._hHi;
        let hLo = this._hLo;
        const v = value >>> 0;
        for (let i = 0; i < 4; i++) {
            hLo ^= ((v >>> (i * 8)) & 0xff);
            const a0 = hLo & 0xffff; const a1 = hLo >>> 16;
            const p0 = a0 * 0x1b3; const p1 = a1 * 0x1b3;
            const mid = (p0 >>> 16) + (p1 & 0xffff);
            const newLo = (((mid & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
            hHi = (Math.imul(hHi, 0x1b3) + ((hLo << 8) >>> 0) + (p1 >>> 16) + (mid >>> 16)) >>> 0;
            hLo = newLo;
        }
        this._hHi = hHi;
        this._hLo = hLo;
        this._byteLength += 4;
        return this;
    }

    updateHash(value: Hash32 | Hash64 | bigint): this {
        this._checkFinalized();
        if (typeof value === 'number') return this.updateU32(value);
        let hHi = this._hHi;
        let hLo = this._hLo;
        let v = value as bigint;
        for (let i = 0; i < 8; i++) {
            hLo ^= Number(v & 0xffn);
            const a0 = hLo & 0xffff; const a1 = hLo >>> 16;
            const p0 = a0 * 0x1b3; const p1 = a1 * 0x1b3;
            const mid = (p0 >>> 16) + (p1 & 0xffff);
            const newLo = (((mid & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
            hHi = (Math.imul(hHi, 0x1b3) + ((hLo << 8) >>> 0) + (p1 >>> 16) + (mid >>> 16)) >>> 0;
            hLo = newLo;
            v >>= 8n;
        }
        this._hHi = hHi;
        this._hLo = hLo;
        this._byteLength += 8;
        return this;
    }

    updateHashable<H2 extends import('../types').HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this {
        value.hashInto(this as unknown as IHasher<H2>);
        return this;
    }

    updateAny(value: unknown): this {
        if (value === null || value === undefined) {
            const hLo = this._hLo; const hHi = this._hHi;
            const a0 = hLo & 0xffff; const a1 = hLo >>> 16;
            const p0 = a0 * 0x1b3; const p1 = a1 * 0x1b3;
            const mid = (p0 >>> 16) + (p1 & 0xffff);
            this._hLo = (((mid & 0xffff) << 16) | (p0 & 0xffff)) >>> 0;
            this._hHi = (Math.imul(hHi, 0x1b3) + ((hLo << 8) >>> 0) + (p1 >>> 16) + (mid >>> 16)) >>> 0;
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

    digest(): Hash64 {
        this._finalized = true;
        return asHash64((BigInt(this._hHi >>> 0) << 32n) | BigInt(this._hLo >>> 0));
    }

    digestBytes(): Uint8Array {
        this._finalized = true;
        const out = new Uint8Array(8);
        out[0] = this._hLo & 0xff;
        out[1] = (this._hLo >>> 8) & 0xff;
        out[2] = (this._hLo >>> 16) & 0xff;
        out[3] = (this._hLo >>> 24) & 0xff;
        out[4] = this._hHi & 0xff;
        out[5] = (this._hHi >>> 8) & 0xff;
        out[6] = (this._hHi >>> 16) & 0xff;
        out[7] = (this._hHi >>> 24) & 0xff;
        return out;
    }

    digestHex(uppercase: boolean = false): string {
        this._finalized = true;
        const s = this._hHi.toString(16).padStart(8, '0') + this._hLo.toString(16).padStart(8, '0');
        return uppercase ? s.toUpperCase() : s;
    }

    digestBase64(): string {
        return encodeBase64(this.digestBytes());
    }

    digestBigInt<H2 extends bigint = bigint>(): H2 {
        this._finalized = true;
        return ((BigInt(this._hHi >>> 0) << 32n) | BigInt(this._hLo >>> 0)) as H2;
    }

    reset(seed: Seed32 = asSeed32(0)): this {
        this._initialSeed = (seed as number) >>> 0;
        this._hHi = FNV64_BASIS_HI;
        this._hLo = (this._initialSeed ^ FNV64_BASIS_LO) >>> 0;
        this._byteLength = 0;
        this._finalized = false;
        return this;
    }

    clone(): IHasher<Hash64> {
        const c = new Fnv1a64(this.seed);
        (c as any)._hHi = this._hHi;
        (c as any)._hLo = this._hLo;
        c._byteLength = this._byteLength;
        c._finalized = this._finalized;
        return c;
    }
}
