import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { PHYSICS_ITERATION_POLICY } from "../scripts/policy.mjs";
import { addBoxPileScene, fingerprintHex, loadWasm, STANDARD_DT } from "../scripts/scene.mjs";
import { measurePhases } from "./phases.mjs";
import { median } from "./lib/median.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timersWasmPath = path.join(root, "build", "wasm-timers", "physics.opt.wasm");
const releaseWasmPath = path.join(root, "build", "wasm-release", "physics.opt.wasm");
const defaultOutPath = path.join(root, "bench", "results", "phase-split-timers.json");

export const PHASE_KEYS = [
    "integrate",
    "broadphase",
    "collide",
    "prepare",
    "assembleConstraints",
    "solveVelocities",
    "solvePositions",
    "sleepAndCacheSwap",
    "pack",
    "sweepSort",
    "pairLoop"
];

export const NESTED_PHASE_KEYS = ["sweepSort", "pairLoop"];

export const DISJOINT_PHASE_KEYS = PHASE_KEYS.filter((key) => !NESTED_PHASE_KEYS.includes(key));

export const TIMER_RECORD_VERSION = 1;
export const TIMER_HEADER_WORDS = 2;
export const TIMER_FIELD_BYTES = 8;
export const TIMER_HEADER_BYTES = TIMER_HEADER_WORDS * 4;
export const TIMER_RECORD_BYTES = TIMER_HEADER_BYTES + PHASE_KEYS.length * TIMER_FIELD_BYTES;

export const SORT_GATING_FRACTION = 1 / 3;

export const CLOCK_TILING_EPSILON_MS = 1e-3;

export const SWEPT_SLIVER_ALLOWANCE_MS = 5e-3;

export const NESTED_BUCKET_NOTE = "sweepSort and pairLoop are sub-buckets of the swept scope, not step sections: sweepSort wraps buildSweep and pairLoop wraps the pair enumeration loop, inside which the collide marker already sits. They tile the raw swept value, so they are read beside broadphase and collide and are deliberately excluded from timerSumMsPerStep and sharesOfTimerSum, which stay the sum of the mutually disjoint step sections; a share of the timer sum for either sub-bucket would double count.";

export const SUM_TOLERANCE = 0.03;
export const CLOCK_RESOLUTION_CALLS_PER_THRESHOLD = 2;
export const CLOCK_RESOLUTION_BORDERLINE_BAND = 0.25;
export const SECTION_PROBES_PER_STEP = 22;
export const PROBES_PER_BROADPHASE_PAIR = 2;
export const SOLVER_BUCKET_PROBES_PER_STEP = 4;
export const DEFAULT_WINDOW = { warmupSteps: 40, measuredSteps: 120, repeats: 3 };

const add = (left, right) => left === null || right === null ? null : left + right;
const difference = (left, right) => left === null || right === null ? null : left - right;
const multiply = (left, right) => left === null || right === null ? null : left * right;
const ratio = (numerator, denominator) => numerator === null || denominator === null ? null : numerator / denominator;
const greater = (left, right) => left === null || right === null ? null : left > right;
const atLeast = (value, bound) => value === null || bound === null ? null : value >= bound;
const minimum = (left, right) => left === null || right === null ? null : Math.min(left, right);
const nonNegative = (value) => value === null ? null : Math.max(0, value);
const absolute = (value) => value === null ? null : Math.abs(value);
const scalePercent = (value) => value === null ? null : value * 100;
const formatNumber = (value, digits) => value === null ? "—" : value.toFixed(digits);

function requireFile(filePath, preset) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`${filePath} is missing; run node scripts/build.mjs ${preset} first`);
    }
    return filePath;
}

function toPosixRelative(fromRoot, target) {
    return path.relative(fromRoot, target).split(path.sep).join("/");
}

function readTimers(exports) {
    const packed = BigInt(exports.phaseTimersView());
    const pointer = Number(packed >> 32n);
    const bytes = Number(packed & 0xffffffffn);
    if (pointer === 0 || bytes < TIMER_HEADER_BYTES) {
        throw new Error(`phaseTimersView published pointer ${pointer} over ${bytes} bytes; the record header needs ${TIMER_HEADER_BYTES}`);
    }
    const view = new DataView(exports.memory.buffer, pointer, bytes);
    const recordVersion = view.getUint32(0, true);
    const recordBytes = view.getUint32(TIMER_HEADER_BYTES - 4, true);
    if (recordVersion !== TIMER_RECORD_VERSION) {
        throw new Error(`the module's timer record reports version ${recordVersion}; the reader speaks version ${TIMER_RECORD_VERSION}`);
    }
    if (recordBytes !== TIMER_RECORD_BYTES) {
        throw new Error(`the module's timer record reports ${recordBytes} bytes for ${PHASE_KEYS.length} fields; the reader lays the same keys out as ${TIMER_RECORD_BYTES}`);
    }
    if (bytes < recordBytes) {
        throw new Error(`phaseTimersView published ${bytes} bytes while the record itself claims ${recordBytes}`);
    }
    const record = { recordVersion, recordBytes };
    PHASE_KEYS.forEach((key, index) => {
        record[key] = view.getFloat64(TIMER_HEADER_BYTES + index * TIMER_FIELD_BYTES, true) * 1000;
    });
    return record;
}

function readNesting(exports) {
    if (typeof exports.phaseTimerSweptNanoseconds !== "function") {
        throw new Error("the instrumented module must export the raw nested phase timers");
    }
    const swept = Number(BigInt(exports.phaseTimerSweptNanoseconds())) / 1e6;
    const collide = Number(BigInt(exports.phaseTimerCollideNanoseconds())) / 1e6;
    const clampFired = exports.phaseTimerClampFired() !== 0;
    if (clampFired) {
        throw new Error(`marker inversion: swept ${swept} ms is below collide ${collide} ms`);
    }
    return { sweptMs: swept, collideMs: collide, clampFired };
}

