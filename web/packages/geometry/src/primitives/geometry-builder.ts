import { Vec3, IVec3Like, EPSILON } from '@axrone/numeric';
import { ByteBuffer } from '@axrone/utility';
import {
    IGeometryBuffers,
    IGeometryLayout,
    IVertexAttribute,
    IVertex,
    IPrimitiveConfig,
    DEFAULT_PRIMITIVE_CONFIG,
    GLAttributeType,
    VERTEX_ATTRIBUTES,
    createVertexAttribute,
    createGeometryLayout,
} from './types';

export class GeometryBuilder<TConfig extends IPrimitiveConfig = IPrimitiveConfig> {
    private readonly _vertices: IVertex[] = [];
    private readonly _indices: number[] = [];
    private readonly _config: Required<TConfig>;
    private readonly _tempVec3A: Vec3 = Vec3.ZERO.clone();
    private readonly _tempVec3B: Vec3 = Vec3.ZERO.clone();
    private readonly _tempVec3C: Vec3 = Vec3.ZERO.clone();

    constructor(config: Partial<TConfig> = {} as Partial<TConfig>) {
        this._config = { ...DEFAULT_PRIMITIVE_CONFIG, ...config } as Required<TConfig>;
    }

    static create<T extends IPrimitiveConfig>(config?: Partial<T>): GeometryBuilder<T> {
        return new GeometryBuilder(config);
    }

    addVertex<T extends IVec3Like>(
        position: Readonly<T>,
        normal?: Readonly<IVec3Like>,
        texCoord?: Readonly<{ u: number; v: number }>
    ): number {
        const vertex: IVertex = {
            position: Vec3.from(position),
        };

        if (this._config.generateNormals && normal) {
            vertex.normal = Vec3.from(normal);
        }

        if (this._config.generateTexCoords && texCoord) {
            vertex.texCoord = { u: texCoord.u, v: texCoord.v };
        }

        this._vertices.push(vertex);
        return this._vertices.length - 1;
    }

    addTriangle(a: number, b: number, c: number): void {
        if (this._config.flipWindingOrder) {
            this._indices.push(a, c, b);
        } else {
            this._indices.push(a, b, c);
        }
    }

    addQuad(a: number, b: number, c: number, d: number): void {
        this.addTriangle(a, b, c);
        this.addTriangle(a, c, d);
    }

    computeNormals(): this {
        if (!this._config.generateNormals) return this;

        for (const vertex of this._vertices) {
            vertex.normal = Vec3.ZERO.clone();
        }

        for (let i = 0; i < this._indices.length; i += 3) {
            const ia = this._indices[i];
            const ib = this._indices[i + 1];
            const ic = this._indices[i + 2];

            const va = this._vertices[ia];
            const vb = this._vertices[ib];
            const vc = this._vertices[ic];

            Vec3.subtract(vc.position, vb.position, this._tempVec3A);
            Vec3.subtract(va.position, vb.position, this._tempVec3B);
            Vec3.cross(this._tempVec3A, this._tempVec3B, this._tempVec3C);

            Vec3.add(va.normal!, this._tempVec3C, va.normal!);
            Vec3.add(vb.normal!, this._tempVec3C, vb.normal!);
            Vec3.add(vc.normal!, this._tempVec3C, vc.normal!);
        }

        for (const vertex of this._vertices) {
            if (vertex.normal && Vec3.lengthSquared(vertex.normal) > EPSILON) {
                Vec3.normalize(vertex.normal, vertex.normal);
            }
        }

        return this;
    }

    computeTangents(): this {
        if (!this._config.generateTangents || !this._config.generateTexCoords) return this;

        const vertexCount = this._vertices.length;
        const tan1 = new Array<Vec3>(vertexCount);
        const tan2 = new Array<Vec3>(vertexCount);

        for (let i = 0; i < vertexCount; i++) {
            tan1[i] = Vec3.ZERO.clone();
            tan2[i] = Vec3.ZERO.clone();
            this._vertices[i].tangent = Vec3.ZERO.clone();
        }

        for (let i = 0; i < this._indices.length; i += 3) {
            const i1 = this._indices[i];
            const i2 = this._indices[i + 1];
            const i3 = this._indices[i + 2];

            const v1 = this._vertices[i1];
            const v2 = this._vertices[i2];
            const v3 = this._vertices[i3];

            if (!v1.texCoord || !v2.texCoord || !v3.texCoord) continue;

            const x1 = v2.position.x - v1.position.x;
            const x2 = v3.position.x - v1.position.x;
            const y1 = v2.position.y - v1.position.y;
            const y2 = v3.position.y - v1.position.y;
            const z1 = v2.position.z - v1.position.z;
            const z2 = v3.position.z - v1.position.z;

            const s1 = v2.texCoord.u - v1.texCoord.u;
            const s2 = v3.texCoord.u - v1.texCoord.u;
            const t1 = v2.texCoord.v - v1.texCoord.v;
            const t2 = v3.texCoord.v - v1.texCoord.v;

            const det = s1 * t2 - s2 * t1;
            if (Math.abs(det) < EPSILON) continue;

            const r = 1.0 / det;
            this._tempVec3A.x = (t2 * x1 - t1 * x2) * r;
            this._tempVec3A.y = (t2 * y1 - t1 * y2) * r;
            this._tempVec3A.z = (t2 * z1 - t1 * z2) * r;

            this._tempVec3B.x = (s1 * x2 - s2 * x1) * r;
            this._tempVec3B.y = (s1 * y2 - s2 * y1) * r;
            this._tempVec3B.z = (s1 * z2 - s2 * z1) * r;

            Vec3.add(tan1[i1], this._tempVec3A, tan1[i1]);
            Vec3.add(tan1[i2], this._tempVec3A, tan1[i2]);
            Vec3.add(tan1[i3], this._tempVec3A, tan1[i3]);

            Vec3.add(tan2[i1], this._tempVec3B, tan2[i1]);
            Vec3.add(tan2[i2], this._tempVec3B, tan2[i2]);
            Vec3.add(tan2[i3], this._tempVec3B, tan2[i3]);
        }

        for (let i = 0; i < vertexCount; i++) {
            const vertex = this._vertices[i];
            if (!vertex.normal) continue;

            const n = vertex.normal;
            const t = tan1[i];

            Vec3.multiplyScalar(n, Vec3.dot(n, t), this._tempVec3A);
            Vec3.subtract(t, this._tempVec3A, this._tempVec3B);

            if (Vec3.lengthSquared(this._tempVec3B) > EPSILON) {
                vertex.tangent = Vec3.normalize(this._tempVec3B);
            }
        }

        return this;
    }

