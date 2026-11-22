import { WasmPhysicsWorld3D } from "../../src/world";
import { WasmPhysicsWorld3DCompat } from "../../src/compat";
import type { CompatContactListener } from "../../src/compat";
import type { ContactEventKind, RaycastHit } from "../../src/types";
import {
    FIXED_DT,
    eventKindCode,
    fnv1a64Hex,
    hashRunState,
    normalizeDirection,
    shapeHalfSegment,
    type NormalizedEvent,
    type ParityScene,
    type RaySample,
    type RunResult,
    type SceneBody,
    type SceneShape,
    type StepEventBatch,
    type StepSnapshot
} from "./scene";

const KIND_BY_EVENT: Record<ContactEventKind, NormalizedEvent["kind"]> = {
    begin: "begin",
    stay: "stay",
    end: "end",
    sensorEnter: "sensorEnter",
    sensorStay: "sensorStay",
    sensorExit: "sensorExit"
};

export function compatSupportsScene(scene: ParityScene): string | null {
    if (scene.joints.length > 0) {
        return "scene has joints; the compat adapter exposes no constraint surface";
    }
    if (scene.rays.length > 0) {
        return "scene has ray queries; the compat adapter exposes no query surface";
    }
    for (const [index, body] of scene.bodies.entries()) {
        if (body.velocity !== undefined || body.angularVelocity !== undefined) {
            return `body ${index} has an initial velocity; the compat adapter cannot set velocities`;
        }
        if (body.damping !== undefined || body.gravityScale !== undefined) {
            return `body ${index} has damping or gravityScale; the compat adapter cannot set them`;
        }
    }
    for (const [index, shape] of scene.shapes.entries()) {
        if (shape.filter !== undefined) {
            return `shape ${index} has a collision filter; the compat adapter cannot set filters`;
        }
        if (shape.rotation !== undefined && shape.kind !== "box") {
            return `shape ${index} uses a per-shape rotation on a non-box kind; the reference engine has no such field`;
        }
    }
    return null;
}

interface PairTracker {
    readonly livePairs: Set<string>;
}

function trackPair(tracker: PairTracker, kind: NormalizedEvent["kind"], lo: number, hi: number): void {
    const key = `${lo}-${hi}`;
    if (kind === "begin" || kind === "stay") {
        tracker.livePairs.add(key);
    } else if (kind === "end") {
        tracker.livePairs.delete(key);
    }
}

function snapshotContactPairs(tracker: PairTracker): (readonly [number, number])[] {
    const pairs: (readonly [number, number])[] = [];
    for (const key of tracker.livePairs) {
        const separator = key.indexOf("-");
        pairs.push([Number(key.slice(0, separator)), Number(key.slice(separator + 1))]);
    }
    pairs.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    return pairs;
}

function shapeOrdinalForIndex(shapes: readonly SceneShape[], shapeIndex: number): number {
    const body = shapes[shapeIndex].body;
    let ordinal = 0;
    for (let index = 0; index < shapeIndex; index += 1) {
        if (shapes[index].body === body) {
            ordinal += 1;
        }
    }
    return ordinal;
}

function tuple3(value: readonly [number, number, number]): [number, number, number] {
    return [value[0], value[1], value[2]];
}

function tuple4(value: readonly [number, number, number, number]): [number, number, number, number] {
    return [value[0], value[1], value[2], value[3]];
}

function attachFacadeShape(world: WasmPhysicsWorld3D, bodyId: number, shape: SceneShape): number {
    const center = shape.center ?? [0, 0, 0];
    const rotation = shape.rotation ?? [0, 0, 0, 1];
    if (shape.kind === "sphere") {
        if (shape.radius === undefined || shape.radius <= 0) {
            throw new Error("sphere shape requires positive radius");
        }
        return world.addSphere(bodyId, shape.radius, 1, tuple3(center));
    }
    if (shape.kind === "box") {
        if (shape.halfExtents === undefined) {
            throw new Error("box shape requires halfExtents");
        }
        return world.addBox(bodyId, tuple3(shape.halfExtents), 1, tuple3(center), tuple4(rotation));
    }
    if (shape.kind === "capsule") {
        if (shape.radius === undefined || shape.height === undefined) {
            throw new Error("capsule shape requires radius and height");
        }
        return world.attachCapsule(bodyId, {
            radius: shape.radius,
            halfSegment: shapeHalfSegment(shape),
            density: 1,
            offset: tuple3(center),
            rotation: tuple4(rotation)
        });
    }
    if (shape.radius === undefined || shape.height === undefined) {
        throw new Error("cylinder shape requires radius and height");
    }
    return world.attachCylinder(bodyId, {
        radius: shape.radius,
        halfHeight: shape.height / 2,
        density: 1,
        offset: tuple3(center),
        rotation: tuple4(rotation)
    });
}

