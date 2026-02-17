import { IRandomEngine, RandomEngineType, SeedSource } from '../types';
import { Xoroshiro128PlusPlus } from './xoroshiro128-plus-plus';
import { Xoshiro256PlusPlus } from './xoshiro256-plus-plus';
import { PCGEngine } from './pcg';
import { SplitMix64Engine } from './splitmix64';
import { ChaCha20Engine } from './chacha20';
import { CryptoEngine } from './crypto';

export const createEngineFactory = (
    engineType: RandomEngineType
): ((seed?: SeedSource) => IRandomEngine) => {
    switch (engineType) {
        case RandomEngineType.XOROSHIRO128_PLUS_PLUS:
            return (seed?: SeedSource) => new Xoroshiro128PlusPlus(seed);
        case RandomEngineType.PCG_XSH_RR:
            return (seed?: SeedSource) => new PCGEngine(seed);
        case RandomEngineType.XOSHIRO256_PLUS_PLUS:
            return (seed?: SeedSource) => new Xoshiro256PlusPlus(seed);
        case RandomEngineType.SPLITMIX64:
            return (seed?: SeedSource) => new SplitMix64Engine(seed);
        case RandomEngineType.CHACHA20:
            return (seed?: SeedSource) => new ChaCha20Engine(seed);
        case RandomEngineType.CRYPTO:
            return () => new CryptoEngine();
        default:
            return (seed?: SeedSource) => new Xoroshiro128PlusPlus(seed);
    }
};

export * from './xoroshiro128-plus-plus';
export * from './xoshiro256-plus-plus';
export * from './pcg';
export * from './splitmix64';
export * from './chacha20';
export * from './crypto';
