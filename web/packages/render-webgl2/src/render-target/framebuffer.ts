import type { ContextSource, IGLContext } from '../context';
import { resolveContext } from '../context';
import type { GLConstants } from '../context/types';
import { DisposalTracker } from '../internal/disposable';
import {
    getFramebufferStatusString,
    resolveAttachmentSlot,
    validateAttachmentConfig,
} from './attachment';
import type { AttachmentSlot } from './attachment';
import { FramebufferError } from './errors';
import {
    getAttachmentInternalFormat,
    inferReadFormat,
    inferReadType,
} from './format';
import type {
    AttachmentConfig,
    FramebufferOptions,
    IFramebuffer,
    IRenderbuffer,
    ITexture,
} from './interfaces';
import type { FramebufferId, FramebufferStatus, GLAttachment, GLFilterMode } from './types';

export class Framebuffer implements IFramebuffer {
    readonly #ctx: IGLContext;
    readonly #gl: WebGL2RenderingContext;
    readonly #id: WebGLFramebuffer;
    readonly #constants: GLConstants;

    #width: number;
    #height: number;
    #label: string | null;
    private readonly _disposal = new DisposalTracker();
    #colorAttachments: (ITexture | null)[] = [];
    #depthAttachment: ITexture | IRenderbuffer | null = null;
    #stencilAttachment: ITexture | IRenderbuffer | null = null;
    #depthStencilAttachment: ITexture | IRenderbuffer | null = null;

    public get id(): FramebufferId {
        this.#throwIfDisposed();
        return this.#id as FramebufferId;
    }

    public get width(): number {
        return this.#width;
    }

    public get height(): number {
        return this.#height;
    }

    public get label(): string | null {
        return this.#label;
    }

    public get isDisposed(): boolean {
        return this._disposal.isDisposed;
    }

    public get colorAttachments(): readonly ITexture[] {
        return this.#colorAttachments.filter((t): t is ITexture => t !== null);
    }

    public get depthAttachment(): ITexture | IRenderbuffer | null {
        return this.#depthAttachment;
    }

    public get stencilAttachment(): ITexture | IRenderbuffer | null {
        return this.#stencilAttachment;
    }

    public get depthStencilAttachment(): ITexture | IRenderbuffer | null {
        return this.#depthStencilAttachment;
    }

    public get isComplete(): boolean {
        this.#throwIfDisposed();
        this.bind();
        const status = this.#gl.checkFramebufferStatus(this.#gl.FRAMEBUFFER);
        this.unbind();
        return status === this.#gl.FRAMEBUFFER_COMPLETE;
    }

    public get status(): FramebufferStatus {
        this.#throwIfDisposed();
        this.bind();
        const status = this.#gl.checkFramebufferStatus(this.#gl.FRAMEBUFFER) as FramebufferStatus;
        this.unbind();
        return status;
    }

    constructor(source: ContextSource, options: FramebufferOptions) {
        const ctx = resolveContext(source as ContextSource);
        const gl = ctx.gl;
        const {
            width,
            height,
            colorAttachments = [],
            depthAttachment,
            stencilAttachment,
            depthStencilAttachment,
            label = null,
        } = options;

        this.#ctx = ctx;
        this.#gl = gl;
        this.#width = width;
        this.#height = height;
        this.#label = label;
        this.#constants = ctx.constants;

        const framebuffer = gl.createFramebuffer();
        if (!framebuffer) {
            throw new FramebufferError('Failed to create WebGLFramebuffer', 'OUT_OF_MEMORY');
        }
        this.#id = framebuffer;

        this.bind();

        for (const config of colorAttachments) {
            this.#attachInternal(config);
        }

        if (depthAttachment) {
            this.#attachInternal(depthAttachment);
        }

        if (stencilAttachment) {
            this.#attachInternal(stencilAttachment);
        }

        if (depthStencilAttachment) {
            this.#attachInternal(depthStencilAttachment);
        }

        const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        if (status !== gl.FRAMEBUFFER_COMPLETE) {
            this.unbind();
            throw new FramebufferError(
                `Framebuffer incomplete: ${getFramebufferStatusString(gl, status as FramebufferStatus)}`,
                'INCOMPLETE_FRAMEBUFFER'
            );
        }

        this.unbind();

        const debugExt = this.#gl.getExtension('KHR_debug');
        if (debugExt && typeof debugExt.labelObject === 'function' && label) {
            debugExt.labelObject(debugExt.FRAMEBUFFER, this.#id, label);
        }
    }

    public bind = (): IFramebuffer => {
        this.#throwIfDisposed();
        this.#ctx.state.bindFramebuffer(this.#gl.FRAMEBUFFER, this.#id);
        this.#ctx.state.viewport(0, 0, this.#width, this.#height);
        return this;
    };

    public unbind = (): IFramebuffer => {
        this.#throwIfDisposed();
        this.#ctx.state.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
        return this;
    };

    public attachTexture = (
        attachment: GLAttachment,
        texture: ITexture,
        level: number = 0,
        layer?: number
    ): IFramebuffer => {
        this.#throwIfDisposed();

        if (texture.isDisposed) {
            throw new FramebufferError(
                'Cannot attach disposed texture',
                'TEXTURE_ALREADY_DISPOSED'
            );
        }

        this.bind();

        if (layer !== undefined && texture.target === this.#gl.TEXTURE_2D_ARRAY) {
            this.#gl.framebufferTextureLayer(
                this.#gl.FRAMEBUFFER,
                attachment,
                texture.id as WebGLTexture,
                level,
                layer
            );
        } else {
            this.#gl.framebufferTexture2D(
                this.#gl.FRAMEBUFFER,
                attachment,
                texture.target,
                texture.id as WebGLTexture,
                level
            );
        }

