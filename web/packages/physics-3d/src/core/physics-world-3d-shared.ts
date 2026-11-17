import { Vec3, Quat, clamp } from '@axrone/numeric';
export { clamp } from '@axrone/numeric';
import type { IQuatLike, IVec3Like } from '@axrone/numeric';
import type {
    ContactId,
    Density,
    Friction,
    IContactManifold3D,
    IContactPoint3D,
    Impulse,
    IMaterial,
    ManifoldId,
    Restitution,
} from '../types';
import type {
    BodyId3D,
    ConstraintId3D,
    IBoxShapeDef3D,
    ICapsuleShapeDef3D,
    ICollisionFilter3D,
    IConeShapeDef3D,
    IConeTwistConstraintDef3D,
    IConvexHullShapeDef3D,
    ICylinderShapeDef3D,
    IFixedConstraintDef3D,
    IGenericConstraintDef3D,
    IHeightFieldShapeDef3D,
    IHingeConstraintDef3D,
    IQueryFilter3D,
    ISliderConstraintDef3D,
    ISphereShapeDef3D,
    ISpringConstraintDef3D,
    ITriangleMeshShapeDef3D,
    ShapeId3D,
} from '../types/physics-3d';

export const BODY_TYPE_STATIC = 0;
export const BODY_TYPE_DYNAMIC = 2;

export const SHAPE_TYPE_CAPSULE = 1;
export const SHAPE_TYPE_BOX = 3;
export const SHAPE_TYPE_SPHERE = 5;
export const SHAPE_TYPE_CYLINDER = 6;
export const SHAPE_TYPE_CONE = 7;
export const SHAPE_TYPE_CONVEX_HULL = 8;
export const SHAPE_TYPE_TRIANGLE_MESH = 9;
export const SHAPE_TYPE_HEIGHTFIELD = 10;

export const CONSTRAINT_TYPE_FIXED = 0;
export const CONSTRAINT_TYPE_HINGE = 2;
export const CONSTRAINT_TYPE_SLIDER = 3;
export const CONSTRAINT_TYPE_CONE_TWIST = 4;
export const CONSTRAINT_TYPE_GENERIC = 5;
export const CONSTRAINT_TYPE_SPRING = 6;

export const CONTACT_BREAK_THRESHOLD = 0.02;

export type SupportedShapeDef3D =
    | ({ readonly kind: typeof SHAPE_TYPE_SPHERE } & ISphereShapeDef3D)
    | ({ readonly kind: typeof SHAPE_TYPE_BOX } & IBoxShapeDef3D)
    | ({ readonly kind: typeof SHAPE_TYPE_CAPSULE } & ICapsuleShapeDef3D)
    | ({ readonly kind: typeof SHAPE_TYPE_CYLINDER } & ICylinderShapeDef3D)
    | ({ readonly kind: typeof SHAPE_TYPE_CONE } & IConeShapeDef3D)
    | ({ readonly kind: typeof SHAPE_TYPE_CONVEX_HULL } & IConvexHullShapeDef3D)
    | ({ readonly kind: typeof SHAPE_TYPE_TRIANGLE_MESH } & ITriangleMeshShapeDef3D)
    | ({ readonly kind: typeof SHAPE_TYPE_HEIGHTFIELD } & IHeightFieldShapeDef3D);

export type SupportedConstraintDef3D =
    | ({ readonly kind: typeof CONSTRAINT_TYPE_FIXED } & IFixedConstraintDef3D)
    | ({ readonly kind: typeof CONSTRAINT_TYPE_HINGE } & IHingeConstraintDef3D)
    | ({ readonly kind: typeof CONSTRAINT_TYPE_SLIDER } & ISliderConstraintDef3D)
    | ({ readonly kind: typeof CONSTRAINT_TYPE_SPRING } & ISpringConstraintDef3D)
    | ({ readonly kind: typeof CONSTRAINT_TYPE_CONE_TWIST } & IConeTwistConstraintDef3D)
    | ({ readonly kind: typeof CONSTRAINT_TYPE_GENERIC } & IGenericConstraintDef3D);

