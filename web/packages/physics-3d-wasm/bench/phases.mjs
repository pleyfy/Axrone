import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PHYSICS_ITERATION_POLICY } from "../scripts/policy.mjs";
import { addBoxPileScene, fingerprintHex, loadWasm, STANDARD_DT } from "../scripts/scene.mjs";
import { median } from "./lib/median.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dt = STANDARD_DT;

const ladderCells = (policy) => [
    { velocityIterations: 0, positionIterations: 0 },
    { velocityIterations: policy.velocityIterations, positionIterations: 0 },
    { velocityIterations: policy.velocityIterations, positionIterations: policy.positionIterations }
];

const difference = (left, right) => left === null || right === null ? null : left - right;
const ratio = (numerator, denominator) => numerator === null || denominator === null ? null : numerator / denominator;
const nonNegative = (value) => value === null ? null : Math.max(0, value);
const sumOrNull = (values) => values.some((value) => value === null) ? null : values.reduce((total, value) => total + value, 0);
const formatMs = (value) => value === null ? "—" : value.toFixed(4);

const runCell = (exports, count, cell, warmupSteps, measuredSteps) => {
    addBoxPileScene(exports, count);
    for (let index = 0; index < warmupSteps; index += 1) {
        exports.step(dt, cell.velocityIterations, cell.positionIterations);
    }
    const startedAt = process.hrtime.bigint();
    let contacts = 0;
    for (let index = 0; index < measuredSteps; index += 1) {
        contacts = exports.step(dt, cell.velocityIterations, cell.positionIterations);
    }
    const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (contacts < 0) {
        throw new Error(`step returned ${contacts} at cell ${cell.velocityIterations}/${cell.positionIterations}`);
    }
    return {
        msPerStep: elapsedMs / measuredSteps,
        contacts,
        fingerprint: fingerprintHex(exports)
    };
};

const summarizeCell = (cell, samples) => {
    const measurements = samples.map((sample) => sample.msPerStep);
    return {
        velocityIterations: cell.velocityIterations,
        positionIterations: cell.positionIterations,
        msPerStep: median(measurements),
        minMs: Math.min(...measurements),
        maxMs: Math.max(...measurements),
        msPerSteps: measurements,
        contacts: samples[0]?.contacts ?? null,
        fingerprint: samples[0]?.fingerprint ?? null
    };
};

const runLadder = (exports, count, policy, warmupSteps, measuredSteps, ladderRepeats) => {
    const cells = ladderCells(policy);
    const samples = cells.map(() => []);
    for (let repeat = 0; repeat < ladderRepeats; repeat += 1) {
        for (let index = 0; index < cells.length; index += 1) {
            samples[index].push(runCell(exports, count, cells[index], warmupSteps, measuredSteps));
        }
    }
    return cells.map((cell, index) => summarizeCell(cell, samples[index]));
};

export async function measurePhases({ wasmPath, count, warmupSteps = 40, measuredSteps = 120, ladderRepeats = 3 }) {
    const { exports } = await loadWasm(wasmPath);
    const ladder = runLadder(exports, count, PHYSICS_ITERATION_POLICY, warmupSteps, measuredSteps, ladderRepeats);
    const [rest, velocity, full] = ladder;
    const restMs = rest.msPerStep;
    const rawVelocityMs = difference(velocity.msPerStep, rest.msPerStep);
    const rawPositionMs = difference(full.msPerStep, velocity.msPerStep);
    const velocityMs = nonNegative(rawVelocityMs);
    const positionMs = nonNegative(rawPositionMs);
    const total = full.msPerStep;
    return {
        wasmPath,
        count,
        warmupSteps,
        measuredSteps,
        ladderRepeats,
        iterationPolicy: { ...PHYSICS_ITERATION_POLICY },
        ladder,
        shares: {
            restMs,
            velocityMs,
            positionMs,
            restShare: ratio(restMs, total),
            velocityShare: ratio(velocityMs, total),
            positionShare: ratio(positionMs, total),
            clamped: rawVelocityMs === null || rawPositionMs === null ? null : rawVelocityMs < 0 || rawPositionMs < 0
        },
        bounds: {
            solverShareUpperBound: ratio(sumOrNull([velocityMs, positionMs]), total),
            collisionShareLowerBound: ratio(restMs, total),
            contactPopulationMatched: ladder.every((cell) => cell.contacts === full.contacts)
        }
    };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath.endsWith(path.join("bench", "phases.mjs"))) {
    const requestedCount = Number(process.argv[2] ?? 250);
    if (!Number.isInteger(requestedCount) || requestedCount <= 0) {
        throw new Error(`count must be a positive integer, received ${process.argv[2]}`);
    }
    const wasmPath = path.resolve(process.argv[3] ?? path.join(root, "build", "wasm-release", "physics.wasm"));
    const result = await measurePhases({ wasmPath, count: requestedCount });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const outPath = path.join(root, "bench", "results", `phases-${stamp}.json`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    console.table(result.ladder.map((cell) => ({
        velocityIterations: cell.velocityIterations,
        positionIterations: cell.positionIterations,
        msPerStep: formatMs(cell.msPerStep),
        minMs: cell.minMs.toFixed(4),
        maxMs: cell.maxMs.toFixed(4),
        contacts: cell.contacts,
        fingerprint: cell.fingerprint
    })));
    console.log(JSON.stringify(result.shares, null, 2));
    console.log(JSON.stringify(result.bounds, null, 2));
    console.log(outPath);
}
