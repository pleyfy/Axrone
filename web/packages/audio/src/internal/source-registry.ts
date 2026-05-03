import { toAudioClipSelector } from '../asset';
import { AudioSourceError } from '../errors';
import {
    MASTER_AUDIO_BUS_ID,
    normalizeAudioBusId,
    normalizeAudioSourceId,
} from '../reference';
import type {
    AudioAssetSchema,
    AudioBusId,
    AudioSourceDefinition,
    AudioSourceId,
    AudioSourceState,
} from '../types';
import type { InternalPlayback, InternalSource } from './runtime';
import {
    cloneMetadata,
    isFiniteNumber,
} from './shared';
import { cloneSpatialization } from './spatial';

export interface AudioSourceRegistryOptions {
    readonly normalizeGain: (
        value: number,
        code: 'audio.invalid-gain' | 'audio.invalid-distance'
    ) => number;
    readonly normalizePan: (value: number) => number;
    readonly normalizePlaybackRate: (value: number) => number;
    readonly normalizeTime: (value: number) => number;
}

export class AudioSourceRegistry<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly #normalizeGain: AudioSourceRegistryOptions['normalizeGain'];
    readonly #normalizePan: AudioSourceRegistryOptions['normalizePan'];
    readonly #normalizePlaybackRate: AudioSourceRegistryOptions['normalizePlaybackRate'];
    readonly #normalizeTime: AudioSourceRegistryOptions['normalizeTime'];
    readonly #sources = new Map<AudioSourceId, InternalSource<TSchema>>();
    readonly #transientSources = new Set<AudioSourceId>();

    #sourceSequence = 0;
    #oneShotSequence = 0;

    constructor(options: AudioSourceRegistryOptions) {
        this.#normalizeGain = options.normalizeGain;
        this.#normalizePan = options.normalizePan;
        this.#normalizePlaybackRate = options.normalizePlaybackRate;
        this.#normalizeTime = options.normalizeTime;
    }

    nextOneShotId(): AudioSourceId {
        this.#oneShotSequence += 1;
        return normalizeAudioSourceId(`oneshot:${this.#oneShotSequence}`);
    }

    markTransient(id: AudioSourceId): void {
        this.#transientSources.add(id);
    }

    isTransient(id: AudioSourceId): boolean {
        return this.#transientSources.has(id);
    }

    upsert(
        definition: AudioSourceDefinition<TSchema>,
        options: {
            readonly requireBus: (id: string) => void;
            readonly reconnectPlaybackOutput?: (
                playback: InternalPlayback<TSchema>,
                nextBusId: string
            ) => void;
        }
    ): InternalSource<TSchema> {
        const id =
            definition.id !== undefined
                ? normalizeAudioSourceId(definition.id)
                : this.#nextManagedId();
        let source = this.#sources.get(id);

        if (!source) {
            source = {
                id,
                busId: normalizeAudioBusId(definition.busId ?? MASTER_AUDIO_BUS_ID),
                clip: toAudioClipSelector(definition.clip),
                volume: this.#normalizeGain(definition.volume ?? 1, 'audio.invalid-gain'),
                muted: definition.muted ?? false,
                loop: definition.loop ?? false,
                autoplay: definition.autoplay ?? false,
                playbackRate: this.#normalizePlaybackRate(definition.playbackRate ?? 1),
                detuneCents: isFiniteNumber(definition.detuneCents) ? definition.detuneCents : 0,
                pan: this.#normalizePan(definition.pan ?? 0),
                spatial: cloneSpatialization(definition.spatial),
                startOffsetSeconds: this.#normalizeTime(definition.startOffsetSeconds ?? 0),
                metadata: cloneMetadata(definition.metadata),
                playbackState: 'idle',
                currentOffsetSeconds: this.#normalizeTime(definition.startOffsetSeconds ?? 0),
                playSequence: 0,
            };
            this.#sources.set(id, source);
        }

        if (definition.busId !== undefined) {
            const nextBusId = normalizeAudioBusId(definition.busId);
            options.requireBus(nextBusId);
            if (source.busId !== nextBusId) {
                source.busId = nextBusId;
                if (source.active) {
                    options.reconnectPlaybackOutput?.(source.active, nextBusId);
                }
            }
        }
        if (definition.clip !== undefined) {
            source.clip = toAudioClipSelector(definition.clip);
        }
        if (definition.volume !== undefined) {
            source.volume = this.#normalizeGain(definition.volume, 'audio.invalid-gain');
        }
        if (definition.muted !== undefined) {
            source.muted = definition.muted;
        }
        if (definition.loop !== undefined) {
            source.loop = definition.loop;
        }
        if (definition.autoplay !== undefined) {
            source.autoplay = definition.autoplay;
        }
        if (definition.playbackRate !== undefined) {
            source.playbackRate = this.#normalizePlaybackRate(definition.playbackRate);
        }
        if (definition.detuneCents !== undefined && isFiniteNumber(definition.detuneCents)) {
            source.detuneCents = definition.detuneCents;
        }
        if (definition.pan !== undefined) {
            source.pan = this.#normalizePan(definition.pan);
        }
        if (definition.spatial !== undefined) {
            source.spatial = cloneSpatialization(definition.spatial);
        }
        if (definition.startOffsetSeconds !== undefined) {
            const offset = this.#normalizeTime(definition.startOffsetSeconds);
            source.startOffsetSeconds = offset;
            if (!source.active) {
                source.currentOffsetSeconds = offset;
            }
        }
        if (definition.metadata !== undefined) {
            source.metadata = cloneMetadata(definition.metadata);
        }

        return source;
    }

    reassignBus(
        previousBusId: AudioBusId | string,
        nextBusId: AudioBusId | string,
        reconnectPlaybackOutput: (
            playback: InternalPlayback<TSchema>,
            nextBusId: string
        ) => void
    ): void {
        const from = normalizeAudioBusId(previousBusId);
        const to = normalizeAudioBusId(nextBusId);

        for (const source of this.#sources.values()) {
            if (source.busId !== from) {
                continue;
            }

            source.busId = to;
            if (source.active) {
                reconnectPlaybackOutput(source.active, to);
            }
        }
    }

    remove(id: AudioSourceId | string): InternalSource<TSchema> | undefined {
        const normalizedId = normalizeAudioSourceId(id);
        const source = this.#sources.get(normalizedId);
        if (!source) {
            return undefined;
        }

        this.#transientSources.delete(normalizedId);
        this.#sources.delete(normalizedId);
        return source;
    }

    require(id: AudioSourceId | string): InternalSource<TSchema> {
        const normalizedId = normalizeAudioSourceId(id);
        const source = this.#sources.get(normalizedId);
        if (!source) {
            throw new AudioSourceError(
                'audio.source.missing',
                `Audio source ${normalizedId} does not exist`,
                normalizedId
            );
        }
        return source;
    }

    get(id: AudioSourceId | string): InternalSource<TSchema> | undefined {
        return this.#sources.get(normalizeAudioSourceId(id));
    }

    list(): readonly InternalSource<TSchema>[] {
        return Object.freeze([...this.#sources.values()]);
    }

    values(): IterableIterator<InternalSource<TSchema>> {
        return this.#sources.values();
    }

    clear(): readonly InternalSource<TSchema>[] {
        const sources = [...this.#sources.values()];
        this.#sources.clear();
        this.#transientSources.clear();
        return Object.freeze(sources);
    }

    #nextManagedId(): AudioSourceId {
        let nextId: AudioSourceId;
        do {
            this.#sourceSequence += 1;
            nextId = normalizeAudioSourceId(`source:${this.#sourceSequence}`);
        } while (this.#sources.has(nextId));

        return nextId;
    }

    snapshot(
        source: InternalSource<TSchema>,
        resolveCurrentOffset: (source: InternalSource<TSchema>) => number
    ): AudioSourceState<TSchema> {
        return Object.freeze({
            id: source.id,
            busId: source.busId,
            clip: source.clip,
            volume: source.volume,
            muted: source.muted,
            loop: source.loop,
            autoplay: source.autoplay,
            playbackRate: source.playbackRate,
            detuneCents: source.detuneCents,
            pan: source.pan,
            spatial: source.spatial ? cloneSpatialization(source.spatial) : undefined,
            startOffsetSeconds: source.startOffsetSeconds,
            metadata: source.metadata,
            playbackState: source.playbackState,
            currentOffsetSeconds: resolveCurrentOffset(source),
            durationSeconds: source.durationSeconds,
            playSequence: source.playSequence,
        });
    }
}
