import {
    AudioConfigurationError,
    DEFAULT_AUDIO_MESSAGE_RESOLVER,
    AudioDisposedError,
    AudioLifecycleError,
    AudioSnapshotError,
    AudioSourceError,
    resolveAudioMessage,
} from './errors';
import { toAudioClipSelector } from './asset';
import { AudioBusRegistry } from './internal/bus-registry';
import { AudioClipStore } from './internal/clip-store';
import { AudioListenerRegistry } from './internal/listener-registry';
import { AudioPlaybackRuntime } from './internal/playback-runtime';
import type {
    InternalPlayback,
    InternalSource,
} from './internal/runtime';
import { AudioSourceRegistry } from './internal/source-registry';
import {
    clamp,
    disconnectNode,
    effectivePlaybackRate,
    hasOwnKeys,
    isFiniteNumber,
    isObject,
    resolveContextFactory,
    withRetry,
} from './internal/shared';
import {
    MASTER_AUDIO_BUS_ID,
    normalizeAudioSnapshotId,
    normalizeAudioSourceId,
} from './reference';
import type {
    AudioAssetSchema,
    AudioBusDefinition,
    AudioBusId,
    AudioBusPatch,
    AudioBusState,
    AudioClipId,
    AudioClipInput,
    AudioClipRecord,
    AudioListenerDescriptor,
    AudioListenerId,
    AudioListenerPatch,
    AudioListenerState,
    AudioMessageDescriptor,
    AudioMessageResolver,
    AudioMixerSnapshot,
    AudioPlaybackHandle,
    AudioRestoreOptions,
    AudioRetryPolicy,
    AudioSnapshotTransitionOptions,
    AudioSourceDefinition,
    AudioSourceId,
    AudioSourcePatch,
    AudioSourcePlayRequest,
    AudioSourceState,
    AudioStopOptions,
    AudioSystemOptions,
    AudioSystemSnapshot,
    AudioSystemStatus,
} from './types';

type AudioPatchToDefinition<TDefinition extends object> = Partial<TDefinition>;

