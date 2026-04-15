import type { AssetRecord } from '@axrone/asset-core';
import {
    AudioAssetError,
    AudioBusError,
    AudioConfigurationError,
    DEFAULT_AUDIO_MESSAGE_RESOLVER,
    AudioDisposedError,
    AudioLifecycleError,
    AudioListenerError,
    AudioSnapshotError,
    AudioSourceError,
    AudioUnavailableError,
    resolveAudioMessage,
} from './errors';
import { isAudioClipAssetData, toAudioClipSelector } from './asset';
import {
    MASTER_AUDIO_BUS_ID,
    cloneAudioVector3,
    isAudioClipAssetRecord,
    normalizeAudioBusId,
    normalizeAudioClipId,
    normalizeAudioListenerId,
    normalizeAudioSnapshotId,
    normalizeAudioSourceId,
} from './reference';
import { AudioListenerComponent, AudioSourceComponent } from './components';
import type {
    Audio3DSpatialization,
    AudioAssetResolver,
    AudioAssetSchema,
    AudioBusDefinition,
    AudioBusId,
    AudioBusPatch,
    AudioBusState,
    AudioClipAssetData,
    AudioClipAssetSelector,
    AudioClipId,
    AudioClipInput,
    AudioClipRecord,
    AudioClipSelector,
    AudioJsonValue,
    AudioListenerDescriptor,
    AudioListenerId,
    AudioListenerPatch,
    AudioListenerState,
    AudioMessageDescriptor,
    AudioMessageResolver,
    AudioMixerSnapshot,
    AudioPlaybackHandle,
    AudioRestoreOptions,
    AudioRetryContext,
    AudioRetryPolicy,
    AudioSnapshotTransitionOptions,
    AudioSourceComponentCommand,
    AudioSourceDefinition,
    AudioSourceId,
    AudioSourcePatch,
    AudioSourcePlayRequest,
    AudioSourceState,
    AudioSpatialAttenuation,
    AudioSpatialization,
    AudioStopOptions,
    AudioSystemOptions,
    AudioSystemSnapshot,
    AudioSystemStatus,
    AudioVector3,
} from './types';

interface InternalBus {
    readonly id: AudioBusId;
    parentId?: AudioBusId;
    readonly gainNode: GainNode;
    readonly panNode?: StereoPannerNode;
    readonly outputNode: AudioNode;
    readonly childIds: Set<AudioBusId>;
    volume: number;
    mute: boolean;
    pan: number;
    metadata: Readonly<Record<string, AudioJsonValue>>;
}

interface InternalListener {
    readonly id: AudioListenerId;
    active: boolean;
    enabled: boolean;
    position: AudioVector3;
    forward: AudioVector3;
    up: AudioVector3;
    metadata: Readonly<Record<string, AudioJsonValue>>;
}

interface InternalPlayback<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly sequence: number;
    readonly sourceNode: AudioBufferSourceNode;
    readonly gainNode: GainNode;
    readonly attenuationNode: GainNode;
    readonly spatialNode?: StereoPannerNode | PannerNode;
    readonly outputNode: AudioNode;
    readonly clip: AudioClipRecord<TSchema>;
    readonly durationSeconds?: number;
    readonly startOffsetSeconds: number;
    readonly startedAtContextTime: number;
    control: 'playing' | 'pausing' | 'stopping';
}

interface InternalSource<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly id: AudioSourceId;
    busId: AudioBusId;
    clip?: AudioClipSelector<TSchema>;
    volume: number;
    muted: boolean;
    loop: boolean;
    autoplay: boolean;
    playbackRate: number;
    detuneCents: number;
    pan: number;
    spatial?: AudioSpatialization;
    startOffsetSeconds: number;
    metadata: Readonly<Record<string, AudioJsonValue>>;
    playbackState: AudioSourceState<TSchema>['playbackState'];
    currentOffsetSeconds: number;
    durationSeconds?: number;
    playSequence: number;
    active?: InternalPlayback<TSchema>;
}

const DEFAULT_LISTENER_POSITION = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_LISTENER_FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });
const DEFAULT_LISTENER_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const DEFAULT_ATTENUATION = Object.freeze({
    model: 'inverse',
    refDistance: 1,
    maxDistance: 10000,
    rolloffFactor: 1,
    minGain: 0,
} satisfies Required<AudioSpatialAttenuation>);

const isObject = (value: unknown): value is Record<PropertyKey, unknown> =>
    typeof value === 'object' && value !== null;

const cloneMetadata = (
    value: Readonly<Record<string, AudioJsonValue>> | undefined
): Readonly<Record<string, AudioJsonValue>> => Object.freeze({ ...(value ?? {}) });

