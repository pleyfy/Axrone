import { describe, expect, it } from 'vitest';
import {
    attenuationGainForDistance,
    cloneSpatialization,
    normalizeAttenuation,
} from '../internal/spatial';
import { hasOwnKeys, withRetry } from '../internal/shared';

describe('audio internal helpers', () => {
    it('clones spatialization payloads without retaining nested references', () => {
        const source = {
            mode: '3d' as const,
            position: { x: 4, y: 2, z: -1 },
            orientation: { x: 0, y: 0, z: -1 },
            attenuation: {
                model: 'linear' as const,
                refDistance: 2,
                maxDistance: 8,
                rolloffFactor: 0.5,
                minGain: 0.25,
            },
        };

        const cloned = cloneSpatialization(source);

        expect(cloned).toEqual(source);
        expect(cloned).not.toBe(source);
        expect(cloned?.position).not.toBe(source.position);
        expect(cloned?.orientation).not.toBe(source.orientation);
        expect(cloned?.attenuation).not.toBe(source.attenuation);
    });

    it('normalizes attenuation ranges and clamps gain to the configured floor', () => {
        const normalized = normalizeAttenuation({
            model: 'linear',
            refDistance: -2,
            maxDistance: 0,
            rolloffFactor: -3,
            minGain: 4,
        });

        expect(normalized).toEqual({
            model: 'linear',
            refDistance: 0.0001,
            maxDistance: 0.0001,
            rolloffFactor: 0,
            minGain: 1,
        });
        expect(
            attenuationGainForDistance(128, {
                model: 'linear',
                refDistance: 1,
                maxDistance: 4,
                rolloffFactor: 1,
                minGain: 0.2,
            })
        ).toBe(0.2);
    });

    it('retries operations with zero-allocation guard helpers around partial patches', async () => {
        let attempts = 0;

        const result = await withRetry(
            {
                attempts: 3,
                backoffMs: 0,
            },
            (attempt) => ({
                operation: 'context.resume' as const,
                attempt,
            }),
            async () => {
                attempts += 1;
                if (attempts < 3) {
                    throw new Error(`attempt:${attempts}`);
                }

                return 'ready';
            }
        );

        expect(result).toBe('ready');
        expect(attempts).toBe(3);
        expect(hasOwnKeys({ volume: 1 })).toBe(true);
        expect(hasOwnKeys({})).toBe(false);
    });
});
