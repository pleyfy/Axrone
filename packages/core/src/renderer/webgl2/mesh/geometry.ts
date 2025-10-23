import { Vec3 } from '@axrone/numeric';
import { IBuffer, IBufferFactory, createBufferFactory } from '../buffer';
import { IGeometry, IVertexBuffer, IIndexBuffer, IVertexArrayObject, PrimitiveTopology, MeshError, MeshErrorCode, IBoundingBox, IBoundingSphere, VertexAttributeType, BufferUsage, IndexType } from './interfaces';
import { IGeometryBuffers, IGeometryLayout } from '../../../geometry/primitives/types';
import { WebGLVertexBuffer } from './vertex-buffer';
import { WebGLIndexBuffer } from './index-buffer';

export class WebGLGeometry implements IGeometry {
    public readonly id: string;
    public readonly vertexBuffer: IVertexBuffer;
    public readonly indexBuffer: IIndexBuffer | null;
    public readonly vertexArrayObject: IVertexArrayObject;
    public readonly primitiveTopology: PrimitiveTopology;
    public readonly vertexCount: number;
    public readonly indexCount: number;
    public readonly boundingBox: IBoundingBox;
    public readonly boundingSphere: IBoundingSphere;
    public readonly vertexBuffers: readonly IVertexBuffer[];

    private _isDisposed = false;

    constructor(
        gl: WebGL2RenderingContext,
        id: string,
        geometryData: IGeometryBuffers,
        topology: PrimitiveTopology = PrimitiveTopology.TRIANGLES
    ) {
        this.id = id;
        this.primitiveTopology = topology;
        this.vertexCount = geometryData.layout.vertexCount;
        this.indexCount = geometryData.layout.indexCount;

        const vertexLayout = this.createVertexLayout(geometryData.layout);
        this.vertexBuffer = new WebGLVertexBuffer(
            gl,
            `${id}_vertices`,
            geometryData.vertices.toUint8Array(),
            vertexLayout
        );

        if (geometryData.layout.indexCount > 0) {
            const indexData = geometryData.indices.toUint8Array();
            this.indexBuffer = new WebGLIndexBuffer(
                gl,
                {
                    data: new Uint16Array(indexData.buffer),
                    usage: BufferUsage.STATIC_DRAW,
                    indexType: IndexType.UNSIGNED_SHORT
                }
            );
        } else {
            this.indexBuffer = null;
        }

        this.vertexBuffers = [this.vertexBuffer];

        this.vertexArrayObject = this.createVAO(gl);

        this.boundingBox = this.computeInitialBounds(geometryData);
        this.boundingSphere = this.computeInitialBoundingSphere(geometryData);
    }

    private computeInitialBounds(geometryData: IGeometryBuffers): IBoundingBox {

        const min = new Vec3(-1, -1, -1);
        const max = new Vec3(1, 1, 1);
        const center = Vec3.lerp(min, max, 0.5);
        const size = Vec3.subtract(max, min);
        const radius = Vec3.distance(center, max);

        return {
            min: new Vec3(min.x, min.y, min.z),
            max: new Vec3(max.x, max.y, max.z),
            center: new Vec3(center.x, center.y, center.z),
            size: new Vec3(size.x, size.y, size.z),
            radius
        };
    }

    private computeInitialBoundingSphere(geometryData: IGeometryBuffers): IBoundingSphere {
        const center = new Vec3(0, 0, 0);
        const radius = 1.0; 

        return {
            center: new Vec3(center.x, center.y, center.z),
            radius
        };
    }

    private createVertexLayout(layout: IGeometryLayout): any {

        return {
            attributes: layout.attributes.map(attr => ({
                type: attr.name as any,
                dataType: attr.type as any,
                componentCount: attr.size,
                normalized: attr.normalized,
                offset: attr.offset,
                stride: layout.stride,
                divisor: 0
            })),
            stride: layout.stride,
            vertexCount: layout.vertexCount
        };
    }

    private createVAO(gl: WebGL2RenderingContext): IVertexArrayObject {

        const vao = gl.createVertexArray();
        if (!vao) {
            throw new MeshError('Failed to create VAO', MeshErrorCode.VAO_CREATION_FAILED);
        }

        const vaoId = `vao_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        return {
            id: vaoId,
            nativeHandle: vao,
            vertexBuffers: this.vertexBuffers,
            indexBuffer: this.indexBuffer,
            isDisposed: false,
            bind: () => {
                gl.bindVertexArray(vao);
                return this;
            },
            unbind: () => {
                gl.bindVertexArray(null);
                return this;
            },
            addVertexBuffer: (buffer: IVertexBuffer) => {

                console.warn('addVertexBuffer not fully implemented');
            },
            setIndexBuffer: (buffer: IIndexBuffer) => {

                console.warn('setIndexBuffer not fully implemented');
            },
            removeVertexBuffer: (buffer: IVertexBuffer): boolean => {
                console.warn('removeVertexBuffer not fully implemented');
                return false;
            },
            clearVertexBuffers: () => {
                console.warn('clearVertexBuffers not fully implemented');
            },
            dispose: () => {
                gl.deleteVertexArray(vao);
            }
        } as IVertexArrayObject;
    }

    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    public hasAttribute(type: VertexAttributeType): boolean {

        return this.vertexBuffer.layout.attributes.some(attr => attr.type === type);
    }

    public getAttribute(type: VertexAttributeType): IVertexBuffer | null {

        return this.hasAttribute(type) ? this.vertexBuffer : null;
    }

    public getAttributeData(type: VertexAttributeType): Float32Array | null {

        console.warn('getAttributeData not implemented');
        return null;
    }

    public computeBounds(): void {

        console.warn('computeBounds not fully implemented');
    }

    public generateNormals(): void {
        console.warn('generateNormals not implemented');
    }

    public generateTangents(): void {
        console.warn('generateTangents not implemented');
    }

    public bind(): this {
        if (this.isDisposed) {
            throw new MeshError('Cannot bind disposed geometry', MeshErrorCode.DISPOSED_RESOURCE_ACCESS);
        }
        this.vertexArrayObject.bind();
        return this;
    }

    public unbind(): this {
        this.vertexArrayObject.unbind();
        return this;
    }

    public dispose(): void {
        if (!this._isDisposed) {
            this.vertexBuffer.dispose();
            this.indexBuffer?.dispose();
            this.vertexArrayObject.dispose();
            this._isDisposed = true;
        }
    }
}
