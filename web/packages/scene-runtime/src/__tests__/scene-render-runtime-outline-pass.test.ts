import { Entity, Transform, World } from '@axrone/ecs-runtime';
import { Vec3, Vec4 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import { Camera } from '../components/camera';
import { MeshRenderer } from '../components/mesh-renderer';
import type { SceneMaterialResource } from '../material-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneRenderPassResource } from '../rendering/render-pass-registry';
import { SceneRenderRuntime } from '../rendering/scene-render-runtime';
import { createSceneRegistry } from '../scene-registry';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneMaterialPassDefinition, SceneMeshDefinition } from '../types';

const TOON_SHADER_ID = 'gltf/toon';
const OUTLINE_SHADER_ID = 'gltf/toon-outline';
const MAIN_PASS_ID = 'main';
const OUTLINE_MATERIAL_PASS_ID = 'outline';

type MockGl = ReturnType<typeof createMockGL>;

const createMockGL = () => {
    const gl = {
        TRIANGLES: 0x0004,
        LINES: 0x0001,
        POINTS: 0x0000,
        FLOAT: 0x1406,
        INT: 0x1404,
        BOOL: 0x8b56,
        FLOAT_VEC2: 0x8b50,
        FLOAT_VEC3: 0x8b51,
        FLOAT_VEC4: 0x8b52,
        FLOAT_MAT4: 0x8b5c,
        UNSIGNED_INT: 0x1405,
        DEPTH_TEST: 0x0b71,
        CULL_FACE: 0x0b44,
        BLEND: 0x0be2,
        STENCIL_TEST: 0x0b90,
        POLYGON_OFFSET_FILL: 0x8037,
        SAMPLE_ALPHA_TO_COVERAGE: 0x809e,
        RASTERIZER_DISCARD: 0x8c89,
        LESS: 0x0201,
        ALWAYS: 0x0207,
        FRONT: 0x0404,
        BACK: 0x0405,
        NONE: 0,
        CCW: 0x0901,
        CW: 0x0900,
        FUNC_ADD: 0x8006,
        ONE: 1,
        SRC_ALPHA: 0x0302,
        ONE_MINUS_SRC_ALPHA: 0x0303,
        KEEP: 0x1e00,
        ZERO: 0,
        COLOR_BUFFER_BIT: 0x4000,
        DEPTH_BUFFER_BIT: 0x0100,
        FRAMEBUFFER: 0x8d40,
        READ_FRAMEBUFFER: 0x8ca8,
        DRAW_FRAMEBUFFER: 0x8ca9,
        viewport: vi.fn(),
        clearColor: vi.fn(),
        clearDepth: vi.fn(),
        clear: vi.fn(),
        enable: vi.fn(),
        disable: vi.fn(),
        frontFace: vi.fn(),
        cullFace: vi.fn(),
        blendEquationSeparate: vi.fn(),
        blendFuncSeparate: vi.fn(),
        blendColor: vi.fn(),
        colorMask: vi.fn(),
        depthMask: vi.fn(),
        depthFunc: vi.fn(),
        stencilFuncSeparate: vi.fn(),
        stencilMaskSeparate: vi.fn(),
        stencilOpSeparate: vi.fn(),
        polygonOffset: vi.fn(),
        lineWidth: vi.fn(),
        useProgram: vi.fn(),
        bindVertexArray: vi.fn(),
        bindBuffer: vi.fn(),
        bufferData: vi.fn(),
        bindSampler: vi.fn(),
        activeTexture: vi.fn(),
        bindFramebuffer: vi.fn(),
        framebufferTexture2D: vi.fn(),
        framebufferRenderbuffer: vi.fn(),
        checkFramebufferStatus: vi.fn(() => 0x8cd5),
        createFramebuffer: vi.fn(() => ({ id: 'fbo' })),
        deleteFramebuffer: vi.fn(),
        createRenderbuffer: vi.fn(() => ({ id: 'rbo' })),
        deleteRenderbuffer: vi.fn(),
        renderbufferStorage: vi.fn(),
        renderbufferStorageMultisample: vi.fn(),
        texImage2D: vi.fn(),
        texImage3D: vi.fn(),
        texStorage2D: vi.fn(),
        texStorage3D: vi.fn(),
        texParameteri: vi.fn(),
        createTexture: vi.fn(() => ({ id: 'tex' })),
        deleteTexture: vi.fn(),
        bindTexture: vi.fn(),
        generateMipmap: vi.fn(),
        uniformMatrix4fv: vi.fn(),
        uniform3f: vi.fn(),
        uniform4f: vi.fn(),
        uniform2f: vi.fn(),
        uniform3fv: vi.fn(),
        uniform4fv: vi.fn(),
        uniform2fv: vi.fn(),
        uniform1fv: vi.fn(),
        uniform1iv: vi.fn(),
        uniform1ui: vi.fn(),
        uniform1uiv: vi.fn(),
        uniform3iv: vi.fn(),
        uniform4iv: vi.fn(),
        uniform2iv: vi.fn(),
        uniform1f: vi.fn(),
        uniform1i: vi.fn(),
        drawArrays: vi.fn(),
        drawElements: vi.fn(),
    };

    return gl as unknown as MockGl & {
        drawArrays: { mock: { calls: unknown[][] } };
        clear: { mock: { calls: unknown[][] } };
        cullFace: { mock: { calls: unknown[][] } };
        useProgram: { mock: { calls: unknown[][] } };
    };
};

