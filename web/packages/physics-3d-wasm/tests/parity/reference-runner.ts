import { PhysicsWorld3D } from "@axrone/physics-3d";
import type {
    BodyId3D,
    Density,
    Force,
    Friction,
    ICollisionEvent3D,
    IContactListener3D,
    IMaterial,
    IPhysicsBodyDef3D,
    ISensorEvent3D,
    Restitution,
    Torque
} from "@axrone/physics-core";
import {
    FIXED_DT,
    hashRunState,
    normalizeDirection,
    shapeHalfSegment,
    type NormalizedEvent,
    type NormalizedEventKind,
    type ParityScene,
    type RaySample,
    type RunResult,
    type SceneShape,
    type StepEventBatch,
    type StepSnapshot
} from "./scene";

interface ReferenceRunnerContext {
    readonly scene: ParityScene;
    readonly world: PhysicsWorld3D;
    readonly bodyIds: BodyId3D[];
    readonly bodyIndexByEngineId: Map<number, number>;
    readonly shapeIndexByEngineId: Map<number, number>;
    readonly shapeOrdinalByIndex: number[];
    readonly pending: NormalizedEvent[];
    readonly livePairs: Set<string>;
}

function toEngineId(id: number | bigint): number {
    return Number(id);
}

function vec3(tuple: readonly [number, number, number]): { x: number; y: number; z: number } {
    return { x: tuple[0], y: tuple[1], z: tuple[2] };
}

function engineMaterial(shape: SceneShape): IMaterial {
    return {
        friction: shape.material.friction as unknown as Friction,
        restitution: shape.material.restitution as unknown as Restitution,
        density: 1 as unknown as Density
    };
}

function engineTorque(value: number): Torque {
    return value as unknown as Torque;
}

function engineForce(value: number): Force {
    return value as unknown as Force;
}

function pushNormalized(
    context: ReferenceRunnerContext,
    kind: NormalizedEventKind,
    rawBodyA: number | bigint,
    rawBodyB: number | bigint,
    rawShapeA: number | bigint,
    rawShapeB: number | bigint
): void {
    const bodyA = context.bodyIndexByEngineId.get(toEngineId(rawBodyA));
    const bodyB = context.bodyIndexByEngineId.get(toEngineId(rawBodyB));
    const shapeA = context.shapeIndexByEngineId.get(toEngineId(rawShapeA));
    const shapeB = context.shapeIndexByEngineId.get(toEngineId(rawShapeB));
    if (bodyA === undefined || bodyB === undefined || shapeA === undefined || shapeB === undefined) {
        throw new Error("reference engine reported an event for an unknown scene entity");
    }
    const event: NormalizedEvent = {
        kind,
        bodyLo: Math.min(bodyA, bodyB),
        bodyHi: Math.max(bodyA, bodyB),
        shapeLo: Math.min(shapeA, shapeB),
        shapeHi: Math.max(shapeA, shapeB)
    };
    context.pending.push(event);
    const pairKey = `${event.bodyLo}-${event.bodyHi}`;
    if (kind === "begin" || kind === "stay") {
        context.livePairs.add(pairKey);
    } else if (kind === "end") {
        context.livePairs.delete(pairKey);
    }
}

