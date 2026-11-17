import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { median } from "./lib/median.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const VARIANTS = [
    { preset: "wasm-release", simd: false, fastMath: false },
    { preset: "wasm-simd", simd: true, fastMath: false },
    { preset: "wasm-fast", simd: false, fastMath: true },
    { preset: "wasm-fast-simd", simd: true, fastMath: true }
];

export const COUNTS = [250, 1000, 2000, 5000];
const REPEATS = 3;
const ADOPTION_GAIN = 1.15;
const QUIET_HOST_CPU_PERCENT = 5;
const RELEASE_PRESET = "wasm-release";
const BENCH_JSON_SOURCE = "bench-json";
const CONSOLE_FALLBACK_SOURCE = "console-fallback";
const IDENTITY_PREFIX_HEX = 16;
const MICROSECONDS_PER_MILLISECOND = 1000;
const LOG_LABEL_WIDTH = 16;

const relative = (filePath) => path.relative(root, filePath).split(path.sep).join("/");

export const parseBenchOutput = (output) => output.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^wasm-[\w-]+\s/.test(line))
    .map((line) => line.split(/\s+/))
    .map(([variant, bodies, stepMs, contacts, memoryMb, , fingerprint]) => ({
        variant,
        count: Number(bodies),
        msPerStep: Number(stepMs),
        contacts: Number(contacts),
        memoryMb: Number(memoryMb),
        fingerprint,
        minMs: null,
        maxMs: null,
        sizeBytes: null
    }));

export const parseBenchReport = (report) => report.results.map((row) => ({
    variant: row.variant,
    count: row.count,
    msPerStep: row.ms,
    minMs: row.minMs,
    maxMs: row.maxMs,
    contacts: row.contacts,
    fingerprint: row.fingerprint,
    memoryMb: row.memoryMb,
    sizeBytes: row.sizeBytes,
    imports: row.imports
}));

const reportPathFromOutput = (output) => {
    const match = /results=(\S+)/.exec(output);
    return match === null ? null : path.resolve(root, match[1]);
};

const readBenchReport = (output) => {
    const reportPath = reportPathFromOutput(output);
    if (reportPath === null || !fs.existsSync(reportPath)) {
        return null;
    }
    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    if (!Array.isArray(report.results) || report.results.length === 0) {
        throw new Error(`${relative(reportPath)} was written but carries no results; refusing to fall back to the rounded console table`);
    }
    return {
        reportPath: relative(reportPath),
        environment: report.environment ?? null,
        rows: parseBenchReport(report)
    };
};

const sha256Of = (filePath) => fs.existsSync(filePath)
    ? crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex")
    : null;

const statBytes = (filePath) => fs.existsSync(filePath) ? fs.statSync(filePath).size : null;

export const moduleIdentity = (preset) => {
    const dir = path.join(root, "build", preset);
    const wasmPath = path.join(dir, "physics.wasm");
    const optPath = path.join(dir, "physics.opt.wasm");
    return {
        preset,
        wasm: relative(wasmPath),
        bytes: statBytes(wasmPath),
        sha256: sha256Of(wasmPath),
        optWasm: relative(optPath),
        optBytes: statBytes(optPath),
        optSha256: sha256Of(optPath)
    };
};

const identityEquals = (left, right) => left !== null && right !== null
    && left.bytes === right.bytes
    && left.sha256 === right.sha256
    && left.optBytes === right.optBytes
    && left.optSha256 === right.optSha256;

const identityLabel = (identity) => `${identity.bytes} B / ${String(identity.sha256).slice(0, IDENTITY_PREFIX_HEX)} (opt ${identity.optBytes} B / ${String(identity.optSha256).slice(0, IDENTITY_PREFIX_HEX)})`;

