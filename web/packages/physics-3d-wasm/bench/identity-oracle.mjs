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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const RELEASE_WASM = "build/wasm-release/physics.wasm";
export const TIMERS_WASM = "build/wasm-timers/physics.wasm";
export const FAST_WASM = "build/wasm-fast/physics.wasm";
export const DEFAULT_WINDOW = { warmupSteps: 40, measuredSteps: 120 };
export const OUTPUT_PATH = path.join(root, "bench", "results", "identity-oracle.json");
export const SCRATCH_DIR = path.join(root, ".tmp");
export const PIN_PATH = path.join(root, "bench", "results", "policy-10-4-fingerprints.json");
export const IDENTITY_PROTOCOL = "identity-protocol: 1 — base must reproduce the campaign pins, same-build "
    + "pairings refused, a contact-free window is never a verdict, worldMemoryBytes recorded but not verdict-bearing";

const KNOWN_FLAGS = new Set(["--base", "--candidate", "--counts", "--out"]);
const KNOWN_WINDOW_KEYS = new Set(["warmupSteps", "measuredSteps"]);
const BUILD_PREREQUISITES = [RELEASE_WASM, TIMERS_WASM, FAST_WASM];

export const scratchOutputPath = (baseSha, candidateSha) => path.join(SCRATCH_DIR,
    `identity-oracle-${baseSha.slice(0, 8)}-${candidateSha.slice(0, 8)}.json`);

export const SCENES = [
    { key: "box250", build: (exports) => addBoxPileScene(exports, 250) },
    { key: "box1000", build: (exports) => addBoxPileScene(exports, 1000) },
    { key: "box2000", build: (exports) => addBoxPileScene(exports, 2000) },
    { key: "box5000", build: (exports) => addBoxPileScene(exports, 5000) },
    { key: "standard256", build: (exports) => addStandardScene(exports) },
    { key: "hinge128", build: (exports) => addHingeChainScene(exports, 128) },
    { key: "sphere250", build: (exports) => addSpherePileScene(exports, 250) },
    { key: "capsule250", build: (exports) => addCapsulePileScene(exports, 250) }
];

export const isBoxKey = (key) => /^box\d+$/.test(key);
const boxCountOf = (key) => (isBoxKey(key) ? Number.parseInt(key.slice(3), 10) : null);

const usageError = (message) => new Error(`usage: ${message}`);

const presetLabel = (filePath) => path.basename(path.dirname(filePath));

