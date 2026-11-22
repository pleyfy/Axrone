import { Vec2, type IVec2Like, EPSILON } from '@axrone/numeric';
import { ObjectPool } from '@axrone/memory';
import type { ShapeId, ContactId } from '../types';
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

interface WritableManifold {
    pointCount: number;
    normal: IVec2Like;
    points: Array<{
        id: ContactId;
        localPointA: IVec2Like;
        localPointB: IVec2Like;
        normalImpulse: number;
        tangentImpulse: number;
        separation: number;
    }>;
}

interface CircleShapeData {
    readonly center: IVec2Like;
    readonly radius: number;
}

interface BoxShapeData {
    readonly center: IVec2Like;
    readonly halfWidth: number;
    readonly halfHeight: number;
    readonly rotation: number;
}

interface PolygonShapeData {
    readonly vertices: IVec2Like[];
}

interface CapsuleShapeData {
    readonly p1: IVec2Like;
    readonly p2: IVec2Like;
    readonly radius: number;
}

type ShapeData = CircleShapeData | BoxShapeData | PolygonShapeData | CapsuleShapeData;

const _tmpTransformPoint: IVec2Like = { x: 0, y: 0 };
const _tmpInversePoint: IVec2Like = { x: 0, y: 0 };

function setNormal(out: IVec2Like, dx: number, dy: number): void {
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > EPSILON) {
        out.x = dx / d;
        out.y = dy / d;
    } else {
        out.x = 0;
        out.y = 1;
    }
}

function transformPointTo(
    out: IVec2Like,
    point: IVec2Like,
    t: { position: IVec2Like; rotation: number }
): void {
    const c = Math.cos(t.rotation);
    const s = Math.sin(t.rotation);
    out.x = c * point.x - s * point.y + t.position.x;
    out.y = s * point.x + c * point.y + t.position.y;
}

function inverseTransformPointTo(
    out: IVec2Like,
    point: IVec2Like,
    t: { position: IVec2Like; rotation: number }
): void {
    const dx = point.x - t.position.x;
    const dy = point.y - t.position.y;
    const c = Math.cos(-t.rotation);
    const s = Math.sin(-t.rotation);
    out.x = c * dx - s * dy;
    out.y = s * dx + c * dy;
}

function collideCircleCircle(
    circleA: { center: IVec2Like; radius: number },
    circleB: { center: IVec2Like; radius: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldCenterA: IVec2Like = { x: 0, y: 0 };
    const worldCenterB: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldCenterA, circleA.center, ctx.transformA);
    transformPointTo(worldCenterB, circleB.center, ctx.transformB);

    const dx = worldCenterB.x - worldCenterA.x;
    const dy = worldCenterB.y - worldCenterA.y;
    const distSq = dx * dx + dy * dy;
    const radiusSum = circleA.radius + circleB.radius;
    const radiusSumSq = radiusSum * radiusSum;

    if (distSq > radiusSumSq) {
        manifold.pointCount = 0;
        return;
    }

    const dist = Math.sqrt(distSq);
    if (dist < EPSILON) {
        manifold.normal.x = 0;
        manifold.normal.y = 1;
        manifold.pointCount = 1;
        const point = manifold.points[0];
        inverseTransformPointTo(point.localPointA, worldCenterA, ctx.transformA);
        inverseTransformPointTo(point.localPointB, worldCenterA, ctx.transformB);
        point.separation = -radiusSum;
        return;
    }

    const invDist = 1 / dist;
    manifold.normal.x = dx * invDist;
    manifold.normal.y = dy * invDist;
    const separation = dist - radiusSum;
    const contactX = worldCenterA.x + manifold.normal.x * circleA.radius;
    const contactY = worldCenterA.y + manifold.normal.y * circleA.radius;
    manifold.pointCount = 1;
    const point = manifold.points[0];
    const contact: IVec2Like = { x: contactX, y: contactY };
    inverseTransformPointTo(point.localPointA, contact, ctx.transformA);
    inverseTransformPointTo(point.localPointB, contact, ctx.transformB);
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
    if (!result.colliding) { manifold.pointCount = 0; return; }
    manifold.normal.x = result.normal.x;
    manifold.normal.y = result.normal.y;
    manifold.pointCount = 1;
    const contactPoint = findContactPoint(verticesA, result.normal, ctx);
    const point = manifold.points[0];
    inverseTransformPointTo(point.localPointA, contactPoint, ctx.transformA);
    inverseTransformPointTo(point.localPointB, contactPoint, ctx.transformB);
    point.separation = -result.penetration;
}

