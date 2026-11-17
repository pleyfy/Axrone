import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { compareModules, IDENTITY_PROTOCOL, RELEASE_WASM, TIMERS_WASM, FAST_WASM, OUTPUT_PATH, SCENES,
    scratchOutputPath } from "../bench/identity-oracle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const smallWindow = { warmupSteps: 4, measuredSteps: 60 };
const resolve = (relative) => path.resolve(root, relative);
const oraclePath = resolve("bench/identity-oracle.mjs");
const pinPath = resolve("bench/results/policy-10-4-fingerprints.json");

const runCli = (...args) => spawnSync(process.execPath, [oraclePath, ...args], { encoding: "utf8" });
const cliOutput = (result) => `${result.stdout}${result.stderr}`;
const shaOf = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

test("the release and timers builds are bit-identical at every step", async () => {
    const verdict = await compareModules({
        basePath: resolve(RELEASE_WASM),
        candidatePath: resolve(TIMERS_WASM),
        counts: [250],
        window: smallWindow
    });
    assert.equal(verdict.preserving, true, JSON.stringify(verdict.scenes));
    assert.equal(verdict.differingSteps, 0);
    assert.deepEqual(verdict.scenes.map((scene) => scene.key),
        ["box250", "standard256", "hinge128", "sphere250", "capsule250"]);
    assert.deepEqual(verdict.scenes.map((scene) => scene.steps), [64, 64, 64, 64, 64]);
    assert.equal(verdict.totalSteps, 320);
    const boxScenes = verdict.scenes.filter((scene) => /^box\d+$/.test(scene.key));
    assert.equal(boxScenes.length, 1, "counts [250] must select exactly one box scene");
    for (const scene of boxScenes) {
        assert.ok(Number.isInteger(scene.baseFirstContactStep) && scene.baseFirstContactStep >= 1
            && scene.baseFirstContactStep <= scene.steps,
            `${scene.key}: contact onset must fall inside the window or the identity claim is vacuous `
            + `(measured baseFirstContactStep=${scene.baseFirstContactStep}, steps=${scene.steps})`);
    }
    for (const scene of verdict.scenes) {
        assert.equal(scene.baseFingerprint, scene.candidateFingerprint, scene.key);
        assert.equal(scene.baseContacts, scene.candidateContacts, scene.key);
    }

    const recorded = JSON.parse(fs.readFileSync(pinPath, "utf8"));
    const expected = recorded.cells.map((cell) => ({ count: cell.count, fingerprint: cell.fingerprint,
        contacts: cell.contacts }));
    assert.equal(verdict.pinAttestation.pinFile, "bench/results/policy-10-4-fingerprints.json");
    assert.equal(verdict.pinAttestation.pinVariant, "wasm-release");
    assert.deepEqual(verdict.pinAttestation.cells.map((cell) => ({ count: cell.count,
        fingerprint: cell.expectedFingerprint, contacts: cell.expectedContacts })), expected,
    "the attestation must promise exactly the pins recorded in the campaign pin file");
    assert.equal(verdict.pinAttestation.baseSha256, verdict.identity.base.sha256,
        "the attestation must name the module that was actually driven as base");
});

test("the oracle reports divergence when the trajectories diverge", async () => {
    const verdict = await compareModules({
        basePath: resolve(RELEASE_WASM),
        candidatePath: resolve(FAST_WASM),
        counts: [250],
        window: smallWindow
    });
    assert.equal(verdict.preserving, false, "a build whose numerics differ must not read as preserving");
    assert.ok(verdict.differingSteps > 0, "the divergence count must be a real count, not a null");
    assert.deepEqual(verdict.contactBearingScenes, ["box250", "standard256", "sphere250", "capsule250"],
        "these are the selected scenes that carry contacts inside this window; hinge128 does not");
    for (const scene of verdict.scenes.filter((entry) => entry.contactBearingInWindow)) {
        assert.ok(scene.differingSteps > 0, `${scene.key}: a contact-bearing scene must diverge under fast-math`);
        assert.ok(Number.isInteger(scene.firstDivergentStep) && scene.firstDivergentStep >= 1,
            `${scene.key}: firstDivergentStep must be a step number`);
        assert.equal(typeof scene.divergedBeforeBaseContacts, "boolean",
            `${scene.key}: the causal diagnostic must be recorded, not asserted`);
    }
    const hinge = verdict.scenes.find((scene) => scene.key === "hinge128");
    assert.ok(hinge.differingSteps > 0, "the jointed path must still diverge under fast-math, which is the "
        + "joint solver and not the contact population the control is meant to prove");
    assert.equal(hinge.contactBearingInWindow, false, "hinge128 must be labelled as carrying no contact "
        + "evidence inside this window");
});

