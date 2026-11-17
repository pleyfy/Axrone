import { Vec3, Quat, clamp, type IVec3Like, type IVec2Like, type IQuatLike } from '@axrone/numeric';
import { PhysicsConstants } from '../types';
import type { BodyId3D, ShapeId3D } from '../types/physics-3d';
import {
    IDENTITY_ROTATION,
    SHAPE_TYPE_BOX,
    SHAPE_TYPE_CAPSULE,
    SHAPE_TYPE_CONE,
    SHAPE_TYPE_CONVEX_HULL,
    SHAPE_TYPE_CYLINDER,
    SHAPE_TYPE_HEIGHTFIELD,
    SHAPE_TYPE_SPHERE,
    SHAPE_TYPE_TRIANGLE_MESH,
    type IAabb3D,
    type IShapeDescriptor3D,
    type IShapeFrame3D,
    isBoxDef,
    isCapsuleDef,
    isConeDef,
    isCylinderDef,
    isConvexHullDef,
    isHeightFieldDef,
    isSphereDef,
    isTriangleMeshDef,
    transformPoint3D,
    inverseTransformPoint3D,
    midpointVec3,
} from './physics-world-3d-shared';
import { GJK3D, supportFromVertices, type Support3D } from './gjk3d';
import { resolveShapeFrame } from './physics-world-3d-shape-geometry';
import { PhysicsError3D } from './physics-managers-3d';

const BOX_EDGE_AXIS_EPSILON_SQ = 1e-8;
const BOX_FACE_EDGE_BIAS = 0.001;

export interface INarrowphaseHost {
    readonly bodyManager: {
        getPosition(bodyId: BodyId3D): IVec3Like;
        getRotation(bodyId: BodyId3D): IQuatLike;
        getBodyType(bodyId: BodyId3D): number;
    };
    readonly getShapeWorldCenter: (descriptor: IShapeDescriptor3D) => IVec3Like;
    /**
     * Token of the step currently being solved. A shape frame is only trusted
     * while its own generation matches, so a frame can never be read after the
     * body has moved.
     */
    readonly getFrameGeneration: () => number;
}

export interface ICollisionResult {
    normal: IVec3Like;
    point: IVec3Like;
    penetration: number;
}

export class PhysicsWorld3DNarrowphase {
    constructor(private readonly _host: INarrowphaseHost) {}

    /**
     * Returns this shape's transform frame for the current step, refreshing it if
     * the broadphase pass has not produced one yet (for example when a pair is
     * tested outside the normal collection order). Returns null for shape kinds
     * that carry no frame.
     */
    private _frameFor(descriptor: IShapeDescriptor3D): IShapeFrame3D | null {
        return resolveShapeFrame(descriptor, this._host.bodyManager, this._host.getFrameGeneration());
    }

    detectCollision(
        dA: IShapeDescriptor3D,
        dB: IShapeDescriptor3D,
        aabbA: IAabb3D,
        aabbB: IAabb3D
    ): ICollisionResult | null {
        const tA = dA.type, tB = dB.type;
        if (tA === SHAPE_TYPE_SPHERE && tB === SHAPE_TYPE_SPHERE) return this.sphSph(dA, dB);
        if (tA === SHAPE_TYPE_SPHERE && tB === SHAPE_TYPE_BOX) return this.sphBox(dA, dB);
        if (tA === SHAPE_TYPE_BOX && tB === SHAPE_TYPE_SPHERE) { const k = this.sphBox(dB, dA); return k ? { normal: Vec3.negate(k.normal), point: k.point, penetration: k.penetration } : null; }
        if (tA === SHAPE_TYPE_BOX && tB === SHAPE_TYPE_BOX) return this.boxBox(dA, dB);
        if (tA === SHAPE_TYPE_CAPSULE && tB === SHAPE_TYPE_CAPSULE) return this.capCap(dA, dB);
        if (tA === SHAPE_TYPE_CAPSULE && tB === SHAPE_TYPE_SPHERE) return this.capSph(dA, dB);
        if (tA === SHAPE_TYPE_SPHERE && tB === SHAPE_TYPE_CAPSULE) { const k = this.capSph(dB, dA); return k ? { normal: Vec3.negate(k.normal), point: k.point, penetration: k.penetration } : null; }
        if (tA === SHAPE_TYPE_CAPSULE && tB === SHAPE_TYPE_BOX) return this.capBox(dA, dB);
        if (tA === SHAPE_TYPE_BOX && tB === SHAPE_TYPE_CAPSULE) { const k = this.capBox(dB, dA); return k ? { normal: Vec3.negate(k.normal), point: k.point, penetration: k.penetration } : null; }
        if (
            tA === SHAPE_TYPE_CONVEX_HULL || tA === SHAPE_TYPE_TRIANGLE_MESH ||
            tB === SHAPE_TYPE_CONVEX_HULL || tB === SHAPE_TYPE_TRIANGLE_MESH ||
            tA === SHAPE_TYPE_CYLINDER || tA === SHAPE_TYPE_CONE ||
            tB === SHAPE_TYPE_CYLINDER || tB === SHAPE_TYPE_CONE
        ) {
            return this.convex(dA, dB, aabbA, aabbB);
        }
        if (tA === SHAPE_TYPE_HEIGHTFIELD || tB === SHAPE_TYPE_HEIGHTFIELD) {
            return this.convex(dA, dB, aabbA, aabbB);
        }
        return this.aabbApprox(dA, dB, aabbA, aabbB);
    }