const requireModule = (filePath, preset) => {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${filePath} is missing; run node scripts/build.mjs ${preset} first `
            + `(the oracle needs ${BUILD_PREREQUISITES.join(", ")})`);
    }
    return filePath;
};

const bytesOf = (filePath) => fs.readFileSync(filePath);

const identityOf = (filePath, bytes) => ({
    file: path.relative(root, filePath).split(path.sep).join("/"),
    bytes: bytes.byteLength,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex")
});

const fileIdentity = (filePath) => identityOf(filePath, bytesOf(filePath));

const optionalIdentity = (relativePath) => {
    const filePath = path.isAbsolute(relativePath) ? relativePath : path.resolve(root, relativePath);
    return fs.existsSync(filePath) ? fileIdentity(filePath) : { file: relativePath, missing: true };
};

const parseArguments = (args) => {
    const parsed = {};
    for (let index = 0; index < args.length; index += 1) {
        const token = args[index];
        if (!KNOWN_FLAGS.has(token)) {
            throw usageError(`unknown argument "${token}"; recognised flags are ${[...KNOWN_FLAGS].join(", ")}`);
        }
        const value = args[index + 1];
        if (value === undefined || KNOWN_FLAGS.has(value)) {
            throw usageError(`${token} requires a value`);
        }
        if (Object.hasOwn(parsed, token)) {
            throw usageError(`${token} was given twice ("${parsed[token]}" then "${value}"); the last value `
                + "would silently win over the first");
        }
        parsed[token] = value;
        index += 1;
    }
    return parsed;
};

const resolveWindow = (window) => {
    if (window !== undefined) {
        if (window === null || typeof window !== "object" || Array.isArray(window)) {
            throw new Error(`window must be an object of { warmupSteps, measuredSteps }, received ${String(window)}`);
        }
        const unknown = Object.keys(window).filter((key) => !KNOWN_WINDOW_KEYS.has(key));
        if (unknown.length > 0) {
            throw new Error(`window carries unknown keys ${JSON.stringify(unknown)}; a misspelled window key `
                + "would silently run the default window while the artifact recorded the caller's keys");
        }
    }
    const activeWindow = { ...DEFAULT_WINDOW, ...window };
    for (const key of [...KNOWN_WINDOW_KEYS]) {
        const value = activeWindow[key];
        if (!Number.isInteger(value) || value < 0) {
            throw new Error(`window.${key} must be a non-negative integer, received ${String(value)}`);
        }
    }
    if (activeWindow.warmupSteps + activeWindow.measuredSteps <= 0) {
        throw new Error("window must contain at least one step; a zero-step window cannot produce a verdict");
    }
    return activeWindow;
};

const selectScenes = (scenes, counts) => {
    const wanted = Array.isArray(counts) && counts.length > 0 ? counts : null;
    if (wanted === null) {
        return scenes;
    }
    const unmatched = wanted.filter((count) => !scenes.some((scene) => scene.key === `box${count}`));
    if (unmatched.length > 0) {
        throw new Error(`counts ${JSON.stringify(unmatched)} match no box scene in `
            + `${JSON.stringify(scenes.map((scene) => scene.key))}; refusing to drop a requested count `
            + "silently and report a verdict for scenes nobody asked for");
    }
    return scenes.filter((scene) => !isBoxKey(scene.key)
        || wanted.some((count) => scene.key === `box${count}`));
};

const digest = (exports, fingerprintOverride) => {
    const fingerprint = fingerprintOverride === undefined
        ? fingerprintHex(exports)
        : fingerprintOverride(exports);
    if (typeof fingerprint !== "string" || !/^[0-9a-f]{16}$/.test(fingerprint)) {
        throw new Error(`worldFingerprint produced ${String(fingerprint)}, which is not a 16-hex digest; `
            + "refusing to compare a value that could match another broken read");
    }
    if (/^0{16}$/.test(fingerprint)) {
        throw new Error("worldFingerprint produced the all-zero digest, which is what a world that was never "
            + "initialised returns; refusing to read two dead worlds as bit-identical");
    }
    return { fingerprint, contacts: exports.contactCount() };
};

const requireLiveWorld = (exports, role, key) => {
    const bodies = Number(exports.bodyCount());
    if (!Number.isInteger(bodies) || bodies <= 0) {
        throw new Error(`${role} module reports ${exports.bodyCount()} bodies after building scene ${key}; a `
            + "scene builder that initialises nothing must not be able to produce a green verdict");
    }
    return bodies;
};

const driveScene = async (scene, basePath, candidatePath, window, candidateIterations, fingerprintOverride) => {
    const base = await loadWasm(basePath);
    const candidate = await loadWasm(candidatePath);
    scene.build(base.exports);
    scene.build(candidate.exports);
    requireLiveWorld(base.exports, "base", scene.key);
    requireLiveWorld(candidate.exports, "candidate", scene.key);

    const steps = window.warmupSteps + window.measuredSteps;
    let firstDivergentStep = null;
    let baseFirstContactStep = null;
    let differingSteps = 0;
    let lastBase = null;
    let lastCandidate = null;

    for (let step = 1; step <= steps; step += 1) {
        base.exports.step(STANDARD_DT, policy.velocityIterations, policy.positionIterations);
        candidate.exports.step(
            STANDARD_DT,
            candidateIterations?.velocity ?? policy.velocityIterations,
            candidateIterations?.position ?? policy.positionIterations
        );
        lastBase = digest(base.exports, fingerprintOverride);
        lastCandidate = digest(candidate.exports, fingerprintOverride);
        if (baseFirstContactStep === null && lastBase.contacts > 0) {
            baseFirstContactStep = step;
        }
        const same = lastBase.fingerprint === lastCandidate.fingerprint
            && lastBase.contacts === lastCandidate.contacts;
        if (!same) {
            differingSteps += 1;
            if (firstDivergentStep === null) {
                firstDivergentStep = step;
            }
        }
    }

    return {
        key: scene.key,
        steps,
        differingSteps,
        firstDivergentStep,
        baseFirstContactStep,
        contactBearingInWindow: baseFirstContactStep !== null,
        divergedBeforeBaseContacts: baseFirstContactStep === null || firstDivergentStep === null
            ? null
            : firstDivergentStep < baseFirstContactStep,
        baseFingerprint: lastBase.fingerprint,
        candidateFingerprint: lastCandidate.fingerprint,
        baseContacts: lastBase.contacts,
        candidateContacts: lastCandidate.contacts,
        baseMemoryBytes: Number(base.exports.worldMemoryBytes()),
        candidateMemoryBytes: Number(candidate.exports.worldMemoryBytes())
    };
};

const readPins = () => {
    if (!fs.existsSync(PIN_PATH)) {
        throw new Error(`${PIN_PATH} is missing; the oracle refuses to certify a preserving verdict without `
            + "the campaign pin file");
    }
    const recorded = JSON.parse(fs.readFileSync(PIN_PATH, "utf8"));
    const pins = (Array.isArray(recorded.cells) ? recorded.cells : [])
        .map((cell) => ({ count: cell.count, fingerprint: cell.fingerprint, contacts: cell.contacts }))
        .filter((pin) => Number.isInteger(pin.count) && typeof pin.fingerprint === "string");
    if (pins.length === 0) {
        throw new Error(`${PIN_PATH} carries no usable cells; the oracle cannot pin a baseline against it`);
    }
    return { file: path.relative(root, PIN_PATH).split(path.sep).join("/"), variant: recorded.variant, pins };
};

const measureBasePin = async (basePath, count) => {
    const instance = await loadWasm(basePath);
    addBoxPileScene(instance.exports, count);
    requireLiveWorld(instance.exports, "base", `box${count}`);
    const steps = DEFAULT_WINDOW.warmupSteps + DEFAULT_WINDOW.measuredSteps;
    for (let step = 1; step <= steps; step += 1) {
        instance.exports.step(STANDARD_DT, policy.velocityIterations, policy.positionIterations);
    }
    return digest(instance.exports);
};

const pinCache = new Map();

const verifyBaseAgainstPins = async (basePath, baseSha, observed) => {
    if (pinCache.has(baseSha)) {
        return pinCache.get(baseSha);
    }
    const { file, variant, pins } = readPins();
    const rows = [];
    for (const pin of pins) {
        const measured = observed.get(pin.count) ?? await measureBasePin(basePath, pin.count);
        rows.push({
            count: pin.count,
            expectedFingerprint: pin.fingerprint,
            observedFingerprint: measured.fingerprint,
            expectedContacts: pin.contacts,
            observedContacts: measured.contacts
        });
        if (measured.fingerprint !== pin.fingerprint || measured.contacts !== pin.contacts) {
            throw new Error(`the base module ${baseSha.slice(0, 16)} does not reproduce the campaign pin for box `
                + `${pin.count} recorded in ${file} (variant ${variant}): expected `
                + `${pin.fingerprint}/${pin.contacts}, observed ${measured.fingerprint}/${measured.contacts}. `
                + "A preserving verdict needs a base that is the frozen pre-lever build; pass the pre-lever "
                + "artifact as --base");
        }
    }
    const attestation = { pinFile: file, pinVariant: variant, baseSha256: baseSha, cells: rows };
    pinCache.set(baseSha, attestation);
    return attestation;
};

export const compareModules = async ({ basePath, candidatePath, counts, window, candidateIterations,
    scenes = SCENES, fingerprintOverride }) => {
    requireModule(basePath, presetLabel(basePath));
    requireModule(candidatePath, presetLabel(candidatePath));
    if (fs.realpathSync(basePath) === fs.realpathSync(candidatePath)) {
        throw new Error(`${basePath} and ${candidatePath} resolve to the same file; the two sides of an `
            + "identity verdict must come from different builds");
    }
    if (presetLabel(basePath) === presetLabel(candidatePath)) {
        throw new Error(`${basePath} and ${candidatePath} are both from the "${presetLabel(basePath)}" `
            + "build; two files of one build compare equal whatever the lever did, so the two sides must "
            + "come from different builds");
    }
    const baseIdentity = fileIdentity(basePath);
    const candidateIdentity = fileIdentity(candidatePath);
    if (baseIdentity.sha256 === candidateIdentity.sha256) {
        throw new Error(`${baseIdentity.file} and ${candidateIdentity.file} are the same bytes `
            + `(${baseIdentity.sha256}); base and candidate must be different builds, and a lever's identity `
            + "verdict needs the frozen pre-lever build as --base");
    }

    const activeWindow = resolveWindow(window);
    const selected = selectScenes(scenes, counts);
    if (selected.length === 0) {
        throw new Error(`no scene survived the selection ${JSON.stringify(counts)}; refusing to publish an `
            + "empty oracle verdict");
    }

    const results = [];
    for (const scene of selected) {
        results.push(await driveScene(scene, basePath, candidatePath, activeWindow, candidateIterations,
            fingerprintOverride));
    }

    const contactBearing = results.filter((scene) => scene.contactBearingInWindow);
    if (contactBearing.length === 0) {
        throw new Error(`no selected scene made contact inside the ${activeWindow.warmupSteps}+`
            + `${activeWindow.measuredSteps}-step window, so the solver read nothing a layout change could `
            + "alter; refusing to certify a preserving verdict over a contact-free window");
    }

    const differingSteps = results.reduce((total, scene) => total + scene.differingSteps, 0);
    const totalSteps = results.reduce((total, scene) => total + scene.steps, 0);

    const observed = new Map();
    if (fingerprintOverride === undefined
        && activeWindow.warmupSteps === DEFAULT_WINDOW.warmupSteps
        && activeWindow.measuredSteps === DEFAULT_WINDOW.measuredSteps) {
        for (const scene of results) {
            const count = boxCountOf(scene.key);
            if (count !== null) {
                observed.set(count, { fingerprint: scene.baseFingerprint, contacts: scene.baseContacts });
            }
        }
    }
    const pinAttestation = await verifyBaseAgainstPins(basePath, baseIdentity.sha256, observed);

    return {
        protocol: IDENTITY_PROTOCOL,
        preserving: differingSteps === 0,
        differingSteps,
        totalSteps,
        scenes: results,
        contactBearingScenes: contactBearing.map((scene) => scene.key),
        identity: { base: baseIdentity, candidate: candidateIdentity },
        prerequisites: BUILD_PREREQUISITES.map(optionalIdentity),
        prerequisitesComplete: BUILD_PREREQUISITES
            .every((relative) => fs.existsSync(path.resolve(root, relative))),
        pinAttestation,
        iterationPolicy: { ...policy },
        window: activeWindow
    };
};