function readPairCount(exports) {
    const packed = BigInt(exports.stepStatisticsView());
    const pointer = Number(packed >> 32n);
    const bytes = Number(packed & 0xffffffffn);
    const view = new DataView(exports.memory.buffer, pointer, bytes);
    return view.getFloat32(0, true);
}

function runWindow(exports, count, velocityIterations, positionIterations, warmupSteps, measuredSteps) {
    addBoxPileScene(exports, count);
    for (let index = 0; index < warmupSteps; index += 1) {
        exports.step(STANDARD_DT, velocityIterations, positionIterations);
    }

    const totals = Object.fromEntries(PHASE_KEYS.map((key) => [key, 0]));
    let stepNanos = 0;
    let contacts = 0;
    let clampFiredSteps = 0;
    for (let index = 0; index < measuredSteps; index += 1) {
        const startedAt = process.hrtime.bigint();
        contacts = exports.step(STANDARD_DT, velocityIterations, positionIterations);
        stepNanos += Number(process.hrtime.bigint() - startedAt);
        if (typeof exports.phaseTimersView === "function") {
            const timers = readTimers(exports);
            for (const key of PHASE_KEYS) {
                totals[key] += timers[key];
            }
            if (exports.phaseTimerClampFired() !== 0) {
                clampFiredSteps += 1;
            }
        }
    }

    if (contacts < 0) {
        throw new Error(`step returned ${contacts}`);
    }

    return {
        msPerStep: stepNanos / 1e6 / measuredSteps,
        phases: Object.fromEntries(PHASE_KEYS.map((key) => [key, totals[key] / measuredSteps])),
        contacts,
        fingerprint: fingerprintHex(exports),
        broadphasePairsPerStep: readPairCount(exports),
        clampFiredSteps
    };
}

function hostClockProbeCost(rounds = 200000) {
    let sink = 0;
    const startedAt = process.hrtime.bigint();
    for (let index = 0; index < rounds; index += 1) {
        sink += Number(process.hrtime.bigint()) / 1e9;
    }
    return { nanosecondsPerCall: Number(process.hrtime.bigint() - startedAt) / rounds, sink };
}

function deriveProbeCorrection(input) {
    const probesPerStep = SECTION_PROBES_PER_STEP + PROBES_PER_BROADPHASE_PAIR * input.broadphasePairsPerStep;
    const measuredInflationMsPerStep = difference(input.hostMsPerStepInstrumented, input.hostMsPerStepRelease);
    const interleavedInflationMsPerStep = input.interleavedInstrumentedMsPerStep - input.interleavedReleaseMsPerStep;
    const jsLoopModelMsPerStep = probesPerStep * input.hostClockNanosecondsPerCall / 1e6;
    const perProbeUpperBoundNanoseconds = ratio(multiply(measuredInflationMsPerStep, 1e6), probesPerStep);
    const collideMs = input.phasesMsPerStep.collide;
    const rawUnclampedLowerCollideMs = nonNegative(difference(collideMs, measuredInflationMsPerStep));
    const lowerCollideMs = minimum(rawUnclampedLowerCollideMs, collideMs);
    const collideLowerClampFired = greater(rawUnclampedLowerCollideMs, collideMs);
    const lowerClampNote = "the lower bound is clamped to the upper bound whenever the unclamped value would exceed it, which happens when measuredInflationMsPerStep is negative; when lowerClampFired is true the lower bound carries no information and rawUnclampedLowerShareOfTimerSum is what the arithmetic produced before the clamp";
    const solverProbeMsPerStep = ratio(multiply(measuredInflationMsPerStep, SOLVER_BUCKET_PROBES_PER_STEP), probesPerStep);

    return {
        clockProbe: {
            hostClockNanosecondsPerCall: input.hostClockNanosecondsPerCall,
            hostClockMeasurement: "a JS loop reading process.hrtime.bigint(); it never crossed the wasm boundary",
            estimatedProbesPerStep: probesPerStep,
            sectionProbesPerStep: SECTION_PROBES_PER_STEP,
            probesPerBroadphasePair: PROBES_PER_BROADPHASE_PAIR,
            jsLoopModelProbeMsPerStep: jsLoopModelMsPerStep,
            jsLoopModelStatus: "withdrawn as an estimate; kept only as the comparison value the ratio below is taken against",
            measuredInflationMsPerStep,
            interleavedInflationMsPerStep,
            interleavedInflationNote: "one instrumented window run back to back with one release window; a single pair is dominated by host drift and can come out negative, so it is recorded to show the spread and never quoted as the overhead",
            perProbeUpperBoundNanosecondsFromMeasuredGap: perProbeUpperBoundNanoseconds,
            measuredInflationOverJsLoopModelRatio: ratio(measuredInflationMsPerStep, jsLoopModelMsPerStep),
            measuredInflationExceedsJsLoopModel: greater(measuredInflationMsPerStep, jsLoopModelMsPerStep),
            jsLoopModelOverMeasuredGap: measuredInflationMsPerStep === null || measuredInflationMsPerStep === 0
                ? null
                : jsLoopModelMsPerStep / measuredInflationMsPerStep
        },
        collideShareInterval: {
            lowerShareOfTimerSum: ratio(lowerCollideMs, input.timerSumMsPerStep),
            upperShareOfTimerSum: ratio(collideMs, input.timerSumMsPerStep),
            lowerClampFired: collideLowerClampFired,
            rawUnclampedLowerShareOfTimerSum: ratio(rawUnclampedLowerCollideMs, input.timerSumMsPerStep),
            lowerBoundMeasuredInflationMsPerStep: measuredInflationMsPerStep,
            lowerClampNote,
            unit: "share of the timer sum",
            basis: "upper bound is the raw reported bucket, which contains its own clock probes; lower bound subtracts the whole measured instrumented-minus-release gap from collide, which charges every probe in every bucket to collide alone"
        },
        collisionShareInterval: {
            lowerShareOfTimerSum: ratio(add(input.phasesMsPerStep.broadphase, lowerCollideMs), input.timerSumMsPerStep),
            upperShareOfTimerSum: ratio(add(input.phasesMsPerStep.broadphase, collideMs), input.timerSumMsPerStep),
            lowerClampFired: collideLowerClampFired,
            rawUnclampedLowerShareOfTimerSum: ratio(add(input.phasesMsPerStep.broadphase, rawUnclampedLowerCollideMs), input.timerSumMsPerStep),
            lowerBoundMeasuredInflationMsPerStep: measuredInflationMsPerStep,
            lowerClampNote,
            unit: "share of the timer sum",
            basis: "the same interval widened to broadphase plus collide; the sweep bucket carries two probes per step and no pair scaling"
        },
        collideClockOverheadUpperBoundOfBucket: ratio(measuredInflationMsPerStep, collideMs),
        solverProbeOverhead: {
            probesPerStep: SOLVER_BUCKET_PROBES_PER_STEP,
            upperBoundMsPerStep: solverProbeMsPerStep,
            upperBoundShareOfTimerSum: ratio(solverProbeMsPerStep, input.timerSumMsPerStep),
            note: "the two solve buckets carry four probes per step, so their own clock cost is bounded by this; the velocity to position ratio is invariant under any remaining denominator shift"
        },
        denominatorShiftIfEntireInflationRemoved: ratio(measuredInflationMsPerStep, input.timerSumMsPerStep),
        probeCorrectionPolicy: "raw shares are the published measurement; the only correction is the collide interval above, derived from the measured A/B gap, never from the JS-loop clock model; no corrected split is presented as measured"
    };
}

