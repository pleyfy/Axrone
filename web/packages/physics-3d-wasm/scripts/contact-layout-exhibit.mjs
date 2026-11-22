import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEADER = "src/core/contact.h";
const TEST_EXE = "build/host-debug/axrone_physics_contact_layout_tests.exe";
const DEFAULT_OUT = "bench/results/exhibits/contact-layout.json";

const FIELD_LINE = /^\s{2}([A-Za-z]\w*)\s+offset\s+(\d+)\s+bytes\s+(\d+)\s+cache line (\d+)\s*$/;
const SUMMARY_LINE = /^sizeof\(Contact\)=(\d+) alignof=(\d+) cache lines touched by the hot cluster=(\d+)/;
const COLD_HEADER = /^cold fields:/;

function parseCapturedOutput(stdout) {
    const lines = stdout.split(/\r?\n/);
    let group = "hot";
    const fields = [];
    let summary = null;
    for (const line of lines) {
        if (COLD_HEADER.test(line)) {
            group = "cold";
            continue;
        }
        const field = line.match(FIELD_LINE);
        if (field) {
            fields.push({
                name: field[1],
                group,
                offset: Number(field[2]),
                bytes: Number(field[3]),
                cacheLine: Number(field[4])
            });
            continue;
        }
        const totals = line.match(SUMMARY_LINE);
        if (totals) {
            summary = {
                sizeofBytes: Number(totals[1]),
                alignofBytes: Number(totals[2]),
                hotClusterCacheLines: Number(totals[3])
            };
        }
    }
    return { fields, summary };
}

function capture(executable) {
    if (!fs.existsSync(executable)) {
        throw new Error(`the layout test binary is missing at ${path.relative(ROOT, executable).replace(/\\/g, "/")}; `
            + "run the host-debug build first, and never judge a stale exe");
    }
    const run = spawnSync(executable, [], { encoding: "utf8" });
    if (run.error) {
        throw new Error(`the layout test could not run: ${run.error.message}`);
    }
    const { fields, summary } = parseCapturedOutput(run.stdout);
    if (fields.length === 0 || summary === null) {
        throw new Error("the layout test printed no offset table; the exhibit would be an empty record");
    }
    const headerPath = path.join(ROOT, HEADER);
    const header = fs.readFileSync(headerPath);
    const hot = fields.filter((field) => field.group === "hot");
    const lastHotEnd = Math.max(...hot.map((field) => field.offset + field.bytes));
    return {
        record: "contact-layout-exhibit",
        purpose: "machine-readable record of the Contact field layout Lever A-lite measured against; a printed "
            + "exhibit, not a gate: the cache-line placement of these fields is the arrangement this milestone "
            + "measured to be immaterial, so it may be changed deliberately",
        generatedAt: new Date().toISOString(),
        capturedFrom: path.relative(ROOT, executable).replace(/\\/g, "/"),
        source: {
            file: HEADER,
            bytes: header.byteLength,
            sha256: crypto.createHash("sha256").update(header).digest("hex")
        },
        ...summary,
        contentBytes: fields.reduce((total, field) => total + field.bytes, 0),
        paddingBytes: summary.sizeofBytes - fields.reduce((total, field) => total + field.bytes, 0),
        hotClusterEndBytes: lastHotEnd,
        hotClusterTouchesCacheLines: Math.ceil(lastHotEnd / 64),
        fields
    };
}

export function layoutsAgree(left, right) {
    const comparable = (record) => JSON.stringify({
        sizeofBytes: record.sizeofBytes,
        alignofBytes: record.alignofBytes,
        hotClusterCacheLines: record.hotClusterCacheLines,
        contentBytes: record.contentBytes,
        paddingBytes: record.paddingBytes,
        fields: [...record.fields]
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((field) => ({ name: field.name, group: field.group, offset: field.offset, bytes: field.bytes,
                cacheLine: field.cacheLine }))
    });
    return comparable(left) === comparable(right);
}

export function describeDrift(committed, recaptured) {
    const byName = (record) => new Map(record.fields.map((field) => [field.name, field]));
    const changes = [];
    for (const field of recaptured.fields) {
        const before = byName(committed).get(field.name);
        if (before === undefined) {
            changes.push(`${field.name}: new field at offset ${field.offset}`);
        } else if (before.offset !== field.offset || before.bytes !== field.bytes) {
            changes.push(`${field.name}: offset ${before.offset} -> ${field.offset}`);
        }
    }
    for (const field of committed.fields) {
        if (!byName(recaptured).has(field.name)) {
            changes.push(`${field.name}: no longer in the record`);
        }
    }
    if (committed.sizeofBytes !== recaptured.sizeofBytes) {
        changes.push(`sizeof(Contact): ${committed.sizeofBytes} -> ${recaptured.sizeofBytes}`);
    }
    return changes;
}

function main() {
    const args = process.argv.slice(2);
    const outIndex = args.indexOf("--out");
    const outRel = outIndex >= 0 ? args[outIndex + 1] : DEFAULT_OUT;
    const exeIndex = args.indexOf("--exe");
    const executable = path.join(ROOT, exeIndex >= 0 ? args[exeIndex + 1] : TEST_EXE);
    const record = capture(executable);
    const outPath = path.resolve(ROOT, outRel);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    console.log(outPath);
    console.log(`captured ${record.fields.length} fields from ${record.source.file}@${record.source.sha256.slice(0, 12)}, `
        + `sizeof=${record.sizeofBytes} content=${record.contentBytes} padding=${record.paddingBytes}, `
        + `hot cluster ends at ${record.hotClusterEndBytes} and touches ${record.hotClusterTouchesCacheLines} cache lines`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
    main();
}
