import { createSubject } from '@axrone/observer';
import type { Result } from '@axrone/utility';
import type { PackedTileWord } from '../types/brands';
import type { LayerReference, LayerSpec } from '../types/layers';
import type { TilemapEngine } from '../engine/tilemap-engine';
import type { TilemapError } from '../errors';

/** One batched notification for a `write` or `fillRect` call. */
export interface TileChangeBatch {
    readonly layer: number | string;
    readonly operation: 'write' | 'fill';
    readonly gridX: number;
    readonly gridY: number;
    readonly width: number;
    readonly height: number;
    /** Number of tiles whose word actually changed. */
    readonly changed: number;
    readonly word: PackedTileWord;
}

export interface TileChangeSubject {
    emit(batch: TileChangeBatch): void;
    subscribe(callback: (batch: TileChangeBatch) => void): () => void;
    readonly subscriberCount: number;
    dispose(): void;
}

/**
 * Creates the `/observer` subpath's change subject. The core package never
 * imports `@axrone/observer`; only consumers of this module pay for it.
 */
export const createTileChangeSubject = (): TileChangeSubject => {
    const subject = createSubject<TileChangeBatch>();
    let disposed = false;
    return {
        emit(batch: TileChangeBatch): void {
            if (disposed || subject.isCompleted() || subject.isErrored()) return;
            subject.notifySync(batch);
        },
        subscribe(callback: (batch: TileChangeBatch) => void): () => void {
            if (disposed) return () => false;
            return subject.addObserver((batch) => callback(batch));
        },
        get subscriberCount(): number {
            return disposed ? 0 : subject.getObserverCount();
        },
        dispose(): void {
            if (disposed) return;
            disposed = true;
            subject.dispose();
        },
    };
};

/**
 * Wraps engine writes so each call emits a single batch. Per-tile events are
 * never emitted: a `fillRect` of 4x4 tiles is one notification with
 * `changed = 16`.
 */
export class TileChangeWriter<L extends readonly LayerSpec[]> {
    readonly #engine: TilemapEngine<L>;
    readonly #changes: TileChangeSubject;

    constructor(engine: TilemapEngine<L>, changes: TileChangeSubject) {
        this.#engine = engine;
        this.#changes = changes;
    }

    write(
        layer: LayerReference<L>,
        gridX: number,
        gridY: number,
        word: PackedTileWord
    ): Result<void, TilemapError> {
        const previous = this.#engine.readAt(layer, gridX, gridY);
        const result = this.#engine.write(layer, gridX, gridY, word);
        if (result.isOk() && previous !== word) {
            this.#changes.emit({
                layer: layer as number | string,
                operation: 'write',
                gridX,
                gridY,
                width: 1,
                height: 1,
                changed: 1,
                word,
            });
        }
        return result;
    }

    fillRect(
        layer: LayerReference<L>,
        gridX: number,
        gridY: number,
        width: number,
        height: number,
        word: PackedTileWord
    ): Result<number, TilemapError> {
        const result = this.#engine.fillRect(
            layer,
            gridX,
            gridY,
            width,
            height,
            word
        );
        if (result.isOk()) {
            const changed = result.get();
            if (changed > 0) {
                this.#changes.emit({
                    layer: layer as number | string,
                    operation: 'fill',
                    gridX,
                    gridY,
                    width,
                    height,
                    changed,
                    word,
                });
            }
        }
        return result;
    }
}
