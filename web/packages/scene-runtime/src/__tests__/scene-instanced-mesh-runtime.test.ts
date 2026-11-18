import { describe, expect, it, vi } from 'vitest';
import type { MeshRenderer } from '../components/mesh-renderer';
import type { Transform } from '@axrone/ecs-runtime';
import type { SceneMaterialResource } from '../material-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneRenderFrameState } from '../rendering/render-frame-state';
import type { SceneRenderItem } from '../rendering/render-item-collector';
import type { SceneRenderPassResource } from '../rendering/render-pass-registry';
import type { SceneResourceRuntime } from '../scene-resource-runtime';
import type { SceneMaterialPassDefinition, SceneShaderDefinition } from '../types';
import type { SceneInstancedShaderResource } from '../rendering/scene-instanced-mesh-program';
import {
    SceneInstancedMeshRuntime,
    type SceneInstancedPlanParams,
} from '../rendering/scene-instanced-mesh-runtime';

const MATERIAL_WHITE: readonly [number, number, number, number] = [1, 1, 1, 1];

interface FakeRendererState {
    readonly renderer: MeshRenderer;
    readonly overrides: Map<string, unknown>;
}

const createFakeRenderer = (config: {
    meshId?: string;
    materialId?: string;
    color?: readonly [number, number, number, number];
    overrides?: Record<string, unknown>;
    skin?: boolean;
    morph?: boolean;
    receiveLighting?: boolean;
}): FakeRendererState => {
    const overrides = new Map<string, unknown>(Object.entries(config.overrides ?? {}));
    if (config.color) {
        overrides.set('u_Color', [...config.color]);
    }

    const renderer = {
        revision: 1,
        meshId: config.meshId ?? 'mesh:box',
        materialId: config.materialId ?? 'material:unlit',
        hasSkin: config.skin === true,
        hasMorphWeights: config.morph === true,
        receiveLighting: config.receiveLighting ?? true,
        forEachUniformEntry(visitor: (name: string, value: unknown) => void) {
            for (const [name, value] of overrides) {
                visitor(name, value);
            }
        },
    } as unknown as MeshRenderer;

    return { renderer, overrides };
};

const createFakeTransform = (position: number): Transform =>
    ({
        revision: 1,
        worldMatrix: {
            data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, position, 0, 0, 1],
        },
    }) as unknown as Transform;

const createItem = (state: FakeRendererState, transform: Transform): SceneRenderItem =>
    ({ transform, renderer: state.renderer }) as SceneRenderItem;

const createFakeGL = () => {
    const state = {
        bufferData: [] as { target: number; size: number; usage: number }[],
        bufferSubData: [] as {
            target: number;
            offset: number;
            data: Float32Array;
            length: number;
        }[],
        drawElementsInstanced: [] as { mode: number; count: number; instances: number }[],
        drawArraysInstanced: [] as { mode: number; count: number; instances: number }[],
    };

    const gl = {
        ARRAY_BUFFER: 0x8892,
        ELEMENT_ARRAY_BUFFER: 0x8893,
        FLOAT: 0x1406,
        DYNAMIC_DRAW: 0x88e8,
        TRIANGLES: 0x0004,
        UNSIGNED_SHORT: 0x1403,
        createBuffer: vi.fn(() => ({ kind: 'buffer' })),
        deleteProgram: vi.fn(),
        deleteBuffer: vi.fn(),
        bindBuffer: vi.fn(),
        bufferData: vi.fn((target: number, size: number, usage: number) => {
            state.bufferData.push({ target, size, usage });
        }),
        bufferSubData: vi.fn(
            (
                target: number,
                offset: number,
                data: Float32Array,
                srcOffset: number,
                length: number
            ) => {
                state.bufferSubData.push({ target, offset, data, length });
            }
        ),
        createVertexArray: vi.fn(() => ({ kind: 'vao' })),
        deleteVertexArray: vi.fn(),
        bindVertexArray: vi.fn(),
        enableVertexAttribArray: vi.fn(),
        vertexAttribPointer: vi.fn(),
        vertexAttribDivisor: vi.fn(),
        useProgram: vi.fn(),
        drawElementsInstanced: vi.fn(
            (mode: number, count: number, _type: number, offset: number, instances: number) => {
                state.drawElementsInstanced.push({ mode, count, instances });
            }
        ),
        drawArraysInstanced: vi.fn(
            (mode: number, _first: number, count: number, instances: number) => {
                state.drawArraysInstanced.push({ mode, count, instances });
            }
        ),
    } as unknown as WebGL2RenderingContext;

    return { gl, state };
};

