import { WasmPhysicsWorld3D } from "./world";
import type {
    BodyType,
    ContactEventSnapshot,
    QuatTuple,
    StepStatistics,
    TransformSnapshot,
    Vec3Tuple,
    WasmProfilerSnapshot,
    WorldOptions
} from "./types";

export interface CompatVec3 {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface CompatQuat {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly w: number;
}

export interface CompatBodyDef {
    readonly type?: 0 | 1 | 2;
    readonly position?: Partial<CompatVec3>;
    readonly rotation?: Partial<CompatQuat>;
    readonly allowSleep?: boolean;
}

export interface CompatShapeDef {
    readonly center?: Partial<CompatVec3>;
    readonly halfExtents?: Partial<CompatVec3>;
    readonly radius?: number;
    readonly height?: number;
    readonly rotation?: Partial<CompatQuat>;
    readonly isSensor?: boolean;
    readonly vertices?: readonly (Partial<CompatVec3> | undefined)[];
    readonly indices?: readonly number[] | Uint32Array;
    readonly heights?: readonly number[] | Float32Array;
    readonly width?: number;
    readonly depth?: number;
    readonly scaleX?: number;
    readonly scaleY?: number;
    readonly scaleZ?: number;
}

export interface CompatMaterial {
    readonly friction?: number;
    readonly restitution?: number;
}

export interface CompatWorldConfig {
    readonly gravity?: Partial<CompatVec3>;
    readonly maxBodies?: number;
    readonly maxContacts?: number;
    readonly maxConstraints?: number;
    readonly allowSleep?: boolean;
    readonly velocityIterations?: number;
    readonly positionIterations?: number;
}

export interface CompatBodyHandle {
    resetMassData(): void;
}

export interface CompatStatistics {
    readonly bodyCount: number;
    readonly contactCount: number;
    readonly ignoredConfigKeys: readonly string[];
}

export type CompatCollisionEventType = 0 | 1 | 2;

export type CompatSensorEventType = 0 | 1 | 2;

export interface CompatContactPoint {
    readonly id: number;
    readonly separation: number;
}

export interface CompatContactManifold {
    readonly id: number;
    readonly bodyIdA: number;
    readonly bodyIdB: number;
    readonly shapeIdA: number;
    readonly shapeIdB: number;
    readonly normal: CompatVec3;
    readonly pointCount: number;
    readonly points: readonly CompatContactPoint[];
}

export interface CompatCollisionEvent {
    readonly type: CompatCollisionEventType;
    readonly bodyIdA: number;
    readonly bodyIdB: number;
    readonly shapeIdA: number;
    readonly shapeIdB: number;
    readonly manifold: CompatContactManifold;
    readonly timestamp: number;
}

export interface CompatSensorEvent {
    readonly type: CompatSensorEventType;
    readonly sensorBodyId: number;
    readonly sensorShapeId: number;
    readonly visitorBodyId: number;
    readonly visitorShapeId: number;
    readonly timestamp: number;
}

export interface CompatContactListener {
    onCollisionBegin?(event: CompatCollisionEvent): void;
    onCollisionStay?(event: CompatCollisionEvent): void;
    onCollisionEnd?(event: CompatCollisionEvent): void;
    onSensorEnter?(event: CompatSensorEvent): void;
    onSensorStay?(event: CompatSensorEvent): void;
    onSensorExit?(event: CompatSensorEvent): void;
}

function vector(value: Partial<CompatVec3> | undefined, fallback: number): Vec3Tuple {
    return [
        value?.x ?? fallback,
        value?.y ?? fallback,
        value?.z ?? fallback
    ];
}

function quaternion(value: Partial<CompatQuat> | undefined): QuatTuple {
    return [
        value?.x ?? 0,
        value?.y ?? 0,
        value?.z ?? 0,
        value?.w ?? 1
    ];
}

function flattenCompatVertices(vertices: CompatShapeDef["vertices"]): number[] {
    if (vertices === undefined) {
        throw new Error("shape requires vertices");
    }
    const flat: number[] = [];
    for (let index = 0; index < vertices.length; index += 1) {
        const vertex = vertices[index];
        if (vertex === undefined) {
            throw new Error(`vertex ${index} is missing`);
        }
        flat.push(vertex.x ?? 0, vertex.y ?? 0, vertex.z ?? 0);
    }
    return flat;
}

function eventTimestamp(): number {
    return globalThis.performance?.now() ?? Date.now();
}

function profilerNow(): number {
    return globalThis.performance?.now() ?? 0;
}

const DEFAULT_COMPAT_VELOCITY_ITERATIONS = 10;
const DEFAULT_COMPAT_POSITION_ITERATIONS = 4;
const MAX_COMPAT_ITERATIONS = 64;
const COMPAT_KNOWN_CONFIG_KEYS: readonly string[] = [
    "gravity",
    "maxBodies",
    "maxContacts",
    "maxConstraints",
    "allowSleep",
    "velocityIterations",
    "positionIterations"
];

function assertConfigInteger(value: number | undefined, key: string): void {
    if (value === undefined) {
        return;
    }
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
        throw new Error(`${key} must be an integer`);
    }
}

