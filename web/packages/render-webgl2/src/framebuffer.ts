// Framebuffer public entry — delegates to the render-target/* modules.
//
// Re-exports are intentional and explicit: `export *` is never used for the
// errors module so this surface never re-declares `ErrorCode`, which would
// clash with the existing `ErrorCode` union in ./errors.ts. `ErrorCode` is
// therefore only available from the canonical `./render-target` subpath.
export * from './render-target/types';
export * from './render-target/interfaces';
export * from './render-target/format';
export * from './render-target/attachment';
export * from './render-target/texture';
export * from './render-target/renderbuffer';
export * from './render-target/framebuffer';
export * from './render-target/factory';
export * from './render-target/targets';
export { FramebufferError } from './render-target/errors';