    private convex(
        dA: IShapeDescriptor3D,
        dB: IShapeDescriptor3D,
        aabbA: IAabb3D,
        aabbB: IAabb3D
    ): ICollisionResult | null {
        const supportA = this.supportForShape(dA);
        const supportB = this.supportForShape(dB);
        if (!supportA || !supportB) {
            return this.aabbApprox(dA, dB, aabbA, aabbB);
        }

        const result = GJK3D.intersect(supportA, supportB);
        if (!result.hit) return null;

        return {
            normal: { x: result.normal.x, y: result.normal.y, z: result.normal.z },
            point: { x: result.point.x, y: result.point.y, z: result.point.z },
            penetration: result.depth,
        };
    }

    private supportForShape(descriptor: IShapeDescriptor3D): Support3D | null {
        const bm = this._host.bodyManager;
        const pos = bm.getPosition(descriptor.bodyId);
        const rot = bm.getRotation(descriptor.bodyId);
        const def = descriptor.def;

        if (isSphereDef(def)) {
            const center = this._host.getShapeWorldCenter(descriptor);
            const r = def.radius;
            return (dir: IVec3Like): IVec3Like => {
                const len = Vec3.len(dir);
                const inv = len > 1e-6 ? r / len : 0;
                return { x: center.x + dir.x * inv, y: center.y + dir.y * inv, z: center.z + dir.z * inv };
            };
        }
        if (isBoxDef(def)) {
            const center = transformPoint3D(def.center, pos, rot);
            const halfExtents = def.halfExtents;
            const rotFull = Quat.multiply(rot, def.rotation ?? IDENTITY_ROTATION);
            const axes = [
                Quat.rotateVector(rotFull, { x: 1, y: 0, z: 0 }),
                Quat.rotateVector(rotFull, { x: 0, y: 1, z: 0 }),
                Quat.rotateVector(rotFull, { x: 0, y: 0, z: 1 }),
            ];
            const ext = [halfExtents.x, halfExtents.y, halfExtents.z];
            return (dir: IVec3Like): IVec3Like => {
                let x = center.x, y = center.y, z = center.z;
                for (let i = 0; i < 3; i++) {
                    const s = (dir.x * axes[i].x + dir.y * axes[i].y + dir.z * axes[i].z) >= 0 ? ext[i] : -ext[i];
                    x += axes[i].x * s;
                    y += axes[i].y * s;
                    z += axes[i].z * s;
                }
                return { x, y, z };
            };
        }
        if (isCapsuleDef(def)) {
            const p1 = transformPoint3D(def.p1, pos, rot);
            const p2 = transformPoint3D(def.p2, pos, rot);
            const r = def.radius;
            return (dir: IVec3Like): IVec3Like => {
                const d1 = dir.x * p1.x + dir.y * p1.y + dir.z * p1.z;
                const d2 = dir.x * p2.x + dir.y * p2.y + dir.z * p2.z;
                const base = d1 >= d2 ? p1 : p2;
                const len = Vec3.len(dir);
                const inv = len > 1e-6 ? r / len : 0;
                return { x: base.x + dir.x * inv, y: base.y + dir.y * inv, z: base.z + dir.z * inv };
            };
        }
        if (isConvexHullDef(def) || isTriangleMeshDef(def) || isCylinderDef(def) || isConeDef(def)) {
            const vertices = this.worldVerticesOf(descriptor);
            if (vertices.length === 0) return null;
            return supportFromVertices(vertices as IVec3Like[]);
        }
        return null;
    }

    private worldVerticesOf(descriptor: IShapeDescriptor3D): IVec3Like[] {
        const bm = this._host.bodyManager;
        const pos = bm.getPosition(descriptor.bodyId);
        const rot = bm.getRotation(descriptor.bodyId);
        const def = descriptor.def;

        if (isConvexHullDef(def) || isTriangleMeshDef(def)) {
            return def.vertices.map((v) => transformPoint3D(v, pos, rot));
        }

        if (isCylinderDef(def) || isConeDef(def)) {
            const center = def.center ?? { x: 0, y: 0, z: 0 };
            const radius = def.radius ?? 0;
            const height = def.height ?? 0;
            const segments = 8;
            const c = transformPoint3D(center, pos, rot);
            const localY = Quat.rotateVector(rot, { x: 0, y: 1, z: 0 });
            const localX = Quat.rotateVector(rot, { x: 1, y: 0, z: 0 });
            const localZ = Quat.rotateVector(rot, { x: 0, y: 0, z: 1 });
            const ringOffset = Vec3.multiplyScalar(localY, height * 0.5);
            const top = Vec3.add(c, ringOffset);
            const bottom = Vec3.subtract(c, ringOffset);
            const verts: IVec3Like[] = [];
            for (let i = 0; i < segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                const ox = Math.cos(a) * radius;
                const oz = Math.sin(a) * radius;
                const radial = Vec3.add(Vec3.multiplyScalar(localX, ox), Vec3.multiplyScalar(localZ, oz));
                verts.push(Vec3.add(top, radial));
                verts.push(Vec3.add(bottom, radial));
            }
            if (isConeDef(def)) {
                verts.push(Vec3.add(c, Vec3.multiplyScalar(localY, height)));
            }
            return verts;
        }

        if (isHeightFieldDef(def)) {
            const { heights, width, depth, scaleX = 1, scaleY = 1, scaleZ = 1 } = def;
            const c = transformPoint3D({ x: 0, y: 0, z: 0 }, pos, rot);
            const verts: IVec2Like[] = [];
            const halfW = (width - 1) * 0.5;
            const halfD = (depth - 1) * 0.5;
            const stepX = Math.max(1, Math.floor(width / 8));
            const stepZ = Math.max(1, Math.floor(depth / 8));
            for (let iz = 0; iz < depth; iz += stepZ) {
                for (let ix = 0; ix < width; ix += stepX) {
                    const h = heights[iz * width + ix] ?? 0;
                    const lx = (ix - halfW) * scaleX;
                    const ly = h * scaleY;
                    const lz = (iz - halfD) * scaleZ;
                    const local = Vec3.add(c, Vec3.add(
                        Vec3.add(Vec3.multiplyScalar(Quat.rotateVector(rot, { x: 1, y: 0, z: 0 }), lx),
                            Vec3.multiplyScalar(Quat.rotateVector(rot, { x: 0, y: 1, z: 0 }), ly)),
                        Vec3.multiplyScalar(Quat.rotateVector(rot, { x: 0, y: 0, z: 1 }), lz)
                    ));
                    verts.push(local);
                }
            }
            return verts as IVec3Like[];
        }

        return [];
    }

