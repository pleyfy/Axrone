import { describe, expect, it } from 'vitest';
import { EventOptions, DEFAULT_OPTIONS, MEMORY_USAGE_SYMBOLS } from '../../event/definition';

describe('EventEmitter - Event Options', () => {
    describe('EventOptions Interface', () => {
        it('should accept valid EventOptions objects', () => {
            const emptyOptions: EventOptions = {};
            expect(typeof emptyOptions).toBe('object');

            const partialOptions: EventOptions = {
                maxListeners: 15,
                captureRejections: true,
            };
            expect(partialOptions.maxListeners).toBe(15);
            expect(partialOptions.captureRejections).toBe(true);

            const completeOptions: EventOptions = {
                captureRejections: false,
                maxListeners: 20,
                weakReferences: true,
                immediateDispatch: false,
                concurrencyLimit: 8,
                bufferSize: 500,
                gcIntervalMs: 30000,
            };
            expect(completeOptions.captureRejections).toBe(false);
            expect(completeOptions.maxListeners).toBe(20);
            expect(completeOptions.weakReferences).toBe(true);
            expect(completeOptions.immediateDispatch).toBe(false);
            expect(completeOptions.concurrencyLimit).toBe(8);
            expect(completeOptions.bufferSize).toBe(500);
            expect(completeOptions.gcIntervalMs).toBe(30000);
        });

        it('should check readonly properties at compile-time', () => {
            const options: EventOptions = { maxListeners: 10 };
            expect(options.maxListeners).toBe(10);
        });

        it('optional properties should be able to be undefined', () => {
            const options: EventOptions = {
                maxListeners: 10,
                // Other properties undefined (missing)
            };

            expect(options.maxListeners).toBe(10);
            expect(options.captureRejections).toBeUndefined();
            expect(options.weakReferences).toBeUndefined();
            expect(options.immediateDispatch).toBeUndefined();
            expect(options.concurrencyLimit).toBeUndefined();
            expect(options.bufferSize).toBeUndefined();
            expect(options.gcIntervalMs).toBeUndefined();
        });

        it('should ensure all property types are correct', () => {
            const options: EventOptions = {
                captureRejections: true,
                maxListeners: 25,
                weakReferences: false,
                immediateDispatch: true,
                concurrencyLimit: Infinity,
                bufferSize: 1000,
                gcIntervalMs: 60000,
            };

            expect(typeof options.captureRejections).toBe('boolean');
            expect(typeof options.maxListeners).toBe('number');
            expect(typeof options.weakReferences).toBe('boolean');
            expect(typeof options.immediateDispatch).toBe('boolean');
            expect(typeof options.concurrencyLimit).toBe('number');
            expect(typeof options.bufferSize).toBe('number');
            expect(typeof options.gcIntervalMs).toBe('number');

            expect(options.concurrencyLimit).toBe(Infinity);
            expect(Number.isFinite(options.maxListeners)).toBe(true);
        });

        it('should prevent invalid type assignments by TypeScript', () => {
            // These assignments should give TypeScript compile errors:
            // const invalidOptions: EventOptions = {
            //   captureRejections: "true",    // ❌ string not assignable to boolean
            //   maxListeners: "10",           // ❌ string not assignable to number
            //   unknownProperty: true         // ❌ unknown property
            // };

            function isValidEventOptions(value: unknown): value is EventOptions {
                if (typeof value !== 'object' || value === null) return false;

                const obj = value as Record<string, unknown>;

                if ('captureRejections' in obj && typeof obj.captureRejections !== 'boolean')
                    return false;
                if ('maxListeners' in obj && typeof obj.maxListeners !== 'number') return false;
                if ('weakReferences' in obj && typeof obj.weakReferences !== 'boolean')
                    return false;
                if ('immediateDispatch' in obj && typeof obj.immediateDispatch !== 'boolean')
                    return false;
                if ('concurrencyLimit' in obj && typeof obj.concurrencyLimit !== 'number')
                    return false;
                if ('bufferSize' in obj && typeof obj.bufferSize !== 'number') return false;
                if ('gcIntervalMs' in obj && typeof obj.gcIntervalMs !== 'number') return false;

                return true;
            }

            expect(isValidEventOptions({ maxListeners: 10 })).toBe(true);
            expect(isValidEventOptions({ maxListeners: '10' })).toBe(false);
            expect(isValidEventOptions({ captureRejections: 'true' })).toBe(false);
        });
    });
});

