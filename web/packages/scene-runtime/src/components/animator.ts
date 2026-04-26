import {
    AnimationController,
    applyAnimationClipStreamingChunkDefinition,
    decodeAnimationClipStreamingChunkPayload,
    type AnimationClipDefinition,
    type AnimationControllerEvent,
    type AnimationClipStreamingChunkApplicationOptions,
    type AnimationClipStreamingChunkPayload,
    type AnimationStreamingSnapshot,
    type AnimationClipEventDefinition,
    type AnimationClipStreamingDefinition,
    type AnimationClipStreamingRequest,
    type AnimationFrame,
    type AnimationFootContactDefinition,
    type AnimationLayerDefinition,
    type AnimationMotionFeatureDefinition,
    type AnimationParameterDefinition,
    type AnimationClipCompressionDefinition,
    AnimationClipStreamingScheduler,
    type AnimationRootMotionDefinition,
    type AnimationRootMotionDelta,
    type AnimationTrackDefinition,
} from '@axrone/animation';
import { Quat, Vec3 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';
import { MeshRenderer } from './mesh-renderer';
import { PrefabNodeBinding } from './prefab-node-binding';

export interface AnimatorTrackConfig {
    readonly targetNodeId?: string;
    readonly target?: string;
    readonly path: 'translation' | 'rotation' | 'scale' | 'weights';
    readonly interpolation?: 'LINEAR' | 'STEP' | 'CUBICSPLINE';
    readonly keyframeCount?: number;
    readonly valueComponentCount?: number;
    readonly sampleStride?: number;
    readonly times: readonly number[] | Float32Array;
    readonly values: readonly number[] | Float32Array;
}

export interface AnimatorClipConfig {
    readonly id: string;
    readonly duration?: number;
    readonly tracks: readonly AnimatorTrackConfig[];
    readonly events?: readonly AnimationClipEventDefinition[];
    readonly footContacts?: readonly AnimationFootContactDefinition[];
    readonly tags?: readonly string[];
    readonly features?: readonly AnimationMotionFeatureDefinition[];
    readonly compression?: AnimationClipCompressionDefinition;
    readonly streaming?: AnimationClipStreamingDefinition;
}

export type AnimatorUpdateMode = 'Normal' | 'Animate Physics' | 'Unscaled Time';
export type AnimatorCullingMode = 'Always Animate' | 'Cull Update Transforms' | 'Cull Completely';

const ANIMATOR_UPDATE_MODES = new Set<AnimatorUpdateMode>([
    'Normal',
    'Animate Physics',
    'Unscaled Time',
]);

const ANIMATOR_CULLING_MODES = new Set<AnimatorCullingMode>([
    'Always Animate',
    'Cull Update Transforms',
    'Cull Completely',
]);

const normalizeAnimatorUpdateMode = (value: unknown): AnimatorUpdateMode =>
    typeof value === 'string' && ANIMATOR_UPDATE_MODES.has(value as AnimatorUpdateMode)
        ? (value as AnimatorUpdateMode)
        : 'Normal';

const normalizeAnimatorCullingMode = (value: unknown): AnimatorCullingMode =>
    typeof value === 'string' && ANIMATOR_CULLING_MODES.has(value as AnimatorCullingMode)
        ? (value as AnimatorCullingMode)
        : 'Cull Update Transforms';

export interface AnimatorConfig {
    readonly clips?: readonly AnimatorClipConfig[];
    readonly parameters?: readonly AnimationParameterDefinition[];
    readonly layers?: readonly AnimationLayerDefinition[];
    readonly rootMotion?: AnimationRootMotionDefinition | null;
    readonly clipId?: string | null;
    readonly playOnStart?: boolean;
    readonly playing?: boolean;
    readonly loop?: boolean;
    readonly speed?: number;
    readonly time?: number;
    readonly applyRootMotion?: boolean;
    readonly updateMode?: AnimatorUpdateMode;
    readonly cullingMode?: AnimatorCullingMode;
}

interface AnimatorResolvedTarget {
    readonly transform?: Transform;
    readonly meshRenderer?: MeshRenderer;
    readonly parentNodeId?: string | null;
}

type AnimatorEvaluationMode = 'apply' | 'update-only' | 'skip';

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && Array.isArray(value) === false;

const toTrackDefinition = (track: AnimatorTrackConfig): AnimationTrackDefinition => {
    const target =
        typeof track.targetNodeId === 'string'
            ? track.targetNodeId
            : typeof track.target === 'string'
              ? track.target
              : '';
    return Object.freeze({
        target,
        path: track.path,
        interpolation: track.interpolation,
        keyframeCount: track.keyframeCount,
        valueComponentCount: track.valueComponentCount,
        sampleStride: track.sampleStride,
        times: track.times instanceof Float32Array ? new Float32Array(track.times) : [...track.times],
        values:
            track.values instanceof Float32Array ? new Float32Array(track.values) : [...track.values],
    });
};

const normalizeClipDefinitions = (
    clips: readonly AnimatorClipConfig[] | undefined
): readonly AnimationClipDefinition[] =>
    Object.freeze(
        (clips ?? [])
            .filter((clip): clip is AnimatorClipConfig =>
                Boolean(clip && typeof clip.id === 'string' && Array.isArray(clip.tracks))
            )
            .map((clip) =>
                Object.freeze({
                    id: clip.id,
                    duration: clip.duration,
                    ...(Array.isArray(clip.events) ? { events: cloneSerializable(clip.events) } : {}),
                    ...(Array.isArray(clip.footContacts)
                        ? { footContacts: cloneSerializable(clip.footContacts) }
                        : {}),
                    ...(Array.isArray(clip.tags) ? { tags: [...clip.tags] } : {}),
                    ...(Array.isArray(clip.features) ? { features: cloneSerializable(clip.features) } : {}),
                    ...(clip.compression ? { compression: cloneSerializable(clip.compression) } : {}),
                    ...(clip.streaming ? { streaming: cloneSerializable(clip.streaming) } : {}),
                    tracks: Object.freeze(
                        clip.tracks
                            .map((track) => toTrackDefinition(track))
                            .filter((track) => typeof track.target === 'string' && track.target.length > 0)
                    ),
                } satisfies AnimationClipDefinition)
            )
            .filter((clip) => clip.tracks.length > 0 || clip.streaming?.mode === 'streamed')
    );

const cloneSerializable = <T>(value: T): T => {
    if (Array.isArray(value)) {
        return value.map((entry) => cloneSerializable(entry)) as T;
    }
    if (value instanceof Float32Array) {
        return new Float32Array(value) as T;
    }
    if (!isRecord(value)) {
        return value;
    }
    const cloned: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        cloned[key] = cloneSerializable(entry);
    }
    return cloned as T;
};

