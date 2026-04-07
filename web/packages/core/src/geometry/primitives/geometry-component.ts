// for example
// TODO: develop prod primitive geometric componets
import { Component } from '../../component-system/core/component';
import { script } from '../../component-system/decorators/script';
import { IGeometryBuffers } from './types';
import {
    createSphere,
    createBox,
    createCapsule,
    createCylinder,
    createPlane,
    createTorus,
} from './index';
import { createBufferFactory, IBufferFactory, IBuffer } from '../../renderer/webgl2/buffer';
import { IDisposable } from '../../types';

@script({
    scriptName: 'GeometryComponent',
    priority: 500,
    description: 'Component for primitive geometry rendering',
    version: '1.0.0',
    author: 'Geometry System Team',
    tags: ['geometry', 'rendering', 'primitive'],
    singleton: false,
    executeInEditMode: true,
    enableMetrics: true,
    enableCaching: true,
})
export class GeometryComponent extends Component {
    private _geometryType: 'sphere' | 'box' | 'capsule' | 'cylinder' | 'plane' | 'torus' = 'sphere';
    private _geometryConfig: any = {};
    private _geometryBuffers?: IGeometryBuffers;
    private _geometryDirty = true;

    private _bufferFactory?: IBufferFactory & IDisposable;
    private _vertexBuffer?: IBuffer;
    private _indexBuffer?: IBuffer;
    private _vertexArray?: WebGLVertexArrayObject;

    get geometryType(): string {
        return this._geometryType;
    }

    set geometryType(value: 'sphere' | 'box' | 'capsule' | 'cylinder' | 'plane' | 'torus') {
        if (this._geometryType !== value) {
            this._geometryType = value;
            this.markGeometryDirty();
        }
    }

    get geometryConfig(): any {
        return this._geometryConfig;
    }

    set geometryConfig(value: any) {
        this._geometryConfig = { ...value };
        this.markGeometryDirty();
    }

    get geometryBuffers(): IGeometryBuffers {
        if (this._geometryDirty || !this._geometryBuffers) {
            this.updateGeometry();
        }
        return this._geometryBuffers!;
    }

    getVertexArray(gl: WebGL2RenderingContext): WebGLVertexArrayObject {
        if (!this._vertexArray) {
            this.createWebGLBuffers(gl);
        }
        return this._vertexArray!;
    }

    private markGeometryDirty(): void {
        this._geometryDirty = true;

        if (this._vertexBuffer || this._indexBuffer || this._vertexArray) {
            this.scheduleWebGLCleanup();
        }
    }

    private updateGeometry(): void {
        switch (this._geometryType) {
            case 'sphere':
                this._geometryBuffers = createSphere(this._geometryConfig);
                break;
            case 'box':
                this._geometryBuffers = createBox(this._geometryConfig);
                break;
            case 'capsule':
                this._geometryBuffers = createCapsule(this._geometryConfig);
                break;
            case 'cylinder':
                this._geometryBuffers = createCylinder(this._geometryConfig);
                break;
            case 'plane':
                this._geometryBuffers = createPlane(this._geometryConfig);
                break;
            case 'torus':
                this._geometryBuffers = createTorus(this._geometryConfig);
                break;
            default:
                this._geometryBuffers = createSphere();
        }

        this._geometryDirty = false;
    }

    private createWebGLBuffers(gl: WebGL2RenderingContext): void {
        const geometry = this.geometryBuffers;

        if (!this._bufferFactory) {
            this._bufferFactory = createBufferFactory(gl);
        }

        const vertexArray = geometry.vertices.getInt8Array(geometry.vertices.remaining);

        this._vertexBuffer = this._bufferFactory.createArrayBufferFromData(
            vertexArray.buffer as ArrayBuffer
        );

        const indexArray = geometry.indices.getInt8Array(geometry.indices.remaining);

        this._indexBuffer = this._bufferFactory.createElementArrayBufferFromData(
            indexArray.buffer as ArrayBuffer
        );

        this._vertexArray = gl.createVertexArray()!;
        gl.bindVertexArray(this._vertexArray);

        this._vertexBuffer.bind();
        this._indexBuffer.bind();

        for (const attribute of geometry.layout.attributes) {
            const location = this.getAttributeLocation(attribute.name);
            if (location >= 0) {
                gl.enableVertexAttribArray(location);
                gl.vertexAttribPointer(
                    location,
                    attribute.size,
                    attribute.type,
                    attribute.normalized,
                    geometry.layout.stride,
                    attribute.offset
                );
            }
        }

        gl.bindVertexArray(null);

        this._vertexBuffer.unbind();
        this._indexBuffer.unbind();
    }

    private getAttributeLocation(name: string): number {
        switch (name) {
            case 'position':
                return 0;
            case 'normal':
                return 1;
            case 'texCoord':
                return 2;
            case 'tangent':
                return 3;
            default:
                return -1;
        }
    }

    private scheduleWebGLCleanup(): void {
        if (this._vertexBuffer && !this._vertexBuffer.isDisposed) {
            this._vertexBuffer.dispose();
        }
        if (this._indexBuffer && !this._indexBuffer.isDisposed) {
            this._indexBuffer.dispose();
        }

        this._vertexBuffer = undefined;
        this._indexBuffer = undefined;
        this._vertexArray = undefined;
    }

    onDestroy(): void {
        this.scheduleWebGLCleanup();

        if (this._bufferFactory && !this._bufferFactory.isDisposed) {
            this._bufferFactory.dispose();
        }
        this._bufferFactory = undefined;

        this._geometryBuffers = undefined;
    }

    serialize(): Record<string, any> {
        return {
            ...super.serialize(),
            geometryType: this._geometryType,
            geometryConfig: this._geometryConfig,
        };
    }

    deserialize(data: Record<string, any>): void {
        super.deserialize(data);

        if (data.geometryType) {
            this._geometryType = data.geometryType;
        }

        if (data.geometryConfig) {
            this._geometryConfig = data.geometryConfig;
        }

        this.markGeometryDirty();
    }
}