const printVerdict = (verdict, outputPath) => {
    for (const scene of verdict.scenes) {
        console.log(`${scene.key.padEnd(14)} steps=${String(scene.steps).padStart(4)} `
            + `differing=${String(scene.differingSteps).padStart(4)} `
            + `baseFirstContact=${String(scene.baseFirstContactStep).padStart(4)} `
            + `base=${scene.baseFingerprint}/${scene.baseContacts} `
            + `candidate=${scene.candidateFingerprint}/${scene.candidateContacts} `
            + `bytes ${scene.baseMemoryBytes} -> ${scene.candidateMemoryBytes}`);
    }
    console.log(`preserving=${verdict.preserving} differingSteps=${verdict.differingSteps}/${verdict.totalSteps}`);
    console.log(`pinAttestation=${verdict.pinAttestation.pinFile} variant=${verdict.pinAttestation.pinVariant} `
        + `cells=${verdict.pinAttestation.cells.length} base=${verdict.pinAttestation.baseSha256.slice(0, 16)}`);
    console.log(`artifact=${path.relative(root, outputPath).split(path.sep).join("/")}`);
};

const writeVerdict = (verdict, outputPath) => {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), ...verdict }, null, 2)}\n`);
};

const requirePrerequisiteBuilds = () => {
    const missing = BUILD_PREREQUISITES.filter((relative) => !fs.existsSync(path.resolve(root, relative)));
    if (missing.length > 0) {
        throw new Error(`the oracle's documented prerequisite builds are missing: ${missing.join(", ")}; `
            + "run node scripts/build.mjs <preset> for each before recording a baseline verdict");
    }
};

