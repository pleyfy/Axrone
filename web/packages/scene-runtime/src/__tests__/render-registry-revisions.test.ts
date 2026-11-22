import { describe, expect, it } from 'vitest';
import { SceneMaterialRegistry } from '../material-registry';
import { SceneMeshRegistry } from '../mesh-registry';
import { SceneShaderRegistry } from '../shader-registry';
import type { SceneMeshResource } from '../mesh-registry';
import type { SceneShaderResource } from '../shader-registry';

describe('SceneMaterialRegistry revision', () => {
    it('advances on create, mutations and delete but not on idempotent create', () => {
        const registry = new SceneMaterialRegistry();
        const initial = registry.revision;

        registry.create({ id: 'material:a', shaderId: 'shader:standard' });
        expect(registry.revision).toBeGreaterThan(initial);

        const afterCreate = registry.revision;
        registry.create({ id: 'material:a', shaderId: 'shader:standard' });
        expect(registry.revision).toBe(afterCreate);

        const checkpoints: (() => void)[] = [
            () => {
                registry.setUniform('material:a', 'u_Color', [1, 0, 0, 1]);
            },
            () => {
                registry.setUniforms('material:a', { u_Roughness: 0.5 });
            },
            () => {
                registry.setTexture('material:a', 'u_MainTex', 'texture:main');
            },
            () => {
                registry.removeTexture('material:a', 'u_MainTex');
            },
            () => {
                registry.setKeyword('material:a', 'USE_FOG', true);
            },
            () => {
                registry.toggleKeyword('material:a', 'USE_FOG');
            },
            () => {
                registry.clone('material:a', 'material:b');
            },
            () => {
                registry.delete('material:a');
            },
            () => {
                registry.clear();
            },
        ];

        for (const step of checkpoints) {
            const before = registry.revision;
            step();
            expect(registry.revision).toBeGreaterThan(before);
        }
    });
});

describe('SceneMeshRegistry revision', () => {
    it('advances on register and clear', () => {
        const registry = new SceneMeshRegistry();
        const initial = registry.revision;

        const resource = {
            id: 'mesh:a',
            vertexArray: {} as WebGLVertexArrayObject,
            vertexBuffer: {} as WebGLBuffer,
            indexBuffer: null,
            vertexCount: 3,
            indexCount: 0,
            indexType: null,
            topology: 'triangles',
            mode: 4,
            attributes: new Set(),
        } as unknown as SceneMeshResource;

        registry.register(
            { id: 'mesh:a', vertices: new Float32Array(9), attributes: [] },
            resource
        );
        expect(registry.revision).toBeGreaterThan(initial);

        const afterRegister = registry.revision;
        registry.clear();
        expect(registry.revision).toBeGreaterThan(afterRegister);
    });
});

describe('SceneShaderRegistry revision', () => {
    it('advances on register, variants and clears', () => {
        const registry = new SceneShaderRegistry();
        const resource = {} as SceneShaderResource;
        const initial = registry.revision;

        registry.register({ id: 'shader:a', vertexSource: 'v', fragmentSource: 'f' }, resource);
        expect(registry.revision).toBeGreaterThan(initial);

        const afterRegister = registry.revision;
        registry.registerVariant('shader:a', 'variant:0', resource);
        expect(registry.revision).toBeGreaterThan(afterRegister);

        const afterVariant = registry.revision;
        registry.clearVariantsForShader('shader:a');
        expect(registry.revision).toBeGreaterThan(afterVariant);

        registry.registerVariant('shader:a', 'variant:1', resource);
        const afterSecondVariant = registry.revision;
        registry.clearVariants();
        expect(registry.revision).toBeGreaterThan(afterSecondVariant);

        const afterClearVariants = registry.revision;
        registry.clear();
        expect(registry.revision).toBeGreaterThan(afterClearVariants);
    });
});