@script({
    scriptName: 'Animator',
    priority: 800,
    executeInEditMode: true,
    singleton: false,
})
export class Animator extends Component {
    private _clipDefinitions: readonly AnimationClipDefinition[] = Object.freeze([]);
    private _parameterDefinitions: readonly AnimationParameterDefinition[] = Object.freeze([]);
    private _layerDefinitions: readonly AnimationLayerDefinition[] | null = null;
    private _rootMotion: AnimationRootMotionDefinition | null = null;
    private readonly _resolvedTargets = new Map<string, AnimatorResolvedTarget>();
    private _resolvedInstanceId: string | null = null;
    private _controller: AnimationController | null = null;
    private _streamingScheduler: AnimationClipStreamingScheduler | null = null;
    private _streamingSnapshot: AnimationStreamingSnapshot | null = null;
    private _pendingStreamingRequests: readonly AnimationClipStreamingRequest[] = Object.freeze([]);
    private _controllerDirty = true;
    private _currentClipId: string | null = null;
    private _playOnStart: boolean;
    private _playing: boolean;
    private _loop: boolean;
    private _speed: number;
    private _time: number;
    private _applyRootMotionEnabled: boolean;
    private _updateMode: AnimatorUpdateMode;
    private _cullingMode: AnimatorCullingMode;
    private readonly _tempVec3 = new Vec3();
    private readonly _tempQuat = new Quat();

    constructor(config: AnimatorConfig = {}) {
        super();
        this._playOnStart = config.playOnStart ?? true;
        this._playing = config.playing ?? false;
        this._loop = config.loop ?? true;
        this._speed = Number.isFinite(config.speed ?? 1) ? config.speed ?? 1 : 1;
        this._time = Number.isFinite(config.time ?? 0) ? Math.max(0, config.time ?? 0) : 0;
        this._applyRootMotionEnabled = config.applyRootMotion ?? true;
        this._updateMode = normalizeAnimatorUpdateMode(config.updateMode);
        this._cullingMode = normalizeAnimatorCullingMode(config.cullingMode);
        this._applyConfig(config);
    }

    get clipId(): string | null {
        return this._currentClipId;
    }

    set clipId(value: string | null) {
        const fallback = this._clipDefinitions[0]?.id ?? null;
        this._currentClipId =
            typeof value === 'string' && this._clipDefinitions.some((clip) => clip.id === value)
                ? value
                : fallback;
        if (this._controller && this._currentClipId) {
            try {
                this._controller.play(this._currentClipId);
                const streaming = this._syncStreamingState(this._controller);
                if (!this._isStreamingBlocked(streaming)) {
                    this._applyFrame(this._controller.currentFrame);
                }
            } catch {}
        }
    }

    get playing(): boolean {
        return this._playing;
    }

    set playing(value: boolean) {
        this._playing = value;
    }

    get loop(): boolean {
        return this._loop;
    }

    set loop(value: boolean) {
        if (this._loop !== value) {
            this._loop = value;
            if (this._layerDefinitions === null) {
                this._controllerDirty = true;
            }
        }
    }

    get speed(): number {
        return this._speed;
    }

    set speed(value: number) {
        this._speed = Number.isFinite(value) ? value : 1;
    }

    get time(): number {
        return this._time;
    }

    set time(value: number) {
        this._time = Number.isFinite(value) ? Math.max(0, value) : 0;
        const controller = this._ensureController();
        if (controller) {
            controller.seek(this._time);
            const streaming = this._syncStreamingState(controller);
            if (!this._isStreamingBlocked(streaming)) {
                this._applyFrame(controller.currentFrame);
            }
        }
    }

