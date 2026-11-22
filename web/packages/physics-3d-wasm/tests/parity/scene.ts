import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export type Vec3Tuple = readonly [number, number, number];
export type Vec4Tuple = readonly [number, number, number, number];

export interface SceneMaterial {
    readonly friction: number;
    readonly restitution: number;
}

export interface SceneWorldConfig {
    readonly gravity: Vec3Tuple;
    readonly maxBodies: number;
    readonly maxContacts: number;
    readonly velocityIterations: number;
    readonly positionIterations: number;
    readonly allowSleep: boolean;
}

export interface SceneBody {
    readonly type: 0 | 1 | 2;
    readonly position: Vec3Tuple;
    readonly rotation?: Vec4Tuple;
    readonly velocity?: Vec3Tuple;
    readonly angularVelocity?: Vec3Tuple;
    readonly damping?: readonly [number, number];
    readonly gravityScale?: number;
}

export type SceneShapeKind = "sphere" | "box" | "capsule" | "cylinder";

export interface SceneShape {
    readonly body: number;
    readonly kind: SceneShapeKind;
    readonly radius?: number;
    readonly halfExtents?: Vec3Tuple;
    readonly height?: number;
    readonly center?: Vec3Tuple;
    readonly rotation?: Vec4Tuple;
    readonly material: SceneMaterial;
    readonly isSensor?: boolean;
    readonly filter?: readonly [number, number, number];
}

export type SceneJointType = "fixed" | "hinge" | "slider" | "spring";

export interface SceneJoint {
    readonly type: SceneJointType;
    readonly bodyA: number;
    readonly bodyB: number;
    readonly localAnchorA: Vec3Tuple;
    readonly localAnchorB: Vec3Tuple;
    readonly localAxisA?: Vec3Tuple;
    readonly localAxisB?: Vec3Tuple;
    readonly enableLimit?: boolean;
    readonly lowerLimit?: number;
    readonly upperLimit?: number;
    readonly enableMotor?: boolean;
    readonly motorSpeed?: number;
    readonly maxMotorTorque?: number;
    readonly maxMotorForce?: number;
    readonly restLength?: number;
    readonly stiffness?: number;
    readonly damping?: number;
    readonly collideConnected?: boolean;
}

export interface SceneRay {
    readonly atStep: number;
    readonly origin: Vec3Tuple;
    readonly direction: Vec3Tuple;
    readonly maxDistance: number;
}

export interface ParityScene {
    readonly name: string;
    readonly skip: string | null;
    readonly world: SceneWorldConfig;
    readonly bodies: readonly SceneBody[];
    readonly shapes: readonly SceneShape[];
    readonly joints: readonly SceneJoint[];
    readonly rays: readonly SceneRay[];
    readonly snapshotEvery: number;
    readonly steps: number;
}

export interface BodyStateSnapshot {
    readonly position: Vec3Tuple;
    readonly rotation: Vec4Tuple;
    readonly velocity: Vec3Tuple;
    readonly angularVelocity: Vec3Tuple;
}

export interface StepSnapshot {
    readonly step: number;
    readonly bodies: readonly BodyStateSnapshot[];
    readonly contactPairs: readonly (readonly [number, number])[];
}

export type NormalizedEventKind =
    | "begin"
    | "stay"
    | "end"
    | "sensorEnter"
    | "sensorStay"
    | "sensorExit";

export interface NormalizedEvent {
    readonly kind: NormalizedEventKind;
    readonly bodyLo: number;
    readonly bodyHi: number;
    readonly shapeLo: number;
    readonly shapeHi: number;
}

export interface StepEventBatch {
    readonly step: number;
    readonly events: readonly NormalizedEvent[];
}

export interface RayHitSnapshot {
    readonly body: number;
    readonly shapeOrdinal: number;
    readonly distance: number;
    readonly point: Vec3Tuple;
    readonly normal: Vec3Tuple;
}

export interface RaySample {
    readonly step: number;
    readonly ray: number;
    readonly hits: readonly RayHitSnapshot[];
}

export interface RunResult {
    readonly snapshots: readonly StepSnapshot[];
    readonly events: readonly StepEventBatch[];
    readonly rays: readonly RaySample[];
    readonly fingerprint: string | null;
    readonly stateHash: string;
}

