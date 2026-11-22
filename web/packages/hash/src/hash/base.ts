import type { BytesLike } from '../types';
import { float32ToBits, float64ToBitsPair } from './bits';
import type { IHasher } from './interfaces';
import type { HashValue, Seed32, Seed64, HashAlgorithmMetadata } from './types';
import { HashAlreadyFinalizedError } from './errors';

/**
 * Abstract base class for all hash algorithm implementations.
 * Provides shared state management, property getters, and default
 * implementations for typed update methods that delegate to core
 * abstract methods (updateU32, updateI64, updateBytes).
 *
 * Replaces the incorrect inheritance hierarchy where unrelated algorithms
 * (CRC32, DJB2, SDBM) extended Fnv1a32. Each algorithm now extends
 * HasherBase directly and implements its own mixing logic.
 */
export abstract class HasherBase<H extends HashValue> implements IHasher<H> {
    abstract readonly algorithm: string;
    abstract readonly metadata: Readonly<HashAlgorithmMetadata>;

    protected _byteLength: number = 0;
    protected _finalized: boolean = false;
    protected _f64Tuple: [number, number] = [0, 0];

    get byteLength(): number { return this._byteLength; }
    get finalized(): boolean { return this._finalized; }
    get seed(): Seed32 | Seed64 | undefined { return undefined; }

    protected _checkFinalized(): void {
        if (this._finalized) throw new HashAlreadyFinalizedError(`${this.algorithm}: cannot update after digest()`);
    }

    // ── Core abstract methods each algorithm must implement ──────────────

    abstract updateBytes(bytes: BytesLike, offset?: number, length?: number): this;
    abstract updateString(input: string): this;
    abstract updateBoolean(value: boolean): this;
    abstract updateI64(value: bigint): this;
    abstract updateU32(value: number): this;
    abstract updateHash(value: HashValue): this;
    abstract updateHashable<H2 extends HashValue>(value: { hashInto(hasher: IHasher<H2>): void }): this;
    abstract updateAny(value: unknown): this;
    abstract digest(): H;
    abstract digestBytes(): Uint8Array;
    abstract digestHex(uppercase?: boolean): string;
    abstract digestBase64(): string;
    abstract digestBigInt<H2 extends bigint = bigint>(): H2;
    abstract reset(seed?: Seed32 | Seed64): this;
    abstract clone(): IHasher<H>;

    // ── Default delegation implementations ───────────────────────────────
    // Subclasses may override for algorithm-specific optimization.

    updateStringUtf16(input: string): this {
        this._checkFinalized();
        const bytes = new Uint8Array(input.length * 2);
        for (let i = 0; i < input.length; i++) {
            const c = input.charCodeAt(i);
            bytes[i * 2] = c & 0xff;
            bytes[i * 2 + 1] = (c >>> 8) & 0xff;
        }
        return this.updateBytes(bytes);
    }

    updateI8(v: number): this { return this.updateI32(v | 0); }
    updateI16(v: number): this { return this.updateI32(v | 0); }
    updateI32(value: number): this { return this.updateU32(value | 0); }
    updateU8(v: number): this { return this.updateU32(v & 0xff); }
    updateU16(v: number): this { return this.updateU32(v & 0xffff); }
    updateU64(value: bigint): this { return this.updateI64(value); }
    updateF32(value: number): this { return this.updateU32(float32ToBits(value)); }

    updateF64(value: number): this {
        float64ToBitsPair(value, this._f64Tuple);
        return this.updateU32(this._f64Tuple[0]).updateU32(this._f64Tuple[1]);
    }
}
