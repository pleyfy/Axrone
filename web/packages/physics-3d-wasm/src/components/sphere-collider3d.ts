import { Vec3, type IVec3Like } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import { Collider3D, INVALID_SHAPE_ID } from './collider3d';

/**
 * WASM-backed sphere collider component.
 *
 * Mirrors the serialized field names and scriptName of the reference
 * `SphereCollider3D` in `physics-3d`.
 */
@script({ scriptName: 'SphereCollider3D' })
export class SphereCollider3D extends Collider3D {
    private _radius: number = 0.5;

    get radius(): number {
        return this._radius;
    }

    set radius(value: number) {
        this._radius = Math.max(0.001, value);
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._rigidbody || !this._world) return;
        const s = this._getWorldScale();
        const bodyId = this._rigidbody.bodyId;
        const mat = this._getCompatMaterial();
        this._shapeId = this._world.createSphereShape(bodyId, {
            center: { x: this._center.x * s.x, y: this._center.y * s.y, z: this._center.z * s.z },
            radius: this._radius * Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)),
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
        const ms = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        const sr = this._radius * ms;
        this._setBounds(wc.x - sr, wc.y - sr, wc.z - sr, wc.x + sr, wc.y + sr, wc.z + sr);
    }

    protected override _closestPointOnCollider(position: IVec3Like): IVec3Like {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const ms = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        const sr = this._radius * ms;
        const dx = position.x - wc.x;
        const dy = position.y - wc.y;
        const dz = position.z - wc.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (dist < sr) return position;
        const invDist = dist > 1e-10 ? sr / dist : 0;
        return { x: wc.x + dx * invDist, y: wc.y + dy * invDist, z: wc.z + dz * invDist };
    }

    protected override _raycastCollider(
        _ray: { origin: IVec3Like; direction: IVec3Like },
        _maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        return { hit: false };
    }
}
