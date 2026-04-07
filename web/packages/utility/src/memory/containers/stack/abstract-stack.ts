import { StackIntegrityError } from './errors';
import { StackMemoryPool as MemoryPool } from './pool-adapter';
import { StackIterator } from './stack-iterator';
import { createStackSize, __variance, createStackCapacity } from './stack';
import { ReadonlyStackInterface, StackConfiguration } from './interfaces';
import { StackSize, StackNode, StackCapacity, StackResult, NodeId } from './types';

export abstract class AbstractStack<T> implements ReadonlyStackInterface<T> {
    protected _size: StackSize = createStackSize(0);
    protected _head: StackNode<T> | null = null;
    protected _generation = 1;
    protected _checksum = 0;
    protected readonly _capacity: StackCapacity | null;
    protected readonly _config: Required<StackConfiguration<T>>;
    protected readonly _memoryPool: MemoryPool;

    private _operationCount = 0;
    readonly [__variance] = undefined as any;

    constructor(config: StackConfiguration<T> = {}) {
        this._capacity = config.capacity ? createStackCapacity(config.capacity) : null;
        this._config = {
            capacity: config.capacity ?? 1000,
            enablePooling: config.enablePooling ?? true,
            enableAlignment: config.enableAlignment ?? false,
            enableIntegrityChecks: config.enableIntegrityChecks ?? false,
            cachePolicy: config.cachePolicy ?? 'none',
            serializationStrategy: config.serializationStrategy ?? 'json',
            compareFn: config.compareFn ?? Object.is,
            hashFn: config.hashFn ?? this.defaultHashFn,
            serializeFn: config.serializeFn ?? this.defaultSerializeFn,
            deserializeFn: config.deserializeFn ?? this.defaultDeserializeFn,
            validateFn: config.validateFn ?? (() => true),
            transformFn: config.transformFn ?? ((x: T) => x),
        };

        this._memoryPool = new MemoryPool();
    }

    get size(): StackSize {
        return this._size;
    }
    get capacity(): StackCapacity | null {
        return this._capacity;
    }
    get isEmpty(): boolean {
        return this._size === 0;
    }
    get isFull(): boolean {
        return this._capacity !== null && this._size >= this._capacity;
    }
    get generation(): number {
        return this._generation;
    }
    get checksum(): number {
        return this._checksum;
    }

    peek(): StackResult<T | undefined> {
        if (this._head === null) {
            return { tag: 'success', value: undefined, cost: 1 };
        }
        return { tag: 'success', value: this._head.value, cost: 1 };
    }

    peekUnsafe(): T | undefined {
        return this._head?.value;
    }

    peekMany(count: number): StackResult<readonly T[], StackIntegrityError> {
        if (count < 0 || count > this._size) {
            return {
                tag: 'failure',
                error: new StackIntegrityError('Invalid peek count', { count, size: this._size }),
            };
        }

        const result: T[] = [];
        let current = this._head;
        let remaining = count;

        while (current !== null && remaining > 0) {
            result.push(current.value);
            current = current.next;
            remaining--;
        }

        return { tag: 'success', value: Object.freeze(result), cost: count };
    }

    contains(value: T): boolean {
        let current = this._head;
        while (current !== null) {
            if (this._config.compareFn(current.value, value)) {
                return true;
            }
            current = current.next;
        }
        return false;
    }

    indexOf(value: T): number {
        let current = this._head;
        let index = 0;

        while (current !== null) {
            if (this._config.compareFn(current.value, value)) {
                return index;
            }
            current = current.next;
            index++;
        }

        return -1;
    }

    toArray(): readonly T[] {
        const result: T[] = new Array(this._size);
        let current = this._head;
        let index = 0;

        while (current !== null && index < this._size) {
            result[index++] = current.value;
            current = current.next;
        }

        return Object.freeze(result);
    }

    toReversedArray(): readonly T[] {
        const array = this.toArray();
        const result = new Array(array.length);
        for (let i = 0; i < array.length; i++) {
            result[i] = array[array.length - 1 - i];
        }
        return Object.freeze(result);
    }