function collidePolygonPolygon(
    polyA: { vertices: IVec2Like[] },
    polyB: { vertices: IVec2Like[] },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const result = SAT2D.testPolygonPolygon(polyA.vertices, polyB.vertices, ctx.transformA, ctx.transformB);
    if (!result.colliding) { manifold.pointCount = 0; return; }
    manifold.normal.x = result.normal.x;
    manifold.normal.y = result.normal.y;
    const contacts = findPolygonContacts(polyA.vertices, polyB.vertices, result.normal, ctx, result.penetration);
    manifold.pointCount = Math.min(contacts.length, CollisionConfig.MAX_MANIFOLD_POINTS);
    for (let i = 0; i < manifold.pointCount; i++) {
        const point = manifold.points[i];
        inverseTransformPointTo(point.localPointA, contacts[i], ctx.transformA);
        inverseTransformPointTo(point.localPointB, contacts[i], ctx.transformB);
        point.separation = -result.penetration;
    }
}

function collideCircleBox(
    circle: { center: IVec2Like; radius: number },
    box: { center: IVec2Like; halfWidth: number; halfHeight: number; rotation: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldCenter: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldCenter, circle.center, ctx.transformA);
    const boxVertices = getBoxVertices(box);
    const closestPoint = findClosestPointOnPolygon(worldCenter, boxVertices, ctx.transformB);
    const dx = worldCenter.x - closestPoint.x;
    const dy = worldCenter.y - closestPoint.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > circle.radius * circle.radius) { manifold.pointCount = 0; return; }
    setNormal(manifold.normal, dx, dy);
    manifold.pointCount = 1;
    const point = manifold.points[0];
    inverseTransformPointTo(point.localPointA, closestPoint, ctx.transformA);
    inverseTransformPointTo(point.localPointB, closestPoint, ctx.transformB);
    point.separation = Math.sqrt(distSq) - circle.radius;
}

function collideCirclePolygon(
    circle: { center: IVec2Like; radius: number },
    poly: { vertices: IVec2Like[] },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldCenter: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldCenter, circle.center, ctx.transformA);
    const closestPoint = findClosestPointOnPolygon(worldCenter, poly.vertices, ctx.transformB);
    const dx = worldCenter.x - closestPoint.x;
    const dy = worldCenter.y - closestPoint.y;
    const distSq = dx * dx + dy * dy;
    if (distSq > circle.radius * circle.radius) { manifold.pointCount = 0; return; }
    setNormal(manifold.normal, dx, dy);
    manifold.pointCount = 1;
    const point = manifold.points[0];
    inverseTransformPointTo(point.localPointA, closestPoint, ctx.transformA);
    inverseTransformPointTo(point.localPointB, closestPoint, ctx.transformB);
    point.separation = Math.sqrt(distSq) - circle.radius;
}

function collideCapsuleCapsule(
    capsuleA: { p1: IVec2Like; p2: IVec2Like; radius: number },
    capsuleB: { p1: IVec2Like; p2: IVec2Like; radius: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldA1: IVec2Like = { x: 0, y: 0 };
    const worldA2: IVec2Like = { x: 0, y: 0 };
    const worldB1: IVec2Like = { x: 0, y: 0 };
    const worldB2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldA1, capsuleA.p1, ctx.transformA);
    transformPointTo(worldA2, capsuleA.p2, ctx.transformA);
    transformPointTo(worldB1, capsuleB.p1, ctx.transformB);
    transformPointTo(worldB2, capsuleB.p2, ctx.transformB);
    const { pointA, pointB, distSq } = closestPointsSegmentSegment(worldA1, worldA2, worldB1, worldB2);
    const radiusSum = capsuleA.radius + capsuleB.radius;
    if (distSq > radiusSum * radiusSum) { manifold.pointCount = 0; return; }
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    setNormal(manifold.normal, dx, dy);
    manifold.pointCount = 1;
    const contactX = (pointA.x + pointB.x) * 0.5;
    const contactY = (pointA.y + pointB.y) * 0.5;
    const point = manifold.points[0];
    const contact: IVec2Like = { x: contactX, y: contactY };
    inverseTransformPointTo(point.localPointA, contact, ctx.transformA);
    inverseTransformPointTo(point.localPointB, contact, ctx.transformB);
    point.separation = Math.sqrt(distSq) - radiusSum;
}

