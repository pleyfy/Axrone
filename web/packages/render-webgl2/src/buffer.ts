import type { IDisposable } from './disposable';
import type { IBindableTarget } from './interfaces';
import { BufferPool, ResourceTracker } from './internal/buffer-management';

type Nominal<T, K extends string> = T & { readonly __brand: K };

export type GLBufferTarget =
    | WebGL2RenderingContext['ARRAY_BUFFER']
    | WebGL2RenderingContext['ELEMENT_ARRAY_BUFFER']
    | WebGL2RenderingContext['COPY_READ_BUFFER']
    | WebGL2RenderingContext['COPY_WRITE_BUFFER']
    | WebGL2RenderingContext['TRANSFORM_FEEDBACK_BUFFER']
    | WebGL2RenderingContext['UNIFORM_BUFFER']
    | WebGL2RenderingContext['PIXEL_PACK_BUFFER']
    | WebGL2RenderingContext['PIXEL_UNPACK_BUFFER'];

export type GLBufferUsage =
    | WebGL2RenderingContext['STATIC_DRAW']
    | WebGL2RenderingContext['DYNAMIC_DRAW']
    | WebGL2RenderingContext['STREAM_DRAW']
    | WebGL2RenderingContext['STATIC_READ']
    | WebGL2RenderingContext['DYNAMIC_READ']
    | WebGL2RenderingContext['STREAM_READ']
    | WebGL2RenderingContext['STATIC_COPY']
    | WebGL2RenderingContext['DYNAMIC_COPY']
    | WebGL2RenderingContext['STREAM_COPY'];

export type BufferId = Nominal<WebGLBuffer, 'BufferId'>;

export interface BufferOptions {
    readonly initialData?: BufferSource | null;
    readonly usage?: GLBufferUsage;
    readonly byteSize?: number;
    readonly label?: string;
}

export interface IBuffer extends IDisposable, IBindableTarget<IBuffer> {
    readonly id: BufferId;
    readonly target: GLBufferTarget;
    readonly byteLength: number;
    readonly usage: GLBufferUsage;
    readonly label: string | null;
    readonly update: <T extends BufferSource>(data: T, offset?: number) => IBuffer;

    readonly updateRange: <T extends BufferSource>(
        data: T,
        dstByteOffset: number,
        srcByteOffset?: number,
        length?: number
    ) => IBuffer;

    readonly resize: <T extends BufferSource | number>(
        dataOrByteSize: T,
        usage?: GLBufferUsage
    ) => IBuffer;

    readonly copyTo: (
        dstBuffer: IBuffer,
        srcOffset?: number,
        dstOffset?: number,
        size?: number
    ) => IBuffer;

    readonly getData: <T extends ArrayBufferView>(
        output: T,
        byteOffset?: number,
        length?: number
    ) => T;

    readonly getSubData: <T extends ArrayBufferView>(
        output: T,
        srcByteOffset: number,
        dstByteOffset?: number,
        length?: number
    ) => T;
}

export interface IBufferPool<T extends BufferSource> extends IDisposable {
    readonly allocate: (size: number, usage?: GLBufferUsage) => IBuffer;
    readonly release: (buffer: IBuffer) => void;
    readonly acquire: (data: T, usage?: GLBufferUsage) => IBuffer;
}

export interface IBufferFactory {
    readonly createBuffer: (target: GLBufferTarget, options?: BufferOptions) => IBuffer;
    readonly createArrayBuffer: (options?: BufferOptions) => IBuffer;
    readonly createElementArrayBuffer: (options?: BufferOptions) => IBuffer;
    readonly createUniformBuffer: (options?: BufferOptions) => IBuffer;

    readonly createBufferFromData: <T extends BufferSource>(
        target: GLBufferTarget,
        data: T,
        usage?: GLBufferUsage
    ) => IBuffer;

    readonly createArrayBufferFromData: <T extends BufferSource>(
        data: T,
        usage?: GLBufferUsage
    ) => IBuffer;

    readonly createElementArrayBufferFromData: <T extends BufferSource>(
        data: T,
        usage?: GLBufferUsage
    ) => IBuffer;

    readonly createUniformBufferFromData: <T extends BufferSource>(
        data: T,
        usage?: GLBufferUsage
    ) => IBuffer;

    readonly createPool: <T extends BufferSource>() => IBufferPool<T>;
}