const createFakeResources = (options: {
    materials: Map<string, SceneMaterialResource>;
    shaderDefinitions: Map<string, SceneShaderDefinition>;
}) => {
    const meshResource = {
        id: 'mesh:box',
        vertexArray: { kind: 'vao' },
        vertexBuffer: { kind: 'vbo' },
        indexBuffer: { kind: 'ibo' },
        vertexCount: 24,
        indexCount: 36,
        indexType: 0x1403,
        topology: 'triangles',
        mode: 0x0004,
        attributes: new Set(['position']),
    } as unknown as SceneMeshResource;

    const resources = {
        materials: {
            get: (id: string) => options.materials.get(id),
            getTextureSlots: () => Object.freeze([]),
        },
        meshes: {
            get: (id: string) => (id === meshResource.id ? meshResource : undefined),
            getDefinition: (id: string) => ({
                id,
                vertices: new Float32Array(24 * 3),
                attributes: [{ semantic: 'position', componentCount: 3, offset: 0, stride: 12 }],
                indices: new Uint16Array(36),
            }),
        },
        shaders: {
            getDefinition: (id: string) => options.shaderDefinitions.get(id),
        },
        textures: {
            get: () => undefined,
        },
        resolveSampler: () => ({ nativeHandle: null }),
    } as unknown as SceneResourceRuntime;

    return { resources, meshResource };
};

const createMaterial = (id: string, shaderId: string): SceneMaterialResource =>
    ({
        id,
        shaderId,
        uniforms: new Map([['u_Color', [...MATERIAL_WHITE]]]),
        textureBindings: new Map(),
        surface: null,
        passes: [],
        keywords: new Map(),
    }) as unknown as SceneMaterialResource;

const createShaderDefinition = (id: string): SceneShaderDefinition => ({
    id,
    vertexSource: `#version 300 es
precision highp float;
layout(location = 0) in vec3 a_Position;
uniform mat4 u_Model;
void main() { gl_Position = u_Model * vec4(a_Position, 1.0); }`,
    fragmentSource: `#version 300 es
precision highp float;
uniform vec4 u_Color;
out vec4 o_Color;
void main() { o_Color = u_Color; }`,
    depthTest: true,
    cull: true,
    blend: false,
});

const createInstancedShader = (id: string, instanceColor: boolean): SceneInstancedShaderResource =>
    ({
        id: `${id}#instanced`,
        program: { kind: 'program' },
        uniformLocations: new Map([
            ['u_View', { name: 'u_View' }],
            ['u_Projection', { name: 'u_Projection' }],
        ]),
        uniformTypes: new Map(),
        uniformNames: ['u_View', 'u_Projection'],
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
        instanceColor,
    }) as unknown as SceneInstancedShaderResource;

const createRenderPass = (): SceneRenderPassResource =>
    ({
        id: 'main',
        rendererPassId: 'main',
        materialPassId: null,
    }) as unknown as SceneRenderPassResource;