const SCENE_DIR = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "scenes");

function asVec3(value: unknown, label: string): Vec3Tuple {
    if (!Array.isArray(value) || value.length !== 3 || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
        throw new Error(`${label} must be a [number, number, number] tuple`);
    }
    return [value[0] as number, value[1] as number, value[2] as number];
}

function asVec4(value: unknown, label: string): Vec4Tuple {
    if (!Array.isArray(value) || value.length !== 4 || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
        throw new Error(`${label} must be a [number, number, number, number] tuple`);
    }
    return [value[0] as number, value[1] as number, value[2] as number, value[3] as number];
}

function asNumber(value: unknown, label: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${label} must be a finite number`);
    }
    return value;
}

function asOptionalNumber(value: unknown, label: string): number | undefined {
    return value === undefined ? undefined : asNumber(value, label);
}

function asOptionalVec3(value: unknown, label: string): Vec3Tuple | undefined {
    return value === undefined ? undefined : asVec3(value, label);
}

function parseBody(raw: unknown, index: number): SceneBody {
    if (typeof raw !== "object" || raw === null) {
        throw new Error(`bodies[${index}] must be an object`);
    }
    const entry = raw as Record<string, unknown>;
    const type = entry.type;
    if (type !== 0 && type !== 1 && type !== 2) {
        throw new Error(`bodies[${index}].type must be 0, 1 or 2`);
    }
    const damping = entry.damping === undefined
        ? undefined
        : ((): readonly [number, number] => {
            if (!Array.isArray(entry.damping) || entry.damping.length !== 2 || entry.damping.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
                throw new Error(`bodies[${index}].damping must be a [linear, angular] pair`);
            }
            return [entry.damping[0] as number, entry.damping[1] as number];
        })();
    return {
        type,
        position: asVec3(entry.position, `bodies[${index}].position`),
        rotation: entry.rotation === undefined ? undefined : asVec4(entry.rotation, `bodies[${index}].rotation`),
        velocity: asOptionalVec3(entry.velocity, `bodies[${index}].velocity`),
        angularVelocity: asOptionalVec3(entry.angularVelocity, `bodies[${index}].angularVelocity`),
        damping,
        gravityScale: asOptionalNumber(entry.gravityScale, `bodies[${index}].gravityScale`)
    };
}

function parseShape(raw: unknown, index: number, bodyCount: number): SceneShape {
    if (typeof raw !== "object" || raw === null) {
        throw new Error(`shapes[${index}] must be an object`);
    }
    const entry = raw as Record<string, unknown>;
    const kind = entry.kind;
    if (kind !== "sphere" && kind !== "box" && kind !== "capsule" && kind !== "cylinder") {
        throw new Error(`shapes[${index}].kind must be sphere, box, capsule or cylinder`);
    }
    const body = asNumber(entry.body, `shapes[${index}].body`);
    if (!Number.isInteger(body) || body < 0 || body >= bodyCount) {
        throw new Error(`shapes[${index}].body must reference a scene body index`);
    }
    const materialRaw = entry.material;
    if (typeof materialRaw !== "object" || materialRaw === null) {
        throw new Error(`shapes[${index}].material is required for cross-engine material parity`);
    }
    if (entry.rotation !== undefined && kind !== "box") {
        throw new Error(`shapes[${index}]: only box shapes may carry a per-shape rotation; the reference engine defines rotation for boxes only`);
    }
    if (kind === "sphere") {
        const radius = entry.radius;
        if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) {
            throw new Error(`shapes[${index}]: sphere requires a positive finite radius`);
        }
    } else if (kind === "box") {
        const extents = entry.halfExtents;
        if (!Array.isArray(extents) || extents.length !== 3 || extents.some((value) => typeof value !== "number" || !Number.isFinite(value) || value <= 0)) {
            throw new Error(`shapes[${index}]: box requires positive finite halfExtents`);
        }
    } else if (kind === "capsule") {
        const radius = entry.radius;
        const height = entry.height;
        if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) {
            throw new Error(`shapes[${index}]: capsule requires a positive finite radius`);
        }
        if (typeof height !== "number" || !Number.isFinite(height) || height < 2 * radius) {
            throw new Error(`shapes[${index}]: capsule height must be at least 2*radius`);
        }
    } else {
        const radius = entry.radius;
        const height = entry.height;
        if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) {
            throw new Error(`shapes[${index}]: cylinder requires a positive finite radius`);
        }
        if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
            throw new Error(`shapes[${index}]: cylinder requires a positive finite height`);
        }
    }
    const materialRecord = materialRaw as Record<string, unknown>;
    const filter = entry.filter === undefined
        ? undefined
        : ((): readonly [number, number, number] => {
            const tuple = asVec3(entry.filter, `shapes[${index}].filter`);
            tuple.forEach((value, position) => {
                if (!Number.isInteger(value)) {
                    throw new Error(`shapes[${index}].filter[${position}] must be an integer`);
                }
            });
            return [tuple[0], tuple[1], tuple[2]];
        })();
    return {
        body,
        kind,
        radius: asOptionalNumber(entry.radius, `shapes[${index}].radius`),
        halfExtents: asOptionalVec3(entry.halfExtents, `shapes[${index}].halfExtents`),
        height: asOptionalNumber(entry.height, `shapes[${index}].height`),
        center: asOptionalVec3(entry.center, `shapes[${index}].center`),
        rotation: entry.rotation === undefined ? undefined : asVec4(entry.rotation, `shapes[${index}].rotation`),
        material: {
            friction: asNumber(materialRecord.friction, `shapes[${index}].material.friction`),
            restitution: asNumber(materialRecord.restitution, `shapes[${index}].material.restitution`)
        },
        isSensor: entry.isSensor === undefined ? undefined : entry.isSensor === true,
        filter
    };
}

function parseJoint(raw: unknown, index: number, bodyCount: number): SceneJoint {
    if (typeof raw !== "object" || raw === null) {
        throw new Error(`joints[${index}] must be an object`);
    }
    const entry = raw as Record<string, unknown>;
    const type = entry.type;
    if (type !== "fixed" && type !== "hinge" && type !== "slider" && type !== "spring") {
        throw new Error(`joints[${index}].type must be fixed, hinge, slider or spring`);
    }
    const bodyA = asNumber(entry.bodyA, `joints[${index}].bodyA`);
    const bodyB = asNumber(entry.bodyB, `joints[${index}].bodyB`);
    if (!Number.isInteger(bodyA) || bodyA < 0 || bodyA >= bodyCount || !Number.isInteger(bodyB) || bodyB < 0 || bodyB >= bodyCount) {
        throw new Error(`joints[${index}] endpoints must reference scene body indices`);
    }
    return {
        type,
        bodyA,
        bodyB,
        localAnchorA: asVec3(entry.localAnchorA, `joints[${index}].localAnchorA`),
        localAnchorB: asVec3(entry.localAnchorB, `joints[${index}].localAnchorB`),
        localAxisA: asOptionalVec3(entry.localAxisA, `joints[${index}].localAxisA`),
        localAxisB: asOptionalVec3(entry.localAxisB, `joints[${index}].localAxisB`),
        enableLimit: entry.enableLimit === undefined ? undefined : entry.enableLimit === true,
        lowerLimit: asOptionalNumber(entry.lowerLimit, `joints[${index}].lowerLimit`),
        upperLimit: asOptionalNumber(entry.upperLimit, `joints[${index}].upperLimit`),
        enableMotor: entry.enableMotor === undefined ? undefined : entry.enableMotor === true,
        motorSpeed: asOptionalNumber(entry.motorSpeed, `joints[${index}].motorSpeed`),
        maxMotorTorque: asOptionalNumber(entry.maxMotorTorque, `joints[${index}].maxMotorTorque`),
        maxMotorForce: asOptionalNumber(entry.maxMotorForce, `joints[${index}].maxMotorForce`),
        restLength: asOptionalNumber(entry.restLength, `joints[${index}].restLength`),
        stiffness: asOptionalNumber(entry.stiffness, `joints[${index}].stiffness`),
        damping: asOptionalNumber(entry.damping, `joints[${index}].damping`),
        collideConnected: entry.collideConnected === undefined ? undefined : entry.collideConnected === true
    };
}

function parseRay(raw: unknown, index: number): SceneRay {
    if (typeof raw !== "object" || raw === null) {
        throw new Error(`rays[${index}] must be an object`);
    }
    const entry = raw as Record<string, unknown>;
    return {
        atStep: asNumber(entry.atStep, `rays[${index}].atStep`),
        origin: asVec3(entry.origin, `rays[${index}].origin`),
        direction: asVec3(entry.direction, `rays[${index}].direction`),
        maxDistance: asNumber(entry.maxDistance, `rays[${index}].maxDistance`)
    };
}

export function parseScene(raw: unknown, expectedName: string): ParityScene {
    if (typeof raw !== "object" || raw === null) {
        throw new Error(`scene ${expectedName} must be an object`);
    }
    const entry = raw as Record<string, unknown>;
    const name = String(entry.name);
    if (name !== expectedName) {
        throw new Error(`scene name ${name} does not match file name ${expectedName}`);
    }
    const worldRaw = entry.world;
    if (typeof worldRaw !== "object" || worldRaw === null) {
        throw new Error(`scene ${name} requires a world block`);
    }
    const worldRecord = worldRaw as Record<string, unknown>;
    const gravity = asVec3(worldRecord.gravity, `scene ${name} world.gravity`);
    const maxBodies = asNumber(worldRecord.maxBodies, `scene ${name} world.maxBodies`);
    const maxContacts = asNumber(worldRecord.maxContacts, `scene ${name} world.maxContacts`);
    const velocityIterations = asNumber(worldRecord.velocityIterations, `scene ${name} world.velocityIterations`);
    const positionIterations = asNumber(worldRecord.positionIterations, `scene ${name} world.positionIterations`);
    const allowSleep = worldRecord.allowSleep === true;
    if (!Number.isInteger(maxBodies) || maxBodies < 1) {
        throw new Error(`scene ${name} world.maxBodies must be a positive integer`);
    }
    if (!Number.isInteger(maxContacts) || maxContacts < 1) {
        throw new Error(`scene ${name} world.maxContacts must be a positive integer`);
    }
    if (!Number.isInteger(velocityIterations) || velocityIterations < 0 || !Number.isInteger(positionIterations) || positionIterations < 0) {
        throw new Error(`scene ${name} solver iterations must be non-negative integers`);
    }
    if (allowSleep) {
        throw new Error(`scene ${name} must run with allowSleep false: the parity harness compares continuous solver behavior`);
    }
    const bodyRaw = entry.bodies;
    if (!Array.isArray(bodyRaw)) {
        throw new Error(`scene ${name} requires a bodies array`);
    }
    const bodies = bodyRaw.map((value, index) => parseBody(value, index));
    const shapeRaw = entry.shapes;
    if (!Array.isArray(shapeRaw)) {
        throw new Error(`scene ${name} requires a shapes array`);
    }
    const shapes = shapeRaw.map((value, index) => parseShape(value, index, bodies.length));
    const jointRaw = entry.joints ?? [];
    if (!Array.isArray(jointRaw)) {
        throw new Error(`scene ${name} joints must be an array`);
    }
    const joints = jointRaw.map((value, index) => parseJoint(value, index, bodies.length));
    const rayRaw = entry.rays ?? [];
    if (!Array.isArray(rayRaw)) {
        throw new Error(`scene ${name} rays must be an array`);
    }
    const rays = rayRaw.map((value, index) => parseRay(value, index));
    const steps = asNumber(entry.steps, `scene ${name} steps`);
    const snapshotEvery = asNumber(entry.snapshotEvery, `scene ${name} snapshotEvery`);
    if (!Number.isInteger(steps) || steps < 1) {
        throw new Error(`scene ${name} steps must be a positive integer`);
    }
    if (!Number.isInteger(snapshotEvery) || snapshotEvery < 1) {
        throw new Error(`scene ${name} snapshotEvery must be a positive integer`);
    }
    for (const ray of rays) {
        if (!Number.isInteger(ray.atStep) || ray.atStep < 0 || ray.atStep > steps) {
            throw new Error(`scene ${name} ray atStep out of range`);
        }
    }
    return {
        name,
        skip: typeof entry.skip === "string" && entry.skip.length > 0 ? entry.skip : null,
        world: { gravity, maxBodies, maxContacts, velocityIterations, positionIterations, allowSleep },
        bodies,
        shapes,
        joints,
        rays,
        snapshotEvery,
        steps
    };
}

export function loadScene(name: string): ParityScene {
    const filePath = path.join(SCENE_DIR, `${name}.json`);
    return parseScene(JSON.parse(readFileSync(filePath, "utf8")), name);
}

export function listSceneNames(): string[] {
    return [
        "stack-5",
        "ramp-30",
        "capsule-slide",
        "sensor-passage",
        "ray-scenes",
        "multi-shape-compound",
        "joint-hinge-door",
        "mixed-250"
    ];
}

export const FIXED_DT = 1 / 60;

export function shapeHalfSegment(shape: SceneShape): number {
    if (shape.radius === undefined || shape.height === undefined) {
        throw new Error("capsule shapes require radius and height");
    }
    return Math.max(0, shape.height / 2 - shape.radius);
}

export function normalizeDirection(direction: Vec3Tuple): Vec3Tuple {
    const length = Math.hypot(direction[0], direction[1], direction[2]);
    if (!(length > 0)) {
        throw new Error("ray direction must be non-zero");
    }
    return [direction[0] / length, direction[1] / length, direction[2] / length];
}

export function quaternionAngle(a: Vec4Tuple, b: Vec4Tuple): number {
    const dot = Math.min(1, Math.max(-1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
    return 2 * Math.acos(dot);
}

export function eventKey(event: NormalizedEvent): string {
    return `${event.kind}|${event.bodyLo}-${event.bodyHi}|${event.shapeLo}-${event.shapeHi}`;
}

export function eventPairKey(event: NormalizedEvent): string {
    return `${event.bodyLo}-${event.bodyHi}|${event.shapeLo}-${event.shapeHi}`;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a64Hex(bytes: Uint8Array): string {
    let hash = FNV_OFFSET;
    for (const byte of bytes) {
        hash ^= BigInt(byte);
        hash = (hash * FNV_PRIME) & MASK_64;
    }
    return hash.toString(16).padStart(16, "0");
}

export function hashRunState(result: RunResult): string {
    const samples: number[] = [];
    for (const snapshot of result.snapshots) {
        samples.push(snapshot.step);
        for (const pair of snapshot.contactPairs) {
            samples.push(-1 - pair[0], -1 - pair[1]);
        }
        for (const body of snapshot.bodies) {
            samples.push(
                body.position[0], body.position[1], body.position[2],
                body.rotation[0], body.rotation[1], body.rotation[2], body.rotation[3],
                body.velocity[0], body.velocity[1], body.velocity[2],
                body.angularVelocity[0], body.angularVelocity[1], body.angularVelocity[2]
            );
        }
    }
    for (const batch of result.events) {
        samples.push(batch.step);
        for (const event of batch.events) {
            samples.push(eventKindCode(event.kind), event.bodyLo, event.bodyHi, event.shapeLo, event.shapeHi);
        }
    }
    for (const sample of result.rays) {
        samples.push(sample.step, sample.ray, sample.hits.length);
        for (const hit of sample.hits) {
            samples.push(hit.body, hit.shapeOrdinal, hit.distance, hit.point[0], hit.point[1], hit.point[2], hit.normal[0], hit.normal[1], hit.normal[2]);
        }
    }
    const buffer = new ArrayBuffer(samples.length * 8);
    const view = new DataView(buffer);
    samples.forEach((value, index) => view.setFloat64(index * 8, value, true));
    return fnv1a64Hex(new Uint8Array(buffer));
}

export function eventKindCode(kind: NormalizedEventKind): number {
    switch (kind) {
        case "begin":
            return 0;
        case "stay":
            return 1;
        case "end":
            return 2;
        case "sensorEnter":
            return 3;
        case "sensorStay":
            return 4;
        case "sensorExit":
            return 5;
    }
}