    slice(start = 0, end = this._size): readonly T[] {
        const actualStart = Math.max(0, start);
        const actualEnd = Math.min(this._size, end);
        const length = Math.max(0, actualEnd - actualStart);

        if (length === 0) return Object.freeze([]);

        const result: T[] = new Array(length);
        let current = this._head;
        let index = 0;
        let resultIndex = 0;

        while (current !== null && resultIndex < length) {
            if (index >= actualStart) {
                result[resultIndex++] = current.value;
            }
            current = current.next;
            index++;
        }

        return Object.freeze(result);
    }

    serialize(): ArrayBuffer {
        const values = this.toArray();
        const buffers = values.map((v) => this._config.serializeFn(v));
        const totalSize = buffers.reduce((sum, buf) => sum + buf.byteLength + 4, 8);

        const result = new ArrayBuffer(totalSize);
        const view = new DataView(result);
        let offset = 0;

        view.setUint32(offset, this._size, true);
        offset += 4;
        view.setUint32(offset, this._generation, true);
        offset += 4;

        for (const buffer of buffers) {
            view.setUint32(offset, buffer.byteLength, true);
            offset += 4;
            new Uint8Array(result, offset, buffer.byteLength).set(new Uint8Array(buffer));
            offset += buffer.byteLength;
        }

        return result;
    }

    equals(other: ReadonlyStackInterface<T>): boolean {
        if (this.size !== other.size) return false;
        if (this.checksum !== other.checksum) return false;

        const thisArray = this.toArray();
        const otherArray = other.toArray();

        return thisArray.every((value, index) => this._config.compareFn(value, otherArray[index]));
    }

    hash(): number {
        let hash = 0;
        let current = this._head;

        while (current !== null) {
            hash = (hash * 31 + this._config.hashFn(current.value)) | 0;
            current = current.next;
        }

        return hash;
    }

    validate(): StackResult<boolean, StackIntegrityError> {
        if (!this._config.enableIntegrityChecks) {
            return { tag: 'success', value: true, cost: 0 };
        }

        let count = 0;
        let current = this._head;
        const visited = new Set<NodeId>();

        while (current !== null) {
            if (visited.has(current.id)) {
                return {
                    tag: 'failure',
                    error: new StackIntegrityError('Cycle detected in stack', {
                        nodeId: current.id,
                    }),
                };
            }

            visited.add(current.id);

            if (!this._config.validateFn(current.value)) {
                return {
                    tag: 'failure',
                    error: new StackIntegrityError('Invalid value detected', {
                        nodeId: current.id,
                        value: current.value,
                    }),
                };
            }

            current = current.next;
            count++;

            if (count > this._size) {
                return {
                    tag: 'failure',
                    error: new StackIntegrityError('Size mismatch detected', {
                        counted: count,
                        expected: this._size,
                    }),
                };
            }
        }

        if (count !== this._size) {
            return {
                tag: 'failure',
                error: new StackIntegrityError('Size mismatch', {
                    counted: count,
                    expected: this._size,
                }),
            };
        }

        return { tag: 'success', value: true, cost: count };
    }

    [Symbol.iterator](): IterableIterator<T> {
        return new StackIterator(this._head, this._checksum);
    }

    protected updateChecksum(): void {
        this._checksum = this.hash();
    }

    protected incrementGeneration(): void {
        this._generation++;
    }

    private defaultHashFn(value: T): number {
        if (typeof value === 'string') {
            let hash = 0;
            for (let i = 0; i < value.length; i++) {
                hash = (hash * 31 + value.charCodeAt(i)) | 0;
            }
            return hash;
        }

        if (typeof value === 'number') {
            return value | 0;
        }

        return JSON.stringify(value).length;
    }

    private defaultSerializeFn(value: T): ArrayBuffer {
        const str = JSON.stringify(value);
        const encoder = new TextEncoder();
        return encoder.encode(str).buffer as ArrayBuffer;
    }

    private defaultDeserializeFn(data: ArrayBuffer): T {
        const decoder = new TextDecoder();
        const str = decoder.decode(data);
        return JSON.parse(str);
    }
}