function sliverBandMs(sweptScopeMs) {
    return sweptScopeMs === null ? null : Math.max(SWEPT_SLIVER_ALLOWANCE_MS, 0.15 * sweptScopeMs);
}

function deriveSweepSubSplit(phasesMsPerStep, timerSumMsPerStep) {
    const sweepSortMs = phasesMsPerStep.sweepSort;
    const pairLoopMs = phasesMsPerStep.pairLoop;
    const collideMs = phasesMsPerStep.collide;
    const broadphaseMs = phasesMsPerStep.broadphase;
    const sweptScopeMs = add(sweepSortMs, pairLoopMs);
    const pairLoopNetOfCollideMs = difference(pairLoopMs, collideMs);
    const reconstructedBroadphaseBucketMs = add(sweepSortMs, pairLoopNetOfCollideMs);
    const bucketReconstructionResidualMs = difference(broadphaseMs, reconstructedBroadphaseBucketMs);
    const sortShareOfBroadphaseBucket = ratio(sweepSortMs, broadphaseMs);
    return {
        sweepSortMsPerStep: sweepSortMs,
        pairLoopMsPerStep: pairLoopMs,
        collideNestedInPairLoopMsPerStep: collideMs,
        pairLoopNetOfCollideMsPerStep: pairLoopNetOfCollideMs,
        sweptScopeMsPerStep: sweptScopeMs,
        publishedBroadphaseBucketMsPerStep: broadphaseMs,
        reconstructedBroadphaseBucketMsPerStep: reconstructedBroadphaseBucketMs,
        bucketReconstructionResidualMsPerStep: bucketReconstructionResidualMs,
        bucketReconstructionResidualOverSweptScope: ratio(bucketReconstructionResidualMs, sweptScopeMs),
        sweptSliverAllowanceMs: SWEPT_SLIVER_ALLOWANCE_MS,
        bucketReconstructionBandMs: sliverBandMs(sweptScopeMs),
        bucketReconstructionWithinBand: sweptScopeMs === null
            ? null
            : absolute(bucketReconstructionResidualMs) <= sliverBandMs(sweptScopeMs),
        sortShareOfBroadphaseBucket,
        sortShareOfSweptScope: ratio(sweepSortMs, sweptScopeMs),
        pairLoopNetShareOfBroadphaseBucket: ratio(pairLoopNetOfCollideMs, broadphaseMs),
        broadphaseBucketShareOfTimerSum: ratio(broadphaseMs, timerSumMsPerStep),
        sortShareOfTimerSum: ratio(sweepSortMs, timerSumMsPerStep),
        gatingFraction: SORT_GATING_FRACTION,
        sortMeetsGatingFraction: atLeast(sortShareOfBroadphaseBucket, SORT_GATING_FRACTION),
        basis: "sweepSortMsPerStep is buildSweep: the highWater scan that fills sweepOrder plus the shell sort that orders it. pairLoopMsPerStep is the whole pair enumeration loop, inside which the collide marker already sits, so collideNestedInPairLoopMsPerStep must be subtracted before either sub-bucket is compared with the published broadphase bucket. sortShareOfBroadphaseBucket is the gate Task 8's Step 2 reads, and it is computed from one run of one instrumented module."
    };
}

