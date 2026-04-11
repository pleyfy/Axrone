import { type IVec3Like, Vec3 } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import type { ICapsuleShapeDef3D } from '../types';
import { Collider3D, CapsuleDirection3D, INVALID_SHAPE_ID } from './collider3d';

@script({ scriptName: 'CapsuleCollider3D' })
export class CapsuleCollider3D extends Collider3D {
    private _radius: number = 0.5;
    private _height: number = 2;
    private _direction: CapsuleDirection3D = CapsuleDirection3D.YAxis;
    get radius(): number {
        return this._radius;
    }
    set radius(value: number) {
        this._radius = Math.max(0.001, value);
        this._updateShape();
    }
    get height(): number {
        return this._height;
    }
    set height(value: number) {
        this._height = Math.max(this._radius * 2, value);
        this._updateShape();
    }
    get direction(): CapsuleDirection3D {
        return this._direction;
    }
    set direction(value: CapsuleDirection3D) {
        this._direction = value;
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._shapeManager || !this._rigidbody) return;
        const hh = (this._height - this._radius * 2) * 0.5;
        let p1: IVec3Like;
        let p2: IVec3Like;
        switch (this._direction) {
            case CapsuleDirection3D.XAxis:
                p1 = { x: this._center.x - hh, y: this._center.y, z: this._center.z };
                p2 = { x: this._center.x + hh, y: this._center.y, z: this._center.z };
                break;
            case CapsuleDirection3D.YAxis:
                p1 = { x: this._center.x, y: this._center.y - hh, z: this._center.z };
                p2 = { x: this._center.x, y: this._center.y + hh, z: this._center.z };
                break;
            case CapsuleDirection3D.ZAxis:
                p1 = { x: this._center.x, y: this._center.y, z: this._center.z - hh };
                p2 = { x: this._center.x, y: this._center.y, z: this._center.z + hh };
                break;
        }
        const def: ICapsuleShapeDef3D = { p1, p2, radius: this._radius };
        this._shapeId = this._shapeManager.createCapsule(
            this._rigidbody.bodyId,
            def,
            this._getMaterial(),
            this._getFilter()
        );
    }

    protected override _updateShape(): void {
        if (this._shapeId === INVALID_SHAPE_ID) return;
    }

    protected override _calculateBounds(): void {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        let ex: number;
        let ey: number;
        let ez: number;
        switch (this._direction) {
            case CapsuleDirection3D.XAxis:
                ex = this._height * 0.5 * Math.abs(s.x);
                ey = this._radius * Math.abs(s.y);
                ez = this._radius * Math.abs(s.z);
                break;
            case CapsuleDirection3D.YAxis:
                ex = this._radius * Math.abs(s.x);
                ey = this._height * 0.5 * Math.abs(s.y);
                ez = this._radius * Math.abs(s.z);
                break;
            case CapsuleDirection3D.ZAxis:
                ex = this._radius * Math.abs(s.x);
                ey = this._radius * Math.abs(s.y);
                ez = this._height * 0.5 * Math.abs(s.z);
                break;
        }
        this._setBounds(wc.x - ex, wc.y - ey, wc.z - ez, wc.x + ex, wc.y + ey, wc.z + ez);
    }

    protected override _closestPointOnCollider(position: IVec3Like): IVec3Like {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const hh = (this._height - this._radius * 2) * 0.5;
        let aDir: IVec3Like;
        let aScale: number;
        let rScale: number;
        switch (this._direction) {
            case CapsuleDirection3D.XAxis:
                aDir = { x: 1, y: 0, z: 0 };
                aScale = Math.abs(s.x);
                rScale = Math.max(Math.abs(s.y), Math.abs(s.z));
                break;
            case CapsuleDirection3D.YAxis:
                aDir = { x: 0, y: 1, z: 0 };
                aScale = Math.abs(s.y);
                rScale = Math.max(Math.abs(s.x), Math.abs(s.z));
                break;
            case CapsuleDirection3D.ZAxis:
                aDir = { x: 0, y: 0, z: 1 };
                aScale = Math.abs(s.z);
                rScale = Math.max(Math.abs(s.x), Math.abs(s.y));
                break;
        }
        const sHH = hh * aScale;
        const sR = this._radius * rScale;
        const dx = position.x - wc.x;
        const dy = position.y - wc.y;
        const dz = position.z - wc.z;
        const proj = dx * aDir.x + dy * aDir.y + dz * aDir.z;
        const cProj = Math.max(-sHH, Math.min(sHH, proj));
        const cOA = {
            x: wc.x + aDir.x * cProj,
            y: wc.y + aDir.y * cProj,
            z: wc.z + aDir.z * cProj,
        };
        const tP = { x: position.x - cOA.x, y: position.y - cOA.y, z: position.z - cOA.z };
        const dist = Math.sqrt(tP.x * tP.x + tP.y * tP.y + tP.z * tP.z);
        if (dist < sR) return position;
        const invD = dist > 1e-10 ? sR / dist : 0;
        return { x: cOA.x + tP.x * invD, y: cOA.y + tP.y * invD, z: cOA.z + tP.z * invD };
    }

    protected override _raycastCollider(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        return { hit: false };
    }
}
