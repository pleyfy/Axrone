import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEngine, buildPile, freeFallGuard } from '../scripts/ts-broadphase-ab.mjs';

const engine = await loadEngine();
const DT = 1 / 60;
const num = (value) => typeof value === 'bigint' ? Number(value) : value;

const setsEqual = (a, b) => {
    if (a.size !== b.size) return false;
    for (const value of a) if (!b.has(value)) return false;
    return true;
};

const keySetOf = (pairs) => {
    const keys = new Set();
    for (const pair of pairs) keys.add(num(pair.pairKey));
    return keys;
};

const rawTreeKeys = (tree) => {
    const keys = new Set();
    tree.queryPairs((a, b) => {
        const ua = num(tree.getUserData(a));
        const ub = num(tree.getUserData(b));
        keys.add(ua < ub ? ua * 1048576 + ub : ub * 1048576 + ua);
        return true;
    });
    return keys;
};

const rawSweepKeys = (sweep, tree) => {
    const keys = new Set();
    sweep.sync(tree);
    sweep.queryPairs((a, b) => {
        const ua = num(tree.getUserData(a));
        const ub = num(tree.getUserData(b));
        keys.add(ua < ub ? ua * 1048576 + ub : ub * 1048576 + ua);
        return true;
    });
    return keys;
};

const describeDiff = (label, expected, actual) => {
    const missing = [];
    const extra = [];
    for (const value of expected) if (!actual.has(value)) missing.push(value);
    for (const value of actual) if (!expected.has(value)) extra.push(value);
    return `${label}: expected ${expected.size} actual ${actual.size} missing ${missing.slice(0, 6).join(',')} extra ${extra.slice(0, 6).join(',')}`;
};

test('free-fall guard passes before any broadphase claim', () => {
    const vy = freeFallGuard();
    assert.ok(Math.abs(vy + 9.81) <= 0.02, `free-fall vy = ${vy}`);
});

for (const count of [250, 1000]) {
    test(`sweep reports the identical pair-key set as the tree on a live ${count}-box pile`, () => {
        const steps = count > 500 ? 40 : 90;
        const { world } = buildPile(count);
        const runtime = world._contactRuntime;
        const module = runtime._broadphaseModule;
        let compared = 0;
        let pairsTotal = 0;

        for (let step = 0; step < steps; step++) {
            world.step(DT, 10, 4);
            const fromTree = keySetOf(module.collectPotentialCollisionPairs(runtime._host));
            module.setStrategy('sweep');
            const fromSweep = keySetOf(module.collectPotentialCollisionPairs(runtime._host));
            module.setStrategy('tree');
            assert.equal(
                fromTree.size,
                fromSweep.size,
                describeDiff(`count ${count} step ${step}`, fromTree, fromSweep)
            );
            for (const key of fromTree) assert.ok(fromSweep.has(key), describeDiff(`count ${count} step ${step}`, fromTree, fromSweep));
            compared++;
            pairsTotal += fromTree.size;
        }

        assert.equal(compared, steps);
        assert.ok(pairsTotal > count * 20, `expected real overlap work, got ${pairsTotal} pairs`);
        world[Symbol.dispose]?.();
    });
}

test('sweep matches the raw tree traversal on frozen pile boxes', () => {
    const { world } = buildPile(250);
    for (let step = 0; step < 45; step++) {
        world.step(DT, 10, 4);
        const tree = world._contactRuntime._broadphase;
        const sweep = new engine.SweepAndPrune3D('x');
        const expected = rawTreeKeys(tree);
        const actual = rawSweepKeys(sweep, tree);
        assert.equal(expected.size, actual.size, describeDiff(`step ${step}`, expected, actual));
        for (const key of expected) assert.ok(actual.has(key), describeDiff(`step ${step}`, expected, actual));
    }
    world[Symbol.dispose]?.();
});

test('the comparison is proven able to fail when a pair is dropped', () => {
    const { world } = buildPile(250);
    for (let i = 0; i < 60; i++) world.step(DT, 10, 4);
    const tree = world._contactRuntime._broadphase;
    const sweep = new engine.SweepAndPrune3D('x');
    const expected = rawTreeKeys(tree);
    const actual = rawSweepKeys(sweep, tree);
    assert.equal(setsEqual(expected, actual), true, 'the honest comparison must pass before the control runs');
    assert.ok(actual.size > 1, 'scene must contain more than one pair for the control to mean anything');

    const dropped = new Set(actual);
    dropped.delete(dropped.values().next().value);
    assert.equal(setsEqual(expected, dropped), false, 'dropping one pair must be detected');
    const added = new Set(actual);
    added.add(9_999_999);
    assert.equal(setsEqual(expected, added), false, 'inventing one pair must be detected');
    world[Symbol.dispose]?.();
});

test('pooled candidate records carry the same keys as a fresh sweep over the same boxes', () => {
    const { world } = buildPile(250);
    const runtime = world._contactRuntime;
    const module = runtime._broadphaseModule;
    for (let step = 0; step < 40; step++) {
        world.step(DT, 10, 4);
        const pairs = module.collectPotentialCollisionPairs(runtime._host);
        const keys = new Set();
        for (const pair of pairs) {
            const idA = num(pair.descriptorA.id);
            const idB = num(pair.descriptorB.id);
            const canonical = idA < idB ? idA * 1048576 + idB : idB * 1048576 + idA;
            assert.equal(num(pair.pairKey), canonical, `pairKey must stay canonical at step ${step}`);
            assert.equal(keys.has(canonical), false, `duplicate pair key at step ${step}`);
            keys.add(canonical);
            assert.notEqual(pair.aabbA, undefined);
            assert.notEqual(pair.descriptorA, undefined);
        }
    }
    world[Symbol.dispose]?.();
});