const createShader = (id: string): SceneShaderResource =>
    ({
        id,
        program: { id } as unknown as WebGLProgram,
        uniformLocations: new Map<string, WebGLUniformLocation>(),
        uniformTypes: new Map<string, number>(),
        uniformNames: [],
        attributeNames: { position: 'a_Position' },
        depthTest: true,
        cull: true,
        blend: false,
    }) as unknown as SceneShaderResource;

const createRenderPass = (
    id: string,
    order: number,
    materialPassId: string | null,
    clearFlags: readonly string[] = ['color', 'depth']
): SceneRenderPassResource =>
    Object.freeze({
        id,
        order,
        rendererPassId: MAIN_PASS_ID,
        materialPassId,
        enabled: true,
        clearFlags: Object.freeze([...clearFlags]),
        clearColor: null,
        clearDepth: null,
    }) as unknown as SceneRenderPassResource;

interface OutlineHarness {
    readonly runtime: SceneRenderRuntime;
    readonly gl: MockGl;
    readonly materials: SceneMaterialResource;
    readonly mainPass: SceneRenderPassResource;
    readonly registeredPasses: readonly SceneRenderPassResource[];
    readonly getEnabledResources: ReturnType<typeof vi.fn>;
    readonly frame: (frame: number) => void;
    readonly programsBound: () => string[];
    readonly drawCount: () => number;
    readonly setPasses: (passes: readonly SceneMaterialPassDefinition[]) => void;
}

