/**
 * Fine-grained `SpriteRenderer` entry.
 *
 * Lean 2D entries import the sprite renderer from here instead of the
 * `scene-2d-support` barrel, which also re-exports sprite animation, masks and
 * the asset import pipeline.
 */
export * from './components/sprite-renderer';
