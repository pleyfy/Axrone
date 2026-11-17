import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadEngine, freeFallGuard, measureCase } from '../scripts/ts-solver-dump.mjs';

await loadEngine();

const projection = (dump) => ({
    pointCount: dump.pointCount,
    pairKey: dump.pairKey,
    bodyIdA: dump.bodyIdA,
    bodyIdB: dump.bodyIdB,
    boxIsA: dump.boxIsA,
    normal: dump.normal,
    friction: dump.friction,
    restitution: dump.restitution,
    separations: dump.separations,
    normalMasses: dump.normalMasses,
    points: dump.points.map((p) => ({
        separation: p.separation,
        normalMass: p.normalMass,
        relA: p.relA,
        relB: p.relB,
        localPointA: p.localPointA,
        localPointB: p.localPointB,
    })),
    preBody: dump.preBody,
    stride: {
        worstRelError: dump.stride.worstRelError,
        worstNormalMassError: dump.stride.worstNormalMassError,
    },
});

const encode = (value) => JSON.stringify(value);

const replayErrors = (replays) => replays.map((entry) => {
    const r = entry.result;
    assert.equal(r.ok, true, `replay unavailable: ${r.reason}`);
    const rp = r.replay;
    const m = r.measured;
    return {
        iters: entry.iters,
        fidelity: Math.max(
            Math.abs(rp.finalAngular.x - m.angular.x),
            Math.abs(rp.finalAngular.y - m.angular.y),
            Math.abs(rp.finalAngular.z - m.angular.z)
        ),
        normalOnly: Math.max(
            Math.abs(rp.omegaFromApplied.x - m.angular.x),
            Math.abs(rp.omegaFromApplied.y - m.angular.y),
            Math.abs(rp.omegaFromApplied.z - m.angular.z)
        ),
        appliedNormal: rp.appliedNormal.slice(),
        appliedTangent: rp.appliedTangent.slice(),
        records: m.records.slice(),
    };
});

test('free-fall guard passes before any number is quoted', () => {
    const guard = freeFallGuard({});
    assert.equal(guard.ok, true, `guard vy ${guard.vy} tilt ${guard.tilt}`);
    assert.ok(Math.abs(guard.vy + 9.81) <= 0.02);
    assert.equal(guard.tilt < 1e-6, true);
});

test('the box-on-ground manifold is emitted symmetric with the sphere-path gap convention', () => {
    const { dump } = measureCase({ shape: 'box', friction: 0.7, vel: 10, pos: 4, target: 18 });
    assert.equal(dump.pointCount, 4);
    assert.equal(new Set(dump.separations.map(encode)).size, 1);
    assert.equal(new Set(dump.normalMasses.map(encode)).size, 1);
    assert.equal(dump.stride.worstRelError <= 1e-15, true, `rel error ${dump.stride.worstRelError}`);
    assert.equal(dump.stride.worstNormalMassError <= 1e-15, true, `mass error ${dump.stride.worstNormalMassError}`);
    const expectedGap = dump.preBody.position.y - 0.4;
    assert.equal(Math.abs(dump.separations[0] - expectedGap) < 1e-12, true, `separation ${dump.separations[0]} vs bottom-face gap ${expectedGap}`);
    assert.equal(dump.separations[0] < 0, true);
});

test('the replay reproduces the engine velocity pass exactly at both policies', () => {
    const { replays } = measureCase({ shape: 'box', friction: 0.7, vel: 10, pos: 4, target: 18 });
    const errors = replayErrors(replays);
    for (const entry of errors) assert.equal(entry.fidelity, 0, `iterations ${entry.iters} error ${entry.fidelity}`);
    const ten = errors.find((entry) => entry.iters === 10);
    assert.equal(ten.appliedNormal.length, 4);
    assert.equal(ten.appliedNormal.every((value) => Number.isFinite(value)), true);
});

test('the normal channel alone closes when friction is pinned to zero', () => {
    const { replays } = measureCase({ shape: 'box', friction: 0, vel: 10, pos: 4, target: 18 });
    const errors = replayErrors(replays);
    for (const entry of errors) {
        assert.equal(entry.fidelity, 0, `iterations ${entry.iters} error ${entry.fidelity}`);
        assert.equal(entry.normalOnly < 1e-12, true, `iterations ${entry.iters} normal-only closure error ${entry.normalOnly}`);
        assert.equal(entry.appliedTangent.every((value) => value === 0), true);
    }
});

test('control A: positionIterations 0 reproduces the 10/4 velocity pass at the first contact step', () => {
    const four = measureCase({ shape: 'box', friction: 0.7, vel: 10, pos: 4, target: 18 });
    const zero = measureCase({ shape: 'box', friction: 0.7, vel: 10, pos: 0, target: 18 });
    assert.equal(encode(projection(zero.dump)), encode(projection(four.dump)));
    const fourTen = four.replays.find((entry) => entry.iters === 10).result.replay;
    const zeroTen = zero.replays.find((entry) => entry.iters === 10).result.replay;
    assert.equal(encode(zeroTen.appliedNormal), encode(fourTen.appliedNormal));
    assert.equal(encode(zeroTen.finalAngular), encode(fourTen.finalAngular));
});

test('control B: a sphere on ground yields one point and zero net angular impulse', () => {
    const { dump, replays } = measureCase({ shape: 'sphere', friction: 0.7, vel: 10, pos: 4, target: 18 });
    assert.equal(dump.pointCount, 1);
    for (const value of Object.values(dump.netAngularImpulse)) assert.equal(value, 0);
    for (const value of Object.values(dump.measuredOmega)) assert.equal(value, 0);
    assert.equal(dump.stride.worstNormalMassError <= 1e-15, true);
    for (const entry of replays) {
        const r = entry.result;
        assert.equal(r.ok, true, `replay unavailable: ${r.reason}`);
        assert.equal(r.replay.appliedNormal.length, 1);
        assert.equal(Math.max(...r.replay.appliedNormal) > 0, true);
    }
});
