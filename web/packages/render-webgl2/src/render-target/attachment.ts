import { FramebufferError } from './errors';
import type { AttachmentConfig } from './interfaces';
import type { FramebufferStatus, GLAttachment } from './types';

export type AttachmentSlot =
    | { readonly kind: 'color'; readonly index: number }
    | { readonly kind: 'depth' }
    | { readonly kind: 'stencil' }
    | { readonly kind: 'depth-stencil' };

export const resolveAttachmentSlot = (
    gl: WebGL2RenderingContext,
    attachment: GLAttachment
): AttachmentSlot | null => {
    if (attachment >= gl.COLOR_ATTACHMENT0 && attachment <= gl.COLOR_ATTACHMENT15) {
        return { kind: 'color', index: attachment - gl.COLOR_ATTACHMENT0 };
    }

    if (attachment === gl.DEPTH_ATTACHMENT) {
        return { kind: 'depth' };
    }

    if (attachment === gl.STENCIL_ATTACHMENT) {
        return { kind: 'stencil' };
    }

    if (attachment === gl.DEPTH_STENCIL_ATTACHMENT) {
        return { kind: 'depth-stencil' };
    }

    return null;
};

export const validateAttachmentConfig = (
    gl: WebGL2RenderingContext,
    config: AttachmentConfig
): void => {
    if (!config.texture && !config.renderbuffer) {
        throw new FramebufferError(
            'Attachment config must specify either texture or renderbuffer',
            'INVALID_ATTACHMENT'
        );
    }

    if (config.texture && config.renderbuffer) {
        throw new FramebufferError(
            'Attachment config cannot specify both texture and renderbuffer',
            'INVALID_ATTACHMENT'
        );
    }

    if (config.texture && config.texture.isDisposed) {
        throw new FramebufferError('Cannot attach disposed texture', 'TEXTURE_ALREADY_DISPOSED');
    }

    if (config.renderbuffer && config.renderbuffer.isDisposed) {
        throw new FramebufferError(
            'Cannot attach disposed renderbuffer',
            'RENDERBUFFER_ALREADY_DISPOSED'
        );
    }
};

export const getFramebufferStatusString = (
    gl: WebGL2RenderingContext,
    status: FramebufferStatus
): string => {
    switch (status) {
        case gl.FRAMEBUFFER_COMPLETE:
            return 'FRAMEBUFFER_COMPLETE';
        case gl.FRAMEBUFFER_INCOMPLETE_ATTACHMENT:
            return 'FRAMEBUFFER_INCOMPLETE_ATTACHMENT';
        case gl.FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT:
            return 'FRAMEBUFFER_INCOMPLETE_MISSING_ATTACHMENT';
        case gl.FRAMEBUFFER_INCOMPLETE_DIMENSIONS:
            return 'FRAMEBUFFER_INCOMPLETE_DIMENSIONS';
        case gl.FRAMEBUFFER_UNSUPPORTED:
            return 'FRAMEBUFFER_UNSUPPORTED';
        case gl.FRAMEBUFFER_INCOMPLETE_MULTISAMPLE:
            return 'FRAMEBUFFER_INCOMPLETE_MULTISAMPLE';
        default:
            return `UNKNOWN_STATUS_${status}`;
    }
};
