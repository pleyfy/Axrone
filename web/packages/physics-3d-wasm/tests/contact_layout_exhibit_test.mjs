import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { describeDrift, layoutsAgree } from "../scripts/contact-layout-exhibit.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = path.join(ROOT, "scripts", "contact-layout-exhibit.mjs");
const COMMITTED = path.join(ROOT, "bench", "results", "exhibits", "contact-layout.json");

function recapture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contact-layout-exhibit-"));
    const out = path.join(dir, "recaptured.json");
    const run = spawnSync(process.execPath, [SCRIPT, "--out", out], { encoding: "utf8" });
    if (run.status !== 0) {
        throw new Error(`the exhibit could not be re-captured: ${run.stderr || run.stdout}`);
    }
    return JSON.parse(fs.readFileSync(out, "utf8"));
}

test("the tracked exhibit equals a fresh capture from the layout test's own output", () => {
    const committed = JSON.parse(fs.readFileSync(COMMITTED, "utf8"));
    const fresh = recapture();
    assert.ok(layoutsAgree(committed, fresh),
        `the tracked layout exhibit has drifted from the compiler's answer: ${describeDrift(committed, fresh).join("; ")}`);
});

test("the exhibit is self-consistent arithmetic, not a list of magic offsets", () => {
    const record = JSON.parse(fs.readFileSync(COMMITTED, "utf8"));
    assert.equal(record.fields.length, 25, "every field of Contact is in the record");
    assert.equal(record.contentBytes + record.paddingBytes, record.sizeofBytes,
        "content plus padding must equal the size the compiler reports");
    assert.equal(record.sizeofBytes % record.alignofBytes, 0, "the size is a whole number of alignment units");
    for (const field of record.fields) {
        assert.ok(["hot", "cold"].includes(field.group), `${field.name} is classified hot or cold`);
        assert.equal(field.cacheLine, Math.floor(field.offset / 64), `${field.name} line follows from its offset`);
    }
    const sorted = [...record.fields].sort((left, right) => left.offset - right.offset);
    for (let index = 1; index < sorted.length; ++index) {
        assert.ok(sorted[index].offset >= sorted[index - 1].offset + sorted[index - 1].bytes,
            `${sorted[index].name} overlaps ${sorted[index - 1].name}, which the compiler cannot produce`);
    }
});

test("a header edit that does not move a field is not reported as layout drift", () => {
    const committed = JSON.parse(fs.readFileSync(COMMITTED, "utf8"));
    const edited = structuredClone(committed);
    edited.source.sha256 = "0".repeat(64);
    edited.source.bytes = committed.source.bytes + 7;
    edited.generatedAt = new Date(0).toISOString();
    assert.ok(layoutsAgree(committed, edited),
        "provenance alone must not fail the gate: this is what demoting the preference pin bought");
});

test("moving one field is reported as drift, and named", () => {
    const committed = JSON.parse(fs.readFileSync(COMMITTED, "utf8"));
    const moved = structuredClone(committed);
    const sensor = moved.fields.find((field) => field.name === "sensor");
    sensor.offset += 4;
    assert.ok(!layoutsAgree(committed, moved), "a real layout change must not pass as unchanged");
    assert.match(describeDrift(committed, moved).join("; "), /sensor: offset 212 -> 216/);
});

test("a new field is reported as drift rather than silently widening the record", () => {
    const committed = JSON.parse(fs.readFileSync(COMMITTED, "utf8"));
    const grown = structuredClone(committed);
    grown.fields.push({ name: "dragCoefficient", group: "hot", offset: 220, bytes: 4, cacheLine: 3 });
    assert.ok(!layoutsAgree(committed, grown), "an added field changes the record and must say so");
    assert.match(describeDrift(committed, grown).join("; "), /dragCoefficient: new field at offset 220/);
});
