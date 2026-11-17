import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildArtifact, CLOCK_TILING_EPSILON_MS, DISJOINT_PHASE_KEYS, DISPOSITIONS, NESTED_PHASE_KEYS, PHASE_KEYS, PHASE_PROTOCOL, SORT_GATING_FRACTION, SUM_TOLERANCE, SWEPT_SLIVER_ALLOWANCE_MS, TIMER_RECORD_BYTES, TIMER_RECORD_VERSION, artifactLabel, measurePhaseSplit } from "../bench/phase-split.mjs";

const sha256File = (filePath) => crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const timersWasm = path.join(root, "build", "wasm-timers", "physics.opt.wasm");
const releaseWasm = path.join(root, "build", "wasm-release", "physics.opt.wasm");
const artifactPath = path.join(root, "bench", "results", "phase-split-timers.json");
const pins = JSON.parse(fs.readFileSync(path.join(root, "bench", "results", "policy-10-4-fingerprints.json"), "utf8"));

for (const filePath of [timersWasm, releaseWasm, artifactPath]) {
    assert.ok(fs.existsSync(filePath), `${filePath} is missing; run node scripts/build.mjs wasm-timers and node scripts/build.mjs wasm-release first`);
}

assert.equal(SUM_TOLERANCE, 0.03, "the published sum bound must stay at the tightened 3 percent");

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const raw = fs.readFileSync(artifactPath, "utf8");
const large = artifact.results.find((result) => result.count === 1000);
assert.ok(large, "the committed artifact must carry the box 1000 row");

const assertClockResolutionClassification = (result, label) => {
    const threshold = result.clockResolutionThreshold;
    const values = result.phasesMsPerStep;
    const clockNanosecondsPerCall = result.clockProbe.hostClockNanosecondsPerCall;

    assert.ok(threshold && typeof threshold === "object", `${label}: the run must publish the resolution threshold it classified against`);
    assert.ok(Number.isFinite(threshold.thresholdMsPerStep) && threshold.thresholdMsPerStep > 0,
        `${label}: the published clock resolution threshold must be a positive finite ms/step value`);
    assert.ok(Number.isFinite(clockNanosecondsPerCall) && clockNanosecondsPerCall > 0,
        `${label}: the host clock cost the threshold is built from must be published and positive`);
    assert.equal(threshold.thresholdNanosecondsPerCall, clockNanosecondsPerCall,
        `${label}: the published per-call clock cost must be the same value the clock probe publishes`);
    assert.ok(Number.isInteger(threshold.clockCallsPerThreshold) && threshold.clockCallsPerThreshold >= 1,
        `${label}: the number of clock calls per threshold must be published as a positive integer`);
    assert.equal(threshold.thresholdMsPerStep, threshold.clockCallsPerThreshold * clockNanosecondsPerCall / 1e6,
        `${label}: the published threshold must be the published clock cost times the published call count, recomputed from this run`);
    assert.equal(typeof threshold.derivedFrom, "string", `${label}: the threshold must publish what it is derived from`);
    assert.match(threshold.derivedFrom, /hostClockNanosecondsPerCall/,
        `${label}: the derivation must name the published clock cost the threshold is built from`);

    const band = threshold.borderlineRelativeBand;
    assert.ok(Number.isFinite(band) && band > 0 && band < 1,
        `${label}: the borderline band must be published as a stated relative fraction of the threshold`);
    assert.equal(typeof threshold.borderlineRule, "string", `${label}: the borderline band must publish a reader-facing rule`);

    const relativeDistance = (key) => Math.abs(values[key] - threshold.thresholdMsPerStep) / threshold.thresholdMsPerStep;
    const expectedSub = PHASE_KEYS.filter((key) => values[key] <= threshold.thresholdMsPerStep);
    const expectedAbove = PHASE_KEYS.filter((key) => values[key] > threshold.thresholdMsPerStep);
    const expectedBorderline = PHASE_KEYS.filter((key) => relativeDistance(key) <= band);
    const lists = [
        ["subClockResolutionPhases", result.subClockResolutionPhases, expectedSub],
        ["aboveClockResolutionPhases", result.aboveClockResolutionPhases, expectedAbove],
        ["borderlineClockResolutionPhases", result.borderlineClockResolutionPhases, expectedBorderline]
    ];

    for (const [name, published, expected] of lists) {
        assert.ok(Array.isArray(published), `${label}: ${name} must be published as a list of buckets`);
        assert.equal(new Set(published).size, published.length, `${label}: ${name} names a bucket more than once`);
        assert.ok(published.every((key) => PHASE_KEYS.includes(key)), `${label}: ${name} names a bucket outside the published phase keys`);
        assert.deepEqual([...published].sort(), [...expected].sort(),
            `${label}: ${name} must be exactly the buckets the published ms/step values put on that side of the published threshold, recomputed rather than asserted by name`);
    }

    assert.equal(new Set([...result.subClockResolutionPhases, ...result.aboveClockResolutionPhases]).size, PHASE_KEYS.length,
        `${label}: every bucket must land in exactly one of the two classes, with none missing and none in both`);
    for (const key of result.subClockResolutionPhases) {
        assert.ok(values[key] <= threshold.thresholdMsPerStep,
            `${label}: a bucket classified sub-clock must be at or below the published threshold: ${key} ${values[key]}`);
    }
    for (const key of result.aboveClockResolutionPhases) {
        assert.ok(values[key] > threshold.thresholdMsPerStep,
            `${label}: a bucket not classified sub-clock must be above the published threshold: ${key} ${values[key]}`);
    }
    for (const key of PHASE_KEYS.filter((entry) => !result.borderlineClockResolutionPhases.includes(entry))) {
        assert.ok(relativeDistance(key) > band,
            `${label}: a bucket outside the published borderline band must sit clearly on one side of the published threshold: ${key} ${relativeDistance(key)}`);
    }

    assert.ok(result.subClockResolutionPhases.includes("assembleConstraints")
        || result.aboveClockResolutionPhases.includes("assembleConstraints"),
        `${label}: assembleConstraints is the tiny bucket and must be classified into one of the two classes, whichever way this run's clock fell`);
    if (result.borderlineClockResolutionPhases.includes("assembleConstraints")) {
        assert.ok(relativeDistance("assembleConstraints") <= band,
            `${label}: a borderline assembleConstraints must sit inside the published band: ${relativeDistance("assembleConstraints")}`);
    }
};

