import { describe, expect, it } from 'vitest';
import { create, fromValue, tryLazy, ILazy } from '../../memory/lazy';

describe('Lazy', () => {
    it('should evaluate lazily and cache the result', () => {
        let called = 0;
        const lazy = create(() => {
            called++;
            return 42;
        });
        expect(called).toBe(0);
        expect(lazy.IsValueCreated).toBe(false);
        expect(lazy.Value).toBe(42);
        expect(called).toBe(1);
        expect(lazy.Value).toBe(42);
        expect(called).toBe(1);
        expect(lazy.IsValueCreated).toBe(true);
    });

    it('should throw and cache exception if factory throws', () => {
        const error = new Error('fail');
        const lazy = create(() => {
            throw error;
        });
        expect(() => lazy.Value).toThrow(error);
        expect(() => lazy.Value).toThrow(error);
        expect(lazy.IsValueFaulted).toBe(true);
    });

    it('should detect circular dependency', () => {
        const lazy = create(
            () => (lazy as unknown as ILazy<number>).Value
        ) as unknown as ILazy<number>;
        expect(() => lazy.Value).toThrow(/Circular dependency/);
    });

    it('should support Map and FlatMap', () => {
        const lazy = fromValue(10);
        const mapped = lazy.map((x) => x * 2);
        expect(mapped.Value).toBe(20);
        const flatMapped = lazy.flatMap((x) => fromValue(x + 5));
        expect(flatMapped.Value).toBe(15);
    });

    it('should support Filter (type guard)', () => {
        const lazy = fromValue('hello');
        const filtered = lazy.filter((v): v is string => typeof v === 'string');
        expect(filtered.Value).toBe('hello');
        // Only test valid type guards for the value type
    });

    it('should support Filter (boolean)', () => {
        const lazy = fromValue(5);
        const filtered = lazy.filter((x) => x > 0);
        expect(filtered.Value).toBe(5);
        const failFilter = lazy.filter((x) => x < 0);
        expect(() => failFilter.Value).toThrow(/Predicate failed/);
    });

    it('should support OrElse', () => {
        const lazy = create(() => {
            throw new Error('fail');
        });
        const fallback = (lazy as unknown as ILazy<number>).orElse(() => 99);
        expect(fallback.Value).toBe(99);
        const good = fromValue(123).orElse(() => 0);
        expect(good.Value).toBe(123);
    });

    it('should support Catch', () => {
        const lazy = create(() => {
            throw new Error('fail');
        });
        const caught = lazy.catch((err) => err.message);
        expect(caught.Value).toBe('fail');
        const good = fromValue(7).catch(() => 0);
        expect(good.Value).toBe(7);
    });

    it('should support Tap', () => {
        let tapped: number = 0;
        const lazy = fromValue(5).tap((x) => {
            tapped = x;
        });
        expect(lazy.Value).toBe(5);
        expect(tapped).toBe(5);
    });

    it('should support Force', () => {
        const lazy = create(() => 77);
        expect(lazy.force()).toBe(77);
    });

    it('should support Reset', () => {
        let count = 0;
        const lazy = create(() => ++count);
        expect(lazy.Value).toBe(1);
        const reset = lazy.reset();
        expect(reset.Value).toBe(2);
    });

    it('should convert to async', async () => {
        const lazy = fromValue(42);
        const asyncLazy = lazy.toAsync();
        await expect(asyncLazy.Value).resolves.toBe(42);
    });

    it('should support Try utility', () => {
        const good = tryLazy(() => 1);
        expect(good.Value).toBe(1);
        const bad = tryLazy(() => {
            throw new Error('fail');
        });
        expect(bad.Value).toBeInstanceOf(Error);
        expect((bad.Value as Error).message).toBe('fail');
    });
});
