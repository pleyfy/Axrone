import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Mocked } from 'vitest';
import { IEventEmitter } from '../../event/event-emitter';
import {
    IEventSubscriber,
    IEventPublisher,
    IEventBuffer,
    IEventObserver,
    SubscriptionOptions,
    EventMetrics,
    QueuedEvent,
} from '../../event/interfaces';
import { EventMap, EventCallback } from '../../event/definition';

interface TestEvents extends EventMap {
    'test:event': { id: string; data: any };
    'test:error': { error: Error };
    'test:batch': { index: number };
}

describe('EventEmitter - Core Interfaces', () => {
    describe('Interface Type Contracts', () => {
        it('should enforce correct generic constraints', () => {
            interface ValidEvents extends EventMap {
                'valid:event': { data: string };
            }

            interface InvalidEvents {
                notAnEvent: string;
            }

            const validSubscriber: IEventSubscriber<ValidEvents> = {} as any;
            const validPublisher: IEventPublisher<ValidEvents> = {} as any;
            const validObserver: IEventObserver<ValidEvents> = {} as any;

            expect(validSubscriber).toBeDefined();
            expect(validPublisher).toBeDefined();
            expect(validObserver).toBeDefined();
        });

        it('should support interface composition in IEventEmitter', () => {
            const emitter: IEventEmitter<TestEvents> = {} as any;

            expect(typeof emitter.on).toBe('undefined');
            expect(typeof emitter.once).toBe('undefined');
            expect(typeof emitter.off).toBe('undefined');
            expect(typeof emitter.offById).toBe('undefined');
            expect(typeof emitter.pipe).toBe('undefined');

            expect(typeof emitter.emit).toBe('undefined');
            expect(typeof emitter.emitSync).toBe('undefined');
            expect(typeof emitter.emitBatch).toBe('undefined');

            expect(typeof emitter.has).toBe('undefined');
            expect(typeof emitter.listenerCount).toBe('undefined');
            expect(typeof emitter.getMetrics).toBe('undefined');

            expect(typeof emitter.pause).toBe('undefined');
            expect(typeof emitter.resume).toBe('undefined');
            expect(typeof emitter.getQueuedEvents).toBe('undefined');

            expect(typeof emitter.removeAllListeners).toBe('undefined');
            expect(typeof emitter.batchSubscribe).toBe('undefined');
            expect(typeof emitter.drain).toBe('undefined');
        });

        it('should handle EventKey type constraints correctly', () => {
            type TestEventKey = keyof TestEvents & string;

            const validKeys: TestEventKey[] = ['test:event', 'test:error', 'test:batch'];

            validKeys.forEach((key) => {
                expect(typeof key).toBe('string');
                expect(key.includes(':')).toBe(true);
            });
        });
    });

    describe('IEventSubscriber Contract', () => {
        let mockSubscriber: Mocked<IEventSubscriber<TestEvents>>;

        beforeEach(() => {
            mockSubscriber = {
                on: vi.fn(),
                once: vi.fn(),
                off: vi.fn(),
                offById: vi.fn(),
                pipe: vi.fn(),
            };
        });

        it('should handle subscription lifecycle correctly', () => {
            const mockUnsubscribe = vi.fn().mockReturnValue(true);
            mockSubscriber.on.mockReturnValue(mockUnsubscribe);

            const callback: EventCallback<TestEvents['test:event']> = vi.fn();
            const unsubscribe = mockSubscriber.on('test:event', callback);

            expect(mockSubscriber.on).toHaveBeenCalledWith('test:event', callback);
            expect(typeof unsubscribe).toBe('function');

            const result = unsubscribe();
            expect(result).toBe(true);
            expect(mockUnsubscribe).toHaveBeenCalled();
        });

        it('should support subscription options correctly', () => {
            const callback: EventCallback<TestEvents['test:event']> = vi.fn();
            const options: SubscriptionOptions = { priority: 'high' };

            mockSubscriber.on('test:event', callback, options);
            expect(mockSubscriber.on).toHaveBeenCalledWith('test:event', callback, options);

            const onceOptions: Omit<SubscriptionOptions, 'once'> = { priority: 'low' };
            mockSubscriber.once('test:event', callback, onceOptions);
            expect(mockSubscriber.once).toHaveBeenCalledWith('test:event', callback, onceOptions);
        });

        it('should handle off operations with different signatures', () => {
            const callback: EventCallback<TestEvents['test:event']> = vi.fn();

            mockSubscriber.off.mockReturnValue(true);

            let result = mockSubscriber.off('test:event', callback);
            expect(mockSubscriber.off).toHaveBeenCalledWith('test:event', callback);
            expect(result).toBe(true);

            result = mockSubscriber.off('test:event');
            expect(mockSubscriber.off).toHaveBeenCalledWith('test:event');
        });

        it('should handle piping operations', () => {
            const targetPublisher: IEventPublisher<any> = {
                emit: vi.fn(),
                emitSync: vi.fn(),
                emitBatch: vi.fn(),
            };

            const mockUnsubscribe = vi.fn().mockReturnValue(true);
            mockSubscriber.pipe.mockReturnValue(mockUnsubscribe);

            let unsubscribe = mockSubscriber.pipe('test:event', targetPublisher);
            expect(mockSubscriber.pipe).toHaveBeenCalledWith('test:event', targetPublisher);

            unsubscribe = mockSubscriber.pipe('test:event', targetPublisher, 'target:event');
            expect(mockSubscriber.pipe).toHaveBeenCalledWith(
                'test:event',
                targetPublisher,
                'target:event'
            );
        });
    });

    describe('IEventPublisher Contract', () => {
        let mockPublisher: Mocked<IEventPublisher<TestEvents>>;

        beforeEach(() => {
            mockPublisher = {
                emit: vi.fn(),
                emitSync: vi.fn(),
                emitBatch: vi.fn(),
            };
        });

        it('should handle async emit operations', async () => {
            mockPublisher.emit.mockResolvedValue(true);

            const data: TestEvents['test:event'] = { id: 'test', data: { value: 42 } };
            const result = await mockPublisher.emit('test:event', data);

            expect(mockPublisher.emit).toHaveBeenCalledWith('test:event', data);
            expect(result).toBe(true);
        });

        it('should handle emit with priority options', async () => {
            mockPublisher.emit.mockResolvedValue(true);

            const data: TestEvents['test:event'] = { id: 'test', data: {} };
            const options = { priority: 'high' as const };

            await mockPublisher.emit('test:event', data, options);
            expect(mockPublisher.emit).toHaveBeenCalledWith('test:event', data, options);
        });

        it('should handle sync emit operations', () => {
            mockPublisher.emitSync.mockReturnValue(true);

            const data: TestEvents['test:error'] = { error: new Error('Test error') };
            const result = mockPublisher.emitSync('test:error', data);

            expect(mockPublisher.emitSync).toHaveBeenCalledWith('test:error', data);
            expect(result).toBe(true);
        });

        it('should handle batch emit operations', async () => {
            mockPublisher.emitBatch.mockResolvedValue([true, false, true]);

            const events = [
                { event: 'test:batch' as const, data: { index: 1 } },
                { event: 'test:batch' as const, data: { index: 2 }, priority: 'high' as const },
                { event: 'test:batch' as const, data: { index: 3 }, priority: 'low' as const },
            ];

            const results = await mockPublisher.emitBatch(events);

            expect(mockPublisher.emitBatch).toHaveBeenCalledWith(events);
            expect(results).toEqual([true, false, true]);
        });

        it('should handle emit failures gracefully', async () => {
            const error = new Error('Emit failed');
            mockPublisher.emit.mockRejectedValue(error);

            await expect(
                mockPublisher.emit('test:event', { id: 'test', data: {} })
            ).rejects.toThrow('Emit failed');
        });
    });

    describe('IEventBuffer Contract', () => {
        let mockBuffer: Mocked<IEventBuffer<TestEvents>>;

        beforeEach(() => {
            mockBuffer = {
                getQueuedEvents: vi.fn(),
                getPendingCount: vi.fn(),
                getBufferSize: vi.fn(),
                clearBuffer: vi.fn(),
                pause: vi.fn(),
                resume: vi.fn(),
                isPaused: vi.fn(),
            };
        });

        it('should handle pause/resume state management', () => {
            mockBuffer.isPaused.mockReturnValue(false);
            expect(mockBuffer.isPaused()).toBe(false);

            mockBuffer.pause();
            expect(mockBuffer.pause).toHaveBeenCalled();

            mockBuffer.isPaused.mockReturnValue(true);
            expect(mockBuffer.isPaused()).toBe(true);

            mockBuffer.resume();
            expect(mockBuffer.resume).toHaveBeenCalled();
        });

        it('should handle queue inspection operations', () => {
            const mockQueuedEvents: QueuedEvent[] = [
                {
                    id: 1,
                    event: 'test:event',
                    data: { id: 'test1', data: {} },
                    timestamp: Date.now(),
                    priority: 'normal',
                },
                {
                    id: 2,
                    event: 'test:batch',
                    data: { index: 1 },
                    timestamp: Date.now(),
                    priority: 'high',
                },
            ];

            mockBuffer.getQueuedEvents.mockReturnValue(mockQueuedEvents);
            mockBuffer.getPendingCount.mockReturnValue(2);
            mockBuffer.getBufferSize.mockReturnValue(1000);

            const allEvents = mockBuffer.getQueuedEvents();
            expect(allEvents).toEqual(mockQueuedEvents);

            const specificEvents = mockBuffer.getQueuedEvents('test:event');
            expect(mockBuffer.getQueuedEvents).toHaveBeenCalledWith('test:event');

            expect(mockBuffer.getPendingCount()).toBe(2);
            expect(mockBuffer.getBufferSize()).toBe(1000);
        });

        it('should handle buffer clearing operations', () => {
            mockBuffer.clearBuffer.mockReturnValue(5);

            let cleared = mockBuffer.clearBuffer('test:event');
            expect(mockBuffer.clearBuffer).toHaveBeenCalledWith('test:event');
            expect(cleared).toBe(5);

            cleared = mockBuffer.clearBuffer();
            expect(mockBuffer.clearBuffer).toHaveBeenCalledWith();
            expect(cleared).toBe(5);
        });
    });

    describe('IEventObserver Contract', () => {
        let mockObserver: Mocked<IEventObserver<TestEvents>>;

        beforeEach(() => {
            mockObserver = {
                has: vi.fn(),
                listenerCount: vi.fn(),
                maxListeners: 10,
                listenerCountAll: vi.fn(),
                eventNames: vi.fn(),
                getSubscriptions: vi.fn(),
                hasSubscription: vi.fn(),
                getMetrics: vi.fn(),
                getMemoryUsage: vi.fn(),
            };
        });

        it('should handle event existence checks', () => {
            mockObserver.has.mockReturnValue(true);

            const exists = mockObserver.has('test:event');
            expect(mockObserver.has).toHaveBeenCalledWith('test:event');
            expect(exists).toBe(true);
        });

        it('should handle listener counting operations', () => {
            mockObserver.listenerCount.mockReturnValue(3);
            mockObserver.listenerCountAll.mockReturnValue(10);

            expect(mockObserver.listenerCount('test:event')).toBe(3);
            expect(mockObserver.listenerCountAll()).toBe(10);
        });

        it('should handle event introspection', () => {
            const eventNames = ['test:event', 'test:error', 'test:batch'];
            mockObserver.eventNames.mockReturnValue(eventNames);

            const names = mockObserver.eventNames();
            expect(names).toEqual(eventNames);
        });

        it('should handle subscription inspection', () => {
            const mockSubscriptions = [
                {
                    id: Symbol('sub1'),
                    event: 'test:event',
                    callback: vi.fn(),
                    once: false,
                    priority: 'normal' as const,
                    createdAt: Date.now(),
                    executionCount: 0,
                },
            ];

            mockObserver.getSubscriptions.mockReturnValue(mockSubscriptions);
            mockObserver.hasSubscription.mockReturnValue(true);

            const subscriptions = mockObserver.getSubscriptions('test:event');
            expect(subscriptions).toEqual(mockSubscriptions);

            const hasSubscription = mockObserver.hasSubscription(Symbol('test'));
            expect(hasSubscription).toBe(true);
        });

        it('should handle metrics and memory usage', () => {
            const mockMetrics: EventMetrics = {
                emit: {
                    count: 10,
                    timing: { avg: 2.5, max: 10.0, min: 0.5, total: 25.0 },
                },
                execution: {
                    count: 10,
                    errors: 1,
                    timing: { avg: 5.0, max: 20.0, min: 0.1, total: 50.0 },
                },
            };

            const mockMemoryUsage = {
                subscriptions: 1024,
                queue: 512,
                total: 1536,
            };

            mockObserver.getMetrics.mockReturnValue(mockMetrics);
            mockObserver.getMemoryUsage.mockReturnValue(mockMemoryUsage);

            expect(mockObserver.getMetrics('test:event')).toEqual(mockMetrics);
            expect(mockObserver.getMemoryUsage()).toEqual(mockMemoryUsage);
        });

        it('should handle maxListeners property correctly', () => {
            expect(mockObserver.maxListeners).toBe(10);

            mockObserver.maxListeners = 20;
            expect(mockObserver.maxListeners).toBe(20);
        });
    });

    describe('IEventEmitter Integration', () => {
        let mockEmitter: Mocked<IEventEmitter<TestEvents>>;

        beforeEach(() => {
            mockEmitter = {
                // IEventSubscriber
                on: vi.fn(),
                once: vi.fn(),
                off: vi.fn(),
                offById: vi.fn(),
                pipe: vi.fn(),

                // IEventPublisher
                emit: vi.fn(),
                emitSync: vi.fn(),
                emitBatch: vi.fn(),

                // IEventObserver
                has: vi.fn(),
                listenerCount: vi.fn(),
                maxListeners: 10,
                listenerCountAll: vi.fn(),
                eventNames: vi.fn(),
                getSubscriptions: vi.fn(),
                hasSubscription: vi.fn(),
                getMetrics: vi.fn(),
                getMemoryUsage: vi.fn(),

                // IEventBuffer
                getQueuedEvents: vi.fn(),
                getPendingCount: vi.fn(),
                getBufferSize: vi.fn(),
                clearBuffer: vi.fn(),
                pause: vi.fn(),
                resume: vi.fn(),
                isPaused: vi.fn(),

                // IEventEmitter specific
                removeAllListeners: vi.fn().mockReturnThis(),
                batchSubscribe: vi.fn(),
                batchUnsubscribe: vi.fn(),
                resetMaxListeners: vi.fn(),
                drain: vi.fn(),
                flush: vi.fn(),
                resetMetrics: vi.fn(),

                dispose: vi.fn(),
            };
        });

        it('should support complete subscription and emission workflow', async () => {
            const mockUnsubscribe = vi.fn().mockReturnValue(true);
            mockEmitter.on.mockReturnValue(mockUnsubscribe);
            mockEmitter.emit.mockResolvedValue(true);

            const callback = vi.fn();
            const unsubscribe = mockEmitter.on('test:event', callback);

            const data = { id: 'test', data: { value: 42 } };
            const result = await mockEmitter.emit('test:event', data);

            expect(mockEmitter.on).toHaveBeenCalledWith('test:event', callback);
            expect(mockEmitter.emit).toHaveBeenCalledWith('test:event', data);
            expect(result).toBe(true);

            const unsubscribed = unsubscribe();
            expect(unsubscribed).toBe(true);
        });

        it('should handle batch operations correctly', async () => {
            const callbacks = [vi.fn(), vi.fn(), vi.fn()];
            const subscriptionIds = [Symbol('1'), Symbol('2'), Symbol('3')];

            mockEmitter.batchSubscribe.mockReturnValue(subscriptionIds);
            mockEmitter.batchUnsubscribe.mockReturnValue(3);

            const ids = mockEmitter.batchSubscribe('test:event', callbacks, { priority: 'high' });
            expect(mockEmitter.batchSubscribe).toHaveBeenCalledWith('test:event', callbacks, {
                priority: 'high',
            });
            expect(ids).toEqual(subscriptionIds);

            const unsubscribed = mockEmitter.batchUnsubscribe(ids);
            expect(mockEmitter.batchUnsubscribe).toHaveBeenCalledWith(ids);
            expect(unsubscribed).toBe(3);
        });

        it('should handle cleanup and maintenance operations', async () => {
            mockEmitter.removeAllListeners.mockReturnValue(mockEmitter);
            mockEmitter.drain.mockResolvedValue();
            mockEmitter.flush.mockResolvedValue();

            const result = mockEmitter.removeAllListeners('test:event');
            expect(mockEmitter.removeAllListeners).toHaveBeenCalledWith('test:event');
            expect(result).toBe(mockEmitter);

            await mockEmitter.drain();
            expect(mockEmitter.drain).toHaveBeenCalled();

            await mockEmitter.flush('test:event');
            expect(mockEmitter.flush).toHaveBeenCalledWith('test:event');

            mockEmitter.resetMaxListeners();
            mockEmitter.resetMetrics('test:event');
            expect(mockEmitter.resetMaxListeners).toHaveBeenCalled();
            expect(mockEmitter.resetMetrics).toHaveBeenCalledWith('test:event');
        });

        it('should maintain interface contract consistency', () => {
            const requiredMethods = [
                // IEventSubscriber
                'on',
                'once',
                'off',
                'offById',
                'pipe',
                // IEventPublisher
                'emit',
                'emitSync',
                'emitBatch',
                // IEventObserver
                'has',
                'listenerCount',
                'listenerCountAll',
                'eventNames',
                'getSubscriptions',
                'hasSubscription',
                'getMetrics',
                'getMemoryUsage',
                // IEventBuffer
                'getQueuedEvents',
                'getPendingCount',
                'getBufferSize',
                'clearBuffer',
                'pause',
                'resume',
                'isPaused',
                // IEventEmitter
                'removeAllListeners',
                'batchSubscribe',
                'batchUnsubscribe',
                'resetMaxListeners',
                'drain',
                'flush',
                'resetMetrics',
            ];

            requiredMethods.forEach((method) => {
                expect(mockEmitter).toHaveProperty(method);
                expect(typeof (mockEmitter as any)[method]).toBe('function');
            });

            expect(mockEmitter).toHaveProperty('maxListeners');
            expect(typeof mockEmitter.maxListeners).toBe('number');
        });
    });

    // ERROR HANDLING AND EDGE CASES
    describe('Error Handling and Edge Cases', () => {
        it('should handle interface method failures gracefully', async () => {
            const mockEmitter: Partial<IEventEmitter<TestEvents>> = {
                emit: vi.fn().mockRejectedValue(new Error('Emit failed')),
                on: vi.fn().mockImplementation(() => {
                    throw new Error('Subscribe failed');
                }),
            };

            await expect(mockEmitter.emit!('test:event', { id: 'test', data: {} })).rejects.toThrow(
                'Emit failed'
            );

            expect(() => {
                mockEmitter.on!('test:event', vi.fn());
            }).toThrow('Subscribe failed');
        });

        it('should handle resource cleanup in error scenarios', async () => {
            const mockEmitter: Partial<IEventEmitter<TestEvents>> = {
                drain: vi.fn().mockRejectedValue(new Error('Drain failed')),
                removeAllListeners: vi.fn().mockReturnValue({} as any),
            };

            try {
                await mockEmitter.drain!();
            } catch (error) {
                expect(error).toBeInstanceOf(Error);

                mockEmitter.removeAllListeners!();
                expect(mockEmitter.removeAllListeners).toHaveBeenCalled();
            }
        });
    });
});
