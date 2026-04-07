import { beforeEach, describe, expect, it } from 'vitest';
import {
    createRandom,
    rand,
    RandomEngineType,
    RandomBuilder,
    UniformDistribution,
    IntegerDistribution,
    NormalDistribution,
    ExponentialDistribution,
    PoissonDistribution,
    BernoulliDistribution,
    BinomialDistribution,
    GeometricDistribution,
    IRandomAPI,
    IRandomState,
} from '../random';

describe('Random Core API', () => {
    it('is deterministic for same seed and engine', () => {
        const r1 = createRandom(42, RandomEngineType.XOROSHIRO128_PLUS_PLUS);
        const r2 = createRandom(42, RandomEngineType.XOROSHIRO128_PLUS_PLUS);

        expect(r1.float()).toBe(r2.float());
        expect(r1.int(1, 10)).toBe(r2.int(1, 10));
        expect(r1.boolean(0.3)).toBe(r2.boolean(0.3));
    });

    it('setSeed resets sequence', () => {
        const r = createRandom();
        const before = r.float();
        r.setSeed(123);
        const firstA = r.float();
        r.setSeed(123);
        const firstB = r.float();
        expect(firstA).toBe(firstB);
        expect(firstA).not.toBe(before);
    });

    it('getState/setState round-trip reproduces values', () => {
        const r = createRandom(7);
        r.int(0, 100);
        const state = r.getState();
        const a = r.int(0, 100);
        r.setState(state);
        const b = r.int(0, 100);
        expect(a).toBe(b);
    });

    it('setEngine switches engine type and preserves as much state as possible', () => {
        const r = createRandom(100, RandomEngineType.XOROSHIRO128_PLUS_PLUS);
        const before = r.float();
        r.setEngine(RandomEngineType.PCG_XSH_RR);
        const after = r.float();
        expect(r.getState().engine).toBe(RandomEngineType.PCG_XSH_RR);
        expect(typeof after).toBe('number');
        expect(Number.isFinite(after)).toBe(true);
    });

    it('fork creates an independent PRNG', () => {
        const parent = createRandom(99);
        const forked = parent.fork();
        const p1 = parent.int(1, 100);
        const f1 = forked.int(1, 100);
        expect(typeof p1).toBe('number');
        expect(typeof f1).toBe('number');
        const p2 = parent.int(1, 100);
        const f2 = forked.int(1, 100);
        expect(p2).not.toBe(f1);
        expect(f2).not.toBe(p1);
    });
});

describe('Collection methods: pick, weighted, shuffle, sample', () => {
    const seed = 2021;
    let r: IRandomAPI;
    beforeEach(() => {
        r = createRandom(seed);
    });

    it('pick chooses a valid element', () => {
        const arr = ['a', 'b', 'c', 'd'];
        const v = r.pick(arr);
        expect(arr).toContain(v);
    });

    it('weighted picks according to weights', () => {
        const items: [string, number][] = [
            ['x', 0],
            ['y', 1],
            ['z', 0],
        ];
        // only 'y' has positive weight
        expect(r.weighted(items)).toBe('y');
    });

    it('shuffle returns a permutation', () => {
        const arr = [1, 2, 3, 4, 5];
        const s = r.shuffle(arr);
        expect(s.sort()).toEqual(arr);
    });

    it('sample returns correct number of distinct items or full shuffle', () => {
        const arr = [1, 2, 3, 4];
        const few = r.sample(arr, 2);
        expect(few.length).toBe(2);
        const all = r.sample(arr, 10);
        expect(all.sort()).toEqual(arr);
    });
});

describe('UUID, bytes, string', () => {
    it('uuid matches v4 pattern', () => {
        const u = createRandom(1).uuid();
        const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        expect(uuidV4.test(u)).toBe(true);
    });

    it('bytes returns correct length and range', () => {
        const b = createRandom(2).bytes(5);
        expect(b).toHaveLength(5);
        for (const x of b) {
            expect(x).toBeGreaterThanOrEqual(0);
            expect(x).toBeLessThanOrEqual(255);
        }
    });

    it('string returns correct length and charset', () => {
        const charset = 'ABC';
        const s = createRandom(3).string(10, charset);
        expect(s).toHaveLength(10);
        for (const c of s) {
            expect(charset).toContain(c);
        }
    });
});

describe('Random.sequence', () => {
    it('take, skip, map, filter work as expected', () => {
        const r = createRandom(5);
        const seq = r.sequence(() => r.int(1, 3));
        const first = seq.next();
        const batch = seq.take(3);
        expect(batch).toHaveLength(3);
        seq.skip(2);
        const mapped = seq.map((x) => x * 2).take(2);
        for (const v of mapped) expect([2, 4, 6]).toContain(v);
        const filtered = seq.filter((x) => x === 2).take(2);
        for (const v of filtered) expect(v).toBe(2);
    });
});

describe('Distribution classes', () => {
    const state0 = createRandom(10).getEngine().getState();
    it('UniformDistribution.sample honors bounds', () => {
        const d = new UniformDistribution(5, 10);
        const [v, s1] = d.sample(state0);
        expect(v).toBeGreaterThanOrEqual(5);
        expect(v).toBeLessThanOrEqual(10);
        expect(s1.counter).toBeGreaterThanOrEqual(0n);
    });

    it('IntegerDistribution validates and samples', () => {
        expect(() => new IntegerDistribution(5, 3)).toThrow();
        const d = new IntegerDistribution(1, 3);
        const [v] = d.sample(state0);
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(3);
    });

    it('Normal, Exponential, Poisson, Bernoulli, Binomial, Geometric produce valid outputs', () => {
        const sd = new NormalDistribution(0, 1);
        const [n] = sd.sample(state0);
        expect(typeof n).toBe('number');

        const ed = new ExponentialDistribution(1);
        expect(ed.sample(state0)[0]).toBeGreaterThanOrEqual(0);

        const pd = new PoissonDistribution(5);
        expect(Number.isInteger(pd.sample(state0)[0])).toBe(true);

        const bd = new BernoulliDistribution(0.5);
        expect(typeof bd.sample(state0)[0]).toBe('boolean');

        const xid = new BinomialDistribution(10, 0.5);
        const bx = xid.sample(state0)[0];
        expect(Number.isInteger(bx)).toBe(true);
        expect(bx).toBeGreaterThanOrEqual(0);
        expect(bx).toBeLessThanOrEqual(10);

        const gd = new GeometricDistribution(0.2);
        const gx = gd.sample(state0)[0];
        expect(Number.isInteger(gx)).toBe(true);
        expect(gx).toBeGreaterThanOrEqual(0);
    });
});

describe('RandomBuilder and default rand', () => {
    it('builder honors seed and engine', () => {
        const r = new RandomBuilder().withSeed(77).withEngine(RandomEngineType.PCG_XSH_RR).build();
        expect(r.getEngine().getState().engine).toBe(RandomEngineType.PCG_XSH_RR);

        // deterministic
        const a = r.int(0, 10);
        const r2 = new RandomBuilder().withSeed(77).withEngine(RandomEngineType.PCG_XSH_RR).build();
        expect(r2.int(0, 10)).toBe(a);
    });

    it('default rand is usable', () => {
        expect(typeof rand.float()).toBe('number');
        expect(typeof rand.boolean()).toBe('boolean');
    });
});
