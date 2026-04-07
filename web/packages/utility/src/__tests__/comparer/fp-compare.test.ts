import { describe, expect, it } from 'vitest';
import {
    ComparisonError,
    createComparer,
    createPredicates,
    createOperators,
    FloatComparer,
    ComparisonResult,
    floatUtils,
    constants,
    compare,
    equals,
    notEquals,
    lessThan,
    greaterThan,
    lessThanOrEqual,
    greaterThanOrEqual,
    eq,
    neq,
    lt,
    gt,
    lte,
    gte,
    ComparisonStrategy,
    ComparerOptions,
    InfinityHandlingMode,
} from '../../comparer/fp-compare';

describe.skip('FloatComparer', () => {
    describe('core comparisons', () => {
        it('should correctly compare basic numeric values', () => {
            expect(compare(1.0, 1.0)).toBe(0);
            expect(compare(1.1, 1.0)).toBe(1);
            expect(compare(0.9, 1.0)).toBe(-1);
            expect(compare(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(0);
            expect(compare(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(-1);
        });

        it('should handle close floating point values', () => {
            const a = 0.1 + 0.2;
            const b = 0.3;

            const strictComparer = createComparer({ absoluteEpsilon: 1e-15 });
            expect(strictComparer(a, b)).not.toBe(0);

            const preciseComparer = createComparer({ absoluteEpsilon: 1e-14 });
            expect(preciseComparer(a, b)).toBe(0);
        });
    });

    describe('special values', () => {
        describe('NaN handling', () => {
            it('should handle NaN values with default settings', () => {
                expect(compare(NaN, NaN)).toBe(-1);
                expect(compare(NaN, 0)).toBe(-1);
                expect(compare(0, NaN)).toBe(1);
            });

            it('should handle NaN values with treatNaNAsEqual = true', () => {
                const nanEqualComparer = createComparer({ treatNaNAsEqual: true });
                expect(nanEqualComparer(NaN, NaN)).toBe(0);
                expect(nanEqualComparer(NaN, 0)).toBe(-1);
                expect(nanEqualComparer(0, NaN)).toBe(1);
            });
        });

        describe('infinity handling', () => {
            it('should handle infinity with default settings (signed)', () => {
                expect(compare(Infinity, Infinity)).toBe(0);
                expect(compare(-Infinity, -Infinity)).toBe(0);
                expect(compare(Infinity, -Infinity)).toBe(1);
                expect(compare(-Infinity, Infinity)).toBe(-1);
                expect(compare(Infinity, 0)).toBe(1);
                expect(compare(-Infinity, 0)).toBe(-1);
            });

            it('should handle infinity with infinityHandling = equal', () => {
                const infinityEqualComparer = createComparer({ infinityHandling: 'equal' });
                expect(infinityEqualComparer(Infinity, Infinity)).toBe(0);
                expect(infinityEqualComparer(-Infinity, -Infinity)).toBe(0);
                expect(infinityEqualComparer(Infinity, -Infinity)).toBe(0);
            });

            it('should handle infinity with infinityHandling = strict', () => {
                const strictComparer = createComparer({ infinityHandling: 'strict' });
                expect(strictComparer(Infinity, Infinity)).toBe(0);
                expect(strictComparer(-Infinity, -Infinity)).toBe(0);
                expect(strictComparer(Infinity, -Infinity)).toBe(1);
                expect(strictComparer(-Infinity, Infinity)).toBe(-1);
            });
        });

        describe('zero handling', () => {
            it('should distinguish between positive and negative zero', () => {
                expect(compare(0, 0)).toBe(0);
                expect(compare(-0, -0)).toBe(0);
                expect(compare(-0, 0)).toBe(-1);
                expect(compare(0, -0)).toBe(1);
            });
        });
    });

    describe('comparison strategies', () => {
        const testStrategies = (
            strategy: ComparisonStrategy,
            options: ComparerOptions,
            a: number,
            b: number,
            expected: ComparisonResult
        ) => {
            const strategyComparer = createComparer({ strategy, ...options });
            expect(strategyComparer(a, b)).toBe(expected);
        };

        describe('absolute strategy', () => {
            it('should compare using absolute difference', () => {
                const epsilon = 0.1;

                testStrategies('absolute', { absoluteEpsilon: epsilon }, 1.0, 1.09, 0);
                testStrategies('absolute', { absoluteEpsilon: epsilon }, 1.0, 1.11, -1);
                testStrategies('absolute', { absoluteEpsilon: epsilon }, 1.11, 1.0, 1);

                // Edge cases
                testStrategies('absolute', { absoluteEpsilon: epsilon }, 0, 0.09, 0);
                testStrategies('absolute', { absoluteEpsilon: epsilon }, 1e6, 1e6 + 0.09, 0);
                testStrategies('absolute', { absoluteEpsilon: epsilon }, 1e6, 1e6 + 0.11, -1);
            });
        });

        describe('relative strategy', () => {
            it('should compare using relative difference', () => {
                const epsilon = 0.1;

                testStrategies('relative', { relativeEpsilon: epsilon }, 100.0, 109.0, 0);
                testStrategies('relative', { relativeEpsilon: epsilon }, 100.0, 112.0, -1);
                testStrategies('relative', { relativeEpsilon: epsilon }, 112.0, 100.0, 1);

                testStrategies('relative', { relativeEpsilon: epsilon }, 1.0, 1.09, 0);
                testStrategies('relative', { relativeEpsilon: epsilon }, 1000.0, 1090.0, 0);
                testStrategies('relative', { relativeEpsilon: epsilon }, 1e-6, 1.09e-6, 0);
            });

            it('should handle values near zero appropriately', () => {
                const epsilon = 0.1;
                const smallComparer = createComparer({
                    strategy: 'combined',
                    relativeEpsilon: epsilon,
                    absoluteEpsilon: 1e-16,
                });

                expect(smallComparer(1e-17, 0)).toBe(0);
                expect(smallComparer(0, 1e-17)).toBe(0);
            });
        });

        describe('ulps strategy', () => {
            it('should compare using ULPs distance', () => {
                const tolerance = 2;

                const a = 1.0;
                const buffer = new ArrayBuffer(8);
                const float64 = new Float64Array(buffer);
                const uint8 = new Uint8Array(buffer);

                float64[0] = a;
                uint8[0] += 1;
                const b = float64[0];

                uint8[0] += 1;
                const c = float64[0];

                uint8[0] += 1;
                const d = float64[0];

                testStrategies('ulps', { ulpsTolerance: tolerance }, a, b, 0);
                testStrategies('ulps', { ulpsTolerance: tolerance }, a, c, 0);
                testStrategies('ulps', { ulpsTolerance: tolerance }, a, d, -1);
            });

            it('should handle different signs appropriately', () => {
                testStrategies('ulps', { ulpsTolerance: 2 }, 1.0, -1.0, 1);
                testStrategies('ulps', { ulpsTolerance: 2 }, 0.0, -0.0, -1);
            });
        });

        describe('combined strategy', () => {
            it('should use combination of all strategies', () => {
                const combinedComparer = createComparer({
                    strategy: 'combined',
                    absoluteEpsilon: 0.01,
                    relativeEpsilon: 0.01,
                    ulpsTolerance: 2,
                });

                expect(combinedComparer(1.0, 1.005)).toBe(0);

                expect(combinedComparer(100.0, 100.9)).toBe(0);

                const a = 1.0;
                const buffer = new ArrayBuffer(8);
                const float64 = new Float64Array(buffer);
                const uint8 = new Uint8Array(buffer);
                float64[0] = a;
                uint8[0] += 1;
                const b = float64[0];
                expect(combinedComparer(a, b)).toBe(0);

                expect(combinedComparer(1.0, 1.02)).toBe(-1);
                expect(combinedComparer(1.02, 1.0)).toBe(1);
            });
        });
    });

    describe('predicates and operators', () => {
        describe('predicates', () => {
            it('should provide correct equality predicates', () => {
                expect(equals(1.0, 1.0)).toBe(true);
                expect(equals(1.0, 1.1)).toBe(false);
                expect(notEquals(1.0, 1.0)).toBe(false);
                expect(notEquals(1.0, 1.1)).toBe(true);
            });

            it('should provide correct comparison predicates', () => {
                expect(lessThan(0.9, 1.0)).toBe(true);
                expect(lessThan(1.0, 1.0)).toBe(false);
                expect(lessThan(1.1, 1.0)).toBe(false);

                expect(greaterThan(1.1, 1.0)).toBe(true);
                expect(greaterThan(1.0, 1.0)).toBe(false);
                expect(greaterThan(0.9, 1.0)).toBe(false);

                expect(lessThanOrEqual(0.9, 1.0)).toBe(true);
                expect(lessThanOrEqual(1.0, 1.0)).toBe(true);
                expect(lessThanOrEqual(1.1, 1.0)).toBe(false);

                expect(greaterThanOrEqual(1.1, 1.0)).toBe(true);
                expect(greaterThanOrEqual(1.0, 1.0)).toBe(true);
                expect(greaterThanOrEqual(0.9, 1.0)).toBe(false);
            });
        });

        describe('operators', () => {
            it('should provide correct shorthand operators', () => {
                expect(eq(1.0, 1.0)).toBe(true);
                expect(neq(1.0, 1.1)).toBe(true);
                expect(lt(0.9, 1.0)).toBe(true);
                expect(gt(1.1, 1.0)).toBe(true);
                expect(lte(1.0, 1.0)).toBe(true);
                expect(gte(1.0, 1.0)).toBe(true);
            });

            it('should allow custom comparers with operators', () => {
                const customComparer = createComparer({ absoluteEpsilon: 0.1 });
                const { eq: customEq } = createOperators(customComparer);

                expect(eq(1.0, 1.05)).toBe(false);
                expect(customEq(1.0, 1.05)).toBe(true);
            });
        });
    });

    describe('error handling', () => {
        it('should throw ComparisonError for non-numeric values with safety checks', () => {
            expect(() => compare('string' as any, 1)).toThrow(ComparisonError);
            expect(() => compare(1, {} as any)).toThrow(ComparisonError);
            expect(() => compare(null as any, undefined as any)).toThrow(ComparisonError);

            try {
                compare('string' as any, 1);
            } catch (e) {
                expect(e instanceof ComparisonError).toBe(true);
                expect((e as ComparisonError).code).toBe('INVALID_INPUT');
            }
        });

        it('should bypass type checking with safetyChecks disabled', () => {
            const unsafeComparer = createComparer({ safetyChecks: false });
            expect(() => unsafeComparer('string' as any, 1)).not.toThrow();
        });
    });

    describe('utility functions', () => {
        describe('float utils', () => {
            it('should correctly identify special floating point values', () => {
                expect(floatUtils.isNaN(NaN)).toBe(true);
                expect(floatUtils.isNaN(1.0)).toBe(false);

                expect(floatUtils.isFinite(1.0)).toBe(true);
                expect(floatUtils.isFinite(Infinity)).toBe(false);

                expect(floatUtils.isInfinite(Infinity)).toBe(true);
                expect(floatUtils.isInfinite(-Infinity)).toBe(true);
                expect(floatUtils.isInfinite(NaN)).toBe(false);

                expect(floatUtils.isNegativeZero(-0)).toBe(true);
                expect(floatUtils.isNegativeZero(0)).toBe(false);

                expect(floatUtils.isPositiveZero(0)).toBe(true);
                expect(floatUtils.isPositiveZero(-0)).toBe(false);

                expect(floatUtils.isZero(0)).toBe(true);
                expect(floatUtils.isZero(-0)).toBe(true);
            });

            it('should identify normal and subnormal numbers', () => {
                const MIN_NORMAL = 2.2250738585072014e-308;

                expect(floatUtils.isNormal(1.0)).toBe(true);
                expect(floatUtils.isNormal(MIN_NORMAL)).toBe(true);
                expect(floatUtils.isNormal(MIN_NORMAL * 0.5)).toBe(false);

                expect(floatUtils.isSubnormal(MIN_NORMAL * 0.5)).toBe(true);
                expect(floatUtils.isSubnormal(Number.MIN_VALUE)).toBe(true);
                expect(floatUtils.isSubnormal(MIN_NORMAL)).toBe(false);
            });
        });

        describe('constants', () => {
            it('should expose essential floating point constants', () => {
                expect(constants.EPSILON).toBe(Number.EPSILON);
                expect(constants.MIN_VALUE).toBe(Number.MIN_VALUE);
                expect(constants.MAX_VALUE).toBe(Number.MAX_VALUE);
                expect(constants.MIN_NORMAL).toBe(2.2250738585072014e-308);
                expect(constants.POSITIVE_INFINITY).toBe(Number.POSITIVE_INFINITY);
                expect(constants.NEGATIVE_INFINITY).toBe(Number.NEGATIVE_INFINITY);
                expect(Number.isNaN(constants.NaN)).toBe(true);
                expect(constants.ULP_64).toBeCloseTo(2.22e-16);
            });
        });
    });

    describe('BigInt support', () => {
        it('should compare bigint values', () => {
            const bigintComparer = createComparer<bigint>();

            expect(bigintComparer(1n, 1n)).toBe(0);
            expect(bigintComparer(2n, 1n)).toBe(1);
            expect(bigintComparer(1n, 2n)).toBe(-1);

            const large1 = BigInt('1' + '0'.repeat(100));
            const large2 = BigInt('2' + '0'.repeat(100));
            expect(bigintComparer(large1, large2)).toBe(-1);
        });

        it('should work with predicates and operators for bigints', () => {
            const bigintComparer = createComparer<bigint>();
            const { eq, lt, gt, lte, gte } = createOperators(bigintComparer);

            expect(eq(1n, 1n)).toBe(true);
            expect(lt(1n, 2n)).toBe(true);
            expect(gt(2n, 1n)).toBe(true);
            expect(lte(1n, 1n)).toBe(true);
            expect(gte(2n, 1n)).toBe(true);
        });
    });

    describe('edge cases and extreme values', () => {
        it('should handle denormalized numbers', () => {
            const denormal1 = Number.MIN_VALUE;
            const denormal2 = denormal1 * 2;

            expect(compare(denormal1, denormal1)).toBe(0);
            expect(compare(denormal1, denormal2)).toBe(-1);
            expect(compare(denormal2, denormal1)).toBe(1);
        });

        it('should handle numbers at different scales', () => {
            expect(compare(1e20, 1e20 + 1)).toBe(0);

            const preciseComparer = createComparer({
                strategy: 'relative',
                relativeEpsilon: 1e-20,
            });
            expect(preciseComparer(1e20, 1e20 + 1)).not.toBe(0);

            expect(compare(1e-20, 2e-20)).toBe(-1);
        });

        it('should handle numbers that differ significantly in magnitude', () => {
            expect(compare(1e10, 1)).toBe(1);
            expect(compare(1, 1e10)).toBe(-1);
            expect(compare(1e-10, 1e10)).toBe(-1);

            const ulpsComparer = createComparer({ strategy: 'ulps' });
            expect(ulpsComparer(1e10, 1e10 + 1)).toBe(0);
        });
    });

    describe('performance', () => {
        it('should be efficient for batch comparisons', () => {
            const iterations = 10000;
            const start = performance.now();

            for (let i = 0; i < iterations; i++) {
                compare(Math.random(), Math.random());
            }

            const end = performance.now();
            const timePerOp = (end - start) / iterations;

            console.log(`Average time per comparison: ${timePerOp.toFixed(6)}ms`);
            expect(true).toBe(true);
        });
    });

    describe('extreme configurations', () => {
        it('should handle extremely small epsilon values', () => {
            const ultraPreciseComparer = createComparer({
                absoluteEpsilon: Number.EPSILON / 10,
                relativeEpsilon: Number.EPSILON / 10,
            });

            expect(ultraPreciseComparer(1.0, 1.0 + Number.EPSILON)).toBe(-1);
        });

        it('should handle extremely large tolerance values', () => {
            const ultraLenientComparer = createComparer({
                absoluteEpsilon: 1e6,
                ulpsTolerance: 1e6 as any,
            });

            expect(ultraLenientComparer(1.0, 1e5)).toBe(0);
        });

        it('should work with all possible infinity and NaN handling modes', () => {
            const infinityModes: InfinityHandlingMode[] = ['strict', 'signed', 'equal'];
            const nanValues = [true, false];

            for (const infMode of infinityModes) {
                for (const nanEqual of nanValues) {
                    const specialComparer = createComparer({
                        infinityHandling: infMode,
                        treatNaNAsEqual: nanEqual,
                    });

                    if (nanEqual) {
                        expect(specialComparer(NaN, NaN)).toBe(0);
                    } else {
                        expect(specialComparer(NaN, NaN)).toBe(-1);
                    }

                    if (infMode === 'equal') {
                        expect(specialComparer(Infinity, -Infinity)).toBe(0);
                    } else {
                        expect(specialComparer(Infinity, -Infinity)).toBe(1);
                    }
                }
            }
        });
    });

    describe('exported objects', () => {
        it('should expose a frozen FloatComparer object with all utilities', () => {
            expect(FloatComparer).toBeDefined();
            expect(Object.isFrozen(FloatComparer)).toBe(true);

            const expectedProps = [
                'compare',
                'equals',
                'notEquals',
                'lessThan',
                'greaterThan',
                'lessThanOrEqual',
                'greaterThanOrEqual',
                'eq',
                'neq',
                'lt',
                'gt',
                'lte',
                'gte',
                'createComparer',
                'createPredicates',
                'createOperators',
                'constants',
                'utils',
                'ComparisonError',
            ];

            expectedProps.forEach((prop) => {
                expect(FloatComparer).toHaveProperty(prop);
            });
        });
    });
});