const createHarness = (options?: {
    blendedShaders?: ReadonlySet<string>;
    unsupportedShaders?: ReadonlySet<string>;
}) => {
    const materials = new Map<string, SceneMaterialResource>([
        ['material:unlit', createMaterial('material:unlit', 'shader:unlit')],
        ['material:unlit-alt', createMaterial('material:unlit-alt', 'shader:unlit')],
        ['material:other-shader', createMaterial('material:other-shader', 'shader:other')],
        ['material:blended', createMaterial('material:blended', 'shader:blended')],
    ]);
    const shaderDefinitions = new Map<string, SceneShaderDefinition>([
        ['shader:unlit', createShaderDefinition('shader:unlit')],
        ['shader:other', createShaderDefinition('shader:other')],
        ['shader:blended', createShaderDefinition('shader:blended')],
    ]);
    const { resources, meshResource } = createFakeResources({ materials, shaderDefinitions });
    const { gl, state } = createFakeGL();
    const renderStateApply = vi.fn();
    const blendChecks: string[] = [];
    const runtime = new SceneInstancedMeshRuntime({
        gl,
        resources,
        renderStateApplier: {
            apply: renderStateApply,
            resolvePrimitiveMode: () => gl.TRIANGLES,
            resolveBlendEnabled: (shader) => {
                blendChecks.push(shader.id);
                return options?.blendedShaders?.has(shader.id.replace('#instanced', '')) === true;
            },
        },
        uniformWriter: { write: vi.fn() },
        lightingUniformBinder: { apply: vi.fn() },
        fogUniformBinder: { apply: vi.fn() },
        materialTextureBinder: { bind: vi.fn(() => []), unbind: vi.fn() },
        textureUniformSetter: vi.fn(),
        compileProgram: (_gl, definition) => {
            if (options?.unsupportedShaders?.has(definition.id)) {
                return null;
            }
            return createInstancedShader(
                definition.id,
                definition.fragmentSource.includes('u_Color')
            );
        },
    });

    const pass = createRenderPass();
    const fog = { enabled: false } as SceneInstancedPlanParams['fog'];
    const frameState = {
        recordTriangles: vi.fn(),
        recordDraw: vi.fn(),
        markActiveRenderer: vi.fn(),
    } as unknown as SceneRenderFrameState;

    const build = (
        items: readonly SceneRenderItem[],
        overrides?: Partial<SceneInstancedPlanParams>
    ): ReturnType<SceneInstancedMeshRuntime['build']> =>
        runtime.build({
            renderPass: pass,
            renderItems: items,
            cameraFrame: {} as SceneInstancedPlanParams['cameraFrame'],
            lighting: {} as SceneInstancedPlanParams['lighting'],
            fog,
            frame: 1,
            elapsedSeconds: 0,
            deltaSeconds: 1 / 60,
            viewportWidth: 800,
            viewportHeight: 600,
            frameState,
            stable: false,
            materialRevision: 1,
            meshRevision: 1,
            shaderRevision: 1,
            ...overrides,
        });

    return {
        runtime,
        build,
        materials,
        pass,
        fog,
        frameState,
        state,
        gl,
        meshResource,
        renderStateApply,
        blendChecks,
        draw: (plan: ReturnType<SceneInstancedMeshRuntime['build']>) =>
            runtime.draw(plan, {
                renderPass: pass,
                cameraFrame: {} as SceneInstancedPlanParams['cameraFrame'],
                lighting: {} as SceneInstancedPlanParams['lighting'],
                fog,
                frame: 1,
                elapsedSeconds: 0,
                deltaSeconds: 1 / 60,
                viewportWidth: 800,
                viewportHeight: 600,
                frameState,
            }),
    };
};

