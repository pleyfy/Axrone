import { Vec2, IVec2Like } from '@axrone/numeric';
import type { ShapeId } from '../types';
import type { IContactManifold2D } from '../types/collision';
import type { ShapeManager2D } from './shape-manager';

export class Narrowphase2D {
    static collideCircleCircle(
        centerA: Readonly<IVec2Like>,
        radiusA: number,
        centerB: Readonly<IVec2Like>,
        radiusB: number,
        manifold: IContactManifold2D
    ): void {
        const dx = centerB.x - centerA.x;
        const dy = centerB.y - centerA.y;
        const distSq = dx * dx + dy * dy;
        const radiusSum = radiusA + radiusB;

        if (distSq > radiusSum * radiusSum || distSq === 0) {
            (manifold as any).pointCount = 0;
            return;
        }

        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;

        const separation = dist - radiusSum;

        const m = manifold as any;
        m.pointCount = 1;
        m.normal = { x: nx, y: ny };
        m.points = m.points || [
            {
                id: 0,
                localPointA: { x: 0, y: 0 },

                localPointB: { x: 0, y: 0 },
                normalImpulse: 0,
                tangentImpulse: 0,
                separation: separation,
            },
        ];
    }
}
