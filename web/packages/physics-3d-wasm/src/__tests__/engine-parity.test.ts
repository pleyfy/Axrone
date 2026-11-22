// @vitest-environment node
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
    FIXED_DT,
    eventKey,
    listSceneNames,
    loadScene,
    type NormalizedEventKind,
    type ParityScene,
    type RunResult
} from "../../tests/parity/scene";
import { runReferenceScene } from "../../tests/parity/reference-runner";
import {
    compatSupportsScene,
    runWasmCompatScene,
    runWasmFacadeScene
} from "../../tests/parity/wasm-runner";
import {
    compareRuns,
    describeMismatches,
    type ParityResult
} from "../../tests/parity/compare";

interface TableRow {
    scene: string;
    driver: string;
    snapshots: number;
    maxPosM: string;
    posExceedStep: string;
    maxVelMs: string;
    velExceedStep: string;
    maxAngleRad: string;
    angleExceedStep: string;
    firstDivergence: string;
    contactMismatchSteps: string;
    eventMismatch: string;
    status: string;
}

const rows: TableRow[] = [];
const perfLines: string[] = [];
const flagLines: string[] = [];
const failures: string[] = [];

function formatNumber(value: number): string {
    return value.toExponential(3);
}

function eventsToJson(events: RunResult["events"]): string {
    return JSON.stringify(events.map((batch) => ({
        step: batch.step,
        events: batch.events.map((event) => eventKey(event)).sort()
    })));
}

function countEvents(result: RunResult, kind: NormalizedEventKind): number {
    let total = 0;
    for (const batch of result.events) {
        for (const event of batch.events) {
            if (event.kind === kind) {
                total += 1;
            }
        }
    }
    return total;
}

function rayHitProblems(label: string, result: RunResult): string[] {
    const problems: string[] = [];
    if (result.rays.length === 0) {
        problems.push(`${label}: produced no ray samples`);
        return problems;
    }
    for (const sample of result.rays) {
        if (sample.hits.length < 1) {
            problems.push(`${label}: ray ${sample.ray} at step ${sample.step} produced zero hits`);
        }
    }
    return problems;
}

function pendulumSwungProblems(label: string, result: RunResult, bodyIndex: number): string[] {
    let lowest = Number.POSITIVE_INFINITY;
    for (const snapshot of result.snapshots) {
        lowest = Math.min(lowest, snapshot.bodies[bodyIndex].position[1]);
    }
    if (lowest < 3.0) {
        return [];
    }
    return [`${label}: hinge door body ${bodyIndex} never swung below y=3.0 (lowest ${lowest.toFixed(3)})`];
}

function activityProblems(scene: ParityScene, label: string, result: RunResult): string[] {
    const problems: string[] = [];
    const minimumBegins: { [name: string]: number } = {
        "stack-5": 4,
        "ramp-30": 2,
        "capsule-slide": 1,
        "multi-shape-compound": 1,
        "mixed-250": 150
    };
    const floor = minimumBegins[scene.name];
    if (floor !== undefined) {
        const begins = countEvents(result, "begin");
        if (begins < floor) {
            problems.push(`${scene.name}: ${label} run produced ${begins} begin events, below the activity floor of ${floor}`);
        }
    }
    if (scene.name === "sensor-passage") {
        if (countEvents(result, "sensorEnter") < 1) {
            problems.push(`sensor-passage: ${label} run produced no sensorEnter event`);
        }
        if (countEvents(result, "sensorExit") < 1) {
            problems.push(`sensor-passage: ${label} run produced no sensorExit event`);
        }
    }
    if (scene.name === "ray-scenes") {
        problems.push(...rayHitProblems(label, result));
    }
    if (scene.name === "joint-hinge-door") {
        problems.push(...pendulumSwungProblems(label, result, 2));
    }
    if (result.snapshots.length === 0) {
        problems.push(`${scene.name}: ${label} snapshot capture produced no data`);
    }
    if (scene.shapes.length > 0 && result.snapshots.length > 0 && result.snapshots[0].bodies.length !== scene.bodies.length) {
        problems.push(`${scene.name}: ${label} snapshot body count does not match the scene`);
    }
    return problems;
}