export const hostLoad = () => {
    const base = {
        cpus: os.cpus().length,
        freemem: os.freemem(),
        totalmem: os.totalmem(),
        node: process.version,
        platform: `${process.platform}-${process.arch}`
    };
    if (process.platform !== "win32") {
        return { ...base, processes: null, cpuBusyPercent: null, loadSource: "os-only" };
    }
    const probe = spawnSync("powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$os = Get-CimInstance Win32_OperatingSystem; "
        + "Write-Output ('PROCS=' + (Get-Process).Count); "
        + "Write-Output ('CPUPCT=' + ((Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average)); "
        + "Write-Output ('FREEMB=' + [math]::Round($os.FreePhysicalMemory/1024)); "
        + "Write-Output ('TOTMB=' + [math]::Round($os.TotalVisibleMemorySize/1024))"
    ], { encoding: "utf8" });
    if (probe.status !== 0 || typeof probe.stdout !== "string") {
        return { ...base, processes: null, cpuBusyPercent: null, loadSource: "powershell-unavailable" };
    }
    const field = (label) => {
        const match = new RegExp(`${label}=([-\\d.]+)`).exec(probe.stdout);
        return match === null ? null : Number(match[1]);
    };
    return {
        ...base,
        processes: field("PROCS"),
        cpuBusyPercent: field("CPUPCT"),
        freeMemoryMb: field("FREEMB"),
        totalMemoryMb: field("TOTMB"),
        loadSource: "powershell"
    };
};

export const hostIsQuiet = (load) => load !== null
    && Number.isFinite(load.cpuBusyPercent)
    && load.cpuBusyPercent <= QUIET_HOST_CPU_PERCENT;

const hostProbeUsable = (load) => Number.isFinite(load.cpuBusyPercent);

export const loadedHostNote = (before, after) => {
    if (!hostProbeUsable(before) || !hostProbeUsable(after)) {
        const probes = [before.loadSource, after.loadSource].filter((entry, index, all) => all.indexOf(entry) === index).join(" / ");
        return `The host-load probe returned no CPU reading at the study edges (source ${probes}), so this study cannot be labelled quiet or loaded; treat every ms column as unverified for host load. Contacts, fingerprints, memory and module identities are load-independent.`;
    }
    return hostIsQuiet(before) && hostIsQuiet(after)
        ? `Host measured ${before.cpuBusyPercent}% and ${after.cpuBusyPercent}% busy at the study edges, both within the ${QUIET_HOST_CPU_PERCENT}% quiet bound, so the ms columns are a quiet-host sample. Contacts and fingerprints are deterministic and independent of host load.`
        : `Host busy ${before.cpuBusyPercent}% before / ${after.cpuBusyPercent}% after with ${before.processes} / ${after.processes} processes, above the ${QUIET_HOST_CPU_PERCENT}% quiet bound; every ms column in this artifact is a loaded-host excerpt. Contacts, fingerprints, memory and module identities are load-independent.`;
};

export const resolveRun = (stdout, wasmPath, expected) => {
    const report = readBenchReport(stdout);
    if (report !== null) {
        const mismatched = report.rows.filter((row) => row.sizeBytes !== expected.bytes);
        if (mismatched.length > 0) {
            throw new Error(`${wasmPath}: bench report measured ${mismatched[0].sizeBytes} bytes but the module on disk is ${expected.bytes}; refuse to mix modules`);
        }
        return { source: BENCH_JSON_SOURCE, reportPath: report.reportPath, environment: report.environment, rows: report.rows };
    }
    return { source: CONSOLE_FALLBACK_SOURCE, reportPath: null, environment: null, rows: parseBenchOutput(stdout) };
};

const runBench = (wasmPath, expected) => {
    const result = spawnSync(process.execPath, [path.join(root, "bench", "run.mjs"), wasmPath], {
        encoding: "utf8"
    });
    if (result.status !== 0) {
        throw new Error(`bench failed for ${wasmPath}: ${result.stderr}`);
    }
    return resolveRun(result.stdout, wasmPath, expected);
};

const microsecondsPerContactOf = (ms, contacts) => contacts > 0 && Number.isFinite(ms)
    ? (ms * MICROSECONDS_PER_MILLISECOND) / contacts
    : null;
const spreadOf = (samples) => samples.length === 0 ? null : Math.max(...samples) - Math.min(...samples);
const extentOf = (values, reducer) => {
    const finite = values.filter((value) => Number.isFinite(value));
    return finite.length === 0 ? null : reducer(...finite);
};

