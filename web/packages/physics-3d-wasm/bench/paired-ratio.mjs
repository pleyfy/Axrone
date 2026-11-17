import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
    addBoxPileScene,
    addCapsulePileScene,
    addHingeChainScene,
    addSpherePileScene,
    addStandardScene,
    fingerprintHex,
    loadWasm,
    STANDARD_DT
} from "../scripts/scene.mjs";
import { PHYSICS_ITERATION_POLICY as policy } from "../scripts/policy.mjs";
import { median } from "./lib/median.mjs";
import { hostIsQuiet, hostLoad, loadedHostNote, ratioMarginExceedsNoise, relativeSpread } from "./variants.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const LEVER_GAIN_BAR = 1.087;
export const NO_REGRESSION_BAR = 0.95;
export const PROTECTED_KINDS = ["sphere", "capsule", "hinge"];
export const MIN_CONTACTS_PER_BODY = 1.5;
export const PINNED_COUNTS = [250, 1000, 2000, 5000];
export const VERDICT_PROTOCOL = "verdict-protocol: 2 — self-simulation refused unless --preserving + "
    + "--noise-floor; gainExceedsNoise is a second bar at 1 + noiseMargin, not a modifier of 1.087; "
    + "protected cells inside their own spread are reported indeterminate, never cleared";

const cellFloor = (cell, noiseFloor) => {
    if (noiseFloor === null || noiseFloor === undefined) {
        return cell.noiseMargin;
    }
    const entry = (noiseFloor.perCell || []).find((item) => item.key === cell.key);
    const recorded = entry ? Math.abs(Number(entry.deviation)) : null;
    const values = [cell.noiseMargin, recorded].filter((value) => Number.isFinite(value));
    return values.length ? Math.max(...values) : null;
};

const exceedsNoiseFloor = (cell, noiseFloor) => {
    const floor = cellFloor(cell, noiseFloor);
    if (floor === null) {
        return true;
    }
    return Math.abs(cell.ratio - 1) > floor;
};

const floorFor = (cell, noiseFloor) => {
    const floor = cellFloor(cell, noiseFloor);
    return floor === null ? "unmeasured" : `${floor.toFixed(4)}`;
};
export const RELEASE_WASM = "build/wasm-release/physics.wasm";
export const DEFAULT_WINDOW = { warmupSteps: 40, measuredSteps: 120 };

export const moduleIdentity = (modulePath) => {
    const bytes = fs.readFileSync(modulePath);
    return {
        file: path.relative(root, modulePath).split(path.sep).join("/"),
        bytes: bytes.byteLength,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    };
};

export const contactsPerBody = (row) => Number.isFinite(row.contacts) && row.count > 0
    ? row.contacts / row.count
    : null;

const NO_PROBE_NOTE = "the caller supplied no host-load probes, so this verdict carries no quiet or loaded label; "
    + "the ratios are load-robust and absolute ms are published only when hostQuiet is true";

export const SCENE_TABLE = [
    { key: "box250", count: 250, kind: "box", build: (e) => addBoxPileScene(e, 250) },
    { key: "box1000", count: 1000, kind: "box", build: (e) => addBoxPileScene(e, 1000) },
    { key: "box2000", count: 2000, kind: "box", build: (e) => addBoxPileScene(e, 2000) },
    { key: "box5000", count: 5000, kind: "box", build: (e) => addBoxPileScene(e, 5000) },
    { key: "sphere250", count: 250, kind: "sphere", build: (e) => addSpherePileScene(e, 250) },
    { key: "capsule250", count: 250, kind: "capsule", build: (e) => addCapsulePileScene(e, 250) },
    { key: "hinge128", count: 128, kind: "hinge", build: (e) => addHingeChainScene(e, 128) }
];

export const cellOf = (count, kind, samples) => {
    if (!Array.isArray(samples) || samples.length < 1) {
        throw new Error(`cell ${kind}${count} needs at least one sample, got ${JSON.stringify(samples)}`);
    }
    if (samples.some((sample) => !Number.isFinite(sample) || sample <= 0)) {
        throw new Error(`cell ${kind}${count} carries a non-finite or non-positive sample: ${samples}`);
    }
    return { count, kind, samples };
};

const spreadOf = (samples) => Math.max(...samples) - Math.min(...samples);