function classifyClockResolution(phasesMsPerStep, hostClockNanosecondsPerCall) {
    const thresholdMsPerStep = CLOCK_RESOLUTION_CALLS_PER_THRESHOLD * hostClockNanosecondsPerCall / 1e6;
    if (!Number.isFinite(thresholdMsPerStep) || thresholdMsPerStep <= 0) {
        throw new Error(`the clock resolution threshold must be a positive finite number of ms/step, received ${thresholdMsPerStep}`);
    }
    for (const key of PHASE_KEYS) {
        if (phasesMsPerStep[key] === null) {
            throw new Error(`cannot classify the clock resolution of ${key}: the bucket has no finite samples in this run, and a missing reading coerced against the threshold would fabricate a sub-clock classification`);
        }
    }
    const relativeDistanceToThreshold = (key) => Math.abs(phasesMsPerStep[key] - thresholdMsPerStep) / thresholdMsPerStep;

    return {
        clockResolutionThreshold: {
            thresholdMsPerStep,
            thresholdNanosecondsPerCall: hostClockNanosecondsPerCall,
            clockCallsPerThreshold: CLOCK_RESOLUTION_CALLS_PER_THRESHOLD,
            derivedFrom: "this run's own measured host clock cost: clockProbe.hostClockNanosecondsPerCall multiplied by clockCallsPerThreshold, both published beside it, so the classification is recomputable from the artifact alone and moves with the host",
            borderlineRelativeBand: CLOCK_RESOLUTION_BORDERLINE_BAND,
            borderlineRule: `a bucket whose ms/step is within ${CLOCK_RESOLUTION_BORDERLINE_BAND} of the published threshold, i.e. |bucket - threshold| / threshold no greater than the band, is published in borderlineClockResolutionPhases; its class is a reading of host clock speed rather than a property of the bucket, so no consumer may assert which side a borderline bucket lands on`
        },
        subClockResolutionPhases: PHASE_KEYS.filter((key) => phasesMsPerStep[key] <= thresholdMsPerStep),
        aboveClockResolutionPhases: PHASE_KEYS.filter((key) => phasesMsPerStep[key] > thresholdMsPerStep),
        borderlineClockResolutionPhases: PHASE_KEYS.filter((key) => relativeDistanceToThreshold(key) <= CLOCK_RESOLUTION_BORDERLINE_BAND)
    };
}