function compatWorldOptions(config: CompatWorldConfig): WorldOptions {
    const maxBodies = config.maxBodies ?? 4096;
    const maxContacts = config.maxContacts ?? Math.min(262144, Math.max(1024, maxBodies * 16));
    return {
        maxBodies,
        maxContacts,
        gravity: [
            config.gravity?.x ?? 0,
            config.gravity?.y ?? -9.81,
            config.gravity?.z ?? 0
        ]
    };
}

function assertConfigIterations(value: number | undefined, key: string): void {
    assertConfigInteger(value, key);
    if (value !== undefined && (value < 0 || value > MAX_COMPAT_ITERATIONS)) {
        throw new Error(`${key} must be between 0 and ${MAX_COMPAT_ITERATIONS}`);
    }
}

function buildCollisionEvent(
    type: CompatCollisionEventType,
    event: ContactEventSnapshot,
    timestamp: number
): CompatCollisionEvent {
    const manifold: CompatContactManifold = {
        id: 0,
        bodyIdA: event.bodyA,
        bodyIdB: event.bodyB,
        shapeIdA: event.shapeA,
        shapeIdB: event.shapeB,
        normal: { x: event.normal[0], y: event.normal[1], z: event.normal[2] },
        pointCount: 1,
        points: [{ id: 0, separation: -event.penetration }]
    };
    return {
        type,
        bodyIdA: event.bodyA,
        bodyIdB: event.bodyB,
        shapeIdA: event.shapeA,
        shapeIdB: event.shapeB,
        manifold,
        timestamp
    };
}

function buildSensorEvent(
    type: CompatSensorEventType,
    event: ContactEventSnapshot,
    timestamp: number
): CompatSensorEvent {
    return {
        type,
        sensorBodyId: event.bodyA,
        sensorShapeId: event.shapeA,
        visitorBodyId: event.bodyB,
        visitorShapeId: event.shapeB,
        timestamp
    };
}

export class WasmPhysicsWorld3DCompat {
    private readonly physics: WasmPhysicsWorld3D;
    private readonly bodyShapes = new Map<number, Set<number>>();
    private readonly shapeOwners = new Map<number, number>();
    private readonly ignoredConfigKeys: string[] = [];
    private readonly defaultVelocityIterations: number;
    private readonly defaultPositionIterations: number;
    private lastStepTime = 0;
    private listener: CompatContactListener | null = null;
    private disposed = false;

    private constructor(
        physics: WasmPhysicsWorld3D,
        defaultVelocityIterations: number,
        defaultPositionIterations: number
    ) {
        this.physics = physics;
        this.defaultVelocityIterations = defaultVelocityIterations;
        this.defaultPositionIterations = defaultPositionIterations;
    }

    static async create(config: CompatWorldConfig = {}): Promise<WasmPhysicsWorld3DCompat> {
        const physics = await WasmPhysicsWorld3D.create(compatWorldOptions(config));
        return WasmPhysicsWorld3DCompat.attach(physics, config);
    }

