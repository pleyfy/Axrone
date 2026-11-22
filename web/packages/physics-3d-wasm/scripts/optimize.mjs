import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const simd = args.includes("--simd");
const positional = args.filter((entry) => !entry.startsWith("--"));

if (positional.length !== 2) {
    throw new Error("usage: node scripts/optimize.mjs <input.wasm> <output.wasm> [--simd]");
}

const input = path.resolve(root, positional[0]);
const output = path.resolve(root, positional[1]);
if (!fs.existsSync(input)) {
    throw new Error(`missing input: ${input}`);
}

const features = [
    "-O4",
    "--enable-bulk-memory",
    "--enable-mutable-globals",
    "--enable-sign-ext",
    "--enable-nontrapping-float-to-int",
    "--enable-multivalue"
];
if (simd) {
    features.push("--enable-simd");
}
features.push("--strip-dwarf", "--strip-producers", input, "-o", output);

function resolveWasmOpt() {
    if (process.env.WASM_OPT) {
        return { command: process.env.WASM_OPT, prefix: [], shell: false };
    }

    const executable = process.platform === "win32" ? "wasm-opt.cmd" : "wasm-opt";
    const local = path.join(root, "node_modules/.bin", executable);
    if (fs.existsSync(local)) {
        return { command: local, prefix: [], shell: process.platform === "win32" };
    }

    const npxCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npx-cli.js");
    if (fs.existsSync(npxCli)) {
        return {
            command: process.execPath,
            prefix: [npxCli, "-y", "-p", "binaryen@132", "wasm-opt"],
            shell: false
        };
    }

    return {
        command: process.platform === "win32" ? "npx.cmd" : "npx",
        prefix: ["-y", "-p", "binaryen@132", "wasm-opt"],
        shell: process.platform === "win32"
    };
}

const { command, prefix, shell } = resolveWasmOpt();
const result = spawnSync(command, [...prefix, ...features], { stdio: "inherit", cwd: root, shell });
if (result.error) {
    throw result.error;
}
if (result.status !== 0) {
    process.exit(result.status ?? 1);
}

const inputSize = fs.statSync(input).size;
const outputSize = fs.statSync(output).size;
const reduction = (1 - outputSize / inputSize) * 100;
console.log(`${path.relative(root, output)} ${outputSize} bytes (${reduction.toFixed(2)}% smaller)`);