export class AudioSystem<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly context: AudioContext;
    readonly destination: AudioNode;

    readonly #messageResolver: AudioMessageResolver;
    readonly #locale: string;
    readonly #autoResume: boolean;
    readonly #resumeRetryPolicy?: AudioRetryPolicy<TSchema>;
    readonly #ownsContext: boolean;
    readonly #clips: AudioClipStore<TSchema>;
    readonly #buses: AudioBusRegistry;
    readonly #listeners = new AudioListenerRegistry();
    readonly #playbackRuntime: AudioPlaybackRuntime<TSchema>;
    readonly #sources: AudioSourceRegistry<TSchema>;

    #playSequence = 0;
    #status: AudioSystemStatus = 'idle';
    #disposed = false;

    constructor(options: AudioSystemOptions<TSchema> = {}) {
        const ownsContext = !options.context;
        const context = options.context ?? (options.createContext ?? resolveContextFactory())();
        this.context = context;
        this.destination = options.destination ?? context.destination;
        this.#ownsContext = ownsContext;
        this.#messageResolver = options.messageResolver ?? DEFAULT_AUDIO_MESSAGE_RESOLVER;
        this.#locale = options.locale ?? 'en';
        this.#autoResume = options.autoResume ?? true;
        this.#resumeRetryPolicy = options.resumeRetryPolicy;

        this.#clips = new AudioClipStore({
            context,
            assetDatabase: options.assetDatabase,
            assetResolver: options.assetResolver,
            retryPolicy: options.assetRetryPolicy,
        });
        this.#playbackRuntime = new AudioPlaybackRuntime<TSchema>(context);
        this.#buses = new AudioBusRegistry({
            context,
            destination: this.destination,
            createConfigurationError: (descriptor) => this.#configurationError(descriptor),
            normalizeGain: (value, code) => this.#normalizeGain(value, code),
            normalizePan: (value) => this.#normalizePan(value),
        });
        this.#sources = new AudioSourceRegistry<TSchema>({
            normalizeGain: (value, code) => this.#normalizeGain(value, code),
            normalizePan: (value) => this.#normalizePan(value),
            normalizePlaybackRate: (value) => this.#normalizePlaybackRate(value),
            normalizeTime: (value) => this.#normalizeTime(value),
        });

        if (options.buses?.length) {
            this.#buses.initialize(options.buses);
        }

        if (options.listeners) {
            for (const listener of options.listeners) {
                this.upsertListener(listener);
            }
        }

        if (options.sources) {
            for (const source of options.sources) {
                this.upsertSource(source);
            }
        }

        this.#syncListenerToContext();
    }

    get status(): AudioSystemStatus {
        return this.#status;
    }

    get isDisposed(): boolean {
        return this.#disposed;
    }

    get activeListener(): AudioListenerState | undefined {
        const activeListenerId = this.#listeners.activeListenerId;
        return activeListenerId ? this.#listeners.get(activeListenerId) : undefined;
    }

    registerClip(id: AudioClipId | string, clip: AudioClipInput<TSchema>): AudioClipId {
        this.#assertNotDisposed();
        const selector = toAudioClipSelector(clip);
        if (!selector) {
            throw this.#configurationError({ code: 'audio.invalid-clip', value: clip });
        }

        return this.#clips.register(id, selector);
    }

    unregisterClip(id: AudioClipId | string): boolean {
        this.#assertNotDisposed();
        return this.#clips.unregister(id);
    }

    async resolveClip(selector: AudioClipInput<TSchema>): Promise<AudioClipRecord<TSchema>> {
        this.#assertNotDisposed();
        const normalized = toAudioClipSelector(selector);
        if (!normalized) {
            throw this.#configurationError({ code: 'audio.invalid-clip', value: selector });
        }

        return this.#clips.resolveSelector(normalized);
    }

    upsertBus(definition: AudioBusDefinition): AudioBusState {
        this.#assertNotDisposed();
        const state = this.#buses.upsert(definition);
        this.#syncAllSources();
        return state;
    }

    updateBus(id: AudioBusId | string, patch: AudioBusPatch): AudioBusState {
        return this.upsertBus({
            id,
            ...(patch as AudioPatchToDefinition<Omit<AudioBusDefinition, 'id'>>),
        });
    }

    removeBus(id: AudioBusId | string): boolean {
        this.#assertNotDisposed();
        const removed = this.#buses.remove(id);
        if (!removed.removed || !removed.fallbackBusId) {
            return false;
        }

        this.#sources.reassignBus(id, removed.fallbackBusId, (playback, nextBusId) => {
            this.#reconnectPlaybackOutput(playback, nextBusId);
        });
        this.#syncAllSources();
        return true;
    }

    getBus(id: AudioBusId | string): AudioBusState | undefined {
        return this.#buses.get(id);
    }

    listBuses(): readonly AudioBusState[] {
        return this.#buses.list();
    }

    upsertListener(descriptor: AudioListenerDescriptor): AudioListenerState {
        this.#assertNotDisposed();
        const state = this.#listeners.upsert(descriptor);
        this.#syncListenerToContext();
        this.#syncAllSources();
        return state;
    }

    updateListener(id: AudioListenerId | string, patch: AudioListenerPatch): AudioListenerState {
        return this.upsertListener({
            id,
            ...(patch as AudioPatchToDefinition<Omit<AudioListenerDescriptor, 'id'>>),
        });
    }

    removeListener(id: AudioListenerId | string): boolean {
        this.#assertNotDisposed();
        const removed = this.#listeners.remove(id);
        if (!removed) {
            return false;
        }

        this.#syncListenerToContext();
        this.#syncAllSources();
        return true;
    }

    setActiveListener(id: AudioListenerId | string): void {
        this.#assertNotDisposed();
        this.#listeners.setActive(id);
        this.#syncListenerToContext();
        this.#syncAllSources();
    }

    getListener(id: AudioListenerId | string): AudioListenerState | undefined {
        return this.#listeners.get(id);
    }

    listListeners(): readonly AudioListenerState[] {
        return this.#listeners.list();
    }

    upsertSource(definition: AudioSourceDefinition<TSchema>): AudioSourceState<TSchema> {
        this.#assertNotDisposed();
        const source = this.#sources.upsert(definition, {
            requireBus: (id) => {
                this.#buses.require(id);
            },
            reconnectPlaybackOutput: (playback, nextBusId) => {
                this.#reconnectPlaybackOutput(playback, nextBusId);
            },
        });

        this.#syncSource(source);
        if (source.autoplay && source.playbackState === 'idle' && source.clip) {
            void this.playSource(source.id).catch(() => undefined);
        }

        return this.#snapshotSource(source);
    }

    updateSource(id: AudioSourceId | string, patch: AudioSourcePatch<TSchema>): AudioSourceState<TSchema> {
        return this.upsertSource({
            id,
            ...(patch as AudioPatchToDefinition<Omit<AudioSourceDefinition<TSchema>, 'id'>>),
        });
    }

    removeSource(id: AudioSourceId | string): boolean {
        this.#assertNotDisposed();
        const source = this.#sources.get(id);
        if (!source) {
            return false;
        }

        this.stopSource(id);
        this.#disposePlayback(source);
        this.#sources.remove(id);
        return true;
    }

    getSource(id: AudioSourceId | string): AudioSourceState<TSchema> | undefined {
        const source = this.#sources.get(id);
        return source ? this.#snapshotSource(source) : undefined;
    }

    listSources(): readonly AudioSourceState<TSchema>[] {
        return Object.freeze([...this.#sources.values()].map((source) => this.#snapshotSource(source)));
    }

    async playSource(
        id: AudioSourceId | string,
        request: AudioSourcePlayRequest<TSchema> = {}
    ): Promise<AudioPlaybackHandle> {
        this.#assertNotDisposed();
        const sourceId = normalizeAudioSourceId(id);
        const source = this.#sources.require(sourceId);

        const { when, offsetSeconds, durationSeconds, replace, ...patch } = request;
        if (hasOwnKeys(patch)) {
            this.upsertSource({
                id: sourceId,
                ...(patch as AudioPatchToDefinition<Omit<AudioSourceDefinition<TSchema>, 'id'>>),
            });
        }

        if (!source.clip) {
            throw this.#configurationError({ code: 'audio.invalid-clip', value: source.clip });
        }

        if (this.#autoResume && this.context.state === 'suspended') {
            await this.resume();
        }

        if (source.active) {
            if (replace === false) {
                return this.#createPlaybackHandle(sourceId, source.playSequence);
            }
            this.stopSource(sourceId);
        }

        const clip = await this.#clips.resolveSelector(source.clip);
        const bus = this.#buses.require(source.busId);
        const normalizedOffset = this.#normalizeOffset(
            offsetSeconds ?? source.currentOffsetSeconds,
            clip,
            source.loop
        );
        const normalizedWhen =
            when !== undefined ? this.#normalizeTime(when) : this.context.currentTime;
        const normalizedDuration =
            durationSeconds !== undefined ? this.#normalizeTime(durationSeconds) : undefined;
        const sequence = ++this.#playSequence;

        try {
            source.active = this.#playbackRuntime.startPlayback(source, {
                sequence,
                clip,
                busNode: bus.gainNode,
                when: normalizedWhen,
                offsetSeconds: normalizedOffset,
                durationSeconds: normalizedDuration,
                onEnded: () => {
                    this.#handleEnded(source.id, sequence);
                },
            });
        } catch (error) {
            source.playbackState = 'stopped';
            throw new AudioSourceError(
                'audio.source.play-failed',
                `Failed to play audio source ${sourceId}`,
                sourceId,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }

        source.playSequence = sequence;
        source.playbackState = 'playing';
        source.currentOffsetSeconds = normalizedOffset;
        source.durationSeconds = clip.durationSeconds;

        this.#syncSource(source);

        this.#status = 'running';
        return this.#createPlaybackHandle(source.id, sequence);
    }

    async play(
        request: AudioSourceDefinition<TSchema> & AudioSourcePlayRequest<TSchema>
    ): Promise<AudioPlaybackHandle> {
        const id = normalizeAudioSourceId(request.id ?? this.#sources.nextOneShotId());
        this.#sources.markTransient(id);
        this.upsertSource({ ...request, id, autoplay: false });
        return this.playSource(id, request);
    }

    pauseSource(id: AudioSourceId | string): void {
        this.#assertNotDisposed();
        const source = this.#sources.require(id);
        if (!source.active) {
            source.playbackState = 'paused';
            return;
        }

        source.currentOffsetSeconds = this.#currentOffsetForSource(source);
        source.playbackState = 'paused';
        source.active.control = 'pausing';
        try {
            source.active.sourceNode.stop();
        } catch {}
    }

    async resumeSource(id: AudioSourceId | string): Promise<AudioPlaybackHandle> {
        this.#assertNotDisposed();
        const source = this.#sources.require(id);
        if (source.playbackState === 'playing') {
            return this.#createPlaybackHandle(source.id, source.playSequence);
        }
        if (!source.clip) {
            throw this.#configurationError({ code: 'audio.invalid-clip', value: source.clip });
        }

        return withRetry(
            this.#resumeRetryPolicy,
            (attempt) => ({
                operation: 'source.resume',
                attempt,
                sourceId: source.id,
                clip: source.clip,
            }),
            async () =>
                this.playSource(source.id, {
                    offsetSeconds: source.currentOffsetSeconds,
                    replace: true,
                })
        );
    }

    stopSource(id: AudioSourceId | string, options: AudioStopOptions = {}): void {
        this.#assertNotDisposed();
        const source = this.#sources.require(id);
        source.currentOffsetSeconds = 0;
        source.playbackState = 'stopped';
        if (!source.active) {
            return;
        }

        source.active.control = 'stopping';
        try {
            if (options.when !== undefined) {
                source.active.sourceNode.stop(this.#normalizeTime(options.when));
            } else {
                source.active.sourceNode.stop();
            }
        } catch {}
    }

    captureMixerSnapshot(id?: string): AudioMixerSnapshot {
        this.#assertNotDisposed();
        return this.#buses.captureSnapshot(id ? normalizeAudioSnapshotId(id) : undefined);
    }

    applyMixerSnapshot(
        snapshot: AudioMixerSnapshot,
        options: AudioSnapshotTransitionOptions = {}
    ): void {
        this.#assertNotDisposed();
        if (!isAudioMixerSnapshot(snapshot)) {
            throw new AudioSnapshotError('Mixer snapshot is invalid');
        }

        const atTime =
            options.atTime !== undefined ? this.#normalizeTime(options.atTime) : this.context.currentTime;
        const durationSeconds =
            options.durationSeconds !== undefined
                ? this.#normalizeTime(options.durationSeconds)
                : 0;

        this.#buses.applySnapshot(snapshot, { atTime, durationSeconds });
    }

    snapshot(): AudioSystemSnapshot<TSchema> {
        this.#assertNotDisposed();
        return Object.freeze({
            version: 1,
            status: this.#status === 'disposed' ? 'idle' : this.#status,
            capturedAtEpochMs: Date.now(),
            activeListenerId: this.#listeners.activeListenerId,
            buses: Object.freeze(this.listBuses()),
            listeners: Object.freeze(this.listListeners()),
            sources: Object.freeze(this.listSources()),
        });
    }

    async restore(snapshot: AudioSystemSnapshot<TSchema>, options: AudioRestoreOptions = {}): Promise<void> {
        this.#assertNotDisposed();
        if (!isAudioSystemSnapshot(snapshot)) {
            throw new AudioSnapshotError('Audio system snapshot is invalid');
        }

        if (options.clearExisting ?? true) {
            this.#clearSources();
            this.#listeners.clear();
            this.#buses.clear();
        }

        const additionalBuses = snapshot.buses.filter((bus) => bus.id !== MASTER_AUDIO_BUS_ID);
        for (const bus of additionalBuses) {
            this.upsertBus({
                id: bus.id,
                volume: bus.volume,
                mute: bus.mute,
                pan: bus.pan,
                metadata: bus.metadata,
            });
        }
        for (const bus of additionalBuses) {
            if (bus.parentId) {
                this.upsertBus({ id: bus.id, parentId: bus.parentId });
            }
        }

        const master = snapshot.buses.find((bus) => bus.id === MASTER_AUDIO_BUS_ID);
        if (master) {
            this.upsertBus({
                id: MASTER_AUDIO_BUS_ID,
                volume: master.volume,
                mute: master.mute,
                pan: master.pan,
                metadata: master.metadata,
            });
        }

        for (const listener of snapshot.listeners) {
            this.upsertListener(listener);
        }
        if (snapshot.activeListenerId) {
            this.setActiveListener(snapshot.activeListenerId);
        }

        for (const source of snapshot.sources) {
            this.upsertSource({
                id: source.id,
                busId: source.busId,
                clip: source.clip,
                volume: source.volume,
                muted: source.muted,
                loop: source.loop,
                autoplay: false,
                playbackRate: source.playbackRate,
                detuneCents: source.detuneCents,
                pan: source.pan,
                spatial: source.spatial,
                startOffsetSeconds: source.currentOffsetSeconds,
                metadata: source.metadata,
            });

            const restored = this.#sources.require(source.id);
            restored.playbackState = source.playbackState;
            restored.currentOffsetSeconds = source.currentOffsetSeconds;
            restored.durationSeconds = source.durationSeconds;
        }

        if (options.transition) {
            this.applyMixerSnapshot(this.captureMixerSnapshot(), options.transition);
        }

        if (options.restorePlayback ?? true) {
            for (const source of snapshot.sources) {
                if (source.playbackState === 'playing') {
                    await this.playSource(source.id, {
                        offsetSeconds: source.currentOffsetSeconds,
                        replace: true,
                    });
                }
            }
        }

        this.#status = snapshot.status;
    }

    async suspend(): Promise<void> {
        this.#assertNotDisposed();
        await withRetry(
            this.#resumeRetryPolicy,
            (attempt) => ({ operation: 'context.suspend', attempt }),
            async () => {
                try {
                    await this.context.suspend();
                    this.#status = 'suspended';
                } catch (error) {
                    throw new AudioLifecycleError(
                        'audio.context.suspend-failed',
                        'Failed to suspend audio context',
                        {
                            cause: error instanceof Error ? error : new Error(String(error)),
                        }
                    );
                }
            }
        );
    }

    async resume(): Promise<void> {
        this.#assertNotDisposed();
        await withRetry(
            this.#resumeRetryPolicy,
            (attempt) => ({ operation: 'context.resume', attempt }),
            async () => {
                try {
                    await this.context.resume();
                    this.#status = 'running';
                } catch (error) {
                    throw new AudioLifecycleError(
                        'audio.context.resume-failed',
                        'Failed to resume audio context',
                        {
                            cause: error instanceof Error ? error : new Error(String(error)),
                        }
                    );
                }
            }
        );
    }

    async dispose(): Promise<void> {
        if (this.#disposed) {
            return;
        }

        this.#clearSources();
        this.#listeners.clear();
        this.#buses.clear();
        this.#clips.clear();
        this.#disposed = true;
        this.#status = 'disposed';

        if (this.#ownsContext) {
            try {
                await this.context.close();
            } catch {}
        }
    }

    refreshSpatialAudio(): void {
        this.#assertNotDisposed();
        this.#syncListenerToContext();
        this.#syncAllSources();
    }

    #clearSources(): void {
        for (const source of this.#sources.values()) {
            this.stopSource(source.id);
            this.#disposePlayback(source);
        }
        this.#sources.clear();
    }

    #syncListenerToContext(): void {
        this.#listeners.syncToContext(this.context.listener);
    }

    #syncSource(source: InternalSource<TSchema>): void {
        this.#playbackRuntime.syncPlayback(source, this.#listeners.activeRuntime());
    }

    #syncAllSources(): void {
        for (const source of this.#sources.values()) {
            this.#syncSource(source);
        }
    }

    #reconnectPlaybackOutput(playback: InternalPlayback<TSchema>, nextBusId: string): void {
        this.#playbackRuntime.reconnectPlayback(playback, this.#buses.require(nextBusId).gainNode);
    }

    #currentOffsetForSource(source: InternalSource<TSchema>): number {
        if (!source.active) {
            return source.currentOffsetSeconds;
        }

        const elapsed = Math.max(0, this.context.currentTime - source.active.startedAtContextTime);
        const rate = effectivePlaybackRate(source.playbackRate, source.detuneCents);
        const progressed = source.active.startOffsetSeconds + elapsed * rate;
        return this.#normalizeOffset(progressed, source.active.clip, source.loop);
    }

    #normalizeOffset(offsetSeconds: number, clip: AudioClipRecord<TSchema>, loop: boolean): number {
        const duration = Math.max(clip.durationSeconds, 0.0001);
        const normalizedOffset = this.#normalizeTime(offsetSeconds);
        if (!loop) {
            return clamp(normalizedOffset, 0, duration);
        }

        const loopStart = clip.loopStartSeconds ?? 0;
        const loopEnd = clip.loopEndSeconds ?? duration;
        const loopDuration = Math.max(loopEnd - loopStart, 0.0001);
        if (normalizedOffset < loopStart) {
            return normalizedOffset;
        }
        return loopStart + ((normalizedOffset - loopStart) % loopDuration);
    }

    #handleEnded(id: AudioSourceId, sequence: number): void {
        const source = this.#sources.get(id);
        if (!source || !source.active || source.active.sequence !== sequence) {
            return;
        }

        const control = source.active.control;
        this.#disposePlayback(source);
        if (control === 'pausing') {
            source.playbackState = 'paused';
            return;
        }
        if (control === 'stopping') {
            source.playbackState = 'stopped';
            source.currentOffsetSeconds = 0;
            if (this.#sources.isTransient(id)) {
                this.#sources.remove(id);
            }
            return;
        }

        source.playbackState = 'stopped';
        source.currentOffsetSeconds = source.loop ? source.currentOffsetSeconds : 0;
        if (this.#sources.isTransient(id)) {
            this.#sources.remove(id);
        }
    }

    #disposePlayback(source: InternalSource<TSchema>): void {
        if (!source.active) {
            return;
        }

        this.#playbackRuntime.disposePlayback(source.active);
        source.active = undefined;
    }

    #snapshotSource(source: InternalSource<TSchema>): AudioSourceState<TSchema> {
        return this.#sources.snapshot(source, (candidate) =>
            candidate.active ? this.#currentOffsetForSource(candidate) : candidate.currentOffsetSeconds
        );
    }

    #normalizeGain(value: number, code: 'audio.invalid-gain' | 'audio.invalid-distance'): number {
        if (!isFiniteNumber(value) || value < 0) {
            throw this.#configurationError({ code, value });
        }
        return value;
    }

    #normalizePan(value: number): number {
        if (!isFiniteNumber(value)) {
            throw this.#configurationError({ code: 'audio.invalid-pan', value });
        }
        return clamp(value, -1, 1);
    }

    #normalizePlaybackRate(value: number): number {
        if (!isFiniteNumber(value) || value <= 0) {
            throw this.#configurationError({ code: 'audio.invalid-playback-rate', value });
        }
        return value;
    }

    #normalizeTime(value: number): number {
        if (!isFiniteNumber(value) || value < 0) {
            throw this.#configurationError({ code: 'audio.invalid-time', value });
        }
        return value;
    }

    #configurationError(descriptor: AudioMessageDescriptor): AudioConfigurationError {
        return new AudioConfigurationError(
            descriptor.code as never,
            resolveAudioMessage(descriptor, this.#locale, this.#messageResolver)
        );
    }

    #assertNotDisposed(): void {
        if (this.#disposed) {
            throw new AudioDisposedError('Audio system has already been disposed');
        }
    }

    #createPlaybackHandle(sourceId: AudioSourceId, sequence: number): AudioPlaybackHandle {
        return Object.freeze({
            sourceId,
            sequence,
            stop: (options?: AudioStopOptions) => {
                this.stopSource(sourceId, options);
            },
            pause: () => {
                this.pauseSource(sourceId);
            },
            resume: () => this.resumeSource(sourceId).then(() => undefined),
        });
    }
}

export const createAudioSystem = <TSchema extends AudioAssetSchema = AudioAssetSchema>(
    options: AudioSystemOptions<TSchema> = {}
): AudioSystem<TSchema> => new AudioSystem(options);

export const isAudioMixerSnapshot = (value: unknown): value is AudioMixerSnapshot =>
    isObject(value) && Array.isArray(value.buses);

export const isAudioSystemSnapshot = <TSchema extends AudioAssetSchema = AudioAssetSchema>(
    value: unknown
): value is AudioSystemSnapshot<TSchema> =>
    isObject(value) &&
    value.version === 1 &&
    Array.isArray(value.buses) &&
    Array.isArray(value.listeners) &&
    Array.isArray(value.sources);