describe('SceneInstancedMeshRuntime', () => {
    it('groups homogeneous opaque renderers into one instance stream', () => {
        const harness = createHarness();
        const items = [
            createItem(createFakeRenderer({ color: [1, 0, 0, 1] }), createFakeTransform(1)),
            createItem(createFakeRenderer({ color: [0, 1, 0, 1] }), createFakeTransform(2)),
            createItem(createFakeRenderer({ color: [0, 0, 1, 1] }), createFakeTransform(3)),
        ];

        const plan = harness.build(items);

        expect(plan.reused).toBe(false);
        expect(plan.groupCount).toBe(1);
        expect(plan.instanceCount).toBe(3);
        expect(plan.individualItems.length).toBe(0);

        const group = plan.groups[0]!;
        expect(group.hasColor).toBe(true);
        expect(group.instanceCount).toBe(3);
        // Row-major world matrices are copied as-is; the shader transposes.
        expect(group.matrixData[12]).toBe(1);
        expect(group.matrixData[16 + 12]).toBe(2);
        expect(group.matrixData[32 + 12]).toBe(3);
        expect(Array.from(group.colorData.slice(0, 4))).toEqual([1, 0, 0, 1]);
        expect(Array.from(group.colorData.slice(4, 8))).toEqual([0, 1, 0, 1]);
        expect(Array.from(group.colorData.slice(8, 12))).toEqual([0, 0, 1, 1]);
    });

    it('splits groups by mesh, material and lighting flag', () => {
        const harness = createHarness();
        const items = [
            createItem(createFakeRenderer({}), createFakeTransform(1)),
            createItem(
                createFakeRenderer({ materialId: 'material:unlit-alt' }),
                createFakeTransform(2)
            ),
            createItem(
                createFakeRenderer({ materialId: 'material:other-shader' }),
                createFakeTransform(3)
            ),
            createItem(createFakeRenderer({ receiveLighting: false }), createFakeTransform(4)),
            createItem(createFakeRenderer({ meshId: 'mesh:sphere' }), createFakeTransform(5)),
        ];

        const plan = harness.build(items);

        // mesh:sphere is not registered in the fake registry -> individual path.
        expect(plan.individualItems.length).toBe(1);
        expect(plan.groupCount).toBe(4);
        const keys = plan.groups.map((group) => group.key).sort();
        expect(keys).toEqual(
            [
                'mesh:box\u0000material:unlit\u00000',
                'mesh:box\u0000material:unlit\u00001',
                'mesh:box\u0000material:unlit-alt\u00001',
                'mesh:box\u0000material:other-shader\u00001',
            ].sort()
        );
    });

    it('falls back to the individual path for skinned, morphed, blended and unsupported renderers', () => {
        const harness = createHarness({
            blendedShaders: new Set(['shader:blended']),
            unsupportedShaders: new Set(['shader:other']),
        });
        const items = [
            createItem(createFakeRenderer({ skin: true }), createFakeTransform(1)),
            createItem(createFakeRenderer({ morph: true }), createFakeTransform(2)),
            createItem(
                createFakeRenderer({ materialId: 'material:blended' }),
                createFakeTransform(3)
            ),
            createItem(
                createFakeRenderer({ materialId: 'material:other-shader' }),
                createFakeTransform(4)
            ),
            createItem(
                createFakeRenderer({ overrides: { u_Tint: [1, 0, 0, 1] } }),
                createFakeTransform(5)
            ),
            createItem(createFakeRenderer({}), createFakeTransform(6)),
        ];

        const plan = harness.build(items);

        expect(plan.individualItems.length).toBe(5);
        expect(plan.instanceCount).toBe(1);
        expect(plan.groupCount).toBe(1);
    });

    it('replays a stable plan without rebuilding or uploading', () => {
        const harness = createHarness();
        const items = [
            createItem(createFakeRenderer({}), createFakeTransform(1)),
            createItem(createFakeRenderer({}), createFakeTransform(2)),
        ];

        const first = harness.build(items);
        expect(first.uploadCount).toBe(1);

        harness.draw(first);
        expect(harness.state.drawElementsInstanced).toHaveLength(1);
        expect(harness.state.drawElementsInstanced[0]!.instances).toBe(2);
        const uploadsAfterDraw = harness.state.bufferSubData.length;

        const second = harness.build(items, { stable: true });
        expect(second.reused).toBe(true);
        expect(second.uploadCount).toBe(0);
        // The retained plan arrays are replayed, not rebuilt.
        expect(second.groups).toBe(first.groups);
        expect(second.individualItems).toBe(first.individualItems);

        harness.draw(second);
        expect(harness.state.bufferSubData.length).toBe(uploadsAfterDraw);
    });

    it('rewrites only the instance stream when transforms move', () => {
        const harness = createHarness();
        const firstState = createFakeRenderer({ color: [1, 0, 0, 1] });
        const secondState = createFakeRenderer({ color: [0, 1, 0, 1] });
        const firstTransform = createFakeTransform(1);
        const secondTransform = createFakeTransform(2);
        const items = [
            createItem(firstState, firstTransform),
            createItem(secondState, secondTransform),
        ];

        harness.build(items);
        harness.draw(harness.build(items, { stable: true }));

        // Transform-only motion: both revisions bump, renderer state does not.
        (firstTransform as unknown as { revision: number }).revision = 2;
        (secondTransform as unknown as { revision: number }).revision = 2;
        (firstTransform as unknown as { worldMatrix: { data: number[] } }).worldMatrix = {
            data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1],
        };
        (secondTransform as unknown as { worldMatrix: { data: number[] } }).worldMatrix = {
            data: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 6, 0, 0, 1],
        };

        const plan = harness.build(items);
        expect(plan.reused).toBe(false);
        expect(plan.uploadCount).toBe(1);
        expect(plan.groups[0]!.matrixData[12]).toBe(5);
        expect(plan.groups[0]!.matrixData[16 + 12]).toBe(6);
        // Colors did not change, so no color upload is scheduled.
        expect(Array.from(plan.groups[0]!.colorData.slice(0, 4))).toEqual([1, 0, 0, 1]);
    });

    it('updates per-instance color when the renderer revision changes', () => {
        const harness = createHarness();
        const state = createFakeRenderer({ color: [1, 0, 0, 1] });
        const transform = createFakeTransform(1);
        const items = [createItem(state, transform)];

        harness.build(items);
        harness.draw(harness.build(items, { stable: true }));

        state.overrides.set('u_Color', [0, 0, 1, 0.5]);
        (state.renderer as unknown as { revision: number }).revision = 2;

        const plan = harness.build(items);
        expect(plan.uploadCount).toBe(1);
        expect(Array.from(plan.groups[0]!.colorData.slice(0, 4))).toEqual([0, 0, 1, 0.5]);
    });

    it('rewrites retained colors when the material color changes in place', () => {
        const harness = createHarness();
        const items = [createItem(createFakeRenderer({}), createFakeTransform(1))];

        const first = harness.build(items);
        expect(Array.from(first.groups[0]!.colorData.slice(0, 4))).toEqual([1, 1, 1, 1]);

        // Material uniforms mutate in place; only the registry revision moves.
        harness.materials.get('material:unlit')!.uniforms.set('u_Color', [0, 0, 1, 1]);
        const plan = harness.build(items, { materialRevision: 2 });

        expect(plan.uploadCount).toBe(1);
        expect(Array.from(plan.groups[0]!.colorData.slice(0, 4))).toEqual([0, 0, 1, 1]);
    });

    it('records one instanced draw and the multiplied triangle count', () => {
        const harness = createHarness();
        const items = Array.from({ length: 5 }, () =>
            createItem(createFakeRenderer({}), createFakeTransform(1))
        );

        const plan = harness.build(items);
        const drawCalls = harness.draw(plan);

        expect(drawCalls).toBe(1);
        expect(harness.state.drawElementsInstanced).toHaveLength(1);
        expect(harness.state.drawElementsInstanced[0]).toMatchObject({ count: 36, instances: 5 });
        // 36 indices -> 12 triangles per instance, 5 instances.
        expect(harness.frameState.recordTriangles).toHaveBeenCalledWith(60, 1);
    });

    it('uses drawArraysInstanced for meshes without an index buffer', () => {
        const harness = createHarness();
        const mesh = harness.meshResource as unknown as {
            indexBuffer: unknown;
            indexCount: number;
            indexType: number | null;
        };
        const original = { ...mesh };
        mesh.indexBuffer = null;
        mesh.indexCount = 0;
        mesh.indexType = null;

        try {
            const plan = harness.build([
                createItem(createFakeRenderer({}), createFakeTransform(1)),
                createItem(createFakeRenderer({}), createFakeTransform(2)),
            ]);
            harness.draw(plan);
            expect(harness.state.drawArraysInstanced).toHaveLength(1);
            expect(harness.state.drawArraysInstanced[0]).toMatchObject({ count: 24, instances: 2 });
        } finally {
            Object.assign(mesh, original);
        }
    });

    it('releases GPU objects on clear', () => {
        const harness = createHarness();
        harness.build([createItem(createFakeRenderer({}), createFakeTransform(1))]);
        harness.runtime.clear();

        expect(harness.gl.deleteVertexArray).toHaveBeenCalledTimes(1);
        expect(harness.gl.deleteBuffer).toHaveBeenCalledTimes(2);
    });
});

