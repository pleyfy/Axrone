import { describe, expect, it } from 'vitest';
import { WorldDiagnostics } from '../../component-system/core/world-diagnostics';

describe('WorldDiagnostics', () => {
    it('tracks counters and derives stable metrics snapshots when enabled', () => {
        const diagnostics = new WorldDiagnostics(true);

        diagnostics.markMutation();
        diagnostics.recordQuery();
        diagnostics.recordEvent();

        const metrics = diagnostics.getMetrics({
            entityCount: 3,
            archetypeCount: 2,
            actorCount: 1,
            freeEntityCount: 4,
            componentTypes: ['Transform', 'TestComponent', 'Another', 'Camera', 'Light'],
        });

        expect(metrics).toEqual({
            entityCount: 3,
            archetypeCount: 2,
            queryCount: 1,
            eventCount: 1,
            memoryUsage: 2890,
            lastUpdateTime: expect.any(Number),
        });
    });

    it('returns null metrics when diagnostics are disabled', () => {
        const diagnostics = new WorldDiagnostics(false);

        diagnostics.markMutation();
        diagnostics.recordQuery();
        diagnostics.recordEvent();

        expect(
            diagnostics.getMetrics({
                entityCount: 1,
                archetypeCount: 1,
                actorCount: 1,
                freeEntityCount: 0,
                componentTypes: ['Transform'],
            })
        ).toBeNull();
    });
});
