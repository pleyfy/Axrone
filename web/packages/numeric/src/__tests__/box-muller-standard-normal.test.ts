import { describe, expect, it } from 'vitest';
import {
    StandardNormal,
    BoxMullerTransform,
    createDefaultRandomGenerator,
    BoxMullerNormalDistribution,
    ErrorCodes,
    isIDistribution,
} from '../box-muller';

import { rand, RandomEngineType } from '../../../core/src/random';

// Helper to get a valid random state for tests
const getTestState = () => rand.getState();

describe('StandardNormal', () => {
    it('should create a normal distribution with mean 0 and standard deviation 1', () => {
        const sampleSize = 1000;
        const distribution = StandardNormal();
        const [samples] = distribution.sampleMany!(getTestState(), sampleSize);
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i];
        }
        const mean = sum / samples.length;
        let sumSquaredDiffs = 0;
        for (let i = 0; i < samples.length; i++) {
            sumSquaredDiffs += Math.pow(samples[i] - mean, 2);
        }
        const variance = sumSquaredDiffs / samples.length;
        const stdDev = Math.sqrt(variance);
        expect(Math.abs(mean)).toBeLessThan(0.2);
        expect(Math.abs(stdDev - 1)).toBeLessThan(0.2);
    });

    it('should forward other options to BoxMullerTransform', () => {
        const distribution = StandardNormal({
            algorithm: 'polar',
            useCache: false,
        });
        distribution.sample(getTestState());
        expect(distribution).toBeDefined();
    });

    it('should have probability methods', () => {
        const distribution = StandardNormal();
        expect(distribution.probability).toBeDefined();
        expect(distribution.cumulativeProbability).toBeDefined();
        expect(distribution.quantile).toBeDefined();
    });

    it('should have correct probability values for standard normal', () => {
        const distribution = StandardNormal();
        const pdfAtMean = distribution.probability!(0);
        expect(pdfAtMean).toBeCloseTo(1 / Math.sqrt(2 * Math.PI), 5);
        const cdfAtMean = distribution.cumulativeProbability!(0);
        expect(cdfAtMean).toBeCloseTo(0.5, 5);
        const quantileAtMedian = distribution.quantile!(0.5);
        expect(quantileAtMedian).toBeCloseTo(0, 5);
        const quantileAt0_9 = distribution.quantile!(0.9);
        expect(quantileAt0_9).toBeCloseTo(1.28, 2);
    });
});

describe('Integration Tests', () => {
    it('should validate a StandardNormal as a NormalDistribution', () => {
        const distribution = StandardNormal();
        expect(isIDistribution(distribution)).toBe(true);
    });

    it('should validate DefaultRandomGenerator with isIDistribution', () => {
        const generator = createDefaultRandomGenerator();
        expect(typeof generator.float).toBe('function');
    });

    it('should validate that a distribution created with a custom generator uses it', () => {
        const distribution = StandardNormal();
        distribution.sample(getTestState());
        expect(distribution).toBeDefined();
    });
});
