/**
 * Deterministic tilemap benchmark harness.
 *
 * Usage (build first: `yarn workspace @axrone/tilemap build`):
 *   node bench/run.mjs             # measure, print table
 *   node bench/run.mjs --check     # compare against baseline.json
 *   node bench/run.mjs --update    # rewrite baseline.json
 *   node bench/run.mjs --json      # machine-readable output
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ChunkStore,
    TileCodec,
    TilemapBuilder,
    decodeChunkSnapshot,
    encodeChunkSnapshot,
    packChunkKey,
} from '../dist/index.mjs';
import {
    createRaycastHit,
    createSweepHit,
    extractViewportInstances,
    raycastTilemap,
    sweepTilemapAabb,
    ViewportTileBuffer,
    viewportGridBounds,
} from '../dist/query.mjs';
import { findPath } from '../dist/path.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const baselinePath = path.join(here, 'baseline.json');
const GATE = 1.1;
/**
 * Per-scenario gates. `path` runs 1k A* queries and is dominated by pool
 * churn/GC; its min-of-5 spread is up to ~15% on the reference machine, so a
 * 10% gate would flake. Everything else keeps 10%.
 */
const SCENARIO_GATES = { path: 1.25 };
const RUNS = 5;

const args = new Set(process.argv.slice(2));
const checkMode = args.has('--check');
const updateMode = args.has('--update');
const jsonMode = args.has('--json');
/**
 * Shared dev machines are too noisy for a 10% gate (observed 25-50% swings
 * while the ALU calibration stays flat). `--relaxed` widens every gate by 50%;
 * a dedicated/quiet machine keeps the strict default.
 */
const RELAXED_FACTOR = 1.5;
const relaxedMode = args.has('--relaxed');

const mulberry32 = (seed) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let value = state;
        value = Math.imul(value ^ (value >>> 15), value | 1);
        value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
        return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
    };
};

const word = (tileId) => TileCodec.pack(tileId);
const nowMs = () => Number(process.hrtime.bigint()) / 1e6;

const percentile = (sorted, fraction) => {
    if (sorted.length === 0) return 0;
    const index = Math.min(
        sorted.length - 1,
        Math.max(0, Math.ceil(fraction * sorted.length) - 1)
    );
    return sorted[index];
};

const measure = (scenario) => {
    scenario.setup?.();
    const runs = [];
    for (let run = 0; run < RUNS; run++) {
        const start = nowMs();
        scenario.run();
        runs.push(nowMs() - start);
    }
    scenario.dispose?.();
    const sorted = [...runs].sort((left, right) => left - right);
    const p50Ms = percentile(sorted, 0.5);
    return {
        name: scenario.name,
        ops: scenario.ops,
        runsMs: runs,
        minMs: sorted[0],
        p50Ms,
        p95Ms: percentile(sorted, 0.95),
        opsPerSecond: scenario.ops / (p50Ms / 1000),
    };
};

const createEngine = (maxLoadedChunks) =>
    TilemapBuilder.create()
        .withProjection({ kind: 'orthogonal', tileWidth: 16, tileHeight: 16 })
        .withChunkShift(4)
        .withCapacity(maxLoadedChunks)
        .withDirtyBudget(64)
        .withLayers([{ name: 'ground' }])
        .build()
        .get();

const writeScenario = () => {
    const engine = createEngine(256);
    const random = mulberry32(0x51ee7);
    const writes = 1_000_000;
    return {
        name: 'write',
        ops: writes,
        setup() {
            engine.write('ground', 0, 0, word(1));
        },
        run() {
            for (let index = 0; index < writes; index++) {
                const gridX = Math.floor(random() * 256) - 128;
                const gridY = Math.floor(random() * 256) - 128;
                engine.write('ground', gridX, gridY, word(1 + (index & 7)));
            }
        },
        dispose() {
            engine.dispose();
        },
    };
};