export interface IShapeDescriptor3D {
    readonly id: ShapeId3D;
    readonly bodyId: BodyId3D;
    readonly type: number;
    readonly def: SupportedShapeDef3D;
    material: IMaterial;
    isSensor: boolean;
    filter: ICollisionFilter3D;
    userData?: unknown;
    /**
     * Per-step derived transform data, refreshed while the broadphase computes
     * this shape's AABB and reused by the box–box narrowphase. Objects are
     * mutated in place, so callers must not retain them past the current step.
     */
    frame?: IShapeFrame3D;
}

/**
 * Mutable world-space transform data for one shape, computed once per step.
 *
 * Before this cache existed, a box–box pair re-derived the same centre, world
 * rotation and basis axes three times (SAT test, face clipping, manifold
 * points), each pass costing several `Map` lookups on bigint body ids plus
 * temporary vector objects. The fields mirror exactly what
 * `transformPoint3D` / `Quat.multiply` / `Quat.rotateVector` produce, so the
 * narrowphase arithmetic is unchanged — only its input lookups disappear.
 */
export interface IShapeFrame3D {
    readonly bodyPosition: { x: number; y: number; z: number };
    readonly bodyRotation: { x: number; y: number; z: number; w: number };
    readonly center: { x: number; y: number; z: number };
    readonly rotation: { x: number; y: number; z: number; w: number };
    readonly axes: [
        { x: number; y: number; z: number },
        { x: number; y: number; z: number },
        { x: number; y: number; z: number },
    ];
    /** Step token this frame was refreshed at; stale frames must be recomputed. */
    generation: number;
}

export interface IConstraintDescriptor3D {
    readonly id: ConstraintId3D;
    readonly type: number;
    readonly def: SupportedConstraintDef3D;
    enabled: boolean;
    readonly collideConnected: boolean;
    userData?: unknown;
}

export interface IShapeOptions3D {
    readonly isSensor?: boolean;
    readonly userData?: unknown;
}

export interface IAabb3D {
    readonly min: IVec3Like;
    readonly max: IVec3Like;
}

export interface IShapeRayHit3D {
    readonly fraction: number;
    readonly normal: IVec3Like;
}

export interface IMutableContactPoint3D extends IContactPoint3D {
    id: ContactId;
    localPointA: IVec3Like;
    localPointB: IVec3Like;
    normalImpulse: Impulse;
    tangentImpulse1: Impulse;
    tangentImpulse2: Impulse;
    separation: number;
}

export interface IMutableContactManifold3D extends IContactManifold3D {
    id: ManifoldId;
    bodyIdA: BodyId3D;
    bodyIdB: BodyId3D;
    shapeIdA: ShapeId3D;
    shapeIdB: ShapeId3D;
    normal: IVec3Like;
    tangent1: IVec3Like;
    tangent2: IVec3Like;
    pointCount: number;
    points: IMutableContactPoint3D[];
}

export interface IResolvedContactManifold3D extends IMutableContactManifold3D {
    readonly pairKey: number;
    readonly descriptorA: IShapeDescriptor3D;
    readonly descriptorB: IShapeDescriptor3D;
    readonly sensor: boolean;
    readonly friction: number;
    readonly restitution: number;
    /**
     * Offset of this manifold's block inside the contact solver cache, or -1
     * when it has not been prepared for the current step. Internal solver state
     * (see PhysicsWorld3DSolver.prepareContact); rebuilt manifolds start over.
     */
    solverOffset: number;
}

export interface IShapePairCandidate3D {
    readonly descriptorA: IShapeDescriptor3D;
    readonly descriptorB: IShapeDescriptor3D;
    readonly aabbA: IAabb3D;
    readonly aabbB: IAabb3D;
    readonly pairKey: number;
}

export const IDENTITY_ROTATION: IQuatLike = { x: 0, y: 0, z: 0, w: 1 };
// Canonical 3D material defaults (P1-28): friction=0.4, restitution=0, density=1.
// ShapeManager3D._createShape uses these same defaults — both paths (component
// via Collider3D and raw via BodyManager3D/ShapeManager3D) produce identical results.
export const DEFAULT_MATERIAL: IMaterial = {
    friction: 0.4 as unknown as Friction,
    restitution: 0 as unknown as Restitution,
    density: 1 as unknown as Density,
};
// Canonical 3D filter defaults (P1-28): maskBits=0xffff (all layers).
export const DEFAULT_FILTER: ICollisionFilter3D = { categoryBits: 1, maskBits: 0xffff, groupIndex: 0 };