export const summariseRuns = (preset, runs, counts) => {
    const sources = [...new Set(runs.map((run) => run.source))];
    if (sources.length > 1) {
        throw new Error(`${preset} mixed ${sources.join("/")} readings across its ${runs.length} invocations; refusing to average rounded and unrounded medians together`);
    }
    return counts.map((count) => {
        const samples = runs.map((run) => run.rows.find((row) => row.count === count)).filter(Boolean);
        if (samples.length !== runs.length) {
            throw new Error(`${preset} at ${count}: expected ${runs.length} readings, got ${samples.length}`);
        }
        const contactValues = [...new Set(samples.map((sample) => sample.contacts))];
        const fingerprints = [...new Set(samples.map((sample) => sample.fingerprint))];
        if (contactValues.length !== 1 || fingerprints.length !== 1) {
            throw new Error(`${preset} at ${count} is not deterministic: contacts ${contactValues} / fingerprints ${fingerprints}`);
        }
        const msValues = samples.map((sample) => sample.msPerStep);
        const memoryValues = samples.map((sample) => sample.memoryMb);
        const msPerStep = median(msValues);
        return {
            count,
            msPerStep,
            samples: msValues,
            spread: spreadOf(msValues),
            minMs: extentOf(samples.map((sample) => sample.minMs), Math.min),
            maxMs: extentOf(samples.map((sample) => sample.maxMs), Math.max),
            msSource: sources[0],
            contacts: contactValues[0],
            fingerprint: fingerprints[0],
            memoryMb: median(memoryValues),
            memorySamples: memoryValues,
            memorySource: sources[0],
            loadedBytesVerified: samples.every((sample) => Number.isFinite(sample.sizeBytes)),
            microsecondsPerContact: microsecondsPerContactOf(msPerStep, contactValues[0])
        };
    });
};

const collectVariant = (variant) => {
    const wasmPath = path.join(root, "build", variant.preset, "physics.wasm");
    if (!fs.existsSync(wasmPath)) {
        throw new Error(`${wasmPath} missing; run node scripts/build.mjs ${variant.preset} first`);
    }
    const measuredModule = moduleIdentity(variant.preset);
    if (measuredModule.sha256 === null) {
        throw new Error(`${wasmPath} could not be hashed`);
    }
    const runs = [];
    for (let index = 0; index < REPEATS; index += 1) {
        runs.push(runBench(wasmPath, measuredModule));
    }
    const afterRuns = moduleIdentity(variant.preset);
    if (!identityEquals(measuredModule, afterRuns)) {
        throw new Error(`${variant.preset} module changed mid-measurement: ${identityLabel(measuredModule)} vs ${identityLabel(afterRuns)}`);
    }
    return {
        preset: variant.preset,
        simd: variant.simd,
        fastMath: variant.fastMath,
        wasm: measuredModule.wasm,
        wasmBytes: measuredModule.bytes,
        wasmSha256: measuredModule.sha256,
        optWasm: measuredModule.optWasm,
        optWasmBytes: measuredModule.optBytes,
        optWasmSha256: measuredModule.optSha256,
        invocationSources: [...new Set(runs.map((run) => run.source))],
        benchReports: runs.map((run) => run.reportPath),
        cells: summariseRuns(variant.preset, runs, COUNTS)
    };
};

const runPass = (order) => {
    const columns = {};
    for (const variant of order) {
        columns[variant.preset] = collectVariant(variant);
        const row = columns[variant.preset].cells
            .map((cell) => `${cell.count}: ${cell.msPerStep.toFixed(3)}ms/spread ${cell.spread.toFixed(3)}/${cell.contacts}/${cell.memoryMb.toFixed(2)}MB`)
            .join(" | ");
        console.log(`  ${variant.preset.padEnd(LOG_LABEL_WIDTH)} [${columns[variant.preset].invocationSources.join("+")}] ${row}`);
    }
    return columns;
};

const perSizeComparison = (column, release) => {
    if (column.cells.length !== release.cells.length) {
        return [];
    }
    return column.cells.map((cell, index) => {
        const base = release.cells[index];
        return {
            count: cell.count,
            contactsEqual: cell.contacts === base.contacts,
            fingerprintEqual: cell.fingerprint === base.fingerprint
        };
    });
};

export const decorateMatchesRelease = (columns) => {
    const release = columns[RELEASE_PRESET];
    for (const preset of Object.keys(columns)) {
        const column = columns[preset];
        const perSize = perSizeComparison(column, release);
        const contactsEqual = perSize.length === column.cells.length && perSize.every((entry) => entry.contactsEqual);
        const fingerprintsEqual = perSize.length === column.cells.length && perSize.every((entry) => entry.fingerprintEqual);
        column.matchesRelease = {
            isRelease: preset === RELEASE_PRESET,
            contactsEqual,
            fingerprintsEqual,
            behaviourChanged: !contactsEqual,
            roundingChanged: !fingerprintsEqual,
            perSize
        };
    }
    return columns;
};

