import { describe, expect, it } from 'vitest';
import {
    cloneSceneShaderDefinition,
    SceneShaderRegistry,
    type SceneShaderResource,
} from '@axrone/scene-3d';

const createShaderResource = (id: string): SceneShaderResource => ({
    id,
    program: { id } as unknown as WebGLProgram,
    uniformLocations: new Map(),
    uniformTypes: new Map(),
    uniformNames: ['u_Model', 'u_View'],
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
});

describe('SceneShaderRegistry', () => {
    it('stores shader resources and returns handles', () => {
        const registry = new SceneShaderRegistry();
        const result = registry.register(
            {
                id: 'basic',
                vertexSource: 'void main() {}',
                fragmentSource: 'void main() {}',
                uniforms: ['u_Model', 'u_View'],
            },
            createShaderResource('basic')
        );

        expect(result.previous).toBeNull();
        expect(result.handle).toEqual({
            id: 'basic',
            uniformNames: ['u_Model', 'u_View'],
        });
        expect(registry.getHandle('basic')).toEqual(result.handle);
        expect(registry.get('basic')?.program).toEqual({ id: 'basic' });
    });

    it('returns the replaced shader resource on re-registration', () => {
        const registry = new SceneShaderRegistry();
        const first = createShaderResource('basic');
        const second = createShaderResource('basic');

        registry.register(
            {
                id: 'basic',
                vertexSource: 'void main() {}',
                fragmentSource: 'void main() {}',
            },
            first
        );

        const result = registry.register(
            {
                id: 'basic',
                vertexSource: 'void main() { gl_Position = vec4(1.0); }',
                fragmentSource: 'void main() {}',
            },
            second
        );

        expect(result.previous).toBe(first);
        expect(registry.get('basic')).toBe(second);
    });

    it('clones shader definitions and clears resources deterministically', () => {
        const registry = new SceneShaderRegistry();
        const definition = {
            id: 'basic',
            vertexSource: 'void main() {}',
            fragmentSource: 'void main() {}',
            uniforms: ['u_Model'],
            attributes: {
                position: 'a_Position',
            },
        };

        registry.register(definition, createShaderResource('basic'));
        definition.uniforms.push('u_View');
        definition.attributes.position = 'mutated';

        const [storedDefinition] = registry.getDefinitions();
        const cleared = registry.clear();

        expect(storedDefinition?.uniforms).toEqual(['u_Model']);
        expect(storedDefinition?.attributes?.position).toBe('a_Position');
        expect(cleared).toHaveLength(1);
        expect(registry.getDefinitions()).toEqual([]);
        expect(registry.getResources()).toEqual([]);
    });

    it('clones definitions with helper utility', () => {
        const definition = {
            id: 'basic',
            vertexSource: 'void main() {}',
            fragmentSource: 'void main() {}',
            uniforms: ['u_Model'],
            attributes: {
                position: 'a_Position',
            },
        };

        const cloned = cloneSceneShaderDefinition(definition);
        definition.uniforms.push('u_View');
        definition.attributes.position = 'mutated';

        expect(cloned).not.toBe(definition);
        expect(cloned.uniforms).toEqual(['u_Model']);
        expect(cloned.attributes?.position).toBe('a_Position');
    });
});