const assertShareIntervalWellFormed = (result, interval, baseMs, label) => {
    const inflation = result.clockProbe.measuredInflationMsPerStep;
    const sum = result.timerSumMsPerStep;
    const collideMs = result.phasesMsPerStep.collide;
    const rawUnclampedLowerMs = baseMs + Math.max(0, collideMs - inflation);
    const upperMs = baseMs + collideMs;
    const clampFired = rawUnclampedLowerMs > upperMs;

    assert.equal(interval.upperShareOfTimerSum, upperMs / sum, `${label}: the upper bound must stay the raw bucket share`);
    assert.equal(interval.lowerShareOfTimerSum, Math.min(rawUnclampedLowerMs, upperMs) / sum,
        `${label}: the published lower bound must be the clamped value`);
    assert.ok(interval.lowerShareOfTimerSum <= interval.upperShareOfTimerSum,
        `${label}: a published interval whose lower end exceeds its upper end is not an interval`);

    assert.equal(typeof interval.lowerClampFired, "boolean", `${label}: the clamp must publish a boolean flag`);
    assert.equal(interval.lowerClampFired, clampFired, `${label}: the published clamp flag must agree with the arithmetic`);
    assert.ok(Number.isFinite(interval.rawUnclampedLowerShareOfTimerSum),
        `${label}: the raw unclamped lower bound must be published and finite`);
    assert.equal(interval.rawUnclampedLowerShareOfTimerSum, rawUnclampedLowerMs / sum,
        `${label}: the published raw unclamped lower bound must be the pre-clamp value`);
    assert.ok(Number.isFinite(interval.lowerBoundMeasuredInflationMsPerStep),
        `${label}: the signed instrumented-minus-release gap must be published and finite`);
    assert.equal(interval.lowerBoundMeasuredInflationMsPerStep, inflation,
        `${label}: the published signed gap must be the same value the clock probe publishes`);
    assert.equal(typeof interval.lowerClampNote, "string", `${label}: the clamp must publish a reader-facing note`);

    if (interval.lowerClampFired) {
        assert.ok(inflation < 0, `${label}: the clamp may only fire when the signed gap is negative`);
        assert.equal(interval.lowerShareOfTimerSum, interval.upperShareOfTimerSum,
            `${label}: a clamped lower bound must sit exactly on the upper bound`);
        assert.ok(interval.rawUnclampedLowerShareOfTimerSum > interval.lowerShareOfTimerSum,
            `${label}: a fired clamp must show a raw value above the published one`);
    } else {
        assert.equal(interval.lowerShareOfTimerSum, interval.rawUnclampedLowerShareOfTimerSum,
            `${label}: with the clamp not fired the published lower bound must equal the raw value`);
    }
};

