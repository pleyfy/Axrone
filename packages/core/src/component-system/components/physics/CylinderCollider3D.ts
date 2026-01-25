import { Vec3, type IVec3Like } from '@axrone/numeric';
import type { ICylinderShapeDef3D } from 'packages/core/src/physics';
import { script } from '../../decorators';
import { Collider3D, CapsuleDirection3D, INVALID_SHAPE_ID } from './collider3d';

@script({ scriptName: 'CylinderCollider3D' })
export class CylinderCollider3D extends Collider3D {
    private _radius: number = 0.5;
    private _height: number = 2;
    private _axis: CapsuleDirection3D = CapsuleDirection3D.YAxis;
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
        this._height = Math.max(0.001, value);
        this._updateShape();
    }
    get axis(): CapsuleDirection3D {
        return this._axis;
    }
    set axis(value: CapsuleDirection3D) {
        this._axis = value;
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._shapeManager || !this._rigidbody) return;
        const def: ICylinderShapeDef3D = {
            center: this._center,
            radius: this._radius,
            height: this._height,
            axis: this._axis,
        };
        this._shapeId = this._shapeManager.createCylinder(
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
        switch (this._axis) {
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
        return position;
    }
    protected override _raycastCollider(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        return { hit: false };
    }
}
