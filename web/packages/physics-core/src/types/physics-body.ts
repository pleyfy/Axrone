import type { IQuatLike, IVec2Like, IVec3Like } from '@axrone/numeric';
import type {
    BodyId,
    ShapeId,
    BodyType,
    BodyFlags,
    Mass,
    Inertia,
    IMassData2D,
    IMassData3D,
    IMaterial,
    ITransform2D,
    ITransform3D,
    IVelocity2D,
    IVelocity3D,
    Friction,
    Restitution,
    Density,
    CollisionFilter,
} from './primitives';

export interface IPhysicsBodyDef2D {
    readonly type: BodyType;
    readonly position?: Readonly<IVec2Like>;
    readonly rotation?: number;
    readonly linearVelocity?: Readonly<IVec2Like>;
    readonly angularVelocity?: number;
    readonly linearDamping?: number;
    readonly angularDamping?: number;
    readonly gravityScale?: number;
    readonly flags?: BodyFlags;
    readonly allowSleep?: boolean;
    readonly awake?: boolean;
    readonly fixedRotation?: boolean;
    readonly bullet?: boolean;
    readonly enabled?: boolean;
    readonly userData?: unknown;
}

export interface IPhysicsBodyDef3D {
    readonly type: BodyType;
    readonly position?: Readonly<IVec3Like>;
    readonly rotation?: Readonly<IQuatLike>;
    readonly linearVelocity?: Readonly<IVec3Like>;
    readonly angularVelocity?: Readonly<IVec3Like>;
    readonly linearDamping?: number;
    readonly angularDamping?: number;
    readonly gravityScale?: number;
    readonly flags?: BodyFlags;
    readonly allowSleep?: boolean;
    readonly awake?: boolean;
    readonly fixedRotation?: boolean;
    readonly bullet?: boolean;
    readonly enabled?: boolean;
    readonly userData?: unknown;
}

export interface IPhysicsBody2D {
    readonly id: BodyId;
    readonly type: BodyType;
    readonly transform: ITransform2D;
    readonly velocity: IVelocity2D;
    readonly massData: IMassData2D;
    readonly shapes: readonly ShapeId[];
    readonly flags: BodyFlags;
    readonly gravityScale: number;
    readonly linearDamping: number;
    readonly angularDamping: number;
    readonly sleepTime: number;
    readonly userData?: unknown;

    applyForce(force: Readonly<IVec2Like>, point?: Readonly<IVec2Like>): void;
    applyForceToCenter(force: Readonly<IVec2Like>): void;
    applyTorque(torque: number): void;
    applyImpulse(impulse: Readonly<IVec2Like>, point?: Readonly<IVec2Like>): void;
    applyImpulseToCenter(impulse: Readonly<IVec2Like>): void;
    applyAngularImpulse(impulse: number): void;

    getPosition(): Readonly<IVec2Like>;
    setPosition(position: Readonly<IVec2Like>): void;
    getRotation(): number;
    setRotation(angle: number): void;
    getTransform(): ITransform2D;
    setTransform(position: Readonly<IVec2Like>, angle: number): void;

    getLinearVelocity(): Readonly<IVec2Like>;
    setLinearVelocity(velocity: Readonly<IVec2Like>): void;
    getAngularVelocity(): number;
    setAngularVelocity(velocity: number): void;

    getLocalPoint(worldPoint: Readonly<IVec2Like>): IVec2Like;
    getWorldPoint(localPoint: Readonly<IVec2Like>): IVec2Like;
    getLocalVector(worldVector: Readonly<IVec2Like>): IVec2Like;
    getWorldVector(localVector: Readonly<IVec2Like>): IVec2Like;
    getLinearVelocityAtPoint(point: Readonly<IVec2Like>): IVec2Like;

    getMass(): Mass;
    getInertia(): Inertia;
    getMassData(): IMassData2D;
    setMassData(massData: IMassData2D): void;
    resetMassData(): void;