const assertSweepSubSplitWellFormed = (result, label) => {
    const split = result.sweepSubSplit;
    const values = result.phasesMsPerStep;
    assert.ok(split && typeof split === "object", `${label}: the run must publish the broadphase sub-split`);

    for (const key of NESTED_PHASE_KEYS) {
        assert.ok(Number.isFinite(values[key]), `${label}: ${key} must be a finite ms/step reading, received ${values[key]}`);
        assert.ok(values[key] >= 0, `${label}: ${key} cannot be negative: ${values[key]}`);
        assert.equal(Object.hasOwn(result.sharesOfTimerSum, key), false,
            `${label}: ${key} is a sub-bucket of the swept scope and must not carry a share of the disjoint timer sum`);
    }

    assert.equal(split.sweepSortMsPerStep, values.sweepSort, `${label}: sweepSortMsPerStep must be the published bucket`);
    assert.equal(split.pairLoopMsPerStep, values.pairLoop, `${label}: pairLoopMsPerStep must be the published bucket`);
    assert.equal(split.collideNestedInPairLoopMsPerStep, values.collide, `${label}: the collide reading inside the sub-split must be the published collide bucket`);
    assert.equal(split.publishedBroadphaseBucketMsPerStep, values.broadphase, `${label}: the sub-split must be gated against the published broadphase bucket`);
    assert.equal(split.sweptScopeMsPerStep, values.sweepSort + values.pairLoop, `${label}: the swept scope must be the sum of the two sub-buckets`);
    assert.equal(split.pairLoopNetOfCollideMsPerStep, values.pairLoop - values.collide, `${label}: the pair loop must publish its cost net of the collide marker nested inside it`);
    assert.equal(split.reconstructedBroadphaseBucketMsPerStep, values.sweepSort + (values.pairLoop - values.collide),
        `${label}: the reconstructed bucket must be the sort plus the pair loop net of collide`);
    assert.equal(split.bucketReconstructionResidualMsPerStep, values.broadphase - split.reconstructedBroadphaseBucketMsPerStep,
        `${label}: the reconstruction residual must be the published bucket minus the reconstructed one`);
    assert.equal(split.sortShareOfBroadphaseBucket, values.sweepSort / values.broadphase, `${label}: the gating share must be the sort over the published bucket`);
    assert.equal(split.sortShareOfSweptScope, values.sweepSort / split.sweptScopeMsPerStep, `${label}: the share of the swept scope must be recomputable from the published sub-buckets`);
    assert.equal(split.pairLoopNetShareOfBroadphaseBucket, split.pairLoopNetOfCollideMsPerStep / values.broadphase,
        `${label}: the pair loop net share must be recomputable from the published sub-buckets`);
    assert.equal(split.broadphaseBucketShareOfTimerSum, values.broadphase / result.timerSumMsPerStep, `${label}: the bucket share of the timer sum must be recomputable`);
    assert.equal(split.sortShareOfTimerSum, values.sweepSort / result.timerSumMsPerStep, `${label}: the sort share of the timer sum must be recomputable`);
    assert.equal(split.gatingFraction, SORT_GATING_FRACTION, `${label}: the gate must publish the fraction Task 8 Step 2 reads`);
    assert.equal(split.sortMeetsGatingFraction, split.sortShareOfBroadphaseBucket >= SORT_GATING_FRACTION,
        `${label}: the gate flag must agree with the published share and fraction`);

    assert.ok(split.pairLoopNetOfCollideMsPerStep >= 0,
        `${label}: collide is marked inside the pair enumeration loop, so the loop cannot cost less than the pairs it enumerates: ${split.pairLoopNetOfCollideMsPerStep}`);

    const residualBand = Math.max(SWEPT_SLIVER_ALLOWANCE_MS, 0.15 * split.sweptScopeMsPerStep);
    assert.equal(split.bucketReconstructionBandMs, residualBand, `${label}: the published reconstruction band must be recomputable from the swept scope`);
    assert.equal(split.bucketReconstructionWithinBand, Math.abs(split.bucketReconstructionResidualMsPerStep) <= residualBand,
        `${label}: the published within-band flag must agree with the residual and the band beside it`);
    assert.ok(split.bucketReconstructionWithinBand,
        `${label}: the reconstruction residual ${split.bucketReconstructionResidualMsPerStep} ms/step left its ${residualBand} ms/step band; a marker moved outside broadphase() lands far outside it`);

    const nesting = result.teeth.solvedIterationNestedSweep;
    assert.equal(nesting.sweepSortMs, result.teeth.solvedIterationSingleStep.sweepSort, `${label}: the single-step sort reading must be the record value`);
    assert.equal(nesting.pairLoopMs, result.teeth.solvedIterationSingleStep.pairLoop, `${label}: the single-step pair-loop reading must be the record value`);
    assert.equal(nesting.subMarkerSumMs, nesting.sweepSortMs + nesting.pairLoopMs, `${label}: the published sub-marker sum must be its two parts`);
    assert.equal(nesting.sweptScopeResidualMs, nesting.sweptMs - nesting.subMarkerSumMs, `${label}: the published tiling residual must be the swept scope minus the sub-marker sum`);
    assert.equal(nesting.subMarkersTileSweptScope, nesting.subMarkerSumMs <= nesting.sweptMs + CLOCK_TILING_EPSILON_MS,
        `${label}: the tiling flag must agree with the two numbers it compares`);
    assert.ok(nesting.subMarkersTileSweptScope,
        `${label}: on one recorded step the two sub-markers are disjoint intervals inside the swept scope, so their sum cannot exceed it: ${nesting.subMarkerSumMs} against ${nesting.sweptMs}`);
    assert.ok(nesting.sweptScopeResidualMs >= -CLOCK_TILING_EPSILON_MS,
        `${label}: a single-step tiling residual below zero means a sub-marker escaped its parent scope: ${nesting.sweptScopeResidualMs}`);
    const singleStepBand = Math.max(SWEPT_SLIVER_ALLOWANCE_MS, 0.15 * nesting.sweptMs);
    assert.equal(nesting.sweptScopeBandMs, singleStepBand, `${label}: the published single-step band must be recomputable from the swept scope`);
    assert.equal(nesting.sweptScopeResidualWithinBand, Math.abs(nesting.sweptScopeResidualMs) <= singleStepBand,
        `${label}: the published single-step within-band flag must agree with the residual and the band beside it`);
    assert.ok(nesting.sweptScopeResidualWithinBand,
        `${label}: the unmarked sliver of the swept scope must stay inside ${singleStepBand} ms of a ${nesting.sweptMs} ms scope, received ${nesting.sweptScopeResidualMs}`);
};