export const relativeSpread = (cell) => cell && Number.isFinite(cell.msPerStep) && cell.msPerStep > 0 && Number.isFinite(cell.spread)
    ? cell.spread / cell.msPerStep
    : null;

export const ratioMarginExceedsNoise = (baseCell, cell, gain) => {
    if (!Number.isFinite(gain)) {
        return null;
    }
    const baseRel = relativeSpread(baseCell);
    const cellRel = relativeSpread(cell);
    if (baseRel === null || cellRel === null) {
        return null;
    }
    return (gain - 1) > baseRel + cellRel;
};

export const populationMatchesBase = (variant, base) => {
    if (variant.cells.length !== base.cells.length) {
        return { matched: false, contactsEqual: false, fingerprintsEqual: false, countsAligned: false };
    }
    const countsAligned = variant.cells.every((cell, index) => cell.count === base.cells[index].count);
    const contactsEqual = variant.cells.every((cell, index) => cell.contacts === base.cells[index].contacts);
    const fingerprintsEqual = variant.cells.every((cell, index) => cell.fingerprint === base.cells[index].fingerprint);
    const match = variant.matchesRelease;
    const decorated = match !== null && match !== undefined
        && typeof match.contactsEqual === "boolean"
        && typeof match.fingerprintsEqual === "boolean";
    return {
        matched: countsAligned && contactsEqual && fingerprintsEqual && (!decorated || (match.contactsEqual && match.fingerprintsEqual)),
        contactsEqual: contactsEqual && (!decorated || match.contactsEqual),
        fingerprintsEqual: fingerprintsEqual && (!decorated || match.fingerprintsEqual),
        countsAligned
    };
};

export const decideAdoption = (study, crossCheck = null) => {
    const base = study.variants[RELEASE_PRESET];
    const candidates = Object.entries(study.variants)
        .filter(([preset]) => preset !== RELEASE_PRESET)
        .map(([preset, variant]) => {
            const population = populationMatchesBase(variant, base);
            const gains = variant.cells.map((cell, index) => base.cells[index].msPerStep / cell.msPerStep);
            const worst = Math.min(...gains);
            const gainsExceedSpread = variant.cells.map((cell, index) => ratioMarginExceedsNoise(base.cells[index], cell, gains[index]));
            return {
                preset,
                matched: population.matched,
                contactsEqual: population.contactsEqual,
                fingerprintsEqual: population.fingerprintsEqual,
                worstGain: worst,
                gains,
                gainsExceedSpread
            };
        });
    const qualified = candidates.filter((candidate) =>
        candidate.matched && candidate.worstGain >= ADOPTION_GAIN);
    const gateAdopt = qualified.length === 0
        ? null
        : qualified.reduce((best, candidate) => candidate.worstGain > best.worstGain ? candidate : best);
    const trustChecked = crossCheck !== null && crossCheck !== undefined;
    const trustworthy = trustChecked && crossCheck.trustworthy === true;
    const trustFailed = trustChecked && crossCheck.trustworthy === false;
    const trustUnusable = trustChecked && typeof crossCheck.trustworthy !== "boolean";
    const adopt = trustFailed || trustUnusable ? null : gateAdopt;
    const matchedClause = `matches ${RELEASE_PRESET} on contact counts AND fingerprints at every counted size`;
    const matchingClause = `matching ${RELEASE_PRESET} on contact counts AND fingerprints at every counted size`;
    const agreementClause = trustworthy
        ? ", and the two rotated passes agree within their own spreads including the release column every gain is divided by"
        : "";
    let reason;
    if (trustUnusable) {
        reason = "no usable cross-pass verdict was supplied, so adoption is not authorised without evidence that the two rotated passes agree";
    } else if (trustFailed) {
        reason = "the two rotated passes disagree beyond their own spreads, including the release column every gain is divided by, or disagree on the verdict, so this measurement is not trustworthy and no variant is adopted";
    } else if (adopt) {
        reason = `${adopt.preset} is at least ${ADOPTION_GAIN}x on every counted size and ${matchedClause}${agreementClause}`;
    } else {
        reason = `no variant reaches ${ADOPTION_GAIN}x on every counted size while ${matchingClause}`;
    }
    return {
        adopt: adopt ? adopt.preset : null,
        threshold: ADOPTION_GAIN,
        counts: study.counts ?? base.cells.map((cell) => cell.count),
        candidates,
        blockedByCrossCheck: adopt === null && gateAdopt !== null,
        crossCheckRan: trustChecked,
        crossCheckTrustworthy: trustChecked ? trustworthy : null,
        crossPassAgreementClaimed: trustChecked && !trustUnusable,
        reason
    };
};

