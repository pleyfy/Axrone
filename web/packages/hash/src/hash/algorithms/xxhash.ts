import type { BytesLike } from '../../types';
import { readU32LE, rotl32, writeU32LE, encodeBase64 } from '../bits';
import { u32ToHex } from '../hex';
import { asHash32, asSeed32, asHash64, type Hash32, type Hash64, type Seed32, type HashAlgorithmMetadata } from '../types';
import type { IHasher } from '../interfaces';
import { HasherBase } from '../base';
import { HashAlreadyFinalizedError } from '../errors';

const XXH32_METADATA: HashAlgorithmMetadata = {
    name: 'xxhash32',
    family: 'fast',
    category: 'non-crypto',
    outputSize: 32,
    blockSize: 16,
    seedable: true,
    keyed: false,
    cryptographicallySecure: false,
    async: false,
    description: 'xxHash32 - extremely fast non-cryptographic hash (Yann Collet)',
};

const XXH_P1 = 0x9e3779b1;
const XXH_P2 = 0x85ebca77;
const XXH_P3 = 0xc2b2ae3d;
const XXH_P4 = 0x27d4eb2f;
const XXH_P5 = 0x165667b1;

export class XxHash32 extends HasherBase<Hash32> {
    readonly algorithm: string = XXH32_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = XXH32_METADATA;
    private _v1: number;
    private _v2: number;
    private _v3: number;
    private _v4: number;
    private _totalLen: number = 0;
    private _mem: Uint8Array;
    private _memSize: number = 0;
    private _seed: number;

    constructor(seed: Seed32 = asSeed32(0)) {
        super();
        this._seed = (seed as number) >>> 0;
        this._v1 = (this._seed + XXH_P1 + XXH_P2) >>> 0;
        this._v2 = (this._seed + XXH_P2) >>> 0;
        this._v3 = this._seed;
        this._v4 = (this._seed - XXH_P1) >>> 0;
        this._mem = new Uint8Array(16);
    }

    get seed(): Seed32 {
        return asSeed32(this._seed);
    }

    get byteLength(): number {
        return this._totalLen;
    }

    private _checkFinalized(): void {
        if (this._finalized) throw new HashAlreadyFinalizedError(`XxHash32: cannot update after digest() (algorithm=${this.algorithm})`);
    }

