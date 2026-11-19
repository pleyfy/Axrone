import type { SceneRenderPassDefinition } from '../types';

export const SCENE_FRAMEBUFFER_RENDERER_PASS_ID = 'framebuffer';

export const REFRACTION_COPY_PASS_ID = 'refraction-copy';
export const SSS_BLUR_PASS_ID = 'sss-blur';

export const SCENE_COLOR_COPY_TEXTURE_ID = 'scene:framebuffer-scene-color-copy';
export const SSS_BLUR_TEXTURE_ID = 'scene:framebuffer-sss-blur';

export const SCENE_COLOR_COPY_UNIFORM_NAME = '_SceneColorTexture';
export const SSS_BLUR_UNIFORM_NAME = '_SubsurfaceBlurTexture';

export type SceneFramebufferPassId = 'refraction-copy' | 'sss-blur';

export interface SceneFramebufferPassDefinition extends SceneRenderPassDefinition {
    readonly id: SceneFramebufferPassId;
    readonly targetTextureId: string;
    readonly samplerUniformName: string;
    readonly dependsOn: readonly SceneFramebufferPassId[];
    readonly operation: 'copy' | 'blur';
}

const REFRACTION_COPY_PASS: SceneFramebufferPassDefinition = Object.freeze({
    id: 'refraction-copy' as const,
    order: 10,
    enabled: true,
    rendererPassId: SCENE_FRAMEBUFFER_RENDERER_PASS_ID,
    materialPassId: REFRACTION_COPY_PASS_ID,
    clearFlags: [] as const,
    clearColor: null,
    clearDepth: null,
    depthTest: false,
    cull: false,
    blend: false,
    targetTextureId: SCENE_COLOR_COPY_TEXTURE_ID,
    samplerUniformName: SCENE_COLOR_COPY_UNIFORM_NAME,
    dependsOn: [] as const,
    operation: 'copy' as const,
});

const SSS_BLUR_PASS: SceneFramebufferPassDefinition = Object.freeze({
    id: 'sss-blur' as const,
    order: 20,
    enabled: true,
    rendererPassId: SCENE_FRAMEBUFFER_RENDERER_PASS_ID,
    materialPassId: SSS_BLUR_PASS_ID,
    // The filter covers every texel of the target, so a clear would only cost
    // bandwidth.
    clearFlags: [] as const,
    clearColor: null,
    clearDepth: null,
    depthTest: false,
    cull: false,
    blend: false,
    targetTextureId: SSS_BLUR_TEXTURE_ID,
    samplerUniformName: SSS_BLUR_UNIFORM_NAME,
    dependsOn: ['refraction-copy'] as const,
    operation: 'blur' as const,
});

const PASS_BY_ID: ReadonlyMap<string, SceneFramebufferPassDefinition> = new Map<
    SceneFramebufferPassId,
    SceneFramebufferPassDefinition
>( [
    [REFRACTION_COPY_PASS_ID, REFRACTION_COPY_PASS],
    [SSS_BLUR_PASS_ID, SSS_BLUR_PASS],
]);

const EMPTY_PLAN: readonly SceneFramebufferPassDefinition[] = Object.freeze([]);
export const SCENE_FRAMEBUFFER_EMPTY_PLAN = EMPTY_PLAN;

export const SCENE_FRAMEBUFFER_PASS_DEFINITIONS: readonly SceneFramebufferPassDefinition[] =
    Object.freeze([REFRACTION_COPY_PASS, SSS_BLUR_PASS]);

export const isSceneFramebufferPassId = (id: string | null | undefined): id is SceneFramebufferPassId =>
    id === REFRACTION_COPY_PASS_ID || id === SSS_BLUR_PASS_ID;

const hasPassId = (
    source: ReadonlySet<string> | readonly string[] | undefined,
    id: string
): boolean => {
    if (!source) {
        return false;
    }

    if (typeof (source as ReadonlySet<string>).has === 'function') {
        return (source as ReadonlySet<string>).has(id);
    }

    const ids = source as readonly string[];
    for (let index = 0; index < ids.length; index += 1) {
        if (ids[index] === id) {
            return true;
        }
    }

    return false;
};

/**
 * Turns the optional material passes a frame declares into the offscreen
 * framebuffer passes that have to run for them, resolving dependencies and
 * keeping declaration order stable so a frame replay is deterministic.
 *
 * `sss-blur` samples the scene-color copy, so requesting it pulls in
 * `refraction-copy`; the reverse never happens. A frame whose materials carry
 * neither gate gets an empty plan and therefore zero extra GL work.
 *
 * The three possible plans are module constants: scheduling a frame must never
 * allocate.
 */
const PLAN_EMPTY: readonly SceneFramebufferPassDefinition[] = EMPTY_PLAN;
const PLAN_REFRACTION_ONLY: readonly SceneFramebufferPassDefinition[] = Object.freeze([
    REFRACTION_COPY_PASS,
]);
const PLAN_COPY_AND_BLUR: readonly SceneFramebufferPassDefinition[] = Object.freeze([
    REFRACTION_COPY_PASS,
    SSS_BLUR_PASS,
]);

export const planSceneFramebufferPasses = (
    materialPassIds: ReadonlySet<string> | readonly string[] | undefined
): readonly SceneFramebufferPassDefinition[] => {
    if (!hasPassId(materialPassIds, REFRACTION_COPY_PASS_ID) && !hasPassId(materialPassIds, SSS_BLUR_PASS_ID)) {
        return PLAN_EMPTY;
    }

    return hasPassId(materialPassIds, SSS_BLUR_PASS_ID) ? PLAN_COPY_AND_BLUR : PLAN_REFRACTION_ONLY;
};

export const getSceneFramebufferPassDefinition = (
    id: string
): SceneFramebufferPassDefinition | null => PASS_BY_ID.get(id) ?? null;

export const toSceneRenderPassDefinitions = (
    plan: readonly SceneFramebufferPassDefinition[]
): readonly SceneRenderPassDefinition[] => plan;
