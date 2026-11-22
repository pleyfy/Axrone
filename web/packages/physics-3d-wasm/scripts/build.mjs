import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preset = process.argv[2] ?? "wasm-release";
const runTests = process.argv.includes("--test");

const vsRoot = "C:/Program Files (x86)/Microsoft Visual Studio/18/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake";
const vsPaths = [
    path.join(vsRoot, "CMake/bin"),
    path.join(vsRoot, "Ninja")
].filter((entry) => fs.existsSync(entry));

if (process.platform === "win32" && vsPaths.length > 0) {
    process.env.PATH = [...vsPaths, process.env.PATH].join(path.delimiter);
}

function run(command, args) {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

run("cmake", ["--preset", preset]);
run("cmake", ["--build", "--preset", preset]);

if (preset.startsWith("wasm")) {
    const wasm = path.join(root, "build", preset, "physics.wasm");
    const optimized = path.join(root, "build", preset, "physics.opt.wasm");
    run("node", [path.join(root, "scripts/check-wasm.mjs"), wasm]);
    const optimizeArgs = [path.join(root, "scripts/optimize.mjs"), wasm, optimized];
    if (preset.includes("simd")) {
        optimizeArgs.push("--simd");
    }
    run("node", optimizeArgs);
    run("node", [path.join(root, "scripts/check-wasm.mjs"), optimized]);

    if (preset === "wasm-release") {
        run("node", [path.join(root, "scripts/embed-wasm.mjs"), optimized]);
    }
}

if (runTests && preset === "host-debug") {
    run("ctest", ["--preset", "host-debug"]);
}
