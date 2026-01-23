import type { IVec2Like, IVec3Like } from '@axrone/numeric';
import type {
    BodyId,
    ShapeId,
    ContactId,
    ManifoldId,
    Impulse,
} from './primitives';
export type { IContactManifold2D, IContactManifold3D, IContactPoint2D, IContactPoint3D } from './primitives';

export const enum CollisionEventType {
    Begin = 0,
    Stay = 1,
    End = 2,
    PreSolve = 3,
    PostSolve = 4,
}

export const enum SensorEventType {
    Enter = 0,
    Stay = 1,
    Exit = 2,
}

export interface ICollisionEvent2D {
    readonly type: CollisionEventType;
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
    readonly shapeIdA: ShapeId;
    readonly shapeIdB: ShapeId;
    readonly manifold: IContactManifold2D;
    readonly timestamp: number;
}

export interface ICollisionEvent3D {
    readonly type: CollisionEventType;
    readonly bodyIdA: BodyId;
    readonly bodyIdB: BodyId;
    readonly shapeIdA: ShapeId;
    readonly shapeIdB: ShapeId;
    readonly manifold: IContactManifold3D;
    readonly timestamp: number;
}

export interface ISensorEvent2D {
    readonly type: SensorEventType;
    readonly sensorBodyId: BodyId;
    readonly sensorShapeId: ShapeId;
    readonly visitorBodyId: BodyId;
    readonly visitorShapeId: ShapeId;
    readonly timestamp: number;
}

export interface ISensorEvent3D {
    readonly type: SensorEventType;
    readonly sensorBodyId: BodyId;
    readonly sensorShapeId: ShapeId;
    readonly visitorBodyId: BodyId;
    readonly visitorShapeId: ShapeId;
    readonly timestamp: number;
}

export interface ICollisionFilter {
    shouldCollide(shapeIdA: ShapeId, shapeIdB: ShapeId): boolean;
}

export interface IContactListener2D {
    onCollisionBegin?(event: ICollisionEvent2D): void;
    onCollisionStay?(event: ICollisionEvent2D): void;
    onCollisionEnd?(event: ICollisionEvent2D): void;
    onPreSolve?(event: ICollisionEvent2D, oldManifold: IContactManifold2D): void;
    onPostSolve?(event: ICollisionEvent2D, impulse: { normal: Impulse; tangent: Impulse }): void;
    onSensorEnter?(event: ISensorEvent2D): void;
    onSensorStay?(event: ISensorEvent2D): void;
    onSensorExit?(event: ISensorEvent2D): void;
}

export interface IContactListener3D {
    onCollisionBegin?(event: ICollisionEvent3D): void;
    onCollisionStay?(event: ICollisionEvent3D): void;
    onCollisionEnd?(event: ICollisionEvent3D): void;
    onPreSolve?(event: ICollisionEvent3D, oldManifold: IContactManifold3D): void;
    onPostSolve?(
        event: ICollisionEvent3D,
        impulse: { normal: Impulse; tangent1: Impulse; tangent2: Impulse }
    ): void;
    onSensorEnter?(event: ISensorEvent3D): void;
    onSensorStay?(event: ISensorEvent3D): void;
    onSensorExit?(event: ISensorEvent3D): void;
}

export interface IContactEdge2D {
    readonly contactId: ContactId;
    readonly otherBodyId: BodyId;
    readonly prev: IContactEdge2D | null;
    readonly next: IContactEdge2D | null;
}

export interface IContactEdge3D {
    readonly contactId: ContactId;
    readonly otherBodyId: BodyId;
    readonly prev: IContactEdge3D | null;
    readonly next: IContactEdge3D | null;
}

export interface IContact2D {
    readonly id: ContactId;
    readonly manifold: IContactManifold2D;
    readonly edgeA: IContactEdge2D;
    readonly edgeB: IContactEdge2D;
    readonly friction: number;
    readonly restitution: number;
    readonly tangentSpeed: number;
    readonly isEnabled: boolean;
    readonly isTouching: boolean;
    readonly childIndexA: number;
    readonly childIndexB: number;
}

export interface IContact3D {
    readonly id: ContactId;
    readonly manifold: IContactManifold3D;
    readonly edgeA: IContactEdge3D;
    readonly edgeB: IContactEdge3D;
    readonly friction: number;
    readonly restitution: number;
    readonly rollingFriction: number;
    readonly spinningFriction: number;
    readonly isEnabled: boolean;
    readonly isTouching: boolean;
}