function collideCircleCapsule(
    circle: { center: IVec2Like; radius: number },
    capsule: { p1: IVec2Like; p2: IVec2Like; radius: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldCenter: IVec2Like = { x: 0, y: 0 };
    const worldP1: IVec2Like = { x: 0, y: 0 };
    const worldP2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldCenter, circle.center, ctx.transformA);
    transformPointTo(worldP1, capsule.p1, ctx.transformB);
    transformPointTo(worldP2, capsule.p2, ctx.transformB);
    const closestPoint = closestPointOnSegment(worldCenter, worldP1, worldP2);
    const dx = worldCenter.x - closestPoint.x;
    const dy = worldCenter.y - closestPoint.y;
    const distSq = dx * dx + dy * dy;
    const radiusSum = circle.radius + capsule.radius;
    if (distSq > radiusSum * radiusSum) { manifold.pointCount = 0; return; }
    setNormal(manifold.normal, dx, dy);
    manifold.pointCount = 1;
    const point = manifold.points[0];
    inverseTransformPointTo(point.localPointA, closestPoint, ctx.transformA);
    inverseTransformPointTo(point.localPointB, closestPoint, ctx.transformB);
    point.separation = Math.sqrt(distSq) - radiusSum;
}

function collideCapsulePolygon(
    capsule: { p1: IVec2Like; p2: IVec2Like; radius: number },
    poly: { vertices: IVec2Like[] },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const worldP1: IVec2Like = { x: 0, y: 0 };
    const worldP2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldP1, capsule.p1, ctx.transformA);
    transformPointTo(worldP2, capsule.p2, ctx.transformA);
    let minDistSq = Infinity;
    let closestOnSegX = 0;
    let closestOnSegY = 0;
    let closestOnPolyX = 0;
    let closestOnPolyY = 0;
    for (let i = 0; i < poly.vertices.length; i++) {
        const v0: IVec2Like = { x: 0, y: 0 };
        const v1: IVec2Like = { x: 0, y: 0 };
        transformPointTo(v0, poly.vertices[i], ctx.transformB);
        transformPointTo(v1, poly.vertices[(i + 1) % poly.vertices.length], ctx.transformB);
        const { pointA, pointB, distSq } = closestPointsSegmentSegment(worldP1, worldP2, v0, v1);
        if (distSq < minDistSq) {
            minDistSq = distSq;
            closestOnSegX = pointA.x;
            closestOnSegY = pointA.y;
            closestOnPolyX = pointB.x;
            closestOnPolyY = pointB.y;
        }
    }
    if (minDistSq > capsule.radius * capsule.radius) { manifold.pointCount = 0; return; }
    const dx = closestOnSegX - closestOnPolyX;
    const dy = closestOnSegY - closestOnPolyY;
    setNormal(manifold.normal, dx, dy);
    manifold.pointCount = 1;
    const point = manifold.points[0];
    const segPt: IVec2Like = { x: closestOnSegX, y: closestOnSegY };
    const polyPt: IVec2Like = { x: closestOnPolyX, y: closestOnPolyY };
    inverseTransformPointTo(point.localPointA, segPt, ctx.transformA);
    inverseTransformPointTo(point.localPointB, polyPt, ctx.transformB);
    point.separation = Math.sqrt(minDistSq) - capsule.radius;
}