export function componentMin(a: Readonly<IVec3Like>, b: Readonly<IVec3Like>): IVec3Like {
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) };
}

export function componentMax(a: Readonly<IVec3Like>, b: Readonly<IVec3Like>): IVec3Like {
    return { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) };
}

export function midpointVec3(a: Readonly<IVec3Like>, b: Readonly<IVec3Like>): IVec3Like {
    return Vec3.multiplyScalar(Vec3.add(a, b), 0.5);
}

export function normalizeVec3(v: Readonly<IVec3Like>): IVec3Like {
    const len = Vec3.len(v);
    if (len < 1e-10) return { x: 0, y: 0, z: 0 };
    return Vec3.multiplyScalar(v, 1 / len);
}

export function inverseVec3(v: Readonly<IVec3Like>): IVec3Like {
    return {
        x: v.x > 0 ? 1 / v.x : 0,
        y: v.y > 0 ? 1 / v.y : 0,
        z: v.z > 0 ? 1 / v.z : 0,
    };
}

export function cylinderConeLocalHalfExtents(
    axis: number,
    radius: number,
    height: number
): IVec3Like {
    const half = height * 0.5;
    return axis === 0
        ? { x: half, y: radius, z: radius }
        : axis === 2
          ? { x: radius, y: radius, z: half }
          : { x: radius, y: half, z: radius };
}

export function transformPoint3D(
    point: Readonly<IVec3Like>,
    position: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>
): IVec3Like {
    return Vec3.add(Quat.rotateVector(rotation, point), position);
}

export function transformDirection3D(
    direction: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>
): IVec3Like {
    return Quat.rotateVector(rotation, direction);
}

export function inverseTransformPoint3D(
    point: Readonly<IVec3Like>,
    position: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>
): IVec3Like {
    return Quat.rotateVector(Quat.conjugate(rotation), Vec3.subtract(point, position));
}

export function expandAabb(aabb: IAabb3D, point: Readonly<IVec3Like>): IAabb3D {
    return {
        min: componentMin(aabb.min, point),
        max: componentMax(aabb.max, point),
    };
}

export function intersectsAabb(a: IAabb3D, b: IAabb3D): boolean {
    return !(
        a.max.x < b.min.x ||
        a.min.x > b.max.x ||
        a.max.y < b.min.y ||
        a.min.y > b.max.y ||
        a.max.z < b.min.z ||
        a.min.z > b.max.z
    );
}

export function makeMaterial(material?: Partial<IMaterial>): IMaterial {
    return {
        friction: material?.friction ?? DEFAULT_MATERIAL.friction,
        restitution: material?.restitution ?? DEFAULT_MATERIAL.restitution,
        density: material?.density ?? DEFAULT_MATERIAL.density,
        ...(material?.rollingFriction !== undefined
            ? { rollingFriction: material.rollingFriction }
            : {}),
        ...(material?.spinningFriction !== undefined
            ? { spinningFriction: material.spinningFriction }
            : {}),
    };
}

export function makeFilter(filter?: ICollisionFilter3D): ICollisionFilter3D {
    return {
        categoryBits: filter?.categoryBits ?? DEFAULT_FILTER.categoryBits,
        maskBits: filter?.maskBits ?? DEFAULT_FILTER.maskBits,
        groupIndex: filter?.groupIndex ?? DEFAULT_FILTER.groupIndex,
    };
}

export function supportsQueryFilter(shapeFilter: Readonly<ICollisionFilter3D>, filter?: IQueryFilter3D): boolean {
    if (!filter) return true;
    if (filter.groupIndex !== undefined && shapeFilter.groupIndex !== filter.groupIndex) {
        return false;
    }
    if (
        filter.categoryBits !== undefined &&
        (shapeFilter.categoryBits & filter.categoryBits) === 0
    ) {
        return false;
    }
    if (filter.maskBits !== undefined && (shapeFilter.maskBits & filter.maskBits) === 0) {
        return false;
    }
    return true;
}