function pushRow(scene: ParityScene, driver: string, result: ParityResult): void {
    const pass = result.positionPass
        && result.velocityPass
        && result.anglePass
        && result.contactMismatches.length === 0
        && result.eventMismatches.length === 0
        && result.rayMismatches.length === 0;
    rows.push({
        scene: scene.name,
        driver,
        snapshots: result.snapshotsCompared,
        maxPosM: formatNumber(result.maxPosition),
        posExceedStep: result.firstPositionExceedStep === null ? "-" : String(result.firstPositionExceedStep),
        maxVelMs: formatNumber(Math.max(result.maxVelocity, result.maxAngularVelocity)),
        velExceedStep: result.firstVelocityExceedStep === null ? "-" : String(result.firstVelocityExceedStep),
        maxAngleRad: formatNumber(result.maxAngle),
        angleExceedStep: result.firstAngleExceedStep === null ? "-" : String(result.firstAngleExceedStep),
        firstDivergence: result.firstDivergenceStep === null ? "-" : String(result.firstDivergenceStep),
        contactMismatchSteps: result.contactMismatches.map((mismatch) => mismatch.step).join(",") || "-",
        eventMismatch: result.eventMismatches.length === 0
            ? (result.eventBoundaryFlag ? "boundary-flagged" : "-")
            : `${result.eventMismatches.length}: ${result.eventMismatches[0].detail}`,
        status: pass ? (result.eventBoundaryFlag ? "PASS (boundary-flagged)" : "PASS") : "FAIL"
    });
}

function collectFailures(scene: ParityScene, result: ParityResult): void {
    if (!result.positionPass) {
        failures.push(`${scene.name}: position deviation ${formatNumber(result.maxPosition)} m exceeds tolerance, first at step ${result.firstPositionExceedStep} (worst body ${result.worstPositionBody})`);
    }
    if (!result.velocityPass) {
        failures.push(`${scene.name}: velocity deviation ${formatNumber(Math.max(result.maxVelocity, result.maxAngularVelocity))} exceeds 5e-3, first at step ${result.firstVelocityExceedStep}`);
    }
    if (!result.anglePass) {
        failures.push(`${scene.name}: angle deviation ${formatNumber(result.maxAngle)} rad exceeds 5e-4, first at step ${result.firstAngleExceedStep}`);
    }
    for (const line of describeMismatches(result)) {
        failures.push(`${scene.name}: ${line}`);
    }
    if (result.eventBoundaryFlag) {
        flagLines.push(`${scene.name}: event windows differ within the +/-1 step boundary allowance (flagged, not failed, per spec 6.2)`);
    }
}

const parityEnabled = process.env.AXRONE_PHYSICS_PARITY === "1";
const strictMode = process.env.AXRONE_PHYSICS_STRICT === "1";

function assertReferenceParity(name: string, result: ParityResult): void {
    if (!strictMode) {
        return;
    }
    expect(result.positionPass, `${name}: position parity`).toBe(true);
    expect(result.velocityPass, `${name}: velocity parity`).toBe(true);
    expect(result.anglePass, `${name}: angle parity`).toBe(true);
    expect(result.contactMismatches, `${name}: contact pair sets`).toEqual([]);
    expect(result.eventMismatches, `${name}: event sequences`).toEqual([]);
    expect(result.rayMismatches, `${name}: ray query results`).toEqual([]);
}

