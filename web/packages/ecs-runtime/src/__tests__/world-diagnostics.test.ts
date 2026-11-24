import { describe, expect, it } from 'vitest';
import { WorldDiagnostics } from '@axrone/ecs-runtime';

describe('WorldDiagnostics', () => {
    it('tracks counters and derives stable metrics snapshots when enabled', () => {
        const diagnostics = new WorldDiagnostics(true);

        diagnostics.markMutation();
        diagnostics.recordQuery();
        diagnostics.recordEvent();

        const metrics = diagnostics.getMetrics({
            entityCount: 3,
            archetypeCount: 2,
            registeredEntityCount: 1,
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
                registeredEntityCount: 1,
                freeEntityCount: 0,
                componentTypes: ['Transform'],
            })
        ).toBeNull();
    });

    // ─── getDebugInfo ───────────────────────────────────────────────

    describe('getDebugInfo', () => {
        it('returns correct structure with all expected fields', () => {
            const diagnostics = new WorldDiagnostics(true);
            diagnostics.markMutation();
            diagnostics.recordQuery();

            const snapshot = {
                state: 'running',
                config: { enableValidation: true },
                entityCount: 5,
                archetypeCount: 3,
                registeredEntityCount: 2,
                freeEntityCount: 1,
                nextEntityId: 7,
                componentTypes: ['Transform', 'Mesh'],
                archetypes: [
                    { id: 'EMPTY', signature: [], entityCount: 1, mask: '0' },
                    { id: 'Transform', signature: ['Transform'], entityCount: 3, mask: '1' },
                ],
            };

            const debug = diagnostics.getDebugInfo(snapshot);

            expect(debug).toMatchObject({
                state: 'running',
                config: { enableValidation: true },
                entityCount: 5,
                archetypeCount: 3,
                freeEntityCount: 1,
                nextEntityId: 7,
                componentTypes: ['Transform', 'Mesh'],
                archetypes: snapshot.archetypes,
            });

            expect(debug.creationTime).toBeDefined();
            expect(typeof debug.creationTime).toBe('number');
            expect(debug.metrics).toBeDefined();
            expect(debug.queryCache).toEqual({ enabled: true, invalidated: false });
        });

        it('includes metrics when enabled', () => {
            const diagnostics = new WorldDiagnostics(true);
            diagnostics.recordQuery();
            diagnostics.recordEvent();

            const snapshot = {
                state: 'running',
                config: {},
                entityCount: 2,
                archetypeCount: 1,
                registeredEntityCount: 1,
                freeEntityCount: 0,
                nextEntityId: 3,
                componentTypes: ['Transform'],
                archetypes: [],
            };

            const debug = diagnostics.getDebugInfo(snapshot);
            expect(debug.metrics).toEqual({
                entityCount: 2,
                archetypeCount: 1,
                queryCount: 1,
                eventCount: 1,
                memoryUsage: expect.any(Number),
                lastUpdateTime: expect.any(Number),
            });
        });

        it('metrics is null when disabled', () => {
            const diagnostics = new WorldDiagnostics(false);

            const snapshot = {
                state: 'idle',
                config: {},
                entityCount: 0,
                archetypeCount: 0,
                registeredEntityCount: 0,
                freeEntityCount: 0,
                nextEntityId: 1,
                componentTypes: [],
                archetypes: [],
            };

            const debug = diagnostics.getDebugInfo(snapshot);
            expect(debug.metrics).toBeNull();
        });
    });

    // ─── Disabled operations ────────────────────────────────────────

    describe('disabled diagnostics', () => {
        it('markMutation does not update lastUpdateTime when disabled', () => {
            const diagnostics = new WorldDiagnostics(false);
            diagnostics.markMutation();

            const metrics = diagnostics.getMetrics({
                entityCount: 0,
                archetypeCount: 0,
                registeredEntityCount: 0,
                freeEntityCount: 0,
                componentTypes: [],
            });

            expect(metrics).toBeNull();
        });

        it('recordQuery does not increment counter when disabled', () => {
            const diagnostics = new WorldDiagnostics(false);
            diagnostics.recordQuery();
            diagnostics.recordQuery();

            expect(
                diagnostics.getMetrics({
                    entityCount: 0,
                    archetypeCount: 0,
                    registeredEntityCount: 0,
                    freeEntityCount: 0,
                    componentTypes: [],
                })
            ).toBeNull();
        });

        it('recordEvent does not increment counter when disabled', () => {
            const diagnostics = new WorldDiagnostics(false);
            diagnostics.recordEvent();
            diagnostics.recordEvent();
            diagnostics.recordEvent();

            expect(
                diagnostics.getMetrics({
                    entityCount: 0,
                    archetypeCount: 0,
                    registeredEntityCount: 0,
                    freeEntityCount: 0,
                    componentTypes: [],
                })
            ).toBeNull();
        });
    });

    // ─── Memory estimation formula ──────────────────────────────────

    describe('memory estimation', () => {
        it('verifies exact calculation for known inputs', () => {
            const diagnostics = new WorldDiagnostics(true);

            // Formula: 1000 + entity*50 + entity*100 + free*10 + archetype*500 + types*20 + 200 + 300
            // With: entity=10, entity=3, free=2, archetype=4, types=5
            // = 1000 + 500 + 300 + 20 + 2000 + 100 + 200 + 300
            // = 4420
            const metrics = diagnostics.getMetrics({
                entityCount: 10,
                archetypeCount: 4,
                registeredEntityCount: 3,
                freeEntityCount: 2,
                componentTypes: ['A', 'B', 'C', 'D', 'E'],
            });

            expect(metrics!.memoryUsage).toBe(4420);
        });

        it('calculates correctly for zero values', () => {
            const diagnostics = new WorldDiagnostics(true);

            // = 1000 + 0 + 0 + 0 + 0 + 0 + 200 + 300 = 1500
            const metrics = diagnostics.getMetrics({
                entityCount: 0,
                archetypeCount: 0,
                registeredEntityCount: 0,
                freeEntityCount: 0,
                componentTypes: [],
            });

            expect(metrics!.memoryUsage).toBe(1500);
        });
    });

    // ─── Multiple calls accumulate ──────────────────────────────────

    describe('counter accumulation', () => {
        it('counters accumulate correctly across multiple calls', () => {
            const diagnostics = new WorldDiagnostics(true);

            diagnostics.recordQuery();
            diagnostics.recordQuery();
            diagnostics.recordQuery();
            diagnostics.recordEvent();
            diagnostics.recordEvent();

            const metrics = diagnostics.getMetrics({
                entityCount: 1,
                archetypeCount: 1,
                registeredEntityCount: 0,
                freeEntityCount: 0,
                componentTypes: [],
            });

            expect(metrics!.queryCount).toBe(3);
            expect(metrics!.eventCount).toBe(2);
        });
    });

    // ─── creationTime ───────────────────────────────────────────────

    describe('creationTime', () => {
        it('is set at construction and stable across calls', () => {
            const diagnostics = new WorldDiagnostics(true);

            const snapshot = {
                state: 'running',
                config: {},
                entityCount: 0,
                archetypeCount: 0,
                registeredEntityCount: 0,
                freeEntityCount: 0,
                nextEntityId: 1,
                componentTypes: [],
                archetypes: [],
            };

            const debug1 = diagnostics.getDebugInfo(snapshot);
            const debug2 = diagnostics.getDebugInfo(snapshot);

            expect(debug1.creationTime).toBe(debug2.creationTime);
            expect(typeof debug1.creationTime).toBe('number');
            expect(debug1.creationTime).toBeGreaterThan(0);
        });
    });
});