test("comparing a build against its own bytes is refused", async () => {
    await assert.rejects(
        () => compareModules({
            basePath: resolve(RELEASE_WASM),
            candidatePath: resolve(RELEASE_WASM),
            counts: [250],
            window: smallWindow
        }),
        /resolve to the same file[\s\S]*different builds/
    );
});

test("a preserving verdict names the rules it was produced under", async () => {
    const verdict = await compareModules({
        basePath: resolve(RELEASE_WASM),
        candidatePath: resolve(TIMERS_WASM),
        counts: [250],
        window: { warmupSteps: 4, measuredSteps: 20 }
    });
    assert.equal(verdict.protocol, IDENTITY_PROTOCOL,
        "an artifact must be readable without guessing which refusals were in force when it was written");
    assert.match(IDENTITY_PROTOCOL, /^identity-protocol: 1/);
    assert.match(IDENTITY_PROTOCOL, /same-build pairings refused/);
    assert.match(IDENTITY_PROTOCOL, /worldMemoryBytes recorded but not verdict-bearing/);
});

test("two files of one build are refused", async () => {
    await assert.rejects(
        () => compareModules({
            basePath: resolve("build/wasm-release/physics.wasm"),
            candidatePath: resolve("build/wasm-release/physics.opt.wasm"),
            counts: [250],
            window: smallWindow
        }),
        /both from the "wasm-release" build[\s\S]*different builds/
    );
});

test("a base that does not reproduce the campaign pins is refused", async () => {
    await assert.rejects(
        () => compareModules({
            basePath: resolve(FAST_WASM),
            candidatePath: resolve(TIMERS_WASM),
            counts: [250],
            window: smallWindow
        }),
        /does not reproduce the campaign pin for box 250[\s\S]*frozen pre-lever build/
    );
});

test("an override cannot launder a pin value into the attestation", async () => {
    const wrongPinForEveryScene = "98ddbd470475b15c";
    const error = await compareModules({
        basePath: resolve(FAST_WASM),
        candidatePath: resolve(TIMERS_WASM),
        counts: [250],
        window: smallWindow,
        fingerprintOverride: () => wrongPinForEveryScene
    }).catch((thrown) => thrown);
    assert.ok(error instanceof Error,
        "a non-pin base must be refused even when the run digests are all a real campaign pin");
    assert.match(error.message, /does not reproduce the campaign pin for box 250/);
    assert.doesNotMatch(error.message, new RegExp(`observed ${wrongPinForEveryScene}`),
        "the attestation must report the clean read, not the overridden run digest");
});

test("a window in which contacts never begin is refused", async () => {
    const boxOnly = SCENES.filter((scene) => /^box\d+$/.test(scene.key));
    assert.equal(boxOnly.length, 4, "the vacuous-window case needs the box scenes, whose onset is step 21");
    await assert.rejects(
        () => compareModules({
            basePath: resolve(RELEASE_WASM),
            candidatePath: resolve(TIMERS_WASM),
            scenes: boxOnly,
            counts: [250],
            window: { warmupSteps: 1, measuredSteps: 2 }
        }),
        /refusing to certify a preserving verdict over a contact-free window/
    );
});

test("a scene builder that initialises nothing is refused", async () => {
    await assert.rejects(
        () => compareModules({
            basePath: resolve(RELEASE_WASM),
            candidatePath: resolve(TIMERS_WASM),
            scenes: [{ key: "noop", build: () => {} }],
            window: smallWindow
        }),
        /base module reports 0 bodies after building scene noop/
    );
});

test("a requested count that matches no scene is refused", async () => {
    await assert.rejects(
        () => compareModules({
            basePath: resolve(RELEASE_WASM),
            candidatePath: resolve(TIMERS_WASM),
            counts: [2500],
            window: smallWindow
        }),
        /match no box scene[\s\S]*refusing to drop a requested count/
    );
});

test("an unknown window key is refused instead of silently running the default", async () => {
    await assert.rejects(
        () => compareModules({
            basePath: resolve(RELEASE_WASM),
            candidatePath: resolve(TIMERS_WASM),
            counts: [250],
            window: { warmup: 4, measured: 12 }
        }),
        /window carries unknown keys \["warmup","measured"\]/
    );
});

test("an empty window is refused", async () => {
    await assert.rejects(
        () => compareModules({
            basePath: resolve(RELEASE_WASM),
            candidatePath: resolve(TIMERS_WASM),
            counts: [250],
            window: { warmupSteps: 0, measuredSteps: 0 }
        }),
        /window must contain at least one step/
    );
});