    isSleeping(): boolean;
    setSleeping(sleeping: boolean): void;
    isAwake(): boolean;
    setAwake(awake: boolean): void;
    isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
    isFixedRotation(): boolean;
    setFixedRotation(fixed: boolean): void;
    isBullet(): boolean;
    setBullet(bullet: boolean): void;

    getWorldCenter(): Readonly<IVec2Like>;
    getLocalCenter(): Readonly<IVec2Like>;
}

export interface IPhysicsBody3D {
    readonly id: BodyId;
    readonly type: BodyType;
    readonly transform: ITransform3D;
    readonly velocity: IVelocity3D;
    readonly massData: IMassData3D;
    readonly shapes: readonly ShapeId[];
    readonly flags: BodyFlags;
    readonly gravityScale: number;
    readonly linearDamping: number;
    readonly angularDamping: number;
    readonly sleepTime: number;
    readonly userData?: unknown;

    applyForce(force: Readonly<IVec3Like>, point?: Readonly<IVec3Like>): void;
    applyForceToCenter(force: Readonly<IVec3Like>): void;
    applyTorque(torque: Readonly<IVec3Like>): void;
    applyImpulse(impulse: Readonly<IVec3Like>, point?: Readonly<IVec3Like>): void;
    applyImpulseToCenter(impulse: Readonly<IVec3Like>): void;
    applyAngularImpulse(impulse: Readonly<IVec3Like>): void;

    getPosition(): Readonly<IVec3Like>;
    setPosition(position: Readonly<IVec3Like>): void;
    getRotation(): Readonly<IQuatLike>;
    setRotation(rotation: Readonly<IQuatLike>): void;
    getTransform(): ITransform3D;
    setTransform(position: Readonly<IVec3Like>, rotation: Readonly<IQuatLike>): void;

    getLinearVelocity(): Readonly<IVec3Like>;
    setLinearVelocity(velocity: Readonly<IVec3Like>): void;
    getAngularVelocity(): Readonly<IVec3Like>;
    setAngularVelocity(velocity: Readonly<IVec3Like>): void;

    getLocalPoint(worldPoint: Readonly<IVec3Like>): IVec3Like;
    getWorldPoint(localPoint: Readonly<IVec3Like>): IVec3Like;
    getLocalVector(worldVector: Readonly<IVec3Like>): IVec3Like;
    getWorldVector(localVector: Readonly<IVec3Like>): IVec3Like;
    getLinearVelocityAtPoint(point: Readonly<IVec3Like>): IVec3Like;

    getMass(): Mass;
    getInertiaTensor(): Readonly<IVec3Like>;
    getMassData(): IMassData3D;
    setMassData(massData: IMassData3D): void;
    resetMassData(): void;

    isSleeping(): boolean;
    setSleeping(sleeping: boolean): void;
    isAwake(): boolean;
    setAwake(awake: boolean): void;
    isEnabled(): boolean;
    setEnabled(enabled: boolean): void;
    isFixedRotation(): boolean;
    setFixedRotation(fixed: boolean): void;
    isBullet(): boolean;
    setBullet(bullet: boolean): void;

    getWorldCenter(): Readonly<IVec3Like>;
    getLocalCenter(): Readonly<IVec3Like>;
}

export interface IShapeDef {
    readonly type?: number;
    readonly material?: IMaterial;
    readonly friction?: Friction;
    readonly restitution?: Restitution;
    readonly density?: Density;
    readonly isSensor?: boolean;
    readonly filter?: {
        readonly categoryBits: CollisionFilter;
        readonly maskBits: CollisionFilter;
        readonly groupIndex: number;
    };
    readonly userData?: unknown;
}

export interface ICircleShapeDef extends IShapeDef {
    readonly radius: number;
    readonly center?: Readonly<IVec2Like>;
    /** Legacy alias used in tests: same as `center` */
    readonly offset?: Readonly<IVec2Like>;
}

