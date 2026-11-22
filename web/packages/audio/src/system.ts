import { clamp } from '@axrone/numeric';
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
import { AudioObservabilityRuntime } from './internal/observability';
import { AudioPlaybackRuntime } from './internal/playback-runtime';
import type {
    InternalPlayback,
    InternalSource,
} from './internal/runtime';
import { AudioSourceRegistry } from './internal/source-registry';
import {
    effectivePlaybackRate,
    hasOwnKeys,
    isFiniteNumber,
    isObject,
    resolveContextFactory,
    setParamValue,
    withRetry,
} from './internal/shared';
import {
    MASTER_AUDIO_BUS_ID,
    normalizeAudioBusId,
    normalizeAudioListenerId,
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
    AudioDiagnosticsSnapshot,
    AudioEventEmitter,
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

// A volume change that lands as one discontinuous step is audible as a click, so the global
// gain eases over roughly one frame instead.
const GLOBAL_VOLUME_SMOOTHING_SECONDS = 0.016;

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
    readonly #observability = new AudioObservabilityRuntime<TSchema>();
    readonly #playbackRuntime: AudioPlaybackRuntime<TSchema>;
    readonly #sources: AudioSourceRegistry<TSchema>;
    readonly #sink: AudioNode;
    readonly #globalGain: GainNode;
    readonly #maxRealVoices: number;

    #playSequence = 0;
    #status: AudioSystemStatus = 'idle';
    #contextState: AudioContextState = 'running';
    #appliedGlobalVolume?: number;
    #voiceStealCount = 0;
    #disposed = false;
    #suspendOnHidden = false;
    #visibilityHandler: (() => void) | undefined;

    constructor(options: AudioSystemOptions<TSchema> = {}) {
        const ownsContext = !options.context;
        // sampleRate/latencyHint can only be honoured for a context we create; one supplied
        // by the caller is already bound to its device. Unsupported rates are left to the
        // browser to reject with its own RangeError rather than guessed at here.
        const context =
            options.context ??
            (options.createContext ??
                resolveContextFactory({
                    sampleRate: options.sampleRate,
                    latencyHint: options.latencyHint,
                }))();
        this.context = context;
        this.#sink = options.destination ?? context.destination;
        // Buses feed this gain rather than the sink directly so the active listener's
        // globalVolume has somewhere to live; Web Audio has no listener gain of its own.
        this.#globalGain = context.createGain();
        this.#globalGain.gain.value = 1;
        this.#globalGain.connect(this.#sink);
        this.destination = this.#globalGain;
        this.#ownsContext = ownsContext;
        this.#maxRealVoices = Math.max(0, options.maxRealVoices ?? 0);
        this.#messageResolver = options.messageResolver ?? DEFAULT_AUDIO_MESSAGE_RESOLVER;
        this.#locale = options.locale ?? 'en';
        this.#autoResume = options.autoResume ?? true;
        this.#resumeRetryPolicy = options.resumeRetryPolicy;
        this.#suspendOnHidden = options.suspendOnHidden ?? false;
        if (this.#suspendOnHidden && typeof document !== 'undefined') {
            this.#visibilityHandler = () => {
                void this.#handleDocumentVisibilityChange();
            };
            document.addEventListener('visibilitychange', this.#visibilityHandler);
        }

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
        this.#contextState = this.context.state;
        this.#applyContextState(false);
        // addEventListener, not context.onstatechange: a caller-supplied context may already
        // have its own handler on the property, which this would silently replace.
        this.context.addEventListener?.('statechange', this.#handleContextStateChange);
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

    get events(): AudioEventEmitter<TSchema> {
        return this.#observability.events;
    }

    getDiagnostics(): AudioDiagnosticsSnapshot<TSchema> {
        return this.#observability.snapshot({
            systemStatus: this.#status,
            activeListenerId: this.#listeners.activeListenerId,
            busCount: this.listBuses().length,
            listenerCount: this.listListeners().length,
            sourceCount: this.listSources().length,
            activePlaybackCount: this.#occupantVoiceCount(),
            voiceStealCount: this.#voiceStealCount,
        });
    }

    resetDiagnostics(): void {
        this.#voiceStealCount = 0;
        this.#observability.reset();
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
        this.#emit({
            type: 'bus:upserted',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            bus: state,
        });
        return state;
    }

    updateBus(id: AudioBusId | string, patch: AudioBusPatch): AudioBusState {
        return this.upsertBus({
            id,
            ...patch,
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
        this.#emit({
            type: 'bus:removed',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            busId: this.#coerceBusId(id),
            fallbackBusId: removed.fallbackBusId,
        });
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
        this.#emit({
            type: 'listener:upserted',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            listener: state,
        });
        return state;
    }

    updateListener(id: AudioListenerId | string, patch: AudioListenerPatch): AudioListenerState {
        return this.upsertListener({
            id,
            ...patch,
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
        this.#emit({
            type: 'listener:removed',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            listenerId: this.#coerceListenerId(id),
        });
        return true;
    }

    setActiveListener(id: AudioListenerId | string): void {
        this.#assertNotDisposed();
        this.#listeners.setActive(id);
        this.#syncListenerToContext();
        this.#syncAllSources();
        this.#emit({
            type: 'listener:activated',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            listener: this.#listeners.get(id)!,
        });
    }

    getListener(id: AudioListenerId | string): AudioListenerState | undefined {
        return this.#listeners.get(id);
    }

    listListeners(): readonly AudioListenerState[] {
        return this.#listeners.list();
    }

    upsertSource(definition: AudioSourceDefinition<TSchema>): AudioSourceState<TSchema> {
        this.#assertNotDisposed();
        const mutationsBefore = this.#sources.mutationSequence;
        const source = this.#sources.upsert(definition, {
            requireBus: (id) => {
                this.#buses.require(id);
            },
            reconnectPlaybackOutput: (playback, nextBusId) => {
                this.#reconnectPlaybackOutput(playback, nextBusId);
            },
        });

        // A per-frame re-upsert of an unchanged descriptor must not look like an edit: it
        // used to emit source:upserted, re-sync the voice and re-arm autoplay every frame.
        if (this.#sources.mutationSequence === mutationsBefore) {
            return this.#snapshotSource(source);
        }

        this.#syncSource(source);
        if (source.autoplay && source.playbackState === 'idle' && source.clip) {
            void this.playSource(source.id).catch(() => undefined);
        }

        const state = this.#snapshotSource(source);
        this.#emit({
            type: 'source:upserted',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            source: state,
        });
        return state;
    }

    updateSource(id: AudioSourceId | string, patch: AudioSourcePatch<TSchema>): AudioSourceState<TSchema> {
        return this.upsertSource({
            id,
            ...patch,
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
        const removedState = this.#snapshotSource(source);
        this.#sources.remove(id);
        this.#emit({
            type: 'source:removed',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            source: removedState,
        });
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
        return this.#playSourceInternal(id, request, 'source:played', 'play');
    }

    async #playSourceInternal(
        id: AudioSourceId | string,
        request: AudioSourcePlayRequest<TSchema>,
        successEventType: 'source:played' | 'source:resumed',
        operation: 'play' | 'resume'
    ): Promise<AudioPlaybackHandle> {
        this.#assertNotDisposed();
        const sourceId = normalizeAudioSourceId(id);
        const source = this.#sources.require(sourceId);

        const { when, offsetSeconds, durationSeconds, replace, ...patch } = request;
        if (hasOwnKeys(patch)) {
            this.upsertSource({
                id: sourceId,
                ...patch,
            });
        }

        if (!source.clip) {
            throw this.#configurationError({ code: 'audio.invalid-clip', value: source.clip });
        }

        let sequence = 0;
        // Everything fallible sits in one try so that no failure path can end up silent:
        // a clip that cannot be fetched or decoded used to reject from outside this block,
        // emitting no source:error and leaving playbackErrorCount at zero.
        try {
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
            while (this.#maxRealVoices > 0 && this.#occupantVoiceCount() >= this.#maxRealVoices) {
                if (!this.#stealQuietestVoice()) {
                    break;
                }
            }

            sequence = ++this.#playSequence;

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

            source.playSequence = sequence;
            source.playbackState = 'playing';
            source.currentOffsetSeconds = normalizedOffset;
            source.durationSeconds = clip.durationSeconds;
            // The new node owns the timed stop now; the captured window is spent.
            source.resumeDurationSeconds = undefined;
        } catch (error) {
            source.playbackState = 'stopped';
            this.#emit({
                type: 'source:error',
                contextTime: this.context.currentTime,
                systemStatus: this.#status,
                operation,
                sourceId,
                reason: error,
                source: this.getSource(sourceId),
            });
            throw new AudioSourceError(
                operation === 'resume' ? 'audio.source.resume-failed' : 'audio.source.play-failed',
                `Failed to ${operation} audio source ${sourceId}`,
                sourceId,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }

        this.#syncSource(source);
        this.#emit({
            type: successEventType,
            contextTime: this.context.currentTime,
            systemStatus: 'running',
            source: this.#snapshotSource(source),
        });

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
            this.#emit({
                type: 'source:paused',
                contextTime: this.context.currentTime,
                systemStatus: this.#status,
                source: this.#snapshotSource(source),
            });
            return;
        }

        source.currentOffsetSeconds = this.#currentOffsetForSource(source);
        source.resumeDurationSeconds = this.#remainingDurationForSource(source);
        source.playbackState = 'paused';
        source.active.control = 'pausing';
        this.#emit({
            type: 'source:paused',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            source: this.#snapshotSource(source),
        });
        try {
            source.active.sourceNode.stop();
        } catch { /* stop() throws if already stopped -- expected during pause */ }
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
                this.#playSourceInternal(
                    source.id,
                    {
                    offsetSeconds: source.currentOffsetSeconds,
                    durationSeconds: source.resumeDurationSeconds,
                    replace: true,
                    },
                    'source:resumed',
                    'resume'
                )
        );
    }

    stopSource(id: AudioSourceId | string, options: AudioStopOptions = {}): void {
        this.#assertNotDisposed();
        const source = this.#sources.require(id);
        source.currentOffsetSeconds = 0;
        source.resumeDurationSeconds = undefined;
        source.playbackState = 'stopped';
        this.#emit({
            type: 'source:stopped',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            source: this.#snapshotSource(source),
        });
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
        } catch { /* stop() throws if already stopped -- expected during stop */ }
    }

    captureMixerSnapshot(id?: string): AudioMixerSnapshot {
        this.#assertNotDisposed();
        const snapshot = this.#buses.captureSnapshot(id ? normalizeAudioSnapshotId(id) : undefined);
        this.#emit({
            type: 'snapshot:captured',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            snapshotKind: 'mixer',
            snapshotId: snapshot.id ? normalizeAudioSnapshotId(snapshot.id) : undefined,
            busCount: snapshot.buses.length,
            listenerCount: this.listListeners().length,
            sourceCount: this.listSources().length,
        });
        return snapshot;
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
        const snapshot = Object.freeze({
            kind: 'audio.system-snapshot' as const,
            version: 1,
            status: this.#status as Exclude<AudioSystemStatus, 'disposed'>,
            capturedAtEpochMs: Date.now(),
            activeListenerId: this.#listeners.activeListenerId,
            buses: Object.freeze(this.listBuses()),
            listeners: Object.freeze(this.listListeners()),
            sources: Object.freeze(this.listSources()),
        });
        this.#emit({
            type: 'snapshot:captured',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            snapshotKind: 'system',
            snapshotId: undefined,
            busCount: snapshot.buses.length,
            listenerCount: snapshot.listeners.length,
            sourceCount: snapshot.sources.length,
        });
        return snapshot;
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
        this.#emit({
            type: 'snapshot:restored',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            snapshotId: undefined,
            busCount: snapshot.buses.length,
            listenerCount: snapshot.listeners.length,
            sourceCount: snapshot.sources.length,
            restorePlayback: options.restorePlayback ?? true,
        });
    }

    /**
     * Bridges document visibility into the context lifecycle. suspend() and
     * resume() already emit lifecycle events and retry internally, so a
     * background transition must never throw into the DOM listener.
     */
    async #handleDocumentVisibilityChange(): Promise<void> {
        if (this.#disposed || typeof document === 'undefined') {
            return;
        }
        try {
            if (document.hidden) {
                await this.suspend();
            } else {
                await this.resume();
            }
        } catch {
            // Suspend/resume failures are already reported through the
            // observability runtime; swallowing here only guards the listener.
        }
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
                    this.#emit({
                        type: 'system:suspended',
                        contextTime: this.context.currentTime,
                        systemStatus: this.#status,
                    });
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
                    this.#emit({
                        type: 'system:resumed',
                        contextTime: this.context.currentTime,
                        systemStatus: this.#status,
                    });
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

        this.context.removeEventListener?.('statechange', this.#handleContextStateChange);
        if (this.#visibilityHandler && typeof document !== 'undefined') {
            document.removeEventListener('visibilitychange', this.#visibilityHandler);
            this.#visibilityHandler = undefined;
        }
        this.#clearSources();
        this.#listeners.clear();
        this.#buses.clear();
        this.#clips.clear();
        this.#disposed = true;
        this.#status = 'disposed';
        this.#emit({
            type: 'system:disposed',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
        });

        if (this.#ownsContext) {
            try {
                await this.context.close();
            } catch { /* close() throws if already closed -- expected during dispose */ }
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

    /**
     * Reflect browser-driven context transitions in `status`. Web Audio suspends on its own —
     * autoplay policy, tab backgrounding, losing audio focus — and until now `status` only
     * moved through an explicit suspend()/resume(), so a context the browser had suspended
     * still reported 'running'. 'closed' is left to dispose(), which owns that transition.
     */
    #applyContextState(announce: boolean): void {
        const nextStatus: AudioSystemStatus | undefined =
            this.context.state === 'suspended'
                ? 'suspended'
                : this.context.state === 'running'
                  ? this.#hasActivePlayback()
                      ? 'running'
                      : 'idle'
                  : undefined;

        if (nextStatus === undefined || nextStatus === this.#status) {
            return;
        }

        const transitioned = this.#contextState !== this.context.state;
        this.#contextState = this.context.state;
        this.#status = nextStatus;

        if (!announce || !transitioned) {
            return;
        }

        this.#emit({
            type: nextStatus === 'suspended' ? 'system:suspended' : 'system:resumed',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
        });
    }

    readonly #handleContextStateChange = (): void => {
        if (this.#disposed) {
            return;
        }
        this.#applyContextState(true);
    };

    #hasActivePlayback(): boolean {
        for (const source of this.#sources.values()) {
            if (source.active) {
                return true;
            }
        }
        return false;
    }

    #syncListenerToContext(): void {
        const audible = this.#listeners.audibleRuntime();
        const nextVolume = audible?.globalVolume ?? 1;
        if (nextVolume !== this.#appliedGlobalVolume) {
            setParamValue(
                this.#globalGain.gain,
                nextVolume,
                this.context.currentTime,
                this.#appliedGlobalVolume === undefined ? 0 : GLOBAL_VOLUME_SMOOTHING_SECONDS
            );
            this.#appliedGlobalVolume = nextVolume;
        }
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

    #occupantVoiceCount(): number {
        let count = 0;
        for (const source of this.#sources.values()) {
            if (source.active?.control === 'playing') {
                count += 1;
            }
        }
        return count;
    }

    #voiceLoudness(source: InternalSource<TSchema>): number {
        if (source.muted) {
            return 0;
        }
        const attenuation = source.active?.attenuationNode.gain.value;
        return source.volume * (isFiniteNumber(attenuation) ? attenuation : 1);
    }

    #stealQuietestVoice(): boolean {
        let victim: InternalSource<TSchema> | undefined;
        let quietest = Number.POSITIVE_INFINITY;

        for (const candidate of this.#sources.values()) {
            if (candidate.active?.control !== 'playing') {
                continue;
            }
            const loudness = this.#voiceLoudness(candidate);
            if (
                loudness < quietest ||
                (loudness === quietest && victim && candidate.playSequence < victim.playSequence)
            ) {
                quietest = loudness;
                victim = candidate;
            }
        }

        if (!victim) {
            return false;
        }

        this.#voiceStealCount += 1;
        this.stopSource(victim.id);
        // Dispose through the normal path: dropping `active` alone would leak the node chain,
        // since the later onended returns early once the slot is gone.
        this.#disposePlayback(victim);
        return true;
    }

    #remainingDurationForSource(source: InternalSource<TSchema>): number | undefined {
        const playback = source.active;
        if (!playback || playback.durationSeconds === undefined) {
            return undefined;
        }

        const elapsed = Math.max(0, source.currentOffsetSeconds - playback.startOffsetSeconds);
        return Math.max(0, playback.durationSeconds - elapsed);
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
            this.#emit({
                type: 'source:ended',
                contextTime: this.context.currentTime,
                systemStatus: this.#status,
                source: this.#snapshotSource(source),
            });
            if (this.#sources.isTransient(id)) {
                this.#sources.remove(id);
            }
            return;
        }

        source.playbackState = 'stopped';
        source.currentOffsetSeconds = source.loop ? source.currentOffsetSeconds : 0;
        this.#emit({
            type: 'source:ended',
            contextTime: this.context.currentTime,
            systemStatus: this.#status,
            source: this.#snapshotSource(source),
        });
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

    #emit(
        event: Parameters<AudioObservabilityRuntime<TSchema>['emit']>[0]
    ): void {
        this.#observability.emit(event);
    }

    #coerceBusId(id: AudioBusId | string): AudioBusId {
        return normalizeAudioBusId(id);
    }

    #coerceListenerId(id: AudioListenerId | string): AudioListenerId {
        return normalizeAudioListenerId(id);
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
    isObject(value) &&
    value.kind === 'audio.mixer-snapshot' &&
    Array.isArray(value.buses);

export const isAudioSystemSnapshot = <TSchema extends AudioAssetSchema = AudioAssetSchema>(
    value: unknown
): value is AudioSystemSnapshot<TSchema> =>
    isObject(value) &&
    value.kind === 'audio.system-snapshot' &&
    value.version === 1 &&
    Array.isArray(value.buses) &&
    Array.isArray(value.listeners) &&
    Array.isArray(value.sources);
