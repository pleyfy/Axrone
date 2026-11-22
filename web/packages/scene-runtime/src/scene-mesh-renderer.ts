/**
 * Fine-grained `MeshRenderer` entry.
 *
 * Lean 3D entries import the renderer from here instead of the
 * `scene-3d-support` barrel, which also re-exports particles, line, trail,
 * billboard, terrain and lighting components.
 */
export * from './components/mesh-renderer';
