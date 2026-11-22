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

interface FakeSlot {
    readonly uniformName: string;
    readonly binding: { readonly textureId: string; readonly samplerId: string | null };
    readonly resolvedUnit: number;
}

const createShader = (): SceneShaderResource =>
    ({
        id: 'shader:test',
        program: { id: 1 },
        uniformLocations: new Map([
            ['u_Model', { name: 'u_Model' }],
            ['u_Color', { name: 'u_Color' }],
            ['u_Texture', { name: 'u_Texture' }],
        ]),
        uniformTypes: new Map(),
        uniformNames: ['u_Model', 'u_Color', 'u_Texture'],
        attributeNames: {
            position: 'a_Position',
            normal: 'a_Normal',
            uv0: 'a_UV0',
            uv1: 'a_UV1',
            tangent: 'a_Tangent',
            color0: 'a_Color0',
            joints0: 'a_Joints0',
            weights0: 'a_Weights0',
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

const createMaterial = (id: string, textureId: string | null): SceneMaterialResource => {
    const textureBindings = new Map<string, { textureId: string; samplerId: string | null }>();
    if (textureId) {
        textureBindings.set('u_Texture', { textureId, samplerId: null });
    }
    return {
        id,
        shaderId: 'shader:test',
        uniforms: new Map(),
        textureBindings,
        surface: null,
        passes: [],
        keywords: new Map(),
    } as unknown as SceneMaterialResource;
};

const createRenderer = (materialId: string): MeshRenderer => {
    const renderer = new MeshRenderer({ meshId: 'mesh:test', materialId });
    renderer.receiveLighting = true;
    return renderer;
};

const createContext = (): SceneDrawExecutorContext => {
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
        frame: 1,
        viewportWidth: 800,
        viewportHeight: 600,
    };
};

const createHarness = () => {
    const shader = createShader();
    const mesh = createMesh();
    const materials = new Map<string, SceneMaterialResource>([
        ['material:a', createMaterial('material:a', 'texture:a')],
        ['material:b', createMaterial('material:b', 'texture:b')],
        ['material:plain', createMaterial('material:plain', null)],
    ]);
    const slotLists = new Map<string, readonly FakeSlot[]>([
        [
            'material:a',
            Object.freeze([
                Object.freeze({
                    uniformName: 'u_Texture',
                    binding: Object.freeze({ textureId: 'texture:a', samplerId: null }),
                    resolvedUnit: 0,
                }),
            ]),
        ],
        [
            'material:b',
            Object.freeze([
                Object.freeze({
                    uniformName: 'u_Texture',
                    binding: Object.freeze({ textureId: 'texture:b', samplerId: null }),
                    resolvedUnit: 0,
                }),
            ]),
        ],
        ['material:plain', Object.freeze([])],
    ]);

    const bindTextures = vi.fn((_shader, material: SceneMaterialResource) =>
        (slotLists.get(material.id) ?? []).map((slot) => slot.resolvedUnit)
    );
    const unbindTextures = vi.fn();

    const executor = new SceneDrawExecutor({
        gl: {
            drawElements: vi.fn(),
            drawArrays: vi.fn(),
            useProgram: vi.fn(),
            bindVertexArray: vi.fn(),
            TRIANGLES: 0x0004,
        } as unknown as WebGL2RenderingContext,
        resources: {
            materials: {
                get: (id: string) => materials.get(id),
                getTextureSlots: (id: string) => slotLists.get(id) ?? Object.freeze([]),
            },
            meshes: { get: () => mesh, getDefinition: () => undefined },
            shaders: { get: () => shader },
            textures: { get: () => undefined },
            resolveSampler: () => ({ bind: vi.fn() }),
        },
        morphMeshRuntime: { resolve: () => mesh },
        renderStateApplier: {
            apply: vi.fn(),
            resolvePrimitiveMode: () => 0x0004,
            resolvePrimitiveTopology: () => 'triangles',
        },
        frameUniformBinder: { apply: vi.fn() },
        lightingUniformBinder: { apply: vi.fn() },
        fogUniformBinder: { apply: vi.fn() },
        skinningUniformBinder: { apply: vi.fn() },
        materialTextureBinder: { bind: bindTextures, unbind: unbindTextures },
        uniformWriter: { write: vi.fn() },
        textureUniformSetter: vi.fn(),
        applyMissingVertexAttributeDefaults: vi.fn(),
    } as unknown as ConstructorParameters<typeof SceneDrawExecutor>[0]);

    const frameState = new SceneRenderFrameState().begin(1);
    const context = createContext();
    const execute = (materialId: string): void => {
        executor.execute(
            { transform: { worldMatrix: new Mat4() }, renderer: createRenderer(materialId) },
            context,
            frameState
        );
    };

    return {
        executor,
        bindTextures,
        unbindTextures,
        slotLists,
        materials,
        execute,
    };
};

describe('SceneDrawExecutor texture binding cache', () => {
    it('binds once for repeated draws that share the same binding signature', () => {
        const harness = createHarness();

        harness.execute('material:a');
        harness.execute('material:a');
        harness.execute('material:a');

        expect(harness.bindTextures).toHaveBeenCalledTimes(1);
        expect(harness.unbindTextures).not.toHaveBeenCalled();
    });

    it('rebinds when the material changes and releases the previous units first', () => {
        const harness = createHarness();

        harness.execute('material:a');
        harness.execute('material:b');

        expect(harness.bindTextures).toHaveBeenCalledTimes(2);
        expect(harness.unbindTextures).toHaveBeenCalledTimes(1);
    });

    it('releases retained units before a draw without textures', () => {
        const harness = createHarness();

        harness.execute('material:a');
        harness.execute('material:plain');

        expect(harness.bindTextures).toHaveBeenCalledTimes(1);
        expect(harness.unbindTextures).toHaveBeenCalledTimes(1);
    });

    it('rebinds when a material slot list is rebuilt with a different texture', () => {
        const harness = createHarness();

        harness.execute('material:a');
        harness.slotLists.set(
            'material:a',
            Object.freeze([
                Object.freeze({
                    uniformName: 'u_Texture',
                    binding: Object.freeze({ textureId: 'texture:c', samplerId: null }),
                    resolvedUnit: 0,
                }),
            ])
        );
        harness.execute('material:a');

        expect(harness.bindTextures).toHaveBeenCalledTimes(2);
    });

    it('rebinds when the live texture binding map size changes', () => {
        const harness = createHarness();

        harness.execute('material:a');
        harness.materials.get('material:a')!.textureBindings.delete('u_Texture');
        harness.execute('material:a');

        // No textures remain: the retained units are released instead of being
        // reused, and no new bind happens.
        expect(harness.unbindTextures).toHaveBeenCalledTimes(1);
        expect(harness.bindTextures).toHaveBeenCalledTimes(1);
    });

    it('releases units and invalidates the signature on resetState', () => {
        const harness = createHarness();

        harness.execute('material:a');
        harness.executor.resetState();
        expect(harness.unbindTextures).toHaveBeenCalledTimes(1);

        harness.execute('material:a');
        expect(harness.bindTextures).toHaveBeenCalledTimes(2);
    });

    it('flushes on demand and is idempotent', () => {
        const harness = createHarness();

        harness.execute('material:a');
        harness.executor.flushTextureBindings();
        harness.executor.flushTextureBindings();

        expect(harness.unbindTextures).toHaveBeenCalledTimes(1);
    });

    it('forces a rebind after an external binder invalidates the signature', () => {
        const harness = createHarness();

        harness.execute('material:a');
        harness.executor.invalidateTextureBindings();
        expect(harness.unbindTextures).not.toHaveBeenCalled();

        harness.execute('material:a');
        expect(harness.bindTextures).toHaveBeenCalledTimes(2);
    });
});
