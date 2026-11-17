import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FUNNEL_FILE = "core/world.cpp";
const FUNNEL_FUNCTIONS = ["refreshBodyRotation", "resetBodyRotation"];
const BODY_STRUCT_FILE = "core/body.h";
const BODY_STRUCT = "Body";
const WRITE_PATTERN = /rotation\s*(?:\.\s*fromQuaternion\s*\(|\.\s*setIdentity\s*\(|=\s*[^=])/g;
const ASSIGN_TARGET = /(?:\w+|\])\s*(?:\.|->)\s*rotation\s*=(?!=)/;
const BODIES_RECEIVER = /(?:^|[^\w])bodies\s*\[[^\]]*\]\s*(?:\.|->)\s*rotation/;

function sourceFiles(dir) {
    const found = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "generated" || entry.name === "node_modules") {
            continue;
        }
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            found.push(...sourceFiles(full));
        } else if (/\.(cpp|h|hpp)$/.test(entry.name)) {
            found.push(full);
        }
    }
    return found.sort();
}

function bodyIdentifiers(text) {
    const names = new Set();
    for (const match of text.matchAll(/\bBody\s*(?:const\s+)?[&*]{0,2}\s*(\w+)\b/g)) {
        names.add(match[1]);
    }
    return names;
}

function regionsNamed(text, patterns) {
    const lines = text.split(/\r?\n/);
    const regions = [];
    for (const pattern of patterns) {
        const start = lines.findIndex((line) => pattern.test(line));
        if (start < 0) {
            continue;
        }
        let end = start;
        while (end + 1 < lines.length && !/^\}/.test(lines[end + 1])) {
            end += 1;
        }
        regions.push({ name: pattern.source, start, end });
    }
    return { lines, regions };
}

function inside(regions, index) {
    return regions.some((region) => index >= region.start && index <= region.end);
}

function receiverOfAssignment(line) {
    const target = line.match(ASSIGN_TARGET);
    if (target === null) {
        return null;
    }
    const left = line.slice(0, target.index + target[0].lastIndexOf("="));
    const access = left.match(/([\w\]])\s*(?:\.|->)\s*rotation\s*$/);
    if (access === null) {
        return null;
    }
    const before = left.slice(0, access.index + 1);
    const identifier = before.match(/(\w+)\s*$/);
    return { name: access[1] === "]" ? null : (identifier ? identifier[1] : null), left };
}

export function scanFile(file, root) {
    const text = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file).replace(/\\/g, "/");
    const names = bodyIdentifiers(text);
    const funnelPatterns = FUNNEL_FUNCTIONS.map((name) => new RegExp(`^void\\s+${name}\\s*\\(`));
    const { lines, regions } = regionsNamed(text, relative === FUNNEL_FILE ? funnelPatterns : []);
    const structRegions = relative === BODY_STRUCT_FILE
        ? regionsNamed(text, [new RegExp(`^struct\\s+${BODY_STRUCT}\\s*\\{`)]).regions
        : [];
    const violations = [];
    let allowed = 0;

    lines.forEach((line, index) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("//")) {
            return;
        }
        WRITE_PATTERN.lastIndex = 0;
        if (!WRITE_PATTERN.test(line)) {
            return;
        }
        if (inside(regions, index)) {
            allowed += 1;
            return;
        }
        const receiver = receiverOfAssignment(line);
        const methodMatch = line.match(/(\w+|\])\s*(?:\.|->)\s*rotation\s*\.\s*(?:fromQuaternion|setIdentity)/);
        const methodReceiver = methodMatch && methodMatch[1] !== "]" ? methodMatch[1] : null;
        const isBodyWrite = BODIES_RECEIVER.test(line)
            || (receiver !== null && receiver.name !== null && names.has(receiver.name))
            || (methodReceiver !== null && names.has(methodReceiver))
            || (receiver !== null && receiver.name === null && BODIES_RECEIVER.test(receiver.left));
        const isBodyMethod = inside(structRegions, index);

        if (isBodyWrite || isBodyMethod) {
            violations.push({
                file: relative,
                line: index + 1,
                source: trimmed,
                reason: isBodyMethod
                    ? "a write inside struct Body itself, which the funnel is supposed to own"
                    : "a Body rotation matrix written outside refreshBodyRotation / resetBodyRotation"
            });
        }
    });

    return { relative, violations, allowed, funnelRegions: regions.length };
}

export function scanTree(root) {
    const files = sourceFiles(root);
    const violations = [];
    let allowed = 0;
    for (const file of files) {
        const result = scanFile(file, root);
        violations.push(...result.violations);
        allowed += result.allowed;
    }
    return { files, violations, allowed };
}

function main() {
    const args = process.argv.slice(2);
    const sourceIndex = args.indexOf("--src");
    const root = sourceIndex >= 0 ? path.resolve(args[sourceIndex + 1]) : path.join(ROOT, "src");
    const { files, violations, allowed } = scanTree(root);

    if (violations.length > 0) {
        console.error(`rotation funnel gate: ${violations.length} Body rotation write(s) outside the funnel, scanned ${files.length} file(s)`);
        for (const violation of violations) {
            console.error(`  ${violation.file}:${violation.line}  ${violation.reason}`);
            console.error(`      ${violation.source}`);
        }
        console.error("Body::rotation is derived state: write it only through refreshBodyRotation or resetBodyRotation in core/world.cpp.");
        process.exitCode = 1;
        return;
    }

    console.log(`rotation funnel gate: clean over ${files.length} source file(s); ${allowed} Body rotation write(s), all inside the funnel`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main();
}
