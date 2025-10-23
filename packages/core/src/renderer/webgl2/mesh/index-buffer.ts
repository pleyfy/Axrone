import { IBuffer, IBufferFactory, createBufferFactory, GLBufferUsage } from '../buffer';
import { IIndexBuffer, IIndexBufferConfig, IndexBufferError, IndexType, BufferUsage } from './interfaces';
import { ByteBuffer } from '@axrone/utility';

export class WebGLIndexBuffer implements IIndexBuffer {
    private readonly gl: WebGL2RenderingContext;
    private readonly bufferFactory: IBufferFactory;
    private buffer: IBuffer | null = null;
    private _count: number = 0;
    private _indexType: IndexType = IndexType.UNSIGNED_SHORT;
    private _usage: BufferUsage;
    private _id: string;

    constructor(gl: WebGL2RenderingContext, config: IIndexBufferConfig) {
        this.gl = gl;
        this.bufferFactory = createBufferFactory(gl);
        this._usage = config.usage || BufferUsage.STATIC_DRAW;
        this._indexType = config.indexType || IndexType.UNSIGNED_SHORT;
        this._id = `index_buffer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        if (config.data) {
            this.setData(config.data);
        }
    }

    get id(): string {
        return this._id;
    }

    get nativeHandle(): WebGLBuffer {
        if (!this.buffer) {
            throw new Error('IndexBuffer: Buffer not initialized');
        }
        return this.buffer.id as WebGLBuffer;
    }

    get count(): number {
        return this._count;
    }

    get indexCount(): number {
        return this._count;
    }

    get indexType(): IndexType {
        return this._indexType;
    }

    get usage(): BufferUsage {
        return this._usage;
    }

    get size(): number {
        return this.buffer?.byteLength || 0;
    }

    get byteLength(): number {
        return this.buffer?.byteLength || 0;
    }

    get isValid(): boolean {
        return this.buffer !== null && this._count > 0;
    }

    get isDisposed(): boolean {
        return this.buffer === null;
    }

    setData(data: ArrayBufferView | ArrayBuffer | ByteBuffer): IndexBufferError {
        try {

            if (this.buffer) {
                this.buffer.dispose();
                this.buffer = null;
            }

            let bufferData: BufferSource;

            if (data instanceof ByteBuffer) {
                const uint8Data = data.toUint8Array();
                bufferData = uint8Data as unknown as BufferSource;
                this._indexType = IndexType.UNSIGNED_SHORT; 
                this._count = uint8Data.byteLength / 2; 
            } else if (data instanceof Uint16Array) {
                this._indexType = IndexType.UNSIGNED_SHORT;
                this._count = data.length;
                bufferData = data as BufferSource;
            } else if (data instanceof Uint32Array) {
                this._indexType = IndexType.UNSIGNED_INT;
                this._count = data.length;
                bufferData = data as BufferSource;
            } else if (data instanceof ArrayBuffer) {

                this._indexType = IndexType.UNSIGNED_SHORT;
                this._count = data.byteLength / 2;
                bufferData = data as BufferSource;
            } else {
                return IndexBufferError.INVALID_DATA_FORMAT;
            }

            const glUsage = this.convertToGLUsage(this._usage);
            this.buffer = this.bufferFactory.createElementArrayBufferFromData(
                bufferData,
                glUsage as GLBufferUsage
            );

            return IndexBufferError.NONE;
        } catch (error) {
            console.error('IndexBuffer: Failed to set data:', error);
            return IndexBufferError.BUFFER_CREATION_FAILED;
        }
    }

    private convertToGLUsage(usage: BufferUsage): number {
        switch (usage) {
            case BufferUsage.STATIC_DRAW: return this.gl.STATIC_DRAW;
            case BufferUsage.DYNAMIC_DRAW: return this.gl.DYNAMIC_DRAW;
            case BufferUsage.STREAM_DRAW: return this.gl.STREAM_DRAW;
            default: return this.gl.STATIC_DRAW;
        }
    }

    update(data: ArrayBuffer | ArrayBufferView, offset: number = 0): this {
        if (data instanceof ArrayBuffer) {

            const view = new Uint8Array(data);
            this.updateRange(view, offset);
        } else {
            this.updateRange(data, offset);
        }
        return this;
    }

    resize(newSize: number): this {

        console.warn('IndexBuffer.resize not fully implemented');
        return this;
    }

    updateRange(data: ArrayBufferView, offset: number = 0): IndexBufferError {
        if (!this.buffer) {
            return IndexBufferError.BUFFER_NOT_INITIALIZED;
        }

        try {
            this.buffer.updateRange(data as BufferSource, offset, 0);
            return IndexBufferError.NONE;
        } catch (error) {
            console.error('IndexBuffer: Failed to update range:', error);
            return IndexBufferError.UPDATE_FAILED;
        }
    }

    bind(): void {
        if (this.buffer) {
            this.buffer.bind();
        }
    }

    unbind(): void {
        if (this.buffer) {
            this.buffer.unbind();
        }
    }

    getGLIndexType(): number {
        switch (this._indexType) {
            case IndexType.UNSIGNED_SHORT:
                return this.gl.UNSIGNED_SHORT;
            case IndexType.UNSIGNED_INT:
                return this.gl.UNSIGNED_INT;
            case IndexType.UNSIGNED_BYTE:
                return this.gl.UNSIGNED_BYTE;
            default:
                return this.gl.UNSIGNED_SHORT;
        }
    }

    drawElements(mode: number, count?: number, offset: number = 0): void {
        if (!this.buffer) {
            console.warn('IndexBuffer: Cannot draw - buffer not initialized');
            return;
        }

        this.bind();
        const drawCount = count || this._count;
        const indexType = this.getGLIndexType();
        this.gl.drawElements(mode, drawCount, indexType, offset);
    }

    dispose(): void {
        if (this.buffer) {
            this.buffer.dispose();
            this.buffer = null;
        }
        this._count = 0;
    }
}