    static async createFromBytes(bytes: Uint8Array, config: CompatWorldConfig = {}): Promise<WasmPhysicsWorld3DCompat> {
        const physics = await WasmPhysicsWorld3D.createFromBytes(bytes, compatWorldOptions(config));
        return WasmPhysicsWorld3DCompat.attach(physics, config);
    }

    private static attach(physics: WasmPhysicsWorld3D, config: CompatWorldConfig): WasmPhysicsWorld3DCompat {
        const velocityIterations = config.velocityIterations ?? DEFAULT_COMPAT_VELOCITY_ITERATIONS;
        const positionIterations = config.positionIterations ?? DEFAULT_COMPAT_POSITION_ITERATIONS;
        const world = new WasmPhysicsWorld3DCompat(physics, velocityIterations, positionIterations);
        world.collectUnknownConfigKeys(config);
        world.applyConfig(config);
        return world;
    }

    get bodyCount(): number {
        this.ensureAlive();
        return this.physics.bodyCount;
    }

    get contactCount(): number {
        this.ensureAlive();
        return this.physics.contactCount;
    }

    createBody(def: CompatBodyDef = {}): number {
        this.ensureAlive();
        const type = def.type ?? 2;
        if (type !== 0 && type !== 1 && type !== 2) {
            throw new Error(`unsupported body type: ${type}`);
        }
        if (def.allowSleep !== undefined) {
            this.noteIgnoredConfigKey("bodyDef.allowSleep");
        }
        const bodyType: BodyType = type === 0 ? "static" : type === 1 ? "kinematic" : "dynamic";
        return this.physics.createBody({
            type: bodyType,
            position: vector(def.position, 0),
            rotation: quaternion(def.rotation)
        });
    }

    destroyBody(bodyId: number): void {
        this.ensureAlive();
        this.physics.destroyBody(bodyId);
        this.forgetBodyShapes(bodyId);
    }

    createBoxShape(bodyId: number, def: CompatShapeDef, material?: CompatMaterial): number {
        this.ensureAlive();
        const extents = def.halfExtents;
        if (extents === undefined) {
            throw new Error("box shape requires halfExtents");
        }
        const shapeId = this.physics.addBox(
            bodyId,
            vector(extents, 0),
            1,
            vector(def.center, 0),
            quaternion(def.rotation)
        );
        this.registerShape(bodyId, shapeId);
        this.applyShapeMaterial(shapeId, material);
        if (def.isSensor === true) {
            this.physics.setShapeSensor(shapeId, true);
        }
        return shapeId;
    }

    createSphereShape(bodyId: number, def: CompatShapeDef, material?: CompatMaterial): number {
        this.ensureAlive();
        if (def.radius === undefined) {
            throw new Error("sphere shape requires radius");
        }
        const shapeId = this.physics.addSphere(
            bodyId,
            def.radius,
            1,
            vector(def.center, 0)
        );
        this.registerShape(bodyId, shapeId);
        this.applyShapeMaterial(shapeId, material);
        if (def.isSensor === true) {
            this.physics.setShapeSensor(shapeId, true);
        }
        return shapeId;
    }

    createCapsuleShape(bodyId: number, def: CompatShapeDef, material?: CompatMaterial): number {
        this.ensureAlive();
        if (def.radius === undefined) {
            throw new Error("capsule shape requires radius");
        }
        if (def.height === undefined) {
            throw new Error("capsule shape requires height");
        }
        if (!Number.isFinite(def.radius) || def.radius <= 0) {
            throw new Error("capsule radius must be a positive finite number");
        }
        if (!Number.isFinite(def.height) || def.height <= 0) {
            throw new Error("capsule height must be a positive finite number");
        }
        const halfSegment = Math.max(0, def.height / 2 - def.radius);
        const shapeId = this.physics.attachCapsule(bodyId, {
            radius: def.radius,
            halfSegment,
            density: 1,
            offset: vector(def.center, 0),
            rotation: quaternion(def.rotation)
        });
        this.registerShape(bodyId, shapeId);
        this.applyShapeMaterial(shapeId, material);
        if (def.isSensor === true) {
            this.physics.setShapeSensor(shapeId, true);
        }
        return shapeId;
    }

