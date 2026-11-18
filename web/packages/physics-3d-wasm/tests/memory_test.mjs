import process from "node:process";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(testDir);
const buildDir = join(packageRoot, "build", "memory-tests");
const sources = [join(packageRoot, "src", "runtime", "memory.cpp"), join(testDir, "memory_test.cpp")];
const commonArgs = [
  "--target=wasm32",
  "-O2",
  "-nostdlib",
  "-ffreestanding",
  "-fno-exceptions",
  "-fno-rtti",
  "-fno-builtin",
  "-I" + join(packageRoot, "src"),
  ...sources,
  "-Wl,--no-entry",
  "-Wl,--export-dynamic",
  "-Wl,--export-memory",
  "-Wl,--stack-first",
  "-Wl,-z,stack-size=65536",
];
const suiteNames = new Map([
  [1, "memset"],
  [2, "memcpy"],
  [4, "memmove"],
  [8, "memcmp"],
  [16, "zero-fill"],
  [32, "regression"],
]);

function resolveCompiler() {
  const explicit = [];
  if (process.env.PHYSICS_CLANGXX) {
    explicit.push(process.env.PHYSICS_CLANGXX);
  }
  if (process.env.LLVM_ROOT) {
    explicit.push(join(process.env.LLVM_ROOT, "bin", process.platform === "win32" ? "clang++.exe" : "clang++"));
  }
  for (const candidate of explicit) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) {
      throw new Error(
        `the configured compiler "${candidate}" does not run (PHYSICS_CLANGXX / LLVM_ROOT); `
        + `fix the setting or unset it to fall back to discovery: ${probe.error ? probe.error.message : "non-zero exit"}`
      );
    }
    return candidate;
  }
  const discovered = ["clang++"];
  if (process.platform === "win32") {
    for (const root of [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA]) {
      if (root) {
        discovered.push(join(root, "LLVM", "bin", "clang++.exe"));
      }
    }
    if (process.env.SCOOP) {
      discovered.push(join(process.env.SCOOP, "apps", "llvm", "current", "bin", "clang++.exe"));
    }
  } else {
    discovered.push("/usr/bin/clang++", "/usr/local/bin/clang++", "/opt/homebrew/opt/llvm/bin/clang++");
  }
  for (const candidate of discovered) {
    const probe = spawnSync(candidate, ["--version"], { encoding: "utf8" });
    if (probe.status === 0) {
      return candidate;
    }
  }
  throw new Error(
    "clang++ not found; set PHYSICS_CLANGXX (or LLVM_ROOT) to a clang++ that can target wasm32. Tried: "
    + discovered.join(", ")
  );
}

function compile(clang, extraArgs, output) {
  const result = spawnSync(clang, [...commonArgs, ...extraArgs, "-o", output], {
    encoding: "utf8",
    cwd: packageRoot,
  });
  if (result.error) {
    throw new Error("compiler invocation failed: " + result.error.message);
  }
  if (result.status !== 0) {
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
    return false;
  }
  return true;
}

function suiteLabel(mask) {
  const labels = [];
  for (const [bit, name] of suiteNames) {
    if ((mask & bit) !== 0) {
      labels.push(name);
    }
  }
  if (labels.length === 0) {
    return "unknown(0x" + mask.toString(16) + ")";
  }
  return labels.join("+");
}

function hex8(value) {
  return "0x" + value.toString(16).padStart(2, "0");
}

function evaluate(label, file) {
  const bytes = readFileSync(file);
  let instance;
  try {
    const module = new WebAssembly.Module(bytes);
    instance = new WebAssembly.Instance(module, {});
  } catch (error) {
    console.log(label + " FAIL (instantiation): " + error.message);
    return false;
  }
  const entry = instance.exports.run_memory_tests;
  if (typeof entry !== "function") {
    console.log(label + " FAIL (export run_memory_tests is missing)");
    return false;
  }
  const code = BigInt(entry());
  if (code === 0n) {
    console.log(label + " PASS");
    return true;
  }
  const suiteMask = Number(code & 0xffn);
  const length = Number((code >> 8n) & 0xffn);
  const align = Number((code >> 16n) & 0xffn);
  const index = Number((code >> 24n) & 0xffffn);
  const expected = Number((code >> 40n) & 0xffn);
  const actual = Number((code >> 48n) & 0xffn);
  console.log(
    label +
      " FAIL suite=" +
      suiteLabel(suiteMask) +
      " len=" +
      length +
      " align/shift=" +
      align +
      " index=" +
      index +
      " expected=" +
      hex8(expected) +
      " actual=" +
      hex8(actual),
  );
  return false;
}

const clang = resolveCompiler();
mkdirSync(buildDir, { recursive: true });

const scalarOut = join(buildDir, "memory_test_scalar.wasm");
if (!compile(clang, [], scalarOut)) {
  console.log("scalar FAIL (compile)");
  process.exit(1);
}
let ok = evaluate("scalar", scalarOut);

const simdOut = join(buildDir, "memory_test_simd.wasm");
if (compile(clang, ["-msimd128"], simdOut)) {
  ok = evaluate("simd", simdOut) && ok;
} else {
  console.log("simd FAIL (toolchain lacks -msimd128)");
  ok = false;
}

process.exit(ok ? 0 : 1);
