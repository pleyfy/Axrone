import { describe, expect, it } from 'vitest';
import { Interpolation } from '../interpolation';

describe('Interpolation', () => {
    describe('Linear', () => {
        it('k=0 returns v[0]', () => {
            expect(Interpolation.Linear([10, 20, 30], 0)).toBe(10);
        });

        it('k=1 returns v[last]', () => {
            expect(Interpolation.Linear([10, 20, 30], 1)).toBe(30);
        });

        it('k=0.5 returns midpoint', () => {
            expect(Interpolation.Linear([0, 100], 0.5)).toBeCloseTo(50, 10);
        });

        it('k=0.5 multi-segment midpoint', () => {
            expect(Interpolation.Linear([0, 50, 100], 0.5)).toBeCloseTo(50, 10);
        });

        it('k<0 extrapolates backward', () => {
            const result = Interpolation.Linear([10, 20], -0.5);
            expect(result).toBeCloseTo(5, 10);
        });

        it('k>1 extrapolates forward', () => {
            const result = Interpolation.Linear([10, 20], 1.5);
            expect(result).toBeCloseTo(25, 10);
        });

        it('single element returns that element', () => {
            expect(Interpolation.Linear([42], 0.5)).toBe(42);
        });
    });

    describe('Bezier', () => {
        it('k=0 returns v[0]', () => {
            expect(Interpolation.Bezier([0, 25, 75, 100], 0)).toBeCloseTo(0, 5);
        });

        it('k=1 returns v[last]', () => {
            expect(Interpolation.Bezier([0, 25, 75, 100], 1)).toBeCloseTo(100, 5);
        });

        it('two-point Bezier is linear', () => {
            expect(Interpolation.Bezier([0, 100], 0.5)).toBeCloseTo(50, 5);
        });

        it('single control point returns that value', () => {
            expect(Interpolation.Bezier([42], 0.5)).toBeCloseTo(42, 5);
        });

        it('symmetric control points produce 0.5 at midpoint', () => {
            expect(Interpolation.Bezier([0, 50, 100], 0.5)).toBeCloseTo(50, 5);
        });
    });

    describe('CatmullRom', () => {
        it('non-periodic: k=0 returns near v[0]', () => {
            const result = Interpolation.CatmullRom([0, 10, 20, 30], 0);
            expect(result).toBeCloseTo(0, 0);
        });

        it('non-periodic: k=1 returns near v[last]', () => {
            const result = Interpolation.CatmullRom([0, 10, 20, 30], 1);
            expect(result).toBeCloseTo(30, 0);
        });

        it('non-periodic: k<0 extrapolates backward', () => {
            const result = Interpolation.CatmullRom([0, 10, 20, 30], -0.5);
            expect(result).toBeLessThan(0);
        });

        it('non-periodic: k>1 extrapolates forward', () => {
            const result = Interpolation.CatmullRom([0, 10, 20, 30], 1.5);
            expect(result).toBeGreaterThan(30);
        });

        it('periodic: v[0]==v[last] uses circular indexing', () => {
            const result = Interpolation.CatmullRom([0, 10, 20, 0], 0.5);
            expect(Number.isFinite(result)).toBe(true);
        });

        it('periodic: k<0 wraps around', () => {
            const result = Interpolation.CatmullRom([0, 10, 20, 0], -0.5);
            expect(Number.isFinite(result)).toBe(true);
        });

        it('two-point degenerate case', () => {
            const result = Interpolation.CatmullRom([0, 10], 0.5);
            expect(Number.isFinite(result)).toBe(true);
        });
    });

    describe('Step', () => {
        it('single element returns that element', () => {
            expect(Interpolation.Step([42], 0.5)).toBe(42);
        });

        it('k=0 returns v[0]', () => {
            expect(Interpolation.Step([10, 20, 30], 0)).toBe(10);
        });

        it('samples the segment holding k', () => {
            expect(Interpolation.Step([10, 20, 30], 0.01)).toBe(10);
            expect(Interpolation.Step([10, 20, 30], 0.5)).toBe(20);
            expect(Interpolation.Step([10, 20, 30], 0.99)).toBe(20);
        });

        it('k=1 returns v[last]', () => {
            expect(Interpolation.Step([10, 20, 30], 1)).toBe(30);
        });
    });

    describe('Smoothstep', () => {
        it('k=0 returns v[0]', () => {
            expect(Interpolation.Smoothstep([10, 20], 0)).toBe(10);
        });

        it('k=1 returns v[last]', () => {
            expect(Interpolation.Smoothstep([10, 20], 1)).toBe(20);
        });

        it('k=0.5 returns midpoint (smooth)', () => {
            expect(Interpolation.Smoothstep([0, 100], 0.5)).toBeCloseTo(50, 5);
        });

        it('smoothstep factor at 0.25 is 0.15625', () => {
            const t = 0.25;
            const smooth = t * t * (3 - 2 * t);
            expect(smooth).toBeCloseTo(0.15625, 10);
            expect(Interpolation.Smoothstep([0, 100], 0.25)).toBeCloseTo(15.625, 5);
        });

        it('single element returns that element', () => {
            expect(Interpolation.Smoothstep([42], 0.5)).toBe(42);
        });

        it('multi-segment interpolation', () => {
            const result = Interpolation.Smoothstep([0, 50, 100], 0.25);
            expect(Number.isFinite(result)).toBe(true);
            expect(result).toBeGreaterThan(0);
            expect(result).toBeLessThan(50);
        });
    });
});