const passColumnsToStudy = (columns, counts) => ({ counts, variants: columns });

export const buildCrossCheck = (study, decision, pass2Decision) => {
    const perVariant = VARIANTS.map((variant) => {
        const preset = variant.preset;
        const a = study.variants[preset];
        const b = study.pass2[preset];
        const baseA = study.variants[RELEASE_PRESET];
        const baseB = study.pass2[RELEASE_PRESET];
        const perSize = a.cells.map((cell, index) => {
            const gain1 = baseA.cells[index].msPerStep / cell.msPerStep;
            const gain2 = baseB.cells[index].msPerStep / b.cells[index].msPerStep;
            const medianDiff = Math.abs(cell.msPerStep - b.cells[index].msPerStep);
            const tolerance = cell.spread + b.cells[index].spread;
            return {
                count: cell.count,
                gainPass1: gain1,
                gainPass2: gain2,
                medianPass1: cell.msPerStep,
                medianPass2: b.cells[index].msPerStep,
                medianDiff,
                combinedSpreadTolerance: tolerance,
                mediansAgreeWithinSpread: medianDiff <= tolerance
            };
        });
        return { preset, isBaseColumn: preset === RELEASE_PRESET, perSize };
    });
    const mediansAgreeWithinSpread = perVariant.every((entry) => entry.perSize.every((size) => size.mediansAgreeWithinSpread));
    const baseColumn = perVariant.find((entry) => entry.isBaseColumn);
    const adoptAgrees = decision.adopt === pass2Decision.adopt;
    return {
        adoptAgrees,
        adoptAgreesOnNullOnly: adoptAgrees && decision.adopt === null && pass2Decision.adopt === null,
        mediansAgreeWithinSpread,
        baseColumnAgreesWithinSpread: baseColumn.perSize.every((size) => size.mediansAgreeWithinSpread),
        baseColumnWorstMedianDriftMsPerStep: Math.max(...baseColumn.perSize.map((size) => size.medianDiff)),
        baseColumnWorstToleranceMsPerStep: Math.max(...baseColumn.perSize.map((size) => size.combinedSpreadTolerance)),
        trustworthy: mediansAgreeWithinSpread && adoptAgrees,
        perVariant
    };
};

export const publishGuard = (measuredAgainstBase, columns) => {
    const currentBase = moduleIdentity(RELEASE_PRESET);
    if (currentBase.sha256 === null) {
        throw new Error(`refusing to publish: ${currentBase.wasm} is missing, so no column can be pinned to it`);
    }
    if (!identityEquals(measuredAgainstBase, currentBase)) {
        throw new Error(`refusing to publish: ${RELEASE_PRESET} on disk is ${identityLabel(currentBase)} but every column was compared to ${identityLabel(measuredAgainstBase)}`);
    }
    for (const preset of Object.keys(columns)) {
        const recorded = columns[preset];
        const current = moduleIdentity(preset);
        const recordedIdentity = {
            bytes: recorded.wasmBytes,
            sha256: recorded.wasmSha256,
            optBytes: recorded.optWasmBytes,
            optSha256: recorded.optWasmSha256
        };
        if (current.sha256 === null) {
            throw new Error(`refusing to publish: build/${preset}/physics.wasm is missing, so ${preset} cannot be re-pinned`);
        }
        if (!identityEquals(recordedIdentity, current)) {
            throw new Error(`refusing to publish: ${preset} on disk is ${identityLabel(current)} but its column measured ${identityLabel(recordedIdentity)}`);
        }
    }
    return currentBase;
};

const hostSnapshot = (load) => ({
    cpus: load.cpus,
    processes: load.processes,
    cpuBusyPercent: load.cpuBusyPercent,
    freeMemoryMb: load.freeMemoryMb,
    totalMemoryMb: load.totalMemoryMb,
    freemem: load.freemem,
    totalmem: load.totalmem,
    node: load.node,
    platform: load.platform,
    loadSource: load.loadSource
});

