import { Vec3, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import { PhysicsConstants } from '../types';
import type { BodyId3D, ConstraintId3D } from '../types/physics-3d';
import { transformPoint3D } from './physics-world-3d-shared';

export interface ISpringHost {
    readonly constraintManager: {
        getAllConstraintIds(): ConstraintId3D[];
        getConstraintType(cid: ConstraintId3D): number;
        getConstraintBodyIds(cid: ConstraintId3D): { bodyIdA: BodyId3D; bodyIdB: BodyId3D };
        getConstraintLocalAnchorA(cid: ConstraintId3D): IVec3Like;
        getConstraintLocalAnchorB(cid: ConstraintId3D): IVec3Like;
        getConstraintParam(cid: ConstraintId3D, index: number): number;
    };
    readonly bodyManager: {
        getPosition(bodyId: BodyId3D): IVec3Like;
        getRotation(bodyId: BodyId3D): IQuatLike;
        getBodyType(bodyId: BodyId3D): number;
        getInverseMass(bodyId: BodyId3D): number;
        getLinearVelocity(bodyId: BodyId3D): IVec3Like;
        applyImpulse(bodyId: BodyId3D, impulse: IVec3Like): void;
        setPosition(bodyId: BodyId3D, position: IVec3Like): void;
    };
}

export class PhysicsWorld3DSpring {
    constructor(private readonly _host: ISpringHost) {}

    solveSpringForces(dt?: number): void {
        const cm = this._host.constraintManager;
        const bm = this._host.bodyManager;
        const constraintIds = cm.getAllConstraintIds();
        if (constraintIds.length === 0) return;

        const BIAS = 0.2;
        const stepDt = dt ?? (1 / 60);

        for (const cid of constraintIds) {
            const type = cm.getConstraintType(cid);
            if (type !== 6) continue;

            const { bodyIdA, bodyIdB } = cm.getConstraintBodyIds(cid);
            const typeA = bm.getBodyType(bodyIdA);
            const typeB = bm.getBodyType(bodyIdB);
            if (typeA !== 2 && typeB !== 2) continue;

            const posA = bm.getPosition(bodyIdA);
            const posB = bm.getPosition(bodyIdB);
            const rotA = bm.getRotation(bodyIdA);
            const rotB = bm.getRotation(bodyIdB);

            const localAnchorA = cm.getConstraintLocalAnchorA(cid);
            const localAnchorB = cm.getConstraintLocalAnchorB(cid);

            const worldAnchorA = transformPoint3D(localAnchorA, posA, rotA);
            const worldAnchorB = transformPoint3D(localAnchorB, posB, rotB);

            const delta = Vec3.subtract(worldAnchorB, worldAnchorA);
            const currentDist = Vec3.len(delta);

            const targetDist = cm.getConstraintParam(cid, 0);
            const error = currentDist - targetDist;
            if (Math.abs(error) < PhysicsConstants.EPSILON) continue;

            const dir = currentDist > PhysicsConstants.EPSILON
                ? Vec3.normalize(delta)
                : { x: 0, y: 1, z: 0 };

            const invMassA = typeA === 2 ? bm.getInverseMass(bodyIdA) : 0;
            const invMassB = typeB === 2 ? bm.getInverseMass(bodyIdB) : 0;
            const invMassSum = invMassA + invMassB;
            if (invMassSum > PhysicsConstants.EPSILON) {
                const correction = Vec3.multiplyScalar(dir, error * BIAS / invMassSum);
                if (typeA === 2) {
                    bm.setPosition(bodyIdA, Vec3.add(posA, Vec3.multiplyScalar(correction, invMassA)));
                }
                if (typeB === 2) {
                    bm.setPosition(bodyIdB, Vec3.subtract(posB, Vec3.multiplyScalar(correction, invMassB)));
                }
            }

            const stiffness = cm.getConstraintParam(cid, 1);
            const damping = cm.getConstraintParam(cid, 2);
            const relVel = Vec3.subtract(
                bm.getLinearVelocity(bodyIdB),
                bm.getLinearVelocity(bodyIdA)
            );
            const velAlongDir = Vec3.dot(relVel, dir);
            const springForce = -stiffness * error - damping * velAlongDir;
            const impulse = Vec3.multiplyScalar(dir, springForce * stepDt);

            if (typeA === 2) {
                bm.applyImpulse(bodyIdA, Vec3.negate(impulse));
            }
            if (typeB === 2) {
                bm.applyImpulse(bodyIdB, impulse);
            }
        }
    }
}