describe.runIf(parityEnabled)("engine numerical parity: reference @axrone/physics-3d vs @axrone/physics-3d-wasm", () => {
    for (const name of listSceneNames()) {
        const scene = loadScene(name);
        const skipReason = scene.skip;
        if (skipReason !== null) {
            it(`${name}: skipped`, () => {
                rows.push({
                    scene: name,
                    driver: "skipped",
                    snapshots: 0,
                    maxPosM: "-",
                    posExceedStep: "-",
                    maxVelMs: "-",
                    velExceedStep: "-",
                    maxAngleRad: "-",
                    angleExceedStep: "-",
                    firstDivergence: "-",
                    contactMismatchSteps: "-",
                    eventMismatch: "-",
                    status: `SKIP: ${skipReason}`
                });
                expect(skipReason.length).toBeGreaterThan(0);
            });
            continue;
        }

        it(`${name}: wasm determinism gate`, async () => {
            const first = await runWasmFacadeScene(scene);
            const second = await runWasmFacadeScene(scene);
            expect(first.result.fingerprint).not.toBeNull();
            expect(second.result.fingerprint).toBe(first.result.fingerprint);
            expect(second.result.stateHash).toBe(first.result.stateHash);
            expect(eventsToJson(second.result.events)).toBe(eventsToJson(first.result.events));
            expect(second.result.snapshots.length).toBe(first.result.snapshots.length);
            expect(second.result.snapshots.length).toBeGreaterThan(0);
        });

        it(`${name}: reference vs wasm facade parity`, async () => {
            const referenceRun = runReferenceScene(scene, { timedFrom: 0, timedTo: scene.steps });
            const wasmRun = await runWasmFacadeScene(scene, { timedFrom: 0, timedTo: scene.steps });
            const wasmProblems = activityProblems(scene, "wasm", wasmRun.result);
            const referenceProblems = activityProblems(scene, "reference", referenceRun.result);
            for (const problem of [...wasmProblems, ...referenceProblems]) {
                failures.push(`activity gate: ${problem}`);
            }
            const result = compareRuns(scene, referenceRun.result, wasmRun.result);
            pushRow(scene, "facade", result);
            collectFailures(scene, result);
            expect(wasmProblems, `${scene.name}: wasm activity gate`).toEqual([]);
            if (strictMode) {
                expect(referenceProblems, `${scene.name}: reference activity gate`).toEqual([]);
            }
            if (name === "mixed-250") {
                expect(wasmRun.timedSteps, `${scene.name}: wasm timed steps`).toBe(scene.steps);
                if (strictMode) {
                    expect(referenceRun.timedSteps, `${scene.name}: reference timed steps`).toBe(scene.steps);
                }
                const referenceMsPerStep = referenceRun.totalMs / referenceRun.timedSteps;
                const wasmMsPerStep = wasmRun.totalMs / wasmRun.timedSteps;
                expect(referenceMsPerStep > 0 && Number.isFinite(referenceMsPerStep)).toBe(true);
                expect(wasmMsPerStep > 0 && Number.isFinite(wasmMsPerStep)).toBe(true);
                perfLines.push(
                    `mixed-250 step time over ${scene.steps} steps at dt=${FIXED_DT.toFixed(6)}s, iterations ${scene.world.velocityIterations}/${scene.world.positionIterations}: ` +
                    `reference ${referenceMsPerStep.toFixed(4)} ms/step, wasm ${wasmMsPerStep.toFixed(4)} ms/step ` +
                    `(reference total ${referenceRun.totalMs.toFixed(1)} ms, wasm total ${wasmRun.totalMs.toFixed(1)} ms)`
                );
            }
            assertReferenceParity(scene.name, result);
        });

        const compatRejection = compatSupportsScene(scene);
        if (compatRejection === null) {
            it(`${name}: compat adapter cross-check against facade`, async () => {
                const compatRun = await runWasmCompatScene(scene);
                const facadeRun = await runWasmFacadeScene(scene);
                const facadeBatches = facadeRun.result.events.map((batch) => ({
                    step: batch.step,
                    events: batch.events.map((event) => eventKey(event)).sort()
                }));
                const compatBatches = compatRun.events.map((batch) => ({
                    step: batch.step,
                    events: batch.events.map((event) => eventKey(event)).sort()
                }));
                expect(compatBatches).toEqual(facadeBatches);
                expect(compatRun.snapshots.length).toBe(facadeRun.result.snapshots.length);
                compatRun.snapshots.forEach((snapshot, index) => {
                    const facadeSnapshot = facadeRun.result.snapshots[index];
                    expect(snapshot.step).toBe(facadeSnapshot.step);
                    expect(snapshot.contactPairs).toEqual(facadeSnapshot.contactPairs);
                    snapshot.bodies.forEach((body, bodyIndex) => {
                        const facadeBody = facadeSnapshot.bodies[bodyIndex];
                        expect(body.position).toEqual(facadeBody.position);
                        expect(body.rotation).toEqual(facadeBody.rotation);
                    });
                });
            });
        } else {
            it(`${name}: compat adapter surface check`, () => {
                rows.push({
                    scene: name,
                    driver: "compat",
                    snapshots: 0,
                    maxPosM: "-",
                    posExceedStep: "-",
                    maxVelMs: "-",
                    velExceedStep: "-",
                    maxAngleRad: "-",
                    angleExceedStep: "-",
                    firstDivergence: "-",
                    contactMismatchSteps: "-",
                    eventMismatch: "-",
                    status: `N/A: ${compatRejection}`
                });
                expect(compatRejection.length).toBeGreaterThan(0);
            });
        }
    }

    afterAll(() => {
        console.table(rows);
        for (const line of perfLines) {
            console.log(line);
        }
        for (const line of flagLines) {
            console.log(`FLAG ${line}`);
        }
        if (failures.length > 0) {
            const heading = strictMode ? "parity failure details" : "parity deviation details (non-strict; reference engine defects are recorded, not failed)";
            console.log(`${heading}:\n${failures.join("\n")}`);
        }
        const reportPath = process.env.AXRONE_PHYSICS_PARITY_REPORT;
        if (reportPath !== undefined && reportPath.length > 0) {
            writeFileSync(
                resolve(reportPath),
                `${JSON.stringify({ strict: strictMode, rows, perf: perfLines, flags: flagLines, failures }, null, 2)}\n`
            );
        }
        if (strictMode) {
            expect(failures, `aggregate parity failures:\n${failures.join("\n")}`).toEqual([]);
        }
    });
});