const collectStudy = () => {
    const hostBefore = hostLoad();
    console.log(`host cpus=${hostBefore.cpus} processes=${hostBefore.processes} cpuBusyPercent=${hostBefore.cpuBusyPercent} freemem=${hostBefore.freemem} totalmem=${hostBefore.totalmem} node=${hostBefore.node} ${hostBefore.platform} source=${hostBefore.loadSource}`);

    const measuredAgainstBase = moduleIdentity(RELEASE_PRESET);
    if (measuredAgainstBase.sha256 === null) {
        throw new Error(`${measuredAgainstBase.wasm} missing; run node scripts/build.mjs ${RELEASE_PRESET} first`);
    }
    console.log(`measured against base release module ${identityLabel(measuredAgainstBase)}`);

    const pass1Order = VARIANTS;
    const pass2Order = [...VARIANTS.slice(1), VARIANTS[0]];
    console.log(`pass 1 order: ${pass1Order.map((variant) => variant.preset).join(", ")}`);
    const variants = runPass(pass1Order);
    console.log(`pass 2 order (rotated): ${pass2Order.map((variant) => variant.preset).join(", ")}`);
    const pass2 = runPass(pass2Order);

    decorateMatchesRelease(variants);
    decorateMatchesRelease(pass2);
    publishGuard(measuredAgainstBase, variants);
    publishGuard(measuredAgainstBase, pass2);

    const hostAfter = hostLoad();
    const study = {
        generatedAt: new Date().toISOString(),
        host: hostSnapshot(hostBefore),
        hostAfter: hostSnapshot(hostAfter),
        hostQuiet: hostIsQuiet(hostBefore) && hostIsQuiet(hostAfter),
        hostLoadNote: loadedHostNote(hostBefore, hostAfter),
        measuredAgainstBase,
        repeats: REPEATS,
        counts: COUNTS,
        adoptionGain: ADOPTION_GAIN,
        pass1Order: pass1Order.map((variant) => variant.preset),
        pass2Order: pass2Order.map((variant) => variant.preset),
        variants,
        pass2,
        decision: null,
        pass2Decision: null,
        crossCheck: null
    };

    const pass1Study = passColumnsToStudy(variants, COUNTS);
    const pass2Study = passColumnsToStudy(pass2, COUNTS);
    study.crossCheck = buildCrossCheck(study, decideAdoption(pass1Study), decideAdoption(pass2Study));
    study.decision = decideAdoption(pass1Study, study.crossCheck);
    study.pass2Decision = decideAdoption(pass2Study, study.crossCheck);

    return study;
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath.endsWith(path.join("bench", "variants.mjs"))) {
    const study = collectStudy();

    for (const candidate of study.decision.candidates) {
        const gains = candidate.gains.map((gain, index) => `${COUNTS[index]}: ${gain.toFixed(3)}x`).join(", ");
        console.log(`gain vs release ${candidate.preset.padEnd(LOG_LABEL_WIDTH)} [${gains}] worst ${candidate.worstGain.toFixed(3)}x matched=${candidate.matched} contactsEqual=${candidate.contactsEqual} fingerprintsEqual=${candidate.fingerprintsEqual}`);
    }

    fs.mkdirSync(path.join(root, "bench", "results"), { recursive: true });
    const outPath = path.join(root, "bench", "results", "variant-study.json");
    fs.writeFileSync(outPath, `${JSON.stringify(study, null, 2)}\n`, "utf8");

    console.log(`adopt: ${study.decision.adopt ?? "none"} — ${study.decision.reason}`);
    console.log(`pass2 adopt: ${study.pass2Decision.adopt ?? "none"}`);
    console.log(`cross-check: adoptAgrees=${study.crossCheck.adoptAgrees} mediansAgreeWithinSpread=${study.crossCheck.mediansAgreeWithinSpread} baseColumnAgreesWithinSpread=${study.crossCheck.baseColumnAgreesWithinSpread} baseColumnWorstDrift=${study.crossCheck.baseColumnWorstMedianDriftMsPerStep.toFixed(4)}ms/tolerance ${study.crossCheck.baseColumnWorstToleranceMsPerStep.toFixed(4)}ms trustworthy=${study.crossCheck.trustworthy}`);
    console.log(outPath);
}
