import { describe, expect, it } from 'vitest';
import { DirectionalLight } from '../components/directional-light';
import { PointLight } from '../components/point-light';
import { SpotLight } from '../components/spot-light';

describe('scene-runtime light components', () => {
    it('validates point light ranges through the lighting package rules', () => {
        expect(() => new PointLight({ range: 0 })).toThrow();

        const light = new PointLight({
            color: [0.5, 0.25, 1],
            intensity: 2,
            range: 9,
        });

        expect(light.range).toBe(9);
        expect(() => light.deserialize({ range: -1 })).toThrow();
        expect(light.range).toBe(9);
    });

    it('validates directional light intensity updates without corrupting state', () => {
        const light = new DirectionalLight({
            ambientColor: [0.1, 0.2, 0.3],
            intensity: 2,
            primary: true,
        });

        expect(light.intensity).toBe(2);
        expect(light.primary).toBe(true);
        expect(() => {
            light.intensity = -1;
        }).toThrow();
        expect(light.intensity).toBe(2);
        expect(light.primary).toBe(true);
    });

    it('validates spot cone ordering and preserves the last valid cone state', () => {
        const light = new SpotLight({
            innerConeAngle: 0.2,
            outerConeAngle: 0.6,
        });

        expect(light.innerConeAngle).toBeCloseTo(0.2);
        expect(light.outerConeAngle).toBeCloseTo(0.6);

        expect(() => {
            light.innerConeAngle = 0.8;
        }).toThrow();
        expect(light.innerConeAngle).toBeCloseTo(0.2);
        expect(light.outerConeAngle).toBeCloseTo(0.6);

        expect(() => {
            light.deserialize({ innerConeAngle: 0.7, outerConeAngle: 0.3 });
        }).toThrow();
        expect(light.innerConeAngle).toBeCloseTo(0.2);
        expect(light.outerConeAngle).toBeCloseTo(0.6);
    });
});