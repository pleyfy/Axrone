import {
    AnimationController,
    type AnimationClipDefinition,
    type AnimationControllerEvent,
    type AnimationClipEventDefinition,
    type AnimationClipStreamingDefinition,
    type AnimationFrame,
    type AnimationFootContactDefinition,
    type AnimationLayerDefinition,
    type AnimationMotionFeatureDefinition,
    type AnimationParameterDefinition,
    type AnimationClipCompressionDefinition,
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
}

interface AnimatorResolvedTarget {
    readonly transform?: Transform;
    readonly meshRenderer?: MeshRenderer;
    readonly parentNodeId?: string | null;
}

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
            .filter((clip) => clip.tracks.length > 0)
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
    private _controllerDirty = true;
    private _currentClipId: string | null = null;
    private _playOnStart: boolean;
    private _playing: boolean;
    private _loop: boolean;
    private _speed: number;
    private _time: number;
    private readonly _tempVec3 = new Vec3();
    private readonly _tempQuat = new Quat();

    constructor(config: AnimatorConfig = {}) {
        super();
        this._playOnStart = config.playOnStart ?? true;
        this._playing = config.playing ?? false;
        this._loop = config.loop ?? true;
        this._speed = Number.isFinite(config.speed ?? 1) ? config.speed ?? 1 : 1;
        this._time = Number.isFinite(config.time ?? 0) ? Math.max(0, config.time ?? 0) : 0;
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
                this._applyFrame(this._controller.currentFrame);
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
            this._applyFrame(controller.currentFrame);
        }
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
        this._applyFrame(controller.currentFrame);
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
                this._applyFrame(controller.currentFrame);
            }
        }
        return this;
    }

    seek(time: number): this {
        this.time = time;
        return this;
    }

    setFloat(name: string, value: number): this {
        const controller = this._ensureController();
        if (controller) {
            controller.parameters.setFloat(name, value);
            this._applyFrame(controller.evaluate());
        }
        return this;
    }

    setInt(name: string, value: number): this {
        const controller = this._ensureController();
        if (controller) {
            controller.parameters.setInt(name, value);
            this._applyFrame(controller.evaluate());
        }
        return this;
    }

    setBool(name: string, value: boolean): this {
        const controller = this._ensureController();
        if (controller) {
            controller.parameters.setBool(name, value);
            this._applyFrame(controller.evaluate());
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
            controller.crossFade(stateId, durationSeconds);
            this._applyFrame(controller.currentFrame);
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
        this._applyFrame(controller.currentFrame);
    }

    override update(deltaTime: number): void {
        const controller = this._ensureController();
        if (!controller || !this._playing) {
            return;
        }
        const deltaSeconds = Math.max(0, deltaTime / 1000) * this._speed;
        const result = controller.update(deltaSeconds);
        this._time += deltaSeconds;
        this._applyFrame(result.frame);
        this._applyRootMotion(result.rootMotion);
        this._emitAnimationEvents(result.events);
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
            profile: controller?.profile ?? null,
            pendingEvents: controller?.events ?? [],
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
            this._controllerDirty = false;
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
            rootMotion: this._rootMotion,
        });
        if (this._currentClipId) {
            try {
                this._controller.play(this._currentClipId);
            } catch {}
        }
        if (this._time > 0) {
            this._controller.seek(this._time);
        }
        this._controllerDirty = false;
        this._applyFrame(this._controller.currentFrame);
        return this._controller;
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

    private _rebuildTargetMap(instanceId: string | null): void {
        this._resolvedTargets.clear();
        this._resolvedInstanceId = instanceId;
        const actors =
            (this.world as {
                getAllActors?: () => readonly {
                    parent?: { getComponent: (type: unknown) => unknown } | null;
                    getComponent: (type: unknown) => unknown;
                }[];
            } | undefined)?.getAllActors?.() ?? [];

        for (let actorIndex = 0; actorIndex < actors.length; actorIndex += 1) {
            const actor = actors[actorIndex]!;
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
            const parentBinding = actor.parent?.getComponent(PrefabNodeBinding) as
                | PrefabNodeBinding
                | undefined;
            const parentNodeId =
                parentBinding && (!instanceId || parentBinding.instanceId === instanceId)
                    ? parentBinding.nodeId
                    : null;
            this._resolvedTargets.set(
                binding.nodeId,
                Object.freeze({
                    ...(transform ? { transform } : {}),
                    ...(meshRenderer ? { meshRenderer } : {}),
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