for (const result of artifact.results) {
    const inflation = result.clockProbe.measuredInflationMsPerStep;    const model = result.clockProbe.jsLoopModelProbeMsPerStep;
    const probes = result.clockProbe.estimatedProbesPerStep;
    const collideMs = result.phasesMsPerStep.collide;
    const sum = result.timerSumMsPerStep;
    const phaseSum = DISJOINT_PHASE_KEYS.reduce((total, key) => total + result.phasesMsPerStep[key], 0);

    assert.ok(Math.abs(phaseSum - sum) < 1e-9, `${result.count}: the disjoint-section timer sum must add up to timerSumMsPerStep`);
    assert.ok(result.sumVsStepTimeRelativeError <= result.sumVsStepTimeTolerance);
    assert.equal(result.sumVsStepTimeTolerance, 0.03);
    assert.equal(result.fingerprint, result.releaseFingerprint, "instrumented and release must simulate identically");
    assert.equal(result.contacts, result.releaseContacts);
    assert.equal(result.sharesOfTimerSum.collide, collideMs / sum);

    assert.ok(Number.isInteger(result.window.repeats) && result.window.repeats >= 1, `${result.count}: window.repeats is the single published name for the repeat count`);
    assert.equal(result.clampFiredStepsSampled, result.window.measuredSteps * (result.window.repeats + 1));
    assert.equal(result.clampFiredSteps, 0, `${result.count}: the swept-minus-collide subtraction must never clamp across the published window`);
    assert.equal(result.nestedSweepSingleStep.clampFired, false);
    assert.ok(result.nestedSweepSingleStep.sweptMs >= result.nestedSweepSingleStep.collideMs);
    assert.equal(result.teeth.solvedIterationNestedSweep.clampFired, false);
    assert.equal(result.teeth.solvedIterationSubtractionIsExact, true);

    assert.equal(inflation, result.hostMsPerStepInstrumented - result.hostMsPerStepRelease);
    assert.ok(Number.isFinite(inflation) && inflation !== 0,
        `${result.count}: the instrumented-minus-release gap must be published and finite; its sign is host drift, not a finding, so the gate records it instead of asserting it positive`);
    assert.ok(Number.isFinite(model) && model > 0, `${result.count}: the withdrawn JS-loop model must stay a positive finite comparison value`);
    const inflationOverModel = result.clockProbe.measuredInflationOverJsLoopModelRatio;
    assert.ok(Number.isFinite(inflationOverModel) && inflationOverModel !== 0,
        `${result.count}: the measured-inflation over JS-loop-model ratio must be present, finite and nonzero; its sign follows the gap above`);
    assert.equal(inflationOverModel, inflation / model, `${result.count}: the recorded ratio must equal measuredInflationMsPerStep over jsLoopModelProbeMsPerStep`);
    assert.equal(result.clockProbe.jsLoopModelOverMeasuredGap, model / inflation);
    assert.equal(result.clockProbe.measuredInflationExceedsJsLoopModel, inflation > model, `${result.count}: the exceeds-model flag must agree with the two numbers it compares`);
    assert.equal(result.clockProbe.perProbeUpperBoundNanosecondsFromMeasuredGap, inflation * 1e6 / probes);
    assert.equal(result.collideClockOverheadUpperBoundOfBucket, inflation / collideMs);
    assert.equal(result.solver.probeOverhead.probesPerStep, 4);
    assert.equal(result.solver.probeOverhead.upperBoundMsPerStep, inflation * 4 / probes);
    assert.equal(result.solver.probeOverhead.upperBoundShareOfTimerSum, inflation * 4 / probes / sum);
    assert.equal(result.solver.denominatorShiftIfEntireInflationRemoved, inflation / sum);
    assertShareIntervalWellFormed(result, result.collideShareInterval, 0, `${result.count} collideShareInterval`);
    assertShareIntervalWellFormed(result, result.collision.broadphasePlusCollideShareInterval,
        result.phasesMsPerStep.broadphase, `${result.count} broadphasePlusCollideShareInterval`);
    assertClockResolutionClassification(result, `${result.count} clock resolution classification`);
    assertSweepSubSplitWellFormed(result, `${result.count} sweep sub-split`);
    assert.equal(result.teeth.zeroIterationSolverIsExactlyZero, true);
    assert.equal(result.teeth.solvedIterationSolverIsPositive, true);
    assert.equal(result.teeth.zeroIterationSingleStep.solveVelocities, 0);
    assert.match(result.teeth.zeroIterationSampleKind, /single step|one recorded step/);
    assert.match(result.teeth.solvedIterationSampleKind, /single step|one recorded step/);

    assert.match(result.ablationCrossCheck.source, /^bench\/phases\.mjs\b/);
    assert.equal(result.ablationCrossCheck.sourceModule, "build/wasm-release/physics.opt.wasm");
    const ladder = result.ablationCrossCheck.ladderMsPerStep;
    const ladderVelocity = Math.max(0, ladder.velocityOnly - ladder.zeroIterations);
    const ladderPosition = Math.max(0, ladder.solvedIteration - ladder.velocityOnly);
    assert.equal(result.ablationCrossCheck.ablationSolverShareUpperBound, (ladderVelocity + ladderPosition) / ladder.solvedIteration);
    assert.equal(result.ablationCrossCheck.ablationCollisionShareLowerBound, ladder.zeroIterations / ladder.solvedIteration);
    const ladderContacts = result.ablationCrossCheck.ladderContacts;
    assert.equal(result.ablationCrossCheck.ablationContactPopulationMatched,
        ladderContacts.every((contacts) => contacts === ladderContacts[ladderContacts.length - 1]),
        `${result.count}: the ablation contact-population flag must equal what the published ladder contacts `
        + "say, not a value the driver assumed");
    assert.equal(result.ablationCrossCheck.timerSolverShareIsBelowAblationUpperBound, true);
    assert.equal(result.ablationCrossCheck.timerCollisionShareIsAboveAblationLowerBound, true);

    assert.ok(result.sharesOfTimerSum.solveVelocities > result.sharesOfTimerSum.solvePositions,
        `${result.count}: the velocity pass must outweigh the position pass at 10/4 iterations`);
    assert.ok(result.solver.velocityPlusPositionShare > 0 && result.solver.velocityPlusPositionShare < 1,
        `${result.count}: solver share must be a fraction`);
    assert.ok(Number.isFinite(result.solver.velocityPlusPositionMsPerStep), `${result.count}: solver ms`);
}

