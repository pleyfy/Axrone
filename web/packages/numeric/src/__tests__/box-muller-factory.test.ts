import { describe, test, expect, beforeEach, it } from 'vitest';
import { BoxMullerFactory, DefaultRandomGenerator, isIDistribution } from '../box-muller';
import { Random } from '../../../core/src/random';

describe('BoxMullerFactory', () => {
    let random: Random;
    let state: any;

    beforeEach(() => {
        random = new Random(42); // deterministik seed
        state = random.getState();
    });

    describe('createNormal', () => {
        it('should create a distribution with specified mean and standard deviation', () => {
            const mean = 10;
            const stdDev = 2;
            const distribution = BoxMullerFactory.createNormal(mean, stdDev, {
                algorithm: 'polar',
                useCache: false,
            });
            expect(isIDistribution(distribution)).toBe(true);
            let samples: number[] = [];
            let s = state;
            for (let i = 0; i < 50; i++) {
                const [val, next] = distribution.sample(s);
                samples.push(val);
                s = next;
            }
            const sum = samples.reduce((acc, val) => acc + val, 0);
            const calculatedMean = sum / samples.length;
            const sumSquaredDiff = samples.reduce(
                (acc, val) => acc + Math.pow(val - calculatedMean, 2),
                0
            );
            const calculatedStdDev = Math.sqrt(sumSquaredDiff / samples.length);
            expect(Math.abs(calculatedMean - mean)).toBeLessThan(3);
            expect(Math.abs(calculatedStdDev - stdDev)).toBeLessThan(2);
        });

        it('should throw error with invalid parameters', () => {
            expect(() => {
                BoxMullerFactory.createNormal(0, -1);
            }).toThrow();
            expect(() => {
                BoxMullerFactory.createNormal(Infinity, 1);
            }).toThrow();
        });
    });

    describe('createStandard', () => {
        it('should create a standard normal distribution with mean 0 and stddev 1', () => {
            const distribution = BoxMullerFactory.createStandard({});
            expect(isIDistribution(distribution)).toBe(true);
            let samples: number[] = [];
            let s = state;
            for (let i = 0; i < 50; i++) {
                const [val, next] = distribution.sample(s);
                samples.push(val);
                s = next;
            }
            const sum = samples.reduce((acc, val) => acc + val, 0);
            const calculatedMean = sum / samples.length;
            const sumSquaredDiff = samples.reduce(
                (acc, val) => acc + Math.pow(val - calculatedMean, 2),
                0
            );
            const calculatedStdDev = Math.sqrt(sumSquaredDiff / samples.length);
            expect(Math.abs(calculatedMean)).toBeLessThan(0.5);
            expect(Math.abs(calculatedStdDev - 1)).toBeLessThan(0.5);
        });
    });

    describe('createTransformed', () => {
        it('should create a distribution that applies the transform to values', () => {
            const transform = (x: number): number => 2 * x + 5;
            const distribution = BoxMullerFactory.createTransformed<number>(transform, {
                mean: 0,
                standardDeviation: 1,
            });
            expect(isIDistribution(distribution)).toBe(true);
            let s = state;
            const [transformedSample] = distribution.sample(s);
            expect(typeof transformedSample).toBe('number');
            if (distribution.sampleMany) {
                const [samples] = distribution.sampleMany(s, 10);
                expect(samples.length).toBe(10);
                samples.forEach((sample) => {
                    expect(typeof sample).toBe('number');
                });
            }
        });

        it('should work with metadata methods if source has them', () => {
            const transform = (x: number): string => `Value: ${x.toFixed(2)}`;
            const distribution = BoxMullerFactory.createTransformed<string>(transform, {});
            expect(distribution.sampleWithMetadata).toBeDefined();
            expect(distribution.sampleManyWithMetadata).toBeDefined();
            if (distribution.sampleWithMetadata && distribution.sampleManyWithMetadata) {
                const [sampleWithMeta] = distribution.sampleWithMetadata(state);
                expect(typeof sampleWithMeta.value).toBe('string');
                expect(sampleWithMeta.value).toContain('Value:');
                const [samplesWithMeta] = distribution.sampleManyWithMetadata(state, 5);
                expect(samplesWithMeta.length).toBe(5);
                samplesWithMeta.forEach((sample) => {
                    expect(typeof sample.value).toBe('string');
                    expect(sample.value).toContain('Value:');
                });
            }
        });
    });

    describe('Integration tests', () => {
        it('should be able to chain factory methods', () => {
            const standard = BoxMullerFactory.createStandard({});
            const transformed = BoxMullerFactory.createTransformed<number>((x) => x * 3, {
                mean: 10,
            });
            expect(isIDistribution(standard)).toBe(true);
            expect(isIDistribution(transformed)).toBe(true);
            const [standardSample] = standard.sample(state);
            const [transformedSample] = transformed.sample(state);
            expect(typeof standardSample).toBe('number');
            expect(typeof transformedSample).toBe('number');
        });
    });
});