    get applyRootMotion(): boolean {
        return this._applyRootMotionEnabled;
    }

    set applyRootMotion(value: boolean) {
        if (this._applyRootMotionEnabled === value) {
            return;
        }
        this._applyRootMotionEnabled = value;
        this._controllerDirty = true;
        this._controller = null;
        this._streamingScheduler = null;
        this._streamingSnapshot = null;
        this._pendingStreamingRequests = Object.freeze([]);
    }

    get updateMode(): AnimatorUpdateMode {
        return this._updateMode;
    }

    set updateMode(value: AnimatorUpdateMode) {
        this._updateMode = normalizeAnimatorUpdateMode(value);
    }

    get cullingMode(): AnimatorCullingMode {
        return this._cullingMode;
    }

    set cullingMode(value: AnimatorCullingMode) {
        this._cullingMode = normalizeAnimatorCullingMode(value);
    }

    get streaming(): AnimationStreamingSnapshot | null {
        return this._streamingSnapshot;
    }

    get pendingStreamingRequests(): readonly AnimationClipStreamingRequest[] {
        return this._pendingStreamingRequests;
    }

    play(clipId: string | null = this._currentClipId ?? this._clipDefinitions[0]?.id ?? null): this {
        if (!clipId) {
            return this;
        }
        const controller = this._ensureController();
        if (!controller) {
            return this;
        }
        this._currentClipId = clipId;
        this._playing = true;
        try {
            controller.play(clipId);
        } catch {}
        if (this._time > 0) {
            controller.seek(this._time);
        }
        const streaming = this._syncStreamingState(controller);
        if (!this._isStreamingBlocked(streaming)) {
            this._applyFrame(controller.currentFrame);
        }
        return this;
    }

    pause(): this {
        this._playing = false;
        return this;
    }

    stop(resetTime: boolean = true): this {
        this._playing = false;
        if (resetTime) {
            this._time = 0;
            const controller = this._ensureController();
            if (controller) {
                if (this._currentClipId) {
                    try {
                        controller.play(this._currentClipId);
                    } catch {}
                }
                controller.seek(0);
                const streaming = this._syncStreamingState(controller);
                if (!this._isStreamingBlocked(streaming)) {
                    this._applyFrame(controller.currentFrame);
                }
            }
        }
        return this;
    }

    seek(time: number): this {
        this.time = time;
        return this;
    }

    markStreamingChunkRequested(clipId: string, chunkIdOrUri: string): this {
        if (this._streamingScheduler?.markChunkRequested(clipId, chunkIdOrUri)) {
            this._syncStreamingState(this._controller);
        }
        return this;
    }

    markStreamingChunkLoaded(clipId: string, chunkIdOrUri: string): this {
        if (this._streamingScheduler?.markChunkLoaded(clipId, chunkIdOrUri)) {
            const streaming = this._syncStreamingState(this._controller);
            if (this._controller && !this._isStreamingBlocked(streaming)) {
                this._applyFrame(this._controller.evaluate());
            }
        }
        return this;
    }

    applyStreamingChunkBytes(
        clipId: string,
        bytes: string | Uint8Array | ArrayBuffer | ArrayBufferView,
        options: AnimationClipStreamingChunkApplicationOptions = {}
    ): this {
        return this.applyStreamingChunkPayload(
            clipId,
            decodeAnimationClipStreamingChunkPayload(bytes),
            options
        );
    }

    applyStreamingChunkPayload(
        clipId: string,
        payload: AnimationClipStreamingChunkPayload,
        options: AnimationClipStreamingChunkApplicationOptions = {}
    ): this {
        const clipIndex = this._clipDefinitions.findIndex((clip) => clip.id === clipId);
        if (clipIndex < 0) {
            return this;
        }

        const appliedDefinition = applyAnimationClipStreamingChunkDefinition(
            this._clipDefinitions[clipIndex]!,
            payload,
            {
                clipId,
                ...options,
            }
        );
        const definitions = [...this._clipDefinitions];
        definitions[clipIndex] = appliedDefinition;
        this._clipDefinitions = Object.freeze(definitions);

        const runtimeClip = this._controller?.clips.get(clipId);
        if (runtimeClip) {
            runtimeClip.applyStreamingChunk(payload, {
                clipId,
                ...options,
            });
        }
        return this;
    }

    markStreamingChunkFailed(clipId: string, chunkIdOrUri: string, error?: string): this {
        if (this._streamingScheduler?.markChunkFailed(clipId, chunkIdOrUri, error)) {
            this._syncStreamingState(this._controller);
        }
        return this;
    }

    resetStreaming(clipId?: string): this {
        this._streamingScheduler?.reset(clipId);
        this._streamingSnapshot = null;
        this._pendingStreamingRequests = Object.freeze([]);
        return this;
    }

    setFloat(name: string, value: number): this {
        const controller = this._ensureController();
        if (controller) {
            controller.parameters.setFloat(name, value);
            const frame = controller.evaluate();
            const streaming = this._syncStreamingState(controller);
            if (!this._isStreamingBlocked(streaming)) {
                this._applyFrame(frame);
            }
        }
        return this;
    }