export async function measurePhaseSplit(options) {
    const count = options.count;
    const warmupSteps = options.warmupSteps ?? DEFAULT_WINDOW.warmupSteps;
    const measuredSteps = options.measuredSteps ?? DEFAULT_WINDOW.measuredSteps;
    const repeats = options.repeats ?? DEFAULT_WINDOW.repeats;
    const timersPath = requireFile(options.timersPath ?? timersWasmPath, "wasm-timers");
    const releasePath = requireFile(options.releasePath ?? releaseWasmPath, "wasm-release");
    const hostClock = options.hostClockNanosecondsPerCall ?? hostClockProbeCost().nanosecondsPerCall;

    if (!Number.isInteger(count) || count <= 0) {
        throw new Error(`count must be a positive integer, received ${count}`);
    }
    if (!Number.isInteger(repeats) || repeats < 1) {
        throw new Error(`repeats must be a positive integer, received ${repeats}`);
    }

    const instrumented = await loadWasm(timersPath);
    const production = await loadWasm(releasePath);
    const policy = PHYSICS_ITERATION_POLICY;
    const window = { warmupSteps, measuredSteps, repeats };
    const run = (handle, warmup, measured, velocity, position) => runWindow(
        handle.exports, count, velocity, position, warmup, measured
    );

    for (let burnIn = 0; burnIn < 2; burnIn += 1) {
        run(production, warmupSteps, measuredSteps, policy.velocityIterations, policy.positionIterations);
        run(instrumented, warmupSteps, measuredSteps, policy.velocityIterations, policy.positionIterations);
    }

    const releaseRepeats = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
        releaseRepeats.push(run(production, warmupSteps, measuredSteps, policy.velocityIterations, policy.positionIterations));
    }

    const instrumentedRepeats = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
        instrumentedRepeats.push(run(instrumented, warmupSteps, measuredSteps, policy.velocityIterations, policy.positionIterations));
    }

    const interleavedRelease = run(production, warmupSteps, measuredSteps, policy.velocityIterations, policy.positionIterations);
    const interleavedInstrumented = run(instrumented, warmupSteps, measuredSteps, policy.velocityIterations, policy.positionIterations);

    const phasesMsPerStep = Object.fromEntries(PHASE_KEYS.map((key) => [
        key,
        median(instrumentedRepeats.map((repeat) => repeat.phases[key]))
    ]));
    const timerSumMsPerStep = DISJOINT_PHASE_KEYS.some((key) => phasesMsPerStep[key] === null)
        ? null
        : DISJOINT_PHASE_KEYS.reduce((total, key) => total + phasesMsPerStep[key], 0);
    const hostMsPerStepInstrumented = median(instrumentedRepeats.map((repeat) => repeat.msPerStep));
    const hostMsPerStepRelease = median(releaseRepeats.map((repeat) => repeat.msPerStep));
    const sharesOfTimerSum = Object.fromEntries(DISJOINT_PHASE_KEYS.map((key) => [key, ratio(phasesMsPerStep[key], timerSumMsPerStep)]));
    const windowSample = instrumentedRepeats[0];

    const nesting = readNesting(instrumented.exports);

    run(instrumented, warmupSteps, measuredSteps, policy.velocityIterations, policy.positionIterations);
    instrumented.exports.step(STANDARD_DT, 0, 0);
    const zeroIterationSingleStep = readTimers(instrumented.exports);
    const zeroIterationContacts = instrumented.exports.contactCount();
    instrumented.exports.step(STANDARD_DT, policy.velocityIterations, policy.positionIterations);
    const solvedIterationSingleStep = readTimers(instrumented.exports);
    const solvedIterationContacts = instrumented.exports.contactCount();
    const solvedIterationNesting = readNesting(instrumented.exports);

    const singleStepSampleKind = "one recorded step, not a window median; never average these with phasesMsPerStep";

    const probe = deriveProbeCorrection({
        hostMsPerStepInstrumented,
        hostMsPerStepRelease,
        interleavedInstrumentedMsPerStep: interleavedInstrumented.msPerStep,
        interleavedReleaseMsPerStep: interleavedRelease.msPerStep,
        timerSumMsPerStep,
        phasesMsPerStep,
        broadphasePairsPerStep: windowSample.broadphasePairsPerStep,
        hostClockNanosecondsPerCall: hostClock
    });

    const ablation = await measurePhases({
        wasmPath: releasePath,
        count,
        warmupSteps,
        measuredSteps,
        ladderRepeats: repeats
    });

    return {
        count,
        iterationPolicy: { ...policy },
        window,
        dtSeconds: STANDARD_DT,
        hostMsPerStepInstrumented,
        hostMsPerStepRelease,
        timerSumMsPerStep,
        sumVsStepTimeRelativeError: ratio(absolute(difference(timerSumMsPerStep, hostMsPerStepInstrumented)), hostMsPerStepInstrumented),
        sumVsStepTimeTolerance: SUM_TOLERANCE,
        fingerprint: windowSample.fingerprint,
        contacts: windowSample.contacts,
        releaseFingerprint: releaseRepeats[0].fingerprint,
        releaseContacts: releaseRepeats[0].contacts,
        broadphasePairsPerStep: windowSample.broadphasePairsPerStep,
        phasesMsPerStep,
        sharesOfTimerSum,
        clockProbe: probe.clockProbe,
        collideShareInterval: probe.collideShareInterval,
        collideClockOverheadUpperBoundOfBucket: probe.collideClockOverheadUpperBoundOfBucket,
        probeCorrectionPolicy: probe.probeCorrectionPolicy,
        nestedSweepSingleStep: nesting,
        clampFiredSteps: instrumentedRepeats.reduce((total, repeat) => total + repeat.clampFiredSteps, 0)
            + interleavedInstrumented.clampFiredSteps,
        clampFiredStepsSampled: (repeats + 1) * measuredSteps,
        subClockResolutionRule: "a bucket is below clock resolution when its ms/step is no more than two host clock calls, i.e. it cannot be separated from the probes that measure it",
        ...classifyClockResolution(phasesMsPerStep, hostClock),
        solver: {
            velocityPlusPositionMsPerStep: add(phasesMsPerStep.solveVelocities, phasesMsPerStep.solvePositions),
            velocityPlusPositionShare: add(sharesOfTimerSum.solveVelocities, sharesOfTimerSum.solvePositions),
            velocityShareOfSolver: ratio(phasesMsPerStep.solveVelocities,
                add(phasesMsPerStep.solveVelocities, phasesMsPerStep.solvePositions)),
            probeOverhead: probe.solverProbeOverhead,
            denominatorShiftIfEntireInflationRemoved: probe.denominatorShiftIfEntireInflationRemoved
        },
        collision: {
            broadphasePlusCollideMsPerStep: add(phasesMsPerStep.broadphase, phasesMsPerStep.collide),
            broadphasePlusCollideShare: add(sharesOfTimerSum.broadphase, sharesOfTimerSum.collide),
            broadphasePlusCollideShareInterval: probe.collisionShareInterval
        },
        sweepSubSplit: deriveSweepSubSplit(phasesMsPerStep, timerSumMsPerStep),
        ablationCrossCheck: {
            source: "bench/phases.mjs run in this same process on the release module",
            sourceModule: toPosixRelative(root, releasePath),
            ladderRepeats: ablation.ladderRepeats,
            ladderMsPerStep: {
                zeroIterations: ablation.ladder[0].msPerStep,
                velocityOnly: ablation.ladder[1].msPerStep,
                solvedIteration: ablation.ladder[2].msPerStep
            },
            ladderContacts: ablation.ladder.map((cell) => cell.contacts),
            ladderFingerprints: ablation.ladder.map((cell) => cell.fingerprint),
            ablationSolverShareUpperBound: ablation.bounds.solverShareUpperBound,
            ablationCollisionShareLowerBound: ablation.bounds.collisionShareLowerBound,
            ablationSharesClamped: ablation.shares.clamped,
            ablationContactPopulationMatched: ablation.bounds.contactPopulationMatched,
            timerSolverShareIsBelowAblationUpperBound: greater(ablation.bounds.solverShareUpperBound,
                add(sharesOfTimerSum.solveVelocities, sharesOfTimerSum.solvePositions)),
            timerCollisionShareIsAboveAblationLowerBound: greater(add(sharesOfTimerSum.broadphase, sharesOfTimerSum.collide),
                ablation.bounds.collisionShareLowerBound),
            note: "The ablation (0,0) cell generates zero contacts, so its subtraction absorbed narrowphase work into the solver bucket; the timers separate them on one contact population."
        },
        teeth: {
            zeroIterationSingleStep,
            zeroIterationContacts,
            zeroIterationSampleKind: singleStepSampleKind,
            solvedIterationSingleStep,
            solvedIterationContacts,
            solvedIterationSampleKind: singleStepSampleKind,
            solvedIterationNestedSweep: {
                sweptMs: solvedIterationNesting.sweptMs,
                collideMs: solvedIterationNesting.collideMs,
                publishedBroadphaseMs: solvedIterationSingleStep.broadphase,
                clampFired: solvedIterationNesting.clampFired,
                sweepSortMs: solvedIterationSingleStep.sweepSort,
                pairLoopMs: solvedIterationSingleStep.pairLoop,
                subMarkerSumMs: solvedIterationSingleStep.sweepSort + solvedIterationSingleStep.pairLoop,
                sweptScopeResidualMs: solvedIterationNesting.sweptMs
                    - (solvedIterationSingleStep.sweepSort + solvedIterationSingleStep.pairLoop),
                sweptScopeBandMs: sliverBandMs(solvedIterationNesting.sweptMs),
                sweptScopeResidualWithinBand: Math.abs(solvedIterationNesting.sweptMs
                    - (solvedIterationSingleStep.sweepSort + solvedIterationSingleStep.pairLoop))
                    <= sliverBandMs(solvedIterationNesting.sweptMs),
                subMarkersTileSweptScope: solvedIterationSingleStep.sweepSort + solvedIterationSingleStep.pairLoop
                    <= solvedIterationNesting.sweptMs + CLOCK_TILING_EPSILON_MS
            },
            solvedIterationSubtractionIsExact: Math.abs(solvedIterationSingleStep.broadphase
                - (solvedIterationNesting.sweptMs - solvedIterationNesting.collideMs)) < 1e-9,
            zeroIterationSolverIsExactlyZero: zeroIterationSingleStep.solveVelocities === 0
                && zeroIterationSingleStep.solvePositions === 0,
            solvedIterationSolverIsPositive: solvedIterationSingleStep.solveVelocities > 0
                && solvedIterationSingleStep.solvePositions > 0
        }
    };
}

