import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const srcRoot = path.join(packageDir, 'src').replaceAll('\\', '/');
const tmpDir = path.join(packageDir, '.tmp');

const DT = 1 / 60;
const H = 0.4;
const GROUND_HALF = [40, 0.5, 40];
const VEL_ITERS = 10;
const POS_ITERS = 4;
const WARM_STEPS = 60;
const MEASURED_STEPS = 150;
const COUNTS = (process.env.PROBE_COUNTS ?? '250,1000,2000').split(',').map(Number);

let engine = null;

export const loadEngine = async () => {
    const esbuild = await import('esbuild');
    fs.mkdirSync(tmpDir, { recursive: true });
    const entry = path.join(tmpDir, 'ts-broadphase-probe-entry.ts');
    fs.writeFileSync(entry, [
        `export { PhysicsWorld3D } from '${srcRoot}/core/physics-world-3d';`,
        `export { BodyType } from '${srcRoot}/types';`,
        `export { broadphaseDiagnostics, resetBroadphaseDiagnostics, setBroadphaseDiagnosticsEnabled } from '${srcRoot}/core/broadphase-diagnostics-3d';`,
        ''
    ].join('\n'));
    const bundle = path.join(tmpDir, 'ts-broadphase-probe.bundle.mjs');
    await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile: bundle,
        logLevel: 'silent',
    });
    engine = await import(pathToFileURL(bundle).href);
    return engine;
};

const buildPile = (count) => {
    const { PhysicsWorld3D, BodyType } = engine;
    const world = new PhysicsWorld3D({
        gravity: { x: 0, y: -9.81, z: 0 },
        maxBodies: count + 8,
        maxShapes: count + 8,
        maxConstraints: 8,
        allowSleep: false,
        enableProfiler: true,
    });
    const add = (type, pos, he, friction) => {
        const id = world.createBody({
            type,
            position: pos,
            rotation: { x: 0, y: 0, z: 0, w: 1 },
            allowSleep: false,
        });
        world.createBoxShape(id, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: he[0], y: he[1], z: he[2] } }, { friction, restitution: 0 });
        if (type === BodyType.Dynamic) world.getBody(id)?.resetMassData();
        return id;
    };
    add(BodyType.Static, { x: 0, y: -0.5, z: 0 }, GROUND_HALF, 0.8);
    const side = Math.round(Math.cbrt(count));
    const layers = Math.ceil(count / (side * side));
    const offset = (side - 1) / 2;
    let made = 0;
    for (let layer = 0; layer < layers && made < count; layer++) {
        for (let row = 0; row < side && made < count; row++) {
            for (let col = 0; col < side && made < count; col++) {
                add(BodyType.Dynamic, {
                    x: (col - offset) * 2 * H,
                    y: 2 * H + layer * 2 * H,
                    z: (row - offset) * 2 * H,
                }, [H, H, H], 0.7);
                made++;
            }
        }
    }
    return { world, made };
};

const freeFallGuard = () => {
    const { PhysicsWorld3D, BodyType } = engine;
    const world = new PhysicsWorld3D({
        gravity: { x: 0, y: -9.81, z: 0 },
        maxBodies: 8, maxShapes: 8, maxConstraints: 8, allowSleep: false,
    });
    const id = world.createBody({
        type: BodyType.Dynamic, position: { x: 0, y: 60, z: 0 },
        rotation: { x: 0, y: 0, z: 0, w: 1 }, allowSleep: false,
    });
    world.createBoxShape(id, { center: { x: 0, y: 0, z: 0 }, halfExtents: { x: H, y: H, z: H } }, { friction: 0, restitution: 0 });
    world.getBody(id)?.resetMassData();
    for (let i = 0; i < 60; i++) world.step(DT, VEL_ITERS, POS_ITERS);
    return world.getBodyManager().getLinearVelocity(id).y;
};

const runtimeOf = (world) => world._contactRuntime;

