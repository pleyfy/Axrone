import {
    FIXED_DT,
    eventPairKey,
    quaternionAngle,
    type ParityScene,
    type RaySample,
    type RunResult,
    type StepEventBatch
} from "./scene";

export const POSITION_BASE_TOLERANCE = 1e-3;
export const POSITION_DRIFT_RATE = 0.5e-3;
export const VELOCITY_TOLERANCE = 5e-3;
export const ANGLE_TOLERANCE = 5e-4;
export const EVENT_BOUNDARY_ALLOWANCE_STEPS = 1;

export function positionToleranceAtStep(step: number): number {
    return POSITION_BASE_TOLERANCE + (step * FIXED_DT) * POSITION_DRIFT_RATE;
}

export interface ContactMismatch {
    readonly step: number;
    readonly missingInWasm: readonly string[];
    readonly extraInWasm: readonly string[];
}

export interface EventMismatch {
    readonly detail: string;
}

export interface RayMismatch {
    readonly step: number;
    readonly ray: number;
    readonly detail: string;
}

export interface ParityResult {
    readonly scene: string;
    readonly snapshotsCompared: number;
    readonly maxPosition: number;
    readonly firstPositionExceedStep: number | null;
    readonly worstPositionBody: number;
    readonly maxVelocity: number;
    readonly firstVelocityExceedStep: number | null;
    readonly maxAngularVelocity: number;
    readonly maxAngle: number;
    readonly firstAngleExceedStep: number | null;
    readonly positionPass: boolean;
    readonly velocityPass: boolean;
    readonly anglePass: boolean;
    readonly contactMismatches: readonly ContactMismatch[];
    readonly eventMismatches: readonly EventMismatch[];
    readonly eventBoundaryFlag: boolean;
    readonly rayMismatches: readonly RayMismatch[];
    readonly firstDivergenceStep: number | null;
}

function worstVectorDelta(a: readonly number[], b: readonly number[]): number {
    let worst = 0;
    for (let index = 0; index < a.length; index += 1) {
        worst = Math.max(worst, Math.abs(a[index] - b[index]));
    }
    return worst;
}

