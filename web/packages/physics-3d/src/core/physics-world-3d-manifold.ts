import { Vec3, type IVec3Like, type IQuatLike } from '@axrone/numeric';
import type { ContactId, Impulse, IContactManifold3D, ManifoldId } from '../types';
import type { BodyId3D, ShapeId3D } from '../types/physics-3d';
import {
    SHAPE_TYPE_BOX,
    type IResolvedContactManifold3D,
    type IMutableContactPoint3D,
    type IShapeDescriptor3D,
    type IShapeFrame3D,
    type IShapePairCandidate3D,
    buildOrthonormalBasis,
    inverseTransformPoint3D,
    isBoxDef,
    isSphereDef,
} from './physics-world-3d-shared';
import type { ICollisionResult, INarrowphaseHost } from './physics-world-3d-narrowphase';
import { resolveShapeFrame } from './physics-world-3d-shape-geometry';

export interface IManifoldBuilderHost extends INarrowphaseHost {
    readonly bodyManager: {
        getPosition(bodyId: BodyId3D): IVec3Like;
        getRotation(bodyId: BodyId3D): IQuatLike;
        getBodyType(bodyId: BodyId3D): number;
        isEnabled(bodyId: BodyId3D): boolean;
        getInverseMass(bodyId: BodyId3D): number;
        getInverseInertia(bodyId: BodyId3D): IVec3Like;
        isFixedRotation(bodyId: BodyId3D): boolean;
        getLinearVelocity(bodyId: BodyId3D): IVec3Like;
        getAngularVelocity(bodyId: BodyId3D): IVec3Like;
        applyImpulse(bodyId: BodyId3D, impulse: IVec3Like, point: IVec3Like): void;
        setPosition(bodyId: BodyId3D, position: IVec3Like): void;
    };
    readonly getShapeWorldCenter: (descriptor: IShapeDescriptor3D) => IVec3Like;
    readonly detectCollision: (
        dA: IShapeDescriptor3D,
        dB: IShapeDescriptor3D,
        aabbA: { min: IVec3Like; max: IVec3Like },
        aabbB: { min: IVec3Like; max: IVec3Like }
    ) => ICollisionResult | null;
    readonly buildBoxBoxManifold: (
        dA: IShapeDescriptor3D,
        dB: IShapeDescriptor3D,
        normal: IVec3Like,
        totalPen: number
    ) => { worldPointA: IVec3Like; worldPointB: IVec3Like; separation: number }[];
}

export class PhysicsWorld3DManifoldBuilder {
    private _nextContactId = 1 as ContactId;
    private _nextManifoldId = 1;

    constructor(private readonly _host: IManifoldBuilderHost) {}

    /** Current-step transform frame of a box shape, or null for other kinds. */
    private _frameFor(descriptor: IShapeDescriptor3D): IShapeFrame3D | null {
        return resolveShapeFrame(descriptor, this._host.bodyManager, this._host.getFrameGeneration());
    }

