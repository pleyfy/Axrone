import { describe, expect, it, vi } from 'vitest';
import { Mat4, Vec3 } from '@axrone/numeric';
import { MeshRenderer } from '../components/mesh-renderer';
import type { SceneCameraFrameState } from '../camera-frame-state';
import type { SceneLightingState } from '../lighting-collector';
import type { SceneMaterialResource } from '../material-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneDrawExecutorContext } from '../rendering/draw-executor';
import { SceneDrawExecutor } from '../rendering/draw-executor';
import { SceneRenderFrameState } from '../rendering/render-frame-state';
import type { SceneRenderPassResource } from '../rendering/render-pass-registry';
import type { SceneMaterialPassDefinition } from '../types';

const TOON_SHADER_ID = 'gltf/toon';
const OUTLINE_SHADER_ID = 'gltf/toon-outline';

const createShader = (id: string): SceneShaderResource =>
    ({
        id,
        program: { id } as unknown as WebGLProgram,
        uniformLocations: new Map([['u_Model', { name: 'u_Model' }]]),
        uniformTypes: new Map(),
        uniformNames: ['u_Model'],
        attributeNames: { position: 'a_Position' },
        depthTest: true,
        cull: true,
        blend: false,
    }) as unknown as SceneShaderResource;

const createMesh = (): SceneMeshResource =>
    ({
        id: 'mesh:box',
        vertexArray: { id: 'vao' },
        mode: 0x0004,
        topology: 'triangles',
        indexBuffer: { id: 'ibo' },
        indexType: 0x1405,
        indexCount: 36,
        vertexCount: 24,
    }) as unknown as SceneMeshResource;

const createMaterial = (passes: readonly SceneMaterialPassDefinition[]): SceneMaterialResource =>
    ({
        id: 'material:toon',
        shaderId: TOON_SHADER_ID,
        uniforms: new Map(),
        textureBindings: new Map(),
        surface: { shadingModel: 'toon', alphaMode: 'opaque' },
        passes,
        keywords: new Map(),
    }) as unknown as SceneMaterialResource;

const createRenderPass = (
    id: string,
    materialPassId: string | null
): SceneRenderPassResource =>
    ({
        id,
        order: materialPassId === null ? 0 : 1,
        rendererPassId: 'main',
        materialPassId,
        enabled: true,
        clearFlags: [],
        clearColor: null,
        clearDepth: null,
    }) as unknown as SceneRenderPassResource;

const createContext = (
    renderPass: SceneRenderPassResource,
    frame: number
): SceneDrawExecutorContext => {
    const cameraFrame = {
        camera: { id: 'camera', near: 0.1, far: 100 },
        viewMatrix: new Mat4(),
        projectionMatrix: new Mat4(),
        viewProjectionMatrix: new Mat4(),
        position: new Vec3(0, 0, 1),
        camera3D: { frustum: {} },
    } as unknown as SceneCameraFrameState;
    const lighting = {
        stats: {
            selectedDirectionalCount: 0,
            selectedPointCount: 0,
            selectedSpotCount: 0,
            selectedLocalLightCount: 0,
        },
    } as unknown as SceneLightingState;

    return {
        renderPass,
        cameraFrame,
        lighting,
        lightingValues: {},
        fog: { enabled: false } as SceneDrawExecutorContext['fog'],
        elapsedSeconds: 1,
        deltaSeconds: 1 / 60,
        frame,
        viewportWidth: 800,
        viewportHeight: 600,
    };
};

const createHarness = (options: {
    readonly passes: readonly SceneMaterialPassDefinition[];
    readonly variantResolver?: {
        resolve(shaderId: string, keywords: readonly string[]): SceneShaderResource | undefined;
    };
}) => {
    const mesh = createMesh();
    const material = createMaterial(options.passes);
    const toonShader = createShader(TOON_SHADER_ID);
    const outlineShader = createShader(OUTLINE_SHADER_ID);
    const shaders = new Map([
        [toonShader.id, toonShader],
        [outlineShader.id, outlineShader],
    ]);
    const useProgram = vi.fn();
    const gl = {
        drawElements: vi.fn(),
        drawArrays: vi.fn(),
        useProgram,
        bindVertexArray: vi.fn(),
        TRIANGLES: 0x0004,
    } as unknown as WebGL2RenderingContext;
    const apply = vi.fn();
    const resolvePrimitiveMode = vi.fn(() => gl.TRIANGLES);
    const get = vi.fn((id: string) => shaders.get(id));

    const executor = new SceneDrawExecutor({
        gl,
        resources: {
            materials: {
                get: () => material,
                getTextureSlots: () => [],
            },
            meshes: {
                get: () => mesh,
                getDefinition: () => undefined,
            },
            shaders: { get },
            textures: { get: () => undefined },
            resolveSampler: () => ({ bind: vi.fn() }),
        },
        morphMeshRuntime: { resolve: () => mesh },
        renderStateApplier: {
            apply,
            resolvePrimitiveMode,
            resolvePrimitiveTopology: () => 'triangles',
        },
        frameUniformBinder: { apply: vi.fn() },
        lightingUniformBinder: { apply: vi.fn() },
        fogUniformBinder: { apply: vi.fn() },
        skinningUniformBinder: { apply: vi.fn() },
        materialTextureBinder: { bind: vi.fn(() => []), unbind: vi.fn() },
        uniformWriter: { write: vi.fn() },
        textureUniformSetter: vi.fn(),
        applyMissingVertexAttributeDefaults: vi.fn(),
        ...(options.variantResolver ? { variantResolver: options.variantResolver } : {}),
    } as unknown as ConstructorParameters<typeof SceneDrawExecutor>[0]);

    const renderer = new MeshRenderer({ meshId: mesh.id, materialId: material.id });
    const item = {
        transform: { worldMatrix: new Mat4() },
        renderer,
    } as unknown as Parameters<SceneDrawExecutor['execute']>[0];

    // `useProgram` receives the resolved program object; its `id` names the shader.
    const programsFor = (): string[] =>
        useProgram.mock.calls.map((call) => (call[0] as { id: string }).id);

    return {
        executor,
        item,
        mesh,
        material,
        toonShader,
        outlineShader,
        mainPass: createRenderPass('main', null),
        outlinePass: createRenderPass('outline', 'outline'),
        shadowPass: createRenderPass('shadow', 'main'),
        programsFor,
        apply,
        get,
        drawElements: gl.drawElements as unknown as { mock: { calls: unknown[][] } },
    };
};

