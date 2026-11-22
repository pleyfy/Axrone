import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
    VARIANTS,
    COUNTS,
    parseBenchOutput,
    parseBenchReport,
    moduleIdentity,
    publishGuard,
    resolveRun,
    summariseRuns,
    decorateMatchesRelease,
    decideAdoption,
    buildCrossCheck,
    loadedHostNote,
    populationMatchesBase
} from "../bench/variants.mjs";

const labDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const studyPath = path.join(labDir, "bench", "results", "variant-study.json");
const loadStudy = () => JSON.parse(fs.readFileSync(studyPath, "utf8"));

const cell = (count, msPerStep, contacts, fingerprint, memoryMb = 3.31, spread = 0.02) => ({
    count, msPerStep, contacts, fingerprint, memoryMb, spread
});
const studyOf = (release, variant) => ({
    counts: [release.cells[0].count],
    variants: { "wasm-release": { cells: release.cells }, "wasm-simd": { cells: variant.cells } }
});
const columnOf = (preset, cells, extra = {}) => ({ preset, cells, ...extra });
const runOf = (source, rows) => ({ source, reportPath: null, environment: null, rows });
const benchRow = (count, ms, contacts, fingerprint, memoryMb, minMs, maxMs, sizeBytes) => ({
    count, msPerStep: ms, contacts, fingerprint, memoryMb, minMs, maxMs, sizeBytes
});

test("every variant is named with the preset that builds it", () => {
    assert.deepEqual(VARIANTS.map((variant) => variant.preset), [
        "wasm-release",
        "wasm-simd",
        "wasm-fast",
        "wasm-fast-simd"
    ]);
});

test("bench output is parsed into per-count rows without touching the numbers", () => {
    const sample = [
        "variant               bodies     step ms  contacts   memory MB   size KB         fingerprint",
        "wasm-simd                250       1.021      1190        3.31     211.5    abf8513a7c8a2feb",
        "wasm-simd               1000       4.102      4752       11.63     211.5    5fe528523ae0b090"
    ].join("\n");
    const rows = parseBenchOutput(sample);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].msPerStep, 1.021);
    assert.equal(rows[0].contacts, 1190);
    assert.equal(rows[1].fingerprint, "5fe528523ae0b090");
});

test("a variant is adopted only above the threshold and only with identical contact counts", () => {
    const study = {
        variants: {
            "wasm-release": { cells: [{ count: 1000, msPerStep: 4.849, contacts: 4752, fingerprint: "5fe528523ae0b090" }] },
            "wasm-simd": { cells: [{ count: 1000, msPerStep: 3.400, contacts: 4752, fingerprint: "5fe528523ae0b090" }] }
        }
    };
    assert.equal(decideAdoption(study).adopt, "wasm-simd");
    const sameButDifferentCounts = {
        variants: {
            "wasm-release": { cells: [{ count: 1000, msPerStep: 4.849, contacts: 4752, fingerprint: "5fe528523ae0b090" }] },
            "wasm-simd": { cells: [{ count: 1000, msPerStep: 3.400, contacts: 4600, fingerprint: "1111111111111111" }] }
        }
    };
    assert.equal(decideAdoption(sameButDifferentCounts).adopt, null);
});

