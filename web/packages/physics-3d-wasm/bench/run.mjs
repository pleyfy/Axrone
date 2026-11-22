import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addBoxPileScene, fingerprintHex, loadWasm, STANDARD_DT } from "../scripts/scene.mjs";
import { PHYSICS_ITERATION_POLICY as policy } from "../scripts/policy.mjs";
import { median } from "./lib/median.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const counts = [250, 1000, 2000, 5000];
const warmupSteps = 40;
const measuredSteps = 120;
const repeats = (count) => (count <= 1000 ? 5 : 3);
const dt = STANDARD_DT;

const step = (exports, dt) => exports.step(dt, policy.velocityIterations, policy.positionIterations);

const defaultVariants = [
    "build/wasm-release/physics.wasm",
    "build/wasm-simd/physics.wasm",
    "build/wasm-fast/physics.wasm",
    "build/wasm-fast-simd/physics.wasm"
];

const requested = process.argv.slice(2);
const variantPaths = (requested.length > 0 ? requested : defaultVariants)
    .map((entry) => path.resolve(root, entry))
    .filter((entry) => fs.existsSync(entry));

if (variantPaths.length === 0) {
    throw new Error("no wasm variants found; build a preset first");
}

function labelFor(filePath) {
    const parent = path.basename(path.dirname(filePath));
    const file = path.basename(filePath);
    return file.includes(".opt.") ? `${parent}-opt` : parent;
}

const formatMs = (value) => value === null ? "—" : value.toFixed(3);

function measure(exports, count) {
    const samples = [];
    let contacts = 0;
    let fingerprint = "0000000000000000";
    let memory = 0;

    for (let repeat = 0; repeat < repeats(count); repeat += 1) {
        addBoxPileScene(exports, count);

        for (let i = 0; i < warmupSteps; i += 1) {
            step(exports, dt);
        }

        const start = process.hrtime.bigint();
        for (let i = 0; i < measuredSteps; i += 1) {
            step(exports, dt);
        }
        const end = process.hrtime.bigint();

        samples.push(Number(end - start) / measuredSteps / 1e6);
        contacts = exports.contactCount();
        fingerprint = fingerprintHex(exports);
        memory = exports.worldMemoryBytes();
    }

    return {
        ms: median(samples),
        minMs: Math.min(...samples),
        maxMs: Math.max(...samples),
        contacts,
        fingerprint,
        memoryMb: memory / (1024 * 1024)
    };
}

const results = [];
for (const filePath of variantPaths) {
    const label = labelFor(filePath);
    const { exports, byteLength, imports } = await loadWasm(filePath);

    for (const count of counts) {
        const result = measure(exports, count);
        results.push({
            variant: label,
            file: path.relative(root, filePath),
            count,
            sizeBytes: byteLength,
            imports: imports.length,
            ...result
        });
    }
}

const environment = {
    date: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    threads: os.cpus().length,
    warmupSteps,
    measuredSteps,
    repeats: Object.fromEntries(counts.map((count) => [count, repeats(count)])),
    dt
};

const outputDir = path.join(root, "bench/results");
fs.mkdirSync(outputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputPath = path.join(outputDir, `bench-${stamp}.json`);
fs.writeFileSync(outputPath, JSON.stringify({ environment, results }, null, 2));

const header = "variant".padEnd(20) + "bodies".padStart(8) + "step ms".padStart(12) + "contacts".padStart(10) + "memory MB".padStart(12) + "size KB".padStart(10) + "fingerprint".padStart(20);
console.log(header);
for (const result of results) {
    console.log(
        result.variant.padEnd(20) +
        String(result.count).padStart(8) +
        formatMs(result.ms).padStart(12) +
        String(result.contacts).padStart(10) +
        result.memoryMb.toFixed(2).padStart(12) +
        (result.sizeBytes / 1024).toFixed(1).padStart(10) +
        result.fingerprint.padStart(20)
    );
}
console.log(`\nresults=${path.relative(root, outputPath)}`);
console.log(`environment=${environment.cpu} / ${environment.threads} threads / node ${environment.node}`);