export type ErrorCode =
    | 'INVALID_OPERATION'
    | 'BUFFER_ALREADY_DISPOSED'
    | 'OUT_OF_MEMORY'
    | 'INVALID_VALUE'
    | 'CONTEXT_LOST'
    | 'UNSUPPORTED_OPERATION';

export class GLError extends Error {
    constructor(
        public readonly message: string,
        public readonly code: ErrorCode,
        public readonly cause?: Error
    ) {
        super(`[WebGL2] ${code}: ${message}`);
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & { captureStackTrace?: (target: object, ctor: Function) => void }
        ).captureStackTrace?.(this, this.constructor);
    }
}

const SharedArrayBufferConstructor =
    typeof SharedArrayBuffer === 'undefined' ? undefined : SharedArrayBuffer;

const isSharedArrayBuffer = (value: unknown): value is SharedArrayBuffer => {
    return (
        SharedArrayBufferConstructor !== undefined && value instanceof SharedArrayBufferConstructor
    );
};

const isRawBufferData = (value: unknown): value is ArrayBuffer | SharedArrayBuffer => {
    return value instanceof ArrayBuffer || isSharedArrayBuffer(value);
};

const isBufferData = (value: unknown): value is BufferSource | SharedArrayBuffer => {
    return isRawBufferData(value) || ArrayBuffer.isView(value);
};

const createGLConstants = <T extends number>(
    gl: WebGL2RenderingContext
): Readonly<{
    ARRAY_BUFFER: T;
    ELEMENT_ARRAY_BUFFER: T;
    COPY_READ_BUFFER: T;
    COPY_WRITE_BUFFER: T;
    TRANSFORM_FEEDBACK_BUFFER: T;
    UNIFORM_BUFFER: T;
    PIXEL_PACK_BUFFER: T;
    PIXEL_UNPACK_BUFFER: T;
    STATIC_DRAW: T;
    DYNAMIC_DRAW: T;
    STREAM_DRAW: T;
    STATIC_READ: T;
    DYNAMIC_READ: T;
    STREAM_READ: T;
    STATIC_COPY: T;
    DYNAMIC_COPY: T;
    STREAM_COPY: T;
}> => {
    return Object.freeze({
        ARRAY_BUFFER: gl.ARRAY_BUFFER as T,
        ELEMENT_ARRAY_BUFFER: gl.ELEMENT_ARRAY_BUFFER as T,
        COPY_READ_BUFFER: gl.COPY_READ_BUFFER as T,
        COPY_WRITE_BUFFER: gl.COPY_WRITE_BUFFER as T,
        TRANSFORM_FEEDBACK_BUFFER: gl.TRANSFORM_FEEDBACK_BUFFER as T,
        UNIFORM_BUFFER: gl.UNIFORM_BUFFER as T,
        PIXEL_PACK_BUFFER: gl.PIXEL_PACK_BUFFER as T,
        PIXEL_UNPACK_BUFFER: gl.PIXEL_UNPACK_BUFFER as T,
        STATIC_DRAW: gl.STATIC_DRAW as T,
        DYNAMIC_DRAW: gl.DYNAMIC_DRAW as T,
        STREAM_DRAW: gl.STREAM_DRAW as T,
        STATIC_READ: gl.STATIC_READ as T,
        DYNAMIC_READ: gl.DYNAMIC_READ as T,
        STREAM_READ: gl.STREAM_READ as T,
        STATIC_COPY: gl.STATIC_COPY as T,
        DYNAMIC_COPY: gl.DYNAMIC_COPY as T,
        STREAM_COPY: gl.STREAM_COPY as T,
    });
};

export class Buffer implements IBuffer {
    readonly #gl: WebGL2RenderingContext;
    readonly #id: WebGLBuffer;
    readonly #target: GLBufferTarget;
    readonly #constants: ReturnType<typeof createGLConstants>;

    #byteLength: number = 0;
    #usage: GLBufferUsage;
    #label: string | null = null;
    #isDisposed: boolean = false;

    public get id(): BufferId {
        this.#throwIfDisposed();
        return this.#id as BufferId;
    }

    public get target(): GLBufferTarget {
        return this.#target;
    }

    public get byteLength(): number {
        return this.#byteLength;
    }

    public get usage(): GLBufferUsage {
        return this.#usage;
    }

    public get label(): string | null {
        return this.#label;
    }

    public get isDisposed(): boolean {
        return this.#isDisposed;
    }

