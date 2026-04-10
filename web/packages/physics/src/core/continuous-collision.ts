import type { IVec2Like } from '@axrone/numeric';
import { AABB2D } from '@axrone/geometry';
import type { BodyId, ShapeId, IRaycastResult2D } from '../types';

interface CCDResult {
    hit: boolean;
    toi: number;
    normal: IVec2Like;
    point: IVec2Like;
}

export class ContinuousCollisionDetection {
    private static readonly MAX_ITERATIONS = 32;
    private static readonly EPSILON = 1e-6;
    private static readonly TOI_THRESHOLD = 0.01;

    static computeTimeOfImpact(
        aabbA: AABB2D,
        velocityA: IVec2Like,
        aabbB: AABB2D,
        velocityB: IVec2Like,
        deltaTime: number
    ): CCDResult {
        const relativeVelocity = {
            x: velocityA.x - velocityB.x,
            y: velocityA.y - velocityB.y,
        };

        let tLower = 0;
        let tUpper = deltaTime;

        for (let iter = 0; iter < this.MAX_ITERATIONS; iter++) {
            const t = (tLower + tUpper) * 0.5;

            const aabbA_t = this.extrapolateAABB(aabbA, relativeVelocity, t);

            if (aabbA_t.intersectsAABB(aabbB)) {
                tUpper = t;

                if (tUpper - tLower < this.TOI_THRESHOLD) {
                    const normal = this.computeContactNormal(aabbA_t, aabbB);
                    const point = this.computeContactPoint(aabbA_t, aabbB);

                    return {
                        hit: true,
                        toi: t,
                        normal,
                        point,
                    };
                }
            } else {
                tLower = t;
            }

            if (tUpper - tLower < this.EPSILON) {
                break;
            }
        }

        return {
            hit: false,
            toi: deltaTime,
            normal: { x: 0, y: 0 },
            point: { x: 0, y: 0 },
        };
    }

    private static extrapolateAABB(aabb: AABB2D, velocity: IVec2Like, time: number): AABB2D {
        const displacement = {
            x: velocity.x * time,
            y: velocity.y * time,
        };

        return new AABB2D(
            {
                x: aabb.min.x + displacement.x,
                y: aabb.min.y + displacement.y,
            },
            {
                x: aabb.max.x + displacement.x,
                y: aabb.max.y + displacement.y,
            }
        );
    }

    private static computeContactNormal(aabbA: AABB2D, aabbB: AABB2D): IVec2Like {
        const centerA = aabbA.center;
        const centerB = aabbB.center;

        const dx = centerB.x - centerA.x;
        const dy = centerB.y - centerA.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length > this.EPSILON) {
            return { x: dx / length, y: dy / length };
        }

