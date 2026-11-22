import type { ContextSource, IGLContext } from '../context';
import { resolveContext } from '../context';
import type { GLConstants } from '../context/types';
import { Framebuffer } from './framebuffer';
import type {
    FramebufferOptions,
    IFramebuffer,
    IFramebufferFactory,
    IRenderbuffer,
    ITexture,
    RenderbufferOptions,
    TextureOptions,
} from './interfaces';
import { Renderbuffer } from './renderbuffer';
import { Texture } from './texture';
import type { GLTextureFormat, GLTextureTarget } from './types';

export class FramebufferFactory implements IFramebufferFactory {
    readonly #ctx: IGLContext;
    readonly #gl: WebGL2RenderingContext;
    readonly #constants: GLConstants;

    constructor(source: ContextSource) {
        const ctx = resolveContext(source);
        this.#ctx = ctx;
        this.#gl = ctx.gl;
        this.#constants = ctx.constants;
    }

    public createTexture = (target: GLTextureTarget, options: TextureOptions): ITexture => {
        return new Texture(this.#ctx, target, options);
    };

    public createTexture2D = (options: TextureOptions): ITexture => {
        return this.createTexture(this.#gl.TEXTURE_2D, options);
    };

    public createTextureCube = (options: TextureOptions): ITexture => {
        return this.createTexture(this.#gl.TEXTURE_CUBE_MAP, options);
    };

    public createTexture2DArray = (options: TextureOptions & { depth: number }): ITexture => {
        return this.createTexture(this.#gl.TEXTURE_2D_ARRAY, options);
    };

    public createTexture3D = (options: TextureOptions & { depth: number }): ITexture => {
        return this.createTexture(this.#gl.TEXTURE_3D, options);
    };

    public createRenderbuffer = (options: RenderbufferOptions): IRenderbuffer => {
        return new Renderbuffer(this.#ctx, options);
    };

    public createFramebuffer = (options: FramebufferOptions): IFramebuffer => {
        return new Framebuffer(this.#ctx, options);
    };

    public createColorFramebuffer = (
        width: number,
        height: number,
        format: GLTextureFormat = this.#gl.RGBA8,
        samples: number = 0
    ): IFramebuffer => {
        const colorTexture = this.createTexture2D({
            width,
            height,
            internalFormat: format,
            samples,
            label: 'ColorFramebuffer_ColorAttachment',
        });

        return this.createFramebuffer({
            width,
            height,
            colorAttachments: [
                {
                    attachment: this.#gl.COLOR_ATTACHMENT0,
                    texture: colorTexture,
                },
            ],
            label: 'ColorFramebuffer',
        });
    };

    public createDepthFramebuffer = (
        width: number,
        height: number,
        format: GLTextureFormat = this.#gl.DEPTH_COMPONENT24,
        samples: number = 0
    ): IFramebuffer => {
        if (samples > 0) {
            const depthRenderbuffer = this.createRenderbuffer({
                width,
                height,
                internalFormat: format,
                samples,
                label: 'DepthFramebuffer_DepthAttachment',
            });

            return this.createFramebuffer({
                width,
                height,
                depthAttachment: {
                    attachment: this.#gl.DEPTH_ATTACHMENT,
                    renderbuffer: depthRenderbuffer,
                },
                label: 'DepthFramebuffer',
            });
        } else {
            const depthTexture = this.createTexture2D({
                width,
                height,
                internalFormat: format,
                minFilter: this.#gl.NEAREST,
                magFilter: this.#gl.NEAREST,
                label: 'DepthFramebuffer_DepthAttachment',
            });

            return this.createFramebuffer({
                width,
                height,
                depthAttachment: {
                    attachment: this.#gl.DEPTH_ATTACHMENT,
                    texture: depthTexture,
                },
                label: 'DepthFramebuffer',
            });
        }
    };

    public createFramebufferWithDepth = (
        width: number,
        height: number,
        colorFormat: GLTextureFormat = this.#gl.RGBA8,
        depthFormat: GLTextureFormat = this.#gl.DEPTH_COMPONENT24,
        samples: number = 0
    ): IFramebuffer => {
        const colorTexture = this.createTexture2D({
            width,
            height,
            internalFormat: colorFormat,
            samples,
            label: 'FramebufferWithDepth_ColorAttachment',
        });

        if (samples > 0) {
            const depthRenderbuffer = this.createRenderbuffer({
                width,
                height,
                internalFormat: depthFormat,
                samples,
                label: 'FramebufferWithDepth_DepthAttachment',
            });

            return this.createFramebuffer({
                width,
                height,
                colorAttachments: [
                    {
                        attachment: this.#gl.COLOR_ATTACHMENT0,
                        texture: colorTexture,
                    },
                ],
                depthAttachment: {
                    attachment: this.#gl.DEPTH_ATTACHMENT,
                    renderbuffer: depthRenderbuffer,
                },
                label: 'FramebufferWithDepth',
            });
        } else {
            const depthTexture = this.createTexture2D({
                width,
                height,
                internalFormat: depthFormat,
                minFilter: this.#gl.NEAREST,
                magFilter: this.#gl.NEAREST,
                label: 'FramebufferWithDepth_DepthAttachment',
            });

            return this.createFramebuffer({
                width,
                height,
                colorAttachments: [
                    {
                        attachment: this.#gl.COLOR_ATTACHMENT0,
                        texture: colorTexture,
                    },
                ],
                depthAttachment: {
                    attachment: this.#gl.DEPTH_ATTACHMENT,
                    texture: depthTexture,
                },
                label: 'FramebufferWithDepth',
            });
        }
    };
}
