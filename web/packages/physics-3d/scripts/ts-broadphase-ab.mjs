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
const REPEATS = Number(process.env.REPEATS ?? 7);
const PAIR_REPEATS = Number(process.env.PAIR_REPEATS ?? 15);
const COUNTS = (process.env.COUNTS ?? '250,1000,2000').split(',').map(Number);

let engine = null;

export const loadEngine = async () => {
    const esbuild = await import('esbuild');
    fs.mkdirSync(tmpDir, { recursive: true });
    const entry = path.join(tmpDir, 'ts-broadphase-ab-entry.ts');
    fs.writeFileSync(entry, [
        `export { PhysicsWorld3D } from '${srcRoot}/core/physics-world-3d';`,
        `export { BodyType } from '${srcRoot}/types';`,
        `export { SweepAndPrune3D } from '${srcRoot}/core/broadphase-sweep-3d';`,
        `export { setDefaultBroadphaseStrategy, getDefaultBroadphaseStrategy } from '${srcRoot}/core/physics-world-3d-broadphase';`,
        `export { broadphaseDiagnostics, resetBroadphaseDiagnostics, setBroadphaseDiagnosticsEnabled } from '${srcRoot}/core/broadphase-diagnostics-3d';`,
        ''
    ].join('\n'));
    const bundle = path.join(tmpDir, 'ts-broadphase-ab.bundle.mjs');
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
        const id = world.createBody({ type, position: pos, rotation: { x: 0, y: 0, z: 0, w: 1 }, allowSleep: false });
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

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const edges = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return `[${sorted[0].toFixed(4)}, ${sorted[sorted.length - 1].toFixed(4)}]`;
};

const num = (value) => typeof value === 'bigint' ? Number(value) : value;

const collectKeySet = (source, tree) => {
    const keys = new Set();
    const userData = tree.getUserData.bind(tree);
    source.queryPairs((a, b) => {
        const ua = num(userData(a));
        const ub = num(userData(b));
        keys.add(a < b ? ua * 1048576 + ub : ub * 1048576 + ua);
        return true;
    });
    return keys;
};

const pairGenerationBench = (count) => {
    const { SweepAndPrune3D } = engine;
    const { world } = buildPile(count);
    for (let i = 0; i < WARM_STEPS; i++) world.step(DT, VEL_ITERS, POS_ITERS);

    const runtime = world._contactRuntime;
    const tree = runtime._broadphase;
    const sweep = new SweepAndPrune3D('x');
    const emit = [];

    sweep.sync(tree);
    const treeKeys = collectKeySet(tree, tree);
    const sweepKeys = collectKeySet(sweep, tree);
    let same = treeKeys.size === sweepKeys.size;
    if (same) for (const key of treeKeys) if (!sweepKeys.has(key)) { same = false; break; }

    const timeTree = () => {
        emit.length = 0;
        const t0 = performance.now();
        tree.queryPairs((a, b) => {
            emit.push(a < b ? a * 1048576 + b : b * 1048576 + a);
            return true;
        });
        return performance.now() - t0;
    };
    const timeSweepSync = () => {
        const t0 = performance.now();
        sweep.sync(tree);
        return performance.now() - t0;
    };
    const timeSweepFull = () => {
        emit.length = 0;
        const t0 = performance.now();
        sweep.sync(tree);
        sweep.queryPairs((a, b) => {
            emit.push(a < b ? a * 1048576 + b : b * 1048576 + a);
            return true;
        });
        return performance.now() - t0;
    };

    const treeRuns = [];
    const sweepRuns = [];
    const syncRuns = [];
    for (let r = 0; r < PAIR_REPEATS; r++) {
        treeRuns.push(timeTree());
        sweepRuns.push(timeSweepFull());
        syncRuns.push(timeSweepSync());
    }
    const sweepOnly = sweepRuns.map((value, index) => value - syncRuns[index]);

    const treeMedian = median(treeRuns);
    const sweepMedian = median(sweepRuns);
    const result = {
        count,
        pairs: treeKeys.size,
        sameSet: same,
        treeMedian,
        sweepMedian,
        syncMedian: median(syncRuns),
        sweepOnlyMedian: median(sweepOnly),
        treeEdges: edges(treeRuns),
        sweepEdges: edges(sweepRuns),
        ratio: sweepMedian / treeMedian,
    };
    world[Symbol.dispose]?.();
    return result;
};

