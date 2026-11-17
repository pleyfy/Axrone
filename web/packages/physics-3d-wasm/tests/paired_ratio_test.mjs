import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import nodeFs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { pairedVerdict, LEVER_GAIN_BAR, NO_REGRESSION_BAR, cellOf, MIN_CONTACTS_PER_BODY,
    RELEASE_WASM, VERDICT_PROTOCOL, rotationReport, rotationSchedule } from "../bench/paired-ratio.mjs";
import { TIMERS_WASM } from "../bench/identity-oracle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resolve = (relative) => path.resolve(root, relative);
const cliPath = resolve("bench/paired-ratio.mjs");
const TRACKED_PAIRED = resolve("bench/results/paired-ratio.json");
const runCli = (...args) => spawnSync(process.execPath, [cliPath, ...args], { encoding: "utf8" });
const cliOutput = (result) => `${result.stdout}${result.stderr}`;
const SUBJECT = "test verdict";

const cell = (count, kind, samples) => ({ count, kind, samples });

const measured = (key, kind, count, ms, spread, contacts, fingerprint) => ({
    key, count, kind, ms, spread, contacts, fingerprint
});

const equalSides = [
    measured("box250", "box", 250, 1.20, 0.02, 1190, "abf8513a7c8a2feb"),
    measured("box1000", "box", 1000, 5.00, 0.02, 4752, "5fe528523ae0b090"),
    measured("sphere250", "sphere", 250, 1.00, 0.02, 372, "34414a5cab384631")
];

const differingSides = [
    measured("box250", "box", 250, 1.20, 0.02, 1190, "abf8513a7c8a2feb"),
    measured("box1000", "box", 1000, 5.00, 0.02, 4752, "5fe528523ae0b090"),
    measured("sphere250", "sphere", 250, 1.00, 0.02, 372, "34414a5cab384631")
];

const differingCandidate = [
    measured("box250", "box", 250, 1.05, 0.02, 1190, "abf8513a7c8a2feb"),
    measured("box1000", "box", 1000, 4.40, 0.02, 4752, "differentFingerprint0"),
    measured("sphere250", "sphere", 250, 1.30, 0.02, 372, "34414a5cab384631")
];

test("a gain inside the combined spread is not an adoption", () => {
    const base = [cell(1000, "box", [5, 5.05, 4.95])];
    const candidate = [cell(1000, "box", [4.9, 4.85, 4.95])];
    const result = pairedVerdict({ base, candidate, hostQuiet: true, subject: SUBJECT });
    assert.equal(result.cells[0].gainExceedsNoise, false,
        "a 2 % mean difference with 1 % spreads must not clear the noise margin");
    assert.equal(result.verdict.adopt, false);
});

test("box 1000 must clear 1.087x and every other size must be reported", () => {
    const base = [cell(250, "box", [1.2, 1.21, 1.19]), cell(1000, "box", [5, 5.02, 4.98])];
    const candidate = [cell(250, "box", [1.1, 1.11, 1.09]), cell(1000, "box", [4.4, 4.42, 4.38])];
    const result = pairedVerdict({ base, candidate, hostQuiet: true, subject: SUBJECT });
    assert.ok(result.cells[0].ratio >= 1 && result.cells[1].ratio >= LEVER_GAIN_BAR);
    assert.equal(result.verdict.adopt, true, JSON.stringify(result.verdict));
});

test("a regression worse than 5 % on a protected scene vetoes adoption", () => {
    const base = [cell(1000, "box", [5, 5, 5]), cell(250, "sphere", [1, 1, 1])];
    const candidate = [cell(1000, "box", [4, 4, 4]), cell(250, "sphere", [1.2, 1.2, 1.2])];
    const result = pairedVerdict({ base, candidate, hostQuiet: true, subject: SUBJECT });
    assert.equal(result.verdict.decidedOn, "paired-ratio");
    assert.equal(result.verdict.adopt, false, "a 20 % sphere regression vetoes a 25 % box win");
    assert.ok(result.cells.some((entry) => entry.ratio < NO_REGRESSION_BAR && entry.kind !== "box"));
});

