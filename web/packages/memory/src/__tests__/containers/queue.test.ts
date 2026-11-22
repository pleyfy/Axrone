import { describe, expect, it, vi } from 'vitest';
import {
    LifecycleState,
    ObjectPoolChunkAllocator,
    OverflowStrategy,
    Queue,
    QueueBuilder,
    QueueEmptyError,
    QueueFullError,
    NULL_METRICS,
} from '../../containers/queue/core';

function expectOk<T, E>(result: { isOk(): boolean; get(): T }): T {
    expect(result.isOk()).toBe(true);
    return result.get();
}

describe('Chunked Queue', () => {
    describe('FIFO ordering', () => {
        it('preserves order across chunk boundaries', () => {
            const queue = new Queue<number>();

            for (let i = 0; i < 2500; i++) {
                queue.enqueue(i);
            }

            for (let i = 0; i < 700; i++) {
                expect(queue.tryDequeue()).toBe(i);
            }

            for (let i = 2500; i < 4000; i++) {
                queue.enqueue(i);
            }

            for (let i = 700; i < 4000; i++) {
                expect(queue.tryDequeue()).toBe(i);
            }

            expect(queue.isEmpty).toBe(true);
        });

        it('peek returns head without removing it', () => {
            const queue = new Queue<string>();
            queue.enqueue('a');
            queue.enqueue('b');

            expect(queue.peek()).toBe('a');
            expect(queue.size).toBe(2);
        });

        it('toArray and iterator return head-to-tail order', () => {
            const queue = new Queue<number>();
            queue.enqueueBatch([1, 2, 3, 4, 5]);

            expect(queue.toArray()).toEqual([1, 2, 3, 4, 5]);
            expect([...queue]).toEqual([1, 2, 3, 4, 5]);
        });

        it('contains finds values across chunks', () => {
            const queue = new Queue<number>();
            for (let i = 0; i < 1500; i++) queue.enqueue(i);

            expect(queue.contains(0)).toBe(true);
            expect(queue.contains(1024)).toBe(true);
            expect(queue.contains(1499)).toBe(true);
            expect(queue.contains(1500)).toBe(false);
        });
    });

    describe('result-based operations', () => {
        it('dequeue on empty queue returns QUEUE_EMPTY', () => {
            const queue = new Queue<number>();
            const result = queue.dequeue();

            expect(result.isErr()).toBe(true);
            expect(result.errToOptional()?.code).toBe('QUEUE_EMPTY');
            expect(result.errToOptional()).toBeInstanceOf(QueueEmptyError);
        });

        it('tryDequeue returns undefined on empty queue', () => {
            const queue = new Queue<number>();
            expect(queue.tryDequeue()).toBeUndefined();
        });

        it('tryEnqueue returns false when bounded queue is full', () => {
            const queue = new Queue<number>(2);
            expect(queue.tryEnqueue(1)).toBe(true);
            expect(queue.tryEnqueue(2)).toBe(true);
            expect(queue.tryEnqueue(3)).toBe(false);
        });

        it('dequeueBatch returns a typed batch', () => {
            const queue = new Queue<number>();
            queue.enqueueBatch([10, 20, 30, 40]);

            const batch = expectOk(queue.dequeueBatch(3));
            expect(batch).toEqual([10, 20, 30]);
            expect(queue.size).toBe(1);
        });

        it('dequeueBatch reports underflow', () => {
            const queue = new Queue<number>();
            queue.enqueue(1);

            const result = queue.dequeueBatch(2);
            expect(result.isErr()).toBe(true);
            expect(result.errToOptional()?.code).toBe('QUEUE_UNDERFLOW');
        });
    });

    describe('bulk enqueue', () => {
        it('enqueues batches across chunk boundaries', () => {
            const queue = new Queue<number>();
            const values = Array.from({ length: 5000 }, (_, i) => i);

            const size = expectOk(queue.enqueueBatch(values));
            expect(size).toBe(5000);
            expect(queue.size).toBe(5000);
            expect(queue.toArray()).toEqual(values);
        });

        it('drops the tail when DROP_TAIL capacity is exceeded', () => {
            const queue = new Queue<number>(3, OverflowStrategy.DropTail);
            expectOk(queue.enqueueBatch([1, 2]));

            expectOk(queue.enqueueBatch([3, 4]));
            expect(queue.toArray()).toEqual([1, 2, 3]);
        });

        it('drops the head when DROP_HEAD capacity is exceeded', () => {
            const queue = new Queue<number>(3, OverflowStrategy.DropHead);
            expectOk(queue.enqueueBatch([1, 2]));

            expectOk(queue.enqueueBatch([3, 4]));
            expect(queue.toArray()).toEqual([2, 3, 4]);
        });

        it('replaces contents when a DROP_HEAD batch exceeds capacity', () => {
            const queue = new Queue<number>(3, OverflowStrategy.DropHead);
            expectOk(queue.enqueueBatch([1, 2, 3]));

            expectOk(queue.enqueueBatch([4, 5, 6, 7, 8]));
            expect(queue.toArray()).toEqual([6, 7, 8]);
        });

        it('rejects oversized batches with REJECT strategy', () => {
            const queue = new Queue<number>(3);
            expectOk(queue.enqueueBatch([1, 2]));

            const result = queue.enqueueBatch([3, 4]);
            expect(result.isErr()).toBe(true);
            expect(result.errToOptional()).toBeInstanceOf(QueueFullError);
            expect(queue.toArray()).toEqual([1, 2]);
        });
    });

    describe('lifecycle', () => {
        it('starts active and rejects work after close', () => {
            const queue = new Queue<number>();
            expect(queue.state).toBe(LifecycleState.Active);

            queue.close();

            expect(queue.state).toBe(LifecycleState.Drained);
            expect(queue.isClosed).toBe(true);
            expect(queue.enqueue(1).errToOptional()?.code).toBe('QUEUE_CLOSED');
            expect(queue.dequeue().errToOptional()?.code).toBe('QUEUE_CLOSED');
        });

        it('drains buffered items while closing', () => {
            const queue = new Queue<number>();
            queue.enqueueBatch([1, 2, 3]);
            queue.close('terminal');

            expect(queue.state).toBe(LifecycleState.Closing);
            expect(expectOk(queue.dequeue())).toBe(1);
            expect(expectOk(queue.dequeue())).toBe(2);
            expect(expectOk(queue.dequeue())).toBe(3);
            expect(queue.state).toBe(LifecycleState.Drained);
        });

        it('resolves drain waiters once the queue empties', async () => {
            const queue = new Queue<number>();
            queue.enqueueBatch([1, 2]);
            queue.close();

            const drained = queue.drain();
            expectOk(queue.dequeue());
            expectOk(queue.dequeue());

            await expect(drained).resolves.toBeUndefined();
        });

        it('disposes to terminated state', () => {
            const queue = new Queue<number>();
            queue.enqueue(1);

            queue[Symbol.dispose]();

            expect(queue.state).toBe(LifecycleState.Terminated);
            expect(queue.enqueue(2).errToOptional()?.code).toBe('QUEUE_CLOSED');
        });

        it('clear releases all buffered items', () => {
            const queue = new Queue<number>();
            queue.enqueueBatch([1, 2, 3]);

            queue.clear();

            expect(queue.isEmpty).toBe(true);
            expect(queue.toArray()).toEqual([]);
            expect(queue.tryEnqueue(4)).toBe(true);
        });

        it('clone preserves contents and configuration', () => {
            const queue = new Queue<number>(10, OverflowStrategy.DropHead);
            queue.enqueueBatch([1, 2, 3]);

            const copy = queue.clone();
            expect(copy.toArray()).toEqual([1, 2, 3]);
            expect(copy.capacity).toBe(10);
        });
    });

    describe('async operations', () => {
        it('dequeueAsync resolves when an item arrives', async () => {
            const queue = new Queue<number>();
            const pending = queue.dequeueAsync();

            queue.enqueue(42);
            const result = await pending;

            expect(expectOk(result)).toBe(42);
        });

        it('enqueueAsync blocks until capacity frees', async () => {
            const queue = new Queue<number>(1, OverflowStrategy.Block);
            queue.enqueue(1);

            let settled = false;
            const pending = queue.enqueueAsync(2).then((result) => {
                settled = true;
                return result;
            });

            expect(settled).toBe(false);
            expectOk(queue.dequeue());
            const result = await pending;

            expect(result.isOk()).toBe(true);
            expect(queue.toArray()).toEqual([2]);
        });

        it('enqueueAsync aborts via AbortSignal', async () => {
            const queue = new Queue<number>(1, OverflowStrategy.Block);
            queue.enqueue(1);

            const controller = new AbortController();
            const pending = queue.enqueueAsync(2, controller.signal);
            controller.abort('stop');

            const result = await pending;
            expect(result.isErr()).toBe(true);
            expect(result.errToOptional()?.code).toBe('QUEUE_ABORTED');
            expect(queue.size).toBe(1);
        });

        it('dequeueAsync aborts via AbortSignal', async () => {
            const queue = new Queue<number>();
            const controller = new AbortController();
            const pending = queue.dequeueAsync(controller.signal);
            controller.abort('stop');

            const result = await pending;
            expect(result.isErr()).toBe(true);
            expect(result.errToOptional()?.code).toBe('QUEUE_ABORTED');
        });

        it('async iterator yields until closed', async () => {
            const queue = new Queue<number>();
            queue.enqueueBatch([1, 2]);
            queue.close();

            const seen: number[] = [];
            for await (const value of queue) {
                seen.push(value);
            }

            expect(seen).toEqual([1, 2]);
        });
    });

    describe('metrics', () => {
        it('reports enqueue and dequeue sizes', () => {
            const onEnqueue = vi.fn();
            const onDequeue = vi.fn();
            const queue = new Queue<number>(16, OverflowStrategy.Reject, {
                ...NULL_METRICS,
                onEnqueue,
                onDequeue,
            });

            queue.enqueue(1);
            queue.dequeue();

            expect(onEnqueue).toHaveBeenCalledWith(1);
            expect(onDequeue).toHaveBeenCalledWith(0);
        });
    });

    describe('builder', () => {
        it('builds an unbounded queue', () => {
            const queue = QueueBuilder.create<number>().unbounded().build();
            expect(queue.capacity).toBe(Number.MAX_SAFE_INTEGER);
        });

        it('builds a bounded queue with default REJECT strategy', () => {
            const queue = QueueBuilder.create<number>().bounded(4).build();
            queue.enqueueBatch([1, 2, 3, 4]);

            expect(queue.isFull).toBe(true);
            expect(queue.enqueue(5).errToOptional()?.code).toBe('QUEUE_FULL');
        });

        it('builds a bounded queue with an explicit strategy', () => {
            const queue = QueueBuilder.create<number>()
                .bounded(2)
                .withOverflowStrategy(OverflowStrategy.DropHead)
                .build();

            queue.enqueueBatch([1, 2, 3]);

            expect(queue.toArray()).toEqual([2, 3]);
        });
    });

    describe('pool integration', () => {
        it('runs on an injected ObjectPool chunk allocator', () => {
            const allocator = new ObjectPoolChunkAllocator<number>({
                initialCapacity: 2,
                maxCapacity: 64,
            });
            const queue = QueueBuilder.create<number>()
                .unbounded()
                .withAllocator(allocator)
                .build();

            const values = Array.from({ length: 2000 }, (_, i) => i);
            expectOk(queue.enqueueBatch(values));

            for (let i = 0; i < 1500; i++) {
                expect(queue.tryDequeue()).toBe(i);
            }

            expect(queue.toArray()).toEqual(values.slice(1500));
            expect(allocator.totalCount).toBeGreaterThan(0);

            queue.clear();
            expect(queue.isEmpty).toBe(true);

            allocator[Symbol.dispose]();
        });
    });

    describe('stress', () => {
        it('maintains integrity over 100K mixed operations', () => {
            const queue = new Queue<number>();
            let expected = 0;

            for (let i = 0; i < 100_000; i++) {
                queue.enqueue(i);
                if ((i & 1) === 0) {
                    expect(queue.tryDequeue()).toBe(expected++);
                }
            }

            for (let i = expected; i < 100_000; i++) {
                expect(queue.tryDequeue()).toBe(i);
            }

            expect(queue.isEmpty).toBe(true);
        });
    });
});
