import { describe, expect, it } from 'vitest';
import { createLightingUniformLayout } from '../uniform-layout';

describe('lighting uniform layout', () => {
    it('exposes per-kind property metadata for the modern lighting contract', () => {
        const layout = createLightingUniformLayout({
            maxDirectionalLights: 1,
            maxPointLights: 3,
            maxSpotLights: 2,
            maxLocalLights: 4,
        });

        expect(layout.names.directionalLightCount).toBe('u_DirectionalLightCount');
        expect(layout.properties.find((property) => property.name === 'u_DirectionalLightDirection')?.arrayLength).toBe(1);
        expect(layout.properties.find((property) => property.name === 'u_PointLightPosition')?.arrayLength).toBe(3);
        expect(layout.properties.find((property) => property.name === 'u_SpotLightInnerConeCosine')?.arrayLength).toBe(2);
        expect(layout.properties.find((property) => property.name === 'u_LocalLightKind')?.type).toBe('int');
    });
});