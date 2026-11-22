import { makeCollisionPairKey } from '@axrone/physics-core';
import type { BodyId3D } from '../types/physics-3d';
import type { IResolvedContactManifold3D } from './physics-world-3d-shared';

export class PhysicsWorld3DContactIndex {
    private readonly _jointCollisionCounts = new Map<number, number>();
    private readonly _bodyContactIndex = new Map<number, number[]>();

    rebuildBodyContactIndex(contactManifolds: ReadonlyMap<number, IResolvedContactManifold3D>): void {
        this._bodyContactIndex.clear();
        for (const [pairKey, m] of contactManifolds) {
            let arr = this._bodyContactIndex.get(Number(m.bodyIdA));
            if (!arr) { arr = []; this._bodyContactIndex.set(Number(m.bodyIdA), arr); }
            arr.push(pairKey);
            arr = this._bodyContactIndex.get(Number(m.bodyIdB));
            if (!arr) { arr = []; this._bodyContactIndex.set(Number(m.bodyIdB), arr); }
            arr.push(pairKey);
        }
    }

    getContactPairKeysForBody(bodyId: BodyId3D): number[] | undefined {
        return this._bodyContactIndex.get(Number(bodyId));
    }

    getManifoldBodyIds(
        contactManifolds: ReadonlyMap<number, IResolvedContactManifold3D>,
        pairKey: number
    ): { bodyIdA: BodyId3D; bodyIdB: BodyId3D } | null {
        const m = contactManifolds.get(pairKey);
        return m ? { bodyIdA: m.bodyIdA, bodyIdB: m.bodyIdB } : null;
    }

    registerJointCollisionPair(bodyIdA: BodyId3D, bodyIdB: BodyId3D): void {
        const key = makeCollisionPairKey(Number(bodyIdA), Number(bodyIdB));
        this._jointCollisionCounts.set(key, (this._jointCollisionCounts.get(key) ?? 0) + 1);
    }

    unregisterJointCollisionPair(bodyIdA: BodyId3D, bodyIdB: BodyId3D): void {
        const key = makeCollisionPairKey(Number(bodyIdA), Number(bodyIdB));
        const count = this._jointCollisionCounts.get(key);
        if (count === undefined) return;
        if (count <= 1) {
            this._jointCollisionCounts.delete(key);
        } else {
            this._jointCollisionCounts.set(key, count - 1);
        }
    }

    removeBodyState(
        bodyId: BodyId3D,
        contactManifolds: ReadonlyMap<number, IResolvedContactManifold3D>,
        warmImpulses: Map<number, { normal: number; tangent: number }>,
        previousManifolds: Map<number, IResolvedContactManifold3D>
    ): void {
        const bid = Number(bodyId);
        for (const [key, m] of contactManifolds) {
            if (Number(m.bodyIdA) === bid || Number(m.bodyIdB) === bid) {
                for (let pi = 0; pi < m.pointCount; pi++) {
                    warmImpulses.delete(m.pairKey * 4 + pi);
                }
            }
        }
        for (const [key, m] of previousManifolds) {
            if (Number(m.bodyIdA) === bid || Number(m.bodyIdB) === bid) {
                previousManifolds.delete(key);
            }
        }
        this._bodyContactIndex.delete(bid);
        if (this._jointCollisionCounts.size > 0) {
            for (const [key, m] of contactManifolds) {
                if (Number(m.bodyIdA) === bid || Number(m.bodyIdB) === bid) {
                    const pairBodyKey = makeCollisionPairKey(Number(m.bodyIdA), Number(m.bodyIdB));
                    this._jointCollisionCounts.delete(pairBodyKey);
                }
            }
        }
    }

    get jointCollisionCounts(): ReadonlyMap<number, number> {
        return this._jointCollisionCounts;
    }
}
