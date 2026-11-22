/**
 * Fine-grained `Camera` entry.
 *
 * Exists so lean scene entries can import only the camera component instead of
 * the coarse `scene-facade` barrel, which also re-exports animation, UI and
 * animation-streaming surfaces. Additive: the root facade keeps its exports.
 */
export * from './components/camera';
