import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { addBoxPileScene, fingerprintHex, loadWasm, STANDARD_DT } from "../scripts/scene.mjs";
import { PHYSICS_ITERATION_POLICY as policy } from "../scripts/policy.mjs";
import { median } from "./lib/median.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const counts = [250, 1000, 2000];
const warmupSteps = 40;
const measuredSteps = 240;
const repeats = 3;
const requested = process.argv.slice(2);
if (requested.length !== 2) {
    throw new Error("usage: node bench/event-collector.mjs <baseline.wasm> <candidate.wasm>");
}
const files = requested
    .map((entry) => path.resolve(root, entry))
    .filter((entry) => fs.existsSync(entry));

if (files.length !== 2) {
    throw new Error("both baseline and candidate wasm binaries must exist");
}

const labelFor = (filePath) => `${path.basename(path.dirname(filePath))}/${path.basename(filePath)}`;
const step = (exports) => exports.step(STANDARD_DT, policy.velocityIterations, policy.positionIterations);

function measure(exports, count) {
    const collectorSamples = [];
    const stepSamples = [];
    let events = 0;
    let contacts = 0;
    let fingerprint = "0000000000000000";

    for (let repeat = 0; repeat < repeats; repeat += 1) {
        addBoxPileScene(exports, count);
        for (let i = 0; i < warmupSteps; i += 1) {
            step(exports);
        }

        let collectorNs = 0;
        let stepNs = 0;
        for (let i = 0; i < measuredSteps; i += 1) {
            const stepStart = process.hrtime.bigint();
            step(exports);
            const stepEnd = process.hrtime.bigint();

            const collectorStart = process.hrtime.bigint();
            events = exports.eventCount();
            const collectorEnd = process.hrtime.bigint();

            stepNs += Number(stepEnd - stepStart);
            collectorNs += Number(collectorEnd - collectorStart);
        }
        contacts = exports.contactCount();
        fingerprint = fingerprintHex(exports);
        collectorSamples.push(collectorNs / measuredSteps / 1e6);
        stepSamples.push(stepNs / measuredSteps / 1e6);
    }

    return {
        collectorMs: median(collectorSamples),
        stepMs: median(stepSamples),
        events,
        contacts,
        fingerprint
    };
}

const rows = [];
for (const file of files) {
    const { exports } = await loadWasm(file);
    for (const count of counts) {
        rows.push({ variant: labelFor(file), count, ...measure(exports, count) });
    }
}

const header = "variant".padEnd(40) + "bodies".padStart(8) +
    "collector ms".padStart(15) + "step ms".padStart(12) +
    "events".padStart(9) + "contacts".padStart(10) + "fingerprint".padStart(20);
console.log(header);
for (const row of rows) {
    console.log(
        row.variant.padEnd(40) +
        String(row.count).padStart(8) +
        row.collectorMs.toFixed(4).padStart(15) +
        row.stepMs.toFixed(3).padStart(12) +
        String(row.events).padStart(9) +
        String(row.contacts).padStart(10) +
        row.fingerprint.padStart(20)
    );
}

const [baselineVariant, candidateVariant] = [rows[0]?.variant, rows[rows.length - 1]?.variant];
for (const count of counts) {
    const baseline = rows.find((row) => row.variant === baselineVariant && row.count === count);
    const candidate = rows.find((row) => row.variant === candidateVariant && row.count === count);
    if (baseline && candidate) {
        console.log(
            `collector ratio ${String(count).padStart(4)} bodies: ` +
            `${(baseline.collectorMs / candidate.collectorMs).toFixed(2)}x faster ` +
            `(${baseline.collectorMs.toFixed(4)} ms -> ${candidate.collectorMs.toFixed(4)} ms)`
        );
    }
}