const labelOf = (row) => row.key ?? `${row.kind}${row.count}`;

const cellMs = (row) => {
    if (Number.isFinite(row.ms)) {
        return row.ms;
    }
    if (Array.isArray(row.samples)) {
        cellOf(row.count, row.kind, row.samples);
        return median(row.samples);
    }
    throw new Error(`cell ${labelOf(row)} carries neither a finite ms nor any samples`);
};

const cellSpread = (row, ms) => {
    if (Number.isFinite(row.spread)) {
        return row.spread;
    }
    if (Array.isArray(row.samples) && row.samples.length > 0) {
        return spreadOf(row.samples);
    }
    return ms === null ? null : 0;
};

const timed = (exports, scene, window) => {
    scene.build(exports);
    for (let i = 0; i < window.warmupSteps; i += 1) {
        exports.step(STANDARD_DT, policy.velocityIterations, policy.positionIterations);
    }
    const start = process.hrtime.bigint();
    for (let i = 0; i < window.measuredSteps; i += 1) {
        exports.step(STANDARD_DT, policy.velocityIterations, policy.positionIterations);
    }
    const end = process.hrtime.bigint();
    return {
        ms: Number(end - start) / window.measuredSteps / 1e6,
        fingerprint: fingerprintHex(exports),
        contacts: exports.contactCount()
    };
};

export const collectCells = async (modulePath, scenes, window) => {
    const { exports } = await loadWasm(modulePath);
    return scenes.map((scene) => ({ ...scene, ...timed(exports, scene, window) }));
};

export const pair = (baseRows, candidateRows, { hostQuiet, window }) => {
    if (baseRows.length !== candidateRows.length) {
        throw new Error(`base and candidate measured ${baseRows.length} and ${candidateRows.length} scenes`);
    }
    return baseRows.map((base, index) => {
        const candidate = candidateRows[index];
        if (base.key !== candidate.key) {
            throw new Error(`row ${index} is ${base.key} on one side and ${candidate.key} on the other`);
        }
        const baseMs = cellMs(base);
        const candidateMs = cellMs(candidate);
        const baseSpread = cellSpread(base, baseMs);
        const candidateSpread = cellSpread(candidate, candidateMs);
        const ratio = baseMs / candidateMs;
        const baseCell = { msPerStep: baseMs, spread: baseSpread };
        const candidateCell = { msPerStep: candidateMs, spread: candidateSpread };
        const noiseMargin = (relativeSpread(baseCell) ?? 0) + (relativeSpread(candidateCell) ?? 0);
        const perBody = [contactsPerBody(base), contactsPerBody(candidate)];
        return {
            key: labelOf(base),
            count: base.count,
            kind: base.kind,
            ratio,
            gainExceedsNoise: ratioMarginExceedsNoise(baseCell, candidateCell, ratio) === true,
            noiseMargin,
            requiredRatioForAdoption: 1 + noiseMargin,
            boundBySpread: ratio < 1 + noiseMargin,
            baseSpread,
            candidateSpread,
            baseContacts: base.contacts,
            candidateContacts: candidate.contacts,
            baseFingerprint: base.fingerprint,
            candidateFingerprint: candidate.fingerprint,
            contactsPerBody: perBody.some((value) => value !== null)
                ? Math.max(...perBody.filter((value) => value !== null))
                : null,
            populationEqual: base.contacts === candidate.contacts,
            fingerprintEqual: base.fingerprint === candidate.fingerprint,
            ...(hostQuiet ? { baseMs, candidateMs } : {}),
            window
        };
    });
};

export const coverageGaps = (cells) => {
    const gaps = [];
    for (const cell of cells) {
        if (!PROTECTED_KINDS.includes(cell.kind) || !Number.isFinite(cell.contactsPerBody)) {
            continue;
        }
        if (cell.contactsPerBody === 0) {
            gaps.push(`${labelOf(cell)} makes no contacts at all in this window: it can only ever witness the `
                + "jointed path, so it must not be quoted as contact coverage for spec 2's no-regression row");
            continue;
        }
        if (cell.contactsPerBody < MIN_CONTACTS_PER_BODY) {
            gaps.push(`${labelOf(cell)} carries only ${cell.contactsPerBody.toFixed(2)} contacts per body, `
                + `below the ${MIN_CONTACTS_PER_BODY} coverage floor: its contact graph is too thin to load the `
                + "solver the way a pile does, so it cannot be quoted as contact coverage for spec 2's "
                + "no-regression row");
        }
    }
    return gaps;
};

