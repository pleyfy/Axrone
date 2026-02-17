import { describe, expect, test } from 'vitest';
import {
    clamp,
    createBoundedClamp,
    NumericRangeError,
    clampUnsafe,
    clampInt,
    clamp01,
    clamp0255,
    clampNegOneOne,
} from '../clamp';

describe('Numeric Clamp Utility', () => {
    describe('clamp()', () => {
        test.each([
            [5, 0, 10, 5],
            [0, 0, 10, 0],
            [10, 0, 10, 10],
            [-5, 0, 10, 0],
            [15, 0, 10, 10],
            [5, 10, 0, 5],
            [-10, -20, -5, -10],
            [0.5, 0.1, 0.9, 0.5],
            [
                Number.MAX_SAFE_INTEGER - 10,
                Number.MAX_SAFE_INTEGER - 100,
                Number.MAX_SAFE_INTEGER,
                Number.MAX_SAFE_INTEGER - 10,
            ],
        ])('clamp(%f, %f, %f) should return %f', (value, min, max, expected) => {
            expect(clamp(value, min, max)).toBe(expected);
        });

        test('automatically normalizes reversed min/max bounds', () => {
            expect(clamp(5, 10, 0)).toBe(5);
            expect(clamp(15, 10, 0)).toBe(10);
            expect(clamp(-5, 10, 0)).toBe(0);
        });

        test('handles special numeric edge cases', () => {
            expect(clamp(0, -10, 10)).toBe(0);

            const value = 0.1 + 0.2;
            expect(clamp(value, 0, 0.3)).toBeCloseTo(0.3);

            expect(clamp(42, 42, 42)).toBe(42);
        });

        test('throws NumericRangeError for non-finite inputs', () => {
            expect(() => clamp(NaN, 0, 10)).toThrow(NumericRangeError);
            expect(() => clamp(Infinity, 0, 10)).toThrow(NumericRangeError);
            expect(() => clamp(-Infinity, 0, 10)).toThrow(NumericRangeError);

            expect(() => clamp(5, NaN, 10)).toThrow(NumericRangeError);
            expect(() => clamp(5, 0, NaN)).toThrow(NumericRangeError);
            expect(() => clamp(5, Infinity, 10)).toThrow(NumericRangeError);
            expect(() => clamp(5, 0, -Infinity)).toThrow(NumericRangeError);
        });

        test('error messages are descriptive and helpful', () => {
            expect(() => clamp(NaN, 0, 10)).toThrow(/Value must be a finite number/);
            expect(() => clamp(5, NaN, 10)).toThrow(/Minimum bound must be a finite number/);
            expect(() => clamp(5, 0, NaN)).toThrow(/Maximum bound must be a finite number/);
        });
    });

    describe('createBoundedClamp()', () => {
        test('creates a reusable clamping function with fixed bounds', () => {
            const boundTo0_100 = createBoundedClamp(0, 100);

            expect(typeof boundTo0_100).toBe('function');
            expect(boundTo0_100(50)).toBe(50);
            expect(boundTo0_100(-10)).toBe(0);
            expect(boundTo0_100(200)).toBe(100);
        });

        test('factory correctly normalizes reversed bounds', () => {
            const boundTo0_100 = createBoundedClamp(100, 0);

            expect(boundTo0_100(50)).toBe(50);
            expect(boundTo0_100(-10)).toBe(0);
            expect(boundTo0_100(200)).toBe(100);
        });

        test('throws during factory creation if bounds are invalid', () => {
            expect(() => createBoundedClamp(NaN, 100)).toThrow(NumericRangeError);
            expect(() => createBoundedClamp(0, Infinity)).toThrow(NumericRangeError);
        });

        test('throws when clamping invalid values with factory function', () => {
            const boundTo0_100 = createBoundedClamp(0, 100);
            expect(() => boundTo0_100(NaN)).toThrow(NumericRangeError);
            expect(() => boundTo0_100(Infinity)).toThrow(NumericRangeError);
        });

        test('handles repeated clamping operations consistently', () => {
            const boundTo0_100 = createBoundedClamp(0, 100);
            const values = [-10, 0, 50, 100, 200];
            const expected = [0, 0, 50, 100, 100];

            const results = values.map(boundTo0_100);
            expect(results).toEqual(expected);
        });
    });

    describe('Performance', () => {
        test('bounded clamp is more efficient for repeated operations', () => {
            const testSize = 1000;
            const values = Array.from({ length: testSize }, (_, i) => i * 10 - 5000);

            const standardStart = performance.now();
            const standardResults = values.map((v) => clamp(v, 0, 1000));
            const standardEnd = performance.now();

            const boundedStart = performance.now();
            const boundedClamp = createBoundedClamp(0, 1000);
            const boundedResults = values.map(boundedClamp);
            const boundedEnd = performance.now();

            expect(boundedResults).toEqual(standardResults);

            console.log(`Standard clamp: ${standardEnd - standardStart}ms`);
            console.log(`Bounded clamp: ${boundedEnd - boundedStart}ms`);

            expect(true).toBe(true);
        });
    });

    describe('Type Safety', () => {
        test('maintains input number type', () => {
            const int: number = 5;
            const result: number = clamp(int, 0, 10);
            expect(result).toBe(5);

            expect(typeof clamp(5, 0, 10)).toBe('number');
        });
    });

    describe('Error Objects', () => {
        test('NumericRangeError has correct structure', () => {
            try {
                clamp(NaN, 0, 10);
                throw new Error('Expected error was not thrown');
            } catch (error) {
                expect(error).toBeInstanceOf(NumericRangeError);
                if (error instanceof NumericRangeError) {
                    expect(error.name).toBe('NumericRangeError');
                    expect(error.message).toBe('Value must be a finite number');
                    expect(error).toMatchSnapshot();
                }
            }
        });
    });

    describe('Utility Functions', () => {
        describe('clampUnsafe()', () => {
            test('performs fast clamping without validation', () => {
                expect(clampUnsafe(5, 0, 10)).toBe(5);
                expect(clampUnsafe(-5, 0, 10)).toBe(0);
                expect(clampUnsafe(15, 0, 10)).toBe(10);
                expect(clampUnsafe(5, 10, 0)).toBe(5);
            });

            test('does not throw for invalid inputs (unsafe)', () => {
                expect(clampUnsafe(NaN, 0, 10)).toBeNaN();

                const result = clampUnsafe(5, NaN, 10);
                expect(typeof result).toBe('number');
            });
        });

        describe('clampInt()', () => {
            test('clamps integer values', () => {
                expect(clampInt(5, 0, 10)).toBe(5);
                expect(clampInt(-5, 0, 10)).toBe(0);
                expect(clampInt(15, 0, 10)).toBe(10);
            });

            test('converts floats to integers before clamping', () => {
                expect(clampInt(5.7, 0, 10)).toBe(5);
                expect(clampInt(-5.9, 0, 10)).toBe(0);
                expect(clampInt(15.2, 0, 10)).toBe(10);
            });

            test('handles reversed bounds', () => {
                expect(clampInt(5, 10, 0)).toBe(5);
                expect(clampInt(15, 10, 0)).toBe(10);
                expect(clampInt(-5, 10, 0)).toBe(0);
            });
        });

        describe('clamp01()', () => {
            test('clamps values to 0-1 range', () => {
                expect(clamp01(0.5)).toBe(0.5);
                expect(clamp01(-0.5)).toBe(0);
                expect(clamp01(1.5)).toBe(1);
                expect(clamp01(0)).toBe(0);
                expect(clamp01(1)).toBe(1);
            });
        });

        describe('clamp0255()', () => {
            test('clamps values to 0-255 range (RGB values)', () => {
                expect(clamp0255(128)).toBe(128);
                expect(clamp0255(-10)).toBe(0);
                expect(clamp0255(300)).toBe(255);
                expect(clamp0255(0)).toBe(0);
                expect(clamp0255(255)).toBe(255);
            });
        });

        describe('clampNegOneOne()', () => {
            test('clamps values to -1 to 1 range', () => {
                expect(clampNegOneOne(0.5)).toBe(0.5);
                expect(clampNegOneOne(-0.5)).toBe(-0.5);
                expect(clampNegOneOne(-2)).toBe(-1);
                expect(clampNegOneOne(2)).toBe(1);
                expect(clampNegOneOne(-1)).toBe(-1);
                expect(clampNegOneOne(1)).toBe(1);
            });
        });
    });

    describe('Integration', () => {
        test('works with Array methods', () => {
            const values = [1, 5, 10, 15, 20];
            const boundedValues = values.map((v) => clamp(v, 5, 15));
            expect(boundedValues).toEqual([5, 5, 10, 15, 15]);
        });

        test('utility functions work with Array methods', () => {
            const rgbValues = [-10, 128, 300];
            const clampedRgb = rgbValues.map(clamp0255);
            expect(clampedRgb).toEqual([0, 128, 255]);

            const normalizedValues = [-2, 0.5, 2];
            const clampedNormalized = normalizedValues.map(clampNegOneOne);
            expect(clampedNormalized).toEqual([-1, 0.5, 1]);
        });
    });
});