const stepBench = (count, strategy) => {
    engine.setDefaultBroadphaseStrategy(strategy);
    const { world } = buildPile(count);
    engine.setDefaultBroadphaseStrategy('tree');
    for (let i = 0; i < WARM_STEPS; i++) world.step(DT, VEL_ITERS, POS_ITERS);
    const t0 = performance.now();
    for (let i = 0; i < MEASURED_STEPS; i++) world.step(DT, VEL_ITERS, POS_ITERS);
    const ms = (performance.now() - t0) / MEASURED_STEPS;
    const profiler = world.getProfiler();
    const result = { ms, broadphaseMs: profiler.broadphaseTime, narrowphaseMs: profiler.narrowphaseTime, contacts: world._contactRuntime.contactCount };
    world[Symbol.dispose]?.();
    return result;
};

const main = async () => {
    await loadEngine();
    const vy = freeFallGuard();
    const pass = Math.abs(vy + 9.81) <= 0.02;
    console.log(`guard | free-fall 60 steps vy = ${vy.toFixed(6)} (expect -9.810000 +- 0.02) -> ${pass ? 'PASS' : 'FAIL'}`);
    if (!pass) process.exitCode = 1;
    console.log(`load | ${Date().toString()}`);
    console.log(`scene | box lattice he ${H}, ground he ${GROUND_HALF.join('/')}, friction 0.7/0.8, e 0, sleep off, policy ${VEL_ITERS}/${POS_ITERS}, dt 1/60`);
    console.log(`node ${process.version} | pair-generation repeats ${PAIR_REPEATS} (interleaved) | step repeats ${REPEATS} (interleaved), ${WARM_STEPS} warm + ${MEASURED_STEPS} measured steps`);

    console.log('');
    console.log('== pair generation on frozen pile boxes (identical input boxes, tree traversal vs sweep) ==');
    for (const count of COUNTS) {
        const r = pairGenerationBench(count);
        console.log(`count=${count} pairs=${r.pairs} setEqual=${r.sameSet}`);
        console.log(`  tree  median ${r.treeMedian.toFixed(4)} ms  edges ${r.treeEdges}`);
        console.log(`  sweep median ${r.sweepMedian.toFixed(4)} ms  edges ${r.sweepEdges}  (sync ${r.syncMedian.toFixed(4)} + sweep ${r.sweepOnlyMedian.toFixed(4)})`);
        console.log(`  RATIO sweep/tree = ${r.ratio.toFixed(4)}`);
        if (!r.sameSet) process.exitCode = 1;
    }

    console.log('');
    console.log('== end-to-end step, strategy default(tree) vs strategy sweep(candidate) ==');
    for (const count of COUNTS) {
        const treeRuns = [];
        const sweepRuns = [];
        const treeBroad = [];
        const sweepBroad = [];
        let contacts = { tree: 0, sweep: 0 };
        for (let r = 0; r < REPEATS; r++) {
            const a = stepBench(count, 'tree');
            const b = stepBench(count, 'sweep');
            treeRuns.push(a.ms);
            sweepRuns.push(b.ms);
            treeBroad.push(a.broadphaseMs);
            sweepBroad.push(b.broadphaseMs);
            contacts = { tree: a.contacts, sweep: b.contacts };
        }
        const treeMedian = median(treeRuns);
        const sweepMedian = median(sweepRuns);
        console.log(`count=${count} contacts tree ${contacts.tree} / sweep ${contacts.sweep}`);
        console.log(`  step  tree  median ${treeMedian.toFixed(4)} ms/step edges ${edges(treeRuns)}  broad ${median(treeBroad).toFixed(4)}`);
        console.log(`  step  sweep median ${sweepMedian.toFixed(4)} ms/step edges ${edges(sweepRuns)}  broad ${median(sweepBroad).toFixed(4)}`);
        console.log(`  RATIO sweep/tree = ${(sweepMedian / treeMedian).toFixed(4)}  broadphase ratio = ${(median(sweepBroad) / median(treeBroad)).toFixed(4)}`);
    }
};

const isMain = process.argv[1] !== undefined && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) await main();

export { buildPile, freeFallGuard };
