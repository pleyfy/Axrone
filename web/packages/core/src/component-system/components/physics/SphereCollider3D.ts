import { Vec3, type IVec3Like } from '@axrone/numeric';
import type { ISphereShapeDef3D } from 'packages/core/src/physics';
import { script } from '../../decorators';
import { Collider3D, INVALID_SHAPE_ID } from './collider3d';

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
        if (!this._shapeManager || !this._rigidbody) return;
        const def: ISphereShapeDef3D = { center: this._center, radius: this._radius };
        this._shapeId = this._shapeManager.createSphere(
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
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const ms = Math.max(Math.abs(s.x), Math.abs(s.y), Math.abs(s.z));
        const sr = this._radius * ms;
        const ox = ray.origin.x - wc.x;
        const oy = ray.origin.y - wc.y;
        const oz = ray.origin.z - wc.z;
        const a =
            ray.direction.x * ray.direction.x +
            ray.direction.y * ray.direction.y +
            ray.direction.z * ray.direction.z;
        const b = 2 * (ox * ray.direction.x + oy * ray.direction.y + oz * ray.direction.z);
        const c = ox * ox + oy * oy + oz * oz - sr * sr;
        const disc = b * b - 4 * a * c;
        if (disc < 0) return { hit: false };
        const sqD = Math.sqrt(disc);
        let t = (-b - sqD) / (2 * a);
        if (t < 0) t = (-b + sqD) / (2 * a);
        if (t < 0 || t > maxDistance) return { hit: false };
        const pt = {
            x: ray.origin.x + ray.direction.x * t,
            y: ray.origin.y + ray.direction.y * t,
            z: ray.origin.z + ray.direction.z * t,
        };
        const invL = 1 / sr;
        return {
            hit: true,
            point: pt,
            normal: { x: (pt.x - wc.x) * invL, y: (pt.y - wc.y) * invL, z: (pt.z - wc.z) * invL },
            distance: t,
        };
    }
}