function probeCorrectionNote(results) {
    const perPile = results.map((result) => `${result.count} boxes: JS-loop model `
        + `${result.clockProbe.jsLoopModelProbeMsPerStep.toFixed(4)} ms/step against measured inflation `
        + `${formatNumber(result.clockProbe.measuredInflationMsPerStep, 4)} ms/step, `
        + `measured/model ${formatNumber(result.clockProbe.measuredInflationOverJsLoopModelRatio, 3)}, `
        + `inflation exceeds model: ${result.clockProbe.measuredInflationExceedsJsLoopModel}`).join("; ");
    const perClamp = results.map((result) => `${result.count} boxes: lower clamp fired `
        + `${result.collideShareInterval.lowerClampFired}, signed gap `
        + `${formatNumber(result.collideShareInterval.lowerBoundMeasuredInflationMsPerStep, 4)} ms/step, unclamped lower `
        + `${formatNumber(result.collideShareInterval.rawUnclampedLowerShareOfTimerSum, 4)} against published lower `
        + `${formatNumber(result.collideShareInterval.lowerShareOfTimerSum, 4)}`).join("; ");
    return "The JS-loop per-probe model is withdrawn as an estimate and survives only as a comparison value: "
        + perPile
        + ". Which side wins is host state, not a finding, so the gate records the ratio and the flag instead of asserting the model is larger. "
        + "The only published corrections are collideShareInterval and collision.broadphasePlusCollideShareInterval, both derived from the measured instrumented-minus-release gap of this same run; "
        + "raw sharesOfTimerSum are the measurement and no corrected split is presented as measured. "
        + "Both intervals are clamped at construction so the lower end can never exceed the upper end, and each one publishes lowerClampFired, rawUnclampedLowerShareOfTimerSum and the signed lowerBoundMeasuredInflationMsPerStep that caused it: "
        + perClamp + ".";
}

function sumBoundNote(results) {
    const perPile = results.map((result) => `${result.count} boxes `
        + `${formatNumber(scalePercent(result.sumVsStepTimeRelativeError), 2)} percent`).join(", ");
    return "The asserted bound on the absolute difference between the disjoint-section timer sum and the host-measured step time, "
        + "as a fraction of the host-measured step time, is 3 percent. It was tightened from 15 percent after review: "
        + "a deliberate narrowphase double count of about 11 percent of the step passes 15 percent silently but fails 3 percent. "
        + `This run recorded ${perPile}.`;
}

function sweepSubSplitNote(results) {
    const perPile = results.map((result) => {
        const split = result.sweepSubSplit;
        return `${result.count} boxes: sweepSort ${formatNumber(split.sweepSortMsPerStep, 5)} ms/step against pairLoop net of collide `
            + `${formatNumber(split.pairLoopNetOfCollideMsPerStep, 5)} ms/step, sort share of the published broadphase bucket `
            + `${formatNumber(scalePercent(split.sortShareOfBroadphaseBucket), 2)} percent, gating fraction `
            + `${formatNumber(scalePercent(split.gatingFraction), 2)} percent, gate met: ${split.sortMeetsGatingFraction}`;
    }).join("; ");
    return "sweepSort and pairLoop are sub-buckets of the swept scope and are excluded from the timer sum; "
        + "the gate Task 8 Step 2 reads is sortShareOfBroadphaseBucket, computed against publishedBroadphaseBucketMsPerStep, which is the swept-minus-collide bucket, "
        + "so collideNestedInPairLoopMsPerStep is subtracted from pairLoopMsPerStep before the two sub-buckets are compared with it: "
        + perPile + ".";
}

function moduleIdentity(filePath) {
    const bytes = fs.readFileSync(filePath);
    return {
        file: toPosixRelative(root, filePath),
        bytes: bytes.byteLength,
        sha256: crypto.createHash("sha256").update(bytes).digest("hex")
    };
}

export const DISPOSITIONS = ["baseline", "instrument-exhibit", "pre-lever-baseline", "candidate"];
export const PHASE_PROTOCOL = "phase-protocol: 1 — shares are host excerpts, identity columns are quotable; "
    + "no absolute share band may be asserted by a gate";