    createCylinderShape(bodyId: number, def: CompatShapeDef, material?: CompatMaterial): number {
        this.ensureAlive();
        if (def.radius === undefined) {
            throw new Error("cylinder shape requires radius");
        }
        if (def.height === undefined) {
            throw new Error("cylinder shape requires height");
        }
        if (!Number.isFinite(def.radius) || def.radius <= 0) {
            throw new Error("cylinder radius must be a positive finite number");
        }
        if (!Number.isFinite(def.height) || def.height <= 0) {
            throw new Error("cylinder height must be a positive finite number");
        }
        const shapeId = this.physics.attachCylinder(bodyId, {
            radius: def.radius,
            halfHeight: def.height / 2,
            density: 1,
            offset: vector(def.center, 0),
            rotation: quaternion(def.rotation)
        });
        this.registerShape(bodyId, shapeId);
        this.applyShapeMaterial(shapeId, material);
        if (def.isSensor === true) {
            this.physics.setShapeSensor(shapeId, true);
        }
        return shapeId;
    }

    createConeShape(bodyId: number, def: CompatShapeDef, material?: CompatMaterial): number {
        this.ensureAlive();
        if (def.radius === undefined) {
            throw new Error("cone shape requires radius");
        }
        if (def.height === undefined) {
            throw new Error("cone shape requires height");
        }
        if (!Number.isFinite(def.radius) || def.radius <= 0) {
            throw new Error("cone radius must be a positive finite number");
        }
        if (!Number.isFinite(def.height) || def.height <= 0) {
            throw new Error("cone height must be a positive finite number");
        }
        const shapeId = this.physics.attachCone(bodyId, {
            radius: def.radius,
            halfHeight: def.height / 2,
            density: 1,
            offset: vector(def.center, 0),
            rotation: quaternion(def.rotation)
        });
        this.registerShape(bodyId, shapeId);
        this.applyShapeMaterial(shapeId, material);
        if (def.isSensor === true) {
            this.physics.setShapeSensor(shapeId, true);
        }
        return shapeId;
    }

    createHullShape(bodyId: number, def: CompatShapeDef, material?: CompatMaterial): number {
        this.ensureAlive();
        const vertices = flattenCompatVertices(def.vertices);
        const shapeId = this.physics.attachHull(bodyId, {
            vertices,
            density: 1,
            offset: vector(def.center, 0)
        });
        this.registerShape(bodyId, shapeId);
        this.applyShapeMaterial(shapeId, material);
        if (def.isSensor === true) {
            this.physics.setShapeSensor(shapeId, true);
        }
        return shapeId;
    }

    createTriangleMeshShape(bodyId: number, def: CompatShapeDef, material?: CompatMaterial): number {
        this.ensureAlive();
        const vertices = flattenCompatVertices(def.vertices);
        if (def.indices === undefined) {
            throw new Error("triangle mesh shape requires indices");
        }
        const shapeId = this.physics.attachMesh(bodyId, {
            vertices,
            indices: def.indices,
            offset: vector(def.center, 0)
        });
        this.registerShape(bodyId, shapeId);
        this.applyShapeMaterial(shapeId, material);
        if (def.isSensor === true) {
            this.physics.setShapeSensor(shapeId, true);
        }
        return shapeId;
    }

    createHeightfieldShape(bodyId: number, def: CompatShapeDef, material?: CompatMaterial): number {
        this.ensureAlive();
        if (def.heights === undefined) {
            throw new Error("heightfield shape requires heights");
        }
        const shapeId = this.physics.attachHeightField(bodyId, {
            width: def.width ?? 0,
            depth: def.depth ?? 0,
            heights: def.heights,
            scale: [def.scaleX ?? 1, def.scaleY ?? 1, def.scaleZ ?? 1],
            offset: vector(def.center, 0)
        });
        this.registerShape(bodyId, shapeId);
        this.applyShapeMaterial(shapeId, material);
        if (def.isSensor === true) {
            this.physics.setShapeSensor(shapeId, true);
        }
        return shapeId;
    }

