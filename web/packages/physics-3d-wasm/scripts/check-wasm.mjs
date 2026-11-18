import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.resolve(root, process.argv[2] ?? "build/wasm-release/physics.opt.wasm");
const maxDataBytes = Number(process.env.PHYSICS_WASM_MAX_DATA_BYTES ?? 4096);

if (!fs.existsSync(input)) {
    throw new Error(`missing wasm: ${input}`);
}

const bytes = fs.readFileSync(input);
if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
    throw new Error(`not a wasm module: ${input}`);
}

let cursor = 8;
let dataBytes = 0;
let hasStart = false;
let exportCount = 0;
const exports = new Set();
const imports = [];

function uleb() {
    let result = 0;
    let shift = 0;
    for (;;) {
        if (cursor >= bytes.length) throw new Error("truncated uleb128");
        const byte = bytes[cursor++];
        result |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return result >>> 0;
        shift += 7;
        if (shift > 35) throw new Error("invalid uleb128");
    }
}

function skipSleb() {
    let byte;
    do {
        if (cursor >= bytes.length) throw new Error("truncated sleb128");
        byte = bytes[cursor++];
    } while (byte & 0x80);
}

function readName() {
    const length = uleb();
    const start = cursor;
    cursor += length;
    if (cursor > bytes.length) throw new Error("truncated name");
    return bytes.subarray(start, cursor).toString("utf8");
}

while (cursor < bytes.length) {
    const id = bytes[cursor++];
    const size = uleb();
    const end = cursor + size;
    if (end > bytes.length) throw new Error(`truncated section ${id}`);
    if (id === 2) {
        const count = uleb();
        for (let i = 0; i < count; i++) {
            const module = readName();
            const name = readName();
            const kind = bytes[cursor++];
            if (kind === 0) uleb();
            else if (kind === 1) {
                cursor++;
                const flags = uleb();
                uleb();
                if (flags & 1) uleb();
            } else if (kind === 2) {
                const flags = uleb();
                uleb();
                if (flags & 1) uleb();
            } else if (kind === 3) {
                cursor += 2;
            } else {
                throw new Error(`unsupported import kind ${kind}`);
            }
            imports.push(`${module}.${name}`);
        }
    } else if (id === 7) {
        const count = uleb();
        for (let i = 0; i < count; i++) {
            const name = readName();
            cursor++;
            uleb();
            exports.add(name);
            exportCount++;
        }
    } else if (id === 8) {
        hasStart = true;
    } else if (id === 11) {
        const count = uleb();
        for (let i = 0; i < count; i++) {
            const flags = uleb();
            if (flags !== 0 && flags !== 1 && flags !== 2) {
                throw new Error(`unsupported data segment flags ${flags}`);
            }
            if (flags === 2) {
                uleb(); // explicit memory index
            }
            if (flags === 0 || flags === 2) {
                const op = bytes[cursor++];
                if (op === 0x41) skipSleb();
                else if (op === 0x42) cursor += 8;
                else throw new Error(`unsupported data offset opcode 0x${op.toString(16)}`);
                if (bytes[cursor++] !== 0x0b) throw new Error("unterminated data offset");
            }
            const length = uleb();
            dataBytes += length;
            cursor += length;
        }
    }
    cursor = end;
}

const requiredExports = ["memory", "worldInit", "step", "bodyCreate", "worldFingerprint"];
for (const name of requiredExports) {
    if (!exports.has(name)) {
        throw new Error(`missing required export: ${name}`);
    }
}

for (const name of ["memset", "memcpy", "memmove", "memcmp", "bzero", "__wasm_call_ctors"]) {
    if (exports.has(name)) {
        throw new Error(`internal symbol leaked into the export table: ${name}`);
    }
}

const allowedImports = new Set(["env.now"]);
for (const name of imports) {
    if (!allowedImports.has(name)) {
        throw new Error(`unexpected wasm import: ${name}`);
    }
}

if (hasStart) {
    throw new Error("wasm start section is present; the freestanding module must have no ctors");
}

if (dataBytes > maxDataBytes) {
    throw new Error(`.data budget exceeded: ${dataBytes} > ${maxDataBytes} bytes`);
}

console.log(
    `[wasm-check] ${path.relative(root, input)}: ${bytes.length} bytes, ` +
    `.data ${dataBytes} bytes, ${exportCount} exports, ${imports.length} imports`
);
