import { Vec3, type IVec3Like } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import type { IBoxShapeDef3D } from '../types';
import { Collider3D, INVALID_SHAPE_ID } from './collider3d';

@script({ scriptName: 'BoxCollider3D' })
export class BoxCollider3D extends Collider3D {
    private readonly _size: Vec3 = new Vec3(1, 1, 1);
    get size(): Readonly<Vec3> {
        return this._size;
    }
    set size(value: IVec3Like) {
        this._size.x = Math.max(0.001, value.x);
        this._size.y = Math.max(0.001, value.y);
        this._size.z = Math.max(0.001, value.z);
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._shapeManager || !this._rigidbody) return;
        const def: IBoxShapeDef3D = {
            center: this._center,
            halfExtents: { x: this._size.x * 0.5, y: this._size.y * 0.5, z: this._size.z * 0.5 },
        };
        this._shapeId = this._shapeManager.createBox(
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
        const hx = this._size.x * 0.5 * Math.abs(s.x);
        const hy = this._size.y * 0.5 * Math.abs(s.y);
        const hz = this._size.z * 0.5 * Math.abs(s.z);
        this._setBounds(wc.x - hx, wc.y - hy, wc.z - hz, wc.x + hx, wc.y + hy, wc.z + hz);
    }

    protected override _closestPointOnCollider(position: IVec3Like): IVec3Like {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const hx = this._size.x * 0.5 * Math.abs(s.x);
        const hy = this._size.y * 0.5 * Math.abs(s.y);
        const hz = this._size.z * 0.5 * Math.abs(s.z);
        const lx = position.x - wc.x;
        const ly = position.y - wc.y;
        const lz = position.z - wc.z;
        return {
            x: wc.x + Math.max(-hx, Math.min(hx, lx)),
            y: wc.y + Math.max(-hy, Math.min(hy, ly)),
            z: wc.z + Math.max(-hz, Math.min(hz, lz)),
        };
    }

    protected override _raycastCollider(
        ray: { origin: IVec3Like; direction: IVec3Like },
        maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        const wc = this._getWorldCenter();
        const s = this.transform?.worldScale ?? Vec3.ONE;
        const hx = this._size.x * 0.5 * Math.abs(s.x);
        const hy = this._size.y * 0.5 * Math.abs(s.y);
        const hz = this._size.z * 0.5 * Math.abs(s.z);
        const mnX = wc.x - hx;
        const mxX = wc.x + hx;
        const mnY = wc.y - hy;
        const mxY = wc.y + hy;
        const mnZ = wc.z - hz;
        const mxZ = wc.z + hz;
        let tmin = 0;
        let tmax = maxDistance;
        const normal = { x: 0, y: 0, z: 0 };
        const axes = [
            { min: mnX, max: mxX, o: ray.origin.x, d: ray.direction.x, n: { x: -1, y: 0, z: 0 } },
            { min: mnY, max: mxY, o: ray.origin.y, d: ray.direction.y, n: { x: 0, y: -1, z: 0 } },
            { min: mnZ, max: mxZ, o: ray.origin.z, d: ray.direction.z, n: { x: 0, y: 0, z: -1 } },
        ];
        for (const axis of axes) {
            if (Math.abs(axis.d) < 1e-10) {
                if (axis.o < axis.min || axis.o > axis.max) return { hit: false };
            } else {
                const invD = 1 / axis.d;
                let t1 = (axis.min - axis.o) * invD;
                let t2 = (axis.max - axis.o) * invD;
                let tn = axis.n;
                if (t1 > t2) {
                    const tmp = t1;
                    t1 = t2;
                    t2 = tmp;
                    tn = { x: -axis.n.x, y: -axis.n.y, z: -axis.n.z };
                }
                if (t1 > tmin) {
                    tmin = t1;
                    normal.x = tn.x;
                    normal.y = tn.y;
                    normal.z = tn.z;
                }
                tmax = Math.min(tmax, t2);
                if (tmin > tmax) return { hit: false };
            }
        }
        if (tmin < 0) return { hit: false };
        return {
            hit: true,
            point: {
                x: ray.origin.x + ray.direction.x * tmin,
                y: ray.origin.y + ray.direction.y * tmin,
                z: ray.origin.z + ray.direction.z * tmin,
            },
            normal,
            distance: tmin,
        };
    }
}