test("a loaded host cannot publish absolute milliseconds", () => {
    const base = [cell(1000, "box", [5, 5, 5])];
    const candidate = [cell(1000, "box", [4, 4, 4])];
    const result = pairedVerdict({ base, candidate, hostQuiet: false, subject: SUBJECT });
    assert.equal(result.absoluteMsPublished, false);
    assert.equal(result.verdict.decidedOn, "paired-ratio");
    for (const entry of result.cells) {
        assert.equal(entry.baseMs, undefined, "the artifact must not carry an absolute ms on a loaded host");
        assert.ok(Number.isFinite(entry.ratio), "the ratio survives; it is the load-robust quantity");
    }
});

test("cellOf rejects a non-finite sample rather than medians over it", () => {
    assert.throws(() => cellOf(1000, "box", [5, Number.NaN, 4]), /non-finite/);
    assert.throws(() => cellOf(1000, "box", []), /at least one sample/);
});

test("two simulations that compute identically cannot decide anything", () => {
    const result = pairedVerdict({ base: equalSides, candidate: equalSides.map((row) => ({ ...row, ms: row.ms * 0.97 })),
        hostQuiet: false, subject: SUBJECT });
    assert.equal(result.verdict.adopt, null, "a null comparison must not publish a boolean adoption");
    assert.equal(result.verdict.decidedOn, "self-noise");
    assert.deepEqual(result.verdict.vetoes, [],
        "an identical-simulation run must not emit adoption or regression vetoes");
    assert.match(result.verdict.note, /harness scatter only/);
    assert.ok(result.selfNoiseFloor, "the refusal must still record the scatter it measured");
    assert.ok(result.selfNoiseFloor.maxRatioDeviation > 0);
    assert.equal(result.selfNoiseFloor.perCell.length, 3);
    const scatter = JSON.stringify(result.verdict) + JSON.stringify(result.selfNoiseFloor);
    assert.doesNotMatch(scatter, /regressed/,
        "nothing in a self-noise verdict may read as a regression claim");
    assert.doesNotMatch(scatter, /no-regression bar and outside/);
});

test("a genuinely different candidate still gets the normal vetoes", () => {
    const result = pairedVerdict({ base: differingSides, candidate: differingCandidate, hostQuiet: false,
        subject: SUBJECT });
    assert.equal(result.verdict.decidedOn, "paired-ratio");
    assert.equal(result.verdict.adopt, false);
    assert.ok(result.verdict.vetoes.some((veto) => /sphere250 regressed to/.test(veto)),
        JSON.stringify(result.verdict.vetoes));
    assert.ok(result.cells.some((cellEntry) => cellEntry.fingerprintEqual === false),
        "the differing side must be visible as an identity difference, not only as a ratio");
});

test("a declared-preserving run keeps its speed verdict against a measured floor", () => {
    const floor = { maxRatioDeviation: 0.03, perCell: [{ key: "sphere250", deviation: 0.03 }] };
    const preservingCandidate = [
        measured("box250", "box", 250, 1.19, 0.02, 1190, "abf8513a7c8a2feb"),
        measured("box1000", "box", 1000, 4.85, 0.02, 4752, "5fe528523ae0b090"),
        measured("sphere250", "sphere", 250, 1.02, 0.02, 372, "34414a5cab384631")
    ];
    const result = pairedVerdict({ base: equalSides, candidate: preservingCandidate, hostQuiet: false,
        subject: SUBJECT, preserving: true, noiseFloor: floor });
    assert.equal(result.verdict.decidedOn, "paired-ratio",
        "a numerically preserving lever is exactly the case that needs a speed verdict, so it must not be silenced");
    assert.equal(result.verdict.preservingVerdict, true);
    assert.equal(result.verdict.adopt, false);
    assert.ok(result.verdict.vetoes.some((veto) => /box 1000 ratio 1\.0309x/.test(veto)),
        JSON.stringify(result.verdict.vetoes));
    assert.doesNotMatch(JSON.stringify(result.verdict.vetoes), /sphere250 regressed/,
        "a 2 % sphere gap inside the recorded 3 % floor is scatter, not a regression claim");
    assert.ok(result.verdict.coverageGaps.some((gap) => /below the 1\.5 coverage floor/.test(gap)),
        "sphere250 at 1.49 contacts per body is still declared a coverage gap even on a preserving run");
});