export function shouldShapeFiltersCollide(
    filterA: Readonly<ICollisionFilter3D>,
    filterB: Readonly<ICollisionFilter3D>
): boolean {
    if (filterA.groupIndex !== 0 && filterA.groupIndex === filterB.groupIndex) {
        return filterA.groupIndex > 0;
    }

    return (
        (filterA.maskBits & filterB.categoryBits) !== 0 &&
        (filterB.maskBits & filterA.categoryBits) !== 0
    );
}

export function buildOrthonormalBasis(normal: Readonly<IVec3Like>): { tangent1: IVec3Like; tangent2: IVec3Like } {
    const tangentSeed =
        Math.abs(normal.x) < 0.57735
            ? { x: 1, y: 0, z: 0 }
            : Math.abs(normal.y) < 0.57735
              ? { x: 0, y: 1, z: 0 }
              : { x: 0, y: 0, z: 1 };
    const tangent1 = Vec3.normalize(Vec3.cross(normal, tangentSeed));
    const tangent2 = Vec3.normalize(Vec3.cross(normal, tangent1));
    return { tangent1, tangent2 };
}

export function getAxisVector(axis: 0 | 1 | 2 | undefined): IVec3Like {
    switch (axis ?? 1) {
        case 0:
            return { x: 1, y: 0, z: 0 };
        case 2:
            return { x: 0, y: 0, z: 1 };
        default:
            return { x: 0, y: 1, z: 0 };
    }
}

export function getBoxWorldExtents(
    halfExtents: Readonly<IVec3Like>,
    rotation: Readonly<IQuatLike>
): IVec3Like {
    const xx = rotation.x * rotation.x;
    const yy = rotation.y * rotation.y;
    const zz = rotation.z * rotation.z;
    const xy = rotation.x * rotation.y;
    const xz = rotation.x * rotation.z;
    const yz = rotation.y * rotation.z;
    const wx = rotation.w * rotation.x;
    const wy = rotation.w * rotation.y;
    const wz = rotation.w * rotation.z;

    const m00 = 1 - 2 * (yy + zz);
    const m01 = 2 * (xy - wz);
    const m02 = 2 * (xz + wy);
    const m10 = 2 * (xy + wz);
    const m11 = 1 - 2 * (xx + zz);
    const m12 = 2 * (yz - wx);
    const m20 = 2 * (xz - wy);
    const m21 = 2 * (yz + wx);
    const m22 = 1 - 2 * (xx + yy);

    return {
        x:
            Math.abs(m00) * halfExtents.x +
            Math.abs(m01) * halfExtents.y +
            Math.abs(m02) * halfExtents.z,
        y:
            Math.abs(m10) * halfExtents.x +
            Math.abs(m11) * halfExtents.y +
            Math.abs(m12) * halfExtents.z,
        z:
            Math.abs(m20) * halfExtents.x +
            Math.abs(m21) * halfExtents.y +
            Math.abs(m22) * halfExtents.z,
    };
}

export function linePointDistanceSquared(
    point: Readonly<IVec3Like>,
    lineStart: Readonly<IVec3Like>,
    lineEnd: Readonly<IVec3Like>
): number {
    const line = Vec3.subtract(lineEnd, lineStart);
    const lineLengthSquared = Vec3.lengthSquared(line);
    if (lineLengthSquared <= 1e-10) {
        return Vec3.lengthSquared(Vec3.subtract(point, lineStart));
    }

    const t = clamp(Vec3.dot(Vec3.subtract(point, lineStart), line) / lineLengthSquared, 0, 1);
    const closestPoint = Vec3.add(lineStart, Vec3.multiplyScalar(line, t));
    return Vec3.lengthSquared(Vec3.subtract(point, closestPoint));
}