    destroyShape(shapeId: number): void {
        this.ensureAlive();
        this.physics.destroyShape(shapeId);
        const bodyId = this.shapeOwners.get(shapeId);
        if (bodyId === undefined) {
            return;
        }
        const ids = this.bodyShapes.get(bodyId);
        if (ids !== undefined) {
            ids.delete(shapeId);
            if (ids.size === 0) {
                this.bodyShapes.delete(bodyId);
            }
        }
        this.shapeOwners.delete(shapeId);
    }

    getShapeBody(shapeId: number): number {
        this.ensureAlive();
        return this.physics.getShapeBody(shapeId);
    }

    getBody(bodyId: number): CompatBodyHandle | null {
        this.ensureAlive();
        if (!this.physics.hasBody(bodyId)) {
            return null;
        }
        const physics = this.physics;
        return {
            resetMassData(): void {
                physics.setMassData(bodyId, 0);
            }
        };
    }

    getTransform(bodyId: number): TransformSnapshot {
        this.ensureAlive();
        return this.physics.readTransform(bodyId);
    }

    step(dt: number, velocityIterations?: number, positionIterations?: number): number {
        this.ensureAlive();
        const iterations = velocityIterations ?? this.defaultVelocityIterations;
        const relaxations = positionIterations ?? this.defaultPositionIterations;
        const startedAt = profilerNow();
        const contacts = this.physics.step(dt, {
            velocityIterations: iterations,
            positionIterations: relaxations
        });
        this.lastStepTime = profilerNow() - startedAt;
        this.dispatchContactEvents();
        return contacts;
    }

    setContactListener(listener: CompatContactListener | null): void {
        this.ensureAlive();
        this.listener = listener;
    }

    getProfiler(): WasmProfilerSnapshot {
        this.ensureAlive();
        const timers = this.physics.getPhaseTimers();
        if (timers === null) {
            return {
                stepTime: this.lastStepTime,
                collisionTime: null,
                solveTime: null,
                broadphaseTime: null,
                narrowphaseTime: null,
                sweepSortTime: null,
                pairLoopTime: null,
                solveVelocityTime: null,
                solvePositionTime: null,
                sleepTime: null,
                sleepAndCacheSwapTime: null,
                warmStartTime: null,
                persistTime: null,
                integrateVelocityTime: null,
                integratePositionTime: null,
                eventsTime: null
            };
        }

        return {
            stepTime: this.lastStepTime,
            collisionTime: timers.broadphaseMs + timers.collideMs,
            solveTime: timers.solveVelocitiesMs + timers.solvePositionsMs,
            broadphaseTime: timers.broadphaseMs,
            narrowphaseTime: timers.collideMs,
            sweepSortTime: timers.sweepSortMs,
            pairLoopTime: timers.pairLoopMs,
            solveVelocityTime: timers.solveVelocitiesMs,
            solvePositionTime: timers.solvePositionsMs,
            sleepTime: null,
            sleepAndCacheSwapTime: timers.sleepAndCacheSwapMs,
            warmStartTime: null,
            persistTime: null,
            integrateVelocityTime: null,
            integratePositionTime: null,
            eventsTime: null
        };
    }

    getStepStatistics(): StepStatistics {
        this.ensureAlive();
        return this.physics.getStepStatistics();
    }

    getStatistics(): CompatStatistics {
        this.ensureAlive();
        return {
            bodyCount: this.physics.bodyCount,
            contactCount: this.physics.contactCount,
            ignoredConfigKeys: this.ignoredConfigKeys.slice()
        };
    }

    reset(): void {
        this.ensureAlive();
        this.physics.reset();
        this.bodyShapes.clear();
        this.shapeOwners.clear();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.listener = null;
        this.bodyShapes.clear();
        this.shapeOwners.clear();
        this.physics.dispose();
    }