assert.equal(artifact.driver, "bench/phase-split.mjs");

const assertModuleIdentity = (entry, label) => {
    assert.ok(entry, `${label}: the artifact must record the module bytes it measured`);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/, `${label}: sha256 must be a full hex digest`);
    assert.ok(Number.isInteger(entry.bytes) && entry.bytes > 0, `${label}: bytes must be a positive count`);
    assert.equal(typeof entry.file, "string", `${label}: file must be named`);
    return entry;
};

test("the artifact identifies the exact module bytes behind every row", () => {
    const identity = artifact.moduleIdentity;
    assert.ok(identity, "a baseline artifact that names only paths cannot be re-hashed by a reviewer");
    const instrumented = assertModuleIdentity(identity.instrumented, "instrumented");
    const release = assertModuleIdentity(identity.release, "release");
    assert.equal(instrumented.file, artifact.wasm.instrumented, "the identity block must describe the loaded module");
    assert.equal(release.file, artifact.wasm.release, "the identity block must describe the loaded module");
    assert.match(instrumented.file, /\.opt\.wasm$/, "the driver measures the post-wasm-opt artifact");
    assert.match(release.file, /\.opt\.wasm$/, "the driver measures the post-wasm-opt artifact");
    assert.notEqual(instrumented.sha256, release.sha256,
        "the timers and release builds must be distinguishable by digest, not only by directory name");

    const preInstrumented = assertModuleIdentity(identity.preOptimization.instrumented, "pre-optimization timers");
    const preRelease = assertModuleIdentity(identity.preOptimization.release, "pre-optimization release");
    assert.match(identity.relation, /same preset/, "the physics.wasm to physics.opt.wasm relation must be stated");
    assert.match(identity.relation, /wasm-opt/);
    assert.equal(preInstrumented.file.replace("physics.wasm", "physics.opt.wasm"), instrumented.file,
        "the pre-optimization module must be the sibling of the measured one in the same preset directory");
    assert.equal(preRelease.file.replace("physics.wasm", "physics.opt.wasm"), release.file);
    assert.ok(instrumented.bytes < preInstrumented.bytes,
        `wasm-opt must shrink the timers module: ${instrumented.bytes} vs ${preInstrumented.bytes}`);
    assert.ok(release.bytes < preRelease.bytes,
        `wasm-opt must shrink the release module: ${release.bytes} vs ${preRelease.bytes}`);
});

test("every artifact the driver writes declares what it is", () => {
    assert.deepEqual(DISPOSITIONS, ["baseline", "instrument-exhibit", "pre-lever-baseline", "candidate"]);
    assert.deepEqual(artifactLabel({ disposition: "candidate", subject: "lever A snapshot" }),
        { disposition: "candidate", subject: "lever A snapshot" });
    assert.throws(() => artifactLabel({ subject: "no disposition" }), /disposition must be one of/);
    assert.throws(() => artifactLabel({ disposition: "baseline" }), /subject is required/);
    assert.throws(() => artifactLabel({ disposition: "Baseline", subject: "case matters" }),
        /disposition must be one of/);
    assert.throws(() => artifactLabel({ disposition: "candidate", subject: "   " }), /subject is required/);
});