const cellMargin = (cell, noiseFloor) => {
    const values = [cell.noiseMargin, cellFloor(cell, noiseFloor)].filter((value) => Number.isFinite(value));
    return values.length ? Math.max(...values) : 0;
};

export const indeterminateCells = (cells, noiseFloor) => cells
    .filter((cell) => PROTECTED_KINDS.includes(cell.kind))
    .map((cell) => {
        const margin = cellMargin(cell, noiseFloor);
        const barDistance = Math.abs(cell.ratio - NO_REGRESSION_BAR);
        return { key: labelOf(cell), kind: cell.kind, count: cell.count, ratio: cell.ratio,
            noRegressionBar: NO_REGRESSION_BAR, barDistance, margin,
            onWhichSide: cell.ratio >= NO_REGRESSION_BAR ? "clears the bar" : "under the bar",
            indeterminate: barDistance <= margin };
    })
    .filter((entry) => entry.indeterminate);

export const rotationSchedule = (repeats) => Array.from({ length: repeats },
    (_, repeat) => ({ repeat, order: repeat % 2 === 0 ? "base-first" : "candidate-first" }));

export const rotationReport = (schedule) => {
    const baseFirstRuns = schedule.filter((entry) => entry.order === "base-first").length;
    const candidateFirstRuns = schedule.length - baseFirstRuns;
    const pairs = [];
    for (let index = 0; index + 1 < schedule.length; index += 2) {
        pairs.push(schedule[index].order !== schedule[index + 1].order);
    }
    return {
        rule: "collection order alternates every repeat, so each adjacent pair measures both orders; an odd "
            + "repeat count leaves one unpaired run, and that residual is reported rather than rounded away",
        schedule,
        baseFirstRuns,
        candidateFirstRuns,
        balanced: baseFirstRuns === candidateFirstRuns,
        everyAdjacentPairBalanced: pairs.every((entry) => entry) && pairs.length > 0,
        residualImbalance: Math.abs(baseFirstRuns - candidateFirstRuns),
        note: baseFirstRuns === candidateFirstRuns
            ? "the schedule is order-balanced"
            : `an odd repeat count cannot be order-balanced: ${baseFirstRuns} base-first against `
                + `${candidateFirstRuns} candidate-first. Recorded rather than hidden.`
    };
};