    [Symbol.dispose](): void {
        this.dispose();
    }

    private applyConfig(config: CompatWorldConfig): void {
        assertConfigIterations(config.velocityIterations, "velocityIterations");
        assertConfigIterations(config.positionIterations, "positionIterations");
        assertConfigInteger(config.maxConstraints, "maxConstraints");
        if (config.maxConstraints !== undefined && config.maxConstraints <= 0) {
            throw new Error("maxConstraints must be positive");
        }

        if (config.allowSleep !== undefined) {
            this.physics.setAllowSleep(config.allowSleep === true);
        }
        if (config.maxConstraints !== undefined) {
            this.noteIgnoredConfigKey("maxConstraints");
        }
    }

    private collectUnknownConfigKeys(config: CompatWorldConfig): void {
        const known = new Set(COMPAT_KNOWN_CONFIG_KEYS);
        for (const key of Object.keys(config)) {
            if (!known.has(key)) {
                this.noteIgnoredConfigKey(key);
            }
        }
    }

    private noteIgnoredConfigKey(key: string): void {
        if (!this.ignoredConfigKeys.includes(key)) {
            this.ignoredConfigKeys.push(key);
        }
    }

    private registerShape(bodyId: number, shapeId: number): void {
        const ids = this.bodyShapes.get(bodyId);
        if (ids === undefined) {
            this.bodyShapes.set(bodyId, new Set([shapeId]));
        } else {
            ids.add(shapeId);
        }
        this.shapeOwners.set(shapeId, bodyId);
    }

    private forgetBodyShapes(bodyId: number): void {
        const ids = this.bodyShapes.get(bodyId);
        if (ids === undefined) {
            return;
        }
        for (const shapeId of ids) {
            this.shapeOwners.delete(shapeId);
        }
        this.bodyShapes.delete(bodyId);
    }

    private applyShapeMaterial(shapeId: number, material: CompatMaterial | undefined): void {
        if (material === undefined) {
            return;
        }
        this.physics.setShapeMaterial(shapeId, material.friction ?? 0.6, material.restitution ?? 0);
    }

    private dispatchContactEvents(): void {
        const listener = this.listener;
        if (listener === null) {
            return;
        }
        const events = this.physics.drainEvents();
        if (events.length === 0) {
            return;
        }
        const timestamp = eventTimestamp();
        for (const event of events) {
            switch (event.kind) {
                case "begin":
                    this.callCollision("onCollisionBegin", 0, listener, event, timestamp);
                    break;
                case "stay":
                    this.callCollision("onCollisionStay", 1, listener, event, timestamp);
                    break;
                case "end":
                    this.callCollision("onCollisionEnd", 2, listener, event, timestamp);
                    break;
                case "sensorEnter":
                    this.callSensor("onSensorEnter", 0, listener, event, timestamp);
                    break;
                case "sensorStay":
                    this.callSensor("onSensorStay", 1, listener, event, timestamp);
                    break;
                case "sensorExit":
                    this.callSensor("onSensorExit", 2, listener, event, timestamp);
                    break;
            }
        }
    }

    private callCollision(
        method: "onCollisionBegin" | "onCollisionStay" | "onCollisionEnd",
        type: CompatCollisionEventType,
        listener: CompatContactListener,
        event: ContactEventSnapshot,
        timestamp: number
    ): void {
        const handler = listener[method];
        if (handler === undefined) {
            return;
        }
        handler.call(listener, buildCollisionEvent(type, event, timestamp));
    }

    private callSensor(
        method: "onSensorEnter" | "onSensorStay" | "onSensorExit",
        type: CompatSensorEventType,
        listener: CompatContactListener,
        event: ContactEventSnapshot,
        timestamp: number
    ): void {
        const handler = listener[method];
        if (handler === undefined) {
            return;
        }
        handler.call(listener, buildSensorEvent(type, event, timestamp));
    }

    private ensureAlive(): void {
        if (this.disposed) {
            throw new Error("physics world compat adapter has been disposed");
        }
    }
}
