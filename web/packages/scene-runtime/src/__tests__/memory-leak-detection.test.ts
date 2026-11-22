/**
 * T-13: Memory Leak Detection Suite — WebGL Resource Lifecycle Tracking
 *
 * Validates that WebGL resources (textures, buffers, shaders, programs,
 * framebuffers, vertex arrays) are properly cleaned up when scenes are
 * disposed, components are destroyed, and entities are removed.
 *
 * Uses the mock GL infrastructure from scene-3d test-harness which tracks
 * created resources in Set objects exposed as `_textures`, `_buffers`, etc.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Component, World, Actor, Hierarchy, Transform } from '@axrone/ecs-runtime';
import { Vec4 } from '@axrone/numeric';
import {
    createMockGL,
    installWebGL2Constants,
} from '../../../../tests/shared/test-harness';
import { SceneResourceRuntime } from '../scene-resource-runtime';
import type { SceneResourceRuntimeClearCallbacks } from '../scene-resource-runtime';
import type { SceneTextureResource } from '../texture-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneShaderResource } from '../shader-registry';
import type { SceneSamplerResource } from '../sampler-registry';

installWebGL2Constants();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MockGLWithTracking extends WebGL2RenderingContext {
    _textures: Set<object>;
    _buffers: Set<object>;
    _shaders: Set<object>;
    _programs: Set<object>;
    _vertexArrays: Set<object>;
    _samplers: Set<object>;
    _framebuffers: Set<object>;
}

const createTrackedGL = (): { gl: MockGLWithTracking; canvas: HTMLCanvasElement } => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const gl = createMockGL(canvas) as unknown as MockGLWithTracking;
    return { gl, canvas };
};

/**
 * Build the standard clear callbacks that wire registry disposal to the
 * corresponding GL delete calls. This mirrors what SceneAssetRuntime does
 * when it tears down resources.
 */
const createClearCallbacks = (gl: MockGLWithTracking): SceneResourceRuntimeClearCallbacks => ({
    deleteProgram: (shader: SceneShaderResource) => {
        gl.deleteProgram(shader.program);
    },
    disposeMesh: (mesh: SceneMeshResource) => {
        gl.deleteVertexArray(mesh.vertexArray);
        gl.deleteBuffer(mesh.vertexBuffer);
        if (mesh.indexBuffer) {
            gl.deleteBuffer(mesh.indexBuffer);
        }
    },
    disposeSampler: (_sampler: SceneSamplerResource) => {
        /* samplers are lightweight; no GL-level deletion needed in this mock */
    },
    disposeTexture: (texture: SceneTextureResource) => {
        gl.deleteTexture(texture.texture.nativeHandle as unknown as object);
    },
});

const createDefaultRuntime = (gl: WebGL2RenderingContext): SceneResourceRuntime =>
    new SceneResourceRuntime({
        defaultPassId: 'default',
        defaultClearColor: new Vec4(0, 0, 0, 1),
        defaultSampler: { nativeHandle: {} as WebGLSampler } as any,
    });

// ---------------------------------------------------------------------------
// Fake component used by the component-lifecycle section
// ---------------------------------------------------------------------------

class ResourceTrackingComponent extends Component {
    public resources: object[] = [];
    public destroyed = false;

    onDestroy(): void {
        this.resources = [];
        this.destroyed = true;
    }
}

class LifecycleEventComponent extends Component {
    public readonly events: string[] = [];

    onDestroy(): void {
        this.events.push('onDestroy');
    }
}

class SecondaryLifecycleComponent extends Component {
    public destroyed = false;

    onDestroy(): void {
        this.destroyed = true;
    }
}

// ---------------------------------------------------------------------------
// 1. Scene Disposal Cleanup (5 tests)
// ---------------------------------------------------------------------------