test("an --out run carries its label and leaves the baseline bytes alone", () => {
    const outRelative = ".tmp/disposition-check.json";
    const outPath = path.join(root, outRelative);
    if (fs.existsSync(outPath)) {
        fs.rmSync(outPath);
    }
    const baselineBefore = sha256File(artifactPath);
    const result = spawnSync(process.execPath,
        [path.join(root, "bench", "phase-split.mjs"), "--counts", "250", "--repeats", "1",
            "--out", outRelative, "--subject", "label round-trip check"], { encoding: "utf8" });
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const written = JSON.parse(fs.readFileSync(outPath, "utf8"));
    assert.equal(written.disposition, "candidate",
        "an --out run is a candidate unless its caller says otherwise; never a baseline");
    assert.equal(written.subject, "label round-trip check");
    assert.deepEqual(written.results.map((entry) => entry.count), [250]);
    assert.equal(written.protocol, PHASE_PROTOCOL, "an artifact must name the rules it was produced under");
    assert.match(PHASE_PROTOCOL, /^phase-protocol: 1/);
    assert.match(PHASE_PROTOCOL, /no absolute share band/);
    assert.equal(sha256File(artifactPath), baselineBefore,
        "the pre-lever baseline must not move while the labeling work lands");
    const beside = fs.readdirSync(path.join(root, "bench", "results"))
        .filter((name) => /^phase-split.*\.json$/.test(name) && name !== path.basename(artifactPath));
    for (const name of beside) {
        const sibling = JSON.parse(fs.readFileSync(path.join(root, "bench", "results", name), "utf8"));
        assert.notEqual(sibling.disposition, undefined,
            `bench/results/${name} carries no disposition at all: an unlabelled artifact beside the baseline is `
            + "read by any phase-split glob as if it were a measurement, so absence is a failure, not a pass");
        assert.notEqual(sibling.disposition, "baseline",
            `bench/results/${name} is not the baseline path and must never label itself as one`);
    }
    const exhibitsDir = path.join(root, "bench", "results", "exhibits");
    const beforePath = path.join(exhibitsDir, "phase-split.before-submarkers.json");
    const afterPath = path.join(exhibitsDir, "phase-split.after-submarkers.json");
    for (const name of ["phase-split.before-submarkers.json", "phase-split.after-submarkers.json"]) {
        assert.equal(beside.includes(name), false,
            `${name} is an instrument-failure exhibit, not a measurement: it must live under `
            + "bench/results/exhibits/ so no phase-split glob in the close-out reads its corrupted numbers");
    }
    assert.equal(JSON.parse(fs.readFileSync(beforePath, "utf8")).disposition, "instrument-exhibit",
        "the before-exhibit was re-recorded by the driver against the same module bytes and labels itself");
    const after = JSON.parse(fs.readFileSync(afterPath, "utf8"));
    assert.equal(after.disposition, undefined,
        "the after-exhibit cannot be re-recorded: the sub-marker build that corrupted it (timers.opt "
        + "2df093de…) is no longer in build/, so a fresh run would overwrite the 14x exhibit with clean "
        + "numbers and mislabel them. Its bytes are frozen evidence; its disposition lives in "
        + "bench/results/exhibits/README.md instead of being typed into the JSON by hand");
    assert.ok(after.results[0].solver.velocityPlusPositionShare > 0.9,
        "the frozen exhibit must still show the corrupted share it was kept for");
    const afterDPath = path.join(exhibitsDir, "phase-split.after-d.json");
    assert.equal(beside.includes("phase-split.after-d.json"), false,
        "phase-split.after-d.json is a post-revert measurement with no disposition: it must not sit where a "
        + "phase-split glob can read its loaded-host milliseconds as a baseline");
    const afterD = JSON.parse(fs.readFileSync(afterDPath, "utf8"));
    assert.equal(afterD.disposition, undefined,
        "its bytes are evidence about when they were measured, so no label may be typed in or re-measured over "
        + "them; the exhibits README carries what it proves");
    assert.equal(afterD.subject, undefined, "same reason as disposition");
    for (const count of [250, 1000, 2000, 5000]) {
        const row = afterD.results.find((entry) => entry.count === count);
        const pin = pins.cells.find((cell) => cell.count === count);
        assert.equal(row.fingerprint, pin.fingerprint, `${count}: identity columns are quotable from this file`);
        assert.equal(row.contacts, pin.contacts, `${count}: contact counts are quotable from this file`);
    }
    const readme = fs.readFileSync(path.join(exhibitsDir, "README.md"), "utf8");
    assert.match(readme, /phase-split\.after-d\.json/, "the exhibit directory must explain each exhibit");
    assert.match(readme, /62/, "the README must state how far its milliseconds drifted");
    fs.rmSync(outPath);
});
assert.deepEqual(artifact.phaseKeys, PHASE_KEYS, "the published key list must be the record layout in order");
assert.deepEqual([...artifact.disjointPhaseKeys, ...artifact.nestedPhaseKeys].sort(), [...PHASE_KEYS].sort(),
    "the record keys must partition into the disjoint step sections and the swept sub-buckets, with none missing and none in both");
assert.deepEqual(artifact.nestedPhaseKeys, NESTED_PHASE_KEYS, "the swept sub-buckets must stay the two named keys");
assert.equal(artifact.timerRecord.bytes, TIMER_RECORD_BYTES,
    "the record is the two header words plus one double per published phase key, so a key added without a reader fails here");