export function triangleNormal(
    a: Readonly<IVec3Like>,
    b: Readonly<IVec3Like>,
    c: Readonly<IVec3Like>
): IVec3Like {
    return Vec3.normalize(Vec3.cross(Vec3.subtract(b, a), Vec3.subtract(c, a)));
}

export function rayTriangleHit(
    origin: Readonly<IVec3Like>,
    direction: Readonly<IVec3Like>,
    a: Readonly<IVec3Like>,
    b: Readonly<IVec3Like>,
    c: Readonly<IVec3Like>,
    maxFraction: number
): IShapeRayHit3D | null {
    const edge1 = Vec3.subtract(b, a);
    const edge2 = Vec3.subtract(c, a);
    const p = Vec3.cross(direction, edge2);
    const determinant = Vec3.dot(edge1, p);

    if (Math.abs(determinant) <= 1e-10) {
        return null;
    }

    const inverseDeterminant = 1 / determinant;
    const t = Vec3.subtract(origin, a);
    const u = Vec3.dot(t, p) * inverseDeterminant;
    if (u < 0 || u > 1) {
        return null;
    }

    const q = Vec3.cross(t, edge1);
    const v = Vec3.dot(direction, q) * inverseDeterminant;
    if (v < 0 || u + v > 1) {
        return null;
    }

    const fraction = Vec3.dot(edge2, q) * inverseDeterminant;
    if (fraction < 0 || fraction > maxFraction) {
        return null;
    }

    const normal = triangleNormal(a, b, c);
    return {
        fraction,
        normal: Vec3.dot(normal, direction) > 0 ? Vec3.multiplyScalar(normal, -1) : normal,
    };
}

export function getHeightFieldLocalVertex(
    def: Readonly<IHeightFieldShapeDef3D>,
    xIndex: number,
    zIndex: number
): IVec3Like {
    const halfWidth = (def.width - 1) * 0.5;
    const halfDepth = (def.depth - 1) * 0.5;
    return {
        x: (xIndex - halfWidth) * def.scaleX,
        y: def.heights[zIndex * def.width + xIndex] * def.scaleY,
        z: (zIndex - halfDepth) * def.scaleZ,
    };
}

export function raySphereHit(
    origin: Readonly<IVec3Like>,
    direction: Readonly<IVec3Like>,
    center: Readonly<IVec3Like>,
    radius: number,
    maxFraction: number
): IShapeRayHit3D | null {
    const m = Vec3.subtract(origin, center);
    const a = Vec3.dot(direction, direction);
    const b = Vec3.dot(m, direction);
    const c = Vec3.dot(m, m) - radius * radius;

    if (c <= 0) {
        return { fraction: 0, normal: Vec3.normalize(m) };
    }
    if (a <= 1e-10) {
        return null;
    }

    const discriminant = b * b - a * c;
    if (discriminant < 0) {
        return null;
    }

    const fraction = (-b - Math.sqrt(discriminant)) / a;
    if (fraction < 0 || fraction > maxFraction) {
        return null;
    }

    const hitPoint = Vec3.add(origin, Vec3.multiplyScalar(direction, fraction));
    return { fraction, normal: Vec3.normalize(Vec3.subtract(hitPoint, center)) };
}

export function isSphereDef(def: SupportedShapeDef3D): def is { readonly kind: typeof SHAPE_TYPE_SPHERE } & ISphereShapeDef3D {
    return def.kind === SHAPE_TYPE_SPHERE;
}

export function isBoxDef(def: SupportedShapeDef3D): def is { readonly kind: typeof SHAPE_TYPE_BOX } & IBoxShapeDef3D {
    return def.kind === SHAPE_TYPE_BOX;
}

export function isCapsuleDef(def: SupportedShapeDef3D): def is { readonly kind: typeof SHAPE_TYPE_CAPSULE } & ICapsuleShapeDef3D {
    return def.kind === SHAPE_TYPE_CAPSULE;
}

export function isCylinderDef(def: SupportedShapeDef3D): def is { readonly kind: typeof SHAPE_TYPE_CYLINDER } & ICylinderShapeDef3D {
    return def.kind === SHAPE_TYPE_CYLINDER;
}

