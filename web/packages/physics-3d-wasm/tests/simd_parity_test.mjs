import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scalarPath = path.resolve(root, process.argv[2] ?? "build/wasm-release/physics.opt.wasm");
const simdPath = path.resolve(root, process.argv[3] ?? "build/wasm-simd/physics.opt.wasm");

for (const file of [scalarPath, simdPath]) {
    if (!fs.existsSync(file)) {
        throw new Error(`missing wasm build: ${file}`);
    }
}

function runStandardScene(file) {
    const module = new WebAssembly.Module(fs.readFileSync(file));
    const instance = new WebAssembly.Instance(module, {});
    const e = instance.exports;
    if (e.worldInit(512, 4096, 0, -9.81, 0) !== 0) {
        throw new Error(`worldInit failed: ${file}`);
    }

    const ground = e.bodyCreate(0, 0, -0.5, 0, 0, 0, 0, 1);
    e.bodySetBox(ground, 20, 0.5, 20, 0);
    e.bodySetMaterial(ground, 0.8, 0);
    for (let i = 0; i < 256; i++) {
        const layer = Math.floor(i / 64);
        const within = i % 64;
        const xIndex = within % 8;
        const zIndex = Math.floor(within / 8);
        const id = e.bodyCreate(1, xIndex - 3, 1 + layer, zIndex - 3, 0, 0, 0, 1);
        e.bodySetBox(id, 0.4, 0.4, 0.4, 1);
        e.bodySetMaterial(id, 0.7, 0);
    }
    for (let i = 0; i < 240; i++) {
        e.step(1 / 60, 10, 4);
    }
    return {
        fingerprint: e.worldFingerprint(),
        contacts: e.contactCount(),
        transforms: new Float32Array(e.memory.buffer, Number(e.transformsPtr()), 7 * 257)
    };
}

const scalar = runStandardScene(scalarPath);
const simd = runStandardScene(simdPath);

if (scalar.fingerprint !== simd.fingerprint) {
    throw new Error(`fingerprint mismatch: ${scalar.fingerprint} !== ${simd.fingerprint}`);
}
if (scalar.contacts !== simd.contacts) {
    throw new Error(`contact count mismatch: ${scalar.contacts} !== ${simd.contacts}`);
}
for (let i = 0; i < scalar.transforms.length; i++) {
    if (scalar.transforms[i] !== simd.transforms[i]) {
        throw new Error(`transform mismatch at ${i}: ${scalar.transforms[i]} !== ${simd.transforms[i]}`);
    }
}

console.log(
    `simd parity PASS: fingerprint=${scalar.fingerprint} contacts=${scalar.contacts} ` +
    `transformValues=${scalar.transforms.length}`
);
