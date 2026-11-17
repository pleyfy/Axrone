import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, '..');
const srcRoot = path.join(packageDir, 'src').replaceAll('\\', '/');
const tmpDir = path.join(packageDir, '.tmp');
const repoRoot = path.resolve(packageDir, '..', '..', '..');

const BASE_REF = process.env.BASE_REF ?? 'df09cb402';
const DT = 1 / 60;
const H = 0.4;
const GROUND_HALF = [40, 0.5, 40];
const VEL_ITERS = 10;
const POS_ITERS = 4;
const WARM_STEPS = 60;
const MEASURED_STEPS = 150;
const REPEATS = Number(process.env.REPEATS ?? 7);
const COUNTS = (process.env.COUNTS ?? '250,1000,2000').split(',').map(Number);

const esbuild = await import('esbuild');

const materialiseBaseSource = () => {
    const target = path.join(tmpDir, `base-src-${BASE_REF}`).replaceAll('\\', '/');
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(packageDir, 'src'), target, { recursive: true });
    const changed = execFileSync('git', ['diff', '--name-only', BASE_REF, '--', 'web/packages/physics-3d/src'], {
        cwd: repoRoot,
        encoding: 'utf8',
    }).split('\n').filter((line) => line.trim().length > 0);
    for (const file of changed) {
        const relative = file.replace('web/packages/physics-3d/src/', '');
        const absolute = path.join(target, relative);
        try {
            const content = execFileSync('git', ['show', `${BASE_REF}:${file}`], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, content);
        } catch {
            fs.rmSync(absolute, { force: true });
        }
    }
    return { target, changed };
};

const bundleSide = async (name, src) => {
    const entry = path.join(tmpDir, `ts-broadphase-source-ab-entry-${name}.ts`);
    fs.writeFileSync(entry, [
        `export { PhysicsWorld3D } from '${src}/core/physics-world-3d';`,
        `export { BodyType } from '${src}/types';`,
        ''
    ].join('\n'));
    const out = path.join(tmpDir, `ts-broadphase-source-ab-${name}.bundle.mjs`);
    await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        platform: 'node',
        outfile: out,
        logLevel: 'silent',
    });
    return { name, src, mod: await import(pathToFileURL(out).href) };
};

const buildPile = (side, count) => {
    const { PhysicsWorld3D, BodyType } = side.mod;
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
    const side3 = Math.round(Math.cbrt(count));
    const layers = Math.ceil(count / (side3 * side3));
    const offset = (side3 - 1) / 2;
    let made = 0;
    for (let layer = 0; layer < layers && made < count; layer++) {
        for (let row = 0; row < side3 && made < count; row++) {
            for (let col = 0; col < side3 && made < count; col++) {
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

const freeFall = (side) => {
    const { PhysicsWorld3D, BodyType } = side.mod;
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

const timed = (side, count) => {
    const { world } = buildPile(side, count);
    for (let i = 0; i < WARM_STEPS; i++) world.step(DT, VEL_ITERS, POS_ITERS);
    let broad = 0;
    let narrow = 0;
    let solve = 0;
    const startedAt = performance.now();
    for (let i = 0; i < MEASURED_STEPS; i++) {
        world.step(DT, VEL_ITERS, POS_ITERS);
        const p = world.getProfiler();
        broad += p.broadphaseTime;
        narrow += p.narrowphaseTime;
        solve += p.solveTime;
    }
    const ms = (performance.now() - startedAt) / MEASURED_STEPS;
    const contacts = world._contactRuntime.contactCount;
    world[Symbol.dispose]?.();
    return { ms, broad: broad / MEASURED_STEPS, narrow: narrow / MEASURED_STEPS, solve: solve / MEASURED_STEPS, contacts };
};

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const edgeText = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return `[${sorted[0].toFixed(4)}, ${sorted[sorted.length - 1].toFixed(4)}]`;
};

fs.mkdirSync(tmpDir, { recursive: true });
const { target: baseSrc, changed } = materialiseBaseSource();
const sides = [
    await bundleSide('base', baseSrc),
    await bundleSide('cand', srcRoot),
];

console.log(`base-ref ${BASE_REF} | files overridden in the base copy: ${changed.length ? changed.join(', ') : '(none)'}`);
for (const side of sides) {
    const vy = freeFall(side);
    const ok = Math.abs(vy + 9.81) <= 0.02;
    console.log(`guard ${side.name} | free-fall vy = ${vy.toFixed(6)} (expect -9.810000 +- 0.02) -> ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) process.exitCode = 1;
}
console.log(`scene | box lattice he ${H}, ground he ${GROUND_HALF.join('/')}, friction 0.7/0.8, e 0, sleep off, policy ${VEL_ITERS}/${POS_ITERS}, dt 1/60`);
console.log(`noise | ${WARM_STEPS} warm + ${MEASURED_STEPS} measured steps, ${REPEATS} interleaved repeats per side, node ${process.version}`);

for (const count of COUNTS) {
    const runs = { base: [], cand: [] };
    const broad = { base: [], cand: [] };
    const narrow = { base: [], cand: [] };
    const solve = { base: [], cand: [] };
    const contacts = { base: 0, cand: 0 };
    for (let r = 0; r < REPEATS; r++) {
        for (const side of sides) {
            const t = timed(side, count);
            runs[side.name].push(t.ms);
            broad[side.name].push(t.broad);
            narrow[side.name].push(t.narrow);
            solve[side.name].push(t.solve);
            contacts[side.name] = t.contacts;
        }
    }
    const b = median(runs.base);
    const c = median(runs.cand);
    console.log(`count=${count}`);
    console.log(`  base median ${b.toFixed(4)} ms/step edges ${edgeText(runs.base)} | broad ${median(broad.base).toFixed(4)} narrow ${median(narrow.base).toFixed(4)} solve ${median(solve.base).toFixed(4)} | contacts ${contacts.base}`);
    console.log(`  cand median ${c.toFixed(4)} ms/step edges ${edgeText(runs.cand)} | broad ${median(broad.cand).toFixed(4)} narrow ${median(narrow.cand).toFixed(4)} solve ${median(solve.cand).toFixed(4)} | contacts ${contacts.cand}`);
    console.log(`  RATIO cand/base step ${(c / b).toFixed(4)}  broad ${(median(broad.cand) / median(broad.base)).toFixed(4)}`);
}
