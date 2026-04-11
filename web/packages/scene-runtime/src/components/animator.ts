import { Quat, Vec3 } from '@axrone/numeric';
import { Transform } from '@axrone/ecs-runtime';
import { Component } from '@axrone/ecs-runtime';
import { script } from '@axrone/ecs-runtime';
import { MeshRenderer } from './mesh-renderer';
import { PrefabNodeBinding } from './prefab-node-binding';

export interface AnimatorTrackConfig {
    readonly targetNodeId: string;
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
}

export interface AnimatorConfig {
    readonly clips?: readonly AnimatorClipConfig[];
    readonly clipId?: string | null;
    readonly playOnStart?: boolean;
    readonly playing?: boolean;
    readonly loop?: boolean;
    readonly speed?: number;
    readonly time?: number;
}

interface AnimatorTrackState {
    readonly targetNodeId: string;
    readonly path: AnimatorTrackConfig['path'];
    readonly interpolation: NonNullable<AnimatorTrackConfig['interpolation']>;
    readonly keyframeCount: number;
    readonly valueComponentCount: number;
    readonly sampleStride: number;
    readonly times: Float32Array;
    readonly values: Float32Array;
}

interface AnimatorClipState {
    readonly id: string;
    readonly duration: number;
    readonly tracks: readonly AnimatorTrackState[];
}

interface AnimatorResolvedTarget {
    readonly transform?: Transform;
    readonly meshRenderer?: MeshRenderer;
}

const toFloat32Array = (value: readonly number[] | Float32Array): Float32Array =>
    value instanceof Float32Array ? new Float32Array(value) : new Float32Array(value);

const wrapTime = (time: number, duration: number): number => {
    if (duration <= 0) {
        return 0;
    }

    const wrapped = time % duration;
    return wrapped < 0 ? wrapped + duration : wrapped;
};

const findFrameIndex = (times: Float32Array, time: number): number => {
    if (times.length <= 1 || time <= times[0]!) {
        return 0;
    }

    const lastIndex = times.length - 1;
    if (time >= times[lastIndex]!) {
        return Math.max(0, lastIndex - 1);
    }

    let low = 0;
    let high = lastIndex;
    while (low <= high) {
        const mid = (low + high) >> 1;
        const start = times[mid]!;
        const end = times[mid + 1] ?? Number.POSITIVE_INFINITY;
        if (time < start) {
            high = mid - 1;
            continue;
        }
        if (time >= end) {
            low = mid + 1;
            continue;
        }
        return mid;
    }

    return Math.max(0, Math.min(lastIndex - 1, low));
};