const runPass = (count, wrapAabb) => {
    const { world } = buildPile(count);
    const runtime = runtimeOf(world);
    const diag = engine.broadphaseDiagnostics;
    let aabbMs = 0;
    let aabbCalls = 0;
    const host = runtime._host;
    const originalAabb = host.computeShapeAabb;
    if (wrapAabb) {
        host.computeShapeAabb = (descriptor) => {
            const t0 = performance.now();
            const box = originalAabb(descriptor);
            aabbMs += performance.now() - t0;
            aabbCalls++;
            return box;
        };
    }

    for (let i = 0; i < WARM_STEPS; i++) world.step(DT, VEL_ITERS, POS_ITERS);

    engine.resetBroadphaseDiagnostics();
    engine.setBroadphaseDiagnosticsEnabled(true);
    let broadphaseMs = 0;
    let narrowphaseMs = 0;
    let solveMs = 0;
    let stepMs = 0;
    for (let i = 0; i < MEASURED_STEPS; i++) {
        const t0 = performance.now();
        world.step(DT, VEL_ITERS, POS_ITERS);
        stepMs += performance.now() - t0;
        const p = world.getProfiler();
        broadphaseMs += p.broadphaseTime;
        narrowphaseMs += p.narrowphaseTime;
        solveMs += p.solveTime;
    }
    engine.setBroadphaseDiagnosticsEnabled(false);
    host.computeShapeAabb = originalAabb;

    const contactCount = runtime.contactCount;
    world[Symbol.dispose]?.();

    const per = (v) => v / MEASURED_STEPS;
    return {
        count,
        stepMs: per(stepMs),
        broadphaseMs: per(broadphaseMs),
        narrowphaseMs: per(narrowphaseMs),
        solveMs: per(solveMs),
        upkeepMs: per(diag.upkeepMs),
        pairQueryMs: per(diag.pairQueryMs),
        aabbMs: per(aabbMs),
        aabbCalls: per(aabbCalls),
        shapesVisited: per(diag.shapesVisited),
        enabledShapes: per(diag.enabledShapes),
        created: per(diag.proxiesCreated),
        reinserted: per(diag.proxiesReinserted),
        contained: per(diag.proxiesContained),
        nodeVisits: per(diag.pairQueryNodeVisits),
        testedBoxes: per(diag.pairQueryTestedBoxes),
        leafPairs: per(diag.leafPairsReported),
        filtered: per(diag.filteredOut),
        candidates: per(diag.candidates),
        contactCount,
    };
};

const fmt = (v, digits = 4) => v.toFixed(digits);

const main = async () => {
    await loadEngine();
    const vy = freeFallGuard();
    const guardPass = Math.abs(vy + 9.81) <= 0.02;
    console.log(`guard | free-fall 60 steps vy = ${vy.toFixed(6)} (expect -9.810000 +- 0.02) -> ${guardPass ? 'PASS' : 'FAIL'}`);
    if (!guardPass) process.exitCode = 1;
    console.log(`scene | box lattice he ${H}, ground he ${GROUND_HALF.join('/')}, friction 0.7/0.8, e 0, sleep off, policy ${VEL_ITERS}/${POS_ITERS}, dt 1/60, warm ${WARM_STEPS} + measured ${MEASURED_STEPS} steps`);
    console.log(`node ${process.version}`);

    for (const count of COUNTS) {
        const plain = runPass(count, false);
        const wrapped = runPass(count, true);
        console.log('');
        console.log(`count=${count} contacts=${plain.contactCount}`);
        console.log(`  phase ms/step   step ${fmt(plain.stepMs)}  broad ${fmt(plain.broadphaseMs)} (${fmt(100 * plain.broadphaseMs / plain.stepMs, 1)}%)  narrow ${fmt(plain.narrowphaseMs)} (${fmt(100 * plain.narrowphaseMs / plain.stepMs, 1)}%)  solve ${fmt(plain.solveMs)} (${fmt(100 * plain.solveMs / plain.stepMs, 1)}%)`);
        console.log(`  broad split     upkeep ${fmt(plain.upkeepMs)}  pairQuery ${fmt(plain.pairQueryMs)}  (sum ${fmt(plain.upkeepMs + plain.pairQueryMs)} vs profiler ${fmt(plain.broadphaseMs)})`);
        console.log(`  broad split B   upkeep ${fmt(wrapped.upkeepMs)}  pairQuery ${fmt(wrapped.pairQueryMs)}  aabb ${fmt(wrapped.aabbMs)} -> upkeep-minus-aabb ${fmt(wrapped.upkeepMs - wrapped.aabbMs)}  aabbCalls/step ${fmt(wrapped.aabbCalls, 1)}`);
        console.log(`  proxy upkeep    visited ${fmt(plain.shapesVisited, 1)}  enabled ${fmt(plain.enabledShapes, 1)}  created ${fmt(plain.created, 1)}  reinserted ${fmt(plain.reinserted, 1)}  contained ${fmt(plain.contained, 1)}`);
        console.log(`  tree pair query nodeVisits ${fmt(plain.nodeVisits, 1)}  boxTests ${fmt(plain.testedBoxes, 1)}  leafPairs ${fmt(plain.leafPairs, 1)}  filtered ${fmt(plain.filtered, 1)}  candidates ${fmt(plain.candidates, 1)}  contacts ${plain.contactCount}  cand/contact ${fmt(plain.candidates / plain.contactCount, 3)}`);
    }
};

await main();