function collideBoxCapsule(
    box: { center: IVec2Like; halfWidth: number; halfHeight: number; rotation: number },
    capsule: { p1: IVec2Like; p2: IVec2Like; radius: number },
    ctx: CollisionContext,
    manifold: WritableManifold
): void {
    const boxWorldVertices = getBoxVertices(box).map(v => {
        const p: IVec2Like = { x: v.x + box.center.x, y: v.y + box.center.y };
        const out: IVec2Like = { x: 0, y: 0 };
        transformPointTo(out, p, ctx.transformA);
        return out;
    });
    const worldC1: IVec2Like = { x: 0, y: 0 };
    const worldC2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldC1, capsule.p1, ctx.transformB);
    transformPointTo(worldC2, capsule.p2, ctx.transformB);
    let minDistSq = Infinity;
    let closestSegX = 0;
    let closestSegY = 0;
    let closestBoxX = 0;
    let closestBoxY = 0;
    for (let i = 0; i < boxWorldVertices.length; i++) {
        const j = (i + 1) % boxWorldVertices.length;
        const { pointA, pointB, distSq } = closestPointsSegmentSegment(worldC1, worldC2, boxWorldVertices[i], boxWorldVertices[j]);
        if (distSq < minDistSq) {
            minDistSq = distSq;
            closestSegX = pointA.x;
            closestSegY = pointA.y;
            closestBoxX = pointB.x;
            closestBoxY = pointB.y;
        }
    }
    if (minDistSq > capsule.radius * capsule.radius) { manifold.pointCount = 0; return; }
    const dx = closestSegX - closestBoxX;
    const dy = closestSegY - closestBoxY;
    setNormal(manifold.normal, dx, dy);
    manifold.pointCount = 1;
    const point = manifold.points[0];
    const boxPt: IVec2Like = { x: closestBoxX, y: closestBoxY };
    const segPt: IVec2Like = { x: closestSegX, y: closestSegY };
    inverseTransformPointTo(point.localPointA, boxPt, ctx.transformA);
    inverseTransformPointTo(point.localPointB, segPt, ctx.transformB);
    point.separation = Math.sqrt(minDistSq) - capsule.radius;
}

const collideCapsuleCircle = (a: CapsuleShapeData, b: CircleShapeData, ctx: CollisionContext, m: WritableManifold) =>
    collideCircleCapsule(b, a, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, m);
const collidePolygonCircle = (a: PolygonShapeData, b: CircleShapeData, ctx: CollisionContext, m: WritableManifold) =>
    collideCirclePolygon(b, a, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, m);
const collideBoxCircle = (a: BoxShapeData, b: CircleShapeData, ctx: CollisionContext, m: WritableManifold) =>
    collideCircleBox(b, a, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, m);
const collidePolygonCapsule = (a: PolygonShapeData, b: CapsuleShapeData, ctx: CollisionContext, m: WritableManifold) =>
    collideCapsulePolygon(b, a, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, m);

// Segment collision functions
interface SegmentShapeData {
    p1: IVec2Like;
    p2: IVec2Like;
}

const collideSegmentCircle = (
    segment: SegmentShapeData,
    circle: CircleShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
): void => {
    const worldP1: IVec2Like = { x: 0, y: 0 };
    const worldP2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldP1, segment.p1, ctx.transformA);
    transformPointTo(worldP2, segment.p2, ctx.transformA);

    const worldCenter: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldCenter, circle.center, ctx.transformB);

    const closest = closestPointOnSegment(worldCenter, worldP1, worldP2);
    const dx = worldCenter.x - closest.x;
    const dy = worldCenter.y - closest.y;
    const distSq = dx * dx + dy * dy;
    const radius = circle.radius;

    if (distSq > radius * radius) {
        manifold.pointCount = 0;
        return;
    }

    const dist = Math.sqrt(distSq);
    const penetration = radius - dist;

    // Normal points from segment to circle
    if (dist > 1e-6) {
        setNormal(manifold.normal, dx / dist, dy / dist);
    } else {
        // Degenerate case: circle center on segment
        setNormal(manifold.normal, 0, 1);
    }

    manifold.pointCount = 1;
    const point = manifold.points[0];
    const worldContactPt = closest;
    inverseTransformPointTo(point.localPointA, worldContactPt, ctx.transformA);
    inverseTransformPointTo(point.localPointB, worldCenter, ctx.transformB);
    point.separation = -penetration;
};

const collideCircleSegment = (
    circle: CircleShapeData,
    segment: SegmentShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
): void => {
    collideSegmentCircle(segment, circle, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, manifold);
    // Flip normal to point from circle to segment
    manifold.normal.x = -manifold.normal.x;
    manifold.normal.y = -manifold.normal.y;
};

