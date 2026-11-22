import { describe, expect, it, vi } from 'vitest';
import { Mat4, Vec3 } from '@axrone/numeric';
import { MeshRenderer } from '../components/mesh-renderer';
import type { SceneCameraFrameState } from '../camera-frame-state';
import type { SceneLightingState } from '../lighting-collector';
import type { SceneMaterialResource } from '../material-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneDrawExecutorContext } from '../rendering/draw-executor';
import { SceneDrawExecutor } from '../rendering/draw-executor';
import { SceneRenderFrameState } from '../rendering/render-frame-state';
import type { SceneRenderPassResource } from '../rendering/render-pass-registry';
import type { SceneShaderResource } from '../shader-registry';

const createShader = (uniformNames: readonly string[]): SceneShaderResource => ({
    id: 'shader:test',
    program: { id: 1 } as unknown as WebGLProgram,
    uniformLocations: new Map(
        uniformNames.map((name, index) => [name, { name, index } as unknown as WebGLUniformLocation])
    ),
    uniformTypes: new Map(),
    uniformNames,
    attributeNames: {
        position: 'a_Position',
        normal: 'a_Normal',
        uv0: 'a_UV0',
        uv1: 'a_UV1',
        tangent: 'a_Tangent',
        color0: 'a_Color',
        joints0: 'a_Joints',
        weights0: 'a_Weights',
    },
    depthTest: true,
    cull: true,
    blend: false,
}) as unknown as SceneShaderResource;

const createMesh = (): SceneMeshResource =>
    ({
        vertexArray: { id: 'vao' },
        mode: 0x0004,
        topology: 'triangles',
        indexBuffer: { id: 'ibo' },
        indexType: 0x1405,
        indexCount: 36,
        vertexCount: 24,
    }) as unknown as SceneMeshResource;

const createMaterial = (textured: boolean): SceneMaterialResource =>
    ({
        id: 'material:test',
        shaderId: 'shader:test',
        uniforms: new Map(),
        textureBindings: new Map(
            textured
                ? [['u_Texture', { textureId: 'texture:1', samplerId: null }]]
                : []
        ),
        surface: null,
        passes: [],
        keywords: new Map(),
    }) as unknown as SceneMaterialResource;

const createRenderer = (receiveLighting: boolean): MeshRenderer => {
    const renderer = new MeshRenderer({ meshId: 'mesh:test', materialId: 'material:test' });
    renderer.receiveLighting = receiveLighting;
    return renderer;
};

const createContext = (frame: number): SceneDrawExecutorContext => {
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
        renderPass: {
            id: 'main',
            rendererPassId: 'main',
            materialPassId: null,
        } as unknown as SceneRenderPassResource,
        cameraFrame,
        lighting,
        lightingValues: {} as SceneDrawExecutorContext['lightingValues'],
        fog: { enabled: false } as SceneDrawExecutorContext['fog'],
        elapsedSeconds: 1,
        deltaSeconds: 1 / 60,
        frame,
        viewportWidth: 800,
        viewportHeight: 600,
    };
};

const createHarness = (options: {
    uniforms?: readonly string[];
    textured?: boolean;
}) => {
    const shader = createShader(
        options.uniforms ?? [
            'u_Model',
            'u_View',
            'u_Projection',
            'u_ViewProjection',
            'u_MVP',
            'u_Time',
            'u_Resolution',
        ]
    );
    const mesh = createMesh();
    const material = createMaterial(options.textured ?? false);
    const drawElements = vi.fn();
    const gl = {
        drawElements,
        useProgram: vi.fn(),
        bindVertexArray: vi.fn(),
        TRIANGLES: 0x0004,
    } as unknown as WebGL2RenderingContext;
    const write = vi.fn();
    const frameUniformApply = vi.fn();
    const lightingApply = vi.fn();
    const fogApply = vi.fn();
    const skinningApply = vi.fn();
    const bindTextures = vi.fn(() => (options.textured ? [0] : []));
    const unbindTextures = vi.fn();

    const executor = new SceneDrawExecutor({
        gl,
        resources: {
            materials: {
                get: (id: string) =>
                    id === material.id ? material : undefined,
                getTextureSlots: () =>
                    options.textured
                        ? [
                              {
                                  uniformName: 'u_Texture',
                                  binding: { textureId: 'texture:1', samplerId: null },
                                  resolvedUnit: 0,
                              },
                          ]
                        : [],
            },
            meshes: {
                get: () => mesh,
                getDefinition: () => undefined,
            },
            shaders: {
                get: (id: string) => (id === shader.id ? shader : undefined),
            },
            textures: {
                get: () => undefined,
            },
            resolveSampler: () => ({ bind: vi.fn() }),
        },
        morphMeshRuntime: {
            resolve: () => mesh,
        },
        renderStateApplier: {
            apply: vi.fn(),
            resolvePrimitiveMode: () => gl.TRIANGLES,
            resolvePrimitiveTopology: () => 'triangles',
        },
        frameUniformBinder: { apply: frameUniformApply },
        lightingUniformBinder: { apply: lightingApply },
        fogUniformBinder: { apply: fogApply },
        skinningUniformBinder: { apply: skinningApply },
        materialTextureBinder: { bind: bindTextures, unbind: unbindTextures },
        uniformWriter: { write },
        textureUniformSetter: vi.fn(),
        applyMissingVertexAttributeDefaults: vi.fn(),
    } as unknown as ConstructorParameters<typeof SceneDrawExecutor>[0]);

    const hash = (name: string): number =>
        write.mock.calls.filter((call) => call[1] === name).length;
    const hashModelWrites = (): number => hash('u_Model');

    return {
        executor,
        material,
        drawElements,
        write,
        frameUniformApply,
        lightingApply,
        fogApply,
        skinningApply,
        bindTextures,
        unbindTextures,
        hash,
        hashModelWrites,
    };
};

