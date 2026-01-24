import { Vec2, IVec2Like, EPSILON } from '@axrone/numeric';
import type { ShapeId, ContactId, IContactPoint2D } from '../types';
import type { IContactManifold2D } from '../types/collision';
import type { ShapeManager2D } from './shape-manager';
import { ShapeType } from '../types';
import { GJK2D, SAT2D } from './collision-algorithms';

const enum CollisionConfig {
    MAX_MANIFOLD_POINTS = 2,
    CONTACT_SLOP = 0.005,
    LINEAR_SLOP = 0.005,
    PERSISTENT_THRESHOLD_SQ = 0.0001,
}

interface CollisionContext {
    bodyIdA: number;
    bodyIdB: number;
    transformA: { position: IVec2Like; rotation: number };
    transformB: { position: IVec2Like; rotation: number };
}

type CollisionFn = (
    shapeA: any,
    shapeB: any,
    ctx: CollisionContext,
    manifold: WritableManifold
) => void;

interface WritableManifold {
    pointCount: number;
    normal: { x: number; y: number };
    points: Array<{
        id: ContactId;
        localPointA: { x: number; y: number };
        localPointB: { x: number; y: number };
        normalImpulse: number;
        tangentImpulse: number;
        separation: number;
    }>;
}

function collideCircleCircle(
    circleA: { center: IVec2Like; radius: number },
    circleB: { center: IVec2Like; radius: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldCenterA = transformPoint(circleA.center, ctx.transformA);
    const worldCenterB = transformPoint(circleB.center, ctx.transformB);

    const dx = worldCenterB.x - worldCenterA.x;
    const dy = worldCenterB.y - worldCenterA.y;
    const distSq = dx * dx + dy * dy;
    const radiusSum = circleA.radius + circleB.radius;
    const radiusSumSq = radiusSum * radiusSum;

    if (distSq > radiusSumSq || distSq < EPSILON * EPSILON) {
        manifold.pointCount = 0;
        return;
    }

    const dist = Math.sqrt(distSq);
    const invDist = 1 / dist;
    manifold.normal.x = dx * invDist;
    manifold.normal.y = dy * invDist;

    const separation = dist - radiusSum;
    const contactX = worldCenterA.x + manifold.normal.x * circleA.radius;
    const contactY = worldCenterA.y + manifold.normal.y * circleA.radius;

    manifold.pointCount = 1;
    const point = manifold.points[0];
    point.localPointA = inverseTransformPoint({ x: contactX, y: contactY }, ctx.transformA);
    point.localPointB = inverseTransformPoint({ x: contactX, y: contactY }, ctx.transformB);
    point.separation = separation;
}

function collideBoxBox(
    boxA: { center: IVec2Like; halfWidth: number; halfHeight: number; rotation: number },
    boxB: { center: IVec2Like; halfWidth: number; halfHeight: number; rotation: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const verticesA = getBoxVertices(boxA);
    const verticesB = getBoxVertices(boxB);

    const result = SAT2D.testPolygonPolygon(verticesA, verticesB, ctx.transformA, ctx.transformB);

    if (!result.colliding) {
        manifold.pointCount = 0;
        return;
    }

    manifold.normal.x = result.normal.x;
    manifold.normal.y = result.normal.y;
    manifold.pointCount = 1;

    const contactPoint = findContactPoint(verticesA, verticesB, result.normal, ctx);
    const point = manifold.points[0];
    point.localPointA = inverseTransformPoint(contactPoint, ctx.transformA);
    point.localPointB = inverseTransformPoint(contactPoint, ctx.transformB);
    point.separation = -result.penetration;
}

function collidePolygonPolygon(
    polyA: { vertices: IVec2Like[] },
    polyB: { vertices: IVec2Like[] },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const result = SAT2D.testPolygonPolygon(
        polyA.vertices,
        polyB.vertices,
        ctx.transformA,
        ctx.transformB
    );

    if (!result.colliding) {
        manifold.pointCount = 0;
        return;
    }

    manifold.normal.x = result.normal.x;
    manifold.normal.y = result.normal.y;

    const contacts = findPolygonContacts(
        polyA.vertices,
        polyB.vertices,
        result.normal,
        ctx,
        result.penetration
    );

    manifold.pointCount = Math.min(contacts.length, CollisionConfig.MAX_MANIFOLD_POINTS);
    for (let i = 0; i < manifold.pointCount; i++) {
        const point = manifold.points[i];
        point.localPointA = inverseTransformPoint(contacts[i], ctx.transformA);
        point.localPointB = inverseTransformPoint(contacts[i], ctx.transformB);
        point.separation = -result.penetration;
    }
}

function collideCircleBox(
    circle: { center: IVec2Like; radius: number },
    box: { center: IVec2Like; halfWidth: number; halfHeight: number; rotation: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldCenter = transformPoint(circle.center, ctx.transformA);
    const boxVertices = getBoxVertices(box);

    const closestPoint = findClosestPointOnPolygon(worldCenter, boxVertices, ctx.transformB);
    const dx = worldCenter.x - closestPoint.x;
    const dy = worldCenter.y - closestPoint.y;
    const distSq = dx * dx + dy * dy;

    if (distSq > circle.radius * circle.radius) {
        manifold.pointCount = 0;
        return;
    }

    const dist = Math.sqrt(distSq);
    const invDist = dist > EPSILON ? 1 / dist : 0;

    manifold.normal.x = dx * invDist;
    manifold.normal.y = dy * invDist;
    manifold.pointCount = 1;

    const point = manifold.points[0];
    point.localPointA = inverseTransformPoint(closestPoint, ctx.transformA);
    point.localPointB = inverseTransformPoint(closestPoint, ctx.transformB);
    point.separation = dist - circle.radius;
}

function collideCirclePolygon(
    circle: { center: IVec2Like; radius: number },
    poly: { vertices: IVec2Like[] },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldCenter = transformPoint(circle.center, ctx.transformA);
    const closestPoint = findClosestPointOnPolygon(worldCenter, poly.vertices, ctx.transformB);

    const dx = worldCenter.x - closestPoint.x;
    const dy = worldCenter.y - closestPoint.y;
    const distSq = dx * dx + dy * dy;

    if (distSq > circle.radius * circle.radius) {
        manifold.pointCount = 0;
        return;
    }

    const dist = Math.sqrt(distSq);
    const invDist = dist > EPSILON ? 1 / dist : 0;

    manifold.normal.x = dx * invDist;
    manifold.normal.y = dy * invDist;
    manifold.pointCount = 1;

    const point = manifold.points[0];
    point.localPointA = inverseTransformPoint(closestPoint, ctx.transformA);
    point.localPointB = inverseTransformPoint(closestPoint, ctx.transformB);
    point.separation = dist - circle.radius;
}

function collideCapsuleCapsule(
    capsuleA: { p1: IVec2Like; p2: IVec2Like; radius: number },
    capsuleB: { p1: IVec2Like; p2: IVec2Like; radius: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldA1 = transformPoint(capsuleA.p1, ctx.transformA);
    const worldA2 = transformPoint(capsuleA.p2, ctx.transformA);
    const worldB1 = transformPoint(capsuleB.p1, ctx.transformB);
    const worldB2 = transformPoint(capsuleB.p2, ctx.transformB);

    const { pointA, pointB, distSq } = closestPointsSegmentSegment(
        worldA1,
        worldA2,
        worldB1,
        worldB2
    );

    const radiusSum = capsuleA.radius + capsuleB.radius;
    if (distSq > radiusSum * radiusSum) {
        manifold.pointCount = 0;
        return;
    }

    const dist = Math.sqrt(distSq);
    const invDist = dist > EPSILON ? 1 / dist : 0;
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;

    manifold.normal.x = dx * invDist;
    manifold.normal.y = dy * invDist;
    manifold.pointCount = 1;

    const contactX = (pointA.x + pointB.x) * 0.5;
    const contactY = (pointA.y + pointB.y) * 0.5;

    const point = manifold.points[0];
    point.localPointA = inverseTransformPoint({ x: contactX, y: contactY }, ctx.transformA);
    point.localPointB = inverseTransformPoint({ x: contactX, y: contactY }, ctx.transformB);
    point.separation = dist - radiusSum;
}

function collideCircleCapsule(
    circle: { center: IVec2Like; radius: number },
    capsule: { p1: IVec2Like; p2: IVec2Like; radius: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldCenter = transformPoint(circle.center, ctx.transformA);
    const worldP1 = transformPoint(capsule.p1, ctx.transformB);
    const worldP2 = transformPoint(capsule.p2, ctx.transformB);

    const closestPoint = closestPointOnSegment(worldCenter, worldP1, worldP2);
    const dx = worldCenter.x - closestPoint.x;
    const dy = worldCenter.y - closestPoint.y;
    const distSq = dx * dx + dy * dy;

    const radiusSum = circle.radius + capsule.radius;
    if (distSq > radiusSum * radiusSum) {
        manifold.pointCount = 0;
        return;
    }

    const dist = Math.sqrt(distSq);
    const invDist = dist > EPSILON ? 1 / dist : 0;

    manifold.normal.x = dx * invDist;
    manifold.normal.y = dy * invDist;
    manifold.pointCount = 1;

    const point = manifold.points[0];
    point.localPointA = inverseTransformPoint(closestPoint, ctx.transformA);
    point.localPointB = inverseTransformPoint(closestPoint, ctx.transformB);
    point.separation = dist - radiusSum;
}

function collideCapsulePolygon(
    capsule: { p1: IVec2Like; p2: IVec2Like; radius: number },
    poly: { vertices: IVec2Like[] },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    manifold.pointCount = 0;
}

function collideBoxCapsule(
    box: { center: IVec2Like; halfWidth: number; halfHeight: number; rotation: number },
    capsule: { p1: IVec2Like; p2: IVec2Like; radius: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    manifold.pointCount = 0;
}

const collideCapsuleCircle = (a: any, b: any, ctx: CollisionContext, m: WritableManifold) =>
    collideCircleCapsule(
        b,
        a,
        { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA },
        m
    );
const collidePolygonCircle = (a: any, b: any, ctx: CollisionContext, m: WritableManifold) =>
    collideCirclePolygon(
        b,
        a,
        { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA },
        m
    );
const collideBoxCircle = (a: any, b: any, ctx: CollisionContext, m: WritableManifold) =>
    collideCircleBox(b, a, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, m);
const collidePolygonCapsule = (a: any, b: any, ctx: CollisionContext, m: WritableManifold) =>
    collideCapsulePolygon(
        b,
        a,
        { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA },
        m
    );
const collideBoxPolygon = collidePolygonPolygon;
const collidePolygonBox = collideBoxPolygon;
const collideCapsuleBox = (a: any, b: any, ctx: CollisionContext, m: WritableManifold) =>
    collideBoxCapsule(b, a, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, m);

const COLLISION_MATRIX: ReadonlyArray<ReadonlyArray<CollisionFn | null>> = [
    [collideCircleCircle, collideCircleCapsule, collideCirclePolygon, collideCircleBox, null],
    [collideCapsuleCircle, collideCapsuleCapsule, collideCapsulePolygon, collideCapsuleBox, null],
    [collidePolygonCircle, collidePolygonCapsule, collidePolygonPolygon, collidePolygonBox, null],
    [collideBoxCircle, collideBoxCapsule, collideBoxPolygon, collideBoxBox, null],
    [null, null, null, null, null],
] as const;

export class Narrowphase2D {
    private readonly _tempVec: Vec2;
    private readonly _manifoldPool: WritableManifold[];
    private _poolIndex: number = 0;

    constructor() {
        this._tempVec = Vec2.ZERO.clone();
        this._manifoldPool = Array.from({ length: 64 }, () => ({
            pointCount: 0,
            normal: { x: 0, y: 0 },
            points: Array.from({ length: CollisionConfig.MAX_MANIFOLD_POINTS }, (_, i) => ({
                id: i as ContactId,
                localPointA: { x: 0, y: 0 },
                localPointB: { x: 0, y: 0 },
                normalImpulse: 0,
                tangentImpulse: 0,
                separation: 0,
            })),
        }));
    }

    collide(
        shapeIdA: ShapeId,
        shapeIdB: ShapeId,
        typeA: ShapeType,
        typeB: ShapeType,
        shapeManager: ShapeManager2D,
        ctx: CollisionContext,
        manifold: IContactManifold2D
    ): void {
        const collisionFn = COLLISION_MATRIX[typeA]?.[typeB];
        if (!collisionFn) {
            (manifold as any).pointCount = 0;
            return;
        }

        const shapeA = this.getShapeData(shapeIdA, typeA, shapeManager);
        const shapeB = this.getShapeData(shapeIdB, typeB, shapeManager);

        collisionFn(shapeA, shapeB, ctx, manifold as any);
    }

    private getShapeData(shapeId: ShapeId, type: ShapeType, manager: ShapeManager2D): any {
        switch (type) {
            case ShapeType.Circle:
                return manager.getCircleData(shapeId);
            case ShapeType.Box:
                return manager.getBoxData(shapeId);
            case ShapeType.Polygon:
                return manager.getPolygonData(shapeId);
            case ShapeType.Capsule:
                return manager.getCapsuleData(shapeId);
            default:
                return null;
        }
    }
}

function transformPoint(
    point: IVec2Like,
    transform: { position: IVec2Like; rotation: number }
): IVec2Like {
    const cos = Math.cos(transform.rotation);
    const sin = Math.sin(transform.rotation);
    return {
        x: cos * point.x - sin * point.y + transform.position.x,
        y: sin * point.x + cos * point.y + transform.position.y,
    };
}

function inverseTransformPoint(
    point: IVec2Like,
    transform: { position: IVec2Like; rotation: number }
): IVec2Like {
    const dx = point.x - transform.position.x;
    const dy = point.y - transform.position.y;
    const cos = Math.cos(-transform.rotation);
    const sin = Math.sin(-transform.rotation);
    return {
        x: cos * dx - sin * dy,
        y: sin * dx + cos * dy,
    };
}

function getBoxVertices(box: {
    center: IVec2Like;
    halfWidth: number;
    halfHeight: number;
    rotation: number;
}): IVec2Like[] {
    return [
        { x: box.center.x - box.halfWidth, y: box.center.y - box.halfHeight },
        { x: box.center.x + box.halfWidth, y: box.center.y - box.halfHeight },
        { x: box.center.x + box.halfWidth, y: box.center.y + box.halfHeight },
        { x: box.center.x - box.halfWidth, y: box.center.y + box.halfHeight },
    ];
}

function findContactPoint(
    verticesA: IVec2Like[],
    verticesB: IVec2Like[],
    normal: IVec2Like,
    ctx: CollisionContext
): IVec2Like {
    let maxDepth = -Infinity;
    let deepestPoint: IVec2Like = { x: 0, y: 0 };

    for (const vertex of verticesA) {
        const worldVertex = transformPoint(vertex, ctx.transformA);
        const depth = normal.x * worldVertex.x + normal.y * worldVertex.y;
        if (depth > maxDepth) {
            maxDepth = depth;
            deepestPoint = worldVertex;
        }
    }

    return deepestPoint;
}

function findPolygonContacts(
    verticesA: readonly IVec2Like[],
    verticesB: readonly IVec2Like[],
    normal: IVec2Like,
    ctx: CollisionContext,
    penetration: number
): IVec2Like[] {
    const contacts: IVec2Like[] = [];
    const threshold = penetration + CollisionConfig.CONTACT_SLOP;

    for (const vertex of verticesA) {
        const worldVertex = transformPoint(vertex, ctx.transformA);
        const depth = -(normal.x * worldVertex.x + normal.y * worldVertex.y);
        if (depth <= threshold) {
            contacts.push(worldVertex);
        }
    }

    return contacts;
}

function findClosestPointOnPolygon(
    point: IVec2Like,
    vertices: readonly IVec2Like[],
    transform: { position: IVec2Like; rotation: number }
): IVec2Like {
    let minDistSq = Infinity;
    let closestPoint: IVec2Like = { x: 0, y: 0 };

    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        const v1 = transformPoint(vertices[i], transform);
        const v2 = transformPoint(vertices[j], transform);
        const closest = closestPointOnSegment(point, v1, v2);
        const dx = point.x - closest.x;
        const dy = point.y - closest.y;
        const distSq = dx * dx + dy * dy;

        if (distSq < minDistSq) {
            minDistSq = distSq;
            closestPoint = closest;
        }
    }

    return closestPoint;
}

function closestPointOnSegment(point: IVec2Like, a: IVec2Like, b: IVec2Like): IVec2Like {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = point.x - a.x;
    const apy = point.y - a.y;

    const ab2 = abx * abx + aby * aby;
    const ap_ab = apx * abx + apy * aby;
    const t = ab2 > EPSILON ? Math.max(0, Math.min(1, ap_ab / ab2)) : 0;

    return {
        x: a.x + abx * t,
        y: a.y + aby * t,
    };
}

function closestPointsSegmentSegment(
    a1: IVec2Like,
    a2: IVec2Like,
    b1: IVec2Like,
    b2: IVec2Like
): { pointA: IVec2Like; pointB: IVec2Like; distSq: number } {
    const d1x = a2.x - a1.x;
    const d1y = a2.y - a1.y;
    const d2x = b2.x - b1.x;
    const d2y = b2.y - b1.y;
    const rx = a1.x - b1.x;
    const ry = a1.y - b1.y;

    const a = d1x * d1x + d1y * d1y;
    const e = d2x * d2x + d2y * d2y;
    const f = d2x * rx + d2y * ry;

    let s = 0;
    let t = 0;

    if (a < EPSILON && e < EPSILON) {
        s = t = 0;
    } else if (a < EPSILON) {
        t = Math.max(0, Math.min(1, f / e));
    } else {
        const c = d1x * rx + d1y * ry;
        if (e < EPSILON) {
            s = Math.max(0, Math.min(1, -c / a));
        } else {
            const b = d1x * d2x + d1y * d2y;
            const denom = a * e - b * b;

            if (denom !== 0) {
                s = Math.max(0, Math.min(1, (b * f - c * e) / denom));
            }

            t = (b * s + f) / e;

            if (t < 0) {
                t = 0;
                s = Math.max(0, Math.min(1, -c / a));
            } else if (t > 1) {
                t = 1;
                s = Math.max(0, Math.min(1, (b - c) / a));
            }
        }
    }

    const pointA = { x: a1.x + d1x * s, y: a1.y + d1y * s };
    const pointB = { x: b1.x + d2x * t, y: b1.y + d2y * t };
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;

    return {
        pointA,
        pointB,
        distSq: dx * dx + dy * dy,
    };
}