function createListener(context: ReferenceRunnerContext): IContactListener3D {
    return {
        onCollisionBegin(event: ICollisionEvent3D): void {
            pushNormalized(context, "begin", event.bodyIdA, event.bodyIdB, event.shapeIdA, event.shapeIdB);
        },
        onCollisionStay(event: ICollisionEvent3D): void {
            pushNormalized(context, "stay", event.bodyIdA, event.bodyIdB, event.shapeIdA, event.shapeIdB);
        },
        onCollisionEnd(event: ICollisionEvent3D): void {
            pushNormalized(context, "end", event.bodyIdA, event.bodyIdB, event.shapeIdA, event.shapeIdB);
        },
        onSensorEnter(event: ISensorEvent3D): void {
            pushNormalized(context, "sensorEnter", event.sensorBodyId, event.visitorBodyId, event.sensorShapeId, event.visitorShapeId);
        },
        onSensorStay(event: ISensorEvent3D): void {
            pushNormalized(context, "sensorStay", event.sensorBodyId, event.visitorBodyId, event.sensorShapeId, event.visitorShapeId);
        },
        onSensorExit(event: ISensorEvent3D): void {
            pushNormalized(context, "sensorExit", event.sensorBodyId, event.visitorBodyId, event.sensorShapeId, event.visitorShapeId);
        }
    };
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

function createShape(context: ReferenceRunnerContext, shape: SceneShape, shapeIndex: number): void {
    const { world } = context;
    const bodyId = context.bodyIds[shape.body];
    const center = shape.center ?? [0, 0, 0];
    const material = engineMaterial(shape);
    const filter = shape.filter === undefined
        ? undefined
        : { categoryBits: shape.filter[0], maskBits: shape.filter[1], groupIndex: shape.filter[2] };
    const options = { isSensor: shape.isSensor === true };
    const centerVec = vec3(center);
    let shapeId: number | bigint;
    if (shape.kind === "sphere") {
        if (shape.radius === undefined || shape.radius <= 0) {
            throw new Error(`shape ${shapeIndex} sphere requires positive radius`);
        }
        shapeId = world.createSphereShape(bodyId, { center: centerVec, radius: shape.radius }, material, filter, options);
    } else if (shape.kind === "box") {
        if (shape.halfExtents === undefined) {
            throw new Error(`shape ${shapeIndex} box requires halfExtents`);
        }
        const rotation = shape.rotation;
        shapeId = world.createBoxShape(
            bodyId,
            {
                center: centerVec,
                halfExtents: vec3(shape.halfExtents),
                ...(rotation === undefined ? {} : { rotation: { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] } })
            },
            material,
            filter,
            options
        );
    } else if (shape.kind === "capsule") {
        if (shape.radius === undefined || shape.height === undefined) {
            throw new Error(`shape ${shapeIndex} capsule requires radius and height`);
        }
        const halfSegment = shapeHalfSegment(shape);
        shapeId = world.createCapsuleShape(
            bodyId,
            {
                p1: { x: center[0], y: center[1] - halfSegment, z: center[2] },
                p2: { x: center[0], y: center[1] + halfSegment, z: center[2] },
                radius: shape.radius
            },
            material,
            filter,
            options
        );
    } else {
        if (shape.radius === undefined || shape.height === undefined) {
            throw new Error(`shape ${shapeIndex} cylinder requires radius and height`);
        }
        shapeId = world.createCylinderShape(
            bodyId,
            { center: centerVec, radius: shape.radius, height: shape.height, axis: 1 },
            material,
            filter,
            options
        );
    }
    context.shapeIndexByEngineId.set(toEngineId(shapeId), shapeIndex);
    context.shapeOrdinalByIndex[shapeIndex] = shapeOrdinalForIndex(context.scene.shapes, shapeIndex);
}

function snapshotContactPairs(context: ReferenceRunnerContext): (readonly [number, number])[] {
    const pairs: (readonly [number, number])[] = [];
    for (const key of context.livePairs) {
        const separator = key.indexOf("-");
        pairs.push([Number(key.slice(0, separator)), Number(key.slice(separator + 1))]);
    }
    pairs.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
    return pairs;
}

export interface ReferenceRunOptions {
    readonly timedFrom?: number;
    readonly timedTo?: number;
}

export interface TimedRun {
    readonly result: RunResult;
    readonly timedSteps: number;
    readonly totalMs: number;
}

