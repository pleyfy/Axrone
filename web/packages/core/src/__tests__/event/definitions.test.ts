import { describe, expect, it } from 'vitest';
import {
    EventCallback,
    UnsubscribeFn,
    EventKey,
    EventMap,
    EventPriority,
    isValidEventName,
    isValidCallback,
    isValidPriority,
    PRIORITY_VALUES,
    DEFAULT_PRIORITY,
    ExtractEventData,
    EventNames,
} from '../../event/definition';

interface TestUserEvents {
    'user:login': {
        userId: string;
        timestamp: number;
    };
    'user:logout': {
        userId: string;
        timestamp: number;
    };
}

interface TestSystemEvents {
    'system:error': {
        error: Error;
        context: string;
    };
    'system:startup': {
        version: string;
        timestamp: number;
    };
}

describe('EventEmitter: Type Definitions', () => {
    describe('isValidEventName', () => {
        it('Must recognize valid event names correctly', () => {
            expect(isValidEventName('user:login')).toBe(true);
            expect(isValidEventName('system:error')).toBe(true);
            expect(isValidEventName('custom-event')).toBe(true);
            expect(isValidEventName('a')).toBe(true);
            expect(isValidEventName('test123')).toBe(true);
            expect(isValidEventName('event_with_underscore')).toBe(true);
        });

        it('Should reject invalid event names', () => {
            expect(isValidEventName('')).toBe(false);
            expect(isValidEventName(null)).toBe(false);
            expect(isValidEventName(undefined)).toBe(false);
            expect(isValidEventName(123)).toBe(false);
            expect(isValidEventName({})).toBe(false);
            expect(isValidEventName([])).toBe(false);
            expect(isValidEventName(true)).toBe(false);
        });

        it('Handle edge cases correctly', () => {
            expect(isValidEventName(' ')).toBe(true);
            expect(isValidEventName('🎉')).toBe(true);
            expect(isValidEventName('你好')).toBe(true);
        });
    });

    describe('isValidCallback', () => {
        it('Must correctly recognize valid callback functions', () => {
            const syncCallback = (data: any) => {};
            const asyncCallback = async (data: any) => {};
            const arrowFunction = (data: any) => console.log(data);
            const namedFunction = function handler(data: any) {};

            expect(isValidCallback(syncCallback)).toBe(true);
            expect(isValidCallback(asyncCallback)).toBe(true);
            expect(isValidCallback(arrowFunction)).toBe(true);
            expect(isValidCallback(namedFunction)).toBe(true);
            expect(isValidCallback(() => {})).toBe(true);
            expect(isValidCallback(function () {})).toBe(true);
        });

        it('Reject invalid callback values', () => {
            expect(isValidCallback(null)).toBe(false);
            expect(isValidCallback(undefined)).toBe(false);
            expect(isValidCallback('function')).toBe(false);
            expect(isValidCallback(123)).toBe(false);
            expect(isValidCallback({})).toBe(false);
            expect(isValidCallback([])).toBe(false);
            expect(isValidCallback(true)).toBe(false);
        });

        it('Must recognize built-in functions', () => {
            expect(isValidCallback(console.log)).toBe(true);
            expect(isValidCallback(JSON.parse)).toBe(true);
            expect(isValidCallback(Math.max)).toBe(true);
        });
    });

    describe('isValidPriority', () => {
        it('must correctly recognize valid priority values', () => {
            expect(isValidPriority('high')).toBe(true);
            expect(isValidPriority('normal')).toBe(true);
            expect(isValidPriority('low')).toBe(true);
        });

        it('reject invalid priority values', () => {
            expect(isValidPriority('urgent')).toBe(false);
            expect(isValidPriority('medium')).toBe(false);
            expect(isValidPriority('highest')).toBe(false);
            expect(isValidPriority('lowest')).toBe(false);
            expect(isValidPriority('')).toBe(false);
            expect(isValidPriority(null)).toBe(false);
            expect(isValidPriority(undefined)).toBe(false);
            expect(isValidPriority(1)).toBe(false);
            expect(isValidPriority(['high'])).toBe(false);
            expect(isValidPriority({ priority: 'high' })).toBe(false);
        });

        it('should test case sensitivity', () => {
            expect(isValidPriority('HIGH')).toBe(false);
            expect(isValidPriority('High')).toBe(false);
            expect(isValidPriority('NORMAL')).toBe(false);
            expect(isValidPriority('Low')).toBe(false);
        });
    });
});