function facadeBodyType(body: SceneBody): "static" | "dynamic" | "kinematic" {
    return body.type === 0 ? "static" : body.type === 1 ? "kinematic" : "dynamic";
}

function captureFacadeRays(
    world: WasmPhysicsWorld3D,
    scene: ParityScene,
    step: number,
    bodyIndexById: Map<number, number>,
    shapeIndexById: Map<number, number>,
    rays: RaySample[]
): void {
    scene.rays.forEach((ray, rayIndex) => {
        if (ray.atStep !== step) {
            return;
        }
        const direction = normalizeDirection(ray.direction);
        const hits: RaycastHit[] = world.raycast(tuple3(ray.origin), direction, ray.maxDistance);
        const mapped = hits.map((hit) => {
            const bodyIndex = bodyIndexById.get(hit.body);
            const shapeIndex = shapeIndexById.get(hit.shape);
            if (bodyIndex === undefined || shapeIndex === undefined) {
                throw new Error("wasm ray query reported an unknown entity");
            }
            return {
                body: bodyIndex,
                shapeOrdinal: shapeOrdinalForIndex(scene.shapes, shapeIndex),
                distance: hit.distance,
                point: tuple3(hit.point),
                normal: tuple3(hit.normal)
            };
        });
        mapped.sort((a, b) => a.distance - b.distance);
        rays.push({ step, ray: rayIndex, hits: mapped });
    });
}

export interface WasmRunOptions {
    readonly timedFrom?: number;
    readonly timedTo?: number;
}

export interface TimedWasmRun {
    readonly result: RunResult;
    readonly timedSteps: number;
    readonly totalMs: number;
}