        return { x: 1, y: 0 };
    }

    private static computeContactPoint(aabbA: AABB2D, aabbB: AABB2D): IVec2Like {
        return {
            x: (Math.max(aabbA.min.x, aabbB.min.x) + Math.min(aabbA.max.x, aabbB.max.x)) * 0.5,
            y: (Math.max(aabbA.min.y, aabbB.min.y) + Math.min(aabbA.max.y, aabbB.max.y)) * 0.5,
        };
    }

    static conservativeAdvancement(
        verticesA: readonly IVec2Like[],
        verticesB: readonly IVec2Like[],
        transformA: { position: IVec2Like; rotation: number },
        transformB: { position: IVec2Like; rotation: number },
        velocityA: IVec2Like,
        velocityB: IVec2Like,
        angularVelocityA: number,
        angularVelocityB: number,
        deltaTime: number
    ): CCDResult {
        let t = 0;
        const maxIterations = 32;

        for (let iter = 0; iter < maxIterations; iter++) {
            const currentTransformA = {
                position: {
                    x: transformA.position.x + velocityA.x * t,
                    y: transformA.position.y + velocityA.y * t,
                },
                rotation: transformA.rotation + angularVelocityA * t,
            };

            const currentTransformB = {
                position: {
                    x: transformB.position.x + velocityB.x * t,
                    y: transformB.position.y + velocityB.y * t,
                },
                rotation: transformB.rotation + angularVelocityB * t,
            };

            const distance = this.computeDistance(
                verticesA,
                verticesB,
                currentTransformA,
                currentTransformB
            );

            if (distance < this.TOI_THRESHOLD) {
                const normal = this.computeSeparatingAxis(
                    verticesA,
                    verticesB,
                    currentTransformA,
                    currentTransformB
                );

                return {
                    hit: true,
                    toi: t,
                    normal,
                    point: { x: 0, y: 0 },
                };
            }

            const relativeVelocity = {
                x: velocityA.x - velocityB.x,
                y: velocityA.y - velocityB.y,
            };

            const velocityLength = Math.sqrt(
                relativeVelocity.x * relativeVelocity.x + relativeVelocity.y * relativeVelocity.y
            );

            if (velocityLength < this.EPSILON) {
                break;
            }

            const dt = distance / velocityLength;
            t += dt;

            if (t >= deltaTime) {
                break;
            }
        }

        return {
            hit: false,
            toi: deltaTime,
            normal: { x: 0, y: 0 },
            point: { x: 0, y: 0 },
        };
    }

    private static computeDistance(
        verticesA: readonly IVec2Like[],
        verticesB: readonly IVec2Like[],
        transformA: { position: IVec2Like; rotation: number },
        transformB: { position: IVec2Like; rotation: number }
    ): number {
        let minDistance = Infinity;

        const cosA = Math.cos(transformA.rotation);
        const sinA = Math.sin(transformA.rotation);
        const cosB = Math.cos(transformB.rotation);
        const sinB = Math.sin(transformB.rotation);

        for (const vA of verticesA) {
            const worldA = {
                x: cosA * vA.x - sinA * vA.y + transformA.position.x,
                y: sinA * vA.x + cosA * vA.y + transformA.position.y,
            };

            for (const vB of verticesB) {
                const worldB = {
                    x: cosB * vB.x - sinB * vB.y + transformB.position.x,
                    y: sinB * vB.x + cosB * vB.y + transformB.position.y,
                };

                const dx = worldB.x - worldA.x;
                const dy = worldB.y - worldA.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < minDistance) {
                    minDistance = distance;
                }
            }
        }

        return minDistance;
    }

    private static computeSeparatingAxis(
        verticesA: readonly IVec2Like[],
        verticesB: readonly IVec2Like[],
        transformA: { position: IVec2Like; rotation: number },
        transformB: { position: IVec2Like; rotation: number }
    ): IVec2Like {
        const dx = transformB.position.x - transformA.position.x;
        const dy = transformB.position.y - transformA.position.y;
        const length = Math.sqrt(dx * dx + dy * dy);

        if (length > this.EPSILON) {
            return { x: dx / length, y: dy / length };
        }

        return { x: 1, y: 0 };
    }
}

export class Raycaster2D {
    private static readonly EPSILON = 1e-6;

    static raycastAABB(
        origin: IVec2Like,
        direction: IVec2Like,
        aabb: AABB2D,
        maxDistance: number = Infinity
    ): { hit: boolean; distance: number; point: IVec2Like; normal: IVec2Like } {
        const invDir = {
            x: Math.abs(direction.x) > this.EPSILON ? 1 / direction.x : Infinity,
            y: Math.abs(direction.y) > this.EPSILON ? 1 / direction.y : Infinity,
        };

        const t1 = (aabb.min.x - origin.x) * invDir.x;
        const t2 = (aabb.max.x - origin.x) * invDir.x;
        const t3 = (aabb.min.y - origin.y) * invDir.y;
        const t4 = (aabb.max.y - origin.y) * invDir.y;

        const tmin = Math.max(Math.min(t1, t2), Math.min(t3, t4));
        const tmax = Math.min(Math.max(t1, t2), Math.max(t3, t4));

        if (tmax < 0 || tmin > tmax || tmin > maxDistance) {
            return {
                hit: false,
                distance: Infinity,
                point: { x: 0, y: 0 },
                normal: { x: 0, y: 0 },
            };
        }

        const t = tmin >= 0 ? tmin : tmax;
        const point = {
            x: origin.x + direction.x * t,
            y: origin.y + direction.y * t,
        };

        let normal: IVec2Like = { x: 0, y: 0 };
        const epsilon = 0.001;

        if (Math.abs(point.x - aabb.min.x) < epsilon) normal = { x: -1, y: 0 };
        else if (Math.abs(point.x - aabb.max.x) < epsilon) normal = { x: 1, y: 0 };
        else if (Math.abs(point.y - aabb.min.y) < epsilon) normal = { x: 0, y: -1 };
        else if (Math.abs(point.y - aabb.max.y) < epsilon) normal = { x: 0, y: 1 };

        return {
            hit: true,
            distance: t,
            point,
            normal,
        };
    }