for (const result of artifact.results) {
    const header = result.teeth.solvedIterationSingleStep;
    assert.equal(header.recordVersion, TIMER_RECORD_VERSION,
        `${result.count}: the compiled module must publish the record version the reader speaks`);
    assert.equal(header.recordBytes, TIMER_RECORD_BYTES,
        `${result.count}: the record size published inside the compiled module's own bytes must equal the layout the driver reads`);
    assert.equal(header.recordBytes, artifact.timerRecord.bytes,
        `${result.count}: the artifact may not claim a record shape the module did not report in its own header`);
}
assert.match(artifact.timerRecord.unit, /seconds/);
assert.match(artifact.bucketScope, /collectStepStatistics/);
assert.match(artifact.hostClockNote, /100 microseconds/);
assert.match(artifact.nestingNote, /clampFired/);
assert.match(artifact.subMarkerNote, /excluded from timerSumMsPerStep/);
assert.match(artifact.subMarkerNote, /collide marker already sits/);
assert.match(artifact.tilingNote, /disjoint intervals inside the swept scope/);
assert.match(artifact.sweepSubSplitNote, /gating fraction/);
assert.match(artifact.sleepBucketNote, /sleepAndCacheSwapTime/);
assert.match(artifact.probeCorrectionNote, /withdrawn/);
assert.match(artifact.sumBoundNote, /3 percent/);
assert.equal(artifact.provenance.measuredAt, artifact.generatedAt);
assert.equal(artifact.provenance.producedBy, "bench/phase-split.mjs");
assert.match(artifact.provenance.editReason, /bench\/phase-split\.mjs/);

assert.equal(raw.includes("probeCorrectedSharesOfStep"), false, "the withdrawn point-estimate correction must not be published");
assert.equal(raw.includes("ShareProbeCorrected"), false);
assert.equal(raw.includes("derivedFieldsEditedAt"), false, "a hand-edit marker must not survive a full driver run");
assert.equal(raw.includes("bench/results/phases-"), false, "the ablation cross-check must not point at a stale scratch file");

const fresh = await measurePhaseSplit({ count: 250, repeats: 1 });
const pin = pins.cells.find((cell) => cell.count === 250);
assert.equal(fresh.fingerprint, pin.fingerprint, "the instrumented module must reproduce the pinned 10/4 fingerprint");
assert.equal(fresh.contacts, pin.contacts);
assert.equal(fresh.releaseFingerprint, pin.fingerprint);
assert.ok(fresh.sumVsStepTimeRelativeError < SUM_TOLERANCE, `sum vs host ${fresh.sumVsStepTimeRelativeError}`);
assert.equal(fresh.clampFiredSteps, 0, "the swept-minus-collide subtraction must never clamp across the window");
assert.equal(fresh.teeth.solvedIterationSingleStep.recordBytes, artifact.timerRecord.bytes,
    "the module read just now must publish the same record shape the artifact claims, so a rebuilt module with a different record fails here instead of rescaling every bucket silently");
assert.equal(fresh.teeth.solvedIterationSingleStep.recordVersion, TIMER_RECORD_VERSION,
    "the module read just now must publish the record version the reader speaks");
assert.equal(fresh.nestedSweepSingleStep.clampFired, false);
assert.ok(fresh.nestedSweepSingleStep.sweptMs >= fresh.nestedSweepSingleStep.collideMs);
assert.equal(fresh.teeth.solvedIterationNestedSweep.clampFired, false);
assert.equal(fresh.teeth.solvedIterationSubtractionIsExact, true);
assert.ok(fresh.teeth.solvedIterationNestedSweep.sweptMs >= fresh.teeth.solvedIterationNestedSweep.collideMs);
assert.ok(fresh.sharesOfTimerSum.solveVelocities > fresh.sharesOfTimerSum.solvePositions,
    "the live re-measure must still show the velocity pass outweighing the position pass at 10/4");
assert.equal(fresh.teeth.zeroIterationSolverIsExactlyZero, true);
assert.ok(fresh.teeth.solvedIterationSolverIsPositive);
assert.equal(fresh.clockProbe.measuredInflationMsPerStep, fresh.hostMsPerStepInstrumented - fresh.hostMsPerStepRelease);
assertShareIntervalWellFormed(fresh, fresh.collideShareInterval, 0, "fresh 250 collideShareInterval");
assertShareIntervalWellFormed(fresh, fresh.collision.broadphasePlusCollideShareInterval,
    fresh.phasesMsPerStep.broadphase, "fresh 250 broadphasePlusCollideShareInterval");
assertClockResolutionClassification(fresh, "fresh 250 clock resolution classification");
assertSweepSubSplitWellFormed(fresh, "fresh 250 sweep sub-split");
assert.equal(fresh.ablationCrossCheck.timerSolverShareIsBelowAblationUpperBound, true);
assert.equal(fresh.window.repeats, 1);
assert.ok(Number.isFinite(fresh.clockProbe.measuredInflationOverJsLoopModelRatio)
    && fresh.clockProbe.measuredInflationOverJsLoopModelRatio !== 0,
    `the measured-inflation over JS-loop-model ratio must stay finite and nonzero; its sign is host drift, not a finding, so the gate records it instead of asserting it positive: ${fresh.clockProbe.measuredInflationOverJsLoopModelRatio}`);