// Constants Tests
describe('Constants', () => {
    describe('PRIORITY_VALUES', () => {
        it('Must contain correct priority values', () => {
            expect(PRIORITY_VALUES.high).toBe(0);
            expect(PRIORITY_VALUES.normal).toBe(1);
            expect(PRIORITY_VALUES.low).toBe(2);
        });

        it('Priority order must be correct', () => {
            expect(PRIORITY_VALUES.high).toBeLessThan(PRIORITY_VALUES.normal);
            expect(PRIORITY_VALUES.normal).toBeLessThan(PRIORITY_VALUES.low);
        });

        it('All priority values ​​must be unique', () => {
            const values = Object.values(PRIORITY_VALUES);
            const uniqueValues = [...new Set(values)];
            expect(values.length).toBe(uniqueValues.length);
        });

        it('Must be numeric values', () => {
            Object.values(PRIORITY_VALUES).forEach((value) => {
                expect(typeof value).toBe('number');
                expect(Number.isInteger(value)).toBe(true);
                expect(value).toBeGreaterThanOrEqual(0);
            });
        });
    });

    describe('DEFAULT_PRIORITY', () => {
        it('Must be normal priority', () => {
            expect(DEFAULT_PRIORITY).toBe('normal');
        });

        it('Must be valid priority', () => {
            expect(isValidPriority(DEFAULT_PRIORITY)).toBe(true);
        });

        it('Must be in PRIORITY_VALUES', () => {
            expect(DEFAULT_PRIORITY in PRIORITY_VALUES).toBe(true);
        });
    });
});

// Function Type Tests
describe('Function Types', () => {
    describe('EventCallback', () => {
        it('sync callback should work correctly', () => {
            let executedData: string | null = null;

            const syncCallback: EventCallback<string> = (data) => {
                executedData = data;
            };

            const result = syncCallback('test data');
            expect(result).toBeUndefined();
            expect(executedData).toBe('test data');
        });

        it('async callback should work correctly', async () => {
            let executedData: number | null = null;

            const asyncCallback: EventCallback<number> = async (data) => {
                await new Promise((resolve) => setTimeout(resolve, 1));
                executedData = data;
            };

            const result = asyncCallback(123);
            expect(result).toBeInstanceOf(Promise);

            await result;
            expect(executedData).toBe(123);
        });

        it('complex data types should be handled', () => {
            interface ComplexData {
                id: string;
                metadata: Record<string, any>;
                items: Array<{ name: string; value: number }>;
            }

            let receivedData: ComplexData | null = null;

            const complexCallback: EventCallback<ComplexData> = (data) => {
                receivedData = data;
            };

            const testData: ComplexData = {
                id: 'test-123',
                metadata: { source: 'test', timestamp: Date.now() },
                items: [
                    { name: 'item1', value: 100 },
                    { name: 'item2', value: 200 },
                ],
            };

            complexCallback(testData);
            expect(receivedData).toEqual(testData);
        });
    });

    describe('UnsubscribeFn', () => {
        it('should return boolean', () => {
            const unsubscribe: UnsubscribeFn = () => true;
            const result = unsubscribe();

            expect(typeof result).toBe('boolean');
            expect(result).toBe(true);
        });

        it('be able to do state management', () => {
            let isSubscribed = true;

            const unsubscribe: UnsubscribeFn = () => {
                if (isSubscribed) {
                    isSubscribed = false;
                    return true;
                }
                return false;
            };

            expect(unsubscribe()).toBe(true);
            expect(unsubscribe()).toBe(false);
            expect(unsubscribe()).toBe(false);
        });

        it('multiple unsubscribe functions can be composed', () => {
            const results: boolean[] = [];

            const unsub1: UnsubscribeFn = () => {
                results.push(true);
                return true;
            };
            const unsub2: UnsubscribeFn = () => {
                results.push(false);
                return false;
            };
            const unsub3: UnsubscribeFn = () => {
                results.push(true);
                return true;
            };

            const composedUnsub: UnsubscribeFn = () => {
                return [unsub1(), unsub2(), unsub3()].every(Boolean);
            };

            expect(composedUnsub()).toBe(false);
            expect(results).toEqual([true, false, true]);
        });
    });
});

