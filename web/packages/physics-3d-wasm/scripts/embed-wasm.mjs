import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const input = path.resolve(root, process.argv[2] ?? "build/wasm-release/physics.opt.wasm");
const output = path.join(root, "src/generated/wasm.ts");

if (!fs.existsSync(input)) {
    throw new Error(`missing wasm: ${input}`);
}

const bytes = fs.readFileSync(input);
const base64 = bytes.toString("base64");
const content = `export const WASM_BASE64 = ${JSON.stringify(base64)};\nexport const WASM_BYTE_LENGTH = ${bytes.byteLength};\n`;

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, content);
console.log(`${path.relative(root, output)} ${bytes.byteLength} bytes`);