test("the artifact states the bar it actually applied, not only the published one", () => {
    const base = [cell(1000, "box", [5, 5.05, 4.95])];
    const candidate = [cell(1000, "box", [4.9, 4.85, 4.95])];
    const result = pairedVerdict({ base, candidate, hostQuiet: true, subject: SUBJECT });
    const cellEntry = result.cells[0];
    assert.equal(cellEntry.requiredRatioForAdoption, 1 + cellEntry.noiseMargin,
        "the spread bar must be published as a ratio the reader can compare, not as a bare fraction");
    assert.ok(cellEntry.requiredRatioForAdoption > 1.01 && cellEntry.requiredRatioForAdoption < 1.06,
        `a 2 % gain on ~2 % spreads should need about 1.04x, saw ${cellEntry.requiredRatioForAdoption}`);
    assert.equal(cellEntry.boundBySpread, true);
    assert.equal(result.verdict.bindingCondition,
        "both the 1.087x lever bar and this run's spread",
        "a 2 % gain fails the 1.087 bar and the spread bar together; naming one would understate the gate");
    assert.equal(result.verdict.decidingCell.effectiveBar,
        Math.max(LEVER_GAIN_BAR, cellEntry.requiredRatioForAdoption));
    const spreadOnly = pairedVerdict({ base: [cell(1000, "box", [5, 5.75, 4.25])],
        candidate: [cell(1000, "box", [4.55, 4.56, 4.54])], hostQuiet: true, subject: SUBJECT });
    assert.ok(spreadOnly.cells[0].ratio >= LEVER_GAIN_BAR,
        `this case needs a gain over the bar, saw ${spreadOnly.cells[0].ratio}`);
    assert.equal(spreadOnly.verdict.bindingCondition,
        "the spread: the gain had to exceed 1 + noiseMargin, not 1.087",
        "a run that clears 1.087 and still fails must be labelled as spread-bound, the case that hid a 1.29x bar");
    const wide = [cell(1000, "box", [5, 5.6, 4.5])];
    const fast = [cell(1000, "box", [4.7, 4.71, 4.69])];
    const both = pairedVerdict({ base: wide, candidate: fast, hostQuiet: true, subject: SUBJECT });
    assert.ok(both.cells[0].ratio < LEVER_GAIN_BAR, `this case needs a gain under the bar, saw ${both.cells[0].ratio}`);
    assert.match(both.verdict.bindingCondition, /both the 1\.087x lever bar and this run's spread/,
        "a run that fails both bars must say so; naming only one under-reports the gate");
    assert.equal(both.verdict.decidingCell.effectiveBar, both.cells[0].requiredRatioForAdoption,
        "with a 22 pp margin the spread bar, not 1.087, is what the run has to clear");
});

test("a protected cell inside its own margin is reported indeterminate, not cleared", () => {
    const base = [measured("box1000", "box", 1000, 5.0, 0.01, 4752, "5fe528523ae0b090"),
        measured("capsule250", "capsule", 250, 1.0, 0.074, 651, "7d5062b9fa7194ee")];
    const candidate = [measured("box1000", "box", 1000, 4.4, 0.01, 4752, "differentFingerprintA"),
        measured("capsule250", "capsule", 250, 1.0414, 0.074, 651, "7d5062b9fa7194ee")];
    const result = pairedVerdict({ base, candidate, hostQuiet: true, subject: SUBJECT });
    const capsule = result.verdict.indeterminate.find((entry) => entry.key === "capsule250");
    assert.ok(capsule, `capsule250 at 0.9603 with a 14.82 pp margin must be flagged, saw `
        + JSON.stringify(result.verdict.indeterminate));
    assert.ok(Math.abs(capsule.ratio - 0.9603) < 1e-3, `ratio should read about 0.9603, saw ${capsule.ratio}`);
    assert.equal(capsule.onWhichSide, "clears the bar");
    assert.ok(capsule.barDistance < capsule.margin,
        "the whole point: the bar is closer than the measurement's own spread");
    assert.ok(capsule.margin > 0.14 && capsule.margin < 0.16, `margin ~14.8 pp, saw ${capsule.margin}`);
    assert.equal(result.verdict.vetoes.filter((veto) => /capsule250 regressed/.test(veto)).length, 0,
        "indeterminate is disclosure, not a new veto: no bar moved");
});

