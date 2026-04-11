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
            uniformLocations: new Map(),
            uniformTypes: new Map(),
            uniformNames: [],
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
            textureBindings: new Map(),
        };

        const renderStateApplier = { apply: vi.fn() };
        const frameUniformBinder = { apply: vi.fn() };
        const lightingUniformBinder = { apply: vi.fn() };
        const skinningUniformBinder = { apply: vi.fn() };
        const materialTextureBinder = {
            bind: vi.fn(),
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
                    getTextureSlots: () => [],
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
                resolveSampler: () => ({ bind: vi.fn() } as any),
            },
            morphMeshRuntime: {
                resolve: vi.fn(() => mesh as any),
            } as any,
            renderStateApplier,
            frameUniformBinder,
            lightingUniformBinder,
            skinningUniformBinder,
            materialTextureBinder,
            uniformWriter,
            textureUniformSetter: vi.fn(),
            applyMissingVertexAttributeDefaults,
        });

        const frameState = new SceneRenderFrameState().begin(9);

        executor.execute(
            {
                transform: {
                    worldMatrix: new Mat4(),
                } as any,
                renderer: {
                    id: 'renderer-1',
                    meshId: 'mesh',
                    materialId: 'material',
                    getUniformEntries: () => [['u_Instance', instanceUniform]] as const,
                } as any,
            },
            {
                renderPass: {} as any,
                cameraFrame: {
                    camera: {} as any,
                    viewMatrix: new Mat4(),
                    projectionMatrix: new Mat4(),
                    viewProjectionMatrix: new Mat4(),
                    position: new Vec3(0, 0, 5),
                },
                lighting: {} as any,
                elapsedSeconds: 1,
                deltaSeconds: 0.016,
                frame: 9,
                viewportWidth: 1280,
                viewportHeight: 720,
            },
            frameState
        );

        expect(renderStateApplier.apply).toHaveBeenCalledTimes(1);
        expect(gl.useProgram).toHaveBeenCalledWith(shader.program);
        expect(gl.bindVertexArray).toHaveBeenCalledWith(mesh.vertexArray);
        expect(applyMissingVertexAttributeDefaults).toHaveBeenCalledWith(mesh);
        expect(frameUniformBinder.apply).toHaveBeenCalledTimes(1);
        expect(lightingUniformBinder.apply).toHaveBeenCalledTimes(1);
        expect(skinningUniformBinder.apply).toHaveBeenCalledTimes(1);
        expect(materialTextureBinder.bind).toHaveBeenCalledTimes(1);
        expect(materialTextureBinder.unbind).toHaveBeenCalledTimes(1);
        expect(uniformWriter.write).toHaveBeenNthCalledWith(1, shader, 'u_Base', 1);
        expect(uniformWriter.write).toHaveBeenNthCalledWith(2, shader, 'u_Instance', instanceUniform);
        expect(gl.drawElements).toHaveBeenCalledWith(4, 6, 5123, 0);
        expect(frameState.drawCalls).toBe(1);
        expect(frameState.trianglesSubmitted).toBe(2);
        expect([...frameState.activeRendererIds]).toEqual(['renderer-1']);
    });
});
