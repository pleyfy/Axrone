import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    addStandardScene,
    fingerprintHex,
    loadWasm,
    memoryMegabytes,
    runStandardScene
} from "./scene.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wasmPath = process.argv[2] ?? path.join(root, "build/wasm-release/physics.wasm");
const nativePath = process.argv[3] ?? path.join(
    root,
    process.platform === "win32"
        ? "build/host-debug/axrone_physics_fingerprint.exe"
        : "build/host-debug/axrone_physics_fingerprint"
);

if (!fs.existsSync(wasmPath)) {
    throw new Error(`missing wasm: ${wasmPath}`);
}
if (!fs.existsSync(nativePath)) {
    throw new Error(`missing native fingerprint executable: ${nativePath}`);
}

const nativeOutput = execFileSync(nativePath, { encoding: "utf8" }).trim();
const nativeMatch = /bodies=(\d+) contacts=(\d+) fingerprint=([0-9a-f]+)/.exec(nativeOutput);
if (!nativeMatch) {
    throw new Error(`unexpected native output: ${nativeOutput}`);
}

const nativeBodies = Number(nativeMatch[1]);
const nativeContacts = Number(nativeMatch[2]);
const nativeFingerprint = nativeMatch[3].padStart(16, "0");

const { exports, byteLength, imports } = await loadWasm(wasmPath);
addStandardScene(exports);
runStandardScene(exports);

const wasmBodies = exports.bodyCount();
const wasmContacts = exports.contactCount();
const wasmFingerprint = fingerprintHex(exports);
const memory = memoryMegabytes(exports);

const repeatFingerprint = (() => {
    addStandardScene(exports);
    runStandardScene(exports);
    return fingerprintHex(exports);
})();

const failures = [];
if (nativeBodies !== wasmBodies) {
    failures.push(`bodies native=${nativeBodies} wasm=${wasmBodies}`);
}
if (nativeContacts !== wasmContacts) {
    failures.push(`contacts native=${nativeContacts} wasm=${wasmContacts}`);
}
if (nativeFingerprint !== wasmFingerprint) {
    failures.push(`fingerprint native=${nativeFingerprint} wasm=${wasmFingerprint}`);
}
if (wasmFingerprint !== repeatFingerprint) {
    failures.push(`wasm repeat fingerprint=${repeatFingerprint}`);
}

console.log(`wasm=${path.relative(root, wasmPath)}`);
console.log(`size=${byteLength} bytes imports=${imports.length} memory=${memory.toFixed(2)} MB`);
console.log(`native bodies=${nativeBodies} contacts=${nativeContacts} fingerprint=${nativeFingerprint}`);
console.log(`wasm   bodies=${wasmBodies} contacts=${wasmContacts} fingerprint=${wasmFingerprint}`);

if (failures.length > 0) {
    for (const failure of failures) {
        console.error(`FAIL ${failure}`);
    }
    process.exit(1);
}

console.log("PASS");