export interface IRayInput2D {
    readonly origin: Readonly<IVec2Like>;
    readonly direction: Readonly<IVec2Like>;
    readonly maxFraction: number;
}

export interface IRayInput3D {
    readonly origin: Readonly<IVec3Like>;
    readonly direction: Readonly<IVec3Like>;
    readonly maxFraction: number;
}

export interface IShapeQueryInput2D {
    readonly shapeId: ShapeId;
    readonly transform: { position: IVec2Like; rotation: number };
}

export interface IShapeQueryInput3D {
    readonly shapeId: ShapeId;
    readonly transform: { position: IVec3Like; rotation: IVec3Like };
}

export interface IOverlapResult2D {
    readonly bodyId: BodyId;
    readonly shapeId: ShapeId;
}

export interface IOverlapResult3D {
    readonly bodyId: BodyId;
    readonly shapeId: ShapeId;
}

export interface IClosestPointInput2D {
    readonly pointA: Readonly<IVec2Like>;
    readonly pointB: Readonly<IVec2Like>;
    readonly shapeIdA: ShapeId;
    readonly shapeIdB: ShapeId;
    readonly transformA: { position: IVec2Like; rotation: number };
    readonly transformB: { position: IVec2Like; rotation: number };
}

export interface IClosestPointResult2D {
    readonly pointA: IVec2Like;
    readonly pointB: IVec2Like;
    readonly normal: IVec2Like;
    readonly distance: number;
    readonly iterations: number;
}

export interface IClosestPointInput3D {
    readonly pointA: Readonly<IVec3Like>;
    readonly pointB: Readonly<IVec3Like>;
    readonly shapeIdA: ShapeId;
    readonly shapeIdB: ShapeId;
    readonly transformA: { position: IVec3Like; rotation: IVec3Like };
    readonly transformB: { position: IVec3Like; rotation: IVec3Like };
}

export interface IClosestPointResult3D {
    readonly pointA: IVec3Like;
    readonly pointB: IVec3Like;
    readonly normal: IVec3Like;
    readonly distance: number;
    readonly iterations: number;
}

export interface ITimeOfImpactInput2D {
    readonly shapeIdA: ShapeId;
    readonly shapeIdB: ShapeId;
    readonly sweepA: {
        readonly c0: IVec2Like;
        readonly c: IVec2Like;
        readonly a0: number;
        readonly a: number;
        readonly localCenter: IVec2Like;
    };
    readonly sweepB: {
        readonly c0: IVec2Like;
        readonly c: IVec2Like;
        readonly a0: number;
        readonly a: number;
        readonly localCenter: IVec2Like;
    };
    readonly tMax: number;
}

export interface ITimeOfImpactResult {
    readonly state: TOIState;
    readonly t: number;
}

export const enum TOIState {
    Unknown = 0,
    Failed = 1,
    Overlapped = 2,
    Touching = 3,
    Separated = 4,
}

export interface IGJK2DOutput {
    readonly pointA: IVec2Like;
    readonly pointB: IVec2Like;
    readonly distance: number;
    readonly iterations: number;
}

export interface IEPA2DOutput {
    readonly penetrationDepth: number;
    readonly normal: IVec2Like;
    readonly witnesses: { a: IVec2Like; b: IVec2Like };
}

export interface ISupportPoint2D {
    readonly point: IVec2Like;
    readonly indexA: number;
    readonly indexB: number;
}

export interface ISimplex2D {
    readonly vertices: ISupportPoint2D[];
    readonly count: number;
}

export interface ICollisionPair {
    readonly shapeIdA: ShapeId;
    readonly shapeIdB: ShapeId;
}

export type CollisionCallback2D = (
    shapeIdA: ShapeId,
    shapeIdB: ShapeId,
    manifold: IContactManifold2D
) => void;

export type CollisionCallback3D = (
    shapeIdA: ShapeId,
    shapeIdB: ShapeId,
    manifold: IContactManifold3D
) => void;

export type RaycastCallback2D = (
    shapeId: ShapeId,
    point: Readonly<IVec2Like>,
    normal: Readonly<IVec2Like>,
    fraction: number
) => number;

export type RaycastCallback3D = (
    shapeId: ShapeId,
    point: Readonly<IVec3Like>,
    normal: Readonly<IVec3Like>,
    fraction: number
) => number;
