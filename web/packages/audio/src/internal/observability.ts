import { EventEmitter } from '@axrone/event';
import type {
    AudioAssetSchema,
    AudioDiagnosticsCounters,
    AudioDiagnosticsSnapshot,
    AudioEventEmitter,
    AudioListenerId,
    AudioRuntimeEvent,
    AudioRuntimeEventBase,
} from '../types';

const AUDIO_ALL_EVENTS_CHANNEL = 'audio:*' as const;

type DistributiveOmit<TValue, TKeys extends PropertyKey> = TValue extends unknown
    ? Omit<TValue, TKeys>
    : never;

type AudioRuntimeEventInput<TSchema extends AudioAssetSchema = AudioAssetSchema> = DistributiveOmit<
    AudioRuntimeEvent<TSchema>,
    keyof Pick<AudioRuntimeEventBase, 'sequence' | 'timestamp'>
>;

export interface AudioDiagnosticsState {
    readonly systemStatus: AudioRuntimeEventBase['systemStatus'];
    readonly activeListenerId?: AudioListenerId;
    readonly busCount: number;
    readonly listenerCount: number;
    readonly sourceCount: number;
    readonly activePlaybackCount: number;
}

export class AudioObservabilityRuntime<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly events: AudioEventEmitter<TSchema> = new EventEmitter({
        maxListeners: Infinity,
    }) as AudioEventEmitter<TSchema>;

    #sequence = 0;
    #counters: AudioDiagnosticsCounters = {
        emittedEventCount: 0,
        busMutationCount: 0,
        listenerMutationCount: 0,
        sourceMutationCount: 0,
        playbackCommandCount: 0,
        playbackCompletionCount: 0,
        playbackErrorCount: 0,
        snapshotOperationCount: 0,
        lifecycleTransitionCount: 0,
    };
    #lastEvent?: AudioRuntimeEvent<TSchema>;

    emit(event: AudioRuntimeEventInput<TSchema>): AudioRuntimeEvent<TSchema> {
        const nextEvent = Object.freeze({
            ...event,
            sequence: ++this.#sequence,
            timestamp: Date.now(),
        }) as AudioRuntimeEvent<TSchema>;

        this.#counters = this.#nextCounters(nextEvent);
        this.#lastEvent = nextEvent;

        if (this.events.listenerCountAll() > 0) {
            this.events.emitSync(AUDIO_ALL_EVENTS_CHANNEL, nextEvent);
            this.events.emitSync(nextEvent.type, nextEvent as never);
        }

        return nextEvent;
    }

    snapshot(state: AudioDiagnosticsState): AudioDiagnosticsSnapshot<TSchema> {
        return Object.freeze({
            capturedAtEpochMs: Date.now(),
            systemStatus: state.systemStatus,
            activeListenerId: state.activeListenerId,
            busCount: state.busCount,
            listenerCount: state.listenerCount,
            sourceCount: state.sourceCount,
            activePlaybackCount: state.activePlaybackCount,
            counters: Object.freeze({ ...this.#counters }),
            lastEvent: this.#lastEvent,
        });
    }

    reset(): void {
        this.#sequence = 0;
        this.#counters = {
            emittedEventCount: 0,
            busMutationCount: 0,
            listenerMutationCount: 0,
            sourceMutationCount: 0,
            playbackCommandCount: 0,
            playbackCompletionCount: 0,
            playbackErrorCount: 0,
            snapshotOperationCount: 0,
            lifecycleTransitionCount: 0,
        };
        this.#lastEvent = undefined;
    }

    #nextCounters(event: AudioRuntimeEvent<TSchema>): AudioDiagnosticsCounters {
        const base: AudioDiagnosticsCounters = {
            ...this.#counters,
            emittedEventCount: this.#counters.emittedEventCount + 1,
        };

        switch (event.type) {
            case 'bus:upserted':
            case 'bus:removed':
                return {
                    ...base,
                    busMutationCount: base.busMutationCount + 1,
                };
            case 'listener:upserted':
            case 'listener:removed':
            case 'listener:activated':
                return {
                    ...base,
                    listenerMutationCount: base.listenerMutationCount + 1,
                };
            case 'source:upserted':
            case 'source:removed':
                return {
                    ...base,
                    sourceMutationCount: base.sourceMutationCount + 1,
                };
            case 'source:played':
            case 'source:paused':
            case 'source:resumed':
            case 'source:stopped':
                return {
                    ...base,
                    playbackCommandCount: base.playbackCommandCount + 1,
                };
            case 'source:ended':
                return {
                    ...base,
                    playbackCompletionCount: base.playbackCompletionCount + 1,
                };
            case 'source:error':
                return {
                    ...base,
                    playbackErrorCount: base.playbackErrorCount + 1,
                };
            case 'snapshot:captured':
            case 'snapshot:restored':
                return {
                    ...base,
                    snapshotOperationCount: base.snapshotOperationCount + 1,
                };
            case 'system:suspended':
            case 'system:resumed':
            case 'system:disposed':
                return {
                    ...base,
                    lifecycleTransitionCount: base.lifecycleTransitionCount + 1,
                };
            default:
                return base;
        }
    }
}