describe('SceneDrawExecutor pass-level shader selection', () => {
    it('binds the outline program for a pass that overrides the shader', () => {
        const harness = createHarness({
            passes: [
                { id: 'main' },
                {
                    id: 'outline',
                    shaderId: OUTLINE_SHADER_ID,
                    rasterizerState: { cullMode: 'front' },
                },
            ],
        });

        harness.executor.execute(harness.item, createContext(harness.mainPass, 1), new SceneRenderFrameState().begin(1));
        expect(harness.programsFor()).toEqual([TOON_SHADER_ID]);

        harness.executor.execute(
            harness.item,
            createContext(harness.outlinePass, 1),
            new SceneRenderFrameState().begin(1)
        );
        expect(harness.programsFor()).toEqual([TOON_SHADER_ID, OUTLINE_SHADER_ID]);
        // The outline pass forwards its own pass definition, including the override.
        expect(harness.apply).toHaveBeenLastCalledWith(
            harness.outlineShader,
            harness.outlinePass,
            expect.objectContaining({ id: 'outline', shaderId: OUTLINE_SHADER_ID })
        );
    });

    it('re-resolves the program when the same pass identity returns with a different override', () => {
        const harness = createHarness({
            passes: [
                { id: 'main' },
                { id: 'outline', shaderId: OUTLINE_SHADER_ID },
                { id: 'shadow' },
            ],
        });
        const frameState = new SceneRenderFrameState().begin(1);
        const context = createContext(harness.shadowPass, 1);

        // Passes without an override keep sharing the material program even when
        // they resolve a different pass object.
        harness.executor.execute(harness.item, context, frameState);
        harness.executor.execute(harness.item, context, frameState);
        expect(harness.programsFor()).toEqual([TOON_SHADER_ID]);
        expect(harness.drawElements.mock.calls).toHaveLength(2);

        // A pass whose override differs must never reuse the cached program.
        harness.executor.execute(
            harness.item,
            createContext(harness.outlinePass, 1),
            frameState
        );
        harness.executor.execute(harness.item, context, frameState);
        expect(harness.programsFor()).toEqual([TOON_SHADER_ID, OUTLINE_SHADER_ID, TOON_SHADER_ID]);
    });

    it('falls back to the material shader when the declared pass is absent', () => {
        const harness = createHarness({ passes: [{ id: 'main' }] });
        const frameState = new SceneRenderFrameState().begin(1);

        harness.executor.execute(harness.item, createContext(harness.outlinePass, 1), frameState);
        expect(harness.programsFor()).toEqual([]);
        expect(harness.drawElements.mock.calls).toHaveLength(0);

        harness.executor.execute(harness.item, createContext(harness.mainPass, 1), frameState);
        expect(harness.programsFor()).toEqual([TOON_SHADER_ID]);
    });

    it('resolves keyword variants through the overridden shader id', () => {
        const variantShader = createShader(`${OUTLINE_SHADER_ID}#FOG`);
        const resolve = vi.fn((shaderId: string) =>
            shaderId === OUTLINE_SHADER_ID ? variantShader : undefined
        );
        const harness = createHarness({
            passes: [
                { id: 'main' },
                { id: 'outline', shaderId: OUTLINE_SHADER_ID },
            ],
            variantResolver: { resolve },
        });
        harness.material.keywords.set('FOG', { enabled: true, source: 'explicit' });
        const frameState = new SceneRenderFrameState().begin(1);

        harness.executor.execute(
            harness.item,
            createContext(
                { ...harness.outlinePass, materialPassId: 'outline' } as SceneRenderPassResource,
                1
            ),
            frameState
        );

        expect(resolve).toHaveBeenCalledWith(OUTLINE_SHADER_ID, ['FOG']);
        expect(harness.programsFor()).toEqual([variantShader.id]);
    });
});