        this.#updateAttachmentReferences(attachment, texture);
        this.unbind();
        return this;
    };

    public attachRenderbuffer = (
        attachment: GLAttachment,
        renderbuffer: IRenderbuffer
    ): IFramebuffer => {
        this.#throwIfDisposed();

        if (renderbuffer.isDisposed) {
            throw new FramebufferError(
                'Cannot attach disposed renderbuffer',
                'RENDERBUFFER_ALREADY_DISPOSED'
            );
        }

        this.bind();
        this.#gl.framebufferRenderbuffer(
            this.#gl.FRAMEBUFFER,
            attachment,
            this.#gl.RENDERBUFFER,
            renderbuffer.id as WebGLRenderbuffer
        );

        this.#updateAttachmentReferences(attachment, renderbuffer);
        this.unbind();
        return this;
    };

    public detach = (attachment: GLAttachment): IFramebuffer => {
        this.#throwIfDisposed();

        this.bind();
        this.#gl.framebufferTexture2D(
            this.#gl.FRAMEBUFFER,
            attachment,
            this.#gl.TEXTURE_2D,
            null,
            0
        );

        this.#updateAttachmentReferences(attachment, null);
        this.unbind();
        return this;
    };

    public resize = (width: number, height: number): IFramebuffer => {
        this.#throwIfDisposed();

        if (width <= 0 || height <= 0) {
            throw new FramebufferError(`Invalid dimensions: ${width}x${height}`, 'INVALID_VALUE');
        }

        this.#width = width;
        this.#height = height;

        for (const texture of this.#colorAttachments) {
            if (texture && !texture.isDisposed) {
                texture.resize(width, height);
            }
        }

        if (this.#depthAttachment && !this.#depthAttachment.isDisposed) {
            this.#depthAttachment.resize(width, height);
        }

        if (this.#stencilAttachment && !this.#stencilAttachment.isDisposed) {
            this.#stencilAttachment.resize(width, height);
        }

        if (this.#depthStencilAttachment && !this.#depthStencilAttachment.isDisposed) {
            this.#depthStencilAttachment.resize(width, height);
        }

        return this;
    };

    public clear = (
        color?: [number, number, number, number],
        depth?: number,
        stencil?: number
    ): IFramebuffer => {
        this.#throwIfDisposed();

        this.bind();

        let mask = 0;

        if (color !== undefined && this.#colorAttachments.length > 0) {
            this.#gl.clearColor(color[0], color[1], color[2], color[3]);
            mask |= this.#gl.COLOR_BUFFER_BIT;
        }

        if (depth !== undefined && (this.#depthAttachment || this.#depthStencilAttachment)) {
            this.#gl.clearDepth(depth);
            mask |= this.#gl.DEPTH_BUFFER_BIT;
        }

        if (stencil !== undefined && (this.#stencilAttachment || this.#depthStencilAttachment)) {
            this.#gl.clearStencil(stencil);
            mask |= this.#gl.STENCIL_BUFFER_BIT;
        }

        if (mask > 0) {
            this.#gl.clear(mask);
        }

        this.unbind();
        return this;
    };

    public readPixels = <T extends ArrayBufferView>(
        output: T,
        x: number = 0,
        y: number = 0,
        width: number = this.#width,
        height: number = this.#height,
        attachment: GLAttachment = this.#gl.COLOR_ATTACHMENT0,
        format?: GLenum,
        type?: GLenum
    ): T => {
        this.#throwIfDisposed();

        this.#ctx.state.bindFramebuffer(this.#gl.FRAMEBUFFER, this.#id);

        const slot = resolveAttachmentSlot(this.#gl, attachment);

        if (slot !== null && slot.kind === 'color') {
            this.#gl.readBuffer(attachment);
        }

        let resolvedFormat = format;
        let resolvedType = type;

        if (resolvedFormat === undefined || resolvedType === undefined) {
            const internalFormat =
                slot === null ? null : getAttachmentInternalFormat(this.#getSlotResource(slot));

            if (internalFormat !== null) {
                if (resolvedFormat === undefined) {
                    resolvedFormat = inferReadFormat(this.#gl, internalFormat);
                }
                if (resolvedType === undefined) {
                    resolvedType = inferReadType(this.#gl, internalFormat);
                }
            } else {
                if (resolvedFormat === undefined) resolvedFormat = this.#gl.RGBA;
                if (resolvedType === undefined) resolvedType = this.#gl.UNSIGNED_BYTE;
            }
        }

        this.#gl.readPixels(x, y, width, height, resolvedFormat, resolvedType, output);

        this.#ctx.state.bindFramebuffer(this.#gl.FRAMEBUFFER, null);
        return output;
    };

    public blit = (
        source: IFramebuffer,
        srcRect: [number, number, number, number] = [0, 0, source.width, source.height],
        dstRect: [number, number, number, number] = [0, 0, this.#width, this.#height],
        mask: GLbitfield = this.#gl.COLOR_BUFFER_BIT,
        filter: GLFilterMode = this.#gl.NEAREST
    ): IFramebuffer => {
        this.#throwIfDisposed();

        if (source.isDisposed) {
            throw new FramebufferError(
                'Cannot blit from disposed framebuffer',
                'FRAMEBUFFER_ALREADY_DISPOSED'
            );
        }

        this.#ctx.state.bindFramebuffer(this.#gl.READ_FRAMEBUFFER, source.id as WebGLFramebuffer);
        this.#ctx.state.bindFramebuffer(this.#gl.DRAW_FRAMEBUFFER, this.#id);

        this.#gl.blitFramebuffer(
            srcRect[0],
            srcRect[1],
            srcRect[2],
            srcRect[3],
            dstRect[0],
            dstRect[1],
            dstRect[2],
            dstRect[3],
            mask,
            filter
        );

        this.#ctx.state.bindFramebuffer(this.#gl.READ_FRAMEBUFFER, null);
        this.#ctx.state.bindFramebuffer(this.#gl.DRAW_FRAMEBUFFER, null);

        return this;
    };

    public dispose = (): void => {
        if (!this._disposal.markDisposed()) return;

        this.#gl.deleteFramebuffer(this.#id);

        this.#colorAttachments.length = 0;
        this.#depthAttachment = null;
        this.#stencilAttachment = null;
        this.#depthStencilAttachment = null;
    };

    #attachInternal = (config: AttachmentConfig): void => {
        validateAttachmentConfig(this.#gl, config);

        if (config.texture) {
            this.attachTexture(config.attachment, config.texture, config.level, config.layer);
        } else if (config.renderbuffer) {
            this.attachRenderbuffer(config.attachment, config.renderbuffer);
        }
    };

    #getSlotResource = (slot: AttachmentSlot): ITexture | IRenderbuffer | null => {
        if (slot.kind === 'color') {
            return this.#colorAttachments[slot.index] ?? null;
        }

        if (slot.kind === 'depth') {
            return this.#depthAttachment;
        }

        if (slot.kind === 'stencil') {
            return this.#stencilAttachment;
        }

        return this.#depthStencilAttachment;
    };

    #updateAttachmentReferences = (
        attachment: GLAttachment,
        resource: ITexture | IRenderbuffer | null
    ): void => {
        const slot = resolveAttachmentSlot(this.#gl, attachment);

        if (slot === null) {
            return;
        }

        if (slot.kind === 'color') {
            while (this.#colorAttachments.length <= slot.index) {
                this.#colorAttachments.push(null);
            }

            this.#colorAttachments[slot.index] = resource as ITexture | null;
            return;
        }

        if (slot.kind === 'depth') {
            this.#depthAttachment = resource;
            return;
        }

        if (slot.kind === 'stencil') {
            this.#stencilAttachment = resource;
            return;
        }

        this.#depthStencilAttachment = resource;
    };

    #throwIfDisposed = (): void => {
        this._disposal.assertAlive(
            (name) => new FramebufferError(`${name} has been disposed`, 'FRAMEBUFFER_ALREADY_DISPOSED'),
            'Framebuffer'
        );
    };
}