test("the noise floor keeps the sign so position bias stays visible", () => {
    const slowCandidate = equalSides.map((row) => ({ ...row, ms: row.ms * 1.05 }));
    const result = pairedVerdict({ base: equalSides, candidate: slowCandidate, hostQuiet: true,
        subject: SUBJECT });
    const floor = result.verdict.selfNoiseFloor ?? result.selfNoiseFloor;
    assert.ok(floor, "an identical-simulation pair must publish its scatter");
    for (const entry of floor.perCell) {
        assert.equal(entry.signedDeviation < 0, true,
            `${entry.key}: a slower candidate is a negative deviation and must not be folded to absolute`);
        assert.equal(entry.deviation, Math.abs(entry.signedDeviation),
            `${entry.key}: the absolute summary must stay derivable from the signed value`);
        assert.equal(entry.requiredRatioForAdoption, 1 + entry.noiseMargin);
    }
});

test("the rotation schedule is balanced for even runs and says so when it cannot be", () => {
    const four = rotationReport(rotationSchedule(4));
    assert.deepEqual(four.schedule.map((entry) => entry.order),
        ["base-first", "candidate-first", "base-first", "candidate-first"]);
    assert.equal(four.balanced, true);
    assert.equal(four.residualImbalance, 0);
    assert.equal(four.everyAdjacentPairBalanced, true);

    const five = rotationReport(rotationSchedule(5));
    assert.equal(five.baseFirstRuns, 3);
    assert.equal(five.candidateFirstRuns, 2);
    assert.equal(five.balanced, false, "an odd repeat count is not balanced and must not claim to be");
    assert.equal(five.residualImbalance, 1);
    assert.match(five.note, /3 base-first against 2 candidate-first/);

    assert.equal(rotationReport([]).everyAdjacentPairBalanced, false,
        "zero repeats cannot be called a balanced schedule");
});

test("--out pointing at the tracked baseline is refused before anything is measured", () => {
    const trackedBefore = crypto.createHash("sha256").update(nodeFs.readFileSync(TRACKED_PAIRED)).digest("hex");
    const relative = path.relative(root, TRACKED_PAIRED).split(path.sep).join("/");
    const startedAt = Date.now();
    const result = runCli("--candidate", "build/wasm-timers/physics.wasm", "--subject", "should not run", "--out", relative);
    const elapsedMs = Date.now() - startedAt;
    assert.notEqual(result.status, 0, "a refused run must not exit green");
    assert.match(cliOutput(result), /--out must not point at the tracked paired-ratio baseline/);
    assert.equal(crypto.createHash("sha256").update(nodeFs.readFileSync(TRACKED_PAIRED)).digest("hex"),
        trackedBefore, "a refused run must leave the tracked baseline byte-identical");
    assert.ok(elapsedMs < 15000,
        `the guard must fire before the measurement, not after it: the refusal took ${elapsedMs} ms`);
});

test("every verdict names its protocol", () => {
    assert.match(VERDICT_PROTOCOL, /^verdict-protocol: 2/);
    assert.match(VERDICT_PROTOCOL, /second bar at 1 \+ noiseMargin/);
    const base = [cell(1000, "box", [5, 5.05, 4.95])];
    const candidate = [cell(1000, "box", [4.9, 4.85, 4.95])];
    assert.equal(pairedVerdict({ base, candidate, hostQuiet: true, subject: SUBJECT }).verdict.protocol,
        VERDICT_PROTOCOL);
    const identical = pairedVerdict({ base: equalSides, candidate: equalSides, hostQuiet: true,
        subject: SUBJECT });
    assert.equal(identical.verdict.protocol, VERDICT_PROTOCOL,
        "the self-noise refusal must name its protocol too, or a reader cannot tell which rule produced it");
});

test("a verdict without a subject is refused", () => {
    assert.throws(() => pairedVerdict({ base: equalSides, candidate: equalSides, hostQuiet: true }),
        /needs a subject/);
    assert.throws(() => pairedVerdict({ base: equalSides, candidate: equalSides, hostQuiet: true, subject: "  " }),
        /needs a subject/);
});