test("equal contact counts with a different fingerprint are not adoptable", () => {
    const study = studyOf(
        { cells: [cell(1000, 4.849, 4752, "5fe528523ae0b090")] },
        { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b091")] }
    );
    const population = populationMatchesBase(study.variants["wasm-simd"], study.variants["wasm-release"]);
    assert.equal(population.contactsEqual, true, "the contacts really are equal in this case");
    assert.equal(population.fingerprintsEqual, false);
    assert.equal(population.matched, false, "a rounding-only change with equal counts must not count as a matched population");
    const decision = decideAdoption(study);
    assert.equal(decision.adopt, null, "a 1.43x gain on a changed fingerprint must not be adopted");
    assert.equal(decision.candidates[0].matched, false);
    assert.equal(decision.candidates[0].fingerprintsEqual, false);
    assert.match(decision.reason, /fingerprints/, "the reason must state that fingerprints were checked");
});

test("the matchesRelease decoration is what the decision consumes when it is present", () => {
    const study = studyOf(
        { cells: [cell(1000, 4.849, 4752, "5fe528523ae0b090")] },
        { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b090")] }
    );
    study.variants["wasm-simd"].matchesRelease = { contactsEqual: true, fingerprintsEqual: false };
    assert.equal(populationMatchesBase(study.variants["wasm-simd"], study.variants["wasm-release"]).matched, false,
        "an explicitly decorated rounding change must veto even when the raw cells agree");
    assert.equal(decideAdoption(study).adopt, null);
});

test("disagreeing rotated passes make the verdict not trustworthy and block adoption", () => {
    const pass1 = {
        counts: [1000],
        variants: {
            "wasm-release": { cells: [cell(1000, 4.849, 4752, "5fe528523ae0b090")] },
            "wasm-simd": { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b090")] },
            "wasm-fast": { cells: [cell(1000, 4.800, 4752, "5fe528523ae0b090")] },
            "wasm-fast-simd": { cells: [cell(1000, 4.700, 4752, "5fe528523ae0b090")] }
        }
    };
    const pass2Columns = {
        "wasm-release": { cells: [cell(1000, 4.900, 4752, "5fe528523ae0b090")] },
        "wasm-simd": { cells: [cell(1000, 4.800, 4752, "5fe528523ae0b090")] },
        "wasm-fast": { cells: [cell(1000, 4.800, 4752, "5fe528523ae0b090")] },
        "wasm-fast-simd": { cells: [cell(1000, 4.700, 4752, "5fe528523ae0b090")] }
    };
    assert.equal(decideAdoption(pass1).adopt, "wasm-simd", "pass 1 on its own would adopt");
    const study = { counts: [1000], variants: pass1.variants, pass2: pass2Columns };
    const crossCheck = buildCrossCheck(study, decideAdoption(pass1), decideAdoption({ counts: [1000], variants: pass2Columns }));
    assert.equal(crossCheck.mediansAgreeWithinSpread, false, "the two passes must disagree beyond their own spreads");
    assert.equal(crossCheck.trustworthy, false);
    const decision = decideAdoption(pass1, crossCheck);
    assert.equal(decision.adopt, null, "an untrustworthy cross-check must veto adoption");
    assert.equal(decision.blockedByCrossCheck, true);
    assert.equal(decision.crossCheckTrustworthy, false);
    assert.match(decision.reason, /not trustworthy/);
    assert.match(decision.reason, /rotated passes/);
    const agreeing = { counts: [1000], variants: pass1.variants, pass2: pass1.variants };
    const trustworthy = buildCrossCheck(agreeing, decideAdoption(pass1), decideAdoption(pass1));
    assert.equal(trustworthy.mediansAgreeWithinSpread, true);
    assert.equal(trustworthy.trustworthy, true);
    assert.equal(decideAdoption(pass1, trustworthy).adopt, "wasm-simd", "a trustworthy cross-check must not change a qualifying verdict");
});

test("a reason may only claim cross-pass agreement when a cross-check actually ran", () => {
    const qualifying = studyOf(
        { cells: [cell(1000, 4.849, 4752, "5fe528523ae0b090")] },
        { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b090")] }
    );
    const alone = decideAdoption(qualifying);
    assert.equal(alone.adopt, "wasm-simd");
    assert.equal(alone.crossCheckRan, false);
    assert.equal(alone.crossPassAgreementClaimed, false);
    assert.equal(alone.crossCheckTrustworthy, null);
    assert.doesNotMatch(alone.reason, /rotated passes|spreads|trustworthy/,
        "a single-pass decision must not claim the two rotated passes agreed — nothing compared them");
    assert.match(alone.reason, /contact counts AND fingerprints/);

    const agreeingColumns = {
        counts: [1000],
        variants: {
            "wasm-release": { cells: [cell(1000, 4.849, 4752, "5fe528523ae0b090")] },
            "wasm-simd": { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b090")] },
            "wasm-fast": { cells: [cell(1000, 4.800, 4752, "5fe528523ae0b090")] },
            "wasm-fast-simd": { cells: [cell(1000, 4.700, 4752, "5fe528523ae0b090")] }
        },
        pass2: {
            "wasm-release": { cells: [cell(1000, 4.849, 4752, "5fe528523ae0b090")] },
            "wasm-simd": { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b090")] },
            "wasm-fast": { cells: [cell(1000, 4.800, 4752, "5fe528523ae0b090")] },
            "wasm-fast-simd": { cells: [cell(1000, 4.700, 4752, "5fe528523ae0b090")] }
        }
    };
    const gate = decideAdoption(agreeingColumns);
    const trustworthy = buildCrossCheck(agreeingColumns, gate, gate);
    assert.equal(trustworthy.trustworthy, true);
    const withCrossCheck = decideAdoption(agreeingColumns, trustworthy);
    assert.equal(withCrossCheck.crossCheckRan, true);
    assert.equal(withCrossCheck.crossPassAgreementClaimed, true);
    assert.match(withCrossCheck.reason, /contact counts AND fingerprints/);
    assert.match(withCrossCheck.reason, /rotated passes agree/,
        "a decision taken with a trustworthy cross-check may state that the passes agreed");
    assert.doesNotMatch(withCrossCheck.reason, /not trustworthy/);
});

test("a missing or malformed cross-check fails closed instead of adopting", () => {
    const study = studyOf(
        { cells: [cell(1000, 4.849, 4752, "5fe528523ae0b090")] },
        { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b090")] }
    );
    assert.equal(decideAdoption(study, {}).adopt, null, "a cross-check with no verdict in it must not read as trustworthy");
    assert.match(decideAdoption(study, {}).reason, /no usable cross-pass verdict/);
    assert.equal(decideAdoption(study, { trustworthy: false }).adopt, null);
    assert.equal(decideAdoption(study, { trustworthy: true }).adopt, "wasm-simd");
    assert.equal(decideAdoption(study, { trustworthy: undefined }).crossCheckRan, true, "a supplied cross-check must be reported as having run");
});

test("the decoration can only add vetoes, never remove one from the cells", () => {
    const differingCells = studyOf(
        { cells: [cell(1000, 4.849, 4752, "5fe528523ae0b090")] },
        { cells: [cell(1000, 3.400, 9999, "0000000000000000")] }
    );
    differingCells.variants["wasm-simd"].matchesRelease = { contactsEqual: true, fingerprintsEqual: true };
    const population = populationMatchesBase(differingCells.variants["wasm-simd"], differingCells.variants["wasm-release"]);
    assert.equal(population.contactsEqual, false, "a decoration cannot overrule cells whose contacts differ");
    assert.equal(population.fingerprintsEqual, false);
    assert.equal(population.matched, false);
    assert.equal(decideAdoption(differingCells).adopt, null, "a self-reported match must not unlock adoption");
});

test("decorateMatchesRelease reports a rounding-only change as rounding, not as identical", () => {
    const columns = {
        "wasm-release": columnOf("wasm-release", [cell(1000, 4.849, 4752, "5fe528523ae0b090")]),
        "wasm-simd": columnOf("wasm-simd", [cell(1000, 4.800, 4752, "5fe528523ae0b091")]),
        "wasm-fast": columnOf("wasm-fast", [cell(1000, 4.800, 4700, "5fe528523ae0b090")])
    };
    decorateMatchesRelease(columns);
    assert.equal(columns["wasm-simd"].matchesRelease.contactsEqual, true);
    assert.equal(columns["wasm-simd"].matchesRelease.fingerprintsEqual, false);
    assert.equal(columns["wasm-simd"].matchesRelease.roundingChanged, true);
    assert.equal(columns["wasm-simd"].matchesRelease.behaviourChanged, false);
    assert.equal(columns["wasm-fast"].matchesRelease.behaviourChanged, true);
    assert.equal(decideAdoption({
        counts: [1000],
        variants: {
            "wasm-release": columns["wasm-release"],
            "wasm-simd": { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b091")], matchesRelease: columns["wasm-simd"].matchesRelease }
        }
    }).adopt, null, "a column decorated as rounding-changed must not be adoptable even above the threshold");
});

test("the cross-check also compares the release column both passes divide by", () => {
    const build = (releasePass2Ms) => ({
        counts: [1000],
        variants: {
            "wasm-release": { cells: [cell(1000, 4.849, 4752, "5fe528523ae0b090")] },
            "wasm-simd": { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b090")] },
            "wasm-fast": { cells: [cell(1000, 4.800, 4752, "5fe528523ae0b090")] },
            "wasm-fast-simd": { cells: [cell(1000, 4.700, 4752, "5fe528523ae0b090")] }
        },
        pass2: {
            "wasm-release": { cells: [cell(1000, releasePass2Ms, 4752, "5fe528523ae0b090")] },
            "wasm-simd": { cells: [cell(1000, 3.400, 4752, "5fe528523ae0b090")] },
            "wasm-fast": { cells: [cell(1000, 4.800, 4752, "5fe528523ae0b090")] },
            "wasm-fast-simd": { cells: [cell(1000, 4.700, 4752, "5fe528523ae0b090")] }
        }
    });
    const stable = build(4.849);
    const stableGate = decideAdoption(stable);
    const stableCheck = buildCrossCheck(stable, stableGate, stableGate);
    assert.equal(stableCheck.baseColumnAgreesWithinSpread, true);
    assert.equal(stableCheck.trustworthy, true);

    const drifted = build(48.49);
    const driftedGate = decideAdoption(drifted);
    const driftedCheck = buildCrossCheck(drifted, driftedGate, driftedGate);
    assert.equal(driftedCheck.baseColumnAgreesWithinSpread, false, "a tenfold move in the release column must not pass as agreement");
    assert.equal(driftedCheck.trustworthy, false);
    assert.equal(decideAdoption(drifted, driftedCheck).adopt, null);
});

test("the bench JSON keeps full precision the console rounds away and carries memory", () => {
    const report = { results: [{
        variant: "wasm-release",
        file: "build\\wasm-release\\physics.wasm",
        count: 250,
        sizeBytes: 218257,
        imports: 0,
        ms: 1.2034216666666668,
        minMs: 1.1962975,
        maxMs: 1.2402316666666668,
        contacts: 1190,
        fingerprint: "abf8513a7c8a2feb",
        memoryMb: 3.3125
    }] };
    const [row] = parseBenchReport(report);
    assert.equal(row.msPerStep, 1.2034216666666668, "the full-precision median must survive unchanged");
    assert.equal(row.memoryMb, 3.3125, "the memory column must not be dropped");
    assert.equal(row.sizeBytes, 218257);
    const [consoleRow] = parseBenchOutput([
        "variant               bodies     step ms  contacts   memory MB   size KB         fingerprint",
        "wasm-release             250       1.203      1190        3.31     213.1    abf8513a7c8a2feb"
    ].join("\n"));
    assert.notEqual(consoleRow.msPerStep, row.msPerStep, "the console excerpt is a rounded fallback, not the source of truth");
    assert.equal(consoleRow.memoryMb, 3.31);
});

test("the driver reads the full-precision report when one exists and only then the console table", () => {
    const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "axrone-variants-"));
    const reportPath = path.join(scratchDir, "bench-report.json");
    try {
        const fullPrecision = 1.2034216666666668;
        fs.writeFileSync(reportPath, JSON.stringify({
            environment: { repeats: { 250: 5 } },
            results: [{
                variant: "wasm-release", file: "build/wasm-release/physics.wasm", count: 250,
                sizeBytes: 218257, imports: 0, ms: fullPrecision, minMs: 1.1962975, maxMs: 1.2402316666666668,
                contacts: 1190, fingerprint: "abf8513a7c8a2feb", memoryMb: 3.3125
            }]
        }), "utf8");

        const consoleTable = [
            "variant               bodies     step ms  contacts   memory MB   size KB         fingerprint",
            "wasm-release             250       1.203      1190        3.31     213.1    abf8513a7c8a2feb",
            "",
            `results=${reportPath.split(path.sep).join("/")}`
        ].join("\n");

        const fromReport = resolveRun(consoleTable, "physics.wasm", { bytes: 218257 });
        assert.equal(fromReport.source, "bench-json");
        assert.equal(fromReport.rows[0].msPerStep, fullPrecision, "the driver must take the unrounded median, not the toFixed(3) column");
        assert.equal(fromReport.rows[0].memoryMb, 3.3125, "the memory column must survive from the report");
        assert.equal(fromReport.rows[0].minMs, 1.1962975);
        const cellList = summariseRuns("wasm-release", [runOf("bench-json", fromReport.rows)], [250]);
        assert.equal(cellList[0].msPerStep, fullPrecision);
        assert.equal(cellList[0].msSource, "bench-json");
        assert.equal(cellList[0].minMs, 1.1962975);
        assert.equal(cellList[0].loadedBytesVerified, true);

        const consoleOnly = resolveRun(consoleTable.replace(`results=${reportPath.split(path.sep).join("/")}`, "results=bench/results/does-not-exist.json"),
            "physics.wasm", { bytes: 218257 });
        assert.equal(consoleOnly.source, "console-fallback");
        assert.equal(consoleOnly.rows[0].msPerStep, 1.203, "the fallback is the rounded console value and must say so");
        assert.equal(consoleOnly.rows[0].sizeBytes, null);
        const fallbackCells = summariseRuns("wasm-release", [runOf("console-fallback", consoleOnly.rows)], [250]);
        assert.equal(fallbackCells[0].msSource, "console-fallback");
        assert.equal(fallbackCells[0].minMs, null, "a fallback cell must not publish a window it never measured");
        assert.equal(fallbackCells[0].maxMs, null);
        assert.equal(fallbackCells[0].loadedBytesVerified, false, "the fallback cannot prove which bytes were loaded");
        assert.equal(fallbackCells[0].memoryMb, 3.31, "the fallback still carries memory, which the old parser dropped");

        assert.throws(() => resolveRun(consoleTable, "physics.wasm", { bytes: 217000 }), /refuse to mix modules/);
    } finally {
        fs.rmSync(scratchDir, { recursive: true, force: true });
    }
});

test("a column that mixes two measurement sources is refused rather than averaged", () => {
    const rows = (ms) => [benchRow(250, ms, 1190, "abf8513a7c8a2feb", 3.3125, 1.19, 1.24, 218257)];
    const runs = [
        runOf("bench-json", rows(1.2034216666666668)),
        runOf("bench-json", rows(1.2099875)),
        runOf("console-fallback", rows(1.203))
    ];
    assert.throws(() => summariseRuns("wasm-release", runs, [250]), /mixed bench-json\/console-fallback readings/);
    const singleSource = [runOf("bench-json", rows(1.2)), runOf("bench-json", rows(1.3)), runOf("bench-json", rows(1.1))];
    const cellList = summariseRuns("wasm-release", singleSource, [250]);
    assert.equal(cellList[0].msSource, "bench-json");
    assert.equal(cellList[0].spread, 0.19999999999999996);
    assert.equal(cellList[0].microsecondsPerContact, (1.2 * 1000) / 1190);
});

test("the publish gate refuses a release module that is not the one the columns measured", () => {
    const stale = {
        preset: "wasm-release",
        wasm: "build/wasm-release/physics.wasm",
        bytes: 143244,
        sha256: "ea3a925ed8b41cf9654f6ac9cd423987389906437f889fac27e7ffd84c045e55",
        optWasm: "build/wasm-release/physics.opt.wasm",
        optBytes: 143244,
        optSha256: "ea3a925ed8b41cf9654f6ac9cd423987389906437f889fac27e7ffd84c045e55"
    };
    assert.throws(() => publishGuard(stale, {}), /refusing to publish/);
    assert.throws(() => publishGuard(stale, {
        "wasm-release": { wasmBytes: stale.bytes, wasmSha256: stale.sha256, optWasmBytes: stale.optBytes, optWasmSha256: stale.optSha256 }
    }), /refusing to publish/);
    assert.throws(() => publishGuard(moduleIdentity("wasm-release"), {
        "wasm-does-not-exist": { wasmBytes: 1, wasmSha256: "x", optWasmBytes: 1, optWasmSha256: "x" }
    }), /is missing/);
    assert.throws(() => publishGuard({ preset: "wasm-release", wasm: "nope.wasm", bytes: null, sha256: null, optWasm: "nope.opt.wasm", optBytes: null, optSha256: null }, {}),
        /refusing to publish/, "an absent recorded identity must refuse, not pass by comparing null to null");

    const live = moduleIdentity("wasm-release");
    if (live.sha256 === null) {
        assert.throws(() => publishGuard(live, {}), /refusing to publish|missing/, "an absent module must also refuse to publish");
        return;
    }
    const columns = {
        "wasm-release": {
            wasmBytes: live.bytes,
            wasmSha256: live.sha256,
            optWasmBytes: live.optBytes,
            optWasmSha256: live.optSha256
        }
    };
    assert.doesNotThrow(() => publishGuard(live, columns));
    columns["wasm-release"] = { ...columns["wasm-release"], wasmSha256: `f${columns["wasm-release"].wasmSha256.slice(1)}` };
    assert.throws(() => publishGuard(live, columns), /refusing to publish: wasm-release on disk is/);
});

test("an unavailable host probe is labelled unknown, never silently loaded", () => {
    const blind = { loadSource: "os-only", cpuBusyPercent: null, processes: null, freeMemoryMb: null };
    const note = loadedHostNote(blind, { ...blind, loadSource: "powershell-unavailable" });
    assert.match(note, /no CPU reading/);
    assert.doesNotMatch(note, /loaded-host excerpt|quiet-host sample/, "the note must not claim a load state it could not measure");
    assert.match(note, /os-only \/ powershell-unavailable/, "the note must name the probes that failed");
    assert.equal(loadedHostNote(blind, blind).includes("above the 5% quiet bound"), false);

    const busy = { loadSource: "powershell", cpuBusyPercent: 43, processes: 605, freeMemoryMb: 2759 };
    const calm = { loadSource: "powershell", cpuBusyPercent: 31, processes: 599, freeMemoryMb: 2585 };
    assert.match(loadedHostNote(busy, calm), /loaded-host excerpt/);
    const quiet = { loadSource: "powershell", cpuBusyPercent: 2, processes: 210, freeMemoryMb: 12000 };
    assert.match(loadedHostNote(quiet, quiet), /quiet-host sample/);
    assert.match(loadedHostNote(quiet, quiet), /both within the 5% quiet bound/);
});

test("module identity is size plus sha256 of both the measured and the optimized artifact", () => {
    const identity = moduleIdentity("wasm-release");
    assert.equal(identity.wasm, "build/wasm-release/physics.wasm");
    if (identity.sha256 === null) {
        assert.equal(identity.bytes, null, "an absent module must report absent size and absent hash together");
        return;
    }
    assert.ok(/^[0-9a-f]{64}$/.test(identity.sha256));
    assert.ok(Number.isInteger(identity.bytes) && identity.bytes > 0);
});


test("the study artifact exists and carries every variant column", () => {
    assert.ok(fs.existsSync(studyPath), "run `npm run bench:variants` first");
    const study = loadStudy();
    for (const variant of VARIANTS) {
        assert.ok(study.variants[variant.preset], `${variant.preset} column missing`);
    }
});

test("the release column reproduces the campaign 10/4 contact pins at every counted size", () => {
    const pins = { 250: 1190, 1000: 4752, 2000: 9518, 5000: 24121 };
    const release = loadStudy().variants["wasm-release"];
    assert.deepEqual(release.cells.map((cell) => cell.count), COUNTS);
    for (const cell of release.cells) {
        assert.equal(cell.contacts, pins[cell.count], `release contacts drifted at ${cell.count}`);
    }
});

test("every variant column records module byte size, samples, spread and microseconds per contact", () => {
    const study = loadStudy();
    for (const variant of VARIANTS) {
        const column = study.variants[variant.preset];
        assert.ok(Number.isInteger(column.wasmBytes) && column.wasmBytes > 0, `${variant.preset} missing wasmBytes`);
        for (const cell of column.cells) {
            assert.ok(Array.isArray(cell.samples) && cell.samples.length === study.repeats, `${variant.preset} samples length`);
            assert.equal(typeof cell.spread, "number", `${variant.preset} missing spread at ${cell.count}`);
            assert.ok(cell.microsecondsPerContact > 0, `${variant.preset} missing microsecondsPerContact at ${cell.count}`);
        }
    }
});

test("the study names the release module every column is measured against", () => {
    const study = loadStudy();
    const base = study.measuredAgainstBase;
    assert.equal(base.preset, "wasm-release");
    assert.ok(/^[0-9a-f]{64}$/.test(base.sha256), "measuredAgainstBase must carry a full sha256 of the measured module");
    assert.ok(/^[0-9a-f]{64}$/.test(base.optSha256), "measuredAgainstBase must carry a full sha256 of the shipped module");
    assert.ok(Number.isInteger(base.bytes) && base.bytes > 0);
    assert.ok(Number.isInteger(base.optBytes) && base.optBytes > 0);
    const release = study.variants["wasm-release"];
    assert.equal(release.wasmSha256, base.sha256, "the release column must record the same bytes it was measured on");
    assert.equal(release.optWasmSha256, base.optSha256);
    assert.equal(release.wasmBytes, base.bytes);
    assert.equal(release.optWasmBytes, base.optBytes);
    assert.notEqual(study.pass2["wasm-release"].wasmSha256, undefined, "the second pass must name its bytes too");
});

test("the columns from both passes name identical module bytes for the same preset", () => {
    const study = loadStudy();
    for (const variant of VARIANTS) {
        assert.equal(study.pass2[variant.preset].wasmSha256, study.variants[variant.preset].wasmSha256,
            `${variant.preset} was measured on different bytes across the two passes`);
        assert.equal(study.pass2[variant.preset].optWasmBytes, study.variants[variant.preset].optWasmBytes);
    }
});

test("every cell labels its measurement source and carries the memory column", () => {
    const study = loadStudy();
    assert.equal(typeof study.hostQuiet, "boolean");
    assert.match(study.hostLoadNote, /loaded-host excerpt|quiet-host sample/);
    for (const column of [study.variants, study.pass2]) {
        for (const variant of VARIANTS) {
            const cellList = column[variant.preset].cells;
            assert.equal(column[variant.preset].invocationSources.length, 1,
                `${variant.preset} mixed ${column[variant.preset].invocationSources} sources in one pass`);
            for (const entry of cellList) {
                assert.ok(entry.msSource === "bench-json" || entry.msSource === "console-fallback",
                    `${variant.preset} msSource must name exactly one real source, got ${entry.msSource}`);
                assert.equal(entry.memorySource, entry.msSource);
                assert.ok(Number.isFinite(entry.memoryMb) && entry.memoryMb > 0, `${variant.preset} missing memoryMb at ${entry.count}`);
                assert.equal(entry.memorySamples.length, study.repeats);
                if (entry.msSource === "bench-json") {
                    assert.equal(entry.loadedBytesVerified, true, `${variant.preset} claims a report source it could not verify`);
                    const digits = entry.msPerStep.toString().split(".")[1] ?? "";
                    assert.ok(digits.length > 3 || cellList.some((other) => (other.msPerStep.toString().split(".")[1] ?? "").length > 3),
                        `${variant.preset} claims a full-precision source but every median is rounded to three decimals`);
                    assert.ok(Number.isFinite(entry.minMs) && Number.isFinite(entry.maxMs) && entry.minMs <= entry.msPerStep && entry.maxMs >= entry.msPerStep,
                        `${variant.preset} min/max window must bracket the median at ${entry.count}`);
                }
            }
            assert.deepEqual(column[variant.preset].benchReports.length, study.repeats);
        }
    }
});

test("the decision reason matches the checks the artifact records", () => {
    const study = loadStudy();
    for (const decision of [study.decision, study.pass2Decision]) {
        assert.equal(decision.crossCheckRan, true);
        assert.equal(decision.crossPassAgreementClaimed, true);
        assert.equal(typeof decision.crossCheckTrustworthy, "boolean");
        assert.equal(typeof decision.blockedByCrossCheck, "boolean");
        assert.match(decision.reason, /contact counts AND fingerprints/);
        for (const candidate of decision.candidates) {
            assert.equal(typeof candidate.contactsEqual, "boolean");
            assert.equal(typeof candidate.fingerprintsEqual, "boolean");
            assert.equal(candidate.matched, candidate.contactsEqual && candidate.fingerprintsEqual,
                `${candidate.preset} matched must be exactly contacts AND fingerprints`);
        }
    }
    if (study.crossCheck.trustworthy === false) {
        assert.equal(study.decision.adopt, null, "an untrustworthy cross-check must leave adopt null");
        assert.match(study.decision.reason, /not trustworthy/);
    }
    assert.equal(study.decision.crossCheckTrustworthy, study.crossCheck.trustworthy);
});

test("the cross-check covers every column including the release column the gains divide by", () => {
    const study = loadStudy();
    assert.deepEqual(study.crossCheck.perVariant.map((entry) => entry.preset), VARIANTS.map((variant) => variant.preset));
    assert.equal(study.crossCheck.perVariant.filter((entry) => entry.isBaseColumn).length, 1);
    const base = study.crossCheck.perVariant.find((entry) => entry.isBaseColumn);
    assert.equal(study.crossCheck.baseColumnWorstMedianDriftMsPerStep, Math.max(...base.perSize.map((size) => size.medianDiff)));
    assert.equal(study.crossCheck.baseColumnWorstToleranceMsPerStep, Math.max(...base.perSize.map((size) => size.combinedSpreadTolerance)));
    assert.equal(study.crossCheck.baseColumnAgreesWithinSpread, base.perSize.every((size) => size.mediansAgreeWithinSpread));
    assert.equal(study.crossCheck.mediansAgreeWithinSpread,
        study.crossCheck.perVariant.every((entry) => entry.perSize.every((size) => size.mediansAgreeWithinSpread)));
    assert.equal(study.crossCheck.trustworthy, study.crossCheck.mediansAgreeWithinSpread && study.crossCheck.adoptAgrees);
    assert.equal(study.crossCheck.perVariant.reduce((total, entry) => total + entry.perSize.length, 0),
        VARIANTS.length * study.counts.length, "every counted size of every column must be compared across the passes");
});

test("every non-release variant states whether its contacts and fingerprints match release", () => {
    const study = loadStudy();
    const release = study.variants["wasm-release"];
    for (const variant of VARIANTS.filter((entry) => entry.preset !== "wasm-release")) {
        const match = study.variants[variant.preset].matchesRelease;
        assert.equal(typeof match.contactsEqual, "boolean", `${variant.preset} contactsEqual`);
        assert.equal(typeof match.fingerprintsEqual, "boolean", `${variant.preset} fingerprintsEqual`);
        assert.equal(match.behaviourChanged, release.cells.some((cell, index) =>
            cell.contacts !== study.variants[variant.preset].cells[index].contacts),
            `${variant.preset} behaviourChanged must be true exactly when a contact population differs`);
    }
});

test("the study carries a second interleaved pass and a cross-check of the two passes", () => {
    const study = loadStudy();
    assert.deepEqual(study.pass1Order, VARIANTS.map((variant) => variant.preset));
    assert.notDeepEqual(study.pass2Order, study.pass1Order, "the second pass must run the variants in a rotated order");
    for (const variant of VARIANTS) {
        assert.ok(study.pass2[variant.preset], `${variant.preset} missing from the second pass`);
    }
    assert.equal(typeof study.crossCheck.trustworthy, "boolean");
    assert.equal(typeof study.crossCheck.adoptAgrees, "boolean");
});
