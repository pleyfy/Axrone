import { describe, it, expect } from 'vitest';
import { EventEmitter } from '@axrone/event';
import { performance } from '../internal/performance';
import {
    EVENT_EMITTER_TAP,
    hasEventTapSupport,
    type EventTapSource,
} from '../internals';

describe('internals.ts', () => {
    describe('EVENT_EMITTER_TAP', () => {
        it('should be a symbol', () => {
            expect(typeof EVENT_EMITTER_TAP).toBe('symbol');
        });

        it('should have a descriptive string representation', () => {
            expect(EVENT_EMITTER_TAP.toString()).toContain('axrone.event.tap');
        });

        it('should be unique (different from other symbols)', () => {
            const otherSymbol = Symbol('axrone.event.tap');
            expect(EVENT_EMITTER_TAP).not.toBe(otherSymbol);
        });
    });

    describe('hasEventTapSupport()', () => {
        it('should return true for EventEmitter instances', () => {
            const emitter = new EventEmitter();
            expect(hasEventTapSupport(emitter)).toBe(true);
            emitter.dispose();
        });

        it('should return false for null', () => {
            expect(hasEventTapSupport(null)).toBe(false);
        });

        it('should return false for undefined', () => {
            expect(hasEventTapSupport(undefined)).toBe(false);
        });

        it('should return false for primitive values', () => {
            expect(hasEventTapSupport(42)).toBe(false);
            expect(hasEventTapSupport('string')).toBe(false);
            expect(hasEventTapSupport(true)).toBe(false);
            expect(hasEventTapSupport(Symbol())).toBe(false);
            expect(hasEventTapSupport(BigInt(0))).toBe(false);
        });

        it('should return false for plain objects without tap support', () => {
            expect(hasEventTapSupport({})).toBe(false);
            expect(hasEventTapSupport({ on: () => {} })).toBe(false);
        });

        it('should return false for objects with EVENT_EMITTER_TAP as non-function', () => {
            const obj = { [EVENT_EMITTER_TAP]: 'not a function' };
            expect(hasEventTapSupport(obj)).toBe(false);
        });

        it('should return true for objects with EVENT_EMITTER_TAP as function', () => {
            const tapSource: EventTapSource = {
                [EVENT_EMITTER_TAP]: () => () => true,
            };
            expect(hasEventTapSupport(tapSource)).toBe(true);
        });

        it('should return false for arrays', () => {
            expect(hasEventTapSupport([])).toBe(false);
        });
    });
});

describe('performance.ts', () => {
    describe('performance.now()', () => {
        it('should return a number', () => {
            const result = performance.now();
            expect(typeof result).toBe('number');
        });

        it('should return a positive value', () => {
            expect(performance.now()).toBeGreaterThan(0);
        });

        it('should be monotonically increasing', () => {
            const t1 = performance.now();
            const t2 = performance.now();
            const t3 = performance.now();

            expect(t2).toBeGreaterThanOrEqual(t1);
            expect(t3).toBeGreaterThanOrEqual(t2);
        });

        it('should return finite values', () => {
            expect(Number.isFinite(performance.now())).toBe(true);
        });

        it('should measure elapsed time', async () => {
            const start = performance.now();
            await new Promise((resolve) => setTimeout(resolve, 20));
            const elapsed = performance.now() - start;

            // Allow some tolerance; should be at least ~15ms
            expect(elapsed).toBeGreaterThanOrEqual(10);
        });
    });
});
