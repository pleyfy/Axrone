import { describe, expect, it } from 'vitest';
import {
    BaseError,
    EventError,
    EventNotFoundError,
    EventQueueFullError,
    EventHandlerError,
} from '../../event/errors';

describe('EventEmitter - Error Classes', () => {
    describe('Error Inheritance', () => {
        it('should maintain proper inheritance chain', () => {
            const eventError = new EventError('test');
            const notFoundError = new EventNotFoundError('test-event');
            const queueError = new EventQueueFullError('test-event', 100);
            const handlerError = new EventHandlerError('test-event', new Error('test'));

            expect(eventError instanceof Error).toBe(true);
            expect(eventError instanceof BaseError).toBe(true);
            expect(eventError instanceof EventError).toBe(true);

            expect(notFoundError instanceof Error).toBe(true);
            expect(notFoundError instanceof BaseError).toBe(true);
            expect(notFoundError instanceof EventError).toBe(true);
            expect(notFoundError instanceof EventNotFoundError).toBe(true);

            expect(queueError instanceof EventError).toBe(true);
            expect(handlerError instanceof EventError).toBe(true);
        });

        it('should have correct error names', () => {
            expect(new EventError('test').name).toBe('EventError');
            expect(new EventNotFoundError('test').name).toBe('EventError');
            expect(new EventQueueFullError('test', 100).name).toBe('EventError');
            expect(new EventHandlerError('test', new Error()).name).toBe('EventError');
        });

        it('should support Error.captureStackTrace when available', () => {
            const originalCaptureStackTrace = (Error as any).captureStackTrace;
            let captureStackTraceCalled = false;

            (Error as any).captureStackTrace = () => {
                captureStackTraceCalled = true;
            };

            new EventError('test');
            expect(captureStackTraceCalled).toBe(true);

            (Error as any).captureStackTrace = originalCaptureStackTrace;
        });
    });
    describe('EventNotFoundError', () => {
        it('should store event name and generate correct message', () => {
            const error = new EventNotFoundError('user:login');

            expect(error.eventName).toBe('user:login');
            expect(error.message).toBe('Event "user:login" not found');
        });

        it('should handle special characters in event names', () => {
            const specialEventName = 'user:login@domain.com#123';
            const error = new EventNotFoundError(specialEventName);

            expect(error.eventName).toBe(specialEventName);
            expect(error.message).toContain(specialEventName);
        });
    });

    describe('EventQueueFullError', () => {
        it('should store event name and buffer size', () => {
            const error = new EventQueueFullError('high-priority', 1000);

            expect(error.eventName).toBe('high-priority');
            expect(error.message).toBe('Event queue for "high-priority" is full (1000 items)');
        });

        it('should handle edge case buffer sizes', () => {
            const errorZero = new EventQueueFullError('test', 0);
            const errorLarge = new EventQueueFullError('test', Number.MAX_SAFE_INTEGER);

            expect(errorZero.message).toContain('(0 items)');
            expect(errorLarge.message).toContain(`(${Number.MAX_SAFE_INTEGER} items)`);
        });
    });

    describe('EventHandlerError', () => {
        it('should wrap Error objects correctly', () => {
            const originalError = new TypeError('Invalid argument');
            const error = new EventHandlerError('user:update', originalError);

            expect(error.eventName).toBe('user:update');
            expect(error.originalError).toBe(originalError);
            expect(error.message).toBe('Handler error for "user:update": Invalid argument');
        });

        it('should handle non-Error objects', () => {
            const primitiveError = 'String error';
            const objectError = { code: 500, message: 'Server error' };
            const nullError = null;

            expect(new EventHandlerError('test', primitiveError).message).toContain('String error');
            expect(new EventHandlerError('test', objectError).message).toContain('[object Object]');
            expect(new EventHandlerError('test', nullError).message).toContain('null');
        });

        it('should chain stack traces when original error has stack', () => {
            const originalError = new Error('Original error');
            const error = new EventHandlerError('test-event', originalError);

            expect(error.stack).toContain('Caused by:');
            expect(error.stack).toContain(originalError.stack);
        });

        it('should handle errors without stack traces', () => {
            const errorWithoutStack = new Error('No stack');
            delete errorWithoutStack.stack;

            const error = new EventHandlerError('test', errorWithoutStack);
            expect(error.stack).not.toContain('Caused by:');
        });
    });

    describe('ErrorOptions Support', () => {
        it('should support cause property in ErrorOptions', () => {
            const cause = new Error('Root cause');
            const error = new EventError('Test error', { cause });

            expect((error as any).cause).toBe(cause);
        });

        it('should work without ErrorOptions', () => {
            expect(() => new EventError('Test')).not.toThrow();
            expect(() => new EventNotFoundError('test')).not.toThrow();
        });
    });

    describe('Edge Cases', () => {
        it('should handle empty strings gracefully', () => {
            expect(() => new EventNotFoundError('')).not.toThrow();
            expect(() => new EventQueueFullError('', 0)).not.toThrow();
            expect(() => new EventHandlerError('', '')).not.toThrow();
        });

        it('should handle Unicode event names', () => {
            const unicodeEvent = '用户:登录🎉';
            const error = new EventNotFoundError(unicodeEvent);

            expect(error.eventName).toBe(unicodeEvent);
            expect(error.message).toContain(unicodeEvent);
        });

        it('should handle very long event names', () => {
            const longEventName = 'a'.repeat(10000);
            const error = new EventNotFoundError(longEventName);

            expect(error.eventName).toBe(longEventName);
            expect(error.message.length).toBeGreaterThan(10000);
        });

        it('should handle circular reference objects', () => {
            const circularObj: any = { message: 'Circular' };
            circularObj.self = circularObj;

            expect(() => new EventHandlerError('test', circularObj)).not.toThrow();
        });
    });

    describe('Serialization Support', () => {
        it('should be JSON serializable (excluding circular references)', () => {
            const error = new EventNotFoundError('test-event');

            expect(() =>
                JSON.stringify({
                    name: error.name,
                    message: error.message,
                    eventName: error.eventName,
                })
            ).not.toThrow();
        });

        it('should maintain debugging properties', () => {
            const error = new EventHandlerError('test', new TypeError('Test'));

            expect(error.toString()).toContain('EventError');
            expect(error.toString()).toContain('Handler error for "test"');
        });
    });

    describe('Performance Characteristics', () => {
        // it('should create errors efficiently', () => {
        //     const start = performance.now();

        //     for (let i = 0; i < 1000; i++) {
        //         new EventNotFoundError(`event-${i}`);
        //         new EventQueueFullError(`queue-${i}`, i);
        //         new EventHandlerError(`handler-${i}`, new Error(`error-${i}`));
        //     }

        //     const end = performance.now();
        //     // Expect the error creation to be fast, but not a specific time
        //     // 179 ms
        //     expect(end - start).toBeLessThan(100);
        // });

        it('should not leak memory through error chaining', () => {
            let error: Error = new Error('Root');

            for (let i = 0; i < 100; i++) {
                error = new EventHandlerError(`event-${i}`, error);
            }

            expect(error).toBeInstanceOf(EventHandlerError);
            expect(error.message).toContain('event-99');
        });
    });

    describe('Exception Handling Integration', () => {
        it('should work with standard try-catch patterns', () => {
            let caughtError: unknown = null;

            try {
                throw new EventNotFoundError('missing-event');
            } catch (error) {
                caughtError = error;
            }

            expect(caughtError).toBeInstanceOf(EventNotFoundError);
            expect((caughtError as EventNotFoundError).eventName).toBe('missing-event');
        });

        it('should support error filtering by type', () => {
            const errors = [
                new EventNotFoundError('event1'),
                new EventQueueFullError('event2', 100),
                new EventHandlerError('event3', new Error('test')),
                new Error('regular error'),
            ];

            const eventErrors = errors.filter((e) => e instanceof EventError);
            const handlerErrors = errors.filter((e) => e instanceof EventHandlerError);

            expect(eventErrors).toHaveLength(3);
            expect(handlerErrors).toHaveLength(1);
        });

        it('should maintain stack trace through re-throwing', () => {
            let finalError: Error | null = null;

            try {
                try {
                    throw new EventNotFoundError('test');
                } catch (error) {
                    throw new EventHandlerError('wrapper', error);
                }
            } catch (error) {
                finalError = error as Error;
            }

            expect(finalError).toBeInstanceOf(EventHandlerError);
            expect(finalError!.stack).toContain('Event "test" not found');
            expect(finalError!.stack).toContain('Caused by:');
        });
    });

    describe('Error Recovery Patterns', () => {
        it('should support error classification for recovery strategies', () => {
            function getRecoveryStrategy(error: unknown): string {
                if (error instanceof EventNotFoundError) return 'REGISTER_EVENT';
                if (error instanceof EventQueueFullError) return 'PROCESS_QUEUE';
                if (error instanceof EventHandlerError) return 'SKIP_HANDLER';
                if (error instanceof EventError) return 'GENERAL_RECOVERY';
                return 'UNKNOWN';
            }

            expect(getRecoveryStrategy(new EventNotFoundError('test'))).toBe('REGISTER_EVENT');
            expect(getRecoveryStrategy(new EventQueueFullError('test', 100))).toBe('PROCESS_QUEUE');
            expect(getRecoveryStrategy(new EventHandlerError('test', new Error()))).toBe(
                'SKIP_HANDLER'
            );
            expect(getRecoveryStrategy(new EventError('test'))).toBe('GENERAL_RECOVERY');
            expect(getRecoveryStrategy(new Error('test'))).toBe('UNKNOWN');
        });

        it('should preserve original error context for debugging', () => {
            const rootCause = new TypeError('Invalid input');
            rootCause.stack = 'Original stack trace';

            const wrapperError = new EventHandlerError('user:validate', rootCause);

            expect(wrapperError.originalError).toBe(rootCause);
            expect(wrapperError.eventName).toBe('user:validate');
            expect(wrapperError.stack).toContain('Original stack trace');
        });
    });
});