    setInt(name: string, value: number): this {
        const controller = this._ensureController();
        if (controller) {
            controller.parameters.setInt(name, value);
            const frame = controller.evaluate();
            const streaming = this._syncStreamingState(controller);
            if (!this._isStreamingBlocked(streaming)) {
                this._applyFrame(frame);
            }
        }
        return this;
    }

    setBool(name: string, value: boolean): this {
        const controller = this._ensureController();
        if (controller) {
            controller.parameters.setBool(name, value);
            const frame = controller.evaluate();
            const streaming = this._syncStreamingState(controller);
            if (!this._isStreamingBlocked(streaming)) {
                this._applyFrame(frame);
            }
        }
        return this;
    }

    setTrigger(name: string): this {
        const controller = this._ensureController();
        if (controller) {
            controller.parameters.setTrigger(name);
        }
        return this;
    }

    crossFade(stateId: string, durationSeconds: number): this {
        const controller = this._ensureController();
        if (controller) {
            this._currentClipId = stateId;
            controller.crossFade(stateId, durationSeconds);
            const streaming = this._syncStreamingState(controller);
            if (!this._isStreamingBlocked(streaming)) {
                this._applyFrame(controller.currentFrame);
            }
        }
        return this;
    }

    override start(): void {
        if (!this._currentClipId && this._clipDefinitions.length > 0) {
            this._currentClipId = this._clipDefinitions[0]!.id;
        }
        if (this._playOnStart && this._currentClipId) {
            this._playing = true;
        }
        const controller = this._ensureController();
        if (!controller) {
            return;
        }
        if (this._currentClipId) {
            try {
                controller.play(this._currentClipId);
            } catch {}
        }
        if (this._time > 0) {
            controller.seek(this._time);
        }
        const streaming = this._syncStreamingState(controller);
        if (!this._isStreamingBlocked(streaming)) {
            this._applyFrame(controller.currentFrame);
        }
    }

    override update(deltaTime: number): void {
        if (this._updateMode === 'Animate Physics') {
            return;
        }

        this._stepAnimation(deltaTime);
    }

    override fixedUpdate(deltaTime: number): void {
        if (this._updateMode !== 'Animate Physics') {
            return;
        }

        this._stepAnimation(deltaTime);
    }

    override serialize(): Record<string, unknown> {
        return {
            clips: this._clipDefinitions.map((clip) => ({
                id: clip.id,
                duration: clip.duration,
                ...(clip.events ? { events: cloneSerializable(clip.events) } : {}),
                ...(clip.footContacts ? { footContacts: cloneSerializable(clip.footContacts) } : {}),
                ...(clip.tags ? { tags: [...clip.tags] } : {}),
                ...(clip.features ? { features: cloneSerializable(clip.features) } : {}),
                ...(clip.compression ? { compression: cloneSerializable(clip.compression) } : {}),
                ...(clip.streaming ? { streaming: cloneSerializable(clip.streaming) } : {}),
                tracks: clip.tracks.map((track) => ({
                    targetNodeId: track.target,
                    path: track.path,
                    interpolation: track.interpolation,
                    keyframeCount: track.keyframeCount,
                    valueComponentCount: track.valueComponentCount,
                    sampleStride: track.sampleStride,
                    times: cloneSerializable(track.times),
                    values: cloneSerializable(track.values),
                })),
            })),
            parameters: cloneSerializable(this._parameterDefinitions),
            layers: this._layerDefinitions ? cloneSerializable(this._layerDefinitions) : null,
            rootMotion: this._rootMotion ? cloneSerializable(this._rootMotion) : null,
            clipId: this._currentClipId,
            playOnStart: this._playOnStart,
            playing: this._playing,
            loop: this._loop,
            speed: this._speed,
            time: this._time,
            applyRootMotion: this._applyRootMotionEnabled,
            updateMode: this._updateMode,
            cullingMode: this._cullingMode,
        };
    }

    override getDebugInfo(): Record<string, any> {
        const controller = this._ensureController();
        return {
            clipId: this._currentClipId,
            playing: this._playing,
            loop: this._loop,
            speed: this._speed,
            time: this._time,
            applyRootMotion: this._applyRootMotionEnabled,
            updateMode: this._updateMode,
            cullingMode: this._cullingMode,
            profile: controller?.profile ?? null,
            pendingEvents: controller?.events ?? [],
            activeClips: controller?.activeClips ?? [],
            streaming: this._streamingSnapshot,
            pendingStreamingRequests: this._pendingStreamingRequests,
        };
    }

    override deserialize(data: Record<string, any>): void {
        this._applyConfig({
            clips: Array.isArray(data.clips) ? data.clips : [],
            parameters: Array.isArray(data.parameters) ? data.parameters : [],
            layers: Array.isArray(data.layers) ? data.layers : undefined,
            rootMotion: isRecord(data.rootMotion) && typeof data.rootMotion.bone === 'string'
                ? (data.rootMotion as unknown as AnimationRootMotionDefinition)
                : data.rootMotion === null
                  ? null
                  : undefined,
            clipId: typeof data.clipId === 'string' || data.clipId === null ? data.clipId : undefined,
            playOnStart: typeof data.playOnStart === 'boolean' ? data.playOnStart : undefined,
            playing: typeof data.playing === 'boolean' ? data.playing : undefined,
            loop: typeof data.loop === 'boolean' ? data.loop : undefined,
            speed: typeof data.speed === 'number' ? data.speed : undefined,
            time: typeof data.time === 'number' ? data.time : undefined,
            applyRootMotion: typeof data.applyRootMotion === 'boolean' ? data.applyRootMotion : undefined,
            updateMode: typeof data.updateMode === 'string' ? normalizeAnimatorUpdateMode(data.updateMode) : undefined,
            cullingMode:
                typeof data.cullingMode === 'string'
                    ? normalizeAnimatorCullingMode(data.cullingMode)
                    : undefined,
        });
    }

