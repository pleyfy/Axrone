import { Vec3, type IVec3Like } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import { Collider3D, CapsuleDirection3D, INVALID_SHAPE_ID } from './collider3d';

/**
 * WASM-backed cylinder collider component.
 *
 * Mirrors the serialized field names and scriptName of the reference
 * `CylinderCollider3D` in `physics-3d`.
 */
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
        if (!this._rigidbody || !this._world) return;
        const s = this._getWorldScale();
        const bodyId = this._rigidbody.bodyId;
        const mat = this._getCompatMaterial();
        const rScale = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        let hScale: number;
        switch (this._axis) {
            case CapsuleDirection3D.XAxis: hScale = Math.abs(s.x); break;
            case CapsuleDirection3D.ZAxis: hScale = Math.abs(s.z); break;
            default: hScale = Math.abs(s.y); break;
        }
        this._shapeId = this._world.createCylinderShape(bodyId, {
            center: { x: this._center.x * s.x, y: this._center.y * s.y, z: this._center.z * s.z },
            radius: this._radius * rScale,
            height: this._height * hScale,
            isSensor: this.isTrigger,
        }, mat);
    }

    protected override _updateShape(): void {
        if (this._shapeId === INVALID_SHAPE_ID) return;
        this._destroyCurrentShape();
        this._createShape();
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
        _ray: { origin: IVec3Like; direction: IVec3Like },
        _maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        return { hit: false };
    }
}