const clamp = (value: number, min: number, max: number): number =>
    Math.min(max, Math.max(min, value));

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const effectivePlaybackRate = (playbackRate: number, detuneCents: number): number =>
    playbackRate * 2 ** (detuneCents / 1200);

const normalizeVector3 = (value: AudioVector3 | undefined, fallback: AudioVector3): AudioVector3 => {
    const next = cloneAudioVector3(value, fallback);
    if (!isFiniteNumber(next.x) || !isFiniteNumber(next.y) || !isFiniteNumber(next.z)) {
        throw new TypeError('Audio vector values must be finite');
    }

    return next;
};

const cloneSpatialization = (
    value: AudioSpatialization | undefined
): AudioSpatialization | undefined => {
    if (!value) {
        return undefined;
    }

    if (value.mode === '2d') {
        return {
            mode: '2d',
            position: value.position ? cloneAudioVector3(value.position) : undefined,
            pan: value.pan,
            attenuation: value.attenuation ? { ...value.attenuation } : undefined,
        };
    }

    return {
        mode: '3d',
        position: value.position ? cloneAudioVector3(value.position) : undefined,
        orientation: value.orientation ? cloneAudioVector3(value.orientation) : undefined,
        attenuation: value.attenuation ? { ...value.attenuation } : undefined,
        panningModel: value.panningModel,
        coneInnerAngle: value.coneInnerAngle,
        coneOuterAngle: value.coneOuterAngle,
        coneOuterGain: value.coneOuterGain,
    };
};

const normalizeAttenuation = (
    value: AudioSpatialAttenuation | undefined
): Required<AudioSpatialAttenuation> => ({
    model: value?.model ?? DEFAULT_ATTENUATION.model,
    refDistance: isFiniteNumber(value?.refDistance) ? Math.max(0.0001, value!.refDistance!) : DEFAULT_ATTENUATION.refDistance,
    maxDistance: isFiniteNumber(value?.maxDistance) ? Math.max(0.0001, value!.maxDistance!) : DEFAULT_ATTENUATION.maxDistance,
    rolloffFactor: isFiniteNumber(value?.rolloffFactor) ? Math.max(0, value!.rolloffFactor!) : DEFAULT_ATTENUATION.rolloffFactor,
    minGain: isFiniteNumber(value?.minGain) ? clamp(value!.minGain!, 0, 1) : DEFAULT_ATTENUATION.minGain,
});

const attenuationGainForDistance = (distance: number, value: AudioSpatialAttenuation | undefined): number => {
    const attenuation = normalizeAttenuation(value);
    const ref = attenuation.refDistance;
    const max = Math.max(ref, attenuation.maxDistance);
    const rolloff = attenuation.rolloffFactor;

    let gain = 1;
    switch (attenuation.model) {
        case 'none':
            gain = 1;
            break;
        case 'linear':
            if (distance <= ref) {
                gain = 1;
            } else if (distance >= max) {
                gain = attenuation.minGain;
            } else {
                gain = 1 - rolloff * ((distance - ref) / (max - ref));
            }
            break;
        case 'exponential':
            gain = distance <= ref ? 1 : (distance / ref) ** -rolloff;
            break;
        case 'inverse':
        default:
            gain = distance <= ref ? 1 : ref / (ref + rolloff * (distance - ref));
            break;
    }

    return clamp(gain, attenuation.minGain, 1);
};

const distance2D = (from: AudioVector3, to: AudioVector3): number => {
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    return Math.sqrt(dx * dx + dy * dy);
};

const distance3D = (from: AudioVector3, to: AudioVector3): number => {
    const dx = from.x - to.x;
    const dy = from.y - to.y;
    const dz = from.z - to.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
};

const effectivePanFor2D = (
    source: AudioVector3,
    listener: AudioVector3,
    pan: number,
    attenuation: AudioSpatialAttenuation | undefined
): number => {
    const normalized = normalizeAttenuation(attenuation);
    const span = Math.max(normalized.refDistance, normalized.maxDistance, 1);
    return clamp(pan + (source.x - listener.x) / span, -1, 1);
};

