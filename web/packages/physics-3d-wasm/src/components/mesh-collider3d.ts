import { Vec3, type IVec3Like } from '@axrone/numeric';
import { script } from '@axrone/ecs-runtime/decorators';
import { Collider3D, INVALID_SHAPE_ID } from './collider3d';

/**
 * WASM-backed mesh collider component.
 *
 * Mirrors the serialized field names and scriptName of the reference
 * `MeshCollider3D` in `physics-3d`.
 *
 * When `convex` is true, a convex hull shape is created via the compat
 * adapter's `createHullShape`. When `convex` is false, a triangle mesh
 * shape is created via `createTriangleMeshShape`.
 */
@script({ scriptName: 'MeshCollider3D' })
export class MeshCollider3D extends Collider3D {
    private _convex: boolean = true;
    private _vertices: Float32Array = new Float32Array(0);
    private _indices: Uint32Array = new Uint32Array(0);

    get convex(): boolean {
        return this._convex;
    }

    set convex(value: boolean) {
        this._convex = value;
        this._updateShape();
    }

    get vertices(): Readonly<Float32Array> {
        return this._vertices;
    }

    get indices(): Readonly<Uint32Array> {
        return this._indices;
    }

    setMesh(vertices: Float32Array, indices: Uint32Array): void {
        this._vertices = vertices;
        this._indices = indices;
        this._updateShape();
    }

    protected override _createShape(): void {
        if (!this._rigidbody || !this._world || this._vertices.length === 0) return;
        const s = this._getWorldScale();
        const bodyId = this._rigidbody.bodyId;
        const mat = this._getCompatMaterial();

        // Build scaled vertex array for compat adapter
        const scaledVertices: IVec3Like[] = [];
        for (let i = 0; i < this._vertices.length; i += 3) {
            scaledVertices.push({
                x: this._vertices[i] * s.x,
                y: this._vertices[i + 1] * s.y,
                z: this._vertices[i + 2] * s.z,
            });
        }

        if (this._convex) {
            this._shapeId = this._world.createHullShape(bodyId, {
                center: { x: this._center.x * s.x, y: this._center.y * s.y, z: this._center.z * s.z },
                vertices: scaledVertices,
                isSensor: this.isTrigger,
            }, mat);
        } else {
            const indices = Array.from(this._indices, (v) => v as number);
            this._shapeId = this._world.createTriangleMeshShape(bodyId, {
                center: { x: this._center.x * s.x, y: this._center.y * s.y, z: this._center.z * s.z },
                vertices: scaledVertices,
                indices,
                isSensor: this.isTrigger,
            }, mat);
        }
    }

    protected override _updateShape(): void {
        if (this._shapeId === INVALID_SHAPE_ID) return;
        this._destroyCurrentShape();
        this._createShape();
    }

    protected override _calculateBounds(): void {
        if (this._vertices.length === 0) return;
        let mnX = Infinity, mnY = Infinity, mnZ = Infinity;
        let mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
        for (let i = 0; i < this._vertices.length; i += 3) {
            const x = this._vertices[i];
            const y = this._vertices[i + 1];
            const z = this._vertices[i + 2];
            if (x < mnX) mnX = x;
            if (y < mnY) mnY = y;
            if (z < mnZ) mnZ = z;
            if (x > mxX) mxX = x;
            if (y > mxY) mxY = y;
            if (z > mxZ) mxZ = z;
        }
        const wp = this.transform?.worldPosition ?? Vec3.ZERO;
        this._setBounds(wp.x + mnX, wp.y + mnY, wp.z + mnZ, wp.x + mxX, wp.y + mxY, wp.z + mxZ);
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