    private sphSph(dA: IShapeDescriptor3D, dB: IShapeDescriptor3D): ICollisionResult | null {
        const cA = this._host.getShapeWorldCenter(dA), cB = this._host.getShapeWorldCenter(dB);
        const delta = Vec3.subtract(cB, cA);
        const dist = Vec3.len(delta);
        const rA = isSphereDef(dA.def) ? dA.def.radius : 0;
        const rB = isSphereDef(dB.def) ? dB.def.radius : 0;
        const rSum = rA + rB;
        if (dist > rSum) return null;
        const n = dist > PhysicsConstants.EPSILON ? Vec3.multiplyScalar(delta, 1 / dist) : { x: 1, y: 0, z: 0 };
        const pen = rSum - dist;
        return { normal: n, point: Vec3.add(cA, Vec3.multiplyScalar(n, rA - pen * 0.5)), penetration: pen };
    }

    private sphBox(s: IShapeDescriptor3D, b: IShapeDescriptor3D): ICollisionResult | null {
        const sC = this._host.getShapeWorldCenter(s);
        const bP = this._host.bodyManager.getPosition(b.bodyId), bR = this._host.bodyManager.getRotation(b.bodyId);
        if (!isSphereDef(s.def) || !isBoxDef(b.def)) return null;
        const bC = transformPoint3D(b.def.center, bP, bR);
        const bRot = Quat.multiply(bR, b.def.rotation ?? IDENTITY_ROTATION);
        const localSC = inverseTransformPoint3D(sC, bC, bRot);
        const closestLocal = { x: clamp(localSC.x, -b.def.halfExtents.x, b.def.halfExtents.x), y: clamp(localSC.y, -b.def.halfExtents.y, b.def.halfExtents.y), z: clamp(localSC.z, -b.def.halfExtents.z, b.def.halfExtents.z) };
        const closestWorld = transformPoint3D(closestLocal, bC, bRot);
        const delta = Vec3.subtract(sC, closestWorld);
        const dist = Vec3.len(delta);
        const r = s.def.radius;
        if (dist > r) return null;
        if (dist > PhysicsConstants.EPSILON) return { normal: Vec3.multiplyScalar(delta, -1 / dist), point: closestWorld, penetration: r - dist };
        return { normal: { x: 0, y: 1, z: 0 }, point: closestWorld, penetration: r };
    }