    constructor(gl: WebGL2RenderingContext, target: GLBufferTarget, options: BufferOptions = {}) {
        const { initialData = null, usage = gl.STATIC_DRAW, byteSize = 0, label = null } = options;

        this.#gl = gl;
        this.#target = target;
        this.#usage = usage;
        this.#label = label;
        this.#constants = createGLConstants(gl);

        const buffer = gl.createBuffer();
        if (!buffer) {
            throw new GLError('Failed to create WebGLBuffer', 'OUT_OF_MEMORY');
        }
        this.#id = buffer;

        if (initialData) {
            this.resize(initialData, usage);
        } else if (byteSize > 0) {
            this.resize(byteSize, usage);
        }

        const debugExt = this.#gl.getExtension('KHR_debug');
        if (debugExt && typeof debugExt.labelObject === 'function' && label) {
            debugExt.labelObject(debugExt.BUFFER, this.#id, label);
        }
    }

    public bind = (): IBuffer => {
        this.#throwIfDisposed();
        this.#gl.bindBuffer(this.#target, this.#id);
        return this;
    };

    public unbind = (): IBuffer => {
        this.#throwIfDisposed();
        this.#gl.bindBuffer(this.#target, null);
        return this;
    };

    public update = <T extends BufferSource>(data: T, offset: number = 0): IBuffer => {
        this.#throwIfDisposed();

        if (!isBufferData(data)) {
            throw new GLError('Invalid data type for buffer update', 'INVALID_VALUE');
        }

        if (offset < 0) {
            throw new GLError('Offset cannot be negative', 'INVALID_VALUE');
        }

        const dataSize = data.byteLength;

        if (offset + dataSize > this.#byteLength) {
            throw new GLError(
                `Update would exceed buffer bounds: offset (${offset}) + data size (${dataSize}) > buffer size (${this.#byteLength})`,
                'INVALID_VALUE'
            );
        }

        this.bind();
        this.#gl.bufferSubData(this.#target, offset, data);

        return this;
    };

    public updateRange = <T extends BufferSource>(
        data: T,
        dstByteOffset: number,
        srcByteOffset: number = 0,
        length?: number
    ): IBuffer => {
        this.#throwIfDisposed();

        if (!isBufferData(data)) {
            throw new GLError('Invalid data type for buffer update', 'INVALID_VALUE');
        }

        if (dstByteOffset < 0 || srcByteOffset < 0) {
            throw new GLError('Offsets cannot be negative', 'INVALID_VALUE');
        }

        const dataSize = data.byteLength;

        const updateLength = length ?? dataSize - srcByteOffset;

        if (srcByteOffset + updateLength > dataSize) {
            throw new GLError(
                `Source range exceeds data bounds: srcOffset (${srcByteOffset}) + length (${updateLength}) > data size (${dataSize})`,
                'INVALID_VALUE'
            );
        }

        if (dstByteOffset + updateLength > this.#byteLength) {
            throw new GLError(
                `Destination range exceeds buffer bounds: dstOffset (${dstByteOffset}) + length (${updateLength}) > buffer size (${this.#byteLength})`,
                'INVALID_VALUE'
            );
        }

        this.bind();

        if (isRawBufferData(data)) {
            const view = new Uint8Array(data, srcByteOffset, updateLength);
            this.#gl.bufferSubData(this.#target, dstByteOffset, view);
        } else {
            const bytesPerElement =
                'BYTES_PER_ELEMENT' in data ? (data as any).BYTES_PER_ELEMENT : 1;
            const elementOffset = Math.floor(srcByteOffset / bytesPerElement);

            if (srcByteOffset % bytesPerElement !== 0) {
                const buffer = data.buffer;
                const view = new Uint8Array(buffer, data.byteOffset + srcByteOffset, updateLength);
                this.#gl.bufferSubData(this.#target, dstByteOffset, view);
            } else {
                const constructor = data.constructor as ArrayBufferViewConstructor;
                const elementsLength = Math.floor(updateLength / bytesPerElement);
                const typedView = new constructor(
                    data.buffer,
                    data.byteOffset + srcByteOffset,
                    elementsLength
                );

                this.#gl.bufferSubData(this.#target, dstByteOffset, typedView);
            }
        }

        return this;
    };

    public resize = <T extends BufferSource | number>(
        dataOrByteSize: T,
        usage?: GLBufferUsage
    ): IBuffer => {
        this.#throwIfDisposed();

        const effectiveUsage = usage ?? this.#usage;

        this.bind();

        if (typeof dataOrByteSize === 'number') {
            if (dataOrByteSize < 0) {
                throw new GLError('Buffer size cannot be negative', 'INVALID_VALUE');
            }

            this.#gl.bufferData(this.#target, dataOrByteSize, effectiveUsage);
            this.#byteLength = dataOrByteSize;
        } else {
            if (!isBufferData(dataOrByteSize)) {
                throw new GLError('Invalid data type for buffer resize', 'INVALID_VALUE');
            }

            this.#gl.bufferData(this.#target, dataOrByteSize, effectiveUsage);
            this.#byteLength = dataOrByteSize.byteLength;
        }

        this.#usage = effectiveUsage;

        return this;
    };

    public copyTo = (
        dstBuffer: IBuffer,
        srcOffset: number = 0,
        dstOffset: number = 0,
        size?: number
    ): IBuffer => {
        this.#throwIfDisposed();

        if (dstBuffer.isDisposed) {
            throw new GLError('Cannot copy to a disposed buffer', 'BUFFER_ALREADY_DISPOSED');
        }

        if (srcOffset < 0 || dstOffset < 0) {
            throw new GLError('Offsets cannot be negative', 'INVALID_VALUE');
        }

        const copySize =
            size ?? Math.min(this.#byteLength - srcOffset, dstBuffer.byteLength - dstOffset);

        if (copySize <= 0) {
            return this;
        }

        if (srcOffset + copySize > this.#byteLength) {
            throw new GLError(
                `Source range exceeds buffer bounds: srcOffset (${srcOffset}) + size (${copySize}) > buffer size (${this.#byteLength})`,
                'INVALID_VALUE'
            );
        }

        if (dstOffset + copySize > dstBuffer.byteLength) {
            throw new GLError(
                `Destination range exceeds buffer bounds: dstOffset (${dstOffset}) + size (${copySize}) > buffer size (${dstBuffer.byteLength})`,
                'INVALID_VALUE'
            );
        }

        this.#gl.bindBuffer(this.#constants.COPY_READ_BUFFER, this.#id);
        this.#gl.bindBuffer(this.#constants.COPY_WRITE_BUFFER, dstBuffer.id as WebGLBuffer);

        this.#gl.copyBufferSubData(
            this.#constants.COPY_READ_BUFFER,
            this.#constants.COPY_WRITE_BUFFER,
            srcOffset,
            dstOffset,
            copySize
        );

        this.#gl.bindBuffer(this.#constants.COPY_READ_BUFFER, null);
        this.#gl.bindBuffer(this.#constants.COPY_WRITE_BUFFER, null);

        return this;
    };

    public getData = <T extends ArrayBufferView>(
        output: T,
        byteOffset: number = 0,
        length?: number
    ): T => {
        this.#throwIfDisposed();

        if (!(output instanceof Object && ArrayBuffer.isView(output))) {
            throw new GLError('Output must be an ArrayBufferView', 'INVALID_VALUE');
        }

        if (byteOffset < 0) {
            throw new GLError('Offset cannot be negative', 'INVALID_VALUE');
        }

        const bytesPerElement =
            'BYTES_PER_ELEMENT' in output ? (output as any).BYTES_PER_ELEMENT : 1;
        const maxLength = Math.min(this.#byteLength - byteOffset, output.byteLength);

        const readLength = length !== undefined ? Math.min(length, maxLength) : maxLength;

        if (readLength <= 0) {
            return output;
        }

        this.#gl.bindBuffer(this.#constants.PIXEL_PACK_BUFFER, this.#id);

        try {
            const alignedLength = Math.floor(readLength / bytesPerElement) * bytesPerElement;

            if (typeof this.#gl.getBufferSubData === 'function') {
                this.#gl.getBufferSubData(
                    this.#constants.PIXEL_PACK_BUFFER,
                    byteOffset,
                    output,
                    0,
                    alignedLength / bytesPerElement
                );
            } else {
                throw new GLError(
                    'getBufferSubData is not supported in this WebGL2 context',
                    'UNSUPPORTED_OPERATION'
                );
            }
        } finally {
            this.#gl.bindBuffer(this.#constants.PIXEL_PACK_BUFFER, null);
        }

        return output;
    };

    public getSubData = <T extends ArrayBufferView>(
        output: T,
        srcByteOffset: number,
        dstByteOffset: number = 0,
        length?: number
    ): T => {
        this.#throwIfDisposed();

        if (!(output instanceof Object && ArrayBuffer.isView(output))) {
            throw new GLError('Output must be an ArrayBufferView', 'INVALID_VALUE');
        }

        if (srcByteOffset < 0 || dstByteOffset < 0) {
            throw new GLError('Offsets cannot be negative', 'INVALID_VALUE');
        }

        const bytesPerElement =
            'BYTES_PER_ELEMENT' in output ? (output as any).BYTES_PER_ELEMENT : 1;
        const outputSize = output.byteLength;

        if (dstByteOffset >= outputSize) {
            throw new GLError('Destination offset exceeds output buffer size', 'INVALID_VALUE');
        }

        const maxLength = Math.min(this.#byteLength - srcByteOffset, outputSize - dstByteOffset);

        const readLength = length !== undefined ? Math.min(length, maxLength) : maxLength;

        if (readLength <= 0) {
            return output;
        }

        this.#gl.bindBuffer(this.#constants.PIXEL_PACK_BUFFER, this.#id);

        try {
            if (typeof this.#gl.getBufferSubData === 'function') {
                const dstElementOffset = Math.floor(dstByteOffset / bytesPerElement);
                const alignedLength = Math.floor(readLength / bytesPerElement) * bytesPerElement;

                if (dstByteOffset % bytesPerElement === 0) {
                    this.#gl.getBufferSubData(
                        this.#constants.PIXEL_PACK_BUFFER,
                        srcByteOffset,
                        output,
                        dstElementOffset,
                        alignedLength / bytesPerElement
                    );
                } else {
                    const tempBuffer = new Uint8Array(readLength);
                    this.#gl.getBufferSubData(
                        this.#constants.PIXEL_PACK_BUFFER,
                        srcByteOffset,
                        tempBuffer
                    );

                    const outputBytes = new Uint8Array(
                        output.buffer,
                        output.byteOffset,
                        output.byteLength
                    );

                    for (let i = 0; i < readLength; i++) {
                        outputBytes[dstByteOffset + i] = tempBuffer[i];
                    }
                }
            } else {
                throw new GLError(
                    'getBufferSubData is not supported in this WebGL2 context',
                    'UNSUPPORTED_OPERATION'
                );
            }
        } finally {
            this.#gl.bindBuffer(this.#constants.PIXEL_PACK_BUFFER, null);
        }

        return output;
    };