const collideSegmentCapsule = (
    segment: SegmentShapeData,
    capsule: CapsuleShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
): void => {
    const worldP1: IVec2Like = { x: 0, y: 0 };
    const worldP2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldP1, segment.p1, ctx.transformA);
    transformPointTo(worldP2, segment.p2, ctx.transformA);

    const worldC1: IVec2Like = { x: 0, y: 0 };
    const worldC2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldC1, capsule.p1, ctx.transformB);
    transformPointTo(worldC2, capsule.p2, ctx.transformB);

    const { pointA, pointB, distSq } = closestPointsSegmentSegment(worldP1, worldP2, worldC1, worldC2);
    if (distSq > capsule.radius * capsule.radius) {
        manifold.pointCount = 0;
        return;
    }

    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const dist = Math.sqrt(distSq);
    const penetration = capsule.radius - dist;

    if (dist > 1e-6) {
        setNormal(manifold.normal, dx / dist, dy / dist);
    } else {
        setNormal(manifold.normal, 0, 1);
    }

    manifold.pointCount = 1;
    const point = manifold.points[0];
    inverseTransformPointTo(point.localPointA, pointA, ctx.transformA);
    inverseTransformPointTo(point.localPointB, pointB, ctx.transformB);
    point.separation = -penetration;
};

const collideCapsuleSegment = (
    capsule: CapsuleShapeData,
    segment: SegmentShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
): void => {
    collideSegmentCapsule(segment, capsule, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, manifold);
    manifold.normal.x = -manifold.normal.x;
    manifold.normal.y = -manifold.normal.y;
};

const collideSegmentPolygon = (
    segment: SegmentShapeData,
    polygon: PolygonShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
): void => {
    const worldP1: IVec2Like = { x: 0, y: 0 };
    const worldP2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldP1, segment.p1, ctx.transformA);
    transformPointTo(worldP2, segment.p2, ctx.transformA);

    const worldVertices = polygon.vertices.map((v) => {
        const out: IVec2Like = { x: 0, y: 0 };
        transformPointTo(out, v, ctx.transformB);
        return out;
    });

    let minDistSq = Infinity;
    let closestSegPt: IVec2Like = { x: 0, y: 0 };
    let closestPolyPt: IVec2Like = { x: 0, y: 0 };

    // Check segment against each polygon edge
    for (let i = 0; i < worldVertices.length; i++) {
        const j = (i + 1) % worldVertices.length;
        const { pointA, pointB, distSq } = closestPointsSegmentSegment(
            worldP1,
            worldP2,
            worldVertices[i],
            worldVertices[j]
        );
        if (distSq < minDistSq) {
            minDistSq = distSq;
            closestSegPt = pointA;
            closestPolyPt = pointB;
        }
    }

    // Check if segment endpoints are inside polygon (simplified)
    const dx = closestPolyPt.x - closestSegPt.x;
    const dy = closestPolyPt.y - closestSegPt.y;
    const dist = Math.sqrt(minDistSq);

    if (dist > 1e-6) {
        setNormal(manifold.normal, dx / dist, dy / dist);
    } else {
        setNormal(manifold.normal, 0, 1);
    }

    manifold.pointCount = 1;
    const point = manifold.points[0];
    inverseTransformPointTo(point.localPointA, closestSegPt, ctx.transformA);
    inverseTransformPointTo(point.localPointB, closestPolyPt, ctx.transformB);
    point.separation = -dist;
};

const collidePolygonSegment = (
    polygon: PolygonShapeData,
    segment: SegmentShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
): void => {
    collideSegmentPolygon(segment, polygon, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, manifold);
    manifold.normal.x = -manifold.normal.x;
    manifold.normal.y = -manifold.normal.y;
};

