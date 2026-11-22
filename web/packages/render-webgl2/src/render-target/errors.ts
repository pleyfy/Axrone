export type ErrorCode =
    | 'INVALID_OPERATION'
    | 'FRAMEBUFFER_ALREADY_DISPOSED'
    | 'TEXTURE_ALREADY_DISPOSED'
    | 'RENDERBUFFER_ALREADY_DISPOSED'
    | 'OUT_OF_MEMORY'
    | 'INVALID_VALUE'
    | 'CONTEXT_LOST'
    | 'UNSUPPORTED_OPERATION'
    | 'INCOMPLETE_FRAMEBUFFER'
    | 'INVALID_ATTACHMENT'
    | 'ATTACHMENT_MISMATCH'
    | 'MAX_COLOR_ATTACHMENTS_EXCEEDED';

export class FramebufferError extends Error {
    constructor(
        public readonly message: string,
        public readonly code: ErrorCode,
        public readonly cause?: Error
    ) {
        super(`[WebGL2 Framebuffer] ${code}: ${message}`);
        Object.setPrototypeOf(this, new.target.prototype);
        (
            Error as typeof Error & { captureStackTrace?: (target: object, ctor: Function) => void }
        ).captureStackTrace?.(this, this.constructor);
    }
}
