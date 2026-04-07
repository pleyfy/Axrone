import { UInt64 } from '../types';
import { IRandomState, RandomEngineType, SeedSource } from './types';
import { UINT64_MAX, hex } from './constants';

export const createSeedFromTime = (): IRandomState => {
    const now = BigInt(Date.now());
    const pid = typeof process !== 'undefined' && process.pid ? BigInt(process.pid) : 0n;
    const entropy = crypto?.getRandomValues
        ? BigInt(
              '0x' +
                  Array.from(crypto.getRandomValues(new Uint8Array(8)))
                      .map((b) => hex[b])
                      .join('')
          )
        : 0n;

    const high = now << 32n;
    const mid = pid << 16n;
    const low = entropy & 0xffffn;

    const seed = high | mid | low;

    return {
        vector: [seed, seed ^ 0xdeadbeefn, seed ^ 0x12345678n, seed ^ 0x87654321n],
        counter: 0n,
        engine: RandomEngineType.XOROSHIRO128_PLUS_PLUS,
    };
};

export const hashSeedToState = (seed: SeedSource): IRandomState => {
    if (seed === null) {
        return createSeedFromTime();
    }

    let s0 = 0x6a09e667f3bcc908n;
    let s1 = 0xbb67ae8584caa73bn;
    let s2 = 0x3c6ef372fe94f82bn;
    let s3 = 0xa54ff53a5f1d36f1n;

    const mix = (): void => {
        s0 = (s0 ^ s1 ^ s2 ^ s3) & UINT64_MAX;
        s1 = ((s1 << 11n) | (s1 >> 53n)) & UINT64_MAX;
        s2 = ((s2 << 23n) | (s2 >> 41n)) & UINT64_MAX;
        s3 = ((s3 << 7n) | (s3 >> 57n)) & UINT64_MAX;

        const t = (s1 << 29n) & UINT64_MAX;

        s2 ^= s0;
        s3 ^= s1;
        s1 ^= s2;
        s0 ^= s3;

        s2 ^= t;
        s3 = ((s3 << 25n) | (s3 >> 39n)) & UINT64_MAX;
    };

    if (typeof seed === 'string') {
        const encoder = new TextEncoder();
        const data = encoder.encode(seed);

        for (let i = 0; i < data.length; i += 32) {
            const chunk = data.slice(i, Math.min(i + 32, data.length));
            let a = 0n,
                b = 0n,
                c = 0n,
                d = 0n;

            for (let j = 0; j < chunk.length; j++) {
                const bitShift = BigInt(j & 7) << 3n;
                const val = BigInt(chunk[j]);

                if (j < 8) a |= val << bitShift;
                else if (j < 16) b |= val << bitShift;
                else if (j < 24) c |= val << bitShift;
                else d |= val << bitShift;
            }

            s0 ^= a;
            s1 ^= b;
            s2 ^= c;
            s3 ^= d;

            mix();
        }
    } else if (typeof seed === 'number') {
        const val = BigInt(seed);
        s0 ^= val;
        s1 ^= val ^ 0x5555555555555555n;
        mix();
    } else if (seed instanceof Uint8Array) {
        for (let i = 0; i < seed.length; i += 32) {
            const chunk = seed.slice(i, Math.min(i + 32, seed.length));
            let a = 0n,
                b = 0n,
                c = 0n,
                d = 0n;

            for (let j = 0; j < chunk.length; j++) {
                const bitShift = BigInt(j & 7) << 3n;
                const val = BigInt(chunk[j]);

                if (j < 8) a |= val << bitShift;
                else if (j < 16) b |= val << bitShift;
                else if (j < 24) c |= val << bitShift;
                else d |= val << bitShift;
            }

            s0 ^= a;
            s1 ^= b;
            s2 ^= c;
            s3 ^= d;

            mix();
        }
    } else if (seed instanceof Int32Array) {
        for (let i = 0; i < seed.length; i += 8) {
            let a = 0n,
                b = 0n,
                c = 0n,
                d = 0n;

            for (let j = 0; j < 8 && i + j < seed.length; j++) {
                const bitShift = BigInt(j) << 5n;
                const val = BigInt(seed[i + j]) & 0xffffffffn;

                if (j < 2) a |= val << bitShift;
                else if (j < 4) b |= val << bitShift;
                else if (j < 6) c |= val << bitShift;
                else d |= val << bitShift;
            }

            s0 ^= a;
            s1 ^= b;
            s2 ^= c;
            s3 ^= d;

            mix();
        }
    } else if (seed instanceof BigInt64Array) {
        for (let i = 0; i < seed.length; i += 4) {
            const a = i < seed.length ? BigInt(seed[i]) & UINT64_MAX : 0n;
            const b = i + 1 < seed.length ? BigInt(seed[i + 1]) & UINT64_MAX : 0n;
            const c = i + 2 < seed.length ? BigInt(seed[i + 2]) & UINT64_MAX : 0n;
            const d = i + 3 < seed.length ? BigInt(seed[i + 3]) & UINT64_MAX : 0n;

            s0 ^= a;
            s1 ^= b;
            s2 ^= c;
            s3 ^= d;

            mix();
        }
    }

    for (let i = 0; i < 16; i++) {
        mix();
    }

    if (s0 === 0n && s1 === 0n && s2 === 0n && s3 === 0n) {
        s0 = 0x6a09e667f3bcc908n;
        s1 = 0xbb67ae8584caa73bn;
        s2 = 0x3c6ef372fe94f82bn;
        s3 = 0xa54ff53a5f1d36f1n;
    }

    return {
        vector: [s0, s1, s2, s3],
        counter: 0n,
        engine: RandomEngineType.XOROSHIRO128_PLUS_PLUS,
    };
};