export async function runWasmFacadeScene(scene: ParityScene, options: WasmRunOptions = {}): Promise<TimedWasmRun> {
    const world = await WasmPhysicsWorld3D.create({
        maxBodies: scene.world.maxBodies,
        maxContacts: scene.world.maxContacts,
        gravity: tuple3(scene.world.gravity)
    });
    world.setAllowSleep(scene.world.allowSleep);

    const bodyIds: number[] = [];
    const bodyIndexById = new Map<number, number>();
    const shapeIndexById = new Map<number, number>();
    for (const [index, body] of scene.bodies.entries()) {
        const rotation = body.rotation ?? [0, 0, 0, 1];
        const bodyId = world.createBody({
            type: facadeBodyType(body),
            position: tuple3(body.position),
            rotation: tuple4(rotation)
        });
        bodyIndexById.set(bodyId, index);
        bodyIds.push(bodyId);
    }
    scene.shapes.forEach((shape, shapeIndex) => {
        const shapeId = attachFacadeShape(world, bodyIds[shape.body], shape);
        shapeIndexById.set(shapeId, shapeIndex);
        world.setShapeMaterial(shapeId, shape.material.friction, shape.material.restitution);
        if (shape.isSensor === true) {
            world.setShapeSensor(shapeId, true);
        }
        if (shape.filter !== undefined) {
            world.setShapeFilter(shapeId, shape.filter[0], shape.filter[1], shape.filter[2]);
        }
    });
    for (const [index, body] of scene.bodies.entries()) {
        const bodyId = bodyIds[index];
        if (body.type !== 0 && body.velocity !== undefined) {
            world.setVelocity(bodyId, tuple3(body.velocity));
        }
        if (body.type !== 0 && body.angularVelocity !== undefined) {
            world.setAngularVelocity(bodyId, tuple3(body.angularVelocity));
        }
        if (body.damping !== undefined) {
            world.setDamping(bodyId, body.damping[0], body.damping[1]);
        }
        if (body.gravityScale !== undefined) {
            world.setGravityScale(bodyId, body.gravityScale);
        }
    }
    for (const joint of scene.joints) {
        const bodyA = bodyIds[joint.bodyA];
        const bodyB = bodyIds[joint.bodyB];
        const collideConnected = joint.collideConnected === true;
        if (joint.type === "fixed") {
            world.createFixedJoint(bodyA, bodyB, {
                localAnchorA: tuple3(joint.localAnchorA),
                localAnchorB: tuple3(joint.localAnchorB),
                collideConnected
            });
        } else if (joint.type === "hinge") {
            if (joint.localAxisA === undefined || joint.localAxisB === undefined) {
                throw new Error("hinge joints require localAxisA and localAxisB");
            }
            world.createHingeJoint(bodyA, bodyB, {
                localAnchorA: tuple3(joint.localAnchorA),
                localAnchorB: tuple3(joint.localAnchorB),
                localAxisA: tuple3(joint.localAxisA),
                localAxisB: tuple3(joint.localAxisB),
                enableLimit: joint.enableLimit === true,
                lowerLimit: joint.lowerLimit ?? 0,
                upperLimit: joint.upperLimit ?? 0,
                enableMotor: joint.enableMotor === true,
                motorSpeed: joint.motorSpeed ?? 0,
                maxMotorTorque: joint.maxMotorTorque ?? 0,
                collideConnected
            });
        } else if (joint.type === "slider") {
            if (joint.localAxisA === undefined) {
                throw new Error("slider joints require localAxisA");
            }
            world.createSliderJoint(bodyA, bodyB, {
                localAnchorA: tuple3(joint.localAnchorA),
                localAnchorB: tuple3(joint.localAnchorB),
                localAxisA: tuple3(joint.localAxisA),
                enableLimit: joint.enableLimit === true,
                lowerLimit: joint.lowerLimit ?? 0,
                upperLimit: joint.upperLimit ?? 0,
                enableMotor: joint.enableMotor === true,
                motorSpeed: joint.motorSpeed ?? 0,
                maxMotorForce: joint.maxMotorForce ?? 0,
                collideConnected
            });
        } else {
            world.createSpringJoint(bodyA, bodyB, {
                localAnchorA: tuple3(joint.localAnchorA),
                localAnchorB: tuple3(joint.localAnchorB),
                restLength: joint.restLength ?? 1,
                stiffness: joint.stiffness ?? 10,
                damping: joint.damping ?? 0.5,
                collideConnected
            });
        }
    }

    const tracker: PairTracker = { livePairs: new Set() };
    const snapshots: StepSnapshot[] = [];
    const events: StepEventBatch[] = [];
    const rays: RaySample[] = [];
    let timedSteps = 0;
    let totalMs = 0;
    const timedFrom = options.timedFrom ?? -1;
    const timedTo = options.timedTo ?? -1;

    captureFacadeRays(world, scene, 0, bodyIndexById, shapeIndexById, rays);
    for (let step = 1; step <= scene.steps; step += 1) {
        const timed = step > timedFrom && step <= timedTo;
        const started = timed ? performance.now() : 0;
        world.step(FIXED_DT, {
            velocityIterations: scene.world.velocityIterations,
            positionIterations: scene.world.positionIterations
        });
        if (timed) {
            totalMs += performance.now() - started;
            timedSteps += 1;
        }
        const batch: NormalizedEvent[] = [];
        for (const event of world.drainEvents()) {
            const bodyA = bodyIndexById.get(event.bodyA);
            const bodyB = bodyIndexById.get(event.bodyB);
            const shapeA = shapeIndexById.get(event.shapeA);
            const shapeB = shapeIndexById.get(event.shapeB);
            if (bodyA === undefined || bodyB === undefined || shapeA === undefined || shapeB === undefined) {
                throw new Error("wasm engine reported an event for an unknown scene entity");
            }
            const kind = KIND_BY_EVENT[event.kind];
            batch.push({
                kind,
                bodyLo: Math.min(bodyA, bodyB),
                bodyHi: Math.max(bodyA, bodyB),
                shapeLo: Math.min(shapeA, shapeB),
                shapeHi: Math.max(shapeA, shapeB)
            });
            trackPair(tracker, kind, Math.min(bodyA, bodyB), Math.max(bodyA, bodyB));
        }
        if (batch.length > 0) {
            events.push({ step, events: batch });
        }
        if (step % scene.snapshotEvery === 0 || step === scene.steps) {
            snapshots.push({
                step,
                bodies: bodyIds.map((bodyId) => {
                    const transform = world.readTransform(bodyId);
                    return {
                        position: tuple3(transform.position),
                        rotation: tuple4(transform.rotation),
                        velocity: tuple3(world.readVelocity(bodyId)),
                        angularVelocity: tuple3(world.readAngularVelocity(bodyId))
                    };
                }),
                contactPairs: snapshotContactPairs(tracker)
            });
            captureFacadeRays(world, scene, step, bodyIndexById, shapeIndexById, rays);
        }
    }
    const fingerprint = world.fingerprint();
    world.dispose();

    const partial: RunResult = { snapshots, events, rays, fingerprint, stateHash: "" };
    return {
        result: { ...partial, stateHash: hashRunState(partial) },
        timedSteps,
        totalMs
    };
}