    private boxBox(dA: IShapeDescriptor3D, dB: IShapeDescriptor3D): ICollisionResult | null {
        if (!isBoxDef(dA.def) || !isBoxDef(dB.def)) return null;
        const bDA = dA.def, bDB = dB.def;
        const frameA = this._frameFor(dA);
        const frameB = this._frameFor(dB);
        if (!frameA || !frameB) {
            // Unreachable: isBoxDef() above guarantees refreshShapeFrame() yields a frame.
            throw new PhysicsError3D('Box narrowphase requires a box shape frame', 'INVALID_STATE');
        }
        const cA = frameA.center, cB = frameB.center;
        const axesA = frameA.axes, axesB = frameB.axes;
        const xA = axesA[0], yA = axesA[1], zA = axesA[2];
        const xB = axesB[0], yB = axesB[1], zB = axesB[2];
        const hA = bDA.halfExtents, hB = bDB.halfExtents;
        const delta = Vec3.subtract(cB, cA);
        let minP = Infinity; let bestN: IVec3Like = { x: 0, y: 1, z: 0 };
        // Same six-axis order as the previous `[xA, yA, zA, xB, yB, zB]` array,
        // without allocating it, but the winning axis is copied because the
        // frame objects are reused next step.
        for (let axisIndex = 0; axisIndex < 6; axisIndex++) {
            const ax = axisIndex < 3 ? axesA[axisIndex] : axesB[axisIndex - 3];
            const pA = hA.x * Math.abs(Vec3.dot(xA, ax)) + hA.y * Math.abs(Vec3.dot(yA, ax)) + hA.z * Math.abs(Vec3.dot(zA, ax));
            const pB = hB.x * Math.abs(Vec3.dot(xB, ax)) + hB.y * Math.abs(Vec3.dot(yB, ax)) + hB.z * Math.abs(Vec3.dot(zB, ax));
            const projection = Vec3.dot(delta, ax);
            const d = Math.abs(projection);
            const pen = pA + pB - d;
            if (pen < 0) return null;
            if (pen < minP) {
                minP = pen;
                bestN = projection > 0 ? { x: ax.x, y: ax.y, z: ax.z } : Vec3.negate(ax);
            }
        }
        let edgePair = -1;
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const cross = Vec3.cross(axesA[i], axesB[j]);
                const lenSq = Vec3.lengthSquared(cross);
                if (lenSq < BOX_EDGE_AXIS_EPSILON_SQ) continue;
                const invLen = 1 / Math.sqrt(lenSq);
                const n = { x: cross.x * invLen, y: cross.y * invLen, z: cross.z * invLen };
                const pA = hA.x * Math.abs(Vec3.dot(xA, n)) + hA.y * Math.abs(Vec3.dot(yA, n)) + hA.z * Math.abs(Vec3.dot(zA, n));
                const pB = hB.x * Math.abs(Vec3.dot(xB, n)) + hB.y * Math.abs(Vec3.dot(yB, n)) + hB.z * Math.abs(Vec3.dot(zB, n));
                const projection = Vec3.dot(delta, n);
                const pen = pA + pB - Math.abs(projection);
                if (pen < 0) return null;
                if (pen + BOX_FACE_EDGE_BIAS < minP) {
                    minP = pen;
                    bestN = projection > 0 ? n : Vec3.negate(n);
                    edgePair = i * 3 + j;
                }
            }
        }
        if (edgePair >= 0) return { normal: bestN, point: this.edgeEdgePoint(cA, axesA, hA, cB, axesB, hB, edgePair, bestN), penetration: minP };
        return { normal: bestN, point: midpointVec3(cA, cB), penetration: minP };
    }

    pairSeparation(dA: IShapeDescriptor3D, dB: IShapeDescriptor3D): { distance: number; normal: IVec3Like; point: IVec3Like } | null {
        if (!isBoxDef(dA.def) || !isBoxDef(dB.def)) return null;
        const bDA = dA.def, bDB = dB.def;
        const frameA = this._frameFor(dA);
        const frameB = this._frameFor(dB);
        if (!frameA || !frameB) return null;
        const cA = frameA.center, cB = frameB.center;
        const axesA = frameA.axes, axesB = frameB.axes;
        const xA = axesA[0], yA = axesA[1], zA = axesA[2];
        const xB = axesB[0], yB = axesB[1], zB = axesB[2];
        const hA = bDA.halfExtents, hB = bDB.halfExtents;
        const delta = Vec3.subtract(cB, cA);
        let best = -Infinity;
        let bestAxis: IVec3Like | null = null;
        let bestPositive = false;
        for (let axisIndex = 0; axisIndex < 6; axisIndex++) {
            const ax = axisIndex < 3 ? axesA[axisIndex] : axesB[axisIndex - 3];
            const pA = hA.x * Math.abs(Vec3.dot(xA, ax)) + hA.y * Math.abs(Vec3.dot(yA, ax)) + hA.z * Math.abs(Vec3.dot(zA, ax));
            const pB = hB.x * Math.abs(Vec3.dot(xB, ax)) + hB.y * Math.abs(Vec3.dot(yB, ax)) + hB.z * Math.abs(Vec3.dot(zB, ax));
            const projection = Vec3.dot(delta, ax);
            const pen = pA + pB - Math.abs(projection);
            if (pen < 0 && pen > best) { best = pen; bestAxis = ax; bestPositive = projection > 0; }
        }
        for (let i = 0; i < 3; i++) {
            for (let j = 0; j < 3; j++) {
                const crossed = Vec3.cross(axesA[i], axesB[j]);
                const lenSq = Vec3.lengthSquared(crossed);
                if (lenSq < BOX_EDGE_AXIS_EPSILON_SQ) continue;
                const invLen = 1 / Math.sqrt(lenSq);
                const n = { x: crossed.x * invLen, y: crossed.y * invLen, z: crossed.z * invLen };
                const pA = hA.x * Math.abs(Vec3.dot(xA, n)) + hA.y * Math.abs(Vec3.dot(yA, n)) + hA.z * Math.abs(Vec3.dot(zA, n));
                const pB = hB.x * Math.abs(Vec3.dot(xB, n)) + hB.y * Math.abs(Vec3.dot(yB, n)) + hB.z * Math.abs(Vec3.dot(zB, n));
                const projection = Vec3.dot(delta, n);
                const pen = pA + pB - Math.abs(projection);
                if (pen < 0 && pen > best) { best = pen; bestAxis = n; bestPositive = projection > 0; }
            }
        }
        if (bestAxis === null) return null;
        return {
            distance: -best,
            normal: bestPositive ? { x: bestAxis.x, y: bestAxis.y, z: bestAxis.z } : Vec3.negate(bestAxis),
            point: midpointVec3(cA, cB),
        };
    }

    private edgeEdgePoint(
        cA: IVec3Like, axesA: IVec3Like[], hA: IVec3Like,
        cB: IVec3Like, axesB: IVec3Like[], hB: IVec3Like,
        edgePair: number, n: IVec3Like
    ): IVec3Like {
        const i = Math.floor(edgePair / 3), j = edgePair % 3;
        const extA = [hA.x, hA.y, hA.z], extB = [hB.x, hB.y, hB.z];
        const eA = { x: cA.x, y: cA.y, z: cA.z };
        const eB = { x: cB.x, y: cB.y, z: cB.z };
        for (let k = 0; k < 3; k++) {
            if (k === i) continue;
            const s = Vec3.dot(axesA[k], n) > 0 ? extA[k] : -extA[k];
            eA.x += axesA[k].x * s; eA.y += axesA[k].y * s; eA.z += axesA[k].z * s;
        }
        for (let m = 0; m < 3; m++) {
            if (m === j) continue;
            const s = Vec3.dot(axesB[m], n) > 0 ? -extB[m] : extB[m];
            eB.x += axesB[m].x * s; eB.y += axesB[m].y * s; eB.z += axesB[m].z * s;
        }
        const dirA = axesA[i], dirB = axesB[j];
        const halfA = extA[i], halfB = extB[j];
        const closest = this.segSeg(
            { x: eA.x - dirA.x * halfA, y: eA.y - dirA.y * halfA, z: eA.z - dirA.z * halfA },
            { x: eA.x + dirA.x * halfA, y: eA.y + dirA.y * halfA, z: eA.z + dirA.z * halfA },
            { x: eB.x - dirB.x * halfB, y: eB.y - dirB.y * halfB, z: eB.z - dirB.z * halfB },
            { x: eB.x + dirB.x * halfB, y: eB.y + dirB.y * halfB, z: eB.z + dirB.z * halfB }
        );
        return midpointVec3(closest.pointA, closest.pointB);
    }

    buildBoxBoxManifold(
        dA: IShapeDescriptor3D, dB: IShapeDescriptor3D,
        normal: IVec3Like, totalPen: number
    ): { worldPointA: IVec3Like; worldPointB: IVec3Like; separation: number }[] {
        const bDA = dA.def as { center: IVec3Like; halfExtents: IVec3Like; rotation?: IVec3Like };
        const bDB = dB.def as { center: IVec3Like; halfExtents: IVec3Like; rotation?: IVec3Like };

        // Same frames the SAT test used moments ago, so the centre/rotation/axis
        // derivation happens once per shape per step instead of once per pass.
        const frameA = this._frameFor(dA);
        const frameB = this._frameFor(dB);
        if (!frameA || !frameB) {
            throw new PhysicsError3D('Box manifold requires a box shape frame', 'INVALID_STATE');
        }
        const cA = frameA.center;
        const cB = frameB.center;
        const axesA = frameA.axes;
        const axesB = frameB.axes;

        const negNormal = Vec3.negate(normal);
        let bestDotA = -Infinity, bestA = 0;
        let bestDotB = -Infinity, bestB = 0;
        for (let i = 0; i < 3; i++) {
            const dA2 = Math.abs(Vec3.dot(axesA[i], normal));
            if (dA2 > bestDotA) { bestDotA = dA2; bestA = i; }
            const dB2 = Math.abs(Vec3.dot(axesB[i], negNormal));
            if (dB2 > bestDotB) { bestDotB = dB2; bestB = i; }
        }

        let refCenter: IVec3Like, refAxes: IVec3Like[], refHalf: number[], refSign: number;
        let incCenter: IVec3Like, incAxes: IVec3Like[], incHalf: number[], incSign: number;
        let isARef: boolean;

        if (bestDotA >= bestDotB) {
            isARef = true;
            refCenter = cA; refAxes = axesA; refHalf = [bDA.halfExtents.x, bDA.halfExtents.y, bDA.halfExtents.z];
            refSign = Vec3.dot(normal, axesA[bestA]) > 0 ? 1 : -1;
            incCenter = cB; incAxes = axesB; incHalf = [bDB.halfExtents.x, bDB.halfExtents.y, bDB.halfExtents.z];
            incSign = Vec3.dot(negNormal, axesB[bestB]) > 0 ? 1 : -1;
        } else {
            isARef = false;
            refCenter = cB; refAxes = axesB; refHalf = [bDB.halfExtents.x, bDB.halfExtents.y, bDB.halfExtents.z];
            refSign = Vec3.dot(negNormal, axesB[bestB]) > 0 ? 1 : -1;
            incCenter = cA; incAxes = axesA; incHalf = [bDA.halfExtents.x, bDA.halfExtents.y, bDA.halfExtents.z];
            incSign = Vec3.dot(normal, axesA[bestA]) > 0 ? 1 : -1;
        }

        const incFaceIdx = bestDotA >= bestDotB ? bestB : bestA;
        const incNormal = incAxes[incFaceIdx];
        const incTangent1 = incAxes[(incFaceIdx + 1) % 3];
        const incTangent2 = incAxes[(incFaceIdx + 2) % 3];
        const incFaceOffset = incSign * incHalf[incFaceIdx];
        const hT1 = incHalf[(incFaceIdx + 1) % 3];
        const hT2 = incHalf[(incFaceIdx + 2) % 3];

        const incVerts: IVec3Like[] = [
            Vec3.add(incCenter, Vec3.add(
                Vec3.multiplyScalar(incNormal, incFaceOffset),
                Vec3.add(Vec3.multiplyScalar(incTangent1, -hT1), Vec3.multiplyScalar(incTangent2, -hT2))
            )),
            Vec3.add(incCenter, Vec3.add(
                Vec3.multiplyScalar(incNormal, incFaceOffset),
                Vec3.add(Vec3.multiplyScalar(incTangent1, hT1), Vec3.multiplyScalar(incTangent2, -hT2))
            )),
            Vec3.add(incCenter, Vec3.add(
                Vec3.multiplyScalar(incNormal, incFaceOffset),
                Vec3.add(Vec3.multiplyScalar(incTangent1, hT1), Vec3.multiplyScalar(incTangent2, hT2))
            )),
            Vec3.add(incCenter, Vec3.add(
                Vec3.multiplyScalar(incNormal, incFaceOffset),
                Vec3.add(Vec3.multiplyScalar(incTangent1, -hT1), Vec3.multiplyScalar(incTangent2, hT2))
            )),
        ];

        const refFaceDist = refSign * refHalf[bestDotA >= bestDotB ? bestA : bestB];
        const refNormalActual = isARef
            ? (Vec3.dot(normal, refAxes[bestA]) > 0 ? refAxes[bestA] : Vec3.negate(refAxes[bestA]))
            : (Vec3.dot(negNormal, refAxes[bestB]) > 0 ? refAxes[bestB] : Vec3.negate(refAxes[bestB]));

        const refFaceIdx = bestDotA >= bestDotB ? bestA : bestB;
        const refT1Idx = (refFaceIdx + 1) % 3;
        const refT2Idx = (refFaceIdx + 2) % 3;
        const refT1 = refAxes[refT1Idx];
        const refT2 = refAxes[refT2Idx];
        const refH1 = refHalf[refT1Idx];
        const refH2 = refHalf[refT2Idx];

        let clipped = incVerts;
        clipped = this.clipSegmentToLine(clipped, refT1, refCenter, refH1);
        if (clipped.length < 2) return [];
        clipped = this.clipSegmentToLine(clipped, Vec3.negate(refT1), refCenter, refH1);
        if (clipped.length < 2) return [];
        clipped = this.clipSegmentToLine(clipped, refT2, refCenter, refH2);
        if (clipped.length < 2) return [];
        clipped = this.clipSegmentToLine(clipped, Vec3.negate(refT2), refCenter, refH2);
        if (clipped.length < 2) return [];

        const result: { worldPointA: IVec3Like; worldPointB: IVec3Like; separation: number }[] = [];
        const refFaceCenter = Vec3.add(refCenter, Vec3.multiplyScalar(refAxes[refFaceIdx], refFaceDist));
        for (const pt of clipped) {
            if (result.length >= 4) break;
            const sep = Vec3.dot(Vec3.subtract(pt, refFaceCenter), refNormalActual);
            if (sep <= totalPen * 0.1 + PhysicsConstants.ALLOWED_PENETRATION) {
                const refPoint = Vec3.subtract(pt, Vec3.multiplyScalar(refNormalActual, sep));
                result.push(isARef
                    ? { worldPointA: refPoint, worldPointB: pt, separation: sep }
                    : { worldPointA: pt, worldPointB: refPoint, separation: sep });
            }
        }
        return result;
    }

    private clipSegmentToLine(
        verts: IVec3Like[], planeNormal: IVec3Like, planePoint: IVec3Like, planeOffset: number
    ): IVec3Like[] {
        const out: IVec3Like[] = [];
        const n = verts.length;
        if (n < 2) return out;

        const planeDot = Vec3.dot(planePoint, planeNormal) + planeOffset;
        const ds: number[] = new Array(n);
        for (let i = 0; i < n; i++) {
            ds[i] = Vec3.dot(verts[i], planeNormal) - planeDot;
        }

        for (let i = 0; i < n; i++) {
            const curr = verts[i];
            const next = verts[(i + 1) % n];
            const dc = ds[i];
            const dn = ds[(i + 1) % n];
            if (dc <= 0) out.push(curr);
            if (dc * dn < 0) {
                const t = dc / (dc - dn);
                out.push({
                    x: curr.x + t * (next.x - curr.x),
                    y: curr.y + t * (next.y - curr.y),
                    z: curr.z + t * (next.z - curr.z),
                });
            }
        }
        return out;
    }

    private capCap(dA: IShapeDescriptor3D, dB: IShapeDescriptor3D): ICollisionResult | null {
        if (!isCapsuleDef(dA.def) || !isCapsuleDef(dB.def)) return null;
        const p1A = transformPoint3D(dA.def.p1, this._host.bodyManager.getPosition(dA.bodyId), this._host.bodyManager.getRotation(dA.bodyId));
        const p2A = transformPoint3D(dA.def.p2, this._host.bodyManager.getPosition(dA.bodyId), this._host.bodyManager.getRotation(dA.bodyId));
        const p1B = transformPoint3D(dB.def.p1, this._host.bodyManager.getPosition(dB.bodyId), this._host.bodyManager.getRotation(dB.bodyId));
        const p2B = transformPoint3D(dB.def.p2, this._host.bodyManager.getPosition(dB.bodyId), this._host.bodyManager.getRotation(dB.bodyId));
        const closest = this.segSeg(p1A, p2A, p1B, p2B);
        const rSum = dA.def.radius + dB.def.radius;
        if (closest.distSq > rSum * rSum) return null;
        const dist = Math.sqrt(closest.distSq);
        const invD = dist > PhysicsConstants.EPSILON ? 1 / dist : 0;
        const dx = closest.pointB.x - closest.pointA.x, dy = closest.pointB.y - closest.pointA.y, dz = closest.pointB.z - closest.pointA.z;
        return { normal: { x: dx * invD, y: dy * invD, z: dz * invD }, point: midpointVec3(closest.pointA, closest.pointB), penetration: rSum - dist };
    }

    private capSph(cap: IShapeDescriptor3D, sph: IShapeDescriptor3D): ICollisionResult | null {
        if (!isCapsuleDef(cap.def) || !isSphereDef(sph.def)) return null;
        const p1 = transformPoint3D(cap.def.p1, this._host.bodyManager.getPosition(cap.bodyId), this._host.bodyManager.getRotation(cap.bodyId));
        const p2 = transformPoint3D(cap.def.p2, this._host.bodyManager.getPosition(cap.bodyId), this._host.bodyManager.getRotation(cap.bodyId));
        const sC = this._host.getShapeWorldCenter(sph);
        const closest = this.closestSeg(sC, p1, p2);
        const delta = Vec3.subtract(sC, closest);
        const dist = Vec3.len(delta);
        const rSum = cap.def.radius + sph.def.radius;
        if (dist > rSum) return null;
        const invD = dist > PhysicsConstants.EPSILON ? 1 / dist : 0;
        return { normal: { x: delta.x * invD, y: delta.y * invD, z: delta.z * invD }, point: closest, penetration: rSum - dist };
    }

    private capBox(cap: IShapeDescriptor3D, box: IShapeDescriptor3D): ICollisionResult | null {
        if (!isCapsuleDef(cap.def) || !isBoxDef(box.def)) return null;
        const bm = this._host.bodyManager;
        const capPos = bm.getPosition(cap.bodyId), capRot = bm.getRotation(cap.bodyId);
        const p1 = transformPoint3D(cap.def.p1, capPos, capRot);
        const p2 = transformPoint3D(cap.def.p2, capPos, capRot);
        const boxPos = bm.getPosition(box.bodyId), boxRot = bm.getRotation(box.bodyId);
        const bC = transformPoint3D(box.def.center, boxPos, boxRot);
        const bRot = Quat.multiply(boxRot, box.def.rotation ?? IDENTITY_ROTATION);
        const l1 = inverseTransformPoint3D(p1, bC, bRot);
        const l2 = inverseTransformPoint3D(p2, bC, bRot);
        const half = box.def.halfExtents;
        const radius = cap.def.radius;
        const prox = this.segBoxProximity(l1, l2, half);
        if (prox.distSq > PhysicsConstants.EPSILON * PhysicsConstants.EPSILON) {
            const q = prox.q;
            const cx = clamp(q.x, -half.x, half.x), cy = clamp(q.y, -half.y, half.y), cz = clamp(q.z, -half.z, half.z);
            const dx = q.x - cx, dy = q.y - cy, dz = q.z - cz;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > radius) return null;
            const invD = 1 / dist;
            const outward = Quat.rotateVector(bRot, { x: dx * invD, y: dy * invD, z: dz * invD });
            return { normal: Vec3.negate(outward), point: transformPoint3D({ x: cx, y: cy, z: cz }, bC, bRot), penetration: radius - dist };
        }
        const q = prox.q;
        let exitAxis = 0;
        let exitMargin = half.x - Math.abs(q.x);
        if (half.y - Math.abs(q.y) < exitMargin) { exitAxis = 1; exitMargin = half.y - Math.abs(q.y); }
        if (half.z - Math.abs(q.z) < exitMargin) { exitAxis = 2; exitMargin = half.z - Math.abs(q.z); }
        const depth = exitMargin > 0 ? exitMargin : 0;
        const exitSign = q[exitAxis === 0 ? 'x' : exitAxis === 1 ? 'y' : 'z'] >= 0 ? 1 : -1;
        const exitFaceCoord = half[exitAxis === 0 ? 'x' : exitAxis === 1 ? 'y' : 'z'] * exitSign;
        const localOutward = { x: 0, y: 0, z: 0 };
        localOutward[exitAxis === 0 ? 'x' : exitAxis === 1 ? 'y' : 'z'] = exitSign;
        const localPoint = { x: q.x, y: q.y, z: q.z };
        localPoint[exitAxis === 0 ? 'x' : exitAxis === 1 ? 'y' : 'z'] = exitFaceCoord;
        return { normal: Vec3.negate(Quat.rotateVector(bRot, localOutward)), point: transformPoint3D(localPoint, bC, bRot), penetration: radius + depth };
    }

    private segBoxProximity(l1: IVec3Like, l2: IVec3Like, half: IVec3Like): { q: IVec3Like; distSq: number } {
        const l = [l1.x, l1.y, l1.z];
        const e = [l2.x - l1.x, l2.y - l1.y, l2.z - l1.z];
        const h = [half.x, half.y, half.z];
        const ts: number[] = [0, 1];
        for (let k = 0; k < 3; k++) {
            if (Math.abs(e[k]) <= 1e-12) continue;
            const tp = (h[k] - l[k]) / e[k];
            const tn = (-h[k] - l[k]) / e[k];
            if (tp > 0 && tp < 1) ts.push(tp);
            if (tn > 0 && tn < 1) ts.push(tn);
        }
        ts.sort((a, b) => a - b);
        const evals: number[] = ts.slice();
        for (let k = 0; k + 1 < ts.length; k++) {
            const lo = ts[k], hi = ts[k + 1];
            if (hi - lo <= 1e-12) continue;
            const tm = (lo + hi) * 0.5;
            let den = 0, num = 0;
            for (let a = 0; a < 3; a++) {
                const qm = l[a] + e[a] * tm;
                if (Math.abs(qm) > h[a]) {
                    const s = qm > 0 ? h[a] : -h[a];
                    den += e[a] * e[a];
                    num += e[a] * (s - l[a]);
                }
            }
            evals.push(den > 1e-30 ? Math.min(hi, Math.max(lo, num / den)) : lo);
        }
        let bestQ = { x: l[0], y: l[1], z: l[2] };
        let bestDistSq = Infinity;
        let insideQ: IVec3Like | null = null;
        let insideMargin = -Infinity;
        for (const t of evals) {
            const q = { x: l[0] + e[0] * t, y: l[1] + e[1] * t, z: l[2] + e[2] * t };
            const gx = Math.max(Math.abs(q.x) - h[0], 0);
            const gy = Math.max(Math.abs(q.y) - h[1], 0);
            const gz = Math.max(Math.abs(q.z) - h[2], 0);
            const distSq = gx * gx + gy * gy + gz * gz;
            if (distSq < bestDistSq) { bestDistSq = distSq; bestQ = q; }
            if (distSq === 0) {
                const margin = Math.min(h[0] - Math.abs(q.x), h[1] - Math.abs(q.y), h[2] - Math.abs(q.z));
                if (margin > insideMargin) { insideMargin = margin; insideQ = q; }
            }
        }
        if (bestDistSq <= PhysicsConstants.EPSILON * PhysicsConstants.EPSILON && insideQ) return { q: insideQ, distSq: 0 };
        return { q: bestQ, distSq: bestDistSq };
    }

    private aabbApprox(dA: IShapeDescriptor3D, dB: IShapeDescriptor3D, aabbA: IAabb3D, aabbB: IAabb3D): ICollisionResult | null {
        const oX = Math.min(aabbA.max.x, aabbB.max.x) - Math.max(aabbA.min.x, aabbB.min.x);
        const oY = Math.min(aabbA.max.y, aabbB.max.y) - Math.max(aabbA.min.y, aabbB.min.y);
        const oZ = Math.min(aabbA.max.z, aabbB.max.z) - Math.max(aabbA.min.z, aabbB.min.z);
        if (oX < 0 || oY < 0 || oZ < 0) return null;
        const cA = this._host.getShapeWorldCenter(dA), cB = this._host.getShapeWorldCenter(dB);
        let pen = oX; if (oY < pen) pen = oY; if (oZ < pen) pen = oZ;
        let normal: IVec3Like;
        if (pen === oX) normal = { x: cB.x >= cA.x ? 1 : -1, y: 0, z: 0 };
        else if (pen === oY) normal = { x: 0, y: cB.y >= cA.y ? 1 : -1, z: 0 };
        else normal = { x: 0, y: 0, z: cB.z >= cA.z ? 1 : -1 };
        return { normal, penetration: pen, point: { x: (Math.max(aabbA.min.x, aabbB.min.x) + Math.min(aabbA.max.x, aabbB.max.x)) * 0.5, y: (Math.max(aabbA.min.y, aabbB.min.y) + Math.min(aabbA.max.y, aabbB.max.y)) * 0.5, z: (Math.max(aabbA.min.z, aabbB.min.z) + Math.min(aabbA.max.z, aabbB.max.z)) * 0.5 } };
    }

    private segSeg(a1: IVec3Like, a2: IVec3Like, b1: IVec3Like, b2: IVec3Like): { pointA: IVec3Like; pointB: IVec3Like; distSq: number } {
        const d1 = Vec3.subtract(a2, a1), d2 = Vec3.subtract(b2, b1), r = Vec3.subtract(a1, b1);
        const a = Vec3.dot(d1, d1), e = Vec3.dot(d2, d2), f = Vec3.dot(d2, r);
        let s = 0, t = 0;
        if (a <= PhysicsConstants.EPSILON && e <= PhysicsConstants.EPSILON) { s = t = 0; }
        else if (a <= PhysicsConstants.EPSILON) { s = 0; t = clamp(f / e, 0, 1); }
        else { const c = Vec3.dot(d1, r); if (e <= PhysicsConstants.EPSILON) { t = 0; s = clamp(-c / a, 0, 1); } else { const b = Vec3.dot(d1, d2); const denom = a * e - b * b; if (denom !== 0) s = clamp((b * f - c * e) / denom, 0, 1); t = (b * s + f) / e; if (t < 0) { t = 0; s = clamp(-c / a, 0, 1); } else if (t > 1) { t = 1; s = clamp((b - c) / a, 0, 1); } } }
        const pA = { x: a1.x + d1.x * s, y: a1.y + d1.y * s, z: a1.z + d1.z * s };
        const pB = { x: b1.x + d2.x * t, y: b1.y + d2.y * t, z: b1.z + d2.z * t };
        const delta = Vec3.subtract(pB, pA);
        return { pointA: pA, pointB: pB, distSq: Vec3.dot(delta, delta) };
    }

    private closestSeg(point: IVec3Like, a: IVec3Like, b: IVec3Like): IVec3Like {
        const ab = Vec3.subtract(b, a), ap = Vec3.subtract(point, a);
        const ab2 = Vec3.dot(ab, ab);
        const t = ab2 > PhysicsConstants.EPSILON ? clamp(Vec3.dot(ap, ab) / ab2, 0, 1) : 0;
        return { x: a.x + ab.x * t, y: a.y + ab.y * t, z: a.z + ab.z * t };
    }
}