const readScenario = () => {
    const engine = createEngine(1024);
    const random = mulberry32(0xdead71e);
    const reads = 10_000_000;
    const hotspotCount = 512;
    const hotspotX = new Int32Array(hotspotCount);
    const hotspotY = new Int32Array(hotspotCount);
    for (let index = 0; index < hotspotCount; index++) {
        hotspotX[index] = Math.floor(random() * 1024) - 512;
        hotspotY[index] = Math.floor(random() * 1024) - 512;
        engine.write('ground', hotspotX[index], hotspotY[index], word(3));
    }
    return {
        name: 'read',
        ops: reads,
        run() {
            let sink = 0;
            for (let index = 0; index < reads; index++) {
                const hot = random() < 0.9;
                const slot = index & (hotspotCount - 1);
                const gridX = hot
                    ? hotspotX[slot]
                    : Math.floor(random() * 4096) - 2048;
                const gridY = hot
                    ? hotspotY[slot]
                    : Math.floor(random() * 4096) - 2048;
                sink ^= engine.readAt('ground', gridX, gridY);
            }
            if (sink === 0x7fffffff) throw new Error('unreachable');
        },
        dispose() {
            engine.dispose();
        },
    };
};

const viewportScenario = () => {
    const engine = createEngine(256);
    const chunkSize = 16;
    const chunkCount = 16;
    for (let chunkY = 0; chunkY < chunkCount; chunkY++) {
        for (let chunkX = 0; chunkX < chunkCount; chunkX++) {
            const baseX = chunkX * chunkSize;
            const baseY = chunkY * chunkSize;
            engine.write('ground', baseX + 1, baseY + 1, word(1));
            engine.write('ground', baseX + 2, baseY + 1, word(2));
            engine.write('ground', baseX + 1, baseY + 2, word(3));
        }
    }
    const buffer = new ViewportTileBuffer();
    const frames = 512;
    const cameraWidth = 640;
    const cameraHeight = 360;
    return {
        name: 'viewport',
        ops: frames,
        run() {
            for (let frame = 0; frame < frames; frame++) {
                const camera = {
                    x: frame * 2,
                    y: (frame % 64) * 2,
                    width: cameraWidth,
                    height: cameraHeight,
                };
                const bounds = viewportGridBounds(engine.projection, camera);
                extractViewportInstances(engine, 'ground', bounds, buffer);
            }
        },
        dispose() {
            engine.dispose();
        },
    };
};

const codecScenario = () => {
    const random = mulberry32(0xc0dec);
    const chunkArea = 1 << 8;
    const chunks = [];
    for (let chunk = 0; chunk < 64; chunk++) {
        const words = new Uint32Array(chunkArea * 4);
        for (let index = 0; index < words.length; index++) {
            words[index] = random() < 0.7 ? 0 : (index & 0x3fff) + 1;
        }
        chunks.push({
            key: packChunkKey(chunk % 8, Math.floor(chunk / 8)),
            chunkShift: 4,
            layerCount: 4,
            words,
        });
    }
    const iterations = 10_000;
    return {
        name: 'codec',
        ops: iterations,
        run() {
            for (let index = 0; index < iterations; index++) {
                const snapshot = chunks[index & 63];
                const encoded = encodeChunkSnapshot(snapshot);
                if (encoded.isErr()) throw new Error('encode failed');
                const decoded = decodeChunkSnapshot(encoded.get());
                if (decoded.isErr()) throw new Error('decode failed');
            }
        },
    };
};

let allocHeapDelta = null;

const allocScenario = () => {
    const store = new ChunkStore({
        chunkShift: 4,
        layerCount: 1,
        maxLoadedChunks: 64,
        maxDirtyChunks: 8,
        defaultWords: new Uint32Array([0]),
    });
    const cycles = 100_000;
    const gc = globalThis.gc;
    allocHeapDelta = null;
    return {
        name: 'alloc',
        ops: cycles,
        setup() {
            gc?.();
        },
        run() {
            const before = process.memoryUsage().heapUsed;
            for (let index = 0; index < cycles; index++) {
                const chunkX = index & 63;
                const chunkY = (index >> 6) & 63;
                store.acquireLease(packChunkKey(chunkX, chunkY)).get().release();
            }
            allocHeapDelta = process.memoryUsage().heapUsed - before;
        },
        dispose() {
            store.dispose();
        },
    };
};

const createArena = () => {
    const engine = createEngine(512);
    const random = mulberry32(0x5eed5eed);
    for (let gridY = 0; gridY < 256; gridY++) {
        for (let gridX = 0; gridX < 256; gridX++) {
            if (gridX > 2 && gridY > 2 && random() < 0.06) {
                engine.write('ground', gridX, gridY, TileCodec.pack(1, 0, 1));
            }
        }
    }
    return engine;
};

