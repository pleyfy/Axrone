import { describe, expect, it } from 'vitest';
import { DEFAULT_OPTIONS, type EventOptions } from '@axrone/event';

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
                concurrencyLimit: 8,
                bufferSize: 500,
                gcIntervalMs: 30000,
            };
            expect(completeOptions.captureRejections).toBe(false);
            expect(completeOptions.maxListeners).toBe(20);
            expect(completeOptions.weakReferences).toBe(true);
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
            expect(options.concurrencyLimit).toBeUndefined();
            expect(options.bufferSize).toBeUndefined();
            expect(options.gcIntervalMs).toBeUndefined();
        });

        it('should ensure all property types are correct', () => {
            const options: EventOptions = {
                captureRejections: true,
                maxListeners: 25,
                weakReferences: false,
                concurrencyLimit: Infinity,
                bufferSize: 1000,
                gcIntervalMs: 60000,
            };

            expect(typeof options.captureRejections).toBe('boolean');
            expect(typeof options.maxListeners).toBe('number');
            expect(typeof options.weakReferences).toBe('boolean');
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
        expect(DEFAULT_OPTIONS.concurrencyLimit).toBe(Infinity);
        expect(DEFAULT_OPTIONS.bufferSize).toBe(1000);
        expect(DEFAULT_OPTIONS.gcIntervalMs).toBe(60000);
    });

    it('should be of type Required<EventOptions>', () => {
        const requiredKeys: Array<keyof Required<EventOptions>> = [
            'captureRejections',
            'maxListeners',
            'weakReferences',
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

        expect(DEFAULT_OPTIONS.concurrencyLimit).toBe(Infinity);

        expect(DEFAULT_OPTIONS.maxListeners).toBeGreaterThan(0);
        expect(DEFAULT_OPTIONS.bufferSize).toBeGreaterThan(0);
        expect(DEFAULT_OPTIONS.gcIntervalMs).toBeGreaterThan(0);
    });

    it('should check type consistency', () => {
        expect(typeof DEFAULT_OPTIONS.captureRejections).toBe('boolean');
        expect(typeof DEFAULT_OPTIONS.maxListeners).toBe('number');
        expect(typeof DEFAULT_OPTIONS.weakReferences).toBe('boolean');
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
                concurrencyLimit: userOptions.concurrencyLimit ?? DEFAULT_OPTIONS.concurrencyLimit,
                bufferSize: userOptions.bufferSize ?? DEFAULT_OPTIONS.bufferSize,
                gcIntervalMs: userOptions.gcIntervalMs ?? DEFAULT_OPTIONS.gcIntervalMs,
                bufferOverflow: userOptions.bufferOverflow ?? DEFAULT_OPTIONS.bufferOverflow,
                metrics: userOptions.metrics ?? DEFAULT_OPTIONS.metrics,
            };
        }

        const userOptions: EventOptions = { maxListeners: 20 };
        const merged = mergeWithDefaults(userOptions);

        expect(merged.maxListeners).toBe(20);
        expect(merged.captureRejections).toBe(DEFAULT_OPTIONS.captureRejections);
        expect(merged.bufferSize).toBe(DEFAULT_OPTIONS.bufferSize);
    });
});
