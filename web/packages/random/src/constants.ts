import { Float64, UInt64 } from '../types';

export const UINT32_MAX = 0xffffffff >>> 0;
export const UINT64_MAX = 0xffffffffffffffffn;
export const INV_UINT32_MAX = 1.0 / (UINT32_MAX + 1);
export const INV_UINT64_MAX = 1.0 / Number(UINT64_MAX + 1n);
export const PI = Math.PI;
export const TWO_PI = 2.0 * PI;
export const LN2 = Math.LN2;
export const E = Math.E;
export const SQRT_2PI = Math.sqrt(TWO_PI);

// Validation functions
export const validateProbability = (p: Float64, name = 'probability'): void => {
    if (p < 0 || p > 1 || !Number.isFinite(p)) {
        throw new RangeError(`${name} must be between 0 and 1`);
    }
};

export const validatePositive = (value: Float64, name = 'value'): void => {
    if (value <= 0 || !Number.isFinite(value)) {
        throw new RangeError(`${name} must be positive`);
    }
};

export const validateNonNegative = (value: number, name = 'value'): void => {
    if (value < 0 || !Number.isFinite(value)) {
        throw new RangeError(`${name} must be non-negative`);
    }
};

export const validateInteger = (value: number, name = 'value'): void => {
    if (!Number.isInteger(value) || !Number.isFinite(value)) {
        throw new TypeError(`${name} must be an integer`);
    }
};

// Hex lookup table
export const hex = (() => {
    const lookup: string[] = [];
    for (let i = 0; i < 256; i++) {
        lookup.push((i < 16 ? '0' : '') + i.toString(16));
    }
    return lookup as readonly string[];
})();

// Factorial utility with caching
export const factorial = (() => {
    const cache = new Map<number, number>();

    return (n: number): number => {
        if (n < 0) {
            throw new RangeError('Factorial not defined for negative numbers');
        }

        if (n < 2) return 1;

        if (cache.has(n)) {
            return cache.get(n)!;
        }

        if (n > 170) {
            return Infinity;
        }

        let result = n;
        for (let i = n - 1; i > 1; i--) {
            result *= i;
        }

        cache.set(n, result);
        return result;
    };
})();