    public dispose = (): void => {
        if (this.#isDisposed) return;

        try {
            const possibleTargets = [
                this.#constants.ARRAY_BUFFER,
                this.#constants.ELEMENT_ARRAY_BUFFER,
                this.#constants.COPY_READ_BUFFER,
                this.#constants.COPY_WRITE_BUFFER,
                this.#constants.PIXEL_PACK_BUFFER,
                this.#constants.PIXEL_UNPACK_BUFFER,
                this.#constants.TRANSFORM_FEEDBACK_BUFFER,
                this.#constants.UNIFORM_BUFFER,
            ];

            for (const target of possibleTargets) {
                const currentBinding = this.#gl.getParameter(target + 0x20) as WebGLBuffer | null;
                if (currentBinding === this.#id) {
                    this.#gl.bindBuffer(target, null);
                }
            }

            this.#gl.deleteBuffer(this.#id);
        } catch (e) {
        } finally {
            this.#isDisposed = true;
        }
    };

    #throwIfDisposed = (): void => {
        if (this.#isDisposed) {
            throw new GLError('Buffer has been disposed', 'BUFFER_ALREADY_DISPOSED');
        }
    };
}

type ArrayBufferViewConstructor = {
    new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): ArrayBufferView;
};

class BufferFactory implements IBufferFactory {
    readonly #gl: WebGL2RenderingContext;
    readonly #constants: ReturnType<typeof createGLConstants>;
    readonly #tracker = new ResourceTracker((message, code) => new GLError(message, code));
    readonly #contextLostHandler: (event: Event) => void;
    #isDisposed = false;