    private _applyConfig(config: AnimatorConfig): void {
        this._clipDefinitions = normalizeClipDefinitions(config.clips);
        this._parameterDefinitions = Object.freeze(
            (config.parameters ?? []).filter(
                (entry): entry is AnimationParameterDefinition =>
                    Boolean(entry && typeof entry.name === 'string' && typeof entry.kind === 'string')
            )
        );
        this._layerDefinitions = Array.isArray(config.layers)
            ? (Object.freeze(config.layers.map((layer) => cloneSerializable(layer))) as readonly AnimationLayerDefinition[])
            : null;
        this._rootMotion = config.rootMotion ?? null;
        this._playOnStart = config.playOnStart ?? this._playOnStart;
        this._playing = config.playing ?? this._playing;
        this._loop = config.loop ?? this._loop;
        this._speed = Number.isFinite(config.speed ?? this._speed) ? config.speed ?? this._speed : 1;
        this._time = Number.isFinite(config.time ?? this._time) ? Math.max(0, config.time ?? this._time) : 0;
        this._applyRootMotionEnabled = config.applyRootMotion ?? this._applyRootMotionEnabled;
        this._updateMode =
            config.updateMode !== undefined
                ? normalizeAnimatorUpdateMode(config.updateMode)
                : this._updateMode;
        this._cullingMode =
            config.cullingMode !== undefined
                ? normalizeAnimatorCullingMode(config.cullingMode)
                : this._cullingMode;
        const fallbackClipId = this._clipDefinitions[0]?.id ?? null;
        this._currentClipId =
            typeof config.clipId === 'string' && this._clipDefinitions.some((clip) => clip.id === config.clipId)
                ? config.clipId
                : config.clipId === null
                  ? null
                  : this._currentClipId ?? fallbackClipId;
        if (!this._currentClipId && fallbackClipId) {
            this._currentClipId = fallbackClipId;
        }
        this._controllerDirty = true;
        this._controller = null;
        this._streamingScheduler = null;
        this._streamingSnapshot = null;
        this._pendingStreamingRequests = Object.freeze([]);
        this._resolvedTargets.clear();
        this._resolvedInstanceId = null;
    }

    private _ensureController(): AnimationController | null {
        const instanceId = this.actor?.getComponent(PrefabNodeBinding)?.instanceId ?? null;
        if (this._controller && !this._controllerDirty && this._resolvedInstanceId === instanceId) {
            return this._controller;
        }

        this._rebuildTargetMap(instanceId);
        if (this._clipDefinitions.length === 0 || this._resolvedTargets.size === 0) {
            this._controller = null;
            this._controllerDirty = this._clipDefinitions.length > 0;
            return null;
        }

        if (
            this._getRequiredRigTargetNodeIds().some(
                (targetNodeId) => !this._resolvedTargets.has(targetNodeId)
            )
        ) {
            this._controller = null;
            this._controllerDirty = true;
            return null;
        }

        const bones = [...this._resolvedTargets.entries()]
            .filter(([, target]) => Boolean(target.transform))
            .map(([nodeId, target]) => ({
                name: nodeId,
                parent: target.parentNodeId ?? null,
                translation: [
                    target.transform!.position.x,
                    target.transform!.position.y,
                    target.transform!.position.z,
                ] as const,
                rotation: [
                    target.transform!.rotation.x,
                    target.transform!.rotation.y,
                    target.transform!.rotation.z,
                    target.transform!.rotation.w,
                ] as const,
                scale: [
                    target.transform!.scale.x,
                    target.transform!.scale.y,
                    target.transform!.scale.z,
                ] as const,
            }));

        if (bones.length === 0) {
            this._controller = null;
            this._controllerDirty = false;
            return null;
        }

        const layers = this._layerDefinitions ?? this._buildDefaultLayers();
        this._controller = new AnimationController({
            rig: { bones },
            clips: this._clipDefinitions,
            parameters: this._parameterDefinitions,
            layers,
            rootMotion: this._applyRootMotionEnabled ? this._rootMotion : null,
        });
        if (this._currentClipId) {
            try {
                this._controller.play(this._currentClipId);
            } catch {}
        }
        if (this._time > 0) {
            this._controller.seek(this._time);
        }
        this._streamingScheduler = new AnimationClipStreamingScheduler(this._controller.clips);
        this._streamingSnapshot = null;
        this._pendingStreamingRequests = Object.freeze([]);
        this._controllerDirty = false;
        const streaming = this._syncStreamingState(this._controller);
        if (!this._isStreamingBlocked(streaming)) {
            this._applyFrame(this._controller.currentFrame);
        }
        return this._controller;
    }

