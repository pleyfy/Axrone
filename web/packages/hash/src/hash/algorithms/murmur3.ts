import type { BytesLike } from '../../types';
import { rotl32, writeU32LE, encodeBase64 } from '../bits';
import { fmix32, murmur3Scramble } from '../mixers';
import { u32ToHex, bigIntToHex } from '../hex';
import { asHash32, asHash64, asSeed32, type Hash32, type Seed32, type HashAlgorithmMetadata } from '../types';
import type { IHasher } from '../interfaces';
import { HasherBase } from '../base';
import { HashAlreadyFinalizedError } from '../errors';

const MURMUR3_METADATA: HashAlgorithmMetadata = {
    name: 'murmur3-32',
    family: 'fast',
    category: 'non-crypto',
    outputSize: 32,
    blockSize: 4,
    seedable: true,
    keyed: false,
    cryptographicallySecure: false,
    async: false,
    description: 'MurmurHash3 32-bit (Austin Appleby)',
};

export class Murmur3_32 extends HasherBase<Hash32> {
    readonly algorithm: string = MURMUR3_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = MURMUR3_METADATA;
    private _h1: number;
    private _totalLen: number = 0;
    private _tail: number = 0;
    private _tailLen: number = 0;
    private _initialSeed: number;

    constructor(seed: Seed32 = asSeed32(0)) {
        super();
        this._initialSeed = (seed as number) >>> 0;
        this._h1 = this._initialSeed;
    }

    get seed(): Seed32 {
        return asSeed32(this._initialSeed);
    }

    get byteLength(): number {
        return this._totalLen;
    }

    private _checkFinalized(): void {
        if (this._finalized) throw new HashAlreadyFinalizedError(`Murmur3_32: cannot update after digest() (algorithm=${this.algorithm})`);
    }

    private _accumulate(byte: number): void {
        this._tail = (this._tail | (byte << (this._tailLen * 8))) >>> 0;
        this._tailLen++;
        this._totalLen++;
        if (this._tailLen === 4) {
            const k1 = murmur3Scramble(this._tail);
            this._h1 = (this._h1 ^ k1) >>> 0;
            this._h1 = rotl32(this._h1, 13);
            this._h1 = (Math.imul(this._h1, 5) + 0xe6546b64) >>> 0;
            this._tail = 0;
            this._tailLen = 0;
        }
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        for (let i = offset; i < end; i++) {
            this._accumulate(bytes[i]! & 0xff);
        }
        return this;
    }

    updateString(input: string): this {
        this._checkFinalized();
        const bytes = new TextEncoder().encode(input);
        return this.updateBytes(bytes);
    }

    updateBoolean(value: boolean): this {
        this._checkFinalized();
        this._accumulate(value ? 1 : 0);
        return this;
    }

    updateI64(value: bigint): this {
        this._checkFinalized();
        let v = value;
        for (let i = 0; i < 8; i++) {
            this._accumulate(Number(v & 0xffn));
            v >>= 8n;
        }
        return this;
    }

    updateU32(value: number): this {
        this._checkFinalized();
        const v = value >>> 0;
        this._accumulate(v & 0xff);
        this._accumulate((v >>> 8) & 0xff);
        this._accumulate((v >>> 16) & 0xff);
        this._accumulate((v >>> 24) & 0xff);
        return this;
    }

    updateHash(value: Hash32 | bigint): this {
        this._checkFinalized();
        if (typeof value === 'number') return this.updateU32(value);
        let v = value;
        for (let i = 0; i < 8; i++) {
            this._accumulate(Number(v & 0xffn));
            v >>= 8n;
        }
        return this;
    }

    updateHashable<H2 extends import('../types').HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this {
        value.hashInto(this as unknown as IHasher<H2>);
        return this;
    }