const resolveOutPath = (value) => {
    const resolved = path.resolve(root, value);
    if (resolved === OUTPUT_PATH) {
        throw usageError(`--out must not point at the tracked baseline `
            + `${path.relative(root, OUTPUT_PATH).split(path.sep).join("/")}; only a flagless default run `
            + "may rewrite it");
    }
    return resolved;
};

const main = async () => {
    const args = process.argv.slice(2);
    const parsed = parseArguments(args);
    const defaultRun = args.length === 0;
    if (defaultRun) {
        requirePrerequisiteBuilds();
    }
    const base = requireModule(path.resolve(root, parsed["--base"] ?? RELEASE_WASM),
        presetLabel(path.resolve(root, parsed["--base"] ?? RELEASE_WASM)));
    const candidate = requireModule(path.resolve(root, parsed["--candidate"] ?? TIMERS_WASM),
        presetLabel(path.resolve(root, parsed["--candidate"] ?? TIMERS_WASM)));
    const counts = parsed["--counts"] === undefined
        ? undefined
        : parsed["--counts"].split(",").map((entry) => Number.parseInt(entry, 10));
    const outOverride = parsed["--out"] === undefined ? null : resolveOutPath(parsed["--out"]);

    const verdict = await compareModules({ basePath: base, candidatePath: candidate, counts });
    const outputPath = defaultRun
        ? OUTPUT_PATH
        : outOverride ?? scratchOutputPath(verdict.identity.base.sha256, verdict.identity.candidate.sha256);
    writeVerdict(verdict, outputPath);
    printVerdict(verdict, outputPath);
    if (!verdict.preserving) {
        process.exitCode = 1;
    }
};

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath.endsWith(path.join("bench", "identity-oracle.mjs"))) {
    try {
        await main();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = error instanceof Error && error.message.startsWith("usage:") ? 2 : 1;
    }
}
