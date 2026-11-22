import type { ContextSource, IGLContext } from '../context';
import { resolveContext } from '../context';
import type { GLConstants } from '../context/types';
import { DisposalTracker } from '../internal/disposable';
import { FramebufferError } from './errors';
import type { IRenderbuffer, RenderbufferOptions } from './interfaces';
import type { GLTextureFormat, RenderbufferId } from './types';

export class Renderbuffer implements IRenderbuffer {
    readonly #ctx: IGLContext;
    readonly #gl: WebGL2RenderingContext;
    readonly #id: WebGLRenderbuffer;
    readonly #constants: GLConstants;

    #width: number;
    #height: number;
    #internalFormat: GLTextureFormat;
    #samples: number;
    #label: string | null;
    private readonly _disposal = new DisposalTracker();

    public get id(): RenderbufferId {
        this.#throwIfDisposed();
        return this.#id as RenderbufferId;
    }

    public get width(): number {
        return this.#width;
    }

    public get height(): number {
        return this.#height;
    }

    public get internalFormat(): GLTextureFormat {
        return this.#internalFormat;
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

    constructor(source: ContextSource, options: RenderbufferOptions) {
        const ctx = resolveContext(source as ContextSource);
        const gl = ctx.gl;
        const { width, height, internalFormat, samples = 0, label = null } = options;

        this.#ctx = ctx;
        this.#gl = gl;
        this.#width = width;
        this.#height = height;
        this.#internalFormat = internalFormat;
        this.#samples = samples;
        this.#label = label;
        this.#constants = ctx.constants;

        const renderbuffer = gl.createRenderbuffer();
        if (!renderbuffer) {
            throw new FramebufferError('Failed to create WebGLRenderbuffer', 'OUT_OF_MEMORY');
        }
        this.#id = renderbuffer;

        this.bind();

        if (samples > 0) {
            gl.renderbufferStorageMultisample(
                gl.RENDERBUFFER,
                samples,
                internalFormat,
                width,
                height
            );
        } else {
            gl.renderbufferStorage(gl.RENDERBUFFER, internalFormat, width, height);
        }

        this.unbind();

        const debugExt = this.#gl.getExtension('KHR_debug');
        if (debugExt && typeof debugExt.labelObject === 'function' && label) {
            debugExt.labelObject(debugExt.RENDERBUFFER, this.#id, label);
        }
    }

    public bind = (): IRenderbuffer => {
        this.#throwIfDisposed();
        this.#ctx.state.bindRenderbuffer(this.#constants.RENDERBUFFER, this.#id);
        return this;
    };

    public unbind = (): IRenderbuffer => {
        this.#throwIfDisposed();
        this.#ctx.state.bindRenderbuffer(this.#constants.RENDERBUFFER, null);
        return this;
    };

    public resize = (width: number, height: number, samples?: number): IRenderbuffer => {
        this.#throwIfDisposed();

        if (width <= 0 || height <= 0) {
            throw new FramebufferError(`Invalid dimensions: ${width}x${height}`, 'INVALID_VALUE');
        }

        this.#width = width;
        this.#height = height;
        if (samples !== undefined) {
            this.#samples = samples;
        }

        this.bind();

        if (this.#samples > 0) {
            this.#gl.renderbufferStorageMultisample(
                this.#gl.RENDERBUFFER,
                this.#samples,
                this.#internalFormat,
                width,
                height
            );
        } else {
            this.#gl.renderbufferStorage(
                this.#gl.RENDERBUFFER,
                this.#internalFormat,
                width,
                height
            );
        }

        this.unbind();
        return this;
    };

    public dispose = (): void => {
        if (!this._disposal.markDisposed()) return;

        this.#gl.deleteRenderbuffer(this.#id);
    };

    #throwIfDisposed = (): void => {
        this._disposal.assertAlive(
            (name) => new FramebufferError(`${name} has been disposed`, 'RENDERBUFFER_ALREADY_DISPOSED'),
            'Renderbuffer'
        );
    };
}