const raycastScenario = () => {
    const engine = createArena();
    const random = mulberry32(0x1234abcd);
    const rays = 100_000;
    const origins = new Float64Array(rays * 2);
    const directions = new Float64Array(rays * 2);
    for (let index = 0; index < rays; index++) {
        origins[index * 2] = random() * 240;
        origins[index * 2 + 1] = random() * 240;
        const angle =
            index % 2 === 0 ? Math.PI / 4 : (index % 4) * (Math.PI / 2);
        directions[index * 2] = Math.cos(angle) * 32;
        directions[index * 2 + 1] = Math.sin(angle) * 32;
    }
    const hit = createRaycastHit();
    return {
        name: 'raycast',
        ops: rays,
        run() {
            let hits = 0;
            for (let index = 0; index < rays; index++) {
                if (
                    raycastTilemap(
                        engine,
                        'ground',
                        origins[index * 2],
                        origins[index * 2 + 1],
                        directions[index * 2],
                        directions[index * 2 + 1],
                        { maxDistance: 128 },
                        hit
                    )
                ) {
                    hits++;
                }
            }
            if (hits < 0) throw new Error('unreachable');
        },
        dispose() {
            engine.dispose();
        },
    };
};

const sweepScenario = () => {
    const engine = createArena();
    const random = mulberry32(0x77aa55bb);
    const sweeps = 100_000;
    const boxes = new Array(sweeps);
    const deltas = new Float64Array(sweeps * 2);
    for (let index = 0; index < sweeps; index++) {
        boxes[index] = {
            x: random() * 240,
            y: random() * 240,
            width: 8,
            height: 8,
        };
        const angle =
            index % 2 === 0 ? Math.PI / 4 : (index % 4) * (Math.PI / 2);
        deltas[index * 2] = Math.cos(angle) * 8;
        deltas[index * 2 + 1] = Math.sin(angle) * 8;
    }
    const hit = createSweepHit();
    return {
        name: 'sweep',
        ops: sweeps,
        run() {
            let collisions = 0;
            for (let index = 0; index < sweeps; index++) {
                if (
                    sweepTilemapAabb(
                        engine,
                        'ground',
                        boxes[index],
                        deltas[index * 2],
                        deltas[index * 2 + 1],
                        {},
                        hit
                    )
                ) {
                    collisions++;
                }
            }
            if (collisions < 0) throw new Error('unreachable');
        },
        dispose() {
            engine.dispose();
        },
    };
};

const pathScenario = () => {
    const engine = createArena();
    const random = mulberry32(0x9a5f3c1d);
    const queries = 1000;
    const starts = new Int32Array(queries * 2);
    const goals = new Int32Array(queries * 2);
    const walkable = () => {
        for (let attempt = 0; attempt < 64; attempt++) {
            const gridX = Math.floor(random() * 256);
            const gridY = Math.floor(random() * 256);
            if (engine.readAt('ground', gridX, gridY) === 0) return [gridX, gridY];
        }
        return [0, 0];
    };
    for (let index = 0; index < queries; index++) {
        const start = walkable();
        const goal = walkable();
        starts[index * 2] = start[0];
        starts[index * 2 + 1] = start[1];
        goals[index * 2] = goal[0];
        goals[index * 2 + 1] = goal[1];
    }
    const out = new Int32Array(8192);
    return {
        name: 'path',
        ops: queries,
        run() {
            let found = 0;
            let waypoints = 0;
            for (let index = 0; index < queries; index++) {
                const result = findPath(
                    engine,
                    'ground',
                    starts[index * 2],
                    starts[index * 2 + 1],
                    goals[index * 2],
                    goals[index * 2 + 1],
                    {
                        allowDiagonal: index % 2 === 0,
                        maxExpandedNodes: 20_000,
                        out,
                    }
                );
                if (result.status === 'found') {
                    found++;
                    waypoints += result.count;
                }
            }
            if (found < 0 || waypoints < 0) throw new Error('unreachable');
        },
        dispose() {
            engine.dispose();
        },
    };
};