function pairsEqual(a: readonly (readonly number[])[], b: readonly (readonly number[])[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    for (let index = 0; index < a.length; index += 1) {
        if (a[index][0] !== b[index][0] || a[index][1] !== b[index][1]) {
            return false;
        }
    }
    return true;
}

function compareContacts(reference: RunResult, wasm: RunResult): ContactMismatch[] {
    const mismatches: ContactMismatch[] = [];
    const wasmByStep = new Map(wasm.snapshots.map((snapshot) => [snapshot.step, snapshot]));
    for (const referenceSnapshot of reference.snapshots) {
        const wasmSnapshot = wasmByStep.get(referenceSnapshot.step);
        if (wasmSnapshot === undefined) {
            throw new Error(`wasm run is missing snapshot step ${referenceSnapshot.step}`);
        }
        const referenceKeys = referenceSnapshot.contactPairs.map((pair) => `${pair[0]}-${pair[1]}`);
        const wasmKeys = wasmSnapshot.contactPairs.map((pair) => `${pair[0]}-${pair[1]}`);
        if (!pairsEqual(referenceSnapshot.contactPairs, wasmSnapshot.contactPairs)) {
            mismatches.push({
                step: referenceSnapshot.step,
                missingInWasm: referenceKeys.filter((key) => !wasmKeys.includes(key)),
                extraInWasm: wasmKeys.filter((key) => !referenceKeys.includes(key))
            });
        }
    }
    return mismatches;
}

interface EventWindow {
    begin: number;
    last: number;
}

type WindowsResult =
    | { readonly ok: true; readonly windows: Map<string, EventWindow[]> }
    | { readonly ok: false; readonly detail: string };

function isOpenKind(kind: string): boolean {
    return kind === "begin" || kind === "sensorEnter";
}

function isExtendKind(kind: string): boolean {
    return kind === "stay" || kind === "sensorStay";
}

const KIND_TRANSITION_ORDER: { [kind: string]: number } = {
    begin: 0,
    sensorEnter: 0,
    stay: 1,
    sensorStay: 1,
    end: 2,
    sensorExit: 2
};

function buildWindows(batches: readonly StepEventBatch[], lastStep: number): WindowsResult {
    const windows = new Map<string, EventWindow[]>();
    const open = new Map<string, EventWindow>();
    const sorted = [...batches].sort((a, b) => a.step - b.step);
    for (const batch of sorted) {
        const events = [...batch.events].sort((a, b) => {
            const keyOrder = eventPairKey(a).localeCompare(eventPairKey(b));
            if (keyOrder !== 0) {
                return keyOrder;
            }
            return (KIND_TRANSITION_ORDER[a.kind] ?? 0) - (KIND_TRANSITION_ORDER[b.kind] ?? 0);
        });
        for (const event of events) {
            const key = eventPairKey(event);
            const window = open.get(key);
            if (isOpenKind(event.kind)) {
                if (window !== undefined) {
                    return { ok: false, detail: `${key}: open at step ${batch.step} inside an already-open window` };
                }
                const created: EventWindow = { begin: batch.step, last: batch.step };
                open.set(key, created);
                const group = windows.get(key) ?? [];
                group.push(created);
                windows.set(key, group);
            } else if (isExtendKind(event.kind)) {
                if (window === undefined) {
                    return { ok: false, detail: `${key}: stay at step ${batch.step} without an open window` };
                }
                if (batch.step !== window.last + 1) {
                    return { ok: false, detail: `${key}: stay gap between steps ${window.last} and ${batch.step}` };
                }
                window.last = batch.step;
            } else {
                if (window === undefined) {
                    return { ok: false, detail: `${key}: close at step ${batch.step} without an open window` };
                }
                if (batch.step !== window.last + 1) {
                    return { ok: false, detail: `${key}: close gap between steps ${window.last} and ${batch.step}` };
                }
                window.last = batch.step;
                open.delete(key);
            }
        }
    }
    for (const [key, window] of open) {
        if (window.last !== lastStep) {
            return { ok: false, detail: `${key}: window left open while its events stopped at step ${window.last} before run end ${lastStep}` };
        }
        window.last = lastStep + 1;
    }
    return { ok: true, windows };
}

interface EventComparison {
    readonly mismatches: EventMismatch[];
    readonly boundaryFlag: boolean;
}

function compareEventStreams(reference: RunResult, wasm: RunResult, lastStep: number): EventComparison {
    const referenceWindows = buildWindows(reference.events, lastStep);
    const wasmWindows = buildWindows(wasm.events, lastStep);
    if (!referenceWindows.ok || !wasmWindows.ok) {
        return {
            boundaryFlag: false,
            mismatches: [{
                detail: `event window structure anomaly reference=[${referenceWindows.ok ? "ok" : referenceWindows.detail}] wasm=[${wasmWindows.ok ? "ok" : wasmWindows.detail}]`
            }]
        };
    }
    const referenceKeys = [...referenceWindows.windows.keys()].sort();
    const wasmKeys = [...wasmWindows.windows.keys()].sort();
    const missingKeys = referenceKeys.filter((key) => !wasmKeys.includes(key));
    const extraKeys = wasmKeys.filter((key) => !referenceKeys.includes(key));
    if (missingKeys.length > 0 || extraKeys.length > 0) {
        return {
            boundaryFlag: false,
            mismatches: [{
                detail: `pair-key set differs missingInWasm=[${missingKeys.join(",")}] extraInWasm=[${extraKeys.join(",")}]`
            }]
        };
    }
    const mismatches: EventMismatch[] = [];
    let boundaryFlag = false;
    for (const key of referenceKeys) {
        const referenceGroups = referenceWindows.windows.get(key) ?? [];
        const wasmGroups = wasmWindows.windows.get(key) ?? [];
        if (referenceGroups.length !== wasmGroups.length) {
            mismatches.push({
                detail: `${key}: window count reference=${referenceGroups.length} wasm=${wasmGroups.length}`
            });
            continue;
        }
        for (let index = 0; index < referenceGroups.length; index += 1) {
            const a = referenceGroups[index];
            const b = wasmGroups[index];
            const beginDelta = Math.abs(a.begin - b.begin);
            const endDelta = Math.abs(a.last - b.last);
            if (beginDelta > EVENT_BOUNDARY_ALLOWANCE_STEPS || endDelta > EVENT_BOUNDARY_ALLOWANCE_STEPS) {
                mismatches.push({
                    detail: `${key}: window reference=[${a.begin},${a.last}] wasm=[${b.begin},${b.last}] exceeds +/-1 step boundary allowance`
                });
            } else if (beginDelta > 0 || endDelta > 0) {
                boundaryFlag = true;
            }
        }
    }
    return { mismatches, boundaryFlag };
}

function compareRays(reference: RunResult, wasm: RunResult): RayMismatch[] {
    const mismatches: RayMismatch[] = [];
    const key = (sample: RaySample): string => `${sample.step}:${sample.ray}`;
    const wasmByKey = new Map(wasm.rays.map((sample) => [key(sample), sample]));
    for (const referenceSample of reference.rays) {
        const wasmSample = wasmByKey.get(key(referenceSample));
        if (wasmSample === undefined) {
            mismatches.push({
                step: referenceSample.step,
                ray: referenceSample.ray,
                detail: "wasm run did not produce this ray sample"
            });
            continue;
        }
        if (referenceSample.hits.length !== wasmSample.hits.length) {
            mismatches.push({
                step: referenceSample.step,
                ray: referenceSample.ray,
                detail: `hit count reference=${referenceSample.hits.length} wasm=${wasmSample.hits.length}`
            });
            continue;
        }
        const tolerance = positionToleranceAtStep(referenceSample.step);
        referenceSample.hits.forEach((referenceHit, index) => {
            const wasmHit = wasmSample.hits[index];
            if (referenceHit.body !== wasmHit.body || referenceHit.shapeOrdinal !== wasmHit.shapeOrdinal) {
                mismatches.push({
                    step: referenceSample.step,
                    ray: referenceSample.ray,
                    detail: `hit ${index} identity reference=body ${referenceHit.body} shape ${referenceHit.shapeOrdinal} wasm=body ${wasmHit.body} shape ${wasmHit.shapeOrdinal}`
                });
                return;
            }
            const distanceDelta = Math.abs(referenceHit.distance - wasmHit.distance);
            if (distanceDelta > tolerance) {
                mismatches.push({
                    step: referenceSample.step,
                    ray: referenceSample.ray,
                    detail: `hit ${index} distance delta ${distanceDelta.toExponential(3)} exceeds ${tolerance}`
                });
            }
            const pointDelta = worstVectorDelta(referenceHit.point, wasmHit.point);
            if (pointDelta > tolerance) {
                mismatches.push({
                    step: referenceSample.step,
                    ray: referenceSample.ray,
                    detail: `hit ${index} point delta ${pointDelta.toExponential(3)} exceeds ${tolerance}`
                });
            }
            const normalDelta = worstVectorDelta(referenceHit.normal, wasmHit.normal);
            if (normalDelta > VELOCITY_TOLERANCE) {
                mismatches.push({
                    step: referenceSample.step,
                    ray: referenceSample.ray,
                    detail: `hit ${index} normal delta ${normalDelta.toExponential(3)} exceeds ${VELOCITY_TOLERANCE}`
                });
            }
        });
    }
    for (const wasmSample of wasm.rays) {
        if (!reference.rays.some((sample) => key(sample) === key(wasmSample))) {
            mismatches.push({
                step: wasmSample.step,
                ray: wasmSample.ray,
                detail: "reference run did not produce this ray sample"
            });
        }
    }
    return mismatches;
}

export function compareRuns(scene: ParityScene, reference: RunResult, wasm: RunResult): ParityResult {
    let maxPosition = 0;
    let maxVelocity = 0;
    let maxAngularVelocity = 0;
    let maxAngle = 0;
    let worstPositionBody = -1;
    let firstPositionExceedStep: number | null = null;
    let firstVelocityExceedStep: number | null = null;
    let firstAngleExceedStep: number | null = null;

    const wasmByStep = new Map(wasm.snapshots.map((snapshot) => [snapshot.step, snapshot]));
    for (const referenceSnapshot of reference.snapshots) {
        const wasmSnapshot = wasmByStep.get(referenceSnapshot.step);
        if (wasmSnapshot === undefined) {
            throw new Error(`wasm run is missing snapshot step ${referenceSnapshot.step}`);
        }
        if (referenceSnapshot.bodies.length !== wasmSnapshot.bodies.length) {
            throw new Error(`body count mismatch at step ${referenceSnapshot.step}`);
        }
        const tolerance = positionToleranceAtStep(referenceSnapshot.step);
        referenceSnapshot.bodies.forEach((referenceBody, bodyIndex) => {
            const wasmBody = wasmSnapshot.bodies[bodyIndex];
            const positionDelta = worstVectorDelta(referenceBody.position, wasmBody.position);
            if (positionDelta > maxPosition) {
                maxPosition = positionDelta;
                worstPositionBody = bodyIndex;
            }
            if (positionDelta > tolerance && firstPositionExceedStep === null) {
                firstPositionExceedStep = referenceSnapshot.step;
            }
            const velocityDelta = worstVectorDelta(referenceBody.velocity, wasmBody.velocity);
            const angularDelta = worstVectorDelta(referenceBody.angularVelocity, wasmBody.angularVelocity);
            maxVelocity = Math.max(maxVelocity, velocityDelta);
            maxAngularVelocity = Math.max(maxAngularVelocity, angularDelta);
            if (Math.max(velocityDelta, angularDelta) > VELOCITY_TOLERANCE && firstVelocityExceedStep === null) {
                firstVelocityExceedStep = referenceSnapshot.step;
            }
            const angle = quaternionAngle(referenceBody.rotation, wasmBody.rotation);
            if (angle > maxAngle) {
                maxAngle = angle;
            }
            if (angle > ANGLE_TOLERANCE && firstAngleExceedStep === null) {
                firstAngleExceedStep = referenceSnapshot.step;
            }
        });
    }

    const contactMismatches = compareContacts(reference, wasm);
    const eventComparison = compareEventStreams(reference, wasm, scene.steps);
    const rayMismatches = compareRays(reference, wasm);
    const firstExceedSteps: (number | null)[] = [firstPositionExceedStep, firstVelocityExceedStep, firstAngleExceedStep];
    const exceedSteps = firstExceedSteps.filter((step): step is number => step !== null);

    return {
        scene: scene.name,
        snapshotsCompared: reference.snapshots.length,
        maxPosition,
        firstPositionExceedStep,
        worstPositionBody,
        maxVelocity,
        firstVelocityExceedStep,
        maxAngularVelocity,
        maxAngle,
        firstAngleExceedStep,
        positionPass: firstPositionExceedStep === null,
        velocityPass: firstVelocityExceedStep === null,
        anglePass: firstAngleExceedStep === null,
        contactMismatches,
        eventMismatches: eventComparison.mismatches,
        eventBoundaryFlag: eventComparison.boundaryFlag,
        rayMismatches,
        firstDivergenceStep: exceedSteps.length === 0 ? null : Math.min(...exceedSteps)
    };
}

export function describeMismatches(result: ParityResult, limit = 5): string[] {
    const lines: string[] = [];
    for (const mismatch of result.contactMismatches.slice(0, limit)) {
        lines.push(`contacts@${mismatch.step}: missing=[${mismatch.missingInWasm.join(",")}] extra=[${mismatch.extraInWasm.join(",")}]`);
    }
    if (result.contactMismatches.length > limit) {
        lines.push(`contacts: +${result.contactMismatches.length - limit} more mismatching snapshots`);
    }
    for (const mismatch of result.eventMismatches.slice(0, limit)) {
        lines.push(`events: ${mismatch.detail}`);
    }
    if (result.eventMismatches.length > limit) {
        lines.push(`events: +${result.eventMismatches.length - limit} more`);
    }
    for (const mismatch of result.rayMismatches.slice(0, limit)) {
        lines.push(`rays@${mismatch.step}/${mismatch.ray}: ${mismatch.detail}`);
    }
    if (result.rayMismatches.length > limit) {
        lines.push(`rays: +${result.rayMismatches.length - limit} more`);
    }
    return lines;
}