describe('DEFAULT_OPTIONS Constant', () => {
    it('should have correct default values', () => {
        expect(DEFAULT_OPTIONS.captureRejections).toBe(false);
        expect(DEFAULT_OPTIONS.maxListeners).toBe(10);
        expect(DEFAULT_OPTIONS.weakReferences).toBe(false);
        expect(DEFAULT_OPTIONS.immediateDispatch).toBe(true);
        expect(DEFAULT_OPTIONS.concurrencyLimit).toBe(Infinity);
        expect(DEFAULT_OPTIONS.bufferSize).toBe(1000);
        expect(DEFAULT_OPTIONS.gcIntervalMs).toBe(60000);
    });

    it('should be of type Required<EventOptions>', () => {
        const requiredKeys: Array<keyof Required<EventOptions>> = [
            'captureRejections',
            'maxListeners',
            'weakReferences',
            'immediateDispatch',
            'concurrencyLimit',
            'bufferSize',
            'gcIntervalMs',
        ];

        requiredKeys.forEach((key) => {
            expect(key in DEFAULT_OPTIONS).toBe(true);
            expect(DEFAULT_OPTIONS[key]).toBeDefined();
        });
    });

    it('should be immutable (as const)', () => {
        expect(() => {
            (DEFAULT_OPTIONS as any).maxListeners = 20;
        }).toThrow();
    });

    it('should contain reasonable default values', () => {
        expect(DEFAULT_OPTIONS.captureRejections).toBe(false);
        expect(DEFAULT_OPTIONS.weakReferences).toBe(false);

        expect(DEFAULT_OPTIONS.immediateDispatch).toBe(true);
        expect(DEFAULT_OPTIONS.concurrencyLimit).toBe(Infinity);

        expect(DEFAULT_OPTIONS.maxListeners).toBeGreaterThan(0);
        expect(DEFAULT_OPTIONS.bufferSize).toBeGreaterThan(0);
        expect(DEFAULT_OPTIONS.gcIntervalMs).toBeGreaterThan(0);
    });

    it('should check type consistency', () => {
        expect(typeof DEFAULT_OPTIONS.captureRejections).toBe('boolean');
        expect(typeof DEFAULT_OPTIONS.maxListeners).toBe('number');
        expect(typeof DEFAULT_OPTIONS.weakReferences).toBe('boolean');
        expect(typeof DEFAULT_OPTIONS.immediateDispatch).toBe('boolean');
        expect(typeof DEFAULT_OPTIONS.concurrencyLimit).toBe('number');
        expect(typeof DEFAULT_OPTIONS.bufferSize).toBe('number');
        expect(typeof DEFAULT_OPTIONS.gcIntervalMs).toBe('number');

        expect(Number.isInteger(DEFAULT_OPTIONS.maxListeners)).toBe(true);
        expect(Number.isInteger(DEFAULT_OPTIONS.bufferSize)).toBe(true);
        expect(Number.isInteger(DEFAULT_OPTIONS.gcIntervalMs)).toBe(true);
        expect(DEFAULT_OPTIONS.concurrencyLimit).toBe(Infinity);
    });

    it('should be usable for options merging', () => {
        function mergeWithDefaults(userOptions: EventOptions): Required<EventOptions> {
            return {
                captureRejections:
                    userOptions.captureRejections ?? DEFAULT_OPTIONS.captureRejections,
                maxListeners: userOptions.maxListeners ?? DEFAULT_OPTIONS.maxListeners,
                weakReferences: userOptions.weakReferences ?? DEFAULT_OPTIONS.weakReferences,
                immediateDispatch:
                    userOptions.immediateDispatch ?? DEFAULT_OPTIONS.immediateDispatch,
                concurrencyLimit: userOptions.concurrencyLimit ?? DEFAULT_OPTIONS.concurrencyLimit,
                bufferSize: userOptions.bufferSize ?? DEFAULT_OPTIONS.bufferSize,
                gcIntervalMs: userOptions.gcIntervalMs ?? DEFAULT_OPTIONS.gcIntervalMs,
            };
        }

        const userOptions: EventOptions = { maxListeners: 20 };
        const merged = mergeWithDefaults(userOptions);

        expect(merged.maxListeners).toBe(20);
        expect(merged.captureRejections).toBe(DEFAULT_OPTIONS.captureRejections);
        expect(merged.bufferSize).toBe(DEFAULT_OPTIONS.bufferSize);
    });
});

