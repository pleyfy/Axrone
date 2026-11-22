import type { AnimationLayerBlendMode } from './types';

export type AnimationMontageStatus = 'playing' | 'completed' | 'stopped';

const EPSILON = 1e-6;

const clamp01 = (value: number): number => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Authoring knobs for {@link AnimationMontage}.
 */
export interface AnimationMontageOptions {
    /** Fade-in length in seconds; clamped to half the clip. */
    readonly fadeInSeconds?: number;
    /** Fade-out length in seconds; clamped to half the clip. */
    readonly fadeOutSeconds?: number;
    /** Whether the montage repeats until stopped. */
    readonly loop?: boolean;
    /** Playback rate; the sign is ignored, reverse is not a montage feature. */
    readonly speed?: number;
    /** Whether starting this montage stops the others. */
    readonly replaceExisting?: boolean;
    /** Whether the montage overrides or adds onto lower layers. */
    readonly mode?: AnimationLayerBlendMode;
    /** Optional bone mask for the montage layer. */
    readonly boneMask?: readonly string[];
}

/**
 * Authored one-shot layered playback. A montage owns a controller layer with a
 * single clip state, fades in and out, and reports completion through its
 * status; events still flow through the controller's normal clip-event sink.
 *
 * A montage is created through {@link AnimationController.playMontage} and
 * stays valid after completion as a status handle. Layer ownership stays with
 * the controller, so a host never removes layers by index.
 */
export class AnimationMontage {
    private _status: AnimationMontageStatus = 'playing';
    private _elapsedSeconds = 0;
    private _weight = 0;
    private _removeRequested = false;

    constructor(
        /** Controller layer the montage owns. */
        readonly layerId: string,
        /** Clip the montage plays. */
        readonly clipId: string,
        /** Clip duration in seconds. */
        readonly durationSeconds: number,
        private readonly _fadeInSeconds: number,
        private readonly _fadeOutSeconds: number,
        private readonly _speed: number,
        private readonly _loop: boolean
    ) {}

    /** Current lifecycle state. */
    get status(): AnimationMontageStatus {
        return this._status;
    }

    /** Normalized playhead in the unit interval; wraps for a looping montage. */
    get normalizedTime(): number {
        if (this.durationSeconds <= EPSILON) {
            return 1;
        }
        const ratio = this._elapsedSeconds / this.durationSeconds;
        return this._loop ? ratio - Math.floor(ratio) : clamp01(ratio);
    }

    /** Current layer weight after fades. */
    get weight(): number {
        return this._weight;
    }

    /** Whether the controller releases the layer on its next update. */
    get removeRequested(): boolean {
        return this._removeRequested;
    }

    /** Cancels playback; the layer is released on the next controller update. */
    stop(): void {
        if (this._status !== 'playing') {
            return;
        }

        this._status = 'stopped';
        this._weight = 0;
        this._removeRequested = true;
    }

    /**
     * Advances the fade timeline and the playhead. Called by the controller.
     * @internal
     */
    advance(deltaSeconds: number): void {
        if (this._status !== 'playing') {
            return;
        }

        if (this.durationSeconds <= EPSILON) {
            this._complete();
            return;
        }

        if (deltaSeconds > 0) {
            this._elapsedSeconds += deltaSeconds * this._speed;
        }

        let weight = 1;
        const fadeIn = Math.min(this._fadeInSeconds, this.durationSeconds * 0.5);
        if (fadeIn > EPSILON) {
            weight = Math.min(weight, this._elapsedSeconds / fadeIn);
        }

        if (!this._loop) {
            const fadeOut = Math.min(this._fadeOutSeconds, this.durationSeconds * 0.5);
            if (fadeOut > EPSILON) {
                weight = Math.min(weight, (this.durationSeconds - this._elapsedSeconds) / fadeOut);
            }

            if (this._elapsedSeconds >= this.durationSeconds) {
                this._complete();
                return;
            }
        }

        this._weight = clamp01(weight);
    }

    private _complete(): void {
        this._status = 'completed';
        this._weight = 0;
        this._removeRequested = true;
    }
}