const createPassMaterial = (
    id: string,
    shaderId: string,
    passes: readonly SceneMaterialPassDefinition[]
): SceneMaterialResource =>
    ({
        id,
        shaderId,
        uniforms: new Map([['u_Color', [...MATERIAL_WHITE]]]),
        textureBindings: new Map(),
        surface: null,
        passes,
        keywords: new Map(),
    }) as unknown as SceneMaterialResource;

const createMaterialPassRenderPass = (
    materialPassId: string | null
): SceneRenderPassResource =>
    ({
        id: materialPassId ?? 'main',
        rendererPassId: 'main',
        materialPassId,
    }) as unknown as SceneRenderPassResource;

const createToonHarness = () => {
    const harness = createHarness();
    harness.materials.set(
        'material:toon',
        createPassMaterial('material:toon', 'shader:unlit', [
            { id: 'main' },
            { id: 'outline', shaderId: 'shader:outline' },
            { id: 'same-shader', shaderId: 'shader:unlit' },
        ])
    );
    return harness;
};

const toonItem = (): SceneRenderItem =>
    createItem(createFakeRenderer({ materialId: 'material:toon' }), createFakeTransform(1));

describe('SceneInstancedMeshRuntime pass-level shader override', () => {
    it('declines instancing when the resolved pass overrides the shader', () => {
        const harness = createToonHarness();

        const plan = harness.build([toonItem()], {
            renderPass: createMaterialPassRenderPass('outline'),
        });

        expect(plan.groupCount).toBe(0);
        expect(plan.individualItems).toHaveLength(1);
    });

    it('instances the same renderer when the resolved pass declares no override', () => {
        const harness = createToonHarness();

        const plan = harness.build([toonItem()], {
            renderPass: createMaterialPassRenderPass('main'),
        });

        expect(plan.groupCount).toBe(1);
        expect(plan.individualItems).toHaveLength(0);
        // The key format carries no override term, so pinned keys stay valid.
        expect(plan.groups.map((group) => group.key)).toEqual([
            'mesh:box\u0000material:toon\u00001',
        ]);
    });

    it('instances a pass whose override equals the material shader', () => {
        const harness = createToonHarness();

        const plan = harness.build([toonItem()], {
            renderPass: createMaterialPassRenderPass('same-shader'),
        });

        expect(plan.groupCount).toBe(1);
        expect(plan.individualItems).toHaveLength(0);
    });

    it('declines instancing only for the overriding pass across frames', () => {
        const harness = createToonHarness();
        const outlinePass = createMaterialPassRenderPass('outline');
        const mainPass = createMaterialPassRenderPass('main');

        const outlinePlan = harness.build([toonItem()], { renderPass: outlinePass });
        expect(outlinePlan.groupCount).toBe(0);

        const mainPlan = harness.build([toonItem()], { renderPass: mainPass });
        expect(mainPlan.groupCount).toBe(1);
    });
});