export const artifactLabel = (options) => {
    const disposition = options?.disposition;
    const subject = options?.subject;
    if (!DISPOSITIONS.includes(disposition)) {
        throw new Error(`disposition must be one of ${DISPOSITIONS.join(", ")}, received ${String(disposition)}; `
            + "an unlabelled phase-split artifact cannot be told apart from the baseline by a glob or a reader");
    }
    if (typeof subject !== "string" || subject.trim() === "") {
        throw new Error("subject is required: it names what this run was for, which a disposition alone "
            + "does not carry");
    }
    return { disposition, subject };
};

export function buildArtifact(results) {
    const measuredAt = new Date().toISOString();
    return {
        generatedAt: measuredAt,
        driver: "bench/phase-split.mjs",
        wasm: {
            instrumented: "build/wasm-timers/physics.opt.wasm",
            release: "build/wasm-release/physics.opt.wasm"
        },
        moduleIdentity: {
            instrumented: moduleIdentity(timersWasmPath),
            release: moduleIdentity(releaseWasmPath),
            preOptimization: {
                instrumented: moduleIdentity(path.join(root, "build", "wasm-timers", "physics.wasm")),
                release: moduleIdentity(path.join(root, "build", "wasm-release", "physics.wasm"))
            },
            relation: "instrumented and release are the two modules this driver actually loaded and measured; "
                + "both are the wasm-opt output of their preset, and physics.wasm beside each is the same "
                + "preset's pre-wasm-opt module, recorded so the size difference is a stated relation and not "
                + "a reader's guess. Nothing here is a third build: two presets, two artifacts each."
        },
        phaseKeys: PHASE_KEYS,
        disjointPhaseKeys: DISJOINT_PHASE_KEYS,
        nestedPhaseKeys: NESTED_PHASE_KEYS,
        timerRecord: {
            bytes: TIMER_RECORD_BYTES,
            unit: "seconds per recorded step in the wasm record; readPhaseTimers converts to milliseconds",
            export: "phaseTimersView",
            guardedBy: "PHYSICS_PHASE_TIMERS"
        },
        bucketScope: "shares are shares of World::step internals. ABI-side per-step work inside the host-measured span (src/abi/exports.cpp step: collectStepStatistics plus the 112-byte statistics record copy) is in no bucket, so timerSumMsPerStep can exceed hostMsPerStepInstrumented.",
        hostClockNote: "the browser and scene-runtime path binds env.now to performance.now(), which is clamped to roughly 100 microseconds; that path is not a measurement path, only this Node driver is.",
        invariance: "instrumented and release fingerprints and contact counts are identical for every pile size in results",
        nestingNote: "broadphase is published inside the module as swept minus collide. The instrumented build also exports the raw nested values and the inversion flag (phaseTimerSweptNanoseconds, phaseTimerCollideNanoseconds, phaseTimerClampFired), the driver counts clampFired over every measured step as clampFiredSteps and throws when the sampled step reports it, and nestedSweepSingleStep plus teeth.solvedIterationNestedSweep publish the raw swept and collide values beside the bucket, so a marker inversion cannot hide as a plausible broadphase of zero.",
        sleepBucketNote: "sleepAndCacheSwap is a catch-all bucket: wake-on-contact before the solve, the warm-start impulse writeback, the point-identity probe and the prev/next table swap all charge it, while persistTime and warmStartTime report null. The compat snapshot exposes it as sleepAndCacheSwapTime and leaves sleepTime null so the label matches the content.",
        subMarkerNote: NESTED_BUCKET_NOTE,
        tilingNote: "on one recorded step the two sub-markers are disjoint intervals inside the swept scope, so teeth.solvedIterationNestedSweep publishes sweepSortMs plus pairLoopMs against sweptMs and the residual between them; subMarkersTileSweptScope is the structural check that the sum never exceeds the parent scope, and a marker moved outside broadphase() would fail it rather than quietly shrink a bucket.",
        sweepSubSplitNote: sweepSubSplitNote(results),
        probeCorrectionNote: probeCorrectionNote(results),
        sumBoundNote: sumBoundNote(results),
        provenance: {
            measuredAt,
            producedBy: "bench/phase-split.mjs",
            editReason: "this file was produced end-to-end by bench/phase-split.mjs in a single run; every note and derived field is recomputed from the values that run measured and nothing was edited outside the driver"
        },
        results
    };
}

