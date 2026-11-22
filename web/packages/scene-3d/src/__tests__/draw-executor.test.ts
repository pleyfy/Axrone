import { Mat4, Vec3 } from '@axrone/numeric';
import { describe, expect, it, vi } from 'vitest';
import type { SceneShaderResource } from '@axrone/scene-3d';
import { SceneDrawExecutor } from '@axrone/scene-3d';
import { SceneRenderFrameState } from '@axrone/scene-3d';

describe('SceneDrawExecutor', () => {
    it('executes a draw, records frame stats, and binds material overrides', () => {
        const gl = {
            useProgram: vi.fn(),
            bindVertexArray: vi.fn(),
            drawElements: vi.fn(),
            drawArrays: vi.fn(),
        } as unknown as WebGL2RenderingContext;

        const shader = {
            id: 'shader',
            program: {} as WebGLProgram,
            // The executor only invokes the skinning binder when the program
            // declares a skinning uniform.
            uniformLocations: new Map([['u_Skinning', {} as WebGLUniformLocation]]),
            uniformTypes: new Map(),
            uniformNames: ['u_Skinning'],
            attributeNames: {},
            depthTest: true,
            cull: true,
            blend: false,
        } satisfies SceneShaderResource;
        const mesh = {
            id: 'mesh',
            vertexArray: {} as WebGLVertexArrayObject,
            vertexBuffer: {} as WebGLBuffer,
            indexBuffer: {} as WebGLBuffer,
            vertexCount: 3,
            indexCount: 6,
            indexType: 5123,
            topology: 'triangles',
            mode: 4,
            attributes: new Set(['position']),
        };
        const material = {
            id: 'material',
            shaderId: 'shader',
            uniforms: new Map([['u_Base', 1]]),
            textureBindings: new Map([['u_Texture', 'texture']]),
        };
        const textureSlots = [
            {
                uniformName: 'u_Texture',
                binding: { textureId: 'texture', samplerId: null },
                resolvedUnit: 0,
            },
        ];

        const renderStateApplier = { apply: vi.fn() };
        const frameUniformBinder = { apply: vi.fn() };
        const lightingUniformBinder = { apply: vi.fn() };
        const fogUniformBinder = { apply: vi.fn() };
        const skinningUniformBinder = { apply: vi.fn() };
        const materialTextureBinder = {
            // The cached path stores the units the real binder returned so it
            // knows whether an unbind is owed at the pass boundary.
            bind: vi.fn(() => [0]),
            unbind: vi.fn(),
        };
        const uniformWriter = { write: vi.fn() };
        const applyMissingVertexAttributeDefaults = vi.fn();
        const instanceUniform = new Vec3(1, 2, 3);

        const executor = new SceneDrawExecutor({
            gl,
            resources: {
                materials: {
                    get: (id: string) => (id === 'material' ? (material as any) : undefined),
                    getTextureSlots: () => textureSlots,
                },
                meshes: {
                    get: (id: string) => (id === 'mesh' ? (mesh as any) : undefined),
                    getDefinition: () => undefined,
                },
                shaders: {
                    get: (id: string) => (id === 'shader' ? shader : undefined),
                },
                textures: {
                    get: () => undefined,
                },
                resolveSampler: () => ({ bind: vi.fn() }) as any,
            },
            morphMeshRuntime: {
                resolve: vi.fn(() => mesh as any),
            } as any,
            renderStateApplier,
            frameUniformBinder,
            lightingUniformBinder,
            fogUniformBinder,
            skinningUniformBinder,
            materialTextureBinder,
            uniformWriter,
            textureUniformSetter: vi.fn(),
            applyMissingVertexAttributeDefaults,
        });

        const frameState = new SceneRenderFrameState().begin(9);

        const item = {
            transform: {
                worldMatrix: new Mat4(),
            } as any,
            renderer: {
                id: 'renderer-1',
                meshId: 'mesh',
                materialId: 'material',
                getUniformEntries: () => [['u_Instance', instanceUniform]] as const,
                forEachUniformEntry: (cb: (name: string, value: unknown) => void) =>
                    cb('u_Instance', instanceUniform),
            } as any,
        };
        const context = {
            renderPass: {} as any,
            cameraFrame: {
                camera: {} as any,
                viewMatrix: new Mat4(),
                projectionMatrix: new Mat4(),
                viewProjectionMatrix: new Mat4(),
                position: new Vec3(0, 0, 5),
            },
            lighting: {} as any,
            fog: {} as any,
            elapsedSeconds: 1,
            deltaSeconds: 0.016,
            frame: 9,
            viewportWidth: 1280,
            viewportHeight: 720,
        };

        executor.execute(item, context, frameState);

        expect(renderStateApplier.apply).toHaveBeenCalledTimes(1);
        expect(gl.useProgram).toHaveBeenCalledWith(shader.program);
        expect(gl.bindVertexArray).toHaveBeenCalledWith(mesh.vertexArray);
        expect(applyMissingVertexAttributeDefaults).toHaveBeenCalledWith(mesh);
        expect(frameUniformBinder.apply).toHaveBeenCalledTimes(1);
        expect(lightingUniformBinder.apply).toHaveBeenCalledTimes(1);
        expect(fogUniformBinder.apply).toHaveBeenCalledTimes(1);
        expect(fogUniformBinder.apply).toHaveBeenCalledWith(shader, {});
        expect(skinningUniformBinder.apply).toHaveBeenCalledTimes(1);
        expect(materialTextureBinder.bind).toHaveBeenCalledTimes(1);
        // The binding stays cached until the pass boundary owns the unbind.
        expect(materialTextureBinder.unbind).toHaveBeenCalledTimes(0);
        expect(uniformWriter.write).toHaveBeenNthCalledWith(1, shader, 'u_Base', 1);
        expect(uniformWriter.write).toHaveBeenNthCalledWith(
            2,
            shader,
            'u_Instance',
            instanceUniform
        );
        expect(gl.drawElements).toHaveBeenCalledWith(4, 6, 5123, 0);
        expect(frameState.drawCalls).toBe(1);
        expect(frameState.trianglesSubmitted).toBe(2);
        expect([...frameState.activeRendererIds]).toEqual(['renderer-1']);

        executor.execute(item, context, frameState);
        expect(renderStateApplier.apply).toHaveBeenCalledTimes(1);
        expect(gl.useProgram).toHaveBeenCalledTimes(1);
        expect(gl.bindVertexArray).toHaveBeenCalledTimes(1);
        expect(applyMissingVertexAttributeDefaults).toHaveBeenCalledTimes(1);
        expect(gl.drawElements).toHaveBeenCalledTimes(2);
        // Same material/signature: the second draw reuses the bound texture.
        expect(materialTextureBinder.bind).toHaveBeenCalledTimes(1);
        expect(materialTextureBinder.unbind).toHaveBeenCalledTimes(0);

        executor.flushTextureBindings();
        expect(materialTextureBinder.unbind).toHaveBeenCalledTimes(1);

        executor.resetState();
        executor.execute(item, context, frameState);
        expect(renderStateApplier.apply).toHaveBeenCalledTimes(2);
        expect(gl.useProgram).toHaveBeenCalledTimes(2);
        expect(gl.drawElements).toHaveBeenCalledTimes(3);
        expect(materialTextureBinder.bind).toHaveBeenCalledTimes(2);
        executor.flushTextureBindings();
        expect(materialTextureBinder.unbind).toHaveBeenCalledTimes(2);
    });
});