const collideSegmentBox = (
    segment: SegmentShapeData,
    box: BoxShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
): void => {
    const worldP1: IVec2Like = { x: 0, y: 0 };
    const worldP2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldP1, segment.p1, ctx.transformA);
    transformPointTo(worldP2, segment.p2, ctx.transformA);

    const boxWorldVertices = getBoxVertices(box).map((v) => {
        const p: IVec2Like = { x: v.x + box.center.x, y: v.y + box.center.y };
        const out: IVec2Like = { x: 0, y: 0 };
        transformPointTo(out, p, ctx.transformB);
        return out;
    });

    let minDistSq = Infinity;
    let closestSegPt: IVec2Like = { x: 0, y: 0 };
    let closestBoxPt: IVec2Like = { x: 0, y: 0 };

    for (let i = 0; i < boxWorldVertices.length; i++) {
        const j = (i + 1) % boxWorldVertices.length;
        const { pointA, pointB, distSq } = closestPointsSegmentSegment(
            worldP1,
            worldP2,
            boxWorldVertices[i],
            boxWorldVertices[j]
        );
        if (distSq < minDistSq) {
            minDistSq = distSq;
            closestSegPt = pointA;
            closestBoxPt = pointB;
        }
    }

    const dx = closestBoxPt.x - closestSegPt.x;
    const dy = closestBoxPt.y - closestSegPt.y;
    const dist = Math.sqrt(minDistSq);

    if (dist > 1e-6) {
        setNormal(manifold.normal, dx / dist, dy / dist);
    } else {
        setNormal(manifold.normal, 0, 1);
    }

    manifold.pointCount = 1;
    const point = manifold.points[0];
    inverseTransformPointTo(point.localPointA, closestSegPt, ctx.transformA);
    inverseTransformPointTo(point.localPointB, closestBoxPt, ctx.transformB);
    point.separation = -dist;
};

const collideBoxSegment = (
    box: BoxShapeData,
    segment: SegmentShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
): void => {
    collideSegmentBox(segment, box, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, manifold);
    manifold.normal.x = -manifold.normal.x;
    manifold.normal.y = -manifold.normal.y;
};

const collideSegmentSegment = (
    segmentA: SegmentShapeData,
    segmentB: SegmentShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
): void => {
    const worldA1: IVec2Like = { x: 0, y: 0 };
    const worldA2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldA1, segmentA.p1, ctx.transformA);
    transformPointTo(worldA2, segmentA.p2, ctx.transformA);

    const worldB1: IVec2Like = { x: 0, y: 0 };
    const worldB2: IVec2Like = { x: 0, y: 0 };
    transformPointTo(worldB1, segmentB.p1, ctx.transformB);
    transformPointTo(worldB2, segmentB.p2, ctx.transformB);

    const { pointA, pointB, distSq } = closestPointsSegmentSegment(worldA1, worldA2, worldB1, worldB2);

    if (distSq > 1e-6) {
        manifold.pointCount = 0;
        return;
    }

    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const dist = Math.sqrt(distSq);

    if (dist > 1e-6) {
        setNormal(manifold.normal, dx / dist, dy / dist);
    } else {
        setNormal(manifold.normal, 0, 1);
    }

    manifold.pointCount = 1;
    const point = manifold.points[0];
    inverseTransformPointTo(point.localPointA, pointA, ctx.transformA);
    inverseTransformPointTo(point.localPointB, pointB, ctx.transformB);
    point.separation = -dist;
};
const collideBoxPolygon = collidePolygonPolygon;
const collidePolygonBox = collideBoxPolygon;
const collideCapsuleBox = (a: CapsuleShapeData, b: BoxShapeData, ctx: CollisionContext, m: WritableManifold) =>
    collideBoxCapsule(b, a, { ...ctx, transformA: ctx.transformB, transformB: ctx.transformA }, m);

type CollisionFn = (
    shapeA: ShapeData,
    shapeB: ShapeData,
    ctx: CollisionContext,
    manifold: WritableManifold
) => void;

