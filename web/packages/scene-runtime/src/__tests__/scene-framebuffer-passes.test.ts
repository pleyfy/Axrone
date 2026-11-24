import { describe, expect, it } from 'vitest';
import {
    planSceneFramebufferPasses,
    isSceneFramebufferPassId,
    getSceneFramebufferPassDefinition,
    REFRACTION_COPY_PASS_ID,
    SSS_BLUR_PASS_ID,
    SCENE_FRAMEBUFFER_PASS_DEFINITIONS,
    SCENE_FRAMEBUFFER_RENDERER_PASS_ID,
    SCENE_COLOR_COPY_TEXTURE_ID,
    SSS_BLUR_TEXTURE_ID,
} from '../rendering/scene-framebuffer-passes';

describe('scene framebuffer pass planning', () => {
    it('schedules nothing for a frame without gated materials', () => {
        expect(planSceneFramebufferPasses(undefined)).toEqual([]);
        expect(planSceneFramebufferPasses([])).toEqual([]);
        expect(planSceneFramebufferPasses(['main', 'forward-add', 'shadow-caster', 'outline'])).toEqual(
            []
        );
    });

    it('schedules only the scene-colour copy for transmission', () => {
        const plan = planSceneFramebufferPasses([REFRACTION_COPY_PASS_ID]);
        expect(plan.map((pass) => pass.id)).toEqual([REFRACTION_COPY_PASS_ID]);
        expect(plan[0]?.operation).toBe('copy');
        expect(plan[0]?.targetTextureId).toBe(SCENE_COLOR_COPY_TEXTURE_ID);
    });

    it('pulls the scene-colour copy in as the blur source dependency', () => {
        const plan = planSceneFramebufferPasses([SSS_BLUR_PASS_ID]);
        expect(plan.map((pass) => pass.id)).toEqual([REFRACTION_COPY_PASS_ID, SSS_BLUR_PASS_ID]);
        expect(plan[1]?.operation).toBe('blur');
        expect(plan[1]?.targetTextureId).toBe(SSS_BLUR_TEXTURE_ID);
        expect(plan[1]?.dependsOn).toEqual([REFRACTION_COPY_PASS_ID]);
    });

    it('keeps copy before blur for both gates and accepts a set as input', () => {
        const fromList = planSceneFramebufferPasses([SSS_BLUR_PASS_ID, REFRACTION_COPY_PASS_ID]);
        const fromSet = planSceneFramebufferPasses(
            new Set<string>([SSS_BLUR_PASS_ID, REFRACTION_COPY_PASS_ID, 'main'])
        );
        expect(fromList.map((pass) => pass.id)).toEqual([
            REFRACTION_COPY_PASS_ID,
            SSS_BLUR_PASS_ID,
        ]);
        expect(fromSet.map((pass) => pass.id)).toEqual(fromList.map((pass) => pass.id));
        expect(fromList.map((pass) => pass.order)).toEqual([10, 20]);
    });

    it('reuses frozen plans so scheduling never allocates per frame', () => {
        const first = planSceneFramebufferPasses([REFRACTION_COPY_PASS_ID, SSS_BLUR_PASS_ID]);
        const second = planSceneFramebufferPasses(['sss-blur', 'refraction-copy']);
        expect(second).toBe(first);
        expect(Object.isFrozen(first)).toBe(true);
        expect(planSceneFramebufferPasses([])).toBe(planSceneFramebufferPasses(undefined));
    });

    it('keeps the offscreen passes off the entity draw path', () => {
        // No MeshRenderer publishes this pass id, so the render-item collector
        // finds zero primitives: the offscreen work can never re-draw or
        // re-blend opaque or non-transmissive geometry.
        for (const pass of SCENE_FRAMEBUFFER_PASS_DEFINITIONS) {
            expect(pass.rendererPassId).toBe(SCENE_FRAMEBUFFER_RENDERER_PASS_ID);
            expect(pass.materialPassId).toBe(pass.id);
            expect(pass.rendererPassId).not.toBe('main');
            expect(pass.depthTest).toBe(false);
            expect(pass.blend).toBe(false);
            expect(pass.enabled).toBe(true);
            // Neither pass clears: the copy is a blit and the filter covers
            // every texel, so a clear would only burn bandwidth.
            expect(pass.clearFlags).toEqual([]);
            expect(pass.clearColor).toBeNull();
        }
    });

    it('recognises only the two offscreen pass ids', () => {
        expect(isSceneFramebufferPassId(REFRACTION_COPY_PASS_ID)).toBe(true);
        expect(isSceneFramebufferPassId(SSS_BLUR_PASS_ID)).toBe(true);
        expect(isSceneFramebufferPassId('outline')).toBe(false);
        expect(isSceneFramebufferPassId('volume-raymarch')).toBe(false);
        expect(isSceneFramebufferPassId(null)).toBe(false);
        expect(isSceneFramebufferPassId(undefined)).toBe(false);
        expect(getSceneFramebufferPassDefinition(SSS_BLUR_PASS_ID)?.id).toBe(SSS_BLUR_PASS_ID);
        expect(getSceneFramebufferPassDefinition('shadow-caster')).toBeNull();
    });
});
