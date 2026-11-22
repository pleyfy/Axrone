import type { ChunkGeneration, ChunkKey } from '../types/brands';

/**
 * Pins one chunk while the caller holds the lease. Leases are one small
 * immutable handle per acquire — see ADR-0007 for why they are not pooled.
 */
export interface IChunkLease {
    readonly key: ChunkKey;
    readonly generation: ChunkGeneration;
    readonly isReleased: boolean;
    /** Idempotent. A release from a stale generation does not unpin a new owner. */
    release(): void;
}

export type ChunkUnpin = (
    key: ChunkKey,
    generation: ChunkGeneration
) => void;

export class ChunkLease implements IChunkLease {
    readonly #key: ChunkKey;
    readonly #generation: ChunkGeneration;
    readonly #unpin: ChunkUnpin;
    #released = false;

    constructor(
        key: ChunkKey,
        generation: ChunkGeneration,
        unpin: ChunkUnpin
    ) {
        this.#key = key;
        this.#generation = generation;
        this.#unpin = unpin;
    }

    get key(): ChunkKey {
        return this.#key;
    }

    get generation(): ChunkGeneration {
        return this.#generation;
    }

    get isReleased(): boolean {
        return this.#released;
    }

    release(): void {
        if (this.#released) return;
        this.#released = true;
        this.#unpin(this.#key, this.#generation);
    }
}

export const createChunkLease = (
    key: ChunkKey,
    generation: ChunkGeneration,
    unpin: ChunkUnpin
): IChunkLease => new ChunkLease(key, generation, unpin);
