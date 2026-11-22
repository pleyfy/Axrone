import { describe, expect, it } from 'vitest';
import { MeshRenderer } from '../components/mesh-renderer';
import { PointLight } from '../components/point-light';
import { SpriteRenderer } from '../components/sprite-renderer';
import { createCoreSceneRegistry } from '../scene-core-registry';
import { create2DSceneRegistry } from '../scene-2d-registry';
import { create3DSceneRegistry } from '../scene-3d-registry';
import { createMixedSceneRegistry } from '../scene-mixed-registry';
import {
    resolveSceneRenderCapabilities,
    SCENE_RENDER_CAPABILITIES_ALL,
} from '../scene-render-capabilities';

describe('resolveSceneRenderCapabilities', () => {
    it('disables every 3D family for the 2D registry', () => {
        const capabilities = resolveSceneRenderCapabilities(create2DSceneRegistry());

        expect(capabilities).toEqual({
            meshRenderers: false,
            lights: false,
            sprites: true,
            particles: false,
            lines: false,
            billboards: false,
        });
    });

    it('enables mesh, light and effect families for the 3D registry', () => {
        const capabilities = resolveSceneRenderCapabilities(create3DSceneRegistry());

        expect(capabilities.meshRenderers).toBe(true);
        expect(capabilities.lights).toBe(true);
        expect(capabilities.particles).toBe(true);
        expect(capabilities.lines).toBe(true);
        expect(capabilities.billboards).toBe(true);
        expect(capabilities.sprites).toBe(false);
    });

    it('enables every family for the mixed registry', () => {
        const capabilities = resolveSceneRenderCapabilities(createMixedSceneRegistry());

        expect(capabilities).toEqual({
            meshRenderers: true,
            lights: true,
            sprites: true,
            particles: true,
            lines: true,
            billboards: true,
        });
    });

    it('keeps the full behaviour for the core registry (no render families)', () => {
        const capabilities = resolveSceneRenderCapabilities(createCoreSceneRegistry());

        expect(capabilities).toEqual({
            meshRenderers: false,
            lights: false,
            sprites: false,
            particles: false,
            lines: false,
            billboards: false,
        });
    });

    it('detects a built-in component registered under a custom key', () => {
        const capabilities = resolveSceneRenderCapabilities({
            HeroMesh: MeshRenderer,
            HeroLight: PointLight,
            HeroSprite: SpriteRenderer,
        });

        expect(capabilities.meshRenderers).toBe(true);
        expect(capabilities.lights).toBe(true);
        expect(capabilities.sprites).toBe(true);
    });

    it('falls back to the full behaviour when no registry is supplied', () => {
        expect(resolveSceneRenderCapabilities(undefined)).toBe(SCENE_RENDER_CAPABILITIES_ALL);
    });

    it('returns a frozen descriptor', () => {
        const capabilities = resolveSceneRenderCapabilities(create2DSceneRegistry());

        expect(Object.isFrozen(capabilities)).toBe(true);
    });
});
