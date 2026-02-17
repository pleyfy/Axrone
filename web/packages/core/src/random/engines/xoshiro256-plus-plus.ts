import { Float64, UInt32, UInt64 } from '../../types';
import { IRandomEngine, IRandomState, RandomEngineType, SeedSource } from '../types';
import { UINT64_MAX } from '../constants';
import { hashSeedToState } from '../seed-utils';

export class Xoshiro256PlusPlus implements IRandomEngine {
    private s0: UInt64;
    private s1: UInt64;
    private s2: UInt64;
    private s3: UInt64;
    private counter: UInt64;
    private readonly engineType = RandomEngineType.XOSHIRO256_PLUS_PLUS;

    constructor(seed: SeedSource = null) {
        const state = hashSeedToState(seed);
        this.s0 = state.vector[0];
        this.s1 = state.vector[1];
        this.s2 = state.vector[2];
        this.s3 = state.vector[3];
        this.counter = state.counter;
        this.warmup();
    }

    public next01 = (): Float64 => {
        const result = Number(this.nextUint64() >> 11n) * (1.0 / 9007199254740992.0);
        return result;
    };

    public nextUint32 = (): UInt32 => {
        return Number(this.nextUint64() & 0xffffffffn) >>> 0;
    };

    public nextUint64 = (): UInt64 => {
        this.counter++;

        const result = (this.rotl(this.s0 + this.s3, 23n) + this.s0) & UINT64_MAX;

        const t = (this.s1 << 17n) & UINT64_MAX;

        this.s2 ^= this.s0;
        this.s3 ^= this.s1;
        this.s1 ^= this.s2;
        this.s0 ^= this.s3;

        this.s2 ^= t;
        this.s3 = this.rotl(this.s3, 45n);

        return result;
    };

    public jumpAhead = (steps: UInt64 = 1n): void => {
        if (steps <= 0n) return;

        if (steps < 16n) {
            for (let i = 0n; i < steps; i++) {
                this.nextUint64();
            }
            return;
        }

        const JUMP = [
            0x180ec6d33cfd0aban,
            0xd5a61266f0c9392cn,
            0xa9582618e03fc9aan,
            0x39abdc4529b1661cn,
        ];

        let s0 = 0n;
        let s1 = 0n;
        let s2 = 0n;
        let s3 = 0n;

        for (const jump of JUMP) {
            for (let b = 0n; b < 64n; b++) {
                if ((jump & (1n << b)) !== 0n) {
                    s0 ^= this.s0;
                    s1 ^= this.s1;
                    s2 ^= this.s2;
                    s3 ^= this.s3;
                }
                this.nextUint64();
            }
        }

        this.s0 = s0;
        this.s1 = s1;
        this.s2 = s2;
        this.s3 = s3;
        this.counter += steps - 1n;
    };

    public getState = (): IRandomState => {
        return {
            vector: [this.s0, this.s1, this.s2, this.s3],
            counter: this.counter,
            engine: this.engineType,
        };
    };

    public setState = (state: IRandomState): void => {
        this.s0 = state.vector[0];
        this.s1 = state.vector[1];
        this.s2 = state.vector[2];
        this.s3 = state.vector[3];
        this.counter = state.counter;
    };

    public clone = (): IRandomEngine => {
        const copy = new Xoshiro256PlusPlus();
        copy.s0 = this.s0;
        copy.s1 = this.s1;
        copy.s2 = this.s2;
        copy.s3 = this.s3;
        copy.counter = this.counter;
        return copy;
    };

    private rotl = (x: UInt64, k: UInt64): UInt64 => {
        return ((x << k) | (x >> (64n - k))) & UINT64_MAX;
    };

    private warmup = (): void => {
        for (let i = 0; i < 32; i++) {
            this.nextUint64();
        }
        this.counter = 0n;
    };
}