    updateAny(value: unknown): this {
        if (value === null || value === undefined) {
            this._accumulate(0);
            return this;
        }
        if (typeof value === 'number') {
            if (Number.isInteger(value)) return this.updateI32(value);
            return this.updateF64(value);
        }
        if (typeof value === 'bigint') return this.updateI64(value);
        if (typeof value === 'string') return this.updateString(value);
        if (typeof value === 'boolean') return this.updateBoolean(value);
        if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
            return this.updateBytes(value as unknown as ArrayLike<number>);
        }
        return this;
    }

    digest(): Hash32 {
        this._finalized = true;
        let k1 = 0;
        switch (this._tailLen) {
            case 3:
                k1 ^= (this._tail & 0xff0000) >>> 0;
            case 2:
                k1 ^= (this._tail & 0xff00) >>> 0;
            case 1:
                k1 ^= (this._tail & 0xff) >>> 0;
                k1 = murmur3Scramble(k1);
                this._h1 = (this._h1 ^ k1) >>> 0;
        }
        this._h1 ^= this._totalLen;
        this._h1 = fmix32(this._h1);
        return asHash32(this._h1);
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
        this._h1 = this._initialSeed;
        this._totalLen = 0;
        this._tail = 0;
        this._tailLen = 0;
        this._finalized = false;
        return this;
    }

    clone(): IHasher<Hash32> {
        const c = new Murmur3_32(this.seed);
        c._h1 = this._h1;
        c._totalLen = this._totalLen;
        c._tail = this._tail;
        c._tailLen = this._tailLen;
        c._finalized = this._finalized;
        return c;
    }
}

const MURMUR2_METADATA: HashAlgorithmMetadata = {
    name: 'murmur2-64',
    family: 'fast',
    category: 'non-crypto',
    outputSize: 64,
    blockSize: 8,
    seedable: true,
    keyed: false,
    cryptographicallySecure: false,
    async: false,
    description: 'MurmurHash2 64-bit (u32-lane)',
};

// MurmurHash2 64-bit constant: M = 0xc6a4a7935bd1e995
const M2_M_HI = 0xc6a4a793;
const M2_M_LO = 0x5bd1e995;

// --- u64 arithmetic helpers for Murmur2_64 ---
// Module-level result variables to avoid per-call allocations
let _m2rHi = 0, _m2rLo = 0;

/** General 64-bit multiply: (aHi,aLo) * (bHi,bLo), result in (_m2rHi,_m2rLo) */
function m2Mul64(aHi: number, aLo: number, bHi: number, bLo: number): void {
    const a0 = aLo & 0xffff, a1 = aLo >>> 16;
    const b0 = bLo & 0xffff, b1 = bLo >>> 16;
    const ll = a0 * b0;
    const mid = (ll >>> 16) + (a1 * b0 & 0xffff) + (a0 * b1 & 0xffff);
    _m2rLo = (((mid & 0xffff) << 16) | (ll & 0xffff)) >>> 0;
    _m2rHi = (Math.imul(aHi, bLo) + Math.imul(aLo, bHi) + (a1 * b1) + (a1 * b0 >>> 16) + (a0 * b1 >>> 16) + (mid >>> 16)) >>> 0;
}

/** 64-bit XOR: (aHi,aLo) ^ (bHi,bLo), result in (_m2rHi,_m2rLo) */
function m2Xor64(aHi: number, aLo: number, bHi: number, bLo: number): void {
    _m2rHi = (aHi ^ bHi) >>> 0;
    _m2rLo = (aLo ^ bLo) >>> 0;
}

/** 64-bit right shift by n (n < 64), result in (_m2rHi,_m2rLo) */
function m2Shr64(hi: number, lo: number, n: number): void {
    if (n >= 32) {
        _m2rHi = 0;
        _m2rLo = hi >>> (n - 32);
    } else if (n === 0) {
        _m2rHi = hi;
        _m2rLo = lo;
    } else {
        _m2rHi = hi >>> n;
        _m2rLo = ((lo >>> n) | (hi << (32 - n))) >>> 0;
    }
}

export class Murmur2_64 extends HasherBase<import('../types').Hash64> {
    readonly algorithm: string = MURMUR2_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = MURMUR2_METADATA;
    private _hHi: number = 0;
    private _hLo: number = 0;
    private _totalLen: number = 0;
    private _tailHi: number = 0;
    private _tailLo: number = 0;
    private _tailLen: number = 0;
    private _initialSeed: number = 0;

    constructor(seed: import('../types').Seed32 = asSeed32(0)) {
        super();
        this._initialSeed = (seed as number) >>> 0;
        this._hHi = 0;
        this._hLo = this._initialSeed;
    }

    get seed(): import('../types').Seed32 {
        return asSeed32(this._initialSeed);
    }

    get byteLength(): number {
        return this._totalLen;
    }

    private _checkFinalized(): void {
        if (this._finalized) throw new HashAlreadyFinalizedError(`Murmur2_64: cannot update after digest() (algorithm=${this.algorithm})`);
    }