function parseArgs(argv) {
    const options = { counts: [250, 1000, 2000, 5000], outPath: defaultOutPath };
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--counts") {
            options.counts = argv[++index].split(",").map((entry) => Number(entry));
        } else if (arg === "--out") {
            options.outPath = path.resolve(argv[++index]);
        } else if (arg === "--warmup") {
            options.warmupSteps = Number(argv[++index]);
        } else if (arg === "--measured") {
            options.measuredSteps = Number(argv[++index]);
        } else if (arg === "--repeats") {
            options.repeats = Number(argv[++index]);
        } else if (arg === "--disposition") {
            options.disposition = argv[++index];
        } else if (arg === "--subject") {
            options.subject = argv[++index];
        } else {
            throw new Error(`unknown argument ${arg}`);
        }
    }
    return options;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath.endsWith(path.join("bench", "phase-split.mjs"))) {
    const options = parseArgs(process.argv.slice(2));
    const results = [];
    for (const count of options.counts) {
        const result = await measurePhaseSplit({
            count,
            warmupSteps: options.warmupSteps,
            measuredSteps: options.measuredSteps,
            repeats: options.repeats
        });
        results.push(result);

        console.log(`\n=== box pile ${count} (warmup ${result.window.warmupSteps}, measured ${result.window.measuredSteps}, median of ${result.window.repeats}) ===`);
        console.log(`instrumented ${formatNumber(result.hostMsPerStepInstrumented, 4)} ms/step  release ${formatNumber(result.hostMsPerStepRelease, 4)}  measured inflation ${formatNumber(result.clockProbe.measuredInflationMsPerStep, 4)}  interleaved inflation ${result.clockProbe.interleavedInflationMsPerStep.toFixed(4)}`);
        console.log(`js-loop model ${result.clockProbe.jsLoopModelProbeMsPerStep.toFixed(4)} ms/step, measured inflation ${formatNumber(result.clockProbe.measuredInflationMsPerStep, 4)} ms/step, measured/model ${formatNumber(result.clockProbe.measuredInflationOverJsLoopModelRatio, 3)}, exceeds model ${result.clockProbe.measuredInflationExceedsJsLoopModel}`);
        console.log(`timer sum ${formatNumber(result.timerSumMsPerStep, 4)}  |sum-host|/host ${formatNumber(scalePercent(result.sumVsStepTimeRelativeError), 2)}%  bound ${(result.sumVsStepTimeTolerance * 100).toFixed(0)}%`);
        console.log(`collide share interval ${formatNumber(result.collideShareInterval.lowerShareOfTimerSum, 4)} .. ${formatNumber(result.collideShareInterval.upperShareOfTimerSum, 4)}  lowerClampFired ${result.collideShareInterval.lowerClampFired}  raw unclamped lower ${formatNumber(result.collideShareInterval.rawUnclampedLowerShareOfTimerSum, 4)}  signed gap ${formatNumber(result.collideShareInterval.lowerBoundMeasuredInflationMsPerStep, 4)} ms/step  clock overhead at most ${formatNumber(scalePercent(result.collideClockOverheadUpperBoundOfBucket), 2)}% of the bucket`);
        console.log(`fingerprint instrumented ${result.fingerprint} contacts ${result.contacts} | release ${result.releaseFingerprint} contacts ${result.releaseContacts}`);
        console.table(DISJOINT_PHASE_KEYS.map((key) => ({
            phase: key,
            ms: formatNumber(result.phasesMsPerStep[key], 4),
            shareOfSum: `${formatNumber(scalePercent(result.sharesOfTimerSum[key]), 2)}%`,
            shareOfHost: `${formatNumber(ratio(multiply(100, result.phasesMsPerStep[key]), result.hostMsPerStepInstrumented), 2)}%`
        })));
        const split = result.sweepSubSplit;
        console.log(`sweep sub-split: buildSweep ${formatNumber(split.sweepSortMsPerStep, 5)} ms/step, pair loop ${formatNumber(split.pairLoopMsPerStep, 5)} ms/step of which collide ${formatNumber(split.collideNestedInPairLoopMsPerStep, 5)} leaves ${formatNumber(split.pairLoopNetOfCollideMsPerStep, 5)} ms/step, published broadphase bucket ${formatNumber(split.publishedBroadphaseBucketMsPerStep, 5)} ms/step, sort share of the bucket ${formatNumber(scalePercent(split.sortShareOfBroadphaseBucket), 2)}% against the ${(split.gatingFraction * 100).toFixed(2)}% gate: ${split.sortMeetsGatingFraction}, sort share of the swept scope ${formatNumber(scalePercent(split.sortShareOfSweptScope), 2)}%, bucket reconstruction residual ${formatNumber(split.bucketReconstructionResidualMsPerStep, 5)} inside band ${formatNumber(split.bucketReconstructionBandMs, 5)} ms/step: ${split.bucketReconstructionWithinBand}`);
        console.log(`solver share ${formatNumber(scalePercent(result.solver.velocityPlusPositionShare), 2)}%  collision share ${formatNumber(scalePercent(result.collision.broadphasePlusCollideShare), 2)}%`);
        console.log(`clock resolution threshold ${result.clockResolutionThreshold.thresholdMsPerStep.toFixed(7)} ms/step = ${result.clockResolutionThreshold.clockCallsPerThreshold} x ${result.clockResolutionThreshold.thresholdNanosecondsPerCall.toFixed(2)} ns/call  sub-clock [${result.subClockResolutionPhases.join(", ") || "none"}]  above-clock [${result.aboveClockResolutionPhases.join(", ") || "none"}]  borderline [${result.borderlineClockResolutionPhases.join(", ") || "none"}]  assembleConstraints ${formatNumber(result.phasesMsPerStep.assembleConstraints, 7)} ms/step`);
        console.log(`(0,0) single step solveVelocities=${result.teeth.zeroIterationSingleStep.solveVelocities} collide=${result.teeth.zeroIterationSingleStep.collide} contacts=${result.teeth.zeroIterationContacts}`);
    }

    const explicitOut = path.resolve(options.outPath) !== path.resolve(defaultOutPath);
    const disposition = options.disposition ?? (explicitOut ? "candidate" : "baseline");
    if (disposition === "baseline" && explicitOut) {
        throw new Error("only the flagless default run may write a baseline; an --out run is a candidate, an "
            + "instrument exhibit or a pre-lever snapshot, and must say which");
    }
    const subject = options.subject ?? (explicitOut
        ? `ad-hoc run: counts=[${options.counts.join(", ")}] window=${results[0].window.warmupSteps}+`
            + `${results[0].window.measuredSteps} repeats=${results[0].window.repeats}`
        : "shipped tree re-record");
    const label = artifactLabel({ disposition, subject });
    fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
    const artifact = { disposition: label.disposition, subject: label.subject, protocol: PHASE_PROTOCOL,
        ...buildArtifact(results) };
    fs.writeFileSync(options.outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(options.outPath);
}
