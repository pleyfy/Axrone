import type { ContextSource, IGLContext } from '../context';
import { resolveContext } from '../context';
import type { GLConstants } from '../context/types';
import { DisposalTracker } from '../internal/disposable';
import { FramebufferError } from './errors';
import { getPixelFormatForInternalFormat, getTextureTypeForFormat } from './format';
import type { ITexture, TextureOptions } from './interfaces';
import type { GLTextureFormat, GLTextureTarget, TextureId } from './types';

export class Texture implements ITexture {
    readonly #ctx: IGLContext;
    readonly #gl: WebGL2RenderingContext;
    readonly #id: WebGLTexture;
    readonly #target: GLTextureTarget;
    readonly #constants: GLConstants;

    #width: number;
    #height: number;
    #format: GLTextureFormat;
    #internalFormat: GLTextureFormat;
    #type: GLenum;
    #samples: number;
    #label: string | null;
    private readonly _disposal = new DisposalTracker();

    public get id(): TextureId {
        this.#throwIfDisposed();
        return this.#id as TextureId;
    }

    public get target(): GLTextureTarget {
        return this.#target;
    }

    public get width(): number {
        return this.#width;
    }

    public get height(): number {
        return this.#height;
    }

    public get format(): GLTextureFormat {
        return this.#format;
    }

    public get internalFormat(): GLTextureFormat {
        return this.#internalFormat;
    }

    public get type(): GLenum {
        return this.#type;
    }

    public get samples(): number {
        return this.#samples;
    }

    public get label(): string | null {
        return this.#label;
    }

    public get isDisposed(): boolean {
        return this._disposal.isDisposed;
    }

    constructor(source: ContextSource, target: GLTextureTarget, options: TextureOptions) {
        const ctx = resolveContext(source as ContextSource);
        const gl = ctx.gl;
        const {
            width,
            height,
            format,
            internalFormat = format ?? gl.RGBA8,
            type,
            minFilter = gl.LINEAR,
            magFilter = gl.LINEAR,
            wrapS = gl.CLAMP_TO_EDGE,
            wrapT = gl.CLAMP_TO_EDGE,
            generateMipmap = false,
            samples = 0,
            label = null,
        } = options;

        this.#ctx = ctx;
        this.#gl = gl;
        this.#target = target;
        this.#width = width;
        this.#height = height;
        this.#internalFormat = internalFormat;
        this.#format = format ?? getPixelFormatForInternalFormat(gl, internalFormat);
        this.#type = type ?? getTextureTypeForFormat(gl, internalFormat);
        this.#samples = samples;
        this.#label = label;
        this.#constants = ctx.constants;

        const texture = gl.createTexture();
        if (!texture) {
            throw new FramebufferError('Failed to create WebGLTexture', 'OUT_OF_MEMORY');
        }
        this.#id = texture;

        this.bind();

        if (samples > 0) {
            throw new FramebufferError(
                'Multisampled textures should be handled via renderbuffers for better compatibility',
                'UNSUPPORTED_OPERATION'
            );
        } else if (target === gl.TEXTURE_2D) {
            gl.texStorage2D(target, 1, internalFormat, width, height);
        } else if (target === gl.TEXTURE_CUBE_MAP) {
            gl.texStorage2D(target, 1, internalFormat, width, height);
        }

        if (samples === 0) {
            gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, minFilter);
            gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, magFilter);
            gl.texParameteri(target, gl.TEXTURE_WRAP_S, wrapS);
            gl.texParameteri(target, gl.TEXTURE_WRAP_T, wrapT);

            if (generateMipmap) {
                this.generateMipmap();
            }
        }

        this.unbind();

        const debugExt = this.#gl.getExtension('KHR_debug');
        if (debugExt && typeof debugExt.labelObject === 'function' && label) {
            debugExt.labelObject(debugExt.TEXTURE, this.#id, label);
        }
    }

    public bind = (): ITexture => {
        this.#throwIfDisposed();
        this.#ctx.state.bindTexture(this.#target, this.#id);
        return this;
    };

    public unbind = (): ITexture => {
        this.#throwIfDisposed();
        this.#ctx.state.bindTexture(this.#target, null);
        return this;
    };

    public resize = (width: number, height: number): ITexture => {
        this.#throwIfDisposed();

        if (width <= 0 || height <= 0) {
            throw new FramebufferError(`Invalid dimensions: ${width}x${height}`, 'INVALID_VALUE');
        }

        if (this.#samples > 0) {
            throw new FramebufferError(
                'Cannot resize multisampled textures directly',
                'INVALID_OPERATION'
            );
        }

        this.#width = width;
        this.#height = height;

        this.bind();

        if (this.#target === this.#gl.TEXTURE_2D) {
            this.#gl.texStorage2D(this.#target, 1, this.#internalFormat, width, height);
        }

        this.unbind();
        return this;
    };

    public generateMipmap = (): ITexture => {
        this.#throwIfDisposed();

        if (this.#samples > 0) {
            throw new FramebufferError(
                'Cannot generate mipmaps for multisampled textures',
                'INVALID_OPERATION'
            );
        }

        this.bind();
        this.#gl.generateMipmap(this.#target);
        this.unbind();
        return this;
    };

    public setData = (
        data: TexImageSource | ArrayBufferView | null,
        level: number = 0
    ): ITexture => {
        this.#throwIfDisposed();

        if (this.#samples > 0) {
            throw new FramebufferError(
                'Cannot set data on multisampled textures',
                'INVALID_OPERATION'
            );
        }

        this.bind();

        if (this.#target === this.#gl.TEXTURE_2D) {
            if (data === null) {
                this.#gl.texSubImage2D(
                    this.#target,
                    level,
                    0,
                    0,
                    this.#width,
                    this.#height,
                    this.#format,
                    this.#type,
                    null
                );
            } else if (
                data instanceof HTMLImageElement ||
                data instanceof HTMLCanvasElement ||
                data instanceof HTMLVideoElement ||
                data instanceof ImageBitmap ||
                data instanceof ImageData
            ) {
                this.#gl.texSubImage2D(this.#target, level, 0, 0, this.#format, this.#type, data);
            } else if (ArrayBuffer.isView(data)) {
                this.#gl.texSubImage2D(
                    this.#target,
                    level,
                    0,
                    0,
                    this.#width,
                    this.#height,
                    this.#format,
                    this.#type,
                    data
                );
            }
        }

        this.unbind();
        return this;
    };

    public getPixels = <T extends ArrayBufferView>(output: T, level: number = 0): T => {
        this.#throwIfDisposed();

        if (this.#samples > 0) {
            throw new FramebufferError(
                'Cannot read pixels from multisampled textures directly',
                'INVALID_OPERATION'
            );
        }

        throw new FramebufferError(
            'Direct texture pixel reading not supported. Use framebuffer readPixels instead.',
            'UNSUPPORTED_OPERATION'
        );
    };

    public dispose = (): void => {
        if (!this._disposal.markDisposed()) return;

        this.#gl.deleteTexture(this.#id);
    };

    #throwIfDisposed = (): void => {
        this._disposal.assertAlive(
            (name) => new FramebufferError(`${name} has been disposed`, 'TEXTURE_ALREADY_DISPOSED'),
            'Texture'
        );
    };
}