assert.equal(fresh.clockProbe.jsLoopModelOverMeasuredGap, fresh.clockProbe.measuredInflationMsPerStep === 0
    ? null
    : fresh.clockProbe.jsLoopModelProbeMsPerStep / fresh.clockProbe.measuredInflationMsPerStep);
assert.equal(fresh.clockProbe.measuredInflationExceedsJsLoopModel,
    fresh.clockProbe.measuredInflationMsPerStep > fresh.clockProbe.jsLoopModelProbeMsPerStep);

const republished = buildArtifact([fresh]);
assert.equal(republished.provenance.measuredAt, republished.generatedAt);
assert.match(republished.provenance.editReason, /bench\/phase-split\.mjs/);
assert.match(republished.probeCorrectionNote, /withdrawn/);
assert.match(republished.sumBoundNote, /3 percent/);
assert.deepEqual(Object.keys(republished).sort(), Object.keys(artifact).sort(),
    "the committed artifact has drifted from the driver's top-level schema");
const publishedRow = artifact.results.find((result) => result.count === 250);
assert.deepEqual(Object.keys(republished.results[0]).sort(), Object.keys(publishedRow).sort(),
    "the committed artifact has drifted from the driver's per-pile schema");

test("the committed artifact carries a row at every pinned box size", () => {
    const expected = [250, 1000, 2000, 5000];
    const present = artifact.results.map((result) => result.count);
    assert.deepEqual(present, expected, "per-phase shares must exist at every size the pins are held at");
    for (const result of artifact.results) {
        assert.ok(Number.isFinite(result.solver.velocityPlusPositionShare), `${result.count} share is not finite`);
        assert.ok(result.solver.velocityPlusPositionShare > 0 && result.solver.velocityPlusPositionShare < 1,
            `${result.count} solver share ${result.solver.velocityPlusPositionShare} is outside (0,1)`);
        assert.ok(Number.isFinite(result.sharesOfTimerSum.solveVelocities), `${result.count} velocity share`);
        assert.ok(Number.isFinite(result.sharesOfTimerSum.solvePositions), `${result.count} position share`);
        assert.equal(result.releaseFingerprint, result.fingerprint,
            `${result.count}: instrumented and release fingerprints must stay identical`);
        assert.equal(result.releaseContacts, result.contacts, `${result.count}: contact counts must match`);
    }
});

for (const result of artifact.results) {
    const split = result.sweepSubSplit;
    console.log(`phase_split_test: swept sub-split at ${result.count} boxes: sweepSort ${split.sweepSortMsPerStep.toFixed(5)} ms/step, pairLoop net of collide ${split.pairLoopNetOfCollideMsPerStep.toFixed(5)} ms/step, published broadphase bucket ${split.publishedBroadphaseBucketMsPerStep.toFixed(5)} ms/step, sort share of the bucket ${(split.sortShareOfBroadphaseBucket * 100).toFixed(2)} % against the ${(split.gatingFraction * 100).toFixed(2)} % gate: ${split.sortMeetsGatingFraction}`);
}

if (process.env.PHYSICS_PHASE_SPLIT_VERBOSE === "1") {
    console.table(DISJOINT_PHASE_KEYS.map((key) => ({
        phase: key,
        ms: fresh.phasesMsPerStep[key].toFixed(4),
        share: (fresh.sharesOfTimerSum[key] * 100).toFixed(2) + "%"
    })));
    console.log(JSON.stringify(fresh.clockProbe, null, 2));
}

console.log(`phase_split_test: ok (fresh 250 split: host ${fresh.hostMsPerStepInstrumented.toFixed(4)} ms/step, release ${fresh.hostMsPerStepRelease.toFixed(4)}, inflation ${fresh.clockProbe.measuredInflationMsPerStep.toFixed(4)}, sum error ${(fresh.sumVsStepTimeRelativeError * 100).toFixed(2)}%, collide share interval ${fresh.collideShareInterval.lowerShareOfTimerSum.toFixed(4)} .. ${fresh.collideShareInterval.upperShareOfTimerSum.toFixed(4)} with lowerClampFired ${fresh.collideShareInterval.lowerClampFired})`);
console.log(`phase_split_test: clock resolution context (fresh 250): threshold ${fresh.clockResolutionThreshold.thresholdMsPerStep.toFixed(7)} ms/step from ${fresh.clockResolutionThreshold.clockCallsPerThreshold} x ${fresh.clockResolutionThreshold.thresholdNanosecondsPerCall.toFixed(2)} ns/call, assembleConstraints ${fresh.phasesMsPerStep.assembleConstraints.toFixed(7)} ms/step classified sub ${fresh.subClockResolutionPhases.includes("assembleConstraints")}, above ${fresh.aboveClockResolutionPhases.includes("assembleConstraints")}, borderline ${fresh.borderlineClockResolutionPhases.includes("assembleConstraints")}; the class follows the host clock read in the run and is recorded, never pinned`);