export function runReferenceScene(scene: ParityScene, options: ReferenceRunOptions = {}): TimedRun {
    const configSource = {
        gravity: vec3(scene.world.gravity),
        maxBodies: scene.world.maxBodies,
        maxContacts: scene.world.maxContacts,
        allowSleep: scene.world.allowSleep
    };
    const world = new PhysicsWorld3D(configSource);
    const context: ReferenceRunnerContext = {
        scene,
        world,
        bodyIds: [],
        bodyIndexByEngineId: new Map(),
        shapeIndexByEngineId: new Map(),
        shapeOrdinalByIndex: [],
        pending: [],
        livePairs: new Set()
    };
    for (const body of scene.bodies) {
        const rotation = body.rotation ?? [0, 0, 0, 1];
        const def: IPhysicsBodyDef3D = {
            type: body.type,
            position: vec3(body.position),
            rotation: { x: rotation[0], y: rotation[1], z: rotation[2], w: rotation[3] },
            allowSleep: false,
            ...(body.velocity === undefined ? {} : { linearVelocity: vec3(body.velocity) }),
            ...(body.angularVelocity === undefined ? {} : { angularVelocity: vec3(body.angularVelocity) }),
            ...(body.damping === undefined ? {} : { linearDamping: body.damping[0], angularDamping: body.damping[1] }),
            ...(body.gravityScale === undefined ? {} : { gravityScale: body.gravityScale })
        };
        const rawBodyId = world.createBody(def);
        const engineId = toEngineId(rawBodyId);
        context.bodyIndexByEngineId.set(engineId, context.bodyIds.length);
        context.bodyIds.push(rawBodyId);
    }
    scene.shapes.forEach((shape, shapeIndex) => {
        createShape(context, shape, shapeIndex);
    });
    for (let index = 0; index < scene.bodies.length; index += 1) {
        if (scene.shapes.some((shape) => shape.body === index)) {
            world.getBody(context.bodyIds[index])?.resetMassData();
        }
    }
    for (const joint of scene.joints) {
        const bodyIdA = context.bodyIds[joint.bodyA];
        const bodyIdB = context.bodyIds[joint.bodyB];
        const anchorA = vec3(joint.localAnchorA);
        const anchorB = vec3(joint.localAnchorB);
        const collideConnected = joint.collideConnected === true;
        if (joint.type === "fixed") {
            world.createFixedConstraint({ bodyIdA, bodyIdB, localAnchorA: anchorA, localAnchorB: anchorB, collideConnected });
        } else if (joint.type === "hinge") {
            if (joint.localAxisA === undefined || joint.localAxisB === undefined) {
                throw new Error("hinge joints require localAxisA and localAxisB");
            }
            world.createHingeConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: anchorA,
                localAnchorB: anchorB,
                localAxisA: vec3(joint.localAxisA),
                localAxisB: vec3(joint.localAxisB),
                enableLimit: joint.enableLimit === true,
                lowerLimit: joint.lowerLimit ?? 0,
                upperLimit: joint.upperLimit ?? 0,
                enableMotor: joint.enableMotor === true,
                motorSpeed: joint.motorSpeed ?? 0,
                maxMotorTorque: engineTorque(joint.maxMotorTorque ?? 0),
                collideConnected
            });
        } else if (joint.type === "slider") {
            if (joint.localAxisA === undefined) {
                throw new Error("slider joints require localAxisA");
            }
            world.createSliderConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: anchorA,
                localAnchorB: anchorB,
                localAxisA: vec3(joint.localAxisA),
                enableLimit: joint.enableLimit === true,
                lowerLimit: joint.lowerLimit ?? 0,
                upperLimit: joint.upperLimit ?? 0,
                enableMotor: joint.enableMotor === true,
                motorSpeed: joint.motorSpeed ?? 0,
                maxMotorForce: engineForce(joint.maxMotorForce ?? 0),
                collideConnected
            });
        } else {
            world.createSpringConstraint({
                bodyIdA,
                bodyIdB,
                localAnchorA: anchorA,
                localAnchorB: anchorB,
                restLength: joint.restLength ?? 1,
                stiffness: joint.stiffness ?? 10,
                damping: joint.damping ?? 0.5,
                collideConnected
            });
        }
    }
    world.setContactListener(createListener(context));

    const bodyManager = world.getBodyManager();
    const snapshots: StepSnapshot[] = [];
    const events: StepEventBatch[] = [];
    const rays: RaySample[] = [];
    let timedSteps = 0;
    let totalMs = 0;
    const timedFrom = options.timedFrom ?? -1;
    const timedTo = options.timedTo ?? -1;

    const captureRay = (step: number): void => {
        scene.rays.forEach((ray, rayIndex) => {
            if (ray.atStep !== step) {
                return;
            }
            const direction = normalizeDirection(ray.direction);
            const results = world.rayCastAll(
                vec3(ray.origin),
                vec3(direction),
                ray.maxDistance
            );
            const hits = results.map((hit) => {
                const bodyIndex = context.bodyIndexByEngineId.get(toEngineId(hit.bodyId));
                const shapeIndex = context.shapeIndexByEngineId.get(toEngineId(hit.shapeId));
                if (bodyIndex === undefined || shapeIndex === undefined) {
                    throw new Error("reference ray query reported an unknown entity");
                }
                return {
                    body: bodyIndex,
                    shapeOrdinal: context.shapeOrdinalByIndex[shapeIndex],
                    distance: hit.fraction,
                    point: [hit.point.x, hit.point.y, hit.point.z] as const,
                    normal: [hit.normal.x, hit.normal.y, hit.normal.z] as const
                };
            });
            hits.sort((a, b) => a.distance - b.distance);
            rays.push({ step, ray: rayIndex, hits });
        });
    };

    captureRay(0);
    for (let step = 1; step <= scene.steps; step += 1) {
        context.pending.length = 0;
        const timed = step > timedFrom && step <= timedTo;
        const started = timed ? performance.now() : 0;
        world.step(FIXED_DT, scene.world.velocityIterations, scene.world.positionIterations);
        if (timed) {
            totalMs += performance.now() - started;
            timedSteps += 1;
        }
        if (context.pending.length > 0) {
            events.push({ step, events: [...context.pending] });
        }
        if (step % scene.snapshotEvery === 0 || step === scene.steps) {
            snapshots.push({
                step,
                bodies: context.bodyIds.map((bodyId) => {
                    const position = bodyManager.getPosition(bodyId);
                    const rotation = bodyManager.getRotation(bodyId);
                    const velocity = bodyManager.getLinearVelocity(bodyId);
                    const angular = bodyManager.getAngularVelocity(bodyId);
                    return {
                        position: [position.x, position.y, position.z],
                        rotation: [rotation.x, rotation.y, rotation.z, rotation.w],
                        velocity: [velocity.x, velocity.y, velocity.z],
                        angularVelocity: [angular.x, angular.y, angular.z]
                    };
                }),
                contactPairs: snapshotContactPairs(context)
            });
            captureRay(step);
        }
    }
    world[Symbol.dispose]();

    const captured = {
        snapshots,
        events,
        rays,
        fingerprint: null,
        stateHash: ""
    };
    const result: RunResult = {
        ...captured,
        stateHash: hashRunState(captured)
    };
    return { result, timedSteps, totalMs };
}
