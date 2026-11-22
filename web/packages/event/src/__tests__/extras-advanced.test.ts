import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    createEmitter,
    createTypedEmitter,
    createEventProxy,
    filterEvents,
    excludeEvents,
    mergeEmitters,
    type EventMap,
} from '@axrone/event';

interface SourceEvents extends EventMap {
    'test:event': { value: number };
    'test:filtered': { text: string };
    'test:excluded': { flag: boolean };
    error: Error;
}

interface TargetEvents extends EventMap {
    'target:mapped': { transformed: boolean };
    'target:direct': { forwarded: boolean };
}

describe('extras - Advanced Coverage', () => {
    describe('filterEvents', () => {
        let source: ReturnType<typeof createTypedEmitter<SourceEvents>>;

        beforeEach(() => {
            source = createTypedEmitter<SourceEvents>();
        });

        afterEach(() => {
            source.dispose();
        });

        it('should block non-allowed events in emitSync', async () => {
            const filtered = filterEvents(source, ['test:event']);
            let count = 0;

            filtered.on('test:filtered' as any, () => {
                count++;
            });

            const result = filtered.emitSync('test:filtered' as any, { text: 'blocked' });
            expect(result).toBe(false);
            expect(count).toBe(0);

            (filtered as any).dispose();
        });

        it('should release source subscriptions on dispose', async () => {
            const filtered = filterEvents(source, ['test:event']);
            let count = 0;

            filtered.on('test:event', () => {
                count++;
            });

            await source.emit('test:event', { value: 1 });
            expect(count).toBe(1);

            (filtered as any).dispose();

            await source.emit('test:event', { value: 2 });
            expect(count).toBe(1);
        });
    });

    describe('excludeEvents', () => {
        let source: ReturnType<typeof createTypedEmitter<SourceEvents>>;

        beforeEach(() => {
            source = createTypedEmitter<SourceEvents>();
        });

        afterEach(() => {
            source.dispose();
        });

        it('should block excluded events in emitSync', () => {
            const excluded = excludeEvents(source, ['test:excluded']);

            const result = excluded.emitSync('test:excluded' as any, { flag: true });
            expect(result).toBe(false);

            (excluded as any).dispose();
        });

        it('should set up lazy forwarding when on is called for new events', async () => {
            const excluded = excludeEvents(source, ['test:excluded']);
            let count = 0;

            excluded.on('test:event', () => {
                count++;
            });

            await source.emit('test:event', { value: 1 });
            expect(count).toBe(1);

            (excluded as any).dispose();
        });

        it('should set up lazy forwarding when once is called for new events', async () => {
            const excluded = excludeEvents(source, ['test:excluded']);
            let count = 0;

            excluded.once('test:event', () => {
                count++;
            });

            await source.emit('test:event', { value: 1 });
            await source.emit('test:event', { value: 2 });
            expect(count).toBe(1);

            (excluded as any).dispose();
        });

        it('should release all subscriptions on dispose', async () => {
            const excluded = excludeEvents(source, ['test:excluded']);
            let count = 0;

            excluded.on('test:event', () => {
                count++;
            });

            await source.emit('test:event', { value: 1 });
            expect(count).toBe(1);

            (excluded as any).dispose();

            await source.emit('test:event', { value: 2 });
            expect(count).toBe(1);
        });
    });

    describe('createEventProxy', () => {
        let source: ReturnType<typeof createTypedEmitter<SourceEvents>>;
        let target: ReturnType<typeof createTypedEmitter<TargetEvents>>;

        beforeEach(() => {
            source = createTypedEmitter<SourceEvents>();
            target = createTypedEmitter<TargetEvents>();
        });

        afterEach(() => {
            source.dispose();
            target.dispose();
        });

        it('should release all source subscriptions when unsubscribe is called', async () => {
            let targetCount = 0;
            target.on('target:mapped', () => {
                targetCount++;
            });

            const unsub = createEventProxy(source, target, {
                'test:event': 'target:mapped',
            });

            await source.emit('test:event', { value: 1 });
            expect(targetCount).toBe(1);

            unsub();

            await source.emit('test:event', { value: 2 });
            expect(targetCount).toBe(1);
        });

        it('should handle multiple mapping entries', async () => {
            let mappedCount = 0;
            let directCount = 0;

            target.on('target:mapped', () => {
                mappedCount++;
            });
            target.on('target:direct', () => {
                directCount++;
            });

            const unsub = createEventProxy(source, target, {
                'test:event': 'target:mapped',
                'test:filtered': 'target:direct',
            });

            await source.emit('test:event', { value: 1 });
            await source.emit('test:filtered', { text: 'hello' });

            expect(mappedCount).toBe(1);
            expect(directCount).toBe(1);

            unsub();
        });

        it('should skip mapping entries with undefined target', async () => {
            const unsub = createEventProxy(source, target, {
                'test:event': undefined as any,
            });

            // Should not throw
            await source.emit('test:event', { value: 1 });

            unsub();
        });
    });

    describe('mergeEmitters', () => {
        it('should merge three or more emitters', async () => {
            const e1 = createTypedEmitter<{ 'e1:a': { x: number } }>();
            const e2 = createTypedEmitter<{ 'e2:b': { y: number } }>();
            const e3 = createTypedEmitter<{ 'e3:c': { z: number } }>();

            const merged = mergeEmitters(e1, e2, e3);
            let aCount = 0;
            let bCount = 0;
            let cCount = 0;

            merged.on('e1:a' as any, () => {
                aCount++;
            });
            merged.on('e2:b' as any, () => {
                bCount++;
            });
            merged.on('e3:c' as any, () => {
                cCount++;
            });

            await e1.emit('e1:a', { x: 1 });
            await e2.emit('e2:b', { y: 2 });
            await e3.emit('e3:c', { z: 3 });

            expect(aCount).toBe(1);
            expect(bCount).toBe(1);
            expect(cCount).toBe(1);

            e1.dispose();
            e2.dispose();
            e3.dispose();
            (merged as any).dispose();
        });

        it('should clean up all source subscriptions on dispose', async () => {
            const e1 = createTypedEmitter<{ 'e1:a': { x: number } }>();
            const e2 = createTypedEmitter<{ 'e2:b': { y: number } }>();

            const merged = mergeEmitters(e1, e2);
            let count = 0;

            merged.on('e1:a' as any, () => {
                count++;
            });

            await e1.emit('e1:a', { x: 1 });
            expect(count).toBe(1);

            (merged as any).dispose();

            await e1.emit('e1:a', { x: 2 });
            expect(count).toBe(1);

            e1.dispose();
            e2.dispose();
        });
    });
});
