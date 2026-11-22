import type { Brand } from '@axrone/utility';

export type FramebufferId = Brand<WebGLFramebuffer, 'FramebufferId'>;
export type RenderbufferId = Brand<WebGLRenderbuffer, 'RenderbufferId'>;
export type TextureId = Brand<WebGLTexture, 'TextureId'>;

export type GLTextureTarget =
    | WebGL2RenderingContext['TEXTURE_2D']
    | WebGL2RenderingContext['TEXTURE_CUBE_MAP']
    | WebGL2RenderingContext['TEXTURE_2D_ARRAY']
    | WebGL2RenderingContext['TEXTURE_3D'];

export type GLTextureFormat =
    | WebGL2RenderingContext['RGB']
    | WebGL2RenderingContext['RGBA']
    | WebGL2RenderingContext['RGBA8']
    | WebGL2RenderingContext['RGBA16F']
    | WebGL2RenderingContext['RGBA32F']
    | WebGL2RenderingContext['RGB8']
    | WebGL2RenderingContext['RGB16F']
    | WebGL2RenderingContext['RGB32F']
    | WebGL2RenderingContext['R8']
    | WebGL2RenderingContext['R16F']
    | WebGL2RenderingContext['R32F']
    | WebGL2RenderingContext['RG8']
    | WebGL2RenderingContext['RG16F']
    | WebGL2RenderingContext['RG32F']
    | WebGL2RenderingContext['DEPTH_COMPONENT16']
    | WebGL2RenderingContext['DEPTH_COMPONENT24']
    | WebGL2RenderingContext['DEPTH_COMPONENT32F']
    | WebGL2RenderingContext['DEPTH24_STENCIL8']
    | WebGL2RenderingContext['DEPTH32F_STENCIL8'];

export type GLAttachment =
    | WebGL2RenderingContext['COLOR_ATTACHMENT0']
    | WebGL2RenderingContext['COLOR_ATTACHMENT1']
    | WebGL2RenderingContext['COLOR_ATTACHMENT2']
    | WebGL2RenderingContext['COLOR_ATTACHMENT3']
    | WebGL2RenderingContext['COLOR_ATTACHMENT4']
    | WebGL2RenderingContext['COLOR_ATTACHMENT5']
    | WebGL2RenderingContext['COLOR_ATTACHMENT6']
    | WebGL2RenderingContext['COLOR_ATTACHMENT7']
    | WebGL2RenderingContext['COLOR_ATTACHMENT8']
    | WebGL2RenderingContext['COLOR_ATTACHMENT9']
    | WebGL2RenderingContext['COLOR_ATTACHMENT10']
    | WebGL2RenderingContext['COLOR_ATTACHMENT11']
    | WebGL2RenderingContext['COLOR_ATTACHMENT12']
    | WebGL2RenderingContext['COLOR_ATTACHMENT13']
    | WebGL2RenderingContext['COLOR_ATTACHMENT14']
    | WebGL2RenderingContext['COLOR_ATTACHMENT15']
    | WebGL2RenderingContext['DEPTH_ATTACHMENT']
    | WebGL2RenderingContext['STENCIL_ATTACHMENT']
    | WebGL2RenderingContext['DEPTH_STENCIL_ATTACHMENT'];

export type GLFilterMode = WebGL2RenderingContext['NEAREST'] | WebGL2RenderingContext['LINEAR'];

export type GLWrapMode =
    | WebGL2RenderingContext['CLAMP_TO_EDGE']
    | WebGL2RenderingContext['REPEAT']
    | WebGL2RenderingContext['MIRRORED_REPEAT'];

export type FramebufferStatus =
    | WebGL2RenderingContext['FRAMEBUFFER_COMPLETE']
    | WebGL2RenderingContext['FRAMEBUFFER_INCOMPLETE_ATTACHMENT']
    | WebGL2RenderingContext['FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT']
    | WebGL2RenderingContext['FRAMEBUFFER_INCOMPLETE_DIMENSIONS']
    | WebGL2RenderingContext['FRAMEBUFFER_UNSUPPORTED']
    | WebGL2RenderingContext['FRAMEBUFFER_INCOMPLETE_MULTISAMPLE'];
