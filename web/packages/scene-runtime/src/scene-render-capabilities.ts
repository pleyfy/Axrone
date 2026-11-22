import { getComponentMetadata, type ComponentConstructor } from '@axrone/ecs-runtime';

/**
 * Rendering families a scene can actually produce, derived from the component
 * registry that was resolved for the scene profile.
 *
 * A 2D scene's registry has no mesh renderer, light, particle, line or
 * billboard components, so every per-frame scan those renderers perform over
 * the actor list is provably empty work. Detecting that once at construction
 * keeps the hot path free of per-actor component probes.
 *
 * Detection is deliberately conservative: it matches registered components by
 * their script metadata name, so a custom registry that re-keys a built-in
 * class (or wraps it with an identically named class) still keeps the family
 * enabled. Only a registry that genuinely lacks the family disables it.
 */
export interface SceneRenderCapabilities {
    readonly meshRenderers: boolean;
    readonly lights: boolean;
    readonly sprites: boolean;
    readonly particles: boolean;
    readonly lines: boolean;
    readonly billboards: boolean;
}

export const SCENE_RENDER_CAPABILITIES_ALL: SceneRenderCapabilities = Object.freeze({
    meshRenderers: true,
    lights: true,
    sprites: true,
    particles: true,
    lines: true,
    billboards: true,
});

const MESH_RENDERER_NAMES: ReadonlySet<string> = new Set(['MeshRenderer']);
const LIGHT_NAMES: ReadonlySet<string> = new Set([
    'DirectionalLight',
    'PointLight',
    'SpotLight',
    'AreaLight',
]);
const SPRITE_NAMES: ReadonlySet<string> = new Set(['SpriteRenderer', 'SpriteAnimator']);
const PARTICLE_NAMES: ReadonlySet<string> = new Set(['ParticleSystem']);
const LINE_NAMES: ReadonlySet<string> = new Set(['LineRenderer', 'TrailRenderer']);
const BILLBOARD_NAMES: ReadonlySet<string> = new Set(['BillboardRenderer']);

const matchesAny = (scriptName: string | undefined, names: ReadonlySet<string>): boolean =>
    scriptName !== undefined && names.has(scriptName);

const matchesComponent = (
    component: ComponentConstructor,
    names: ReadonlySet<string>
): boolean =>
    matchesAny(getComponentMetadata(component)?.scriptName, names) ||
    matchesAny((component as { name?: string }).name, names);

export const resolveSceneRenderCapabilities = (
    registry: Readonly<Record<string, unknown>> | undefined
): SceneRenderCapabilities => {
    if (!registry) {
        return SCENE_RENDER_CAPABILITIES_ALL;
    }

    let meshRenderers = false;
    let lights = false;
    let sprites = false;
    let particles = false;
    let lines = false;
    let billboards = false;

    for (const key of Object.keys(registry)) {
        const component = registry[key];
        if (typeof component !== 'function') {
            continue;
        }

        const componentType = component as ComponentConstructor;

        if (!meshRenderers && matchesComponent(componentType, MESH_RENDERER_NAMES)) {
            meshRenderers = true;
            continue;
        }
        if (!lights && matchesComponent(componentType, LIGHT_NAMES)) {
            lights = true;
            continue;
        }
        if (!sprites && matchesComponent(componentType, SPRITE_NAMES)) {
            sprites = true;
            continue;
        }
        if (!particles && matchesComponent(componentType, PARTICLE_NAMES)) {
            particles = true;
            continue;
        }
        if (!lines && matchesComponent(componentType, LINE_NAMES)) {
            lines = true;
            continue;
        }
        if (!billboards && matchesComponent(componentType, BILLBOARD_NAMES)) {
            billboards = true;
        }
    }

    return Object.freeze({
        meshRenderers,
        lights,
        sprites,
        particles,
        lines,
        billboards,
    });
};