    private _accumulate(byte: number): void {
        const shift = this._tailLen * 8;
        if (shift < 32) {
            this._tailLo = (this._tailLo | ((byte & 0xff) << shift)) >>> 0;
        } else {
            this._tailHi = (this._tailHi | ((byte & 0xff) << (shift - 32))) >>> 0;
        }
        this._tailLen++;
        this._totalLen++;
        if (this._tailLen === 8) {
            // k = tail * M
            m2Mul64(this._tailHi, this._tailLo, M2_M_HI, M2_M_LO);
            let kHi = _m2rHi, kLo = _m2rLo;
            // k ^= k >> 47
            m2Shr64(kHi, kLo, 47);
            kHi ^= _m2rHi; kLo = (kLo ^ _m2rLo) >>> 0;
            // k = k * M
            m2Mul64(kHi, kLo, M2_M_HI, M2_M_LO);
            kHi = _m2rHi; kLo = _m2rLo;
            // h ^= k
            this._hHi = (this._hHi ^ kHi) >>> 0;
            this._hLo = (this._hLo ^ kLo) >>> 0;
            // h = h * M
            m2Mul64(this._hHi, this._hLo, M2_M_HI, M2_M_LO);
            this._hHi = _m2rHi;
            this._hLo = _m2rLo;
            this._tailHi = 0;
            this._tailLo = 0;
            this._tailLen = 0;
        }
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        for (let i = offset; i < end; i++) {
            this._accumulate(bytes[i]! & 0xff);
        }
        return this;
    }

    updateString(input: string): this {
        this._checkFinalized();
        const bytes = new TextEncoder().encode(input);
        return this.updateBytes(bytes);
    }

    updateBoolean(value: boolean): this {
        this._checkFinalized();
        this._accumulate(value ? 1 : 0);
        return this;
    }

    updateI64(value: bigint): this {
        this._checkFinalized();
        let v = value;
        for (let i = 0; i < 8; i++) {
            this._accumulate(Number(v & 0xffn));
            v >>= 8n;
        }
        return this;
    }

    updateU32(value: number): this {
        this._checkFinalized();
        const v = value >>> 0;
        for (let i = 0; i < 4; i++) this._accumulate((v >>> (i * 8)) & 0xff);
        return this;
    }

    updateHash(value: import('../types').Hash32 | bigint): this {
        this._checkFinalized();
        if (typeof value === 'number') return this.updateU32(value);
        let v = value;
        for (let i = 0; i < 8; i++) {
            this._accumulate(Number(v & 0xffn));
            v >>= 8n;
        }
        return this;
    }

    updateHashable<H2 extends import('../types').HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this {
        value.hashInto(this as unknown as IHasher<H2>);
        return this;
    }