    constructor(gl: WebGL2RenderingContext) {
        this.#gl = gl;
        this.#constants = createGLConstants(gl);

        this.#contextLostHandler = (event: Event) => {
            event.preventDefault();
            this.#isDisposed = true;
            this.#tracker.dispose();
        };

        gl.canvas.addEventListener('webglcontextlost', this.#contextLostHandler);
    }

    public get isDisposed(): boolean {
        return this.#isDisposed;
    }

    public createBuffer = (target: GLBufferTarget, options: BufferOptions = {}): IBuffer => {
        this.#throwIfDisposed();
        return this.#tracker.track(new Buffer(this.#gl, target, options));
    };

    public createArrayBuffer = (options: BufferOptions = {}): IBuffer => {
        return this.createBuffer(this.#constants.ARRAY_BUFFER as GLBufferTarget, options);
    };

    public createElementArrayBuffer = (options: BufferOptions = {}): IBuffer => {
        return this.createBuffer(this.#constants.ELEMENT_ARRAY_BUFFER as GLBufferTarget, options);
    };

    public createUniformBuffer = (options: BufferOptions = {}): IBuffer => {
        return this.createBuffer(this.#constants.UNIFORM_BUFFER as GLBufferTarget, options);
    };

    public createBufferFromData = <T extends BufferSource>(
        target: GLBufferTarget,
        data: T,
        usage: GLBufferUsage = this.#constants.STATIC_DRAW as GLBufferUsage
    ): IBuffer => {
        return this.createBuffer(target, { initialData: data, usage });
    };

    public createArrayBufferFromData = <T extends BufferSource>(
        data: T,
        usage: GLBufferUsage = this.#constants.STATIC_DRAW as GLBufferUsage
    ): IBuffer => {
        return this.createBufferFromData(
            this.#constants.ARRAY_BUFFER as GLBufferTarget,
            data,
            usage
        );
    };

    public createElementArrayBufferFromData = <T extends BufferSource>(
        data: T,
        usage: GLBufferUsage = this.#constants.STATIC_DRAW as GLBufferUsage
    ): IBuffer => {
        return this.createBufferFromData(
            this.#constants.ELEMENT_ARRAY_BUFFER as GLBufferTarget,
            data,
            usage
        );
    };

    public createUniformBufferFromData = <T extends BufferSource>(
        data: T,
        usage: GLBufferUsage = this.#constants.STATIC_DRAW as GLBufferUsage
    ): IBuffer => {
        return this.createBufferFromData(
            this.#constants.UNIFORM_BUFFER as GLBufferTarget,
            data,
            usage
        );
    };

    public createPool = <T extends BufferSource>(): IBufferPool<T> => {
        this.#throwIfDisposed();
        return this.#tracker.track(
            new BufferPool<T>({
                defaultUsage: this.#constants.STATIC_DRAW as GLBufferUsage,
                createBuffer: (size, usage) =>
                    new Buffer(this.#gl, this.#constants.ARRAY_BUFFER as GLBufferTarget, {
                        byteSize: size,
                        usage,
                    }),
                createError: (message, code) => new GLError(message, code),
            })
        );
    };

    public dispose = (): void => {
        if (this.#isDisposed) return;

        this.#gl.canvas.removeEventListener('webglcontextlost', this.#contextLostHandler);

        this.#tracker.dispose();
        this.#isDisposed = true;
    };

    #throwIfDisposed = (): void => {
        if (this.#isDisposed) {
            throw new GLError(
                'BufferFactory has been disposed or context was lost',
                'INVALID_OPERATION'
            );
        }
    };
}

export const createTypedArrayFromBuffer = <T extends ArrayBufferView>(
    buffer: ArrayBuffer | SharedArrayBuffer,
    type: new (buffer: ArrayBufferLike, byteOffset?: number, length?: number) => T,
    byteOffset: number = 0,
    length?: number
): T => {
    const bytesPerElement = type.prototype.BYTES_PER_ELEMENT || 1;

    if (byteOffset % bytesPerElement !== 0) {
        throw new GLError(
            `Byte offset (${byteOffset}) must be a multiple of element size (${bytesPerElement})`,
            'INVALID_VALUE'
        );
    }

    const maxElements = Math.floor((buffer.byteLength - byteOffset) / bytesPerElement);
    const elements = length !== undefined ? Math.min(length, maxElements) : maxElements;

    return new type(buffer, byteOffset, elements);
};

export const alignTo = (value: number, alignment: number): number => {
    return Math.ceil(value / alignment) * alignment;
};

export const calculatePadding = (offset: number, alignment: number): number => {
    const remainder = offset % alignment;
    return remainder === 0 ? 0 : alignment - remainder;
};

export const createBufferFactory = (gl: WebGL2RenderingContext): IBufferFactory & IDisposable => {
    return new BufferFactory(gl);
};

export const WBuffer = Object.freeze({
    createBufferFactory,
    createTypedArrayFromBuffer,
    alignTo,
    calculatePadding,
    GLError,
});
