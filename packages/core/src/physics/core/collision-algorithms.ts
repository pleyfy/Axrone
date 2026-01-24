import type { IVec2Like } from '@axrone/numeric';

interface Simplex {
    points: IVec2Like[];
    count: number;
}

interface SupportPoint {
    point: IVec2Like;
    indexA: number;
    indexB: number;
}

export class GJK2D {
    private static readonly MAX_ITERATIONS = 32;
    private static readonly EPSILON = 1e-10;

    static testIntersection(
        verticesA: readonly IVec2Like[],
        verticesB: readonly IVec2Like[],
        transformA: { position: IVec2Like; rotation: number },
        transformB: { position: IVec2Like; rotation: number }
    ): boolean {
        const simplex: Simplex = { points: [], count: 0 };
        let direction: IVec2Like = {
            x: transformB.position.x - transformA.position.x,
            y: transformB.position.y - transformA.position.y,
        };

        if (direction.x * direction.x + direction.y * direction.y < GJK2D.EPSILON) {
            direction = { x: 1, y: 0 };
        }

        const support = this.support(verticesA, verticesB, transformA, transformB, direction);
        simplex.points.push(support.point);
        simplex.count = 1;

        direction = { x: -support.point.x, y: -support.point.y };

        for (let iter = 0; iter < GJK2D.MAX_ITERATIONS; iter++) {
            const A = this.support(verticesA, verticesB, transformA, transformB, direction);

            if (this.dot(A.point, direction) < 0) {
                return false;
            }

            simplex.points.push(A.point);
            simplex.count++;

            if (this.processSimplex(simplex, direction)) {
                return true;
            }
        }

        return false;
    }

    private static support(
        verticesA: readonly IVec2Like[],
        verticesB: readonly IVec2Like[],
        transformA: { position: IVec2Like; rotation: number },
        transformB: { position: IVec2Like; rotation: number },
        direction: IVec2Like
    ): SupportPoint {
        const supportA = this.getFarthestPointInDirection(verticesA, transformA, direction);
        const supportB = this.getFarthestPointInDirection(
            verticesB,
            transformB,
            { x: -direction.x, y: -direction.y }
        );

        return {
            point: {
                x: supportA.x - supportB.x,
                y: supportA.y - supportB.y,
            },
            indexA: 0,
            indexB: 0,
        };
    }

    private static getFarthestPointInDirection(
        vertices: readonly IVec2Like[],
        transform: { position: IVec2Like; rotation: number },
        direction: IVec2Like
    ): IVec2Like {
        let maxDot = -Infinity;
        let maxPoint: IVec2Like = { x: 0, y: 0 };

        const cos = Math.cos(transform.rotation);
        const sin = Math.sin(transform.rotation);

        for (const vertex of vertices) {
            const x = cos * vertex.x - sin * vertex.y + transform.position.x;
            const y = sin * vertex.x + cos * vertex.y + transform.position.y;
            const dot = x * direction.x + y * direction.y;

            if (dot > maxDot) {
                maxDot = dot;
                maxPoint = { x, y };
            }
        }

        return maxPoint;
    }

    private static processSimplex(simplex: Simplex, direction: IVec2Like): boolean {
        if (simplex.count === 2) {
            return this.line(simplex, direction);
        } else if (simplex.count === 3) {
            return this.triangle(simplex, direction);
        }
        return false;
    }

    private static line(simplex: Simplex, direction: IVec2Like): boolean {
        const A = simplex.points[1];
        const B = simplex.points[0];

        const AB = { x: B.x - A.x, y: B.y - A.y };
        const AO = { x: -A.x, y: -A.y };

        if (this.dot(AB, AO) > 0) {
            direction.x = -AB.y;
            direction.y = AB.x;
            const dot = this.dot(direction, AO);
            if (dot < 0) {
                direction.x = -direction.x;
                direction.y = -direction.y;
            }
        } else {
            simplex.points[0] = A;
            simplex.count = 1;
            direction.x = AO.x;
            direction.y = AO.y;
        }

        return false;
    }

    private static triangle(simplex: Simplex, direction: IVec2Like): boolean {
        const A = simplex.points[2];
        const B = simplex.points[1];
        const C = simplex.points[0];

        const AB = { x: B.x - A.x, y: B.y - A.y };
        const AC = { x: C.x - A.x, y: C.y - A.y };
        const AO = { x: -A.x, y: -A.y };

        const ABperp = { x: -AB.y, y: AB.x };
        const ACperp = { x: AC.y, y: -AC.x };

        if (this.dot(ABperp, AO) > 0) {
            simplex.points[0] = B;
            simplex.points[1] = A;
            simplex.count = 2;
            direction.x = ABperp.x;
            direction.y = ABperp.y;
            return false;
        }

        if (this.dot(ACperp, AO) > 0) {
            simplex.points[0] = C;
            simplex.points[1] = A;
            simplex.count = 2;
            direction.x = ACperp.x;
            direction.y = ACperp.y;
            return false;
        }

        return true;
    }

    private static dot(a: IVec2Like, b: IVec2Like): number {
        return a.x * b.x + a.y * b.y;
    }
}

export class SAT2D {
    private static readonly EPSILON = 1e-10;