const COLLISION_MATRIX: ReadonlyArray<ReadonlyArray<CollisionFn | null>> = [
    [collideCircleCircle as CollisionFn, collideCircleCapsule as CollisionFn, collideCirclePolygon as CollisionFn, collideCircleBox as CollisionFn, collideCircleSegment as CollisionFn],
    [collideCapsuleCircle as CollisionFn, collideCapsuleCapsule as CollisionFn, collideCapsulePolygon as CollisionFn, collideCapsuleBox as CollisionFn, collideCapsuleSegment as CollisionFn],
    [collidePolygonCircle as CollisionFn, collidePolygonCapsule as CollisionFn, collidePolygonPolygon as CollisionFn, collidePolygonBox as CollisionFn, collidePolygonSegment as CollisionFn],
    [collideBoxCircle as CollisionFn, collideBoxCapsule as CollisionFn, collideBoxPolygon as CollisionFn, collideBoxBox as CollisionFn, collideBoxSegment as CollisionFn],
    [collideSegmentCircle as CollisionFn, collideSegmentCapsule as CollisionFn, collideSegmentPolygon as CollisionFn, collideSegmentBox as CollisionFn, collideSegmentSegment as CollisionFn],
] as const;

export class Narrowphase2D {
    private readonly _tempVec: Vec2;
    private readonly _manifoldPool: ObjectPool<WritableManifold>;

    constructor() {
        this._tempVec = Vec2.ZERO.clone();
        this._manifoldPool = new ObjectPool<WritableManifold>({
            name: 'NarrowphaseManifoldPool',
            initialCapacity: 64,
            maxCapacity: 512,
            factory: (): WritableManifold => ({
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
            }),
            resetHandler: (manifold: WritableManifold): void => {
                manifold.pointCount = 0;
                manifold.normal.x = 0;
                manifold.normal.y = 0;
                for (const point of manifold.points) {
                    point.normalImpulse = 0;
                    point.tangentImpulse = 0;
                    point.separation = 0;
                }
            },
        });
    }

    acquireManifold(): WritableManifold { return this._manifoldPool.acquire(); }
    releaseManifold(manifold: WritableManifold): void { this._manifoldPool.release(manifold); }
    dispose(): void { this._manifoldPool[Symbol.dispose](); }

    collide(
        shapeIdA: ShapeId,
        shapeIdB: ShapeId,
        typeA: ShapeType,
        typeB: ShapeType,
        shapeManager: ShapeManager2D,
        ctx: CollisionContext,
        manifold: WritableManifold
    ): void {
        const collisionFn = COLLISION_MATRIX[typeA]?.[typeB];
        if (!collisionFn) { manifold.pointCount = 0; return; }
        const shapeA = this._getShapeData(shapeIdA, typeA, shapeManager);
        const shapeB = this._getShapeData(shapeIdB, typeB, shapeManager);
        if (!shapeA || !shapeB) { manifold.pointCount = 0; return; }
        collisionFn(shapeA, shapeB, ctx, manifold);
    }

    private _getShapeData(shapeId: ShapeId, type: ShapeType, manager: ShapeManager2D): ShapeData | null {
        switch (type) {
            case ShapeType.Circle: return manager.getCircleData(shapeId);
            case ShapeType.Box: return manager.getBoxData(shapeId);
            case ShapeType.Polygon: return manager.getPolygonData(shapeId);
            case ShapeType.Capsule: return manager.getCapsuleData(shapeId);
            default: return null;
        }
    }
}

function getBoxVertices(box: { center: IVec2Like; halfWidth: number; halfHeight: number; rotation: number }): IVec2Like[] {
    return [
        { x: -box.halfWidth, y: -box.halfHeight },
        { x: box.halfWidth, y: -box.halfHeight },
        { x: box.halfWidth, y: box.halfHeight },
        { x: -box.halfWidth, y: box.halfHeight },
    ];
}

function findContactPoint(verticesA: IVec2Like[], normal: IVec2Like, ctx: CollisionContext): IVec2Like {
    let maxDepth = -Infinity;
    let deepestX = 0;
    let deepestY = 0;
    for (const v of verticesA) {
        const wv: IVec2Like = { x: 0, y: 0 };
        transformPointTo(wv, v, ctx.transformA);
        const depth = normal.x * wv.x + normal.y * wv.y;
        if (depth > maxDepth) { maxDepth = depth; deepestX = wv.x; deepestY = wv.y; }
    }
    return { x: deepestX, y: deepestY };
}