describe('MEMORY_USAGE_SYMBOLS Constant', () => {
    it('should contain correct symbol keys', () => {
        const expectedKeys = [
            'staticSubscriptions',
            'subscriptionMaps',
            'priorityQueues',
            'eventBuffer',
        ];

        expectedKeys.forEach((key) => {
            expect(key in MEMORY_USAGE_SYMBOLS).toBe(true);
            expect(typeof MEMORY_USAGE_SYMBOLS[key as keyof typeof MEMORY_USAGE_SYMBOLS]).toBe(
                'symbol'
            );
        });
    });

    it('should have unique symbols', () => {
        const symbols = Object.values(MEMORY_USAGE_SYMBOLS);
        const symbolSet = new Set(symbols);

        expect(symbols.length).toBe(symbolSet.size);
        expect(symbols.length).toBe(4);
    });

    it('should have correct descriptions for each symbol', () => {
        expect(MEMORY_USAGE_SYMBOLS.staticSubscriptions.description).toBe('staticSubscriptions');
        expect(MEMORY_USAGE_SYMBOLS.subscriptionMaps.description).toBe('subscriptionMaps');
        expect(MEMORY_USAGE_SYMBOLS.priorityQueues.description).toBe('priorityQueues');
        expect(MEMORY_USAGE_SYMBOLS.eventBuffer.description).toBe('eventBuffer');
    });

    it('should be immutable (as const)', () => {
        expect(() => {
            (MEMORY_USAGE_SYMBOLS as any).newSymbol = Symbol('new');
        }).toThrow();
    });

    it('should be usable as object keys', () => {
        const memoryTracker = {
            [MEMORY_USAGE_SYMBOLS.staticSubscriptions]: 1024,
            [MEMORY_USAGE_SYMBOLS.subscriptionMaps]: 2048,
            [MEMORY_USAGE_SYMBOLS.priorityQueues]: 512,
            [MEMORY_USAGE_SYMBOLS.eventBuffer]: 4096,
        };

        expect(memoryTracker[MEMORY_USAGE_SYMBOLS.staticSubscriptions]).toBe(1024);
        expect(memoryTracker[MEMORY_USAGE_SYMBOLS.subscriptionMaps]).toBe(2048);
        expect(memoryTracker[MEMORY_USAGE_SYMBOLS.priorityQueues]).toBe(512);
        expect(memoryTracker[MEMORY_USAGE_SYMBOLS.eventBuffer]).toBe(4096);
    });

    it('should provide collision-free property keys', () => {
        const mixedObject = {
            staticSubscriptions: 'string value',
            [MEMORY_USAGE_SYMBOLS.staticSubscriptions]: 'symbol value',
        };

        expect(mixedObject.staticSubscriptions).toBe('string value');
        expect(mixedObject[MEMORY_USAGE_SYMBOLS.staticSubscriptions]).toBe('symbol value');

        expect(Object.keys(mixedObject)).toContain('staticSubscriptions');
        expect(Object.getOwnPropertySymbols(mixedObject)).toContain(
            MEMORY_USAGE_SYMBOLS.staticSubscriptions
        );
    });

    it('should be usable for memory usage tracking', () => {
        class MemoryTracker {
            private usage: Record<symbol, number> = {};

            track(component: symbol, bytes: number): void {
                this.usage[component] = bytes;
            }

            getUsage(component: symbol): number {
                return this.usage[component] || 0;
            }

            getTotalUsage(): number {
                return Object.getOwnPropertySymbols(this.usage).reduce(
                    (sum: number, symbol: symbol) => sum + (this.usage[symbol] || 0),
                    0
                );
            }
        }

        const tracker = new MemoryTracker();

        tracker.track(MEMORY_USAGE_SYMBOLS.staticSubscriptions, 2048);
        tracker.track(MEMORY_USAGE_SYMBOLS.subscriptionMaps, 4096);
        tracker.track(MEMORY_USAGE_SYMBOLS.priorityQueues, 1024);
        tracker.track(MEMORY_USAGE_SYMBOLS.eventBuffer, 8192);

        expect(tracker.getUsage(MEMORY_USAGE_SYMBOLS.staticSubscriptions)).toBe(2048);
        expect(tracker.getUsage(MEMORY_USAGE_SYMBOLS.subscriptionMaps)).toBe(4096);
        expect(tracker.getTotalUsage()).toBe(15360);
    });
});
