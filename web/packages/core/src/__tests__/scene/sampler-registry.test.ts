import { describe, expect, it } from 'vitest';
import {
    cloneSceneSamplerDefinition,
    SceneSamplerRegistry,
    type SceneSamplerResource,
} from '../../scene/sampler-registry';

const createSamplerResource = (id: string): SceneSamplerResource => ({
    id,
    sampler: {
        nativeHandle: { id } as WebGLSampler,
        isDisposed: false,
        bind: () => {},
        dispose: () => {},
    } as any,
});

describe('SceneSamplerRegistry', () => {
    it('stores sampler resources and resolves fallbacks', () => {
        const registry = new SceneSamplerRegistry();
        const fallback = createSamplerResource('fallback').sampler;
        registry.register(
            {
                id: 'linear',
            },
            createSamplerResource('linear')
        );

        expect(registry.getHandle('linear')).toEqual({ id: 'linear' });
        expect(registry.resolve('linear', fallback)).toBe(registry.get('linear')?.sampler);
        expect(registry.resolve(null, fallback)).toBe(fallback);
    });

    it('returns the replaced sampler resource and clones definitions', () => {
        const registry = new SceneSamplerRegistry();
        const first = createSamplerResource('linear');
        const second = createSamplerResource('linear');
        const definition = {
            id: 'linear',
            maxAnisotropy: 4,
        };

        registry.register(definition, first);
        definition.maxAnisotropy = 8;
        const result = registry.register(
            {
                id: 'linear',
                maxAnisotropy: 2,
            },
            second
        );

        expect(result.previous).toBe(first);
        expect(registry.getDefinitions()[0]?.maxAnisotropy).toBe(2);
        expect(cloneSceneSamplerDefinition({ id: 'nearest' })).toEqual({ id: 'nearest' });
    });
});