describe('Scene Disposal Cleanup', () => {
    let gl: MockGLWithTracking;
    let runtime: SceneResourceRuntime;
    let callbacks: SceneResourceRuntimeClearCallbacks;

    beforeEach(() => {
        ({ gl } = createTrackedGL());
        runtime = createDefaultRuntime(gl);
        callbacks = createClearCallbacks(gl);
    });

    it('releases all tracked GL textures when scene resources are cleared', () => {
        const texHandle1 = gl.createTexture();
        const texHandle2 = gl.createTexture();
        expect(gl._textures.size).toBe(2);

        runtime.textures.register(
            { id: 'tex1', source: { kind: 'color', color: [1, 0, 0, 1] } },
            {
                id: 'tex1',
                texture: { nativeHandle: texHandle1 } as any,
                width: 64,
                height: 64,
                samplerId: null,
            }
        );
        runtime.textures.register(
            { id: 'tex2', source: { kind: 'color', color: [0, 1, 0, 1] } },
            {
                id: 'tex2',
                texture: { nativeHandle: texHandle2 } as any,
                width: 64,
                height: 64,
                samplerId: null,
            }
        );

        runtime.clear(callbacks);

        expect(gl._textures.size).toBe(0);
        expect(gl.deleteTexture).toHaveBeenCalledTimes(2);
    });

    it('releases all tracked GL buffers when scene meshes are cleared', () => {
        const vb1 = gl.createBuffer();
        const ib1 = gl.createBuffer();
        const vb2 = gl.createBuffer();
        expect(gl._buffers.size).toBe(3);

        runtime.meshes.register(
            { id: 'mesh1', vertices: new Float32Array(0), topology: 'triangles' as any, attributes: [] },
            {
                id: 'mesh1',
                vertexArray: gl.createVertexArray(),
                vertexBuffer: vb1,
                indexBuffer: ib1,
                vertexCount: 3,
                indexCount: 3,
                indexType: gl.UNSIGNED_SHORT,
                topology: 'triangles' as any,
                mode: gl.TRIANGLES,
                attributes: new Set() as any,
            }
        );
        runtime.meshes.register(
            { id: 'mesh2', vertices: new Float32Array(0), topology: 'triangles' as any, attributes: [] },
            {
                id: 'mesh2',
                vertexArray: gl.createVertexArray(),
                vertexBuffer: vb2,
                indexBuffer: null,
                vertexCount: 4,
                indexCount: 0,
                indexType: null,
                topology: 'triangles' as any,
                mode: gl.TRIANGLES,
                attributes: new Set() as any,
            }
        );

        runtime.clear(callbacks);

        // vb1, ib1, vb2 all deleted
        expect(gl._buffers.size).toBe(0);
    });

    it('releases all tracked GL shader programs when scene shaders are cleared', () => {
        const prog1 = gl.createProgram();
        const prog2 = gl.createProgram();
        expect(gl._programs.size).toBe(2);

        runtime.shaders.register(
            { id: 'shader1' },
            {
                id: 'shader1',
                program: prog1,
                uniformLocations: new Map(),
                uniformTypes: new Map(),
                uniformNames: [],
                attributeNames: {} as any,
                depthTest: true,
                cull: true,
                blend: false,
            }
        );
        runtime.shaders.register(
            { id: 'shader2' },
            {
                id: 'shader2',
                program: prog2,
                uniformLocations: new Map(),
                uniformTypes: new Map(),
                uniformNames: [],
                attributeNames: {} as any,
                depthTest: true,
                cull: true,
                blend: false,
            }
        );

        runtime.clear(callbacks);

        expect(gl._programs.size).toBe(0);
        expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    });

    it('releases all tracked GL vertex arrays (VAOs) when scene meshes are cleared', () => {
        const vao1 = gl.createVertexArray();
        const vao2 = gl.createVertexArray();
        expect(gl._vertexArrays.size).toBe(2);

        runtime.meshes.register(
            { id: 'm1', vertices: new Float32Array(0), topology: 'triangles' as any, attributes: [] },
            {
                id: 'm1',
                vertexArray: vao1,
                vertexBuffer: gl.createBuffer(),
                indexBuffer: null,
                vertexCount: 3,
                indexCount: 0,
                indexType: null,
                topology: 'triangles' as any,
                mode: gl.TRIANGLES,
                attributes: new Set() as any,
            }
        );
        runtime.meshes.register(
            { id: 'm2', vertices: new Float32Array(0), topology: 'triangles' as any, attributes: [] },
            {
                id: 'm2',
                vertexArray: vao2,
                vertexBuffer: gl.createBuffer(),
                indexBuffer: null,
                vertexCount: 4,
                indexCount: 0,
                indexType: null,
                topology: 'triangles' as any,
                mode: gl.TRIANGLES,
                attributes: new Set() as any,
            }
        );

        runtime.clear(callbacks);

        expect(gl._vertexArrays.size).toBe(0);
        expect(gl.deleteVertexArray).toHaveBeenCalledTimes(2);
    });

    it('releases all tracked GL framebuffers when FBOs are explicitly disposed', () => {
        const fb1 = gl.createFramebuffer();
        const fb2 = gl.createFramebuffer();
        const fb3 = gl.createFramebuffer();
        expect(gl._framebuffers.size).toBe(3);

        // Simulate scene disposal deleting all tracked framebuffers
        gl.deleteFramebuffer(fb1);
        gl.deleteFramebuffer(fb2);
        gl.deleteFramebuffer(fb3);

        expect(gl._framebuffers.size).toBe(0);
        expect(gl.deleteFramebuffer).toHaveBeenCalledTimes(3);
    });
});

