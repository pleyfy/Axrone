import { IBuffer, IBufferFactory, createBufferFactory, GLBufferUsage } from '../buffer';
import { IVertexBuffer, IVertexLayout, BufferUsage, MeshError, MeshErrorCode } from './interfaces';

export class WebGLVertexBuffer implements IVertexBuffer {
    public readonly id: string;
    private readonly buffer: IBuffer;
    private readonly bufferFactory: IBufferFactory;
    public readonly usage: BufferUsage;
    public readonly size: number;
    public readonly vertexCount: number;
    public readonly layout: IVertexLayout;

    private _isDisposed = false;

    constructor(
        gl: WebGL2RenderingContext,
        id: string,
        data: ArrayBuffer | ArrayBufferView,
        layout: IVertexLayout,
        usage: BufferUsage = BufferUsage.STATIC_DRAW
    ) {
        this.id = id;
        this.usage = usage;
        this.layout = layout;
        this.vertexCount = data.byteLength / layout.stride;
        this.size = data.byteLength;

        this.bufferFactory = createBufferFactory(gl);
        this.buffer = this.bufferFactory.createArrayBuffer({
            initialData: data as BufferSource,
            usage: this.convertUsage(usage),
            label: `VertexBuffer_${id}`
        });
    }

    private convertUsage(usage: BufferUsage): GLBufferUsage {
        switch (usage) {
            case BufferUsage.STATIC_DRAW: return WebGL2RenderingContext.STATIC_DRAW;
            case BufferUsage.DYNAMIC_DRAW: return WebGL2RenderingContext.DYNAMIC_DRAW;
            case BufferUsage.STREAM_DRAW: return WebGL2RenderingContext.STREAM_DRAW;
            default: return WebGL2RenderingContext.STATIC_DRAW;
        }
    }

    public get nativeHandle(): WebGLBuffer {
        return this.buffer.id as unknown as WebGLBuffer;
    }

    public get isDisposed(): boolean {
        return this._isDisposed || this.buffer.isDisposed;
    }

    public bind(): this {
        if (this.isDisposed) {
            throw new MeshError('Cannot bind disposed vertex buffer', MeshErrorCode.DISPOSED_RESOURCE_ACCESS);
        }
        this.buffer.bind();
        return this;
    }

    public unbind(): this {
        this.buffer.unbind();
        return this;
    }

    public update(data: ArrayBuffer | ArrayBufferView, offset: number = 0): this {
        if (this.isDisposed) {
            throw new MeshError('Cannot update disposed vertex buffer', MeshErrorCode.DISPOSED_RESOURCE_ACCESS);
        }
        this.buffer.update(data as BufferSource, offset);
        return this;
    }

    public resize(newSize: number): this {
        if (this.isDisposed) {
            throw new MeshError('Cannot resize disposed vertex buffer', MeshErrorCode.DISPOSED_RESOURCE_ACCESS);
        }
        this.buffer.resize(newSize, this.convertUsage(this.usage));
        return this;
    }

    public dispose(): void {
        if (!this._isDisposed) {
            this.buffer.dispose();
            this._isDisposed = true;
        }
    }
}
