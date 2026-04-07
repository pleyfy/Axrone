import { MemoryPool as UtilityMemoryPool, MemoryPoolOptions } from '../../pool';
import { StackNode, MemoryAddress } from './types';

class PoolNode<T> implements StackNode<T> {
    public __poolId?: number;
    public __poolStatus?: any;
    public __lastAccessed?: number;
    public __allocCount?: number;

    public id: number = 0 as any;
    public value!: T;
    public next: PoolNode<T> | null = null;
    public refs: number = 0;
    public generation: number = 0;
    public memAddr: MemoryAddress = 0 as any;

    reset(): void {
        this.value = undefined as any;
        this.next = null;
        this.refs = 0;
        this.generation = 0;
        this.memAddr = 0 as any;
    }
}

export class StackMemoryPool {
    private readonly pool: UtilityMemoryPool<PoolNode<any>>;
    private idCounter = 1;

    constructor(options?: Partial<MemoryPoolOptions<PoolNode<any>>>) {
        const opts: MemoryPoolOptions<PoolNode<any>> = Object.assign(
            {
                initialCapacity: 64,
                maxCapacity: 4096,
                factory: () => new PoolNode<any>(),
                resetOnRecycle: true,
                autoExpand: true,
                enableMetrics: false,
                name: `StackMemoryPool-${Math.floor(Math.random() * 1e6)}`,
            },
            options || {}
        );

        this.pool = new UtilityMemoryPool<PoolNode<any>>(opts);
    }

    allocate<T>(value: T, next: StackNode<T> | null, generation: number): StackNode<T> {
        const node = this.pool.acquire() as PoolNode<T>;
        node.id = this.idCounter++ as any;
        node.value = value;
        node.next = next as PoolNode<T> | null;
        node.refs = 1;
        node.generation = generation;
        node.memAddr = (node.__poolId ?? 0) as any;

        return node as unknown as StackNode<T>;
    }

    deallocate<T>(node: StackNode<T>): void {
        if ((node as any).refs > 1) return;

        try {
            this.pool.release(node as unknown as PoolNode<any>);
        } catch (e) {
            // ignore pool errors
        }
    }

    clear(): void {
        try {
            this.pool.clear();
        } catch (e) {
            // ignore
        }
    }

    getStats() {
        try {
            const m = this.pool.getMetrics();
            return {
                totalAllocated: m.allocations,
                totalDeallocated: m.releases,
                poolSizes: [{ sizeKey: 'capacity', poolSize: m.capacity }],
                fragmentation: (m as any).fragmentationRatio ?? 0,
            };
        } catch (e) {
            return { totalAllocated: 0, totalDeallocated: 0, poolSizes: [], fragmentation: 0 };
        }
    }
}