const createItem = (renderer: MeshRenderer) =>
    ({
        transform: { worldMatrix: new Mat4() },
        renderer,
    }) as unknown as Parameters<SceneDrawExecutor['execute']>[0];

describe('SceneDrawExecutor uniform caching', () => {
    it('writes frame and lighting uniforms once per shader per frame', () => {
        const harness = createHarness({});
        const frameState = new SceneRenderFrameState().begin(1);
        const context = createContext(1);
        const renderer = createRenderer(true);

        harness.executor.execute(createItem(renderer), context, frameState);
        harness.executor.execute(createItem(renderer), context, frameState);
        harness.executor.execute(createItem(renderer), context, frameState);

        expect(harness.drawElements).toHaveBeenCalledTimes(3);
        expect(harness.frameUniformApply).toHaveBeenCalledTimes(1);
        expect(harness.lightingApply).toHaveBeenCalledTimes(1);
        expect(harness.fogApply).toHaveBeenCalledTimes(1);
        // The first draw goes through the (mocked) full frame binder; every
        // later draw still refreshes the model matrix through the writer.
        expect(harness.hashModelWrites()).toBe(2);
        // The program declares u_MVP, so cached draws recompute it per item.
        expect(harness.hash('u_MVP')).toBe(2);
    });

    it('rewrites lighting when receiveLighting changes and again on a new frame', () => {
        const harness = createHarness({});
        const context = createContext(1);
        const litRenderer = createRenderer(true);
        const unlitRenderer = createRenderer(false);

        harness.executor.execute(
            createItem(litRenderer),
            context,
            new SceneRenderFrameState().begin(1)
        );
        harness.executor.execute(
            createItem(unlitRenderer),
            context,
            new SceneRenderFrameState().begin(1)
        );
        // Back to lit: the program currently holds the unlit variant.
        harness.executor.execute(
            createItem(litRenderer),
            context,
            new SceneRenderFrameState().begin(1)
        );
        expect(harness.lightingApply).toHaveBeenCalledTimes(3);

        harness.executor.execute(
            createItem(litRenderer),
            createContext(2),
            new SceneRenderFrameState().begin(2)
        );
        expect(harness.frameUniformApply).toHaveBeenCalledTimes(2);
        expect(harness.lightingApply).toHaveBeenCalledTimes(4);
    });

    it('skips skinning and texture binders when the shader/material cannot use them', () => {
        const harness = createHarness({ uniforms: ['u_Model', 'u_View', 'u_Projection'] });
        const frameState = new SceneRenderFrameState().begin(1);
        const context = createContext(1);
        const renderer = createRenderer(true);

        harness.executor.execute(createItem(renderer), context, frameState);
        harness.executor.execute(createItem(renderer), context, frameState);

        expect(harness.skinningApply).not.toHaveBeenCalled();
        expect(harness.bindTextures).not.toHaveBeenCalled();
        expect(harness.unbindTextures).not.toHaveBeenCalled();
    });

    it('keeps a texture binding across repeated draws and releases it on flush', () => {
        const harness = createHarness({ textured: true });
        const frameState = new SceneRenderFrameState().begin(1);
        const context = createContext(1);
        const renderer = createRenderer(true);

        harness.executor.execute(createItem(renderer), context, frameState);
        harness.executor.execute(createItem(renderer), context, frameState);

        // The second draw reuses the same material/texture/unit signature, so
        // the bind path is skipped entirely instead of rebinding per draw.
        expect(harness.bindTextures).toHaveBeenCalledTimes(1);
        expect(harness.unbindTextures).not.toHaveBeenCalled();

        harness.executor.flushTextureBindings();
        expect(harness.unbindTextures).toHaveBeenCalledTimes(1);

        // After a flush the next draw binds again.
        harness.executor.execute(createItem(renderer), context, frameState);
        expect(harness.bindTextures).toHaveBeenCalledTimes(2);
    });

    it('picks up texture bindings added to the material in place', () => {
        const harness = createHarness({ textured: true });
        harness.material.textureBindings.clear();
        const frameState = new SceneRenderFrameState().begin(1);
        const context = createContext(1);
        const renderer = createRenderer(true);

        harness.executor.execute(createItem(renderer), context, frameState);
        expect(harness.bindTextures).not.toHaveBeenCalled();

        // Registry mutators (setTexture) update the live map without
        // replacing the material resource object.
        harness.material.textureBindings.set('u_Texture', {
            textureId: 'texture:1',
            samplerId: null,
        } as never);

        harness.executor.execute(createItem(renderer), context, frameState);
        expect(harness.bindTextures).toHaveBeenCalledTimes(1);
        // The binding is retained until the pass flushes it.
        expect(harness.unbindTextures).not.toHaveBeenCalled();
        harness.executor.flushTextureBindings();
        expect(harness.unbindTextures).toHaveBeenCalledTimes(1);
    });

    it('runs the skinning binder when the shader declares skinning uniforms', () => {
        const harness = createHarness({ uniforms: ['u_Model', 'u_Skinning'] });
        const frameState = new SceneRenderFrameState().begin(1);
        const context = createContext(1);
        const renderer = createRenderer(true);

        harness.executor.execute(createItem(renderer), context, frameState);
        harness.executor.execute(createItem(renderer), context, frameState);

        expect(harness.skinningApply).toHaveBeenCalledTimes(2);
    });
});