    updateAny(value: unknown): this {
        if (value === null || value === undefined) { this._accumulate(0); return this; }
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

    digest(): import('../types').Hash64 {
        this._finalized = true;
        let hHi = this._hHi;
        let hLo = this._hLo;

        if (this._tailLen > 0) {
            // h ^= tail
            hHi = (hHi ^ this._tailHi) >>> 0;
            hLo = (hLo ^ this._tailLo) >>> 0;
            // h = h * M
            m2Mul64(hHi, hLo, M2_M_HI, M2_M_LO);
            hHi = _m2rHi; hLo = _m2rLo;
        }

        // h ^= totalLen
        hLo = (hLo ^ this._totalLen) >>> 0;
        // h ^= h >> 47
        m2Shr64(hHi, hLo, 47);
        hHi ^= _m2rHi; hLo = (hLo ^ _m2rLo) >>> 0;
        // h = h * M
        m2Mul64(hHi, hLo, M2_M_HI, M2_M_LO);
        hHi = _m2rHi; hLo = _m2rLo;
        // h ^= h >> 47
        m2Shr64(hHi, hLo, 47);
        hHi ^= _m2rHi; hLo = (hLo ^ _m2rLo) >>> 0;

        return asHash64((BigInt(hHi >>> 0) << 32n) | BigInt(hLo >>> 0));
    }

    digestBytes(): Uint8Array {
        this._finalized = true;
        // Compute hash without full digest() to get (hHi, hLo)
        let hHi = this._hHi;
        let hLo = this._hLo;
        if (this._tailLen > 0) {
            hHi = (hHi ^ this._tailHi) >>> 0;
            hLo = (hLo ^ this._tailLo) >>> 0;
            m2Mul64(hHi, hLo, M2_M_HI, M2_M_LO);
            hHi = _m2rHi; hLo = _m2rLo;
        }
        hLo = (hLo ^ this._totalLen) >>> 0;
        m2Shr64(hHi, hLo, 47);
        hHi ^= _m2rHi; hLo = (hLo ^ _m2rLo) >>> 0;
        m2Mul64(hHi, hLo, M2_M_HI, M2_M_LO);
        hHi = _m2rHi; hLo = _m2rLo;
        m2Shr64(hHi, hLo, 47);
        hHi ^= _m2rHi; hLo = (hLo ^ _m2rLo) >>> 0;

        const out = new Uint8Array(8);
        out[0] = hLo & 0xff; out[1] = (hLo >>> 8) & 0xff;
        out[2] = (hLo >>> 16) & 0xff; out[3] = (hLo >>> 24) & 0xff;
        out[4] = hHi & 0xff; out[5] = (hHi >>> 8) & 0xff;
        out[6] = (hHi >>> 16) & 0xff; out[7] = (hHi >>> 24) & 0xff;
        return out;
    }

    digestHex(uppercase: boolean = false): string {
        this._finalized = true;
        let hHi = this._hHi;
        let hLo = this._hLo;
        if (this._tailLen > 0) {
            hHi = (hHi ^ this._tailHi) >>> 0;
            hLo = (hLo ^ this._tailLo) >>> 0;
            m2Mul64(hHi, hLo, M2_M_HI, M2_M_LO);
            hHi = _m2rHi; hLo = _m2rLo;
        }
        hLo = (hLo ^ this._totalLen) >>> 0;
        m2Shr64(hHi, hLo, 47);
        hHi ^= _m2rHi; hLo = (hLo ^ _m2rLo) >>> 0;
        m2Mul64(hHi, hLo, M2_M_HI, M2_M_LO);
        hHi = _m2rHi; hLo = _m2rLo;
        m2Shr64(hHi, hLo, 47);
        hHi ^= _m2rHi; hLo = (hLo ^ _m2rLo) >>> 0;
        const s = (hHi >>> 0).toString(16).padStart(8, '0') + (hLo >>> 0).toString(16).padStart(8, '0');
        return uppercase ? s.toUpperCase() : s;
    }

    digestBase64(): string {
        return encodeBase64(this.digestBytes());
    }

    digestBigInt<H2 extends bigint = bigint>(): H2 {
        this._finalized = true;
        let hHi = this._hHi;
        let hLo = this._hLo;
        if (this._tailLen > 0) {
            hHi = (hHi ^ this._tailHi) >>> 0;
            hLo = (hLo ^ this._tailLo) >>> 0;
            m2Mul64(hHi, hLo, M2_M_HI, M2_M_LO);
            hHi = _m2rHi; hLo = _m2rLo;
        }
        hLo = (hLo ^ this._totalLen) >>> 0;
        m2Shr64(hHi, hLo, 47);
        hHi ^= _m2rHi; hLo = (hLo ^ _m2rLo) >>> 0;
        m2Mul64(hHi, hLo, M2_M_HI, M2_M_LO);
        hHi = _m2rHi; hLo = _m2rLo;
        m2Shr64(hHi, hLo, 47);
        hHi ^= _m2rHi; hLo = (hLo ^ _m2rLo) >>> 0;
        return ((BigInt(hHi >>> 0) << 32n) | BigInt(hLo >>> 0)) as H2;
    }

    reset(seed: import('../types').Seed32 = asSeed32(0)): this {
        this._initialSeed = (seed as number) >>> 0;
        this._hHi = 0;
        this._hLo = this._initialSeed;
        this._totalLen = 0;
        this._tailHi = 0;
        this._tailLo = 0;
        this._tailLen = 0;
        this._finalized = false;
        return this;
    }

    clone(): IHasher<import('../types').Hash64> {
        const c = new Murmur2_64(this.seed);
        (c as any)._hHi = this._hHi;
        (c as any)._hLo = this._hLo;
        (c as any)._tailHi = this._tailHi;
        (c as any)._tailLo = this._tailLo;
        c._totalLen = this._totalLen;
        c._tailLen = this._tailLen;
        c._finalized = this._finalized;
        return c;
    }
}