const resolveContextFactory = (): (() => AudioContext) => {
    const GlobalAudioContext =
        (globalThis as { AudioContext?: typeof AudioContext }).AudioContext ??
        (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

    if (!GlobalAudioContext) {
        throw new AudioUnavailableError('No AudioContext implementation is available');
    }

    return () => new GlobalAudioContext();
};

const sleep = async (ms: number): Promise<void> => {
    if (ms <= 0) {
        return;
    }

    await new Promise<void>((resolve) => {
        setTimeout(resolve, ms);
    });
};

const disconnectNode = (node: AudioNode | undefined): void => {
    if (!node) {
        return;
    }

    try {
        node.disconnect();
    } catch {}
};

const setParamValue = (
    param: AudioParam,
    value: number,
    atTime: number,
    durationSeconds = 0
): void => {
    param.cancelScheduledValues(atTime);
    if (durationSeconds > 0) {
        param.setValueAtTime(param.value, atTime);
        param.linearRampToValueAtTime(value, atTime + durationSeconds);
        return;
    }

    param.setValueAtTime(value, atTime);
};

export class AudioSystem<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly context: AudioContext;
    readonly destination: AudioNode;

    readonly #messageResolver: AudioMessageResolver;
    readonly #locale: string;
    readonly #assetDatabase?: AudioSystemOptions<TSchema>['assetDatabase'];
    readonly #assetResolver?: AudioAssetResolver<TSchema>;
    readonly #autoResume: boolean;
    readonly #resumeRetryPolicy?: AudioRetryPolicy<TSchema>;
    readonly #assetRetryPolicy?: AudioRetryPolicy<TSchema>;
    readonly #ownsContext: boolean;
    readonly #buses = new Map<AudioBusId, InternalBus>();
    readonly #listeners = new Map<AudioListenerId, InternalListener>();
    readonly #sources = new Map<AudioSourceId, InternalSource<TSchema>>();
    readonly #registeredClips = new Map<AudioClipId, AudioClipSelector<TSchema>>();
    readonly #clipCache = new Map<string, Promise<AudioClipRecord<TSchema>>>();
    readonly #bufferCacheKeys = new WeakMap<AudioBuffer, string>();
    readonly #transientSources = new Set<AudioSourceId>();

    #bufferCacheSequence = 0;
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
        this.#assetDatabase = options.assetDatabase;
        this.#assetResolver = options.assetResolver;
        this.#autoResume = options.autoResume ?? true;
        this.#resumeRetryPolicy = options.resumeRetryPolicy;
        this.#assetRetryPolicy = options.assetRetryPolicy;

        const master = this.#createBusRuntime({ id: MASTER_AUDIO_BUS_ID });
        this.#buses.set(MASTER_AUDIO_BUS_ID, master);
        this.#connectBus(master);

        if (options.buses && options.buses.length > 0) {
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

    registerClip(id: AudioClipId | string, clip: AudioClipInput<TSchema>): AudioClipId {
        this.#assertNotDisposed();
        const normalizedId = normalizeAudioClipId(id);
        const selector = toAudioClipSelector(clip);
        if (!selector) {
            throw this.#configurationError({ code: 'audio.invalid-clip', value: clip });
        }
        this.#registeredClips.set(normalizedId, selector);
        const cacheKey = this.#clipCacheKeyForSelector({ kind: 'registered', clipId: normalizedId });
        if (cacheKey) {
            this.#clipCache.delete(cacheKey);
        }
        return normalizedId;
    }

    unregisterClip(id: AudioClipId | string): boolean {
        this.#assertNotDisposed();
        const normalizedId = normalizeAudioClipId(id);
        const cacheKey = this.#clipCacheKeyForSelector({ kind: 'registered', clipId: normalizedId });
        if (cacheKey) {
            this.#clipCache.delete(cacheKey);
        }
        return this.#registeredClips.delete(normalizedId);
    }

    async resolveClip(selector: AudioClipInput<TSchema>): Promise<AudioClipRecord<TSchema>> {
        this.#assertNotDisposed();
        const normalized = toAudioClipSelector(selector);
        if (!normalized) {
            throw this.#configurationError({ code: 'audio.invalid-clip', value: selector });
        }
        return this.#resolveClipSelector(normalized);
    }

    upsertBus(definition: AudioBusDefinition): AudioBusState {
        this.#assertNotDisposed();
        const id = normalizeAudioBusId(definition.id);
        const parentId = definition.parentId === undefined ? undefined : normalizeAudioBusId(definition.parentId);

        if (id === MASTER_AUDIO_BUS_ID && parentId !== undefined) {
            throw this.#configurationError({ code: 'audio.invalid-parent-bus', value: parentId });
        }

        if (parentId === id) {
            throw this.#configurationError({ code: 'audio.bus.cycle', busId: id, parentId: parentId });
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
            parentId: patch.parentId as AudioBusDefinition['parentId'],
            volume: patch.volume as AudioBusDefinition['volume'],
            mute: patch.mute as AudioBusDefinition['mute'],
            pan: patch.pan as AudioBusDefinition['pan'],
            metadata: patch.metadata as AudioBusDefinition['metadata'],
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
        for (const childId of bus.childIds) {
            const child = this.#buses.get(childId);
            if (!child) {
                continue;
            }
            child.parentId = fallbackBusId;
            this.#buses.get(fallbackBusId)?.childIds.add(childId);
            this.#connectBus(child);
        }

        if (bus.parentId) {
            this.#buses.get(bus.parentId)?.childIds.delete(normalizedId);
        }

        for (const source of this.#sources.values()) {
            if (source.busId === normalizedId) {
                source.busId = fallbackBusId;
                if (source.active) {
                    disconnectNode(source.active.outputNode);
                    source.active.outputNode.connect(this.#requireBus(fallbackBusId).gainNode);
                }
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
            this.setActiveListener(listener.id);
        } else if (!this.#activeListenerId) {
            this.#activeListenerId = this.#findFallbackListenerId();
        }

        this.#syncListenerToContext();
        this.#syncAllSources();
        return this.#snapshotListener(listener);
    }

    updateListener(id: AudioListenerId | string, patch: AudioListenerPatch): AudioListenerState {
        return this.upsertListener({
            id,
            active: patch.active as AudioListenerDescriptor['active'],
            enabled: patch.enabled as AudioListenerDescriptor['enabled'],
            position: patch.position as AudioListenerDescriptor['position'],
            forward: patch.forward as AudioListenerDescriptor['forward'],
            up: patch.up as AudioListenerDescriptor['up'],
            metadata: patch.metadata as AudioListenerDescriptor['metadata'],
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

        for (const candidate of this.#listeners.values()) {
            candidate.active = candidate.id === normalizedId;
        }
        this.#activeListenerId = normalizedId;
        this.#syncListenerToContext();
        this.#syncAllSources();
    }

    getListener(id: AudioListenerId | string): AudioListenerState | undefined {
        const listener = this.#listeners.get(normalizeAudioListenerId(id));
        return listener ? this.#snapshotListener(listener) : undefined;
    }

    get activeListener(): AudioListenerState | undefined {
        const listener = this.#activeListenerId ? this.#listeners.get(this.#activeListenerId) : undefined;
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
            this.#requireBus(nextBusId);
            if (source.busId !== nextBusId) {
                source.busId = nextBusId;
                if (source.active) {
                    disconnectNode(source.active.outputNode);
                    source.active.outputNode.connect(this.#requireBus(nextBusId).gainNode);
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
            busId: patch.busId as AudioSourceDefinition<TSchema>['busId'],
            clip: patch.clip as AudioSourceDefinition<TSchema>['clip'],
            volume: patch.volume as AudioSourceDefinition<TSchema>['volume'],
            muted: patch.muted as AudioSourceDefinition<TSchema>['muted'],
            loop: patch.loop as AudioSourceDefinition<TSchema>['loop'],
            autoplay: patch.autoplay as AudioSourceDefinition<TSchema>['autoplay'],
            playbackRate: patch.playbackRate as AudioSourceDefinition<TSchema>['playbackRate'],
            detuneCents: patch.detuneCents as AudioSourceDefinition<TSchema>['detuneCents'],
            pan: patch.pan as AudioSourceDefinition<TSchema>['pan'],
            spatial: patch.spatial as AudioSourceDefinition<TSchema>['spatial'],
            startOffsetSeconds: patch.startOffsetSeconds as AudioSourceDefinition<TSchema>['startOffsetSeconds'],
            metadata: patch.metadata as AudioSourceDefinition<TSchema>['metadata'],
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

        if (Object.keys(request).length > 0) {
            const { when, offsetSeconds, durationSeconds, replace, ...patch } = request;
            if (Object.keys(patch).length > 0) {
                this.upsertSource({
                    id: sourceId,
                    busId: patch.busId as AudioSourceDefinition<TSchema>['busId'],
                    clip: patch.clip as AudioSourceDefinition<TSchema>['clip'],
                    volume: patch.volume as AudioSourceDefinition<TSchema>['volume'],
                    muted: patch.muted as AudioSourceDefinition<TSchema>['muted'],
                    loop: patch.loop as AudioSourceDefinition<TSchema>['loop'],
                    autoplay: patch.autoplay as AudioSourceDefinition<TSchema>['autoplay'],
                    playbackRate: patch.playbackRate as AudioSourceDefinition<TSchema>['playbackRate'],
                    detuneCents: patch.detuneCents as AudioSourceDefinition<TSchema>['detuneCents'],
                    pan: patch.pan as AudioSourceDefinition<TSchema>['pan'],
                    spatial: patch.spatial as AudioSourceDefinition<TSchema>['spatial'],
                    startOffsetSeconds: patch.startOffsetSeconds as AudioSourceDefinition<TSchema>['startOffsetSeconds'],
                    metadata: patch.metadata as AudioSourceDefinition<TSchema>['metadata'],
                });
            }
        }

        if (!source.clip) {
            throw this.#configurationError({ code: 'audio.invalid-clip', value: source.clip });
        }

        if (this.#autoResume && this.context.state === 'suspended') {
            await this.resume();
        }

        if (source.active) {
            if (request.replace === false) {
                return this.#createPlaybackHandle(sourceId, source.playSequence);
            }
            this.stopSource(sourceId);
        }

        const clip = await this.#resolveClipSelector(source.clip);
        const bus = this.#requireBus(source.busId);
        const offset = this.#normalizeOffset(
            request.offsetSeconds ?? source.currentOffsetSeconds,
            clip,
            source.loop
        );
        const when = request.when !== undefined ? this.#normalizeTime(request.when) : this.context.currentTime;
        const durationSeconds =
            request.durationSeconds !== undefined
                ? this.#normalizeTime(request.durationSeconds)
                : undefined;
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
            durationSeconds,
            startOffsetSeconds: offset,
            startedAtContextTime: when,
            control: 'playing',
        };
        source.playSequence = sequence;
        source.playbackState = 'playing';
        source.currentOffsetSeconds = offset;
        source.durationSeconds = clip.durationSeconds;

        this.#syncSource(source);
        sourceNode.onended = () => {
            this.#handleEnded(source.id, sequence);
        };

        try {
            if (durationSeconds !== undefined && durationSeconds > 0) {
                sourceNode.start(when, offset, durationSeconds);
            } else {
                sourceNode.start(when, offset);
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
        return this.#withRetry(
            this.#resumeRetryPolicy,
            (attempt) => ({
                operation: 'source.resume',
                attempt,
                sourceId: source.id,
                clip: source.clip,
            }),
            async () => this.playSource(source.id, { offsetSeconds: source.currentOffsetSeconds, replace: true })
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
                [...this.#buses.values()].map((bus) => ({
                    id: bus.id,
                    volume: bus.volume,
                    mute: bus.mute,
                    pan: bus.pan,
                }))
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

        const atTime = options.atTime !== undefined ? this.#normalizeTime(options.atTime) : this.context.currentTime;
        const duration = options.durationSeconds !== undefined ? this.#normalizeTime(options.durationSeconds) : 0;

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

        if (snapshot.buses.some((bus) => bus.id === MASTER_AUDIO_BUS_ID)) {
            const master = snapshot.buses.find((bus) => bus.id === MASTER_AUDIO_BUS_ID)!;
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
        await this.#withRetry(
            this.#resumeRetryPolicy,
            (attempt) => ({ operation: 'context.suspend', attempt }),
            async () => {
                try {
                    await this.context.suspend();
                    this.#status = 'suspended';
                } catch (error) {
                    throw new AudioLifecycleError('audio.context.suspend-failed', 'Failed to suspend audio context', {
                        cause: error instanceof Error ? error : new Error(String(error)),
                    });
                }
            }
        );
    }

    async resume(): Promise<void> {
        this.#assertNotDisposed();
        await this.#withRetry(
            this.#resumeRetryPolicy,
            (attempt) => ({ operation: 'context.resume', attempt }),
            async () => {
                try {
                    await this.context.resume();
                    this.#status = 'running';
                } catch (error) {
                    throw new AudioLifecycleError('audio.context.resume-failed', 'Failed to resume audio context', {
                        cause: error instanceof Error ? error : new Error(String(error)),
                    });
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
        this.#clipCache.clear();
        this.#registeredClips.clear();
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

    #syncListenerToContext(): void {
        const listener = this.#activeListenerId ? this.#listeners.get(this.#activeListenerId) : undefined;
        const target = listener && listener.enabled ? listener : undefined;
        const position = target?.position ?? DEFAULT_LISTENER_POSITION;
        const forward = target?.forward ?? DEFAULT_LISTENER_FORWARD;
        const up = target?.up ?? DEFAULT_LISTENER_UP;
        const audioListener = this.context.listener;

        if ('positionX' in audioListener) {
            audioListener.positionX.value = position.x;
            audioListener.positionY.value = position.y;
            audioListener.positionZ.value = position.z;
            audioListener.forwardX.value = forward.x;
            audioListener.forwardY.value = forward.y;
            audioListener.forwardZ.value = forward.z;
            audioListener.upX.value = up.x;
            audioListener.upY.value = up.y;
            audioListener.upZ.value = up.z;
            return;
        }

        (audioListener as AudioListener & {
            setPosition?: (x: number, y: number, z: number) => void;
            setOrientation?: (
                fx: number,
                fy: number,
                fz: number,
                ux: number,
                uy: number,
                uz: number
            ) => void;
        }).setPosition?.(position.x, position.y, position.z);
        (audioListener as AudioListener & {
            setPosition?: (x: number, y: number, z: number) => void;
            setOrientation?: (
                fx: number,
                fy: number,
                fz: number,
                ux: number,
                uy: number,
                uz: number
            ) => void;
        }).setOrientation?.(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }

    #syncSource(source: InternalSource<TSchema>): void {
        if (!source.active) {
            return;
        }

        source.active.gainNode.gain.value = source.muted ? 0 : source.volume;
        source.active.sourceNode.playbackRate.value = source.playbackRate;
        source.active.sourceNode.detune.value = source.detuneCents;

        const listener = this.#activeListenerId ? this.#listeners.get(this.#activeListenerId) : undefined;
        if (!source.spatial) {
            source.active.attenuationNode.gain.value = 1;
            if (source.active.spatialNode instanceof StereoPannerNode) {
                source.active.spatialNode.pan.value = source.pan;
            }
            return;
        }

        if (source.spatial.mode === '2d') {
            const position = normalizeVector3(source.spatial.position, DEFAULT_LISTENER_POSITION);
            const listenerPosition = listener?.position ?? DEFAULT_LISTENER_POSITION;
            source.active.attenuationNode.gain.value = listener?.enabled
                ? attenuationGainForDistance(distance2D(position, listenerPosition), source.spatial.attenuation)
                : 1;
            if (source.active.spatialNode instanceof StereoPannerNode) {
                source.active.spatialNode.pan.value = effectivePanFor2D(
                    position,
                    listenerPosition,
                    source.pan + (source.spatial.pan ?? 0),
                    source.spatial.attenuation
                );
            }
            return;
        }

        const position = normalizeVector3(source.spatial.position, DEFAULT_LISTENER_POSITION);
        const orientation = normalizeVector3(
            source.spatial.orientation,
            DEFAULT_LISTENER_FORWARD
        );
        const listenerPosition = listener?.position ?? DEFAULT_LISTENER_POSITION;
        source.active.attenuationNode.gain.value = listener?.enabled
            ? attenuationGainForDistance(distance3D(position, listenerPosition), source.spatial.attenuation)
            : 1;
        if (source.active.spatialNode instanceof PannerNode) {
            this.#applyPannerState(source.active.spatialNode, source.spatial, position, orientation);
        }
    }

    #syncAllSources(): void {
        for (const source of this.#sources.values()) {
            this.#syncSource(source);
        }
    }

    #applyPannerState(
        panner: PannerNode,
        spatial: Audio3DSpatialization,
        position: AudioVector3,
        orientation: AudioVector3
    ): void {
        panner.panningModel = spatial.panningModel ?? 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 1;
        panner.maxDistance = 1000000;
        panner.rolloffFactor = 0;
        panner.coneInnerAngle = spatial.coneInnerAngle ?? 360;
        panner.coneOuterAngle = spatial.coneOuterAngle ?? 360;
        panner.coneOuterGain = spatial.coneOuterGain ?? 0;

        if ('positionX' in panner) {
            panner.positionX.value = position.x;
            panner.positionY.value = position.y;
            panner.positionZ.value = position.z;
            panner.orientationX.value = orientation.x;
            panner.orientationY.value = orientation.y;
            panner.orientationZ.value = orientation.z;
            return;
        }

        (panner as PannerNode & {
            setPosition?: (x: number, y: number, z: number) => void;
            setOrientation?: (x: number, y: number, z: number) => void;
        }).setPosition?.(position.x, position.y, position.z);
        (panner as PannerNode & {
            setPosition?: (x: number, y: number, z: number) => void;
            setOrientation?: (x: number, y: number, z: number) => void;
        }).setOrientation?.(orientation.x, orientation.y, orientation.z);
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

    #normalizeOffset(
        offsetSeconds: number,
        clip: AudioClipRecord<TSchema>,
        loop: boolean
    ): number {
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

    async #resolveClipSelector(selector: AudioClipSelector<TSchema>): Promise<AudioClipRecord<TSchema>> {
        const cacheKey = this.#clipCacheKeyForSelector(selector);
        const useCache = cacheKey !== undefined;
        if (useCache) {
            const cached = this.#clipCache.get(cacheKey!);
            if (cached) {
                return cached;
            }
        }

        const pending = this.#withRetry(
            this.#assetRetryPolicy,
            (attempt) => ({ operation: 'asset.resolve', attempt, clip: selector }),
            async () => this.#decodeClipSelector(selector)
        );
        if (useCache) {
            this.#clipCache.set(cacheKey!, pending);
        }

        try {
            return await pending;
        } catch (error) {
            if (useCache) {
                this.#clipCache.delete(cacheKey!);
            }
            throw error;
        }
    }

    async #decodeClipSelector(selector: AudioClipSelector<TSchema>): Promise<AudioClipRecord<TSchema>> {
        switch (selector.kind) {
            case 'registered': {
                const registered = this.#registeredClips.get(selector.clipId);
                if (!registered) {
                    throw new AudioAssetError(`Registered audio clip ${selector.clipId} does not exist`);
                }
                return this.#resolveClipSelector(registered);
            }
            case 'asset': {
                const resolved = await this.#resolveAssetClip(selector.selector);
                if (isAudioClipAssetRecord(resolved)) {
                    if (!isAudioClipAssetData(resolved.data)) {
                        throw new AudioAssetError('Resolved asset record does not contain audio clip data');
                    }
                    return this.#decodeClipData(selector, resolved.data, resolved.data.metadata);
                }

                return this.#decodeClipData(selector, resolved, resolved.metadata);
            }
            case 'inline':
                return this.#decodeClipData(selector, selector.clip, selector.clip.metadata);
            default:
                throw new AudioAssetError('Unsupported audio clip selector');
        }
    }

    async #resolveAssetClip(
        selector: AudioClipAssetSelector<TSchema>
    ): Promise<AssetRecord<TSchema> | AudioClipAssetData> {
        const fromResolver = await this.#assetResolver?.resolveClip(selector);
        if (fromResolver) {
            return fromResolver as AssetRecord<TSchema> | AudioClipAssetData;
        }

        const record = this.#assetDatabase?.get(selector);
        if (!record) {
            throw new AudioAssetError(`Audio asset could not be resolved for selector ${JSON.stringify(selector)}`);
        }
        return record;
    }

    async #decodeClipData(
        selector: AudioClipSelector<TSchema>,
        data: AudioClipAssetData,
        metadata?: Readonly<Record<string, AudioJsonValue>>
    ): Promise<AudioClipRecord<TSchema>> {
        let buffer: AudioBuffer;
        switch (data.kind) {
            case 'buffer':
                buffer = data.buffer;
                break;
            case 'pcm':
                buffer = this.#createBufferFromPcm(data);
                break;
            case 'encoded':
                buffer = await this.context.decodeAudioData(this.#toArrayBuffer(data.data));
                break;
            case 'url': {
                const response = await fetch(data.url, {
                    credentials: data.credentials,
                    headers: data.headers,
                });
                if (!response.ok) {
                    throw new AudioAssetError(`Failed to fetch audio clip ${data.url}`);
                }
                buffer = await this.context.decodeAudioData(await response.arrayBuffer());
                break;
            }
            default:
                throw new AudioAssetError('Unsupported audio clip asset data');
        }

        return Object.freeze({
            id: normalizeAudioClipId(this.#clipCacheKeyForSelector(selector) ?? `clip:${++this.#bufferCacheSequence}`),
            selector,
            buffer,
            durationSeconds: buffer.duration,
            sampleRate: buffer.sampleRate,
            channelCount: buffer.numberOfChannels,
            loopStartSeconds: data.loopStartSeconds,
            loopEndSeconds: data.loopEndSeconds,
            metadata: cloneMetadata(metadata),
        });
    }

    #createBufferFromPcm(data: Extract<AudioClipAssetData, { kind: 'pcm' }>): AudioBuffer {
        const frameLength = data.channelData[0]?.length ?? 0;
        const buffer = this.context.createBuffer(data.channelData.length, frameLength, data.sampleRate);
        data.channelData.forEach((channel, index) => {
            buffer.copyToChannel(channel, index);
        });
        return buffer;
    }

    #toArrayBuffer(value: ArrayBuffer | ArrayBufferView): ArrayBuffer {
        if (value instanceof ArrayBuffer) {
            return value.slice(0);
        }

        const view = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        return view.slice().buffer;
    }

    #clipCacheKeyForSelector(selector: AudioClipSelector<TSchema>): string | undefined {
        switch (selector.kind) {
            case 'registered':
                return `registered:${selector.clipId}`;
            case 'asset':
                return this.#assetSelectorCacheKey(selector.selector);
            case 'inline':
                switch (selector.clip.kind) {
                    case 'buffer': {
                        const cached = this.#bufferCacheKeys.get(selector.clip.buffer);
                        if (cached) {
                            return cached;
                        }
                        const key = `buffer:${++this.#bufferCacheSequence}`;
                        this.#bufferCacheKeys.set(selector.clip.buffer, key);
                        return key;
                    }
                    case 'url':
                        return `url:${selector.clip.url}`;
                    default:
                        return undefined;
                }
            default:
                return undefined;
        }
    }

    #assetSelectorCacheKey(selector: AudioClipAssetSelector<TSchema>): string {
        if (typeof selector === 'string') {
            return `asset:string:${selector}`;
        }
        if (isObject(selector) && 'token' in selector && typeof selector.token === 'string') {
            return `asset:token:${selector.token}`;
        }
        if (isObject(selector) && 'id' in selector && 'revision' in selector) {
            return `asset:record:${String(selector.id)}:${String(selector.revision)}`;
        }
        if (isObject(selector) && 'key' in selector && typeof selector.key === 'string') {
            return `asset:key:${selector.key}:${'kind' in selector ? String(selector.kind ?? '') : ''}`;
        }
        return `asset:json:${JSON.stringify(selector)}`;
    }

    async #withRetry<TResult>(
        policy: AudioRetryPolicy<TSchema> | undefined,
        contextFactory: (attempt: number) => AudioRetryContext<TSchema>,
        operation: () => Promise<TResult>
    ): Promise<TResult> {
        const attempts = Math.max(1, policy?.attempts ?? 1);
        let lastError: unknown;

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            try {
                return await operation();
            } catch (error) {
                lastError = error;
                const context = contextFactory(attempt);
                const shouldRetry = attempt < attempts && (policy?.shouldRetry?.(error, context) ?? true);
                if (!shouldRetry) {
                    throw error;
                }
                const backoff =
                    typeof policy?.backoffMs === 'function'
                        ? policy.backoffMs(attempt)
                        : (policy?.backoffMs ?? 0);
                await sleep(backoff);
            }
        }

        throw lastError;
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
            position: cloneAudioVector3(listener.position),
            forward: cloneAudioVector3(listener.forward),
            up: cloneAudioVector3(listener.up),
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
            currentOffsetSeconds: source.active ? this.#currentOffsetForSource(source) : source.currentOffsetSeconds,
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
        for (const listener of this.#listeners.values()) {
            if (listener.enabled) {
                listener.active = true;
                return listener.id;
            }
        }
        return undefined;
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
        for (const [id, bus] of this.#buses) {
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
        return new AudioConfigurationError(descriptor.code as any, resolveAudioMessage(descriptor, this.#locale, this.#messageResolver));
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

export class AudioComponentBinder<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly #listeners = new Set<AudioListenerComponent>();
    readonly #sources = new Set<AudioSourceComponent<TSchema>>();

    constructor(readonly system: AudioSystem<TSchema>) {}

    attachListener(component: AudioListenerComponent): this {
        this.#listeners.add(component);
        return this;
    }

    detachListener(component: AudioListenerComponent): boolean {
        return this.#listeners.delete(component);
    }

    attachSource(component: AudioSourceComponent<TSchema>): this {
        this.#sources.add(component);
        return this;
    }

    detachSource(component: AudioSourceComponent<TSchema>): boolean {
        return this.#sources.delete(component);
    }

    clear(): void {
        this.#listeners.clear();
        this.#sources.clear();
    }

    async update(): Promise<void> {
        for (const listener of this.#listeners) {
            this.system.upsertListener(listener.toDescriptor());
            if (listener.active) {
                this.system.setActiveListener(listener.listenerId);
            }
        }

        for (const source of this.#sources) {
            const state = this.system.upsertSource(source.toDescriptor());
            source.syncState(state);
            const commands = source.consumeCommands();
            for (const command of commands) {
                await this.#dispatchSourceCommand(source, command);
            }
        }

        this.system.refreshSpatialAudio();
    }

    async #dispatchSourceCommand(
        component: AudioSourceComponent<TSchema>,
        command: AudioSourceComponentCommand<TSchema>
    ): Promise<void> {
        switch (command.kind) {
            case 'play':
                component.syncState(await this.system.playSource(component.sourceId, command.request).then(() => this.system.getSource(component.sourceId)!));
                break;
            case 'pause':
                this.system.pauseSource(component.sourceId);
                break;
            case 'resume':
                component.syncState(await this.system.resumeSource(component.sourceId).then(() => this.system.getSource(component.sourceId)!));
                break;
            case 'stop':
                this.system.stopSource(component.sourceId, command.options);
                break;
        }
    }
}