    static raycastCircle(
        origin: IVec2Like,
        direction: IVec2Like,
        center: IVec2Like,
        radius: number,
        maxDistance: number = Infinity
    ): { hit: boolean; distance: number; point: IVec2Like; normal: IVec2Like } {
        const oc = {
            x: origin.x - center.x,
            y: origin.y - center.y,
        };

        const a = direction.x * direction.x + direction.y * direction.y;
        const b = 2 * (oc.x * direction.x + oc.y * direction.y);
        const c = oc.x * oc.x + oc.y * oc.y - radius * radius;

        const discriminant = b * b - 4 * a * c;

        if (discriminant < 0) {
            return {
                hit: false,
                distance: Infinity,
                point: { x: 0, y: 0 },
                normal: { x: 0, y: 0 },
            };
        }

        const t = (-b - Math.sqrt(discriminant)) / (2 * a);

        if (t < 0 || t > maxDistance) {
            return {
                hit: false,
                distance: Infinity,
                point: { x: 0, y: 0 },
                normal: { x: 0, y: 0 },
            };
        }

        const point = {
            x: origin.x + direction.x * t,
            y: origin.y + direction.y * t,
        };

        const normal = {
            x: (point.x - center.x) / radius,
            y: (point.y - center.y) / radius,
        };

        return {
            hit: true,
            distance: t,
            point,
            normal,
        };
    }

    static raycastPolygon(
        origin: IVec2Like,
        direction: IVec2Like,
        vertices: readonly IVec2Like[],
        transform: { position: IVec2Like; rotation: number },
        maxDistance: number = Infinity
    ): { hit: boolean; distance: number; point: IVec2Like; normal: IVec2Like } {
        let minDistance = Infinity;
        let hitPoint: IVec2Like = { x: 0, y: 0 };
        let hitNormal: IVec2Like = { x: 0, y: 0 };
        let hit = false;

        const cos = Math.cos(transform.rotation);
        const sin = Math.sin(transform.rotation);

        for (let i = 0; i < vertices.length; i++) {
            const j = (i + 1) % vertices.length;

            const v1 = vertices[i];
            const v2 = vertices[j];

            const p1 = {
                x: cos * v1.x - sin * v1.y + transform.position.x,
                y: sin * v1.x + cos * v1.y + transform.position.y,
            };

            const p2 = {
                x: cos * v2.x - sin * v2.y + transform.position.x,
                y: sin * v2.x + cos * v2.y + transform.position.y,
            };

            const result = this.raycastSegment(origin, direction, p1, p2, maxDistance);

            if (result.hit && result.distance < minDistance) {
                minDistance = result.distance;
                hitPoint = result.point;
                hitNormal = result.normal;
                hit = true;
            }
        }

        return {
            hit,
            distance: minDistance,
            point: hitPoint,
            normal: hitNormal,
        };
    }

    private static raycastSegment(
        origin: IVec2Like,
        direction: IVec2Like,
        p1: IVec2Like,
        p2: IVec2Like,
        maxDistance: number
    ): { hit: boolean; distance: number; point: IVec2Like; normal: IVec2Like } {
        const edge = {
            x: p2.x - p1.x,
            y: p2.y - p1.y,
        };

        const normal = {
            x: -edge.y,
            y: edge.x,
        };

        const length = Math.sqrt(normal.x * normal.x + normal.y * normal.y);
        if (length > this.EPSILON) {
            normal.x /= length;
            normal.y /= length;
        }

        const denom = direction.x * normal.x + direction.y * normal.y;

        if (Math.abs(denom) < this.EPSILON) {
            return {
                hit: false,
                distance: Infinity,
                point: { x: 0, y: 0 },
                normal: { x: 0, y: 0 },
            };
        }

        const t = ((p1.x - origin.x) * normal.x + (p1.y - origin.y) * normal.y) / denom;

        if (t < 0 || t > maxDistance) {
            return {
                hit: false,
                distance: Infinity,
                point: { x: 0, y: 0 },
                normal: { x: 0, y: 0 },
            };
        }

        const point = {
            x: origin.x + direction.x * t,
            y: origin.y + direction.y * t,
        };

        const edgeParam =
            ((point.x - p1.x) * edge.x + (point.y - p1.y) * edge.y) /
            (edge.x * edge.x + edge.y * edge.y);

        if (edgeParam < 0 || edgeParam > 1) {
            return {
                hit: false,
                distance: Infinity,
                point: { x: 0, y: 0 },
                normal: { x: 0, y: 0 },
            };
        }

        return {
            hit: true,
            distance: t,
            point,
            normal,
        };
    }
}