export function isConeDef(def: SupportedShapeDef3D): def is { readonly kind: typeof SHAPE_TYPE_CONE } & IConeShapeDef3D {
    return def.kind === SHAPE_TYPE_CONE;
}

export function isConvexHullDef(def: SupportedShapeDef3D): def is { readonly kind: typeof SHAPE_TYPE_CONVEX_HULL } & IConvexHullShapeDef3D {
    return def.kind === SHAPE_TYPE_CONVEX_HULL;
}

export function isTriangleMeshDef(def: SupportedShapeDef3D): def is { readonly kind: typeof SHAPE_TYPE_TRIANGLE_MESH } & ITriangleMeshShapeDef3D {
    return def.kind === SHAPE_TYPE_TRIANGLE_MESH;
}

export function isHeightFieldDef(def: SupportedShapeDef3D): def is { readonly kind: typeof SHAPE_TYPE_HEIGHTFIELD } & IHeightFieldShapeDef3D {
    return def.kind === SHAPE_TYPE_HEIGHTFIELD;
}

export function isFixedDef(def: SupportedConstraintDef3D): def is { readonly kind: typeof CONSTRAINT_TYPE_FIXED } & IFixedConstraintDef3D {
    return def.kind === CONSTRAINT_TYPE_FIXED;
}

export function isHingeDef(def: SupportedConstraintDef3D): def is { readonly kind: typeof CONSTRAINT_TYPE_HINGE } & IHingeConstraintDef3D {
    return def.kind === CONSTRAINT_TYPE_HINGE;
}

export function isSliderDef(def: SupportedConstraintDef3D): def is { readonly kind: typeof CONSTRAINT_TYPE_SLIDER } & ISliderConstraintDef3D {
    return def.kind === CONSTRAINT_TYPE_SLIDER;
}

export function isSpringDef(def: SupportedConstraintDef3D): def is { readonly kind: typeof CONSTRAINT_TYPE_SPRING } & ISpringConstraintDef3D {
    return def.kind === CONSTRAINT_TYPE_SPRING;
}

export function isConeTwistDef(def: SupportedConstraintDef3D): def is { readonly kind: typeof CONSTRAINT_TYPE_CONE_TWIST } & IConeTwistConstraintDef3D {
    return def.kind === CONSTRAINT_TYPE_CONE_TWIST;
}

export function isGenericDef(def: SupportedConstraintDef3D): def is { readonly kind: typeof CONSTRAINT_TYPE_GENERIC } & IGenericConstraintDef3D {
    return def.kind === CONSTRAINT_TYPE_GENERIC;
}

export function rayAabbHit(
    origin: Readonly<IVec3Like>,
    direction: Readonly<IVec3Like>,
    min: Readonly<IVec3Like>,
    max: Readonly<IVec3Like>,
    maxFraction: number
): IShapeRayHit3D | null {
    let tMin = 0;
    let tMax = maxFraction;
    let normal: IVec3Like = { x: 0, y: 0, z: 0 };

    for (const axis of ['x', 'y', 'z'] as const) {
        const originComponent = origin[axis];
        const directionComponent = direction[axis];
        const minComponent = min[axis];
        const maxComponent = max[axis];

        if (Math.abs(directionComponent) <= 1e-10) {
            if (originComponent < minComponent || originComponent > maxComponent) {
                return null;
            }
            continue;
        }

        const inverseDirection = 1 / directionComponent;
        let t1 = (minComponent - originComponent) * inverseDirection;
        let t2 = (maxComponent - originComponent) * inverseDirection;
        let axisNormal: IVec3Like =
            axis === 'x'
                ? { x: -1, y: 0, z: 0 }
                : axis === 'y'
                  ? { x: 0, y: -1, z: 0 }
                  : { x: 0, y: 0, z: -1 };

        if (t1 > t2) {
            const swap = t1;
            t1 = t2;
            t2 = swap;
            axisNormal = Vec3.multiplyScalar(axisNormal, -1);
        }

        if (t1 > tMin) {
            tMin = t1;
            normal = axisNormal;
        }
        tMax = Math.min(tMax, t2);

        if (tMin > tMax) {
            return null;
        }
    }

    return { fraction: tMin, normal };
}