const createHarness = (options: {
    readonly passes: readonly SceneMaterialPassDefinition[];
    readonly registeredPasses?: readonly SceneRenderPassResource[];
    readonly stableRegistryArray?: boolean;
    readonly exposeMaterialRevision?: boolean;
}): OutlineHarness => {
    const gl = createMockGL();
    const world = new World(createSceneRegistry());

    const cameraEntity = new Entity(world);
    cameraEntity.addComponent(Camera, { primary: true, near: 0.1, far: 100 });
    cameraEntity.requireComponent(Transform).position = new Vec3(0, 0, 10);

    const rendererEntity = new Entity(world);
    rendererEntity.addComponent(MeshRenderer, {
        meshId: 'mesh',
        materialId: 'material',
        passId: MAIN_PASS_ID,
        receiveLighting: true,
    });
    rendererEntity.requireComponent(Transform);

    const mesh: SceneMeshResource = {
        id: 'mesh',
        vertexArray: {} as WebGLVertexArrayObject,
        vertexBuffer: {} as WebGLBuffer,
        indexBuffer: null,
        vertexCount: 3,
        indexCount: 0,
        indexType: null,
        topology: 'triangles',
        mode: gl.TRIANGLES,
        attributes: new Set(['position']),
    };
    const meshDefinition: SceneMeshDefinition = {
        id: 'mesh',
        vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
        attributes: [{ semantic: 'position', componentCount: 3, offset: 0, stride: 12 }],
        vertexCount: 3,
        topology: 'triangles',
    };

    let materialPasses = options.passes;
    let materialRevision = 0;
    const material: SceneMaterialResource = {
        id: 'material',
        shaderId: TOON_SHADER_ID,
        uniforms: new Map(),
        textureBindings: new Map(),
        surface: { shadingModel: 'custom', alphaMode: 'opaque' },
        get passes() {
            return materialPasses;
        },
        keywords: new Map(),
    } as unknown as SceneMaterialResource;

    const toonShader = createShader(TOON_SHADER_ID);
    const outlineShader = createShader(OUTLINE_SHADER_ID);
    const shaders = new Map([
        [toonShader.id, toonShader],
        [outlineShader.id, outlineShader],
    ]);

    const registeredPasses = Object.freeze(
        options.registeredPasses ?? [createRenderPass('main', 0, null)]
    );
    const freshRegistryArray = options.stableRegistryArray !== true;
    const getEnabledResources = vi.fn(() =>
        freshRegistryArray ? [...registeredPasses] : registeredPasses
    );

    const materialsStub = {
        get: (id: string) => (id === material.id ? material : undefined),
        getTextureSlots: () => Object.freeze([]),
        ...(options.exposeMaterialRevision === false ? {} : { revision: 0 }),
    };
    const readMaterialRevision = (): number =>
        typeof materialsStub.revision === 'number' ? materialsStub.revision : 0;

    const resources = {
        materials: materialsStub,
        meshes: {
            get: (id: string) => (id === mesh.id ? mesh : undefined),
            getDefinition: (id: string) => (id === mesh.id ? meshDefinition : undefined),
        },
        shaders: {
            get: (id: string) => shaders.get(id),
            revision: 0,
        },
        textures: {
            get: () => undefined,
        },
        renderPasses: {
            getEnabledResources,
        },
        resolveSampler: () => ({ bind: vi.fn(), nativeHandle: null }),
    } as unknown as SceneResourceRuntime;

    const runtime = new SceneRenderRuntime({
        gl,
        resources,
        ambientLight: Vec3.ZERO.clone(),
        skyLight: Vec3.ZERO.clone(),
        groundLight: Vec3.ZERO.clone(),
        defaultClearColor: new Vec4(0, 0, 0, 1),
        getEntitys: () => world.getAllEntities(),
        createMeshResource: vi.fn(() => mesh),
        disposeMesh: vi.fn(),
        applyMissingVertexAttributeDefaults: vi.fn(),
    });

    const frame = (index: number): void => {
        runtime.render({
            frame: index,
            elapsedSeconds: index / 60,
            deltaSeconds: 1 / 60,
            viewportWidth: 640,
            viewportHeight: 360,
        });
    };

    return {
        runtime,
        gl,
        materials: material,
        mainPass: registeredPasses[0]!,
        registeredPasses,
        getEnabledResources,
        frame,
        programsBound: () =>
            gl.useProgram.mock.calls.map((call) => (call[0] as { id: string }).id),
        drawCount: () => gl.drawArrays.mock.calls.length,
        setPasses: (passes: readonly SceneMaterialPassDefinition[]) => {
            materialPasses = passes;
            materialRevision += 1;
            if (typeof materialsStub.revision === 'number') {
                materialsStub.revision = materialRevision;
            }
            // Every renderer mutation must be visible to the render-list cache.
            for (const entity of world.getAllEntities()) {
                const renderer = entity.getComponent(MeshRenderer);
                if (renderer) {
                    renderer.visible = !renderer.visible;
                    renderer.visible = !renderer.visible;
                }
            }
        },
    };
};