function findPolygonContacts(verticesA: readonly IVec2Like[], verticesB: readonly IVec2Like[], normal: IVec2Like, ctx: CollisionContext, penetration: number): IVec2Like[] {
    const contacts: IVec2Like[] = [];
    const threshold = penetration + CollisionConfig.CONTACT_SLOP;
    let maxProjB = -Infinity;
    let bestBx = 0;
    let bestBy = 0;
    const wvB: IVec2Like = { x: 0, y: 0 };
    for (const v of verticesB) {
        transformPointTo(wvB, v, ctx.transformB);
        const proj = normal.x * wvB.x + normal.y * wvB.y;
        if (proj > maxProjB) { maxProjB = proj; bestBx = wvB.x; bestBy = wvB.y; }
    }
    const refDot = normal.x * bestBx + normal.y * bestBy;
    const wvA: IVec2Like = { x: 0, y: 0 };
    for (const v of verticesA) {
        transformPointTo(wvA, v, ctx.transformA);
        const depth = (normal.x * wvA.x + normal.y * wvA.y) - refDot;
        if (depth <= threshold) contacts.push({ x: wvA.x, y: wvA.y });
    }
    let maxProjA = -Infinity;
    let bestAx = 0;
    let bestAy = 0;
    for (const v of verticesA) {
        transformPointTo(wvA, v, ctx.transformA);
        const proj = normal.x * wvA.x + normal.y * wvA.y;
        if (proj > maxProjA) { maxProjA = proj; bestAx = wvA.x; bestAy = wvA.y; }
    }
    const refDotA = normal.x * bestAx + normal.y * bestAy;
    for (const v of verticesB) {
        transformPointTo(wvB, v, ctx.transformB);
        const depth = refDotA - (normal.x * wvB.x + normal.y * wvB.y);
        if (depth <= threshold) contacts.push({ x: wvB.x, y: wvB.y });
    }
    return contacts;
}

function findClosestPointOnPolygon(point: IVec2Like, vertices: readonly IVec2Like[], t: { position: IVec2Like; rotation: number }): IVec2Like {
    let minD = Infinity;
    let bestX = 0;
    let bestY = 0;
    const v1: IVec2Like = { x: 0, y: 0 };
    const v2: IVec2Like = { x: 0, y: 0 };
    for (let i = 0; i < vertices.length; i++) {
        const j = (i + 1) % vertices.length;
        transformPointTo(v1, vertices[i], t);
        transformPointTo(v2, vertices[j], t);
        const cp = closestPointOnSegment(point, v1, v2);
        const dx = point.x - cp.x;
        const dy = point.y - cp.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minD) { minD = d2; bestX = cp.x; bestY = cp.y; }
    }
    return { x: bestX, y: bestY };
}

function closestPointOnSegment(p: IVec2Like, a: IVec2Like, b: IVec2Like): IVec2Like {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const apx = p.x - a.x;
    const apy = p.y - a.y;
    const ab2 = abx * abx + aby * aby;
    const t = ab2 > EPSILON ? Math.max(0, Math.min(1, (apx * abx + apy * aby) / ab2)) : 0;
    return { x: a.x + abx * t, y: a.y + aby * t };
}

function closestPointsSegmentSegment(a1: IVec2Like, a2: IVec2Like, b1: IVec2Like, b2: IVec2Like): { pointA: IVec2Like; pointB: IVec2Like; distSq: number } {
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
    if (a < EPSILON && e < EPSILON) { s = t = 0; }
    else if (a < EPSILON) { t = Math.max(0, Math.min(1, f / e)); }
    else {
        const c = d1x * rx + d1y * ry;
        if (e < EPSILON) { s = Math.max(0, Math.min(1, -c / a)); }
        else {
            const b = d1x * d2x + d1y * d2y;
            const denom = a * e - b * b;
            if (denom !== 0) s = Math.max(0, Math.min(1, (b * f - c * e) / denom));
            t = (b * s + f) / e;
            if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
            else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (b - c) / a)); }
        }
    }
    const pAx = a1.x + d1x * s;
    const pAy = a1.y + d1y * s;
    const pBx = b1.x + d2x * t;
    const pBy = b1.y + d2y * t;
    const dx = pBx - pAx;
    const dy = pBy - pAy;
    return {
        pointA: { x: pAx, y: pAy },
        pointB: { x: pBx, y: pBy },
        distSq: dx * dx + dy * dy,
    };
}
