import {
    AudioBusError,
    AudioConfigurationError,
    DEFAULT_AUDIO_MESSAGE_RESOLVER,
    AudioDisposedError,
    AudioLifecycleError,
    AudioListenerError,
    AudioSnapshotError,
    AudioSourceError,
    resolveAudioMessage,
} from './errors';
import { toAudioClipSelector } from './asset';
import { AudioClipStore } from './internal/clip-store';
import type {
    InternalBus,
    InternalListener,
    InternalSource,
} from './internal/runtime';
import {
    DEFAULT_LISTENER_FORWARD,
    DEFAULT_LISTENER_POSITION,
    DEFAULT_LISTENER_UP,
    clamp,
    cloneMetadata,
    disconnectNode,
    effectivePlaybackRate,
    hasOwnKeys,
    isFiniteNumber,
    isObject,
    normalizeVector3,
    resolveContextFactory,
    setParamValue,
    withRetry,
} from './internal/shared';
import {
    cloneSpatialization,
    syncAudioListenerToContext,
    syncPlaybackSpatialState,
} from './internal/spatial';
import {
    MASTER_AUDIO_BUS_ID,
    normalizeAudioBusId,
    normalizeAudioClipId,
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
    readonly #buses = new Map<AudioBusId, InternalBus>();
    readonly #listeners = new Map<AudioListenerId, InternalListener>();
    readonly #sources = new Map<AudioSourceId, InternalSource<TSchema>>();
    readonly #transientSources = new Set<AudioSourceId>();

    #playSequence = 0;
    #oneShotSequence = 0;
    #activeListenerId?: AudioListenerId;
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

        const master = this.#createBusRuntime({ id: MASTER_AUDIO_BUS_ID });
        this.#buses.set(MASTER_AUDIO_BUS_ID, master);
        this.#connectBus(master);

        if (options.buses?.length) {
            this.#initializeBuses(options.buses);
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
        const listener = this.#activeListener();
        return listener ? this.#snapshotListener(listener) : undefined;
    }

    registerClip(id: AudioClipId | string, clip: AudioClipInput<TSchema>): AudioClipId {
        this.#assertNotDisposed();
        const selector = toAudioClipSelector(clip);
        if (!selector) {
            throw this.#configurationError({ code: 'audio.invalid-clip', value: clip });
        }

        return this.#clips.register(normalizeAudioClipId(id), selector);
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
        const id = normalizeAudioBusId(definition.id);
        const parentId =
            definition.parentId === undefined ? undefined : normalizeAudioBusId(definition.parentId);

        if (id === MASTER_AUDIO_BUS_ID && parentId !== undefined) {
            throw this.#configurationError({ code: 'audio.invalid-parent-bus', value: parentId });
        }
        if (parentId === id) {
            throw this.#configurationError({ code: 'audio.bus.cycle', busId: id, parentId });
        }
        if (parentId !== undefined && !this.#buses.has(parentId)) {
            throw new AudioBusError(`Audio bus ${parentId} does not exist`, parentId);
        }
        if (parentId && this.#busCreatesCycle(id, parentId)) {
            throw this.#configurationError({ code: 'audio.bus.cycle', busId: id, parentId });
        }

        const isNew = !this.#buses.has(id);
        let bus = this.#buses.get(id);
        if (!bus) {
            bus = this.#createBusRuntime({ id });
            this.#buses.set(id, bus);
        }

        if (isNew || bus.parentId !== parentId) {
            if (bus.parentId) {
                this.#buses.get(bus.parentId)?.childIds.delete(bus.id);
            }
            bus.parentId = parentId;
            if (parentId) {
                this.#buses.get(parentId)?.childIds.add(bus.id);
            }
            this.#connectBus(bus);
        }

        if (definition.volume !== undefined) {
            bus.volume = this.#normalizeGain(definition.volume, 'audio.invalid-gain');
        }
        if (definition.mute !== undefined) {
            bus.mute = definition.mute;
        }
        if (definition.pan !== undefined) {
            bus.pan = this.#normalizePan(definition.pan);
        }
        if (definition.metadata !== undefined) {
            bus.metadata = cloneMetadata(definition.metadata);
        }

        this.#applyBusState(bus);
        this.#syncAllSources();
        return this.#snapshotBus(bus);
    }

    updateBus(id: AudioBusId | string, patch: AudioBusPatch): AudioBusState {
        return this.upsertBus({
            id,
            ...(patch as AudioPatchToDefinition<Omit<AudioBusDefinition, 'id'>>),
        });
    }

    removeBus(id: AudioBusId | string): boolean {
        this.#assertNotDisposed();
        const normalizedId = normalizeAudioBusId(id);
        if (normalizedId === MASTER_AUDIO_BUS_ID) {
            return false;
        }

        const bus = this.#buses.get(normalizedId);
        if (!bus) {
            return false;
        }

        const fallbackBusId = bus.parentId ?? MASTER_AUDIO_BUS_ID;
        const fallbackBus = this.#requireBus(fallbackBusId);

        for (const childId of bus.childIds) {
            const child = this.#buses.get(childId);
            if (!child) {
                continue;
            }
            child.parentId = fallbackBusId;
            fallbackBus.childIds.add(childId);
            this.#connectBus(child);
        }

        if (bus.parentId) {
            this.#buses.get(bus.parentId)?.childIds.delete(normalizedId);
        }

        for (const source of this.#sources.values()) {
            if (source.busId !== normalizedId) {
                continue;
            }

            source.busId = fallbackBusId;
            if (source.active) {
                disconnectNode(source.active.outputNode);
                source.active.outputNode.connect(fallbackBus.gainNode);
            }
        }

        disconnectNode(bus.outputNode);
        disconnectNode(bus.gainNode);
        disconnectNode(bus.panNode);
        this.#buses.delete(normalizedId);
        this.#syncAllSources();
        return true;
    }

    getBus(id: AudioBusId | string): AudioBusState | undefined {
        const bus = this.#buses.get(normalizeAudioBusId(id));
        return bus ? this.#snapshotBus(bus) : undefined;
    }

    listBuses(): readonly AudioBusState[] {
        return Object.freeze([...this.#buses.values()].map((bus) => this.#snapshotBus(bus)));
    }

    upsertListener(descriptor: AudioListenerDescriptor): AudioListenerState {
        this.#assertNotDisposed();
        const id = normalizeAudioListenerId(descriptor.id ?? 'default');
        let listener = this.#listeners.get(id);

        if (!listener) {
            listener = {
                id,
                active: descriptor.active ?? this.#listeners.size === 0,
                enabled: descriptor.enabled ?? true,
                position: normalizeVector3(descriptor.position, DEFAULT_LISTENER_POSITION),
                forward: normalizeVector3(descriptor.forward, DEFAULT_LISTENER_FORWARD),
                up: normalizeVector3(descriptor.up, DEFAULT_LISTENER_UP),
                metadata: cloneMetadata(descriptor.metadata),
            };
            this.#listeners.set(id, listener);
        }

        if (descriptor.active !== undefined) {
            listener.active = descriptor.active;
        }
        if (descriptor.enabled !== undefined) {
            listener.enabled = descriptor.enabled;
        }
        if (descriptor.position !== undefined) {
            listener.position = normalizeVector3(descriptor.position, DEFAULT_LISTENER_POSITION);
        }
        if (descriptor.forward !== undefined) {
            listener.forward = normalizeVector3(descriptor.forward, DEFAULT_LISTENER_FORWARD);
        }
        if (descriptor.up !== undefined) {
            listener.up = normalizeVector3(descriptor.up, DEFAULT_LISTENER_UP);
        }
        if (descriptor.metadata !== undefined) {
            listener.metadata = cloneMetadata(descriptor.metadata);
        }

        if (listener.active) {
            this.#activateListener(listener.id);
        } else if (this.#activeListenerId === listener.id || !this.#activeListenerId) {
            this.#activeListenerId = this.#findFallbackListenerId();
        }

        this.#syncListenerToContext();
        this.#syncAllSources();
        return this.#snapshotListener(listener);
    }

    updateListener(id: AudioListenerId | string, patch: AudioListenerPatch): AudioListenerState {
        return this.upsertListener({
            id,
            ...(patch as AudioPatchToDefinition<Omit<AudioListenerDescriptor, 'id'>>),
        });
    }

    removeListener(id: AudioListenerId | string): boolean {
        this.#assertNotDisposed();
        const normalizedId = normalizeAudioListenerId(id);
        const removed = this.#listeners.delete(normalizedId);
        if (!removed) {
            return false;
        }

        if (this.#activeListenerId === normalizedId) {
            this.#activeListenerId = this.#findFallbackListenerId();
        }

        this.#syncListenerToContext();
        this.#syncAllSources();
        return true;
    }

    setActiveListener(id: AudioListenerId | string): void {
        this.#assertNotDisposed();
        const normalizedId = normalizeAudioListenerId(id);
        const listener = this.#listeners.get(normalizedId);
        if (!listener) {
            throw new AudioListenerError(`Audio listener ${normalizedId} does not exist`, normalizedId);
        }

        this.#activateListener(listener.id);
        this.#syncListenerToContext();
        this.#syncAllSources();
    }

    getListener(id: AudioListenerId | string): AudioListenerState | undefined {
        const listener = this.#listeners.get(normalizeAudioListenerId(id));
        return listener ? this.#snapshotListener(listener) : undefined;
    }

    listListeners(): readonly AudioListenerState[] {
        return Object.freeze([...this.#listeners.values()].map((listener) => this.#snapshotListener(listener)));
    }

    upsertSource(definition: AudioSourceDefinition<TSchema>): AudioSourceState<TSchema> {
        this.#assertNotDisposed();
        const id = normalizeAudioSourceId(definition.id ?? `source:${this.#sources.size + 1}`);
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
            const nextBus = this.#requireBus(nextBusId);
            if (source.busId !== nextBusId) {
                source.busId = nextBusId;
                if (source.active) {
                    disconnectNode(source.active.outputNode);
                    source.active.outputNode.connect(nextBus.gainNode);
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
        const normalizedId = normalizeAudioSourceId(id);
        const source = this.#sources.get(normalizedId);
        if (!source) {
            return false;
        }

        this.stopSource(normalizedId);
        this.#disposePlayback(source);
        this.#transientSources.delete(normalizedId);
        this.#sources.delete(normalizedId);
        return true;
    }

    getSource(id: AudioSourceId | string): AudioSourceState<TSchema> | undefined {
        const source = this.#sources.get(normalizeAudioSourceId(id));
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
        const source = this.#sources.get(sourceId);
        if (!source) {
            throw new AudioSourceError(
                'audio.source.missing',
                `Audio source ${sourceId} does not exist`,
                sourceId
            );
        }

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
        const bus = this.#requireBus(source.busId);
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

        const sourceNode = this.context.createBufferSource();
        sourceNode.buffer = clip.buffer;
        sourceNode.loop = source.loop;
        sourceNode.playbackRate.value = source.playbackRate;
        sourceNode.detune.value = source.detuneCents;
        if (clip.loopStartSeconds !== undefined) {
            sourceNode.loopStart = clip.loopStartSeconds;
        }
        if (clip.loopEndSeconds !== undefined) {
            sourceNode.loopEnd = clip.loopEndSeconds;
        }

        const gainNode = this.context.createGain();
        const attenuationNode = this.context.createGain();
        sourceNode.connect(gainNode);
        gainNode.connect(attenuationNode);

        let spatialNode: StereoPannerNode | PannerNode | undefined;
        let outputNode: AudioNode = attenuationNode;

        if (source.spatial?.mode === '3d') {
            const panner = this.context.createPanner();
            panner.distanceModel = 'inverse';
            panner.refDistance = 1;
            panner.maxDistance = 1000000;
            panner.rolloffFactor = 0;
            attenuationNode.connect(panner);
            outputNode = panner;
            spatialNode = panner;
        } else if (typeof this.context.createStereoPanner === 'function') {
            const stereoPanner = this.context.createStereoPanner();
            attenuationNode.connect(stereoPanner);
            outputNode = stereoPanner;
            spatialNode = stereoPanner;
        }

        outputNode.connect(bus.gainNode);

        source.active = {
            sequence,
            sourceNode,
            gainNode,
            attenuationNode,
            spatialNode,
            outputNode,
            clip,
            durationSeconds: normalizedDuration,
            startOffsetSeconds: normalizedOffset,
            startedAtContextTime: normalizedWhen,
            control: 'playing',
        };
        source.playSequence = sequence;
        source.playbackState = 'playing';
        source.currentOffsetSeconds = normalizedOffset;
        source.durationSeconds = clip.durationSeconds;

        this.#syncSource(source);
        sourceNode.onended = () => {
            this.#handleEnded(source.id, sequence);
        };

        try {
            if (normalizedDuration !== undefined && normalizedDuration > 0) {
                sourceNode.start(normalizedWhen, normalizedOffset, normalizedDuration);
            } else {
                sourceNode.start(normalizedWhen, normalizedOffset);
            }
        } catch (error) {
            this.#disposePlayback(source);
            source.playbackState = 'stopped';
            throw new AudioSourceError(
                'audio.source.play-failed',
                `Failed to play audio source ${sourceId}`,
                sourceId,
                { cause: error instanceof Error ? error : new Error(String(error)) }
            );
        }

        this.#status = 'running';
        return this.#createPlaybackHandle(source.id, sequence);
    }

    async play(
        request: AudioSourceDefinition<TSchema> & AudioSourcePlayRequest<TSchema>
    ): Promise<AudioPlaybackHandle> {
        const id = normalizeAudioSourceId(request.id ?? `oneshot:${++this.#oneShotSequence}`);
        this.#transientSources.add(id);
        this.upsertSource({ ...request, id, autoplay: false });
        return this.playSource(id, request);
    }

    pauseSource(id: AudioSourceId | string): void {
        this.#assertNotDisposed();
        const source = this.#requireSource(id);
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
        const source = this.#requireSource(id);
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
        const source = this.#requireSource(id);
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
        return Object.freeze({
            id: id ? normalizeAudioSnapshotId(id) : undefined,
            buses: Object.freeze(
                [...this.#buses.values()].map((bus) =>
                    Object.freeze({
                        id: bus.id,
                        volume: bus.volume,
                        mute: bus.mute,
                        pan: bus.pan,
                    })
                )
            ),
        });
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
        const duration =
            options.durationSeconds !== undefined
                ? this.#normalizeTime(options.durationSeconds)
                : 0;

        for (const entry of snapshot.buses) {
            const bus = this.#buses.get(normalizeAudioBusId(entry.id));
            if (!bus) {
                continue;
            }
            if (entry.volume !== undefined) {
                bus.volume = this.#normalizeGain(entry.volume, 'audio.invalid-gain');
            }
            if (entry.mute !== undefined) {
                bus.mute = entry.mute;
            }
            if (entry.pan !== undefined) {
                bus.pan = this.#normalizePan(entry.pan);
            }
            this.#applyBusState(bus, { atTime, durationSeconds: duration });
        }
    }

    snapshot(): AudioSystemSnapshot<TSchema> {
        this.#assertNotDisposed();
        return Object.freeze({
            version: 1,
            status: this.#status === 'disposed' ? 'idle' : this.#status,
            capturedAtEpochMs: Date.now(),
            activeListenerId: this.#activeListenerId,
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
            this.#clearListeners();
            this.#clearBuses();
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

            const restored = this.#requireSource(source.id);
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
        this.#clearListeners();
        this.#clearBuses();
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

    #initializeBuses(buses: readonly AudioBusDefinition[]): void {
        for (const bus of buses) {
            this.upsertBus({ ...bus, parentId: undefined });
        }

        for (const bus of buses) {
            if (bus.parentId !== undefined) {
                this.upsertBus({ id: bus.id, parentId: bus.parentId });
            }
        }
    }

    #createBusRuntime(definition: Pick<AudioBusDefinition, 'id' | 'parentId'>): InternalBus {
        const gainNode = this.context.createGain();
        const panNode =
            typeof this.context.createStereoPanner === 'function'
                ? this.context.createStereoPanner()
                : undefined;
        let outputNode: AudioNode = gainNode;
        if (panNode) {
            gainNode.connect(panNode);
            outputNode = panNode;
        }

        return {
            id: normalizeAudioBusId(definition.id),
            parentId: definition.parentId ? normalizeAudioBusId(definition.parentId) : undefined,
            gainNode,
            panNode,
            outputNode,
            childIds: new Set<AudioBusId>(),
            volume: 1,
            mute: false,
            pan: 0,
            metadata: Object.freeze({}),
        };
    }

    #connectBus(bus: InternalBus): void {
        disconnectNode(bus.outputNode);
        const parent = bus.parentId ? this.#buses.get(bus.parentId) : undefined;
        bus.outputNode.connect(parent?.gainNode ?? this.destination);
        this.#applyBusState(bus);
    }

    #applyBusState(
        bus: InternalBus,
        options: { atTime?: number; durationSeconds?: number } = {}
    ): void {
        const atTime = options.atTime ?? this.context.currentTime;
        const durationSeconds = options.durationSeconds ?? 0;
        setParamValue(bus.gainNode.gain, bus.mute ? 0 : bus.volume, atTime, durationSeconds);
        if (bus.panNode) {
            setParamValue(bus.panNode.pan, bus.pan, atTime, durationSeconds);
        }
    }

    #requireBus(id: AudioBusId | string): InternalBus {
        const normalizedId = normalizeAudioBusId(id);
        const bus = this.#buses.get(normalizedId);
        if (!bus) {
            throw new AudioBusError(`Audio bus ${normalizedId} does not exist`, normalizedId);
        }
        return bus;
    }

    #requireSource(id: AudioSourceId | string): InternalSource<TSchema> {
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

    #activeListener(): InternalListener | undefined {
        return this.#activeListenerId ? this.#listeners.get(this.#activeListenerId) : undefined;
    }

    #audibleListener(): InternalListener | undefined {
        const listener = this.#activeListener();
        return listener?.enabled ? listener : undefined;
    }

    #activateListener(id: AudioListenerId): void {
        for (const candidate of this.#listeners.values()) {
            candidate.active = candidate.id === id;
        }
        this.#activeListenerId = id;
    }

    #syncListenerToContext(): void {
        syncAudioListenerToContext(this.context.listener, this.#audibleListener());
    }

    #syncSource(source: InternalSource<TSchema>): void {
        if (!source.active) {
            return;
        }

        source.active.sourceNode.playbackRate.value = source.playbackRate;
        source.active.sourceNode.detune.value = source.detuneCents;
        syncPlaybackSpatialState(source.active, source, this.#activeListener());
    }

    #syncAllSources(): void {
        for (const source of this.#sources.values()) {
            this.#syncSource(source);
        }
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
            if (this.#transientSources.has(id)) {
                this.removeSource(id);
            }
            return;
        }

        source.playbackState = 'stopped';
        source.currentOffsetSeconds = source.loop ? source.currentOffsetSeconds : 0;
        if (this.#transientSources.has(id)) {
            this.removeSource(id);
        }
    }

    #disposePlayback(source: InternalSource<TSchema>): void {
        if (!source.active) {
            return;
        }

        source.active.sourceNode.onended = null;
        disconnectNode(source.active.sourceNode);
        disconnectNode(source.active.gainNode);
        disconnectNode(source.active.attenuationNode);
        disconnectNode(source.active.spatialNode);
        source.active = undefined;
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

    #snapshotBus(bus: InternalBus): AudioBusState {
        return Object.freeze({
            id: bus.id,
            parentId: bus.parentId,
            volume: bus.volume,
            mute: bus.mute,
            pan: bus.pan,
            effectiveGain: this.#effectiveGainForBus(bus.id),
            childIds: Object.freeze([...bus.childIds]),
            metadata: bus.metadata,
        });
    }

    #snapshotListener(listener: InternalListener): AudioListenerState {
        return Object.freeze({
            id: listener.id,
            active: listener.active,
            enabled: listener.enabled,
            position: normalizeVector3(listener.position, DEFAULT_LISTENER_POSITION),
            forward: normalizeVector3(listener.forward, DEFAULT_LISTENER_FORWARD),
            up: normalizeVector3(listener.up, DEFAULT_LISTENER_UP),
            metadata: listener.metadata,
        });
    }

    #snapshotSource(source: InternalSource<TSchema>): AudioSourceState<TSchema> {
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
            currentOffsetSeconds: source.active
                ? this.#currentOffsetForSource(source)
                : source.currentOffsetSeconds,
            durationSeconds: source.durationSeconds,
            playSequence: source.playSequence,
        });
    }

    #effectiveGainForBus(id: AudioBusId): number {
        let gain = 1;
        let current: AudioBusId | undefined = id;
        while (current) {
            const bus = this.#buses.get(current);
            if (!bus) {
                break;
            }
            gain *= bus.mute ? 0 : bus.volume;
            current = bus.parentId;
        }
        return gain;
    }

    #busCreatesCycle(id: AudioBusId, parentId: AudioBusId): boolean {
        let current: AudioBusId | undefined = parentId;
        while (current) {
            if (current === id) {
                return true;
            }
            current = this.#buses.get(current)?.parentId;
        }
        return false;
    }

    #findFallbackListenerId(): AudioListenerId | undefined {
        let fallbackId: AudioListenerId | undefined;
        for (const listener of this.#listeners.values()) {
            const shouldActivate = fallbackId === undefined && listener.enabled;
            listener.active = shouldActivate;
            if (shouldActivate) {
                fallbackId = listener.id;
            }
        }
        return fallbackId;
    }

    #clearSources(): void {
        for (const source of this.#sources.values()) {
            this.stopSource(source.id);
            this.#disposePlayback(source);
        }
        this.#sources.clear();
        this.#transientSources.clear();
    }

    #clearListeners(): void {
        this.#listeners.clear();
        this.#activeListenerId = undefined;
    }

    #clearBuses(): void {
        for (const [id, bus] of [...this.#buses]) {
            if (id === MASTER_AUDIO_BUS_ID) {
                bus.childIds.clear();
                bus.parentId = undefined;
                bus.volume = 1;
                bus.mute = false;
                bus.pan = 0;
                bus.metadata = Object.freeze({});
                this.#connectBus(bus);
                continue;
            }

            disconnectNode(bus.outputNode);
            disconnectNode(bus.gainNode);
            disconnectNode(bus.panNode);
            this.#buses.delete(id);
        }
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