describe('SceneRenderRuntime outline render pass', () => {
    it('appends an outline pass for a Material Model declaring one', () => {
        const harness = createHarness({
            passes: [
                { id: MAIN_PASS_ID },
                {
                    id: OUTLINE_MATERIAL_PASS_ID,
                    shaderId: OUTLINE_SHADER_ID,
                    rasterizerState: { cullMode: 'front' },
                    depthStencilState: { depthTest: true, depthWrite: true },
                },
            ],
        });

        harness.frame(1);

        expect(harness.drawCount()).toBe(2);
        expect(harness.programsBound()).toEqual([TOON_SHADER_ID, OUTLINE_SHADER_ID]);
        expect(harness.runtime.stats.drawCalls).toBe(2);
    });

    it('drives the inverted-hull Output Slot with front-face culling', () => {
        const harness = createHarness({
            passes: [
                { id: MAIN_PASS_ID },
                {
                    id: OUTLINE_MATERIAL_PASS_ID,
                    shaderId: OUTLINE_SHADER_ID,
                    rasterizerState: { cullMode: 'front' },
                },
            ],
        });

        harness.frame(1);

        const cullModes = new Set(harness.gl.cullFace.mock.calls.map((call) => call[0]));
        expect(cullModes.has(harness.gl.FRONT as unknown as number)).toBe(true);
        expect(harness.programsBound()).toContain(OUTLINE_SHADER_ID);
    });

    it('does not append when a registered pass already drives the outline Output Slot', () => {
        const harness = createHarness({
            passes: [
                { id: MAIN_PASS_ID },
                { id: OUTLINE_MATERIAL_PASS_ID, shaderId: OUTLINE_SHADER_ID },
            ],
            registeredPasses: [
                createRenderPass('main', 0, null),
                createRenderPass('outline', 1, OUTLINE_MATERIAL_PASS_ID, []),
            ],
        });

        harness.frame(1);

        // Exactly one main draw plus exactly one outline draw — no third execution.
        expect(harness.drawCount()).toBe(2);
        expect(harness.programsBound()).toEqual([TOON_SHADER_ID, OUTLINE_SHADER_ID]);
    });

    it('never adds the synthetic pass to the render-pass registry view', () => {
        const harness = createHarness({
            passes: [
                { id: MAIN_PASS_ID },
                { id: OUTLINE_MATERIAL_PASS_ID, shaderId: OUTLINE_SHADER_ID },
            ],
            stableRegistryArray: true,
        });

        harness.frame(1);
        harness.frame(2);
        harness.frame(3);

        const enabled = harness.getEnabledResources.mock.results[
            harness.getEnabledResources.mock.results.length - 1
        ]!.value as readonly SceneRenderPassResource[];
        expect(enabled).toHaveLength(1);
        expect(enabled[0]).toBe(harness.registeredPasses[0]);
        // The outline Output Slot clears nothing: only the registered pass clears.
        expect(harness.gl.clear.mock.calls).toHaveLength(3);
        expect(harness.drawCount()).toBe(6);
    });

    it('stays inert when no Material Model declares an outline Output Slot', () => {
        const harness = createHarness({ passes: [{ id: MAIN_PASS_ID }] });

        harness.frame(1);
        harness.frame(2);

        expect(harness.drawCount()).toBe(2);
        expect(harness.programsBound()).toEqual([TOON_SHADER_ID, TOON_SHADER_ID]);
        const cullModes = new Set(harness.gl.cullFace.mock.calls.map((call) => call[0]));
        expect(cullModes.has(harness.gl.FRONT as unknown as number)).toBe(false);
    });

    it('reacts when a Material Model gains an outline Output Slot mid-session', () => {
        const harness = createHarness({
            passes: [{ id: MAIN_PASS_ID }],
            stableRegistryArray: true,
        });

        harness.frame(1);
        expect(harness.drawCount()).toBe(1);

        harness.setPasses([
            { id: MAIN_PASS_ID },
            { id: OUTLINE_MATERIAL_PASS_ID, shaderId: OUTLINE_SHADER_ID },
        ]);
        harness.frame(2);
        expect(harness.drawCount()).toBe(3);

        harness.setPasses([{ id: MAIN_PASS_ID }]);
        harness.frame(3);
        expect(harness.drawCount()).toBe(4);
        expect(harness.programsBound()).toEqual([
            TOON_SHADER_ID,
            TOON_SHADER_ID,
            OUTLINE_SHADER_ID,
            TOON_SHADER_ID,
        ]);
    });

    it('keeps appending without a material registry revision field', () => {
        const harness = createHarness({
            passes: [
                { id: MAIN_PASS_ID },
                { id: OUTLINE_MATERIAL_PASS_ID, shaderId: OUTLINE_SHADER_ID },
            ],
            exposeMaterialRevision: false,
        });

        harness.frame(1);
        harness.frame(2);
        harness.frame(3);

        expect(harness.drawCount()).toBe(6);
        expect(harness.programsBound()).toEqual([
            TOON_SHADER_ID,
            OUTLINE_SHADER_ID,
            TOON_SHADER_ID,
            OUTLINE_SHADER_ID,
            TOON_SHADER_ID,
            OUTLINE_SHADER_ID,
        ]);
    });

    describe('_resolveFramePasses white-box contract', () => {
        interface FramePassProbe {
            _resolveFramePasses(
                passes: readonly SceneRenderPassResource[]
            ): readonly SceneRenderPassResource[];
        }

        const resolveFramePasses = (
            runtime: SceneRenderRuntime,
            passes: readonly SceneRenderPassResource[]
        ): readonly SceneRenderPassResource[] =>
            (runtime as unknown as FramePassProbe)._resolveFramePasses(passes);

        const outlinePasses: readonly SceneMaterialPassDefinition[] = [
            { id: MAIN_PASS_ID },
            { id: OUTLINE_MATERIAL_PASS_ID, shaderId: OUTLINE_SHADER_ID },
        ];

        it('reuses one frozen synthetic pass and the same combined array', () => {
            const harness = createHarness({
                passes: outlinePasses,
                stableRegistryArray: true,
            });
            const probe = harness.runtime;

            const first = resolveFramePasses(probe, harness.registeredPasses);
            const second = resolveFramePasses(probe, harness.registeredPasses);

            expect(first).toBe(second);
            expect(first).toHaveLength(2);
            expect(first[0]).toBe(harness.registeredPasses[0]);

            const synthetic = first[1]!;
            expect(Object.isFrozen(synthetic)).toBe(true);
            expect(synthetic.id).toBe(OUTLINE_MATERIAL_PASS_ID);
            expect(synthetic.order).toBe(harness.registeredPasses[0]!.order + 1);
            expect(synthetic.rendererPassId).toBe(harness.registeredPasses[0]!.rendererPassId);
            expect(synthetic.materialPassId).toBe(OUTLINE_MATERIAL_PASS_ID);
            expect(synthetic.enabled).toBe(true);
            expect(synthetic.clearFlags).toEqual([]);
            expect(Object.isFrozen(synthetic.clearFlags)).toBe(true);
            expect(synthetic.clearColor).toBeNull();
            expect(synthetic.clearDepth).toBeNull();

            harness.frame(1);
            harness.frame(2);
            harness.frame(3);

            expect(resolveFramePasses(probe, harness.registeredPasses)).toBe(first);
            expect(harness.drawCount()).toBe(6);
            expect(new Set(harness.programsBound())).toEqual(
                new Set([TOON_SHADER_ID, OUTLINE_SHADER_ID])
            );
        });

        it('orders the synthetic pass after every registered pass', () => {
            const harness = createHarness({
                passes: outlinePasses,
                registeredPasses: [
                    createRenderPass('shadow', 0, null, []),
                    createRenderPass('main', 5, null),
                ],
                stableRegistryArray: true,
            });

            const passes = resolveFramePasses(harness.runtime, harness.registeredPasses);

            expect(passes).toHaveLength(3);
            expect(passes[2]!.id).toBe(OUTLINE_MATERIAL_PASS_ID);
            expect(passes[2]!.order).toBe(6);
            expect(passes[2]!.rendererPassId).toBe(MAIN_PASS_ID);
        });

        it('returns the registered list untouched when mesh draws are unavailable', () => {
            const gl = createMockGL();
            const world = new World(createSceneRegistry());
            const cameraEntity = new Entity(world);
            cameraEntity.addComponent(Camera, { primary: true });
            cameraEntity.requireComponent(Transform);
            const mesh: SceneMeshResource = {
                id: 'mesh',
                vertexArray: {} as WebGLVertexArrayObject,
                vertexBuffer: {} as WebGLBuffer,
                indexBuffer: null,
                vertexCount: 3,
                indexCount: 0,
                indexType: null,
                topology: 'triangles',
                mode: gl.TRIANGLES,
                attributes: new Set(['position']),
            };
            const material: SceneMaterialResource = {
                id: 'material',
                shaderId: TOON_SHADER_ID,
                uniforms: new Map(),
                textureBindings: new Map(),
                surface: null,
                passes: outlinePasses,
                keywords: new Map(),
            } as unknown as SceneMaterialResource;
            const registeredPasses = Object.freeze([createRenderPass('main', 0, null)]);
            const runtime = new SceneRenderRuntime({
                gl,
                resources: {
                    materials: {
                        get: () => material,
                        getTextureSlots: () => Object.freeze([]),
                        revision: 0,
                    },
                    meshes: {
                        get: () => mesh,
                        getDefinition: () => undefined,
                        revision: 0,
                    },
                    shaders: { get: () => undefined, revision: 0 },
                    textures: { get: () => undefined },
                    renderPasses: { getEnabledResources: () => registeredPasses },
                    resolveSampler: () => ({ bind: vi.fn(), nativeHandle: null }),
                } as unknown as SceneResourceRuntime,
                capabilities: {
                    meshRenderers: false,
                    lights: true,
                    sprites: true,
                    particles: true,
                    lines: true,
                    billboards: true,
                },
                ambientLight: Vec3.ZERO.clone(),
                skyLight: Vec3.ZERO.clone(),
                groundLight: Vec3.ZERO.clone(),
                defaultClearColor: new Vec4(0, 0, 0, 1),
                getEntitys: () => world.getAllEntities(),
                createMeshResource: vi.fn(() => mesh),
                disposeMesh: vi.fn(),
                applyMissingVertexAttributeDefaults: vi.fn(),
            });

            expect(resolveFramePasses(runtime, registeredPasses)).toBe(registeredPasses);
        });
    });
});