// Type utulity tests
describe('Type Utilities', () => {
    it('ExtractEventData should extract the correct data type', () => {
        type LoginData = ExtractEventData<TestUserEvents, 'user:login'>;
        type ErrorData = ExtractEventData<TestSystemEvents, 'system:error'>;

        const loginData: LoginData = {
            userId: 'user123',
            timestamp: Date.now(),
        };

        const errorData: ErrorData = {
            error: new Error('Test error'),
            context: 'test context',
        };

        expect(loginData.userId).toBe('user123');
        expect(typeof loginData.timestamp).toBe('number');
        expect(errorData.error).toBeInstanceOf(Error);
        expect(errorData.context).toBe('test context');
    });

    it('EventNames should output correct event names', () => {
        type UserEventNames = EventNames<TestUserEvents>;
        type SystemEventNames = EventNames<TestSystemEvents>;

        const userEvents: UserEventNames[] = ['user:login', 'user:logout'];

        const systemEvents: SystemEventNames[] = ['system:error', 'system:startup'];

        expect(userEvents).toContain('user:login');
        expect(userEvents).toContain('user:logout');
        expect(systemEvents).toContain('system:error');
        expect(systemEvents).toContain('system:startup');
    });
});

// integrations
describe('Integration Tests', () => {
    it('all type components should work together', () => {
        const handler: EventCallback<TestUserEvents['user:login']> = (data) => {
            expect(data.userId).toBeDefined();
            expect(data.timestamp).toBeDefined();
        };

        const eventKey: EventKey<TestUserEvents> = 'user:login';

        const priority: EventPriority = 'high';

        expect(isValidEventName(eventKey)).toBe(true);
        expect(isValidCallback(handler)).toBe(true);
        expect(isValidPriority(priority)).toBe(true);

        expect(PRIORITY_VALUES[priority]).toBe(0);

        const testData: TestUserEvents['user:login'] = {
            userId: 'test-user',
            timestamp: Date.now(),
        };

        expect(() => handler(testData)).not.toThrow();
    });

    it('runtime validation and type safety should work together', () => {
        function processEvent<T extends EventMap, K extends EventKey<T>>(
            eventName: unknown,
            callback: unknown,
            priority: unknown
        ) {
            if (!isValidEventName(eventName)) {
                throw new Error('Invalid event name');
            }

            if (!isValidCallback(callback)) {
                throw new Error('Invalid callback');
            }

            const validPriority = isValidPriority(priority) ? priority : DEFAULT_PRIORITY;

            return {
                event: eventName,
                callback: callback,
                priority: validPriority,
                priorityValue: PRIORITY_VALUES[validPriority],
            };
        }

        const result = processEvent('user:login', () => {}, 'high');

        expect(result.event).toBe('user:login');
        expect(typeof result.callback).toBe('function');
        expect(result.priority).toBe('high');
        expect(result.priorityValue).toBe(0);

        expect(() => processEvent('', () => {}, 'high')).toThrow('Invalid event name');
        expect(() => processEvent('test', 'not-function', 'high')).toThrow('Invalid callback');
        expect(() => processEvent('test', () => {}, 'invalid')).not.toThrow();
    });
});