    build(): IGeometryBuffers {
        if (this._config.generateNormals) {
            this.computeNormals();
        }

        if (this._config.generateTangents) {
            this.computeTangents();
        }

        return this._createBuffers();
    }

    clear(): this {
        this._vertices.length = 0;
        this._indices.length = 0;
        return this;
    }

    get vertexCount(): number {
        return this._vertices.length;
    }

    get indexCount(): number {
        return this._indices.length;
    }

    get config(): Readonly<Required<TConfig>> {
        return this._config;
    }

    private _createBuffers(): IGeometryBuffers {
        const attributes = this._createVertexAttributes();
        const layout = createGeometryLayout(
            attributes,
            this._vertices.length,
            this._indices.length
        );

        const vertexBuffer = this._createVertexBuffer(layout);
        const indexBuffer = this._createIndexBuffer();

        return {
            vertices: vertexBuffer,
            indices: indexBuffer,
            layout,
        };
    }

    private _createVertexAttributes(): readonly IVertexAttribute[] {
        const attributes: IVertexAttribute[] = [];
        let offset = 0;

        attributes.push(
            createVertexAttribute(
                VERTEX_ATTRIBUTES.POSITION,
                3,
                GLAttributeType.FLOAT,
                false,
                offset
            )
        );
        offset += 12;

        if (this._config.generateNormals) {
            attributes.push(
                createVertexAttribute(
                    VERTEX_ATTRIBUTES.NORMAL,
                    3,
                    GLAttributeType.FLOAT,
                    false,
                    offset
                )
            );
            offset += 12;
        }

        if (this._config.generateTexCoords) {
            attributes.push(
                createVertexAttribute(
                    VERTEX_ATTRIBUTES.TEXCOORD,
                    2,
                    GLAttributeType.FLOAT,
                    false,
                    offset
                )
            );
            offset += 8;
        }

        if (this._config.generateTangents) {
            attributes.push(
                createVertexAttribute(
                    VERTEX_ATTRIBUTES.TANGENT,
                    3,
                    GLAttributeType.FLOAT,
                    false,
                    offset
                )
            );
            offset += 12;
        }

        return Object.freeze(attributes);
    }

    private _createVertexBuffer(layout: IGeometryLayout): ByteBuffer {
        const buffer = ByteBuffer.alloc(this._vertices.length * layout.stride);

        for (const vertex of this._vertices) {
            buffer.putFloat32(vertex.position.x);
            buffer.putFloat32(vertex.position.y);
            buffer.putFloat32(vertex.position.z);

            if (this._config.generateNormals && vertex.normal) {
                buffer.putFloat32(vertex.normal.x);
                buffer.putFloat32(vertex.normal.y);
                buffer.putFloat32(vertex.normal.z);
            }

            if (this._config.generateTexCoords && vertex.texCoord) {
                buffer.putFloat32(vertex.texCoord.u);
                buffer.putFloat32(vertex.texCoord.v);
            }

            if (this._config.generateTangents && vertex.tangent) {
                buffer.putFloat32(vertex.tangent.x);
                buffer.putFloat32(vertex.tangent.y);
                buffer.putFloat32(vertex.tangent.z);
            }
        }

        buffer.flip();
        return buffer;
    }

    private _createIndexBuffer(): ByteBuffer {
        if (!this._config.useIndexBuffer) {
            return ByteBuffer.alloc(0);
        }

        const use32BitIndices =
            this._config.indexType === GLAttributeType.UNSIGNED_INT ||
            this._vertices.length > 65535;
        const bytesPerIndex = use32BitIndices ? 4 : 2;
        const buffer = ByteBuffer.alloc(this._indices.length * bytesPerIndex);

        for (const index of this._indices) {
            if (use32BitIndices) {
                buffer.putUint32(index);
            } else {
                buffer.putUint16(index);
            }
        }

        buffer.flip();
        return buffer;
    }
}