    private _syncStreamingState(controller: AnimationController | null): AnimationStreamingSnapshot | null {
        if (!controller || !this._streamingScheduler) {
            this._streamingSnapshot = null;
            this._pendingStreamingRequests = Object.freeze([]);
            return null;
        }
        const snapshot = this._streamingScheduler.update(controller.activeClips);
        this._streamingSnapshot = snapshot;
        this._pendingStreamingRequests = this._collectPendingStreamingRequests(snapshot);
        if (snapshot.pendingRequests.length > 0) {
            this._emitStreamingRequests(snapshot.pendingRequests);
        }
        return snapshot;
    }

    private _collectPendingStreamingRequests(
        snapshot: AnimationStreamingSnapshot
    ): readonly AnimationClipStreamingRequest[] {
        return Object.freeze(
            snapshot.clips.flatMap((clip) =>
                clip.chunks
                    .filter((chunk) => chunk.status === 'requested')
                    .map((chunk) =>
                        Object.freeze({
                            clipId: chunk.clipId,
                            chunkId: chunk.chunkId,
                            uri: chunk.uri,
                            startTime: chunk.startTime,
                            endTime: chunk.endTime,
                            reason: chunk.lastRequestReason ?? (chunk.active ? 'active' : 'preload'),
                            priority: clip.priority,
                            weight: chunk.weight,
                            ...(chunk.mimeType ? { mimeType: chunk.mimeType } : {}),
                            ...(typeof chunk.byteOffset === 'number' ? { byteOffset: chunk.byteOffset } : {}),
                            ...(typeof chunk.byteLength === 'number' ? { byteLength: chunk.byteLength } : {}),
                        } satisfies AnimationClipStreamingRequest)
                    )
            )
        );
    }

    private _isStreamingBlocked(snapshot: AnimationStreamingSnapshot | null): boolean {
        if (!snapshot) {
            return false;
        }
        return snapshot.clips.some((clip) => clip.activeWeight > 0 && clip.ready === false);
    }

    private _buildDefaultLayers(): readonly AnimationLayerDefinition[] {
        const entryState = this._currentClipId ?? this._clipDefinitions[0]!.id;
        return Object.freeze([
            Object.freeze({
                id: 'base',
                weight: 1,
                mode: 'override',
                stateMachine: {
                    entryState,
                    states: Object.freeze(
                        this._clipDefinitions.map((clip) =>
                            Object.freeze({
                                id: clip.id,
                                motion: Object.freeze({
                                    kind: 'clip',
                                    clipId: clip.id,
                                }),
                                loop: this._loop,
                            })
                        )
                    ),
                },
            } satisfies AnimationLayerDefinition),
        ]);
    }

    private _stepAnimation(deltaTime: number): void {
        const controller = this._ensureController();
        if (!controller || !this._playing) {
            return;
        }

        const evaluationMode = this._resolveEvaluationMode();
        if (evaluationMode === 'skip') {
            return;
        }

        const streaming = this._syncStreamingState(controller);
        if (this._isStreamingBlocked(streaming)) {
            return;
        }

        const deltaSeconds = Math.max(0, deltaTime / 1000) * this._speed;
        const result = controller.update(deltaSeconds);
        this._time += deltaSeconds;

        if (evaluationMode === 'apply') {
            this._applyFrame(result.frame);
            if (this._applyRootMotionEnabled) {
                this._applyRootMotion(result.rootMotion);
            }
        }

        this._emitAnimationEvents(result.events);
        this._syncStreamingState(controller);
    }

    private _resolveEvaluationMode(): AnimatorEvaluationMode {
        if (this._cullingMode === 'Always Animate') {
            return 'apply';
        }

        if (this._hasVisibleRendererInHierarchy()) {
            return 'apply';
        }

        return this._cullingMode === 'Cull Completely' ? 'skip' : 'update-only';
    }

    private _hasVisibleRendererInHierarchy(): boolean {
        const rootActor = this.actor;
        if (!rootActor) {
            return true;
        }

        const stack = [rootActor];
        let hasRenderer = false;

        while (stack.length > 0) {
            const actor = stack.pop();
            if (!actor) {
                continue;
            }

            const meshRenderer = actor.getComponent(MeshRenderer) as MeshRenderer | undefined;
            if (meshRenderer) {
                hasRenderer = true;
                if (meshRenderer.visible) {
                    return true;
                }
            }

            for (let index = 0; index < actor.children.length; index += 1) {
                stack.push(actor.children[index]!);
            }
        }

        return hasRenderer === false;
    }

    private _emitAnimationEvents(events: readonly AnimationControllerEvent[]): void {
        if (events.length === 0) {
            return;
        }
        const world = this.world as
            | {
                  emitSync?: (event: string, data: Record<string, unknown>) => boolean;
              }
            | undefined;
        for (let index = 0; index < events.length; index += 1) {
            const event = events[index]!;
            world?.emitSync?.('animation:notify', {
                actorId: this.actor?.id,
                entity: this.entity,
                clipId: event.clipId,
                layerId: event.layerId,
                stateId: event.stateId,
                name: event.name,
                time: event.time,
                normalizedTime: event.normalizedTime,
                motionWeight: event.motionWeight,
                layerWeight: event.layerWeight,
                ...(event.id ? { id: event.id } : {}),
                ...(event.payload !== undefined ? { payload: event.payload } : {}),
                ...(event.tags ? { tags: event.tags } : {}),
            });
        }
    }