const calibrationScenario = () => {
    const iterations = 50_000_000;
    return {
        name: 'calibration',
        ops: iterations,
        run() {
            let state = 0x9e3779b9 | 0;
            for (let index = 0; index < iterations; index++) {
                state ^= state << 13;
                state ^= state >>> 17;
                state ^= state << 5;
            }
            if (state === 0x7fffffff) throw new Error('unreachable');
        },
    };
};

const scenarios = [
    writeScenario(),
    readScenario(),
    viewportScenario(),
    raycastScenario(),
    sweepScenario(),
    pathScenario(),
    codecScenario(),
    allocScenario(),
];

const calibrationStart = measure(calibrationScenario());
const results = scenarios.map(measure);
const calibrationEnd = measure(calibrationScenario());
const calibrationMs = (calibrationStart.minMs + calibrationEnd.minMs) / 2;
const loadScale = (baselineCalibration) =>
    baselineCalibration === undefined
        ? 1
        : Math.min(3, Math.max(0.5, calibrationMs / baselineCalibration));

const machine = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
};

if (checkMode) {
    if (!fs.existsSync(baselinePath)) {
        console.error('No baseline.json; run with --update first.');
        process.exit(1);
    }
    const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
    const sameMachine =
        baseline.machine.platform === machine.platform &&
        baseline.machine.arch === machine.arch;
    if (!sameMachine) {
        console.error(
            `Baseline was recorded on ${baseline.machine.platform}/${baseline.machine.arch}; ` +
                'timings are not comparable on this machine.'
        );
        process.exit(1);
    }
    let failures = 0;
    const scale = loadScale(baseline.calibration?.minMs);
    console.log(
        `Gate: ${relaxedMode ? 'relaxed (strict x1.5)' : 'strict'} | ` +
            `Load calibration: ${calibrationMs.toFixed(3)} ms ` +
            `(baseline ${baseline.calibration?.minMs?.toFixed(3) ?? 'n/a'} ms, scale x${scale.toFixed(2)})`
    );
    for (const result of results) {
        const reference = baseline.scenarios[result.name];
        if (reference === undefined) {
            continue;
        }
        const referenceMs = reference.minMs ?? reference.p50Ms;
        const strictGate =
            reference.gate ?? SCENARIO_GATES[result.name] ?? GATE;
        const gate = relaxedMode ? strictGate * RELAXED_FACTOR : strictGate;
        const limit = referenceMs * gate * scale;
        const ok = result.minMs <= limit;
        if (!ok) failures++;
        console.log(
            `${ok ? 'PASS' : 'FAIL'} ${result.name}: min ${result.minMs.toFixed(3)} ms ` +
                `(baseline ${referenceMs.toFixed(3)} ms, limit ${limit.toFixed(3)} ms)`
        );
    }
    process.exit(failures === 0 ? 0 : 1);
}

const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    machine,
    gate: GATE,
    calibration: {
        ops: calibrationStart.ops,
        minMs: calibrationMs,
        startMs: calibrationStart.minMs,
        endMs: calibrationEnd.minMs,
    },
    scenarios: Object.fromEntries(
        results.map((result) => [
            result.name,
            {
                ops: result.ops,
                minMs: result.minMs,
                p50Ms: result.p50Ms,
                p95Ms: result.p95Ms,
                opsPerSecond: result.opsPerSecond,
                gate: SCENARIO_GATES[result.name] ?? GATE,
                allocBytes: result.name === 'alloc' ? allocHeapDelta : null,
            },
        ])
    ),
};

if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
} else {
    console.log(
        `tilemap bench — node ${machine.node}, ${machine.platform}/${machine.arch}`
    );
    for (const result of results) {
        console.log(
            `  ${result.name.padEnd(9)} min ${result.minMs.toFixed(3)} ms  ` +
                `p50 ${result.p50Ms.toFixed(3)} ms  ` +
                `p95 ${result.p95Ms.toFixed(3)} ms  ` +
                `${Math.round(result.opsPerSecond).toLocaleString('en-US')} ops/s`
        );
    }
    if (allocHeapDelta !== null) {
        console.log(
            `  alloc     heap delta ${(allocHeapDelta / 1024).toFixed(1)} KiB over 100k lease cycles`
        );
    }
}

if (updateMode) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(payload, null, 4)}\n`);
    console.log(`Wrote ${path.relative(process.cwd(), baselinePath)}`);
}