export interface CompatBodyState {
    readonly position: readonly [number, number, number];
    readonly rotation: readonly [number, number, number, number];
}

export interface CompatStepSnapshot {
    readonly step: number;
    readonly bodies: readonly CompatBodyState[];
    readonly contactPairs: readonly (readonly [number, number])[];
}

export interface CompatRunResult {
    readonly snapshots: readonly CompatStepSnapshot[];
    readonly events: readonly StepEventBatch[];
    readonly stateHash: string;
}

function hashCompatRun(snapshots: readonly CompatStepSnapshot[], events: readonly StepEventBatch[]): string {
    const samples: number[] = [];
    for (const snapshot of snapshots) {
        samples.push(snapshot.step);
        for (const pair of snapshot.contactPairs) {
            samples.push(-1 - pair[0], -1 - pair[1]);
        }
        for (const body of snapshot.bodies) {
            samples.push(
                body.position[0], body.position[1], body.position[2],
                body.rotation[0], body.rotation[1], body.rotation[2], body.rotation[3]
            );
        }
    }
    for (const batch of events) {
        samples.push(batch.step);
        for (const event of batch.events) {
            samples.push(eventKindCode(event.kind), event.bodyLo, event.bodyHi, event.shapeLo, event.shapeHi);
        }
    }
    const buffer = new ArrayBuffer(samples.length * 8);
    const view = new DataView(buffer);
    samples.forEach((value, index) => view.setFloat64(index * 8, value, true));
    return fnv1a64Hex(new Uint8Array(buffer));
}