    private _emitStreamingRequests(requests: readonly AnimationClipStreamingRequest[]): void {
        if (requests.length === 0) {
            return;
        }
        const world = this.world as
            | {
                  emitSync?: (event: string, data: Record<string, unknown>) => boolean;
              }
            | undefined;
        for (let index = 0; index < requests.length; index += 1) {
            const request = requests[index]!;
            world?.emitSync?.('animation:streaming-request', {
                actorId: this.actor?.id,
                entity: this.entity,
                clipId: request.clipId,
                chunkId: request.chunkId,
                uri: request.uri,
                reason: request.reason,
                priority: request.priority,
                weight: request.weight,
                startTime: request.startTime,
                endTime: request.endTime,
                ...(request.mimeType ? { mimeType: request.mimeType } : {}),
                ...(typeof request.byteOffset === 'number' ? { byteOffset: request.byteOffset } : {}),
                ...(typeof request.byteLength === 'number' ? { byteLength: request.byteLength } : {}),
            });
        }
    }

    private _getRequiredTargetNodeIds(): readonly string[] {
        const nodeIds = new Set<string>();

        for (const clip of this._clipDefinitions) {
            for (const track of clip.tracks) {
                if (typeof track.target === 'string' && track.target.length > 0) {
                    nodeIds.add(track.target);
                }
            }
        }

        if (typeof this._rootMotion?.bone === 'string' && this._rootMotion.bone.length > 0) {
            nodeIds.add(this._rootMotion.bone);
        }

        for (const layer of this._layerDefinitions ?? []) {
            for (const boneName of layer.boneMask ?? []) {
                if (typeof boneName === 'string' && boneName.length > 0) {
                    nodeIds.add(boneName);
                }
            }

            for (const ikLayer of layer.ikLayers ?? []) {
                for (const job of ikLayer.jobs ?? []) {
                    nodeIds.add(job.rootBone);
                    nodeIds.add(job.tipBone);
                    if (typeof job.targetBone === 'string' && job.targetBone.length > 0) {
                        nodeIds.add(job.targetBone);
                    }
                }
            }
        }

        return Object.freeze([...nodeIds]);
    }

    private _getRequiredRigTargetNodeIds(): readonly string[] {
        const nodeIds = new Set<string>();

        for (const clip of this._clipDefinitions) {
            for (const track of clip.tracks) {
                if (
                    track.path !== 'weights' &&
                    typeof track.target === 'string' &&
                    track.target.length > 0
                ) {
                    nodeIds.add(track.target);
                }
            }
        }

        if (typeof this._rootMotion?.bone === 'string' && this._rootMotion.bone.length > 0) {
            nodeIds.add(this._rootMotion.bone);
        }

        for (const layer of this._layerDefinitions ?? []) {
            for (const boneName of layer.boneMask ?? []) {
                if (typeof boneName === 'string' && boneName.length > 0) {
                    nodeIds.add(boneName);
                }
            }

            for (const ikLayer of layer.ikLayers ?? []) {
                for (const job of ikLayer.jobs ?? []) {
                    nodeIds.add(job.rootBone);
                    nodeIds.add(job.tipBone);
                    if (typeof job.targetBone === 'string' && job.targetBone.length > 0) {
                        nodeIds.add(job.targetBone);
                    }
                }
            }
        }

        return Object.freeze([...nodeIds]);
    }