export const decide = (cells, options = {}) => {
    const { preserving = false, noiseFloor = null, sameBytes = false } = options;
    const gaps = coverageGaps(cells);
    const boxCells = cells.filter((cell) => cell.kind === "box"
        && PINNED_COUNTS.includes(cell.count));
    const identityRecorded = boxCells.every((cell) => typeof cell.baseFingerprint === "string"
        && typeof cell.candidateFingerprint === "string" && Number.isFinite(cell.baseContacts));
    const sameSimulation = boxCells.length > 0 && identityRecorded
        && boxCells.every((cell) => cell.fingerprintEqual && cell.populationEqual)
        && cells.every((cell) => cell.fingerprintEqual !== false);
    if (sameSimulation && !preserving) {
        const deviations = cells.map((cell) => Math.abs(cell.ratio - 1));
        const deciding = cells.find((cell) => cell.kind === "box" && cell.count === 1000);
        return {
            adopt: null,
            decidedOn: "self-noise",
            protocol: VERDICT_PROTOCOL,
            leverBar: LEVER_GAIN_BAR,
            noRegressionBar: NO_REGRESSION_BAR,
            vetoes: [],
            indeterminate: indeterminateCells(cells, noiseFloor),
            coverageGaps: gaps,
            selfNoiseFloor: {
                measuredOn: sameBytes
                    ? "self-vs-self: one binary measured twice on one host, interleaved, order rotated"
                    : "two builds that simulate identically, measured against each other on one host",
                maxRatioDeviation: deviations.length ? Math.max(...deviations) : null,
                decidingBox1000Deviation: deciding ? Math.abs(deciding.ratio - 1) : null,
                leverBarOverNoise: deciding && Math.abs(deciding.ratio - 1) > 0
                    ? (LEVER_GAIN_BAR - 1) / Math.abs(deciding.ratio - 1)
                    : null,
                perCell: cells.map((cell) => ({ key: cell.key, ratio: cell.ratio,
                    signedDeviation: cell.ratio - 1,
                    deviation: Math.abs(cell.ratio - 1), noiseMargin: cell.noiseMargin,
                    requiredRatioForAdoption: cell.requiredRatioForAdoption,
                    contactsPerBody: cell.contactsPerBody }))
            },
            note: "every pinned box cell computed identical fingerprints and identical contact populations, so "
                + "this run compares two builds that simulate the same thing. It measures harness scatter only: "
                + "it supports no adoption claim, no no-regression breach and no regression claim. Pass "
                + "--preserving with --noise-floor <self-noise artifact> to turn a numerically-preserving lever "
                + "into a speed verdict.",
            ...(noiseFloor ? { noiseFloorReference: noiseFloor } : {})
        };
    }
    const box1000 = cells.find((cell) => cell.kind === "box" && cell.count === 1000);
    if (box1000 === undefined) {
        throw new Error("the verdict needs a box 1000 cell; spec 12.8's gain bar is defined on it");
    }
    const vetoes = [];
    if (!(box1000.ratio >= LEVER_GAIN_BAR)) {
        vetoes.push(`box 1000 ratio ${box1000.ratio.toFixed(4)}x is under the ${LEVER_GAIN_BAR}x lever bar`);
    }
    if (box1000.gainExceedsNoise !== true) {
        vetoes.push("the box 1000 gain is inside the combined spread, so the measurement cannot tell it from noise");
    }
    for (const cell of cells) {
        if (!PROTECTED_KINDS.includes(cell.kind)) {
            continue;
        }
        if (preserving && !exceedsNoiseFloor(cell, noiseFloor)) {
            continue;
        }
        if (cell.ratio < NO_REGRESSION_BAR) {
            vetoes.push(`${labelOf(cell)} regressed to ${cell.ratio.toFixed(4)}x, worse than the 0.95x `
                + `no-regression bar and outside the measured noise floor ${floorFor(cell, noiseFloor)}`);
        }
    }
    for (const cell of cells) {
        if (!cell.populationEqual) {
            vetoes.push(`${labelOf(cell)} changed the contact population: a population change disqualifies the speed claim`);
        }
    }
    const indeterminate = indeterminateCells(cells, noiseFloor);
    const spreadBound = box1000.gainExceedsNoise !== true;
    const barBound = !(box1000.ratio >= LEVER_GAIN_BAR);
    return {
        adopt: vetoes.length === 0 && gaps.length === 0,
        decidedOn: "paired-ratio",
        protocol: VERDICT_PROTOCOL,
        leverBar: LEVER_GAIN_BAR,
        noRegressionBar: NO_REGRESSION_BAR,
        decidingCell: { key: labelOf(box1000), ratio: box1000.ratio,
            requiredRatioForAdoption: box1000.requiredRatioForAdoption,
            noiseMargin: box1000.noiseMargin,
            effectiveBar: Math.max(LEVER_GAIN_BAR, box1000.requiredRatioForAdoption) },
        bindingCondition: spreadBound && barBound ? "both the 1.087x lever bar and this run's spread"
            : spreadBound ? "the spread: the gain had to exceed 1 + noiseMargin, not 1.087"
                : barBound ? "the 1.087x lever bar" : "nothing: the deciding cell cleared both bars",
        vetoes,
        indeterminate,
        coverageGaps: gaps,
        ...(preserving ? { preservingVerdict: true, noiseFloorReference: noiseFloor ?? null } : {})
    };
};