test("a missing module names the preset that is actually missing", async () => {
    await assert.rejects(
        () => compareModules({
            basePath: resolve("build/wasm-release/physics.wasm"),
            candidatePath: resolve("build/wasm-does-not-exist/physics.wasm"),
            counts: [250],
            window: smallWindow
        }),
        /is missing; run node scripts\/build\.mjs wasm-does-not-exist first/
    );
});

test("a null fingerprint fails closed", async () => {
    const verdict = await compareModules({
        basePath: resolve(RELEASE_WASM),
        candidatePath: resolve(TIMERS_WASM),
        counts: [250],
        window: smallWindow,
        fingerprintOverride: () => null
    }).catch((error) => error);
    assert.ok(verdict instanceof Error, "a null digest must throw rather than compare equal to another null");
});

test("the all-zero digest of a dead world fails closed", async () => {
    const verdict = await compareModules({
        basePath: resolve(RELEASE_WASM),
        candidatePath: resolve(TIMERS_WASM),
        counts: [250],
        window: smallWindow,
        fingerprintOverride: () => "0000000000000000"
    }).catch((error) => error);
    assert.ok(verdict instanceof Error,
        "two uninitialised worlds both read 0000000000000000 and must not compare as bit-identical");
    assert.match(verdict.message, /all-zero digest/);
});

test("scratch output is named after the bytes it measured", () => {
    const first = scratchOutputPath("4c2a6ae640e6ccbcd007", "0da7d89fc50650999156");
    const second = scratchOutputPath("450a585a9c2e242f1165", "0da7d89fc50650999156");
    assert.equal(path.basename(first), "identity-oracle-4c2a6ae6-0da7d89f.json");
    assert.notEqual(first, second, "two different base builds must not overwrite each other's verdict");
    assert.equal(path.dirname(first), resolve(".tmp"));
});

test("the command line refuses unknown flags instead of defaulting", () => {
    const result = runCli("--candiate", "build/wasm-fast/physics.wasm");
    assert.equal(result.status, 2, "a misspelled flag must not exit green with the default pairing");
    assert.match(cliOutput(result), /usage: unknown argument "--candiate"/);
});

test("a repeated flag is refused instead of last-wins", () => {
    const result = runCli("--base", "build/wasm-release/physics.wasm", "--base", "build/wasm-timers/physics.wasm");
    assert.equal(result.status, 2);
    assert.match(cliOutput(result), /usage: --base was given twice/);
});

test("a trailing flag with no value is a usage error, not a TypeError", () => {
    const counts = runCli("--counts");
    assert.equal(counts.status, 2);
    assert.match(cliOutput(counts), /usage: --counts requires a value/);
    assert.doesNotMatch(cliOutput(counts), /TypeError|Cannot read properties/);
    const base = runCli("--base");
    assert.equal(base.status, 2);
    assert.match(cliOutput(base), /usage: --base requires a value/);
});

test("the command line refuses an unmatched count without touching the baseline", () => {
    const before = shaOf(OUTPUT_PATH);
    const result = runCli("--counts", "2500");
    assert.equal(result.status, 1);
    assert.match(cliOutput(result), /match no box scene/);
    assert.equal(shaOf(OUTPUT_PATH), before, "a refused run must leave the tracked baseline byte-identical");
});

test("--out refuses to retarget the tracked baseline", () => {
    const relative = path.relative(root, OUTPUT_PATH).split(path.sep).join("/");
    const result = runCli("--out", relative);
    assert.equal(result.status, 2);
    assert.match(cliOutput(result), /--out must not point at the tracked baseline/);
    assert.equal(fs.existsSync(resolve(".tmp/probe-out.json")), false);
});

test("a lever verdict with --out is a durable artifact and leaves the baseline alone", (t) => {
    const outRelative = ".tmp/probe-out.json";
    const outPath = resolve(outRelative);
    if (fs.existsSync(outPath)) {
        fs.rmSync(outPath);
    }
    const before = shaOf(OUTPUT_PATH);
    const result = runCli("--base", RELEASE_WASM, "--candidate", TIMERS_WASM, "--counts", "250",
        "--out", outRelative);
    t.diagnostic(cliOutput(result));
    assert.equal(result.status, 0, cliOutput(result));
    assert.equal(shaOf(OUTPUT_PATH), before, "an explicit --out run must not rewrite the tracked baseline");
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.preserving, true);
    assert.equal(written.identity.base.sha256, shaOf(resolve(RELEASE_WASM)));
    assert.equal(written.identity.candidate.sha256, shaOf(resolve(TIMERS_WASM)));
    assert.match(cliOutput(result), new RegExp(`artifact=${outRelative.replace(".", "\\.")}`));
    fs.rmSync(outPath);
});