    private _rebuildTargetMap(instanceId: string | null): void {
        this._resolvedTargets.clear();
        this._resolvedInstanceId = instanceId;
        type TargetActor = {
            parent?: { getComponent: (type: unknown) => unknown } | null;
            children: readonly TargetActor[];
            getComponent: (type: unknown) => unknown;
        };
        const collectTargets = (
            actors: readonly TargetActor[],
        ): Array<{
            readonly actor: {
                parent?: { getComponent: (type: unknown) => unknown } | null;
                children: readonly unknown[];
                getComponent: (type: unknown) => unknown;
            };
            readonly nodeId: string;
            readonly binding: PrefabNodeBinding;
            readonly transform?: Transform;
            readonly meshRenderer?: MeshRenderer;
        }> => {
            const targets: Array<{
                readonly actor: TargetActor;
                readonly nodeId: string;
                readonly binding: PrefabNodeBinding;
                readonly transform?: Transform;
                readonly meshRenderer?: MeshRenderer;
            }> = [];
            const stack = [...actors];

            while (stack.length > 0) {
                const actor = stack.pop()!;
                for (let childIndex = 0; childIndex < actor.children.length; childIndex += 1) {
                    stack.push(actor.children[childIndex]!);
                }

                const binding = actor.getComponent(PrefabNodeBinding) as PrefabNodeBinding | undefined;
                if (!binding || binding.nodeId === null) {
                    continue;
                }
                if (instanceId && binding.instanceId !== instanceId) {
                    continue;
                }
                const transform = actor.getComponent(Transform) as Transform | undefined;
                const meshRenderer = actor.getComponent(MeshRenderer) as MeshRenderer | undefined;
                if (!transform && !meshRenderer) {
                    continue;
                }
                targets.push(
                    Object.freeze({
                        actor,
                        nodeId: binding.nodeId,
                        binding,
                        ...(transform ? { transform } : {}),
                        ...(meshRenderer ? { meshRenderer } : {}),
                    })
                );
            }

            return targets;
        };
        const rootActor = this.actor as TargetActor | undefined;
        const allActors =
            (this.world as { getAllActors?: () => readonly TargetActor[] } | undefined)
                ?.getAllActors?.() ?? [];
        const rootTargets = rootActor ? collectTargets([rootActor]) : [];
        const rootTargetNodeIds = new Set(rootTargets.map((target) => target.nodeId));
        const requiresInstanceFallback =
            Boolean(instanceId) &&
            rootTargets.length > 0 &&
            this._getRequiredTargetNodeIds().some((targetNodeId) => !rootTargetNodeIds.has(targetNodeId));
        const resolvedTargets =
            requiresInstanceFallback || rootTargets.length === 0
                ? collectTargets(allActors)
                : rootTargets;

        const resolvedNodeIds = new Set(
            resolvedTargets.map((entry) => entry.binding.nodeId).filter((nodeId): nodeId is string => Boolean(nodeId))
        );

        for (let targetIndex = 0; targetIndex < resolvedTargets.length; targetIndex += 1) {
            const target = resolvedTargets[targetIndex]!;
            const parentBinding = target.actor.parent?.getComponent(PrefabNodeBinding) as
                | PrefabNodeBinding
                | undefined;
            const parentNodeId =
                parentBinding &&
                resolvedNodeIds.has(parentBinding.nodeId ?? '') &&
                (!instanceId || parentBinding.instanceId === instanceId)
                    ? parentBinding.nodeId
                    : null;
            this._resolvedTargets.set(
                target.nodeId,
                Object.freeze({
                    ...(target.transform ? { transform: target.transform } : {}),
                    ...(target.meshRenderer ? { meshRenderer: target.meshRenderer } : {}),
                    parentNodeId,
                })
            );
        }
    }

    private _applyFrame(frame: AnimationFrame): void {
        const controller = this._controller;
        if (!controller) {
            return;
        }

        for (let boneIndex = 0; boneIndex < controller.rig.boneCount; boneIndex += 1) {
            const target = this._resolvedTargets.get(controller.rig.boneNames[boneIndex]!);
            if (!target?.transform) {
                continue;
            }
            const translationOffset = boneIndex * 3;
            const rotationOffset = boneIndex * 4;
            this._tempVec3.x = frame.pose.translations[translationOffset]!;
            this._tempVec3.y = frame.pose.translations[translationOffset + 1]!;
            this._tempVec3.z = frame.pose.translations[translationOffset + 2]!;
            target.transform.position = this._tempVec3;
            this._tempQuat.x = frame.pose.rotations[rotationOffset]!;
            this._tempQuat.y = frame.pose.rotations[rotationOffset + 1]!;
            this._tempQuat.z = frame.pose.rotations[rotationOffset + 2]!;
            this._tempQuat.w = frame.pose.rotations[rotationOffset + 3]!;
            target.transform.rotation = this._tempQuat;
            this._tempVec3.x = frame.pose.scales[translationOffset]!;
            this._tempVec3.y = frame.pose.scales[translationOffset + 1]!;
            this._tempVec3.z = frame.pose.scales[translationOffset + 2]!;
            target.transform.scale = this._tempVec3;
        }

        for (let bindingIndex = 0; bindingIndex < controller.curveLayout.bindings.length; bindingIndex += 1) {
            const binding = controller.curveLayout.bindings[bindingIndex]!;
            const target = this._resolvedTargets.get(binding.id);
            if (!target?.meshRenderer) {
                continue;
            }
            target.meshRenderer.setMorphWeights(
                frame.curves.values.subarray(binding.offset, binding.offset + binding.componentCount)
            );
        }
    }

    private _applyRootMotion(rootMotion: AnimationRootMotionDelta): void {
        const transform = this.transform as Transform | undefined;
        if (!transform) {
            return;
        }
        if (
            rootMotion.translation[0] !== 0 ||
            rootMotion.translation[1] !== 0 ||
            rootMotion.translation[2] !== 0
        ) {
            this._tempVec3.x = rootMotion.translation[0];
            this._tempVec3.y = rootMotion.translation[1];
            this._tempVec3.z = rootMotion.translation[2];
            transform.translate(this._tempVec3, 'local');
        }
        if (
            rootMotion.rotation[0] !== 0 ||
            rootMotion.rotation[1] !== 0 ||
            rootMotion.rotation[2] !== 0 ||
            rootMotion.rotation[3] !== 1
        ) {
            this._tempQuat.x = rootMotion.rotation[0];
            this._tempQuat.y = rootMotion.rotation[1];
            this._tempQuat.z = rootMotion.rotation[2];
            this._tempQuat.w = rootMotion.rotation[3];
            transform.rotate(this._tempQuat, 'local');
        }
    }
}