export const pairedVerdict = ({ base, candidate, hostQuiet, window = DEFAULT_WINDOW,
    hostBefore, hostAfter, basePath, candidatePath, selfNoiseFloor, subject, preserving = false,
    noiseFloor = null }) => {
    if (typeof subject !== "string" || subject.trim() === "") {
        throw new Error("a paired-ratio verdict needs a subject naming what it compares; an unlabelled verdict "
            + "cannot be told apart from a re-baselining or self-noise run by anyone reading the file later");
    }
    const cells = pair(base, candidate, { hostQuiet, window });
    const sameBytes = Boolean(basePath && candidatePath
        && fs.realpathSync(basePath) === fs.realpathSync(candidatePath));
    const verdict = decide(cells, { preserving, noiseFloor, sameBytes });
    const selfNoise = verdict.selfNoiseFloor;
    delete verdict.selfNoiseFloor;
    return {
        subject,
        cells,
        verdict,
        ...(selfNoise ? { selfNoiseFloor: selfNoise } : {}),
        hostQuiet,
        absoluteMsPublished: hostQuiet,
        ...(basePath && candidatePath
            ? { moduleIdentity: { base: moduleIdentity(basePath), candidate: moduleIdentity(candidatePath) } }
            : {}),
        ...(selfNoiseFloor ? { selfNoiseFloor } : {}),
        hostNote: hostQuiet ? "quiet-host sample"
            : (hostBefore && hostAfter ? loadedHostNote(hostBefore, hostAfter) : NO_PROBE_NOTE)
    };
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath.endsWith(path.join("bench", "paired-ratio.mjs"))) {
    const args = process.argv.slice(2);
    const valueAfter = (flag) => args[args.indexOf(flag) + 1];
    const has = (flag) => args.includes(flag);
    const base = path.resolve(root, has("--base") ? valueAfter("--base") : RELEASE_WASM);
    const candidate = path.resolve(root, has("--candidate") ? valueAfter("--candidate") : RELEASE_WASM);
    const repeats = Math.max(1, Number.parseInt(has("--repeats") ? valueAfter("--repeats") : "5", 10));
    const window = {
        warmupSteps: has("--warmup") ? Number(valueAfter("--warmup")) : DEFAULT_WINDOW.warmupSteps,
        measuredSteps: has("--measured") ? Number(valueAfter("--measured")) : DEFAULT_WINDOW.measuredSteps
    };

    const sameBinary = fs.realpathSync(base) === fs.realpathSync(candidate);
    const trackedPath = path.join(root, "bench", "results", "paired-ratio.json");
    const defaultRun = args.length === 0;
    const outOverride = has("--out") ? path.resolve(root, valueAfter("--out")) : null;
    if (outOverride === trackedPath) {
        throw new Error("--out must not point at the tracked paired-ratio baseline; only a flagless run may "
            + "rewrite it, and a lever verdict belongs in its own bench/results/paired-ratio-<lever>.json");
    }
    const subject = has("--subject") ? valueAfter("--subject")
        : (sameBinary ? "self-noise re-baseline" : undefined);
    if (subject === undefined) {
        throw new Error("a lever run needs --subject <what this compares>; an unlabelled artifact cannot be "
            + "told apart from a self-noise or re-baselining run after the fact");
    }

    const loadBefore = hostLoad();
    const baseSamples = [];
    const candidateSamples = [];
    const schedule = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
        const baseFirst = repeat % 2 === 0;
        const pass = baseFirst
            ? [await collectCells(base, SCENE_TABLE, window), await collectCells(candidate, SCENE_TABLE, window)]
            : [await collectCells(candidate, SCENE_TABLE, window), await collectCells(base, SCENE_TABLE, window)];
        const [baseRow, candidateRow] = baseFirst ? [pass[0], pass[1]] : [pass[1], pass[0]];
        schedule.push({ repeat, order: baseFirst ? "base-first" : "candidate-first" });
        baseRow.forEach((row, index) => baseSamples[index] = [...(baseSamples[index] ?? []), row.ms]);
        candidateRow.forEach((row, index) => candidateSamples[index] = [...(candidateSamples[index] ?? []), row.ms]);
    }
    const loadAfter = hostLoad();

    const intended = rotationSchedule(repeats);
    if (schedule.length !== intended.length || schedule.some((entry, index) => entry.order !== intended[index].order)) {
        throw new Error("the rotation that ran does not match the rotation the driver advertises: "
            + `${JSON.stringify(schedule)} against ${JSON.stringify(intended)}`);
    }
    const rotation = rotationReport(schedule);

    const identityPass = async (modulePath) => {
        const { exports } = await loadWasm(modulePath);
        return SCENE_TABLE.map((scene) => timed(exports, scene, window));
    };
    const baseIdentity = await identityPass(base);
    const candidateIdentity = await identityPass(candidate);

    const rows = SCENE_TABLE.map((scene, index) => ({
        ...scene,
        ...baseIdentity[index],
        ms: median(baseSamples[index]),
        spread: spreadOf(baseSamples[index])
    }));
    const candidateRows = SCENE_TABLE.map((scene, index) => ({
        ...scene,
        ...candidateIdentity[index],
        ms: median(candidateSamples[index]),
        spread: spreadOf(candidateSamples[index])
    }));

    const noiseFloorPath = has("--noise-floor") ? path.resolve(root, valueAfter("--noise-floor")) : null;
    const noiseFloor = noiseFloorPath === null ? null
        : JSON.parse(fs.readFileSync(noiseFloorPath, "utf8")).verdict?.selfNoiseFloor
            ?? JSON.parse(fs.readFileSync(noiseFloorPath, "utf8")).selfNoiseFloor;
    if (has("--preserving") && noiseFloor === null) {
        throw new Error("--preserving needs --noise-floor <self-noise artifact>: without a measured floor a "
            + "regression bar cannot be told from host scatter, which is the claim this file must not make");
    }

    const quiet = hostIsQuiet(loadBefore) && hostIsQuiet(loadAfter);
    const result = pairedVerdict({ base: rows, candidate: candidateRows, hostQuiet: quiet, window,
        hostBefore: loadBefore, hostAfter: loadAfter, basePath: base, candidatePath: candidate,
        subject, preserving: has("--preserving"), noiseFloor });
    const outPath = outOverride ?? (defaultRun
        ? trackedPath
        : path.join(root, ".tmp", `paired-ratio-${result.moduleIdentity?.base.sha256.slice(0, 8) ?? "unknown"}-`
            + `${result.moduleIdentity?.candidate.sha256.slice(0, 8) ?? "unknown"}.json`));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        protocol: VERDICT_PROTOCOL,
        base: base.replace(root, "").split(path.sep).join("/"),
        candidate: candidate.replace(root, "").split(path.sep).join("/"),
        repeats,
        rotation,
        hostBefore: loadBefore,
        hostAfter: loadAfter,
        ...result
    }, null, 2)}\n`);

    for (const cell of result.cells) {
        const ms = result.absoluteMsPublished
            ? ` ${cell.baseMs.toFixed(3)} -> ${cell.candidateMs.toFixed(3)} ms`
            : " ms withheld: loaded host";
        console.log(`${cell.key.padEnd(12)} ratio=${cell.ratio.toFixed(4)}x needs>=${cell.requiredRatioForAdoption.toFixed(4)}x${ms} `
            + `noise=${cell.gainExceedsNoise} pop=${cell.populationEqual} fp=${cell.fingerprintEqual}`);
    }
    if (result.verdict.decidingCell !== undefined) {
        const deciding = result.verdict.decidingCell;
        console.log(`deciding=${deciding.key} ratio=${deciding.ratio.toFixed(4)}x publishedBar=${LEVER_GAIN_BAR} `
            + `effectiveBar=${deciding.effectiveBar.toFixed(4)}x binding="${result.verdict.bindingCondition}"`);
    }
    for (const entry of result.verdict.indeterminate ?? []) {
        console.log(`indeterminate: ${entry.key} ${entry.onWhichSide} 0.95 by `
            + `${(entry.barDistance * 100).toFixed(2)} pp, inside its own ${(entry.margin * 100).toFixed(2)} pp margin`);
    }
    console.log(`rotation: ${rotation.baseFirstRuns} base-first / ${rotation.candidateFirstRuns} candidate-first `
        + `balanced=${rotation.balanced} residual=${rotation.residualImbalance}`);
    console.log(`adopt=${result.verdict.adopt} hostQuiet=${result.hostQuiet} decidedOn=${result.verdict.decidedOn} subject="${result.subject}"`);
    if (result.verdict.note !== undefined) {
        console.log(`note: ${result.verdict.note}`);
    }
    if (result.selfNoiseFloor !== undefined) {
        console.log(`selfNoiseFloor max=${result.selfNoiseFloor.maxRatioDeviation} `
            + `box1000=${result.selfNoiseFloor.decidingBox1000Deviation} `
            + `leverBarOverNoise=${result.selfNoiseFloor.leverBarOverNoise}`);
    }
    for (const veto of result.verdict.vetoes) {
        console.log(`  veto: ${veto}`);
    }
    console.log(outPath);
}