@script({
    scriptName: 'Animator',
    priority: 800,
    executeInEditMode: true,
    singleton: false,
})
export class Animator extends Component {
    private readonly _clips = new Map<string, AnimatorClipState>();
    private readonly _clipOrder: string[] = [];
    private readonly _resolvedTargets = new Map<string, AnimatorResolvedTarget>();
    private _resolvedInstanceId: string | null = null;
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
        this._speed = config.speed ?? 1;
        this._time = config.time ?? 0;
        this._setClips(config.clips ?? []);
        this._currentClipId = config.clipId ?? this._clipOrder[0] ?? null;
    }

    get clipId(): string | null {
        return this._currentClipId;
    }

    set clipId(value: string | null) {
        this._currentClipId = value && this._clips.has(value) ? value : this._clipOrder[0] ?? null;
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
        this._loop = value;
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
        this._time = Number.isFinite(value) ? value : 0;
        this._applyCurrentClip();
    }

    play(clipId: string | null = this._currentClipId ?? this._clipOrder[0] ?? null): this {
        if (!clipId || !this._clips.has(clipId)) {
            return this;
        }

        this._currentClipId = clipId;
        this._playing = true;
        this._applyCurrentClip();
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
            this._applyCurrentClip();
        }
        return this;
    }

    seek(time: number): this {
        const clip = this._getCurrentClip();
        if (!clip) {
            this._time = 0;
            return this;
        }

        this._time = this._loop ? wrapTime(time, clip.duration) : Math.max(0, Math.min(time, clip.duration));
        this._applyCurrentClip();
        return this;
    }

    override start(): void {
        if (!this._currentClipId && this._clipOrder.length > 0) {
            this._currentClipId = this._clipOrder[0]!;
        }

        if (this._playOnStart && this._currentClipId) {
            this._playing = true;
        }

        if (this._currentClipId) {
            this._applyCurrentClip();
        }
    }

    override update(deltaTime: number): void {
        if (!this._playing) {
            return;
        }

        const clip = this._getCurrentClip();
        if (!clip) {
            return;
        }

        if (clip.duration <= 0) {
            this._time = 0;
            this._applyCurrentClip();
            return;
        }

        const deltaSeconds = (deltaTime / 1000) * this._speed;
        const nextTime = this._time + deltaSeconds;
        if (this._loop) {
            this._time = wrapTime(nextTime, clip.duration);
        } else {
            const clamped = Math.max(0, Math.min(nextTime, clip.duration));
            this._time = clamped;
            if (clamped !== nextTime) {
                this._playing = false;
            }
        }

        this._applyCurrentClip();
    }

    override serialize(): Record<string, unknown> {
        return {
            clips: this._clipOrder
                .map((clipId) => this._clips.get(clipId))
                .filter((clip): clip is AnimatorClipState => Boolean(clip))
                .map((clip) => ({
                    id: clip.id,
                    duration: clip.duration,
                    tracks: clip.tracks.map((track) => ({
                        targetNodeId: track.targetNodeId,
                        path: track.path,
                        interpolation: track.interpolation,
                        keyframeCount: track.keyframeCount,
                        valueComponentCount: track.valueComponentCount,
                        sampleStride: track.sampleStride,
                        times: track.times,
                        values: track.values,
                    })),
                })),
            clipId: this._currentClipId,
            playOnStart: this._playOnStart,
            playing: this._playing,
            loop: this._loop,
            speed: this._speed,
            time: this._time,
        };
    }

    override deserialize(data: Record<string, any>): void {
        this._setClips(Array.isArray(data.clips) ? data.clips : []);
        this._currentClipId =
            typeof data.clipId === 'string' && this._clips.has(data.clipId)
                ? data.clipId
                : this._clipOrder[0] ?? null;
        if (typeof data.playOnStart === 'boolean') {
            this._playOnStart = data.playOnStart;
        }
        if (typeof data.playing === 'boolean') {
            this._playing = data.playing;
        }
        if (typeof data.loop === 'boolean') {
            this._loop = data.loop;
        }
        if (typeof data.speed === 'number' && Number.isFinite(data.speed)) {
            this._speed = data.speed;
        }
        if (typeof data.time === 'number' && Number.isFinite(data.time)) {
            this._time = data.time;
        }
        this._resolvedTargets.clear();
        this._resolvedInstanceId = null;
    }

    private _setClips(clips: readonly AnimatorClipConfig[]): void {
        this._clips.clear();
        this._clipOrder.length = 0;

        for (const clip of clips) {
            if (!clip || typeof clip.id !== 'string' || clip.id.length === 0) {
                continue;
            }

            const tracks = (clip.tracks ?? [])
                .map((track) => this._normalizeTrack(track))
                .filter((track): track is AnimatorTrackState => Boolean(track));
            const duration =
                typeof clip.duration === 'number' && Number.isFinite(clip.duration)
                    ? clip.duration
                    : tracks.reduce(
                          (maxDuration, track) =>
                              Math.max(maxDuration, track.times[track.times.length - 1] ?? 0),
                          0
                      );
            const normalized: AnimatorClipState = {
                id: clip.id,
                duration,
                tracks: Object.freeze(tracks),
            };

            this._clips.set(clip.id, normalized);
            this._clipOrder.push(clip.id);
        }
    }

    private _normalizeTrack(track: AnimatorTrackConfig): AnimatorTrackState | undefined {
        if (!track || typeof track.targetNodeId !== 'string') {
            return undefined;
        }

        const times = toFloat32Array(track.times ?? []);
        const values = toFloat32Array(track.values ?? []);
        const keyframeCount = track.keyframeCount ?? times.length;
        if (keyframeCount <= 0 || times.length === 0) {
            return undefined;
        }

        const sampleStride =
            track.sampleStride ??
            (keyframeCount > 0 ? values.length / keyframeCount : track.valueComponentCount ?? 0);
        const valueComponentCount =
            track.valueComponentCount ??
            (track.interpolation === 'CUBICSPLINE' ? sampleStride / 3 : sampleStride);
        if (
            !Number.isFinite(sampleStride) ||
            !Number.isFinite(valueComponentCount) ||
            sampleStride <= 0 ||
            valueComponentCount <= 0 ||
            Math.floor(sampleStride) !== sampleStride ||
            Math.floor(valueComponentCount) !== valueComponentCount
        ) {
            return undefined;
        }

        return {
            targetNodeId: track.targetNodeId,
            path: track.path,
            interpolation: track.interpolation ?? 'LINEAR',
            keyframeCount,
            valueComponentCount,
            sampleStride,
            times,
            values,
        };
    }

    private _getCurrentClip(): AnimatorClipState | undefined {
        return this._currentClipId ? this._clips.get(this._currentClipId) : undefined;
    }

    private _applyCurrentClip(): void {
        const clip = this._getCurrentClip();
        if (!clip) {
            return;
        }

        const instanceId = this.actor?.getComponent(PrefabNodeBinding)?.instanceId ?? null;
        const requiredTargetCount = new Set(clip.tracks.map((track) => track.targetNodeId)).size;
        if (
            this._resolvedInstanceId !== instanceId ||
            this._resolvedTargets.size < requiredTargetCount
        ) {
            this._rebuildTargetMap(instanceId);
        }

        for (const track of clip.tracks) {
            const target = this._resolvedTargets.get(track.targetNodeId);
            if (!target) {
                continue;
            }

            switch (track.path) {
                case 'translation':
                    if (!target.transform) {
                        break;
                    }
                    this._sampleVec3(track, this._time, this._tempVec3);
                    target.transform.position = this._tempVec3;
                    break;
                case 'scale':
                    if (!target.transform) {
                        break;
                    }
                    this._sampleVec3(track, this._time, this._tempVec3);
                    target.transform.scale = this._tempVec3;
                    break;
                case 'rotation':
                    if (!target.transform) {
                        break;
                    }
                    this._sampleQuat(track, this._time, this._tempQuat);
                    target.transform.rotation = this._tempQuat;
                    break;
                case 'weights':
                    if (!target.meshRenderer) {
                        break;
                    }
                    target.meshRenderer.setMorphWeights(
                        this._sampleComponents(track, this._time, track.valueComponentCount)
                    );
                    break;
            }
        }
    }

    private _rebuildTargetMap(instanceId: string | null): void {
        this._resolvedTargets.clear();
        this._resolvedInstanceId = instanceId;
        const actors = (this.world as { getAllActors?: () => readonly { getComponent: (type: any) => any }[] } | undefined)?.getAllActors?.() ?? [];

        for (const actor of actors) {
            const binding = actor.getComponent(PrefabNodeBinding) as PrefabNodeBinding | undefined;
            if (!binding || binding.nodeId === null) {
                continue;
            }
            if (instanceId && binding.instanceId !== instanceId) {
                continue;
            }

            const transform = actor.getComponent(Transform) as Transform | undefined;
            const meshRenderer = actor.getComponent(MeshRenderer) as MeshRenderer | undefined;
            if (transform || meshRenderer) {
                this._resolvedTargets.set(
                    binding.nodeId,
                    Object.freeze({
                        ...(transform ? { transform } : {}),
                        ...(meshRenderer ? { meshRenderer } : {}),
                    })
                );
            }
        }
    }

    private _sampleVec3(track: AnimatorTrackState, time: number, out: Vec3): void {
        const sampled = this._sampleComponents(track, time, 3);
        out.x = sampled[0];
        out.y = sampled[1];
        out.z = sampled[2];
    }

    private _sampleQuat(track: AnimatorTrackState, time: number, out: Quat): void {
        const frameIndex = findFrameIndex(track.times, time);
        const nextIndex = Math.min(track.keyframeCount - 1, frameIndex + 1);
        const startTime = track.times[frameIndex] ?? 0;
        const endTime = track.times[nextIndex] ?? startTime;
        const duration = Math.max(endTime - startTime, 0);
        const alpha = duration > 0 ? (time - startTime) / duration : 0;

        if (track.interpolation === 'STEP' || frameIndex === nextIndex) {
            const offset = frameIndex * track.sampleStride;
            out.x = track.values[offset] ?? 0;
            out.y = track.values[offset + 1] ?? 0;
            out.z = track.values[offset + 2] ?? 0;
            out.w = track.values[offset + 3] ?? 1;
            return;
        }

        if (track.interpolation === 'CUBICSPLINE') {
            const sampled = this._sampleComponents(track, time, 4);
            out.x = sampled[0];
            out.y = sampled[1];
            out.z = sampled[2];
            out.w = sampled[3];
        } else {
            const leftOffset = frameIndex * track.sampleStride;
            const rightOffset = nextIndex * track.sampleStride;
            const left = {
                x: track.values[leftOffset] ?? 0,
                y: track.values[leftOffset + 1] ?? 0,
                z: track.values[leftOffset + 2] ?? 0,
                w: track.values[leftOffset + 3] ?? 1,
            };
            const right = {
                x: track.values[rightOffset] ?? 0,
                y: track.values[rightOffset + 1] ?? 0,
                z: track.values[rightOffset + 2] ?? 0,
                w: track.values[rightOffset + 3] ?? 1,
            };
            Quat.slerp(left, right, alpha, out);
        }

        Quat.normalize(out, out);
    }

    private _sampleComponents(track: AnimatorTrackState, time: number, componentCount: number): Float32Array {
        const sampled = new Float32Array(componentCount);
        const frameIndex = findFrameIndex(track.times, time);
        const nextIndex = Math.min(track.keyframeCount - 1, frameIndex + 1);
        const startTime = track.times[frameIndex] ?? 0;
        const endTime = track.times[nextIndex] ?? startTime;
        const duration = Math.max(endTime - startTime, 0);
        const alpha = duration > 0 ? (time - startTime) / duration : 0;

        if (track.interpolation === 'STEP' || frameIndex === nextIndex) {
            const baseOffset = frameIndex * track.sampleStride + (track.interpolation === 'CUBICSPLINE' ? track.valueComponentCount : 0);
            for (let component = 0; component < componentCount; component += 1) {
                sampled[component] = track.values[baseOffset + component] ?? (component === 3 ? 1 : 0);
            }
            return sampled;
        }

        if (track.interpolation === 'CUBICSPLINE') {
            const leftBase = frameIndex * track.sampleStride;
            const rightBase = nextIndex * track.sampleStride;
            const s = Math.max(0, Math.min(alpha, 1));
            const s2 = s * s;
            const s3 = s2 * s;
            const h00 = 2 * s3 - 3 * s2 + 1;
            const h10 = s3 - 2 * s2 + s;
            const h01 = -2 * s3 + 3 * s2;
            const h11 = s3 - s2;

            for (let component = 0; component < componentCount; component += 1) {
                const inTangent = track.values[rightBase + component] ?? 0;
                const value0 = track.values[leftBase + track.valueComponentCount + component] ?? 0;
                const outTangent =
                    track.values[leftBase + track.valueComponentCount * 2 + component] ?? 0;
                const value1 =
                    track.values[rightBase + track.valueComponentCount + component] ?? 0;
                sampled[component] =
                    h00 * value0 +
                    h10 * duration * outTangent +
                    h01 * value1 +
                    h11 * duration * inTangent;
            }

            return sampled;
        }

        const leftOffset = frameIndex * track.sampleStride;
        const rightOffset = nextIndex * track.sampleStride;
        for (let component = 0; component < componentCount; component += 1) {
            const left = track.values[leftOffset + component] ?? 0;
            const right = track.values[rightOffset + component] ?? left;
            sampled[component] = left + (right - left) * Math.max(0, Math.min(alpha, 1));
        }

        return sampled;
    }
}