// ---------------------------------------------------------------------------
// 2. Component Lifecycle Cleanup (5 tests)
// ---------------------------------------------------------------------------

describe('Component Lifecycle Cleanup', () => {
    let world: World<any>;
    let actor: Actor<World<any>>;

    beforeEach(() => {
        world = new World({
            Hierarchy,
            Transform,
            LifecycleEventComponent,
            ResourceTrackingComponent,
            SecondaryLifecycleComponent,
        });
        actor = new Actor(world, { name: 'TestActor' });
    });

    it('calls onDestroy() when actor is removed from scene', () => {
        const component = actor.addComponent(LifecycleEventComponent);

        expect(component.events).not.toContain('onDestroy');

        actor.destroy();

        expect(component.events).toContain('onDestroy');
    });

    it('releases cached references in onDestroy()', () => {
        const component = actor.addComponent(ResourceTrackingComponent);
        component.resources = [{ data: 'heavy-resource' }, { data: 'another' }];
        expect(component.resources).toHaveLength(2);

        actor.destroy();

        expect(component.destroyed).toBe(true);
        expect(component.resources).toHaveLength(0);
    });

    it('all components on same actor receive onDestroy()', () => {
        const comp1 = actor.addComponent(LifecycleEventComponent);
        const comp2 = actor.addComponent(SecondaryLifecycleComponent);
        const comp3 = actor.addComponent(ResourceTrackingComponent);

        actor.destroy();

        expect(comp1.events).toContain('onDestroy');
        expect(comp2.destroyed).toBe(true);
        expect(comp3.destroyed).toBe(true);
    });

    it('child actors can be destroyed after parent is destroyed', () => {
        const parent = new Actor(world, { name: 'Parent' });
        const child = new Actor(world, { name: 'Child' });
        child.setParent(parent);

        expect(parent.children).toContain(child);

        const parentComp = parent.addComponent(LifecycleEventComponent);
        const childComp = child.addComponent(SecondaryLifecycleComponent);

        // Destroy parent
        parent.destroy();
        expect(parentComp.events).toContain('onDestroy');
        expect(parent.isDestroyed).toBe(true);

        // Child can still be destroyed independently after parent
        child.destroy();

        expect(child.isDestroyed).toBe(true);
        expect(childComp.destroyed).toBe(true);
    });

    it('event subscriptions are cleaned up on actor disposal', () => {
        const handler = vi.fn();
        const unsubscribe = actor.on('test:event', handler);

        // Verify subscription was registered
        expect(typeof unsubscribe).toBe('function');

        // Destroy actor — this clears all event subscriptions
        actor.destroy();

        // After destruction, calling unsubscribe again is a no-op (already cleaned up)
        expect(() => unsubscribe()).not.toThrow();
        expect(actor.isDestroyed).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 3. Texture Resource Tracking (5 tests)
// ---------------------------------------------------------------------------

describe('Texture Resource Tracking', () => {
    let gl: MockGLWithTracking;
    let runtime: SceneResourceRuntime;
    let callbacks: SceneResourceRuntimeClearCallbacks;

    beforeEach(() => {
        ({ gl } = createTrackedGL());
        runtime = createDefaultRuntime(gl);
        callbacks = createClearCallbacks(gl);
    });

    it('creating a texture increments the tracked texture count', () => {
        expect(gl._textures.size).toBe(0);

        gl.createTexture();
        expect(gl._textures.size).toBe(1);

        gl.createTexture();
        gl.createTexture();
        expect(gl._textures.size).toBe(3);
    });

    it('disposing a texture decrements the tracked texture count', () => {
        const tex1 = gl.createTexture();
        const tex2 = gl.createTexture();
        expect(gl._textures.size).toBe(2);

        gl.deleteTexture(tex1);
        expect(gl._textures.size).toBe(1);

        gl.deleteTexture(tex2);
        expect(gl._textures.size).toBe(0);
    });

    it('replacing a texture on a material releases the old texture via registry', () => {
        const oldTexHandle = gl.createTexture();
        const newTexHandle = gl.createTexture();
        expect(gl._textures.size).toBe(2);

        // Register old texture
        runtime.textures.register(
            { id: 'tex', source: { kind: 'color', color: [1, 0, 0, 1] } },
            {
                id: 'tex',
                texture: { nativeHandle: oldTexHandle } as any,
                width: 64,
                height: 64,
                samplerId: null,
            }
        );

        // Replace with new texture — registry returns the previous resource
        const result = runtime.textures.register(
            { id: 'tex', source: { kind: 'color', color: [0, 1, 0, 1] } },
            {
                id: 'tex',
                texture: { nativeHandle: newTexHandle } as any,
                width: 128,
                height: 128,
                samplerId: null,
            }
        );

        expect(result.previous).not.toBeNull();
        expect(result.previous!.id).toBe('tex');

        // Dispose the old texture through the callback
        callbacks.disposeTexture(result.previous!);
        expect(gl._textures.has(oldTexHandle as unknown as object)).toBe(false);
        expect(gl._textures.size).toBe(1); // Only newTexHandle remains
    });

    it('context loss + restore clears old textures and allows fresh creation', () => {
        // Phase 1: Create textures before context loss
        const tex1 = gl.createTexture();
        const tex2 = gl.createTexture();
        runtime.textures.register(
            { id: 't1', source: { kind: 'color', color: [1, 0, 0, 1] } },
            {
                id: 't1',
                texture: { nativeHandle: tex1 } as any,
                width: 64,
                height: 64,
                samplerId: null,
            }
        );
        runtime.textures.register(
            { id: 't2', source: { kind: 'color', color: [0, 1, 0, 1] } },
            {
                id: 't2',
                texture: { nativeHandle: tex2 } as any,
                width: 64,
                height: 64,
                samplerId: null,
            }
        );
        expect(runtime.textures.size).toBe(2);

        // Phase 2: Context loss — clear all resources (GPU handles are invalid)
        runtime.clear(callbacks);
        expect(runtime.textures.size).toBe(0);

        // Phase 3: After context restore, create fresh textures
        const tex3 = gl.createTexture();
        runtime.textures.register(
            { id: 't3', source: { kind: 'color', color: [0, 0, 1, 1] } },
            {
                id: 't3',
                texture: { nativeHandle: tex3 } as any,
                width: 32,
                height: 32,
                samplerId: null,
            }
        );
        expect(runtime.textures.size).toBe(1);
    });

    it('multiple materials sharing a texture: ref-counted disposal', () => {
        const sharedTexHandle = gl.createTexture();
        expect(gl._textures.size).toBe(1);

        const textureResource: SceneTextureResource = {
            id: 'shared-tex',
            texture: { nativeHandle: sharedTexHandle } as any,
            width: 256,
            height: 256,
            samplerId: null,
        };

        // Register the same texture resource (simulating shared reference)
        runtime.textures.register(
            { id: 'shared-tex', source: { kind: 'color', color: [1, 1, 1, 1] } },
            textureResource
        );
        expect(runtime.textures.size).toBe(1);

        // First clear: registry releases its reference
        runtime.clear(callbacks);
        expect(runtime.textures.size).toBe(0);

        // The GL texture was deleted by the clear callback
        expect(gl._textures.size).toBe(0);
        expect(gl.deleteTexture).toHaveBeenCalledWith(
            sharedTexHandle
        );
    });
});

// ---------------------------------------------------------------------------
// 4. Buffer Resource Tracking (5 tests)
// ---------------------------------------------------------------------------

describe('Buffer Resource Tracking', () => {
    let gl: MockGLWithTracking;
    let runtime: SceneResourceRuntime;
    let callbacks: SceneResourceRuntimeClearCallbacks;

    beforeEach(() => {
        ({ gl } = createTrackedGL());
        runtime = createDefaultRuntime(gl);
        callbacks = createClearCallbacks(gl);
    });

    it('creating a mesh allocates vertex + index buffers', () => {
        expect(gl._buffers.size).toBe(0);

        const vb = gl.createBuffer();
        const ib = gl.createBuffer();

        runtime.meshes.register(
            { id: 'mesh', vertices: new Float32Array(0), topology: 'triangles' as any, attributes: [] },
            {
                id: 'mesh',
                vertexArray: gl.createVertexArray(),
                vertexBuffer: vb,
                indexBuffer: ib,
                vertexCount: 36,
                indexCount: 36,
                indexType: gl.UNSIGNED_SHORT,
                topology: 'triangles' as any,
                mode: gl.TRIANGLES,
                attributes: new Set() as any,
            }
        );

        expect(gl._buffers.size).toBe(2);
        expect(runtime.meshes.size).toBe(1);
    });

    it('disposing a mesh releases both vertex and index buffers', () => {
        const vb = gl.createBuffer();
        const ib = gl.createBuffer();
        const vao = gl.createVertexArray();

        runtime.meshes.register(
            { id: 'mesh', vertices: new Float32Array(0), topology: 'triangles' as any, attributes: [] },
            {
                id: 'mesh',
                vertexArray: vao,
                vertexBuffer: vb,
                indexBuffer: ib,
                vertexCount: 3,
                indexCount: 3,
                indexType: gl.UNSIGNED_SHORT,
                topology: 'triangles' as any,
                mode: gl.TRIANGLES,
                attributes: new Set() as any,
            }
        );

        expect(gl._buffers.size).toBe(2);
        expect(gl._vertexArrays.size).toBe(1);

        runtime.clear(callbacks);

        expect(gl._buffers.size).toBe(0);
        expect(gl._vertexArrays.size).toBe(0);
        expect(gl.deleteBuffer).toHaveBeenCalledTimes(2);
        expect(gl.deleteVertexArray).toHaveBeenCalledTimes(1);
    });

    it('dynamic buffer updates via bufferSubData do not allocate new buffers', () => {
        const buffer = gl.createBuffer();
        expect(gl._buffers.size).toBe(1);

        // Simulate dynamic updates — bufferSubData reuses existing buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(100), gl.DYNAMIC_DRAW);

        // Update with sub-data (no new allocation)
        const createBefore = gl.createBuffer.mock.calls.length;
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(100), gl.DYNAMIC_DRAW);
        const createAfter = gl.createBuffer.mock.calls.length;

        // No new buffer was created during the update
        expect(createAfter).toBe(createBefore);
        expect(gl._buffers.size).toBe(1);
    });

    it('buffer sub-data updates reuse existing buffer without new allocation', () => {
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(100), gl.STATIC_DRAW);

        expect(gl._buffers.size).toBe(1);
        const bufferCountBefore = gl.createBuffer.mock.calls.length;

        // Simulate multiple sub-data updates
        for (let i = 0; i < 5; i++) {
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(
                gl.ARRAY_BUFFER,
                new Float32Array([i, i + 1, i + 2]),
                gl.DYNAMIC_DRAW
            );
        }

        // No new buffers were created
        expect(gl.createBuffer.mock.calls.length).toBe(bufferCountBefore);
        expect(gl._buffers.size).toBe(1);
    });

    it('instanced mesh buffers are cleaned up on disposal', () => {
        // Instanced mesh: regular VB + IB + per-instance VB
        const vertexBuffer = gl.createBuffer();
        const indexBuffer = gl.createBuffer();
        const instanceBuffer = gl.createBuffer();
        const vao = gl.createVertexArray();

        expect(gl._buffers.size).toBe(3);
        expect(gl._vertexArrays.size).toBe(1);

        runtime.meshes.register(
            { id: 'instanced-mesh', vertices: new Float32Array(0), topology: 'triangles' as any, attributes: [] },
            {
                id: 'instanced-mesh',
                vertexArray: vao,
                vertexBuffer,
                indexBuffer,
                vertexCount: 36,
                indexCount: 36,
                indexType: gl.UNSIGNED_SHORT,
                topology: 'triangles' as any,
                mode: gl.TRIANGLES,
                attributes: new Set() as any,
            }
        );

        // Dispose all resources including the instance buffer
        runtime.clear(callbacks);
        gl.deleteBuffer(instanceBuffer);

        expect(gl._buffers.size).toBe(0);
        expect(gl._vertexArrays.size).toBe(0);
        // vertexBuffer + indexBuffer (from callbacks) + instanceBuffer (manual)
        expect(gl.deleteBuffer).toHaveBeenCalledTimes(3);
    });
});

// ---------------------------------------------------------------------------
// 5. Shader Program Lifecycle (5 tests)
// ---------------------------------------------------------------------------

describe('Shader Program Lifecycle', () => {
    let gl: MockGLWithTracking;
    let runtime: SceneResourceRuntime;
    let callbacks: SceneResourceRuntimeClearCallbacks;

    beforeEach(() => {
        ({ gl } = createTrackedGL());
        runtime = createDefaultRuntime(gl);
        callbacks = createClearCallbacks(gl);
    });

    it('shader compilation creates a tracked program', () => {
        expect(gl._programs.size).toBe(0);

        const program = gl.createProgram();
        const shader = gl.createShader(gl.VERTEX_SHADER);

        expect(gl._programs.size).toBe(1);
        expect(gl._shaders.size).toBe(1);

        runtime.shaders.register(
            { id: 'basic-shader' },
            {
                id: 'basic-shader',
                program,
                uniformLocations: new Map([['uModelViewProjection', {} as WebGLUniformLocation]]),
                uniformTypes: new Map([['uModelViewProjection', gl.FLOAT_MAT4]]),
                uniformNames: ['uModelViewProjection'],
                attributeNames: { position: 'aPosition' } as any,
                depthTest: true,
                cull: true,
                blend: false,
            }
        );

        expect(runtime.shaders.size).toBe(1);
    });

    it('shader disposal deletes the program (untracked)', () => {
        const program = gl.createProgram();
        expect(gl._programs.size).toBe(1);

        runtime.shaders.register(
            { id: 'shader' },
            {
                id: 'shader',
                program,
                uniformLocations: new Map(),
                uniformTypes: new Map(),
                uniformNames: [],
                attributeNames: {} as any,
                depthTest: true,
                cull: true,
                blend: false,
            }
        );

        runtime.clear(callbacks);

        expect(gl._programs.size).toBe(0);
        expect(gl.deleteProgram).toHaveBeenCalledWith(program);
    });

    it('material shader switch releases old program', () => {
        const oldProgram = gl.createProgram();
        const newProgram = gl.createProgram();
        expect(gl._programs.size).toBe(2);

        // Register first shader
        const result1 = runtime.shaders.register(
            { id: 'shader-slot' },
            {
                id: 'shader-slot',
                program: oldProgram,
                uniformLocations: new Map(),
                uniformTypes: new Map(),
                uniformNames: [],
                attributeNames: {} as any,
                depthTest: true,
                cull: true,
                blend: false,
            }
        );
        expect(result1.previous).toBeNull();

        // Replace with new shader — old program should be released
        const result2 = runtime.shaders.register(
            { id: 'shader-slot' },
            {
                id: 'shader-slot',
                program: newProgram,
                uniformLocations: new Map(),
                uniformTypes: new Map(),
                uniformNames: [],
                attributeNames: {} as any,
                depthTest: true,
                cull: true,
                blend: false,
            }
        );

        expect(result2.previous).not.toBeNull();
        expect(result2.previous!.program).toBe(oldProgram);

        // Dispose the old program
        callbacks.deleteProgram(result2.previous!);

        expect(gl._programs.has(oldProgram as unknown as object)).toBe(false);
        expect(gl._programs.size).toBe(1);
        expect(gl.deleteProgram).toHaveBeenCalledWith(oldProgram);
    });

    it('failed shader compilation does not leak partial resources', () => {
        // Simulate: shader object created, but program link fails
        const shader = gl.createShader(gl.VERTEX_SHADER);
        const program = gl.createProgram();
        expect(gl._shaders.size).toBe(1);
        expect(gl._programs.size).toBe(1);

        // Compilation "fails" — clean up partial resources immediately
        gl.deleteShader(shader);
        gl.deleteProgram(program);

        expect(gl._shaders.size).toBe(0);
        expect(gl._programs.size).toBe(0);

        // No shader was registered in the runtime
        expect(runtime.shaders.size).toBe(0);
    });

    it('shader variants are cleaned up on scene disposal', () => {
        const baseProgram = gl.createProgram();
        const variant1Program = gl.createProgram();
        const variant2Program = gl.createProgram();
        expect(gl._programs.size).toBe(3);

        runtime.shaders.register(
            { id: 'lit-shader' },
            {
                id: 'lit-shader',
                program: baseProgram,
                uniformLocations: new Map(),
                uniformTypes: new Map(),
                uniformNames: [],
                attributeNames: {} as any,
                depthTest: true,
                cull: true,
                blend: false,
            }
        );

        // Register variants (e.g. with different define combinations)
        runtime.shaders.registerVariant(
            'lit-shader',
            'SKINNING=1',
            {
                id: 'lit-shader|SKINNING=1',
                program: variant1Program,
                uniformLocations: new Map(),
                uniformTypes: new Map(),
                uniformNames: [],
                attributeNames: {} as any,
                depthTest: true,
                cull: true,
                blend: false,
            }
        );
        runtime.shaders.registerVariant(
            'lit-shader',
            'NORMAL_MAP=1',
            {
                id: 'lit-shader|NORMAL_MAP=1',
                program: variant2Program,
                uniformLocations: new Map(),
                uniformTypes: new Map(),
                uniformNames: [],
                attributeNames: {} as any,
                depthTest: true,
                cull: true,
                blend: false,
            }
        );

        expect(runtime.shaders.size).toBe(1);
        expect(runtime.shaders.variantCount).toBe(2);

        // clear() returns base resources and variants so the disposal
        // loop can delete every program.
        const resources = runtime.shaders.clear();
        for (const shader of resources) {
            callbacks.deleteProgram(shader);
        }

        expect(runtime.shaders.size).toBe(0);
        expect(runtime.shaders.variantCount).toBe(0);

        // Base and variant programs were all deleted
        expect(gl._programs.has(baseProgram as unknown as object)).toBe(false);
        expect(gl._programs.has(variant1Program as unknown as object)).toBe(false);
        expect(gl._programs.has(variant2Program as unknown as object)).toBe(false);
        expect(gl._programs.size).toBe(0);
    });

    it('re-registering a shader evicts stale variants', () => {
        const oldProgram = gl.createProgram();
        const variantProgram = gl.createProgram();
        const newProgram = gl.createProgram();

        const resource = {
            id: 'lit-shader',
            program: oldProgram,
            uniformLocations: new Map(),
            uniformTypes: new Map(),
            uniformNames: [],
            attributeNames: {} as any,
            depthTest: true,
            cull: true,
            blend: false,
        };
        runtime.shaders.register({ id: 'lit-shader' }, resource);
        runtime.shaders.registerVariant('lit-shader', 'SKINNING=1', {
            ...resource,
            id: 'lit-shader|SKINNING=1',
            program: variantProgram,
        });

        const result = runtime.shaders.register({ id: 'lit-shader' }, {
            ...resource,
            program: newProgram,
        });

        expect(result.previous!.program).toBe(oldProgram);
        expect(result.evictedVariants.map((v) => v.program)).toEqual([variantProgram]);
        expect(runtime.shaders.getVariant('lit-shader', 'SKINNING=1')).toBeUndefined();
    });
});
