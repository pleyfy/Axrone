// Export types
export * from './types';

// Export constants and utilities
export * from './constants';
export * from './seed-utils';

// Export engines
export * from './engines';

// Export distributions
export * from './distributions';

// Export main API
export * from './random-api';

// Create convenience exports
import { Random, RandomBuilder } from './random-api';
import { RandomEngineType } from './types';

export const createRandom = (
    seed?: any,
    engineType: RandomEngineType = RandomEngineType.XOROSHIRO128_PLUS_PLUS
) => {
    return new Random(seed, engineType);
};

export const rand = new Random();
export default rand;
