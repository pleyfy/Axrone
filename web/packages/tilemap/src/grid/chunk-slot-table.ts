import { TilemapErrorCode, TilemapFault } from '../errors';
import { mix32 } from '../codec/checksum';

const EMPTY = 0;
const USED = 1;
const TOMBSTONE = 2;
const MIN_CAPACITY = 8;
const MAX_LOAD_FACTOR = 0.7;
const NO_SLOT = -1;

export interface ChunkSlotTableOptions {
    readonly capacity?: number;
    readonly onRehash?: (capacity: number) => void;
}

/**
 * Open-addressing chunk key → slab slot map over typed arrays.
 *
 * Linear probing with tombstones; the table doubles when the used ratio
 * (live + tombstones) passes 0.7. Deletion leaves a tombstone so probe chains
 * stay valid, and a rehash drops them.
 */
export class ChunkSlotTable {
    #capacity: number;
    #keys: Uint32Array;
    #slots: Int32Array;
    #states: Uint8Array;
    #used = 0;
    #live = 0;
    readonly #onRehash: ((capacity: number) => void) | undefined;

    constructor(options: ChunkSlotTableOptions = {}) {
        const requested = options.capacity ?? 64;
        if (!Number.isInteger(requested) || requested < MIN_CAPACITY) {
            throw new TilemapFault(
                `chunk slot table capacity must be an integer >= ${MIN_CAPACITY}`,
                TilemapErrorCode.INVALID_CONFIGURATION,
                { capacity: requested }
            );
        }
        this.#capacity = nextPowerOfTwo(requested);
        this.#keys = new Uint32Array(this.#capacity);
        this.#slots = new Int32Array(this.#capacity).fill(NO_SLOT);
        this.#states = new Uint8Array(this.#capacity);
        this.#onRehash = options.onRehash;
    }

    get size(): number {
        return this.#live;
    }

    get capacity(): number {
        return this.#capacity;
    }

    find(key: number): number {
        let index = mix32(key) & (this.#capacity - 1);
        for (;;) {
            const state = this.#states[index]!;
            if (state === EMPTY) return NO_SLOT;
            if (state === USED && this.#keys[index] === key) {
                return this.#slots[index]!;
            }
            index = (index + 1) & (this.#capacity - 1);
        }
    }

    insert(key: number, slot: number): void {
        if (this.#used + 1 > this.#capacity * MAX_LOAD_FACTOR) {
            this.#grow();
        }
        let index = mix32(key) & (this.#capacity - 1);
        let free = NO_SLOT;
        for (;;) {
            const state = this.#states[index]!;
            if (state === EMPTY) {
                if (free < 0) free = index;
                break;
            }
            if (state === USED && this.#keys[index] === key) {
                this.#slots[index] = slot;
                return;
            }
            if (state === TOMBSTONE && free < 0) free = index;
            index = (index + 1) & (this.#capacity - 1);
        }
        const state = this.#states[free]!;
        this.#states[free] = USED;
        this.#keys[free] = key;
        this.#slots[free] = slot;
        if (state !== TOMBSTONE) this.#used++;
        this.#live++;
    }

    remove(key: number): boolean {
        let index = mix32(key) & (this.#capacity - 1);
        for (;;) {
            const state = this.#states[index]!;
            if (state === EMPTY) return false;
            if (state === USED && this.#keys[index] === key) {
                this.#states[index] = TOMBSTONE;
                this.#slots[index] = NO_SLOT;
                this.#live--;
                if (this.#live === 0) this.#reset();
                return true;
            }
            index = (index + 1) & (this.#capacity - 1);
        }
    }

    clear(): void {
        this.#reset();
    }

    forEachLive(callback: (key: number, slot: number) => void): void {
        for (let index = 0; index < this.#capacity; index++) {
            if (this.#states[index] === USED) {
                callback(this.#keys[index]!, this.#slots[index]!);
            }
        }
    }

    #findEntry(key: number): number {
        let index = mix32(key) & (this.#capacity - 1);
        for (;;) {
            const state = this.#states[index]!;
            if (state === EMPTY) return NO_SLOT;
            if (state === USED && this.#keys[index] === key) return index;
            index = (index + 1) & (this.#capacity - 1);
        }
    }

    #grow(): void {
        const previousKeys = this.#keys;
        const previousSlots = this.#slots;
        const previousStates = this.#states;
        const previousCapacity = this.#capacity;

        this.#capacity = previousCapacity * 2;
        this.#keys = new Uint32Array(this.#capacity);
        this.#slots = new Int32Array(this.#capacity).fill(NO_SLOT);
        this.#states = new Uint8Array(this.#capacity);
        this.#used = 0;
        this.#live = 0;

        for (let index = 0; index < previousCapacity; index++) {
            if (previousStates[index] === USED) {
                this.insert(previousKeys[index]!, previousSlots[index]!);
            }
        }
        this.#onRehash?.(this.#capacity);
    }

    #reset(): void {
        this.#keys.fill(0);
        this.#slots.fill(NO_SLOT);
        this.#states.fill(EMPTY);
        this.#used = 0;
        this.#live = 0;
    }
}

const nextPowerOfTwo = (value: number): number => {
    let capacity = MIN_CAPACITY;
    while (capacity < value) capacity *= 2;
    return capacity;
};