export async function runWasmCompatScene(scene: ParityScene): Promise<CompatRunResult> {
    const rejection = compatSupportsScene(scene);
    if (rejection !== null) {
        throw new Error(`scene ${scene.name} is outside the compat surface: ${rejection}`);
    }
    const world = await WasmPhysicsWorld3DCompat.create({
        gravity: {
            x: scene.world.gravity[0],
            y: scene.world.gravity[1],
            z: scene.world.gravity[2]
        },
        maxBodies: scene.world.maxBodies,
        maxContacts: scene.world.maxContacts
    });

    const bodyIds: number[] = [];
    const bodyIndexById = new Map<number, number>();
    const shapeIndexById = new Map<number, number>();
    for (const [index, body] of scene.bodies.entries()) {
        const rotation = body.rotation ?? [0, 0, 0, 1];
        const bodyId = world.createBody({
            type: body.type,
            position: { x: body.position[0], y: body.position[1], z: body.position[2] },
            rotation: { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] }
        });
        bodyIndexById.set(bodyId, index);
        bodyIds.push(bodyId);
    }
    scene.shapes.forEach((shape, shapeIndex) => {
        const center = shape.center ?? [0, 0, 0];
        const rotation = shape.rotation;
        const definition = {
            center: { x: center[0], y: center[1], z: center[2] },
            halfExtents: shape.halfExtents === undefined
                ? undefined
                : { x: shape.halfExtents[0], y: shape.halfExtents[1], z: shape.halfExtents[2] },
            radius: shape.radius,
            height: shape.height,
            rotation: rotation === undefined
                ? undefined
                : { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] },
            isSensor: shape.isSensor === true
        };
        const material = { friction: shape.material.friction, restitution: shape.material.restitution };
        const bodyId = bodyIds[shape.body];
        let shapeId: number;
        if (shape.kind === "sphere") {
            shapeId = world.createSphereShape(bodyId, definition, material);
        } else if (shape.kind === "box") {
            shapeId = world.createBoxShape(bodyId, definition, material);
        } else if (shape.kind === "capsule") {
            shapeId = world.createCapsuleShape(bodyId, definition, material);
        } else {
            shapeId = world.createCylinderShape(bodyId, definition, material);
        }
        shapeIndexById.set(shapeId, shapeIndex);
    });

    const tracker: PairTracker = { livePairs: new Set() };
    const pending: NormalizedEvent[] = [];

    function record(
        kind: NormalizedEvent["kind"],
        rawBodyA: number,
        rawBodyB: number,
        rawShapeA: number,
        rawShapeB: number
    ): void {
        const bodyA = bodyIndexById.get(rawBodyA);
        const bodyB = bodyIndexById.get(rawBodyB);
        const shapeA = shapeIndexById.get(rawShapeA);
        const shapeB = shapeIndexById.get(rawShapeB);
        if (bodyA === undefined || bodyB === undefined || shapeA === undefined || shapeB === undefined) {
            throw new Error("compat adapter reported an event for an unknown scene entity");
        }
        pending.push({
            kind,
            bodyLo: Math.min(bodyA, bodyB),
            bodyHi: Math.max(bodyA, bodyB),
            shapeLo: Math.min(shapeA, shapeB),
            shapeHi: Math.max(shapeA, shapeB)
        });
        trackPair(tracker, kind, Math.min(bodyA, bodyB), Math.max(bodyA, bodyB));
    }

    const listener: CompatContactListener = {
        onCollisionBegin: (event) => record("begin", event.bodyIdA, event.bodyIdB, event.shapeIdA, event.shapeIdB),
        onCollisionStay: (event) => record("stay", event.bodyIdA, event.bodyIdB, event.shapeIdA, event.shapeIdB),
        onCollisionEnd: (event) => record("end", event.bodyIdA, event.bodyIdB, event.shapeIdA, event.shapeIdB),
        onSensorEnter: (event) => record("sensorEnter", event.sensorBodyId, event.visitorBodyId, event.sensorShapeId, event.visitorShapeId),
        onSensorStay: (event) => record("sensorStay", event.sensorBodyId, event.visitorBodyId, event.sensorShapeId, event.visitorShapeId),
        onSensorExit: (event) => record("sensorExit", event.sensorBodyId, event.visitorBodyId, event.sensorShapeId, event.visitorShapeId)
    };
    world.setContactListener(listener);

    const snapshots: CompatStepSnapshot[] = [];
    const events: StepEventBatch[] = [];
    for (let step = 1; step <= scene.steps; step += 1) {
        pending.length = 0;
        world.step(FIXED_DT, scene.world.velocityIterations, scene.world.positionIterations);
        if (pending.length > 0) {
            events.push({ step, events: [...pending] });
        }
        if (step % scene.snapshotEvery === 0 || step === scene.steps) {
            snapshots.push({
                step,
                bodies: bodyIds.map((bodyId) => {
                    const transform = world.getTransform(bodyId);
                    return {
                        position: tuple3(transform.position),
                        rotation: tuple4(transform.rotation)
                    };
                }),
                contactPairs: snapshotContactPairs(tracker)
            });
        }
    }
    world.dispose();

    return { snapshots, events, stateHash: hashCompatRun(snapshots, events) };
}