    static testPolygonPolygon(
        verticesA: readonly IVec2Like[],
        verticesB: readonly IVec2Like[],
        transformA: { position: IVec2Like; rotation: number },
        transformB: { position: IVec2Like; rotation: number }
    ): { colliding: boolean; penetration: number; normal: IVec2Like } {
        let minPenetration = Infinity;
        let bestNormal: IVec2Like = { x: 0, y: 0 };

        const result = this.findMinSeparation(verticesA, verticesB, transformA, transformB);
        if (!result.colliding) {
            return { colliding: false, penetration: 0, normal: { x: 0, y: 0 } };
        }

        if (result.penetration < minPenetration) {
            minPenetration = result.penetration;
            bestNormal = result.normal;
        }

        const result2 = this.findMinSeparation(verticesB, verticesA, transformB, transformA);
        if (!result2.colliding) {
            return { colliding: false, penetration: 0, normal: { x: 0, y: 0 } };
        }

        if (result2.penetration < minPenetration) {
            minPenetration = result2.penetration;
            bestNormal = { x: -result2.normal.x, y: -result2.normal.y };
        }

        return {
            colliding: true,
            penetration: minPenetration,
            normal: bestNormal,
        };
    }

    private static findMinSeparation(
        verticesA: readonly IVec2Like[],
        verticesB: readonly IVec2Like[],
        transformA: { position: IVec2Like; rotation: number },
        transformB: { position: IVec2Like; rotation: number }
    ): { colliding: boolean; penetration: number; normal: IVec2Like } {
        let minPenetration = -Infinity;
        let bestNormal: IVec2Like = { x: 0, y: 0 };

        for (let i = 0; i < verticesA.length; i++) {
            const j = (i + 1) % verticesA.length;

            const edge = {
                x: verticesA[j].x - verticesA[i].x,
                y: verticesA[j].y - verticesA[i].y,
            };

            const normal = {
                x: -edge.y,
                y: edge.x,
            };

            const length = Math.sqrt(normal.x * normal.x + normal.y * normal.y);
            if (length > SAT2D.EPSILON) {
                normal.x /= length;
                normal.y /= length;
            }

            const { min: minA, max: maxA } = this.projectPolygon(verticesA, transformA, normal);
            const { min: minB, max: maxB } = this.projectPolygon(verticesB, transformB, normal);

            if (maxA < minB || maxB < minA) {
                return { colliding: false, penetration: 0, normal: { x: 0, y: 0 } };
            }

            const penetration = Math.min(maxA - minB, maxB - minA);
            if (penetration > minPenetration) {
                minPenetration = penetration;
                bestNormal = normal;
            }
        }

        return {
            colliding: true,
            penetration: minPenetration,
            normal: bestNormal,
        };
    }

    private static projectPolygon(
        vertices: readonly IVec2Like[],
        transform: { position: IVec2Like; rotation: number },
        axis: IVec2Like
    ): { min: number; max: number } {
        let min = Infinity;
        let max = -Infinity;

        const cos = Math.cos(transform.rotation);
        const sin = Math.sin(transform.rotation);

        for (const vertex of vertices) {
            const x = cos * vertex.x - sin * vertex.y + transform.position.x;
            const y = sin * vertex.x + cos * vertex.y + transform.position.y;
            const projection = x * axis.x + y * axis.y;

            if (projection < min) min = projection;
            if (projection > max) max = projection;
        }

        return { min, max };
    }
}

export class EPA2D {
    private static readonly MAX_ITERATIONS = 32;
    private static readonly EPSILON = 1e-10;

    static findPenetrationDepth(
        verticesA: readonly IVec2Like[],
        verticesB: readonly IVec2Like[],
        transformA: { position: IVec2Like; rotation: number },
        transformB: { position: IVec2Like; rotation: number },
        simplex: IVec2Like[]
    ): { depth: number; normal: IVec2Like } {
        const polytope = [...simplex];

        for (let iter = 0; iter < EPA2D.MAX_ITERATIONS; iter++) {
            let minDistance = Infinity;
            let minIndex = 0;
            let minNormal: IVec2Like = { x: 0, y: 0 };

            for (let i = 0; i < polytope.length; i++) {
                const j = (i + 1) % polytope.length;

                const edge = {
                    x: polytope[j].x - polytope[i].x,
                    y: polytope[j].y - polytope[i].y,
                };

                const normal = {
                    x: -edge.y,
                    y: edge.x,
                };

                const length = Math.sqrt(normal.x * normal.x + normal.y * normal.y);
                if (length > EPA2D.EPSILON) {
                    normal.x /= length;
                    normal.y /= length;
                }

                const distance = normal.x * polytope[i].x + normal.y * polytope[i].y;

                if (distance < minDistance) {
                    minDistance = distance;
                    minIndex = i;
                    minNormal = normal;
                }
            }

            const support = GJK2D['support'](
                verticesA,
                verticesB,
                transformA,
                transformB,
                minNormal
            );

            const distance = minNormal.x * support.point.x + minNormal.y * support.point.y;

            if (distance - minDistance < EPA2D.EPSILON) {
                return {
                    depth: minDistance,
                    normal: minNormal,
                };
            }

            polytope.splice(minIndex + 1, 0, support.point);
        }

        return { depth: 0, normal: { x: 0, y: 0 } };
    }
}