export interface ISphereShapeDef extends IShapeDef {
    readonly radius: number;
    readonly center: Readonly<IVec3Like>;
}

export interface IBoxShapeDef2D extends IShapeDef {
    /** Either provide halfWidth/halfHeight or width/height */
    readonly halfWidth?: number;
    readonly halfHeight?: number;
    readonly width?: number;
    readonly height?: number;
    readonly center?: Readonly<IVec2Like>;
    /** Legacy alias used in tests: same as `center` */
    readonly offset?: Readonly<IVec2Like>;
    readonly rotation?: number;
}

export interface IBoxShapeDef3D extends IShapeDef {
    readonly halfExtents: Readonly<IVec3Like>;
    readonly center: Readonly<IVec3Like>;
    readonly rotation?: Readonly<IQuatLike>;
}

export interface ICapsuleShapeDef2D extends IShapeDef {
    readonly radius: number;
    readonly length: number;
    readonly center?: Readonly<IVec2Like>;
    /** Legacy alias used in tests: same as `center` */
    readonly offset?: Readonly<IVec2Like>;
    readonly rotation?: number;
}

export interface ICapsuleShapeDef3D extends IShapeDef {
    readonly p1: Readonly<IVec3Like>;
    readonly p2: Readonly<IVec3Like>;
    readonly radius: number;
}

export interface IPolygonShapeDef extends IShapeDef {
    readonly vertices: readonly Readonly<IVec2Like>[];
}

export interface IConvexHullShapeDef extends IShapeDef {
    readonly vertices: readonly Readonly<IVec3Like>[];
}

export interface ISegmentShapeDef extends IShapeDef {
    readonly start: Readonly<IVec2Like>;
    readonly end: Readonly<IVec2Like>;
}

export interface ICylinderShapeDef extends IShapeDef {
    readonly center: Readonly<IVec3Like>;
    readonly radius: number;
    readonly height: number;
    readonly axis?: 0 | 1 | 2;
}

export interface IConeShapeDef extends IShapeDef {
    readonly center: Readonly<IVec3Like>;
    readonly radius: number;
    readonly height: number;
    readonly axis?: 0 | 1 | 2;
}

export interface IShape2D {
    readonly id: ShapeId;
    readonly bodyId: BodyId;
    readonly type: number;
    readonly material: IMaterial;
    readonly isSensor: boolean;
    readonly filter: {
        readonly categoryBits: CollisionFilter;
        readonly maskBits: CollisionFilter;
        readonly groupIndex: number;
    };
    readonly userData?: unknown;

    computeAABB(): { min: IVec2Like; max: IVec2Like };
    computeMassData(density: Density): IMassData2D;
    testPoint(point: Readonly<IVec2Like>): boolean;
    rayCast(
        origin: Readonly<IVec2Like>,
        direction: Readonly<IVec2Like>,
        maxFraction: number
    ): { hit: boolean; fraction: number; normal: IVec2Like } | null;
    getCenter(): IVec2Like;
}

export interface IShape3D {
    readonly id: ShapeId;
    readonly bodyId: BodyId;
    readonly type: number;
    readonly material: IMaterial;
    readonly isSensor: boolean;
    readonly filter: {
        readonly categoryBits: CollisionFilter;
        readonly maskBits: CollisionFilter;
        readonly groupIndex: number;
    };
    readonly userData?: unknown;

    computeAABB(): { min: IVec3Like; max: IVec3Like };
    computeMassData(density: Density): IMassData3D;
    testPoint(point: Readonly<IVec3Like>): boolean;
    rayCast(
        origin: Readonly<IVec3Like>,
        direction: Readonly<IVec3Like>,
        maxFraction: number
    ): { hit: boolean; fraction: number; normal: IVec3Like } | null;
    getCenter(): IVec3Like;
}
