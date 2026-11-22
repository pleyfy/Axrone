import { Vec3, type IVec3Like } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import { Collider3D, INVALID_SHAPE_ID } from './collider3d';

/**
 * WASM-backed box collider component.
 *
 * Mirrors the serialized field names and scriptName of the reference
 * `BoxCollider3D` in `physics-3d`.
 */
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
        if (!this._rigidbody || !this._world) return;
        const s = this._getWorldScale();
        const bodyId = this._rigidbody.bodyId;
        const mat = this._getCompatMaterial();
        this._shapeId = this._world.createBoxShape(bodyId, {
            center: { x: this._center.x * s.x, y: this._center.y * s.y, z: this._center.z * s.z },
            halfExtents: {
                x: this._size.x * 0.5 * Math.abs(s.x),
                y: this._size.y * 0.5 * Math.abs(s.y),
                z: this._size.z * 0.5 * Math.abs(s.z),
            },
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
        _ray: { origin: IVec3Like; direction: IVec3Like },
        _maxDistance: number
    ): { hit: boolean; point?: IVec3Like; normal?: IVec3Like; distance?: number } {
        // WASM backend does not expose per-shape raycast; return no-hit.
        return { hit: false };
    }
}
