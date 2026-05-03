import { describe, expect, it, vi } from 'vitest';
import { LightKind } from '../constants';
import { LightingDisposedError, LightingValidationError } from '../errors';
import { LightingRig } from '../rig';
import type { LightingSelectionState } from '../types';

describe('LightingRig', () => {
    it('tracks versioned light lifecycle and immutable ordering', () => {
        const rig = new LightingRig({
            environment: {
                ambient: [0.2, 0.1, 0.05],
            },
        });
        const directional = rig.addDirectional({
            id: 'directional',
            direction: [0, -1, 0],
        });
        const point = rig.addPoint({
            id: 'point',
            position: [1, 2, 3],
            range: 5,
        });
        const spot = rig.addSpot({
            id: 'spot',
            position: [3, 2, 1],
            direction: [0, -1, 0],
            coneMode: 'cosine',
            innerConeCosine: 0.9,
            outerConeCosine: 0.7,
        });

        expect(Number(rig.version)).toBe(3);
        expect(rig.size).toBe(3);
        expect(rig.has(point.id)).toBe(true);
        expect(rig.get(directional.id)?.kind).toBe(LightKind.Directional);
        expect(rig.list().map((light) => String(light.id))).toEqual([
            'directional',
            'point',
            'spot',
        ]);

        rig.setEnvironment({ gamma: 1.8 });
        expect(Number(rig.version)).toBe(4);
        expect(rig.environment.gamma).toBe(1.8);

        rig.resetEnvironment();
        expect(Number(rig.version)).toBe(5);
        expect(rig.environment.gamma).toBe(2.2);

        expect(rig.remove('missing')).toBe(false);
        expect(rig.remove(point.id)).toBe(true);
        expect(rig.has(point.id)).toBe(false);
        expect(rig.list().map((light) => String(light.id))).toEqual([
            'directional',
            'spot',
        ]);

        const versionBeforeClear = Number(rig.version);
        rig.clear();
        expect(rig.size).toBe(0);
        expect(Number(rig.version)).toBe(versionBeforeClear + 1);

        rig.clear();
        expect(Number(rig.version)).toBe(versionBeforeClear + 1);
    });

    it('updates lights by kind and rejects duplicate or missing ids', () => {
        const rig = new LightingRig();
        const directional = rig.addDirectional({
            id: 'directional',
            direction: [0, -1, 0],
        });
        const point = rig.addPoint({
            id: 'point',
            position: [1, 2, 3],
            range: 4,
        });
        const spot = rig.addSpot({
            id: 'spot',
            direction: [0, -1, 0],
            coneMode: 'cosine',
            innerConeCosine: 0.85,
            outerConeCosine: 0.7,
        });

        const updatedDirectional = rig.update(directional.id, {
            ambient: [0.1, 0.2, 0.3],
            intensity: 4,
        });
        const updatedPoint = rig.update(point.id, {
            position: [9, 8, 7],
            range: 10,
        });
        const updatedSpot = rig.update(spot.id, {
            coneMode: 'angle',
            innerConeAngle: 0.2,
            outerConeAngle: 0.4,
        });

        expect(updatedDirectional.intensity).toBe(4);
        expect(updatedPoint.range).toBe(10);
        expect(Array.from([updatedPoint.position.x, updatedPoint.position.y, updatedPoint.position.z])).toEqual([
            9,
            8,
            7,
        ]);
        expect(updatedSpot.innerConeCosine).toBeCloseTo(Math.cos(0.2));
        expect(rig.list().map((light) => String(light.id))).toEqual([
            'directional',
            'point',
            'spot',
        ]);

        expect(() =>
            rig.addSpot({
                id: 'point',
                direction: [0, -1, 0],
                coneMode: 'cosine',
                innerConeCosine: 0.9,
                outerConeCosine: 0.7,
            })
        ).toThrow(LightingValidationError);
        expect(() =>
            rig.update('missing', {
                range: 1,
            })
        ).toThrow(LightingValidationError);
    });

    it('delegates frame resolution and enforces disposal boundaries', () => {
        const rig = new LightingRig();
        const state = {} as LightingSelectionState;
        const resolver = {
            resolve: vi.fn(() => state),
        };

        expect(
            rig.resolveFrame(resolver, {
                cameraPosition: [0, 0, 0],
            })
        ).toBe(state);
        expect(resolver.resolve).toHaveBeenCalledWith(rig, {
            cameraPosition: [0, 0, 0],
        });

        rig.dispose();
        expect(rig.isDisposed).toBe(true);
        expect(() => rig.version).toThrow(LightingDisposedError);
        expect(() => rig.list()).toThrow(LightingDisposedError);
        expect(() => rig.get('missing')).toThrow(LightingDisposedError);
        expect(() => rig.addPoint({})).toThrow(LightingDisposedError);

        rig.dispose();
        expect(rig.isDisposed).toBe(true);
    });
});