    private _round(acc: number, input: number): number {
        acc = (acc + Math.imul(input, XXH_P2)) >>> 0;
        acc = rotl32(acc, 13);
        acc = Math.imul(acc, XXH_P1) >>> 0;
        return acc;
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        const inputLen = end - offset;
        this._totalLen += inputLen;

        if (this._memSize > 0) {
            const remaining = 16 - this._memSize;
            const toCopy = Math.min(inputLen, remaining);
            for (let i = 0; i < toCopy; i++) {
                this._mem[this._memSize + i] = bytes[offset + i]! & 0xff;
            }
            this._memSize += toCopy;
            offset += toCopy;

            if (this._memSize === 16) {
                const v1 = this._round(this._v1, readU32LE(this._mem, 0));
                const v2 = this._round(this._v2, readU32LE(this._mem, 4));
                const v3 = this._round(this._v3, readU32LE(this._mem, 8));
                const v4 = this._round(this._v4, readU32LE(this._mem, 12));
                this._v1 = v1;
                this._v2 = v2;
                this._v3 = v3;
                this._v4 = v4;
                this._memSize = 0;
            }
        }

        const limit = end - offset;
        if (limit >= 16) {
            let v1 = this._v1;
            let v2 = this._v2;
            let v3 = this._v3;
            let v4 = this._v4;
            let pos = offset;
            const blockEnd = offset + (limit - (limit % 16));
            while (pos < blockEnd) {
                v1 = this._round(v1, readU32LE(bytes, pos));
                v2 = this._round(v2, readU32LE(bytes, pos + 4));
                v3 = this._round(v3, readU32LE(bytes, pos + 8));
                v4 = this._round(v4, readU32LE(bytes, pos + 12));
                pos += 16;
            }
            this._v1 = v1;
            this._v2 = v2;
            this._v3 = v3;
            this._v4 = v4;
            offset = pos;
        }

        const leftover = end - offset;
        if (leftover > 0) {
            for (let i = 0; i < leftover; i++) {
                this._mem[i] = bytes[offset + i]! & 0xff;
            }
            this._memSize = leftover;
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
        const b = new Uint8Array(1);
        b[0] = value ? 1 : 0;
        return this.updateBytes(b);
    }

    updateI64(value: bigint): this {
        this._checkFinalized();
        const buf = new Uint8Array(8);
        let v = value;
        for (let i = 0; i < 8; i++) {
            buf[i] = Number(v & 0xffn);
            v >>= 8n;
        }
        return this.updateBytes(buf);
    }

    updateU32(value: number): this {
        this._checkFinalized();
        const buf = new Uint8Array(4);
        writeU32LE(value >>> 0, buf, 0);
        return this.updateBytes(buf);
    }

    updateHash(value: Hash32 | bigint): this {
        this._checkFinalized();
        if (typeof value === 'number') return this.updateU32(value);
        return this.updateI64(value);
    }

    updateHashable<H2 extends import('../types').HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this {
        value.hashInto(this as unknown as IHasher<H2>);
        return this;
    }

    updateAny(value: unknown): this {
        if (value === null || value === undefined) {
            const b = new Uint8Array(1);
            b[0] = 0;
            return this.updateBytes(b);
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

    private _avalanche(h: number): number {
        h = (h ^ (h >>> 15)) >>> 0;
        h = Math.imul(h, XXH_P2) >>> 0;
        h = (h ^ (h >>> 13)) >>> 0;
        h = Math.imul(h, XXH_P3) >>> 0;
        h = (h ^ (h >>> 16)) >>> 0;
        return h >>> 0;
    }

    private _finalize(): number {
        let h32: number;
        if (this._totalLen >= 16) {
            h32 = (rotl32(this._v1, 1) + rotl32(this._v2, 7) + rotl32(this._v3, 12) + rotl32(this._v4, 18)) >>> 0;
        } else {
            h32 = (this._seed + XXH_P5) >>> 0;
        }
        h32 = (h32 + this._totalLen) >>> 0;

        let pos = 0;
        while (pos + 4 <= this._memSize) {
            const lane = readU32LE(this._mem, pos);
            h32 = (h32 + Math.imul(lane, XXH_P3)) >>> 0;
            h32 = Math.imul(rotl32(h32, 17), XXH_P4) >>> 0;
            pos += 4;
        }

        while (pos < this._memSize) {
            h32 = (h32 + Math.imul(this._mem[pos]! & 0xff, XXH_P5)) >>> 0;
            h32 = Math.imul(rotl32(h32, 11), XXH_P1) >>> 0;
            pos++;
        }

        return this._avalanche(h32);
    }

    digest(): Hash32 {
        this._finalized = true;
        return asHash32(this._finalize());
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
        this._seed = (seed as number) >>> 0;
        this._v1 = (this._seed + XXH_P1 + XXH_P2) >>> 0;
        this._v2 = (this._seed + XXH_P2) >>> 0;
        this._v3 = this._seed;
        this._v4 = (this._seed - XXH_P1) >>> 0;
        this._totalLen = 0;
        this._memSize = 0;
        this._mem = new Uint8Array(16);
        this._finalized = false;
        return this;
    }

    clone(): IHasher<Hash32> {
        const c = new XxHash32(this.seed);
        c._v1 = this._v1;
        c._v2 = this._v2;
        c._v3 = this._v3;
        c._v4 = this._v4;
        c._totalLen = this._totalLen;
        c._memSize = this._memSize;
        c._mem = new Uint8Array(this._mem);
        c._finalized = this._finalized;
        return c;
    }
}

const XXH64_METADATA: HashAlgorithmMetadata = {
    name: 'xxhash64',
    family: 'fast',
    category: 'non-crypto',
    outputSize: 64,
    blockSize: 32,
    seedable: true,
    keyed: false,
    cryptographicallySecure: false,
    async: false,
    description: 'xxHash64 - 64-bit extremely fast non-cryptographic hash',
};

let _rHi = 0, _rLo = 0;

const P1_HI = 0x9e3779b9, P1_LO = 0x7f4a7c15;
const P2_HI = 0xc2b2ae3d, P2_LO = 0x27d4eb4f;
const P3_HI = 0x165667b1, P3_LO = 0x9e3779f9;
const P4_HI = 0x85ebca6c, P4_LO = 0x2b72e835;
const P5_HI = 0x27d4eb2f, P5_LO = 0x165667c5;

function xxAdd64(aHi: number, aLo: number, bHi: number, bLo: number): void {
    const sum = aLo + bLo;
    _rLo = sum >>> 0;
    _rHi = (aHi + bHi + (sum > 0xffffffff ? 1 : 0)) >>> 0;
}

function xxXor64(aHi: number, aLo: number, bHi: number, bLo: number): void {
    _rHi = (aHi ^ bHi) >>> 0;
    _rLo = (aLo ^ bLo) >>> 0;
}

function xxMul64(aHi: number, aLo: number, bHi: number, bLo: number): void {
    const a0 = aLo & 0xffff, a1 = aLo >>> 16;
    const b0 = bLo & 0xffff, b1 = bLo >>> 16;
    const ll = a0 * b0;
    const mid = (ll >>> 16) + (a1 * b0 & 0xffff) + (a0 * b1 & 0xffff);
    _rLo = (((mid & 0xffff) << 16) | (ll & 0xffff)) >>> 0;
    _rHi = (Math.imul(aHi, bLo) + Math.imul(aLo, bHi) + (a1 * b1) + (a1 * b0 >>> 16) + (a0 * b1 >>> 16) + (mid >>> 16)) >>> 0;
}

function xxRotl64(hi: number, lo: number, n: number): void {
    if (n === 0) { _rHi = hi; _rLo = lo; }
    else if (n === 32) { _rHi = lo; _rLo = hi; }
    else if (n < 32) {
        _rHi = ((hi << n) | (lo >>> (32 - n))) >>> 0;
        _rLo = ((lo << n) | (hi >>> (32 - n))) >>> 0;
    } else {
        const m = n - 32;
        _rHi = ((lo << m) | (hi >>> (32 - m))) >>> 0;
        _rLo = ((hi << m) | (lo >>> (32 - m))) >>> 0;
    }
}

function xxShr64(hi: number, lo: number, n: number): void {
    if (n === 0) { _rHi = hi; _rLo = lo; }
    else if (n >= 32) { _rHi = 0; _rLo = hi >>> (n - 32); }
    else { _rHi = hi >>> n; _rLo = ((lo >>> n) | (hi << (32 - n))) >>> 0; }
}

export class XxHash64 extends HasherBase<Hash64> {
    readonly algorithm: string = XXH64_METADATA.name;
    readonly metadata: Readonly<HashAlgorithmMetadata> = XXH64_METADATA;
    private _v1Hi: number;
    private _v1Lo: number;
    private _v2Hi: number;
    private _v2Lo: number;
    private _v3Hi: number;
    private _v3Lo: number;
    private _v4Hi: number;
    private _v4Lo: number;
    private _totalLen: number = 0;
    private _mem: Uint8Array;
    private _memSize: number = 0;
    private _seed: number;

    constructor(seed: Seed32 = asSeed32(0)) {
        super();
        this._seed = (seed as number) >>> 0;
        // v1 = seed + P1 + P2
        xxAdd64(P1_HI, P1_LO, P2_HI, P2_LO);
        xxAdd64(_rHi, _rLo, 0, this._seed);
        this._v1Hi = _rHi; this._v1Lo = _rLo;
        // v2 = seed + P2
        xxAdd64(P2_HI, P2_LO, 0, this._seed);
        this._v2Hi = _rHi; this._v2Lo = _rLo;
        // v3 = seed + 0
        this._v3Hi = 0; this._v3Lo = this._seed;
        // v4 = seed - P1 = seed + (-P1), where -P1 = 0x61c8864680b583eb
        xxAdd64(0x61c88646, 0x80b583eb, 0, this._seed);
        this._v4Hi = _rHi; this._v4Lo = _rLo;
        this._mem = new Uint8Array(32);
    }

    get seed(): Seed32 {
        return asSeed32(this._seed);
    }

    get byteLength(): number {
        return this._totalLen;
    }

    private _checkFinalized(): void {
        if (this._finalized) throw new HashAlreadyFinalizedError(`XxHash64: cannot update after digest() (algorithm=${this.algorithm})`);
    }

    private _round(accHi: number, accLo: number, inputHi: number, inputLo: number): void {
        // acc = acc + input * P2
        xxMul64(inputHi, inputLo, P2_HI, P2_LO);
        const tmpHi = _rHi, tmpLo = _rLo;
        xxAdd64(accHi, accLo, tmpHi, tmpLo);
        // acc = rotl64(acc, 31)
        xxRotl64(_rHi, _rLo, 31);
        // acc = acc * P1
        xxMul64(_rHi, _rLo, P1_HI, P1_LO);
    }

    private _mergeRound(accHi: number, accLo: number, valHi: number, valLo: number): void {
        // val = _round(0, val)
        this._round(0, 0, valHi, valLo);
        const rvHi = _rHi, rvLo = _rLo;
        // acc = acc ^ val
        xxXor64(accHi, accLo, rvHi, rvLo);
        // acc = rotl64(acc, 27)
        xxRotl64(_rHi, _rLo, 27);
        // acc = acc * P1
        xxMul64(_rHi, _rLo, P1_HI, P1_LO);
        // acc = acc + P4
        xxAdd64(_rHi, _rLo, P4_HI, P4_LO);
    }

    updateBytes(bytes: BytesLike, offset: number = 0, length?: number): this {
        this._checkFinalized();
        const end = length === undefined ? bytes.length : offset + length;
        const inputLen = end - offset;
        this._totalLen += inputLen;

        if (this._memSize > 0) {
            const remaining = 32 - this._memSize;
            const toCopy = Math.min(inputLen, remaining);
            for (let i = 0; i < toCopy; i++) {
                this._mem[this._memSize + i] = bytes[offset + i]! & 0xff;
            }
            this._memSize += toCopy;
            offset += toCopy;

            if (this._memSize === 32) {
                this._round(this._v1Hi, this._v1Lo, readU32LE(this._mem, 4), readU32LE(this._mem, 0));
                this._v1Hi = _rHi; this._v1Lo = _rLo;
                this._round(this._v2Hi, this._v2Lo, readU32LE(this._mem, 12), readU32LE(this._mem, 8));
                this._v2Hi = _rHi; this._v2Lo = _rLo;
                this._round(this._v3Hi, this._v3Lo, readU32LE(this._mem, 20), readU32LE(this._mem, 16));
                this._v3Hi = _rHi; this._v3Lo = _rLo;
                this._round(this._v4Hi, this._v4Lo, readU32LE(this._mem, 28), readU32LE(this._mem, 24));
                this._v4Hi = _rHi; this._v4Lo = _rLo;
                this._memSize = 0;
            }
        }

        const limit = end - offset;
        if (limit >= 32) {
            let v1Hi = this._v1Hi, v1Lo = this._v1Lo;
            let v2Hi = this._v2Hi, v2Lo = this._v2Lo;
            let v3Hi = this._v3Hi, v3Lo = this._v3Lo;
            let v4Hi = this._v4Hi, v4Lo = this._v4Lo;
            let pos = offset;
            const blockEnd = offset + (limit - (limit % 32));
            while (pos < blockEnd) {
                this._round(v1Hi, v1Lo, readU32LE(bytes, pos + 4), readU32LE(bytes, pos));
                v1Hi = _rHi; v1Lo = _rLo;
                this._round(v2Hi, v2Lo, readU32LE(bytes, pos + 12), readU32LE(bytes, pos + 8));
                v2Hi = _rHi; v2Lo = _rLo;
                this._round(v3Hi, v3Lo, readU32LE(bytes, pos + 20), readU32LE(bytes, pos + 16));
                v3Hi = _rHi; v3Lo = _rLo;
                this._round(v4Hi, v4Lo, readU32LE(bytes, pos + 28), readU32LE(bytes, pos + 24));
                v4Hi = _rHi; v4Lo = _rLo;
                pos += 32;
            }
            this._v1Hi = v1Hi; this._v1Lo = v1Lo;
            this._v2Hi = v2Hi; this._v2Lo = v2Lo;
            this._v3Hi = v3Hi; this._v3Lo = v3Lo;
            this._v4Hi = v4Hi; this._v4Lo = v4Lo;
            offset = pos;
        }

        const leftover = end - offset;
        if (leftover > 0) {
            for (let i = 0; i < leftover; i++) {
                this._mem[i] = bytes[offset + i]! & 0xff;
            }
            this._memSize = leftover;
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
        const b = new Uint8Array(1);
        b[0] = value ? 1 : 0;
        return this.updateBytes(b);
    }

    updateI64(value: bigint): this {
        this._checkFinalized();
        const buf = new Uint8Array(8);
        let v = value & 0xffffffffffffffffn;
        for (let i = 0; i < 8; i++) {
            buf[i] = Number(v & 0xffn);
            v >>= 8n;
        }
        return this.updateBytes(buf);
    }

    updateU32(value: number): this {
        this._checkFinalized();
        const buf = new Uint8Array(4);
        writeU32LE(value >>> 0, buf, 0);
        return this.updateBytes(buf);
    }

    updateHash(value: Hash32 | bigint): this {
        this._checkFinalized();
        if (typeof value === 'number') return this.updateU32(value);
        return this.updateI64(value);
    }

    updateHashable<H2 extends import('../types').HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this {
        value.hashInto(this as unknown as IHasher<H2>);
        return this;
    }

    updateAny(value: unknown): this {
        if (value === null || value === undefined) {
            const b = new Uint8Array(1);
            b[0] = 0;
            return this.updateBytes(b);
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

    private _avalanche64(hHi: number, hLo: number): void {
        // h = h ^ (h >> 37)
        xxShr64(hHi, hLo, 37);
        const s1Hi = _rHi, s1Lo = _rLo;
        xxXor64(hHi, hLo, s1Hi, s1Lo);
        // h = h * P4
        xxMul64(_rHi, _rLo, P4_HI, P4_LO);
        // h = h ^ (h >> 32)
        const s2Hi = _rHi, s2Lo = _rLo;
        xxShr64(s2Hi, s2Lo, 32);
        const s3Hi = _rHi, s3Lo = _rLo;
        xxXor64(s2Hi, s2Lo, s3Hi, s3Lo);
        // h = h * P3
        xxMul64(_rHi, _rLo, P3_HI, P3_LO);
        // h = h ^ (h >> 27)
        const s4Hi = _rHi, s4Lo = _rLo;
        xxShr64(s4Hi, s4Lo, 27);
        const s5Hi = _rHi, s5Lo = _rLo;
        xxXor64(s4Hi, s4Lo, s5Hi, s5Lo);
        // h = h * P5
        xxMul64(_rHi, _rLo, P5_HI, P5_LO);
        // h = h ^ (h >> 31)
        const s6Hi = _rHi, s6Lo = _rLo;
        xxShr64(s6Hi, s6Lo, 31);
        const s7Hi = _rHi, s7Lo = _rLo;
        xxXor64(s6Hi, s6Lo, s7Hi, s7Lo);
    }

    private _finalizeToLanes(): void {
        let hHi: number, hLo: number;
        if (this._totalLen >= 32) {
            xxRotl64(this._v1Hi, this._v1Lo, 1);
            hHi = _rHi; hLo = _rLo;
            xxRotl64(this._v2Hi, this._v2Lo, 7);
            xxAdd64(hHi, hLo, _rHi, _rLo);
            hHi = _rHi; hLo = _rLo;
            xxRotl64(this._v3Hi, this._v3Lo, 12);
            xxAdd64(hHi, hLo, _rHi, _rLo);
            hHi = _rHi; hLo = _rLo;
            xxRotl64(this._v4Hi, this._v4Lo, 18);
            xxAdd64(hHi, hLo, _rHi, _rLo);
            hHi = _rHi; hLo = _rLo;
            this._mergeRound(hHi, hLo, this._v1Hi, this._v1Lo);
            hHi = _rHi; hLo = _rLo;
            this._mergeRound(hHi, hLo, this._v2Hi, this._v2Lo);
            hHi = _rHi; hLo = _rLo;
            this._mergeRound(hHi, hLo, this._v3Hi, this._v3Lo);
            hHi = _rHi; hLo = _rLo;
            this._mergeRound(hHi, hLo, this._v4Hi, this._v4Lo);
            hHi = _rHi; hLo = _rLo;
        } else {
            xxAdd64(0, this._seed, P5_HI, P5_LO);
            hHi = _rHi; hLo = _rLo;
        }

        xxAdd64(hHi, hLo, 0, this._totalLen);
        hHi = _rHi; hLo = _rLo;

        let pos = 0;
        while (pos + 8 <= this._memSize) {
            const laneLo = readU32LE(this._mem, pos);
            const laneHi = readU32LE(this._mem, pos + 4);
            this._round(0, 0, laneHi, laneLo);
            const rndHi = _rHi, rndLo = _rLo;
            xxXor64(hHi, hLo, rndHi, rndLo);
            xxRotl64(_rHi, _rLo, 27);
            xxMul64(_rHi, _rLo, P1_HI, P1_LO);
            xxAdd64(_rHi, _rLo, P4_HI, P4_LO);
            hHi = _rHi; hLo = _rLo;
            pos += 8;
        }

        while (pos < this._memSize) {
            const byte = this._mem[pos]! & 0xff;
            xxMul64(0, byte, P5_HI, P5_LO);
            const mulHi = _rHi, mulLo = _rLo;
            xxXor64(hHi, hLo, mulHi, mulLo);
            xxRotl64(_rHi, _rLo, 11);
            xxMul64(_rHi, _rLo, P1_HI, P1_LO);
            hHi = _rHi; hLo = _rLo;
            pos++;
        }

        this._avalanche64(hHi, hLo);
    }

    digest(): Hash64 {
        this._finalized = true;
        this._finalizeToLanes();
        return asHash64((BigInt(_rHi >>> 0) << 32n) | BigInt(_rLo >>> 0));
    }

    digestBytes(): Uint8Array {
        this._finalized = true;
        this._finalizeToLanes();
        const out = new Uint8Array(8);
        out[0] = _rLo & 0xff;
        out[1] = (_rLo >>> 8) & 0xff;
        out[2] = (_rLo >>> 16) & 0xff;
        out[3] = (_rLo >>> 24) & 0xff;
        out[4] = _rHi & 0xff;
        out[5] = (_rHi >>> 8) & 0xff;
        out[6] = (_rHi >>> 16) & 0xff;
        out[7] = (_rHi >>> 24) & 0xff;
        return out;
    }

    digestHex(uppercase: boolean = false): string {
        this._finalized = true;
        this._finalizeToLanes();
        const hex = (_rHi >>> 0).toString(16).padStart(8, '0') + (_rLo >>> 0).toString(16).padStart(8, '0');
        return uppercase ? hex.toUpperCase() : hex;
    }

    digestBase64(): string {
        return encodeBase64(this.digestBytes());
    }

    digestBigInt<H2 extends bigint = bigint>(): H2 {
        this._finalized = true;
        this._finalizeToLanes();
        return ((BigInt(_rHi >>> 0) << 32n) | BigInt(_rLo >>> 0)) as H2;
    }

    reset(seed: Seed32 = asSeed32(0)): this {
        this._seed = (seed as number) >>> 0;
        xxAdd64(P1_HI, P1_LO, P2_HI, P2_LO);
        xxAdd64(_rHi, _rLo, 0, this._seed);
        this._v1Hi = _rHi; this._v1Lo = _rLo;
        xxAdd64(P2_HI, P2_LO, 0, this._seed);
        this._v2Hi = _rHi; this._v2Lo = _rLo;
        this._v3Hi = 0; this._v3Lo = this._seed;
        xxAdd64(0x61c88646, 0x80b583eb, 0, this._seed);
        this._v4Hi = _rHi; this._v4Lo = _rLo;
        this._totalLen = 0;
        this._memSize = 0;
        this._mem = new Uint8Array(32);
        this._finalized = false;
        return this;
    }

    clone(): IHasher<Hash64> {
        const c = new XxHash64(this.seed);
        c._v1Hi = this._v1Hi; c._v1Lo = this._v1Lo;
        c._v2Hi = this._v2Hi; c._v2Lo = this._v2Lo;
        c._v3Hi = this._v3Hi; c._v3Lo = this._v3Lo;
        c._v4Hi = this._v4Hi; c._v4Lo = this._v4Lo;
        c._totalLen = this._totalLen;
        c._memSize = this._memSize;
        c._mem = new Uint8Array(this._mem);
        c._finalized = this._finalized;
        return c;
    }
}