test("a loaded-host cell keeps its identity and loses only the milliseconds", () => {
    const base = [measured("box1000", "box", 1000, 5.0, 0.02, 4752, "5fe528523ae0b090")];
    const candidate = [measured("box1000", "box", 1000, 4.4, 0.02, 4752, "5fe528523ae0b090")];
    const result = pairedVerdict({ base, candidate, hostQuiet: false, subject: SUBJECT });
    const cellEntry = result.cells[0];
    assert.equal(cellEntry.baseMs, undefined);
    assert.equal(cellEntry.candidateMs, undefined);
    assert.equal(result.absoluteMsPublished, false);
    assert.equal(cellEntry.baseContacts, 4752);
    assert.equal(cellEntry.candidateContacts, 4752);
    assert.equal(cellEntry.baseFingerprint, "5fe528523ae0b090");
    assert.equal(cellEntry.candidateFingerprint, "5fe528523ae0b090");
    assert.equal(cellEntry.fingerprintEqual, true);
    assert.equal(cellEntry.populationEqual, true);
    assert.ok(cellEntry.contactsPerBody > 4 && cellEntry.contactsPerBody < 5,
        `box 1000 must report about 4.75 contacts per body, saw ${cellEntry.contactsPerBody}`);
    assert.equal(Number.isFinite(cellEntry.ratio), true);
});

test("the verdict records the module bytes it compared", () => {
    const rows = [measured("box1000", "box", 1000, 5.0, 0.02, 4752, "5fe528523ae0b090")];
    const result = pairedVerdict({ base: rows, candidate: rows, hostQuiet: true, subject: SUBJECT,
        basePath: resolve(RELEASE_WASM), candidatePath: resolve(TIMERS_WASM) });
    for (const side of ["base", "candidate"]) {
        const identity = result.moduleIdentity[side];
        assert.match(identity.sha256, /^[0-9a-f]{64}$/, `${side} must carry a full digest`);
        assert.ok(Number.isInteger(identity.bytes) && identity.bytes > 0, `${side} must carry a byte count`);
        assert.match(identity.file, /^build\/wasm-[a-z]+\/physics\.wasm$/, `${side} must name its file`);
    }
    assert.notEqual(result.moduleIdentity.base.sha256, result.moduleIdentity.candidate.sha256);
});

test("a thin or contacts-free protected scene is recorded as a coverage gap", () => {
    assert.equal(MIN_CONTACTS_PER_BODY, 1.5, "the coverage floor is a stated constant, not a drifting literal");
    const thinBase = [measured("box1000", "box", 1000, 5.0, 0.02, 4752, "5fe528523ae0b090"),
        measured("sphere250", "sphere", 250, 1.0, 0.01, 250, "c23f9a1f92822fbd")];
    const thinCandidate = [measured("box1000", "box", 1000, 4.4, 0.02, 4752, "differentFingerprint1"),
        measured("sphere250", "sphere", 250, 1.0, 0.01, 250, "differentFingerprint2")];
    const thin = pairedVerdict({ base: thinBase, candidate: thinCandidate, hostQuiet: true, subject: SUBJECT });
    assert.equal(thin.cells[1].contactsPerBody, 1);
    assert.ok(thin.verdict.coverageGaps.some((gap) => /below the 1\.5 coverage floor/.test(gap)),
        JSON.stringify(thin.verdict.coverageGaps));
    assert.equal(thin.verdict.adopt, false,
        "a protected scene with one contact per body cannot certify the no-regression row");

    const jointedBase = [measured("box1000", "box", 1000, 5.0, 0.02, 4752, "5fe528523ae0b090"),
        measured("hinge128", "hinge", 128, 1.0, 0.01, 0, "1c43fc761b29065b")];
    const jointedCandidate = [measured("box1000", "box", 1000, 4.4, 0.02, 4752, "differentFingerprint1"),
        measured("hinge128", "hinge", 128, 1.0, 0.01, 0, "differentFingerprint2")];
    const jointed = pairedVerdict({ base: jointedBase, candidate: jointedCandidate, hostQuiet: true,
        subject: SUBJECT });
    assert.ok(jointed.verdict.coverageGaps.some((gap) => /makes no contacts at all[\s\S]*jointed path/.test(gap)),
        "a contacts-free jointed scene must be told apart from a thin pile, in its own words");

    const selfNoise = pairedVerdict({ base: equalSides, candidate: equalSides, hostQuiet: true, subject: SUBJECT });
    assert.ok(selfNoise.verdict.coverageGaps.length > 0,
        "coverage gaps survive into a self-noise verdict, where the decision schema goes quiet");
});