    buildContactManifold(pair: IShapePairCandidate3D, gap: ICollisionResult | null): IResolvedContactManifold3D | null {
        const dA = pair.descriptorA, dB = pair.descriptorB;
        const c = gap ?? this._host.detectCollision(dA, dB, pair.aabbA, pair.aabbB);
        if (!c) return null;
        const { tangent1, tangent2 } = buildOrthonormalBasis(c.normal);
        const friction = Math.sqrt(dA.material.friction * dB.material.friction);
        const restitution = Math.max(dA.material.restitution, dB.material.restitution);

        if (isBoxDef(dA.def) && isBoxDef(dB.def)) {
            const clipPoints = this._host.buildBoxBoxManifold(dA, dB, c.normal, c.penetration);
            if (clipPoints.length >= 2) {
                const points: IMutableContactPoint3D[] = [];
                const bm = this._host.bodyManager;
                // Box shapes already carry this step's transform frame, so the
                // body pose needs no Map lookup here.
                const frameA = this._frameFor(dA), frameB = this._frameFor(dB);
                const posA = frameA ? frameA.bodyPosition : bm.getPosition(dA.bodyId);
                const rotA = frameA ? frameA.bodyRotation : bm.getRotation(dA.bodyId);
                const posB = frameB ? frameB.bodyPosition : bm.getPosition(dB.bodyId);
                const rotB = frameB ? frameB.bodyRotation : bm.getRotation(dB.bodyId);
                for (const cp of clipPoints) {
                    const lA = inverseTransformPoint3D(cp.worldPointA, posA, rotA);
                    const lB = inverseTransformPoint3D(cp.worldPointB, posB, rotB);
                    points.push({
                        id: (this._nextContactId++ as unknown) as ContactId,
                        localPointA: lA, localPointB: lB,
                        normalImpulse: 0 as Impulse, tangentImpulse1: 0 as Impulse, tangentImpulse2: 0 as Impulse,
                        separation: cp.separation,
                    });
                }
                return {
                    id: (this._nextManifoldId++ as ManifoldId),
                    pairKey: pair.pairKey, descriptorA: dA, descriptorB: dB,
                    bodyIdA: dA.bodyId, bodyIdB: dB.bodyId,
                    shapeIdA: dA.id, shapeIdB: dB.id,
                    normal: c.normal, tangent1, tangent2, pointCount: points.length,
                    points, sensor: dA.isSensor || dB.isSensor,
                    friction, restitution,
                    solverOffset: -1,
                };
            }
        }

        const wA = this.getContactPointOnShape(dA, c, true);
        const wB = this.getContactPointOnShape(dB, c, false);
        const lA = inverseTransformPoint3D(wA, this._host.bodyManager.getPosition(dA.bodyId), this._host.bodyManager.getRotation(dA.bodyId));
        const lB = inverseTransformPoint3D(wB, this._host.bodyManager.getPosition(dB.bodyId), this._host.bodyManager.getRotation(dB.bodyId));
        return {
            id: (this._nextManifoldId++ as ManifoldId),
            pairKey: pair.pairKey, descriptorA: dA, descriptorB: dB,
            bodyIdA: dA.bodyId, bodyIdB: dB.bodyId,
            shapeIdA: dA.id, shapeIdB: dB.id,
            normal: c.normal, tangent1, tangent2, pointCount: 1,
            points: [{
                id: (this._nextContactId++ as unknown) as ContactId,
                localPointA: lA, localPointB: lB,
                normalImpulse: 0 as Impulse, tangentImpulse1: 0 as Impulse, tangentImpulse2: 0 as Impulse,
                separation: Vec3.dot(Vec3.subtract(wB, wA), c.normal),
            }],
            sensor: dA.isSensor || dB.isSensor,
            friction, restitution,
            solverOffset: -1,
        };
    }

    private getContactPointOnShape(d: IShapeDescriptor3D, c: { normal: IVec3Like; point: IVec3Like; penetration: number }, first: boolean): IVec3Like {
        if (isSphereDef(d.def)) {
            return Vec3.add(this._host.getShapeWorldCenter(d), Vec3.multiplyScalar(first ? c.normal : Vec3.negate(c.normal), d.def.radius));
        }
        return c.point;
    }

    toContactManifold(m: IResolvedContactManifold3D): IContactManifold3D {
        return {
            id: m.id,
            bodyIdA: m.bodyIdA,
            bodyIdB: m.bodyIdB,
            shapeIdA: m.shapeIdA,
            shapeIdB: m.shapeIdB,
            normal: m.normal,
            tangent1: m.tangent1,
            tangent2: m.tangent2,
            pointCount: m.pointCount,
            points: m.points.map((p) => ({
                id: p.id,
                localPointA: p.localPointA,
                localPointB: p.localPointB,
                separation: p.separation,
                normalImpulse: p.normalImpulse,
                tangentImpulse1: p.tangentImpulse1,
                tangentImpulse2: p.tangentImpulse2,
            })),
        };
    }
}
