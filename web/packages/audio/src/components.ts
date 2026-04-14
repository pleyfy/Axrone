import { Component } from '@axrone/ecs-runtime';
import type { ComponentConfig } from '@axrone/ecs-runtime';
import type { Transform } from '@axrone/ecs-runtime';
import { Vec3 } from '@axrone/numeric';
import { toAudioClipSelector } from './asset';
import {
    MASTER_AUDIO_BUS_ID,
    cloneAudioVector3,
    normalizeAudioBusId,
    normalizeAudioListenerId,
    normalizeAudioSourceId,
} from './reference';
import type {
    AudioAssetSchema,
    AudioJsonValue,
    AudioListenerDescriptor,
    AudioListenerId,
    AudioSourceComponentCommand,
    AudioSourceDefinition,
    AudioSourceId,
    AudioSourcePlayRequest,
    AudioSourceState,
    AudioSpatialization,
    AudioStopOptions,
    AudioVector3,
} from './types';

const cloneMetadata = (
    value: Readonly<Record<string, AudioJsonValue>> | undefined
): Readonly<Record<string, AudioJsonValue>> => Object.freeze({ ...(value ?? {}) });

const isFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value);

const ensureVector = (value: AudioVector3 | undefined, fallback: AudioVector3): AudioVector3 => {
    const next = cloneAudioVector3(value, fallback);
    if (!isFiniteNumber(next.x) || !isFiniteNumber(next.y) || !isFiniteNumber(next.z)) {
        throw new TypeError('Audio vector components must be finite');
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

const DEFAULT_LISTENER_POSITION = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_LISTENER_FORWARD = Object.freeze({ x: 0, y: 0, z: -1 });
const DEFAULT_LISTENER_UP = Object.freeze({ x: 0, y: 1, z: 0 });
const DEFAULT_SOURCE_POSITION = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_SOURCE_ORIENTATION = Object.freeze({ x: 0, y: 0, z: -1 });

export interface AudioListenerComponentConfig extends ComponentConfig {
    readonly listenerId?: AudioListenerId | string;
    readonly active?: boolean;
    readonly position?: AudioVector3;
    readonly forward?: AudioVector3;
    readonly up?: AudioVector3;
    readonly useTransform?: boolean;
    readonly metadata?: Readonly<Record<string, AudioJsonValue>>;
}

export class AudioListenerComponent extends Component<AudioListenerComponentConfig> {
    private _listenerId: AudioListenerId;
    private _active: boolean;
    private _position: AudioVector3;
    private _forward: AudioVector3;
    private _up: AudioVector3;
    private _useTransform: boolean;
    private _metadata: Readonly<Record<string, AudioJsonValue>>;

    constructor(config: AudioListenerComponentConfig = {}) {
        super(config);
        this._listenerId = normalizeAudioListenerId(config.listenerId ?? 'default');
        this._active = config.active ?? true;
        this._position = ensureVector(config.position, DEFAULT_LISTENER_POSITION);
        this._forward = ensureVector(config.forward, DEFAULT_LISTENER_FORWARD);
        this._up = ensureVector(config.up, DEFAULT_LISTENER_UP);
        this._useTransform = config.useTransform ?? true;
        this._metadata = cloneMetadata(config.metadata);
    }

    get listenerId(): AudioListenerId {
        return this._listenerId;
    }

    set listenerId(value: AudioListenerId | string) {
        this._listenerId = normalizeAudioListenerId(value);
    }

    get active(): boolean {
        return this._active;
    }

    set active(value: boolean) {
        this._active = value;
    }

    get useTransform(): boolean {
        return this._useTransform;
    }

    set useTransform(value: boolean) {
        this._useTransform = value;
    }

    get position(): AudioVector3 {
        return cloneAudioVector3(this._position);
    }

    set position(value: AudioVector3) {
        this._position = ensureVector(value, DEFAULT_LISTENER_POSITION);
    }

    get forward(): AudioVector3 {
        return cloneAudioVector3(this._forward);
    }

    set forward(value: AudioVector3) {
        this._forward = ensureVector(value, DEFAULT_LISTENER_FORWARD);
    }

    get up(): AudioVector3 {
        return cloneAudioVector3(this._up);
    }

    set up(value: AudioVector3) {
        this._up = ensureVector(value, DEFAULT_LISTENER_UP);
    }

    get metadata(): Readonly<Record<string, AudioJsonValue>> {
        return this._metadata;
    }

    set metadata(value: Readonly<Record<string, AudioJsonValue>>) {
        this._metadata = cloneMetadata(value);
    }

    toDescriptor(): AudioListenerDescriptor {
        const transform = this._useTransform ? (this.transform as Transform | undefined) : undefined;
        if (transform) {
            const position = cloneAudioVector3(transform.worldPosition);
            const forward = cloneAudioVector3(
                transform.worldRotation.rotateVector(Vec3.BACK, Vec3.create()) as AudioVector3
            );
            const up = cloneAudioVector3(
                transform.worldRotation.rotateVector(Vec3.UP, Vec3.create()) as AudioVector3
            );
            return {
                id: this._listenerId,
                active: this._active,
                enabled: this.enabled,
                position,
                forward,
                up,
                metadata: this._metadata,
            };
        }

        return {
            id: this._listenerId,
            active: this._active,
            enabled: this.enabled,
            position: cloneAudioVector3(this._position),
            forward: cloneAudioVector3(this._forward),
            up: cloneAudioVector3(this._up),
            metadata: this._metadata,
        };
    }

    serialize(): Record<string, unknown> {
        return {
            listenerId: this._listenerId,
            active: this._active,
            enabled: this.enabled,
            position: cloneAudioVector3(this._position),
            forward: cloneAudioVector3(this._forward),
            up: cloneAudioVector3(this._up),
            useTransform: this._useTransform,
            metadata: this._metadata,
        };
    }

    deserialize(data: Record<string, any>): void {
        if (typeof data.listenerId === 'string') {
            this.listenerId = data.listenerId;
        }
        if (typeof data.active === 'boolean') {
            this.active = data.active;
        }
        if (typeof data.enabled === 'boolean') {
            this.enabled = data.enabled;
        }
        if (data.position) {
            this.position = data.position;
        }
        if (data.forward) {
            this.forward = data.forward;
        }
        if (data.up) {
            this.up = data.up;
        }
        if (typeof data.useTransform === 'boolean') {
            this.useTransform = data.useTransform;
        }
        if (data.metadata && typeof data.metadata === 'object') {
            this.metadata = data.metadata;
        }
    }

    clone(): this {
        return new AudioListenerComponent({
            listenerId: this._listenerId,
            active: this._active,
            enabled: this.enabled,
            position: this._position,
            forward: this._forward,
            up: this._up,
            useTransform: this._useTransform,
            metadata: this._metadata,
        }) as this;
    }
}

export interface AudioSourceComponentConfig<TSchema extends AudioAssetSchema = AudioAssetSchema>
    extends ComponentConfig {
    readonly sourceId?: AudioSourceId | string;
    readonly busId?: string;
    readonly clip?: AudioSourceDefinition<TSchema>['clip'];
    readonly volume?: number;
    readonly muted?: boolean;
    readonly loop?: boolean;
    readonly autoplay?: boolean;
    readonly playbackRate?: number;
    readonly detuneCents?: number;
    readonly pan?: number;
    readonly spatial?: AudioSpatialization;
    readonly startOffsetSeconds?: number;
    readonly useTransform?: boolean;
    readonly metadata?: Readonly<Record<string, AudioJsonValue>>;
}

export class AudioSourceComponent<
    TSchema extends AudioAssetSchema = AudioAssetSchema,
> extends Component<AudioSourceComponentConfig<TSchema>> {
    private _sourceId: AudioSourceId;
    private _busId = MASTER_AUDIO_BUS_ID;
    private _clip?: AudioSourceDefinition<TSchema>['clip'];
    private _volume: number;
    private _muted: boolean;
    private _loop: boolean;
    private _autoplay: boolean;
    private _playbackRate: number;
    private _detuneCents: number;
    private _pan: number;
    private _spatial?: AudioSpatialization;
    private _startOffsetSeconds: number;
    private _useTransform: boolean;
    private _metadata: Readonly<Record<string, AudioJsonValue>>;
    private readonly _pendingCommands: AudioSourceComponentCommand<TSchema>[] = [];
    private _autoplayPending: boolean;
    private _lastKnownState: AudioSourceState<TSchema>['playbackState'] = 'idle';

    constructor(config: AudioSourceComponentConfig<TSchema> = {}) {
        super(config);
        this._sourceId = normalizeAudioSourceId(config.sourceId ?? this.id);
        this._busId = normalizeAudioBusId(config.busId ?? MASTER_AUDIO_BUS_ID);
        this._clip = config.clip;
        this._volume = isFiniteNumber(config.volume) ? config.volume : 1;
        this._muted = config.muted ?? false;
        this._loop = config.loop ?? false;
        this._autoplay = config.autoplay ?? false;
        this._playbackRate = isFiniteNumber(config.playbackRate) ? config.playbackRate : 1;
        this._detuneCents = isFiniteNumber(config.detuneCents) ? config.detuneCents : 0;
        this._pan = isFiniteNumber(config.pan) ? config.pan : 0;
        this._spatial = cloneSpatialization(config.spatial);
        this._startOffsetSeconds = isFiniteNumber(config.startOffsetSeconds)
            ? config.startOffsetSeconds
            : 0;
        this._useTransform = config.useTransform ?? true;
        this._metadata = cloneMetadata(config.metadata);
        this._autoplayPending = this._autoplay;
    }

    get sourceId(): AudioSourceId {
        return this._sourceId;
    }

    set sourceId(value: AudioSourceId | string) {
        this._sourceId = normalizeAudioSourceId(value);
    }

    get busId(): string {
        return this._busId;
    }

    set busId(value: string) {
        this._busId = normalizeAudioBusId(value);
    }

    get clip(): AudioSourceDefinition<TSchema>['clip'] | undefined {
        return this._clip;
    }

    set clip(value: AudioSourceDefinition<TSchema>['clip'] | undefined) {
        this._clip = value;
    }

    get volume(): number {
        return this._volume;
    }

    set volume(value: number) {
        this._volume = value;
    }

    get muted(): boolean {
        return this._muted;
    }

    set muted(value: boolean) {
        this._muted = value;
    }

    get loop(): boolean {
        return this._loop;
    }

    set loop(value: boolean) {
        this._loop = value;
    }

    get autoplay(): boolean {
        return this._autoplay;
    }

    set autoplay(value: boolean) {
        this._autoplay = value;
        if (value) {
            this._autoplayPending = true;
        }
    }

    get playbackRate(): number {
        return this._playbackRate;
    }

    set playbackRate(value: number) {
        this._playbackRate = value;
    }

    get detuneCents(): number {
        return this._detuneCents;
    }

    set detuneCents(value: number) {
        this._detuneCents = value;
    }

    get pan(): number {
        return this._pan;
    }

    set pan(value: number) {
        this._pan = value;
    }

    get spatial(): AudioSpatialization | undefined {
        return cloneSpatialization(this._spatial);
    }

    set spatial(value: AudioSpatialization | undefined) {
        this._spatial = cloneSpatialization(value);
    }

    get startOffsetSeconds(): number {
        return this._startOffsetSeconds;
    }

    set startOffsetSeconds(value: number) {
        this._startOffsetSeconds = value;
    }

    get useTransform(): boolean {
        return this._useTransform;
    }

    set useTransform(value: boolean) {
        this._useTransform = value;
    }

    get metadata(): Readonly<Record<string, AudioJsonValue>> {
        return this._metadata;
    }

    set metadata(value: Readonly<Record<string, AudioJsonValue>>) {
        this._metadata = cloneMetadata(value);
    }

    get playbackState(): AudioSourceState<TSchema>['playbackState'] {
        return this._lastKnownState;
    }

    play(request?: AudioSourcePlayRequest<TSchema>): void {
        this._pendingCommands.push({ kind: 'play', request });
    }

    pause(): void {
        this._pendingCommands.push({ kind: 'pause' });
    }

    resume(): void {
        this._pendingCommands.push({ kind: 'resume' });
    }

    stop(options?: AudioStopOptions): void {
        this._pendingCommands.push({ kind: 'stop', options });
    }

    override onEnable(): void {
        if (this._autoplay) {
            this._autoplayPending = true;
        }
    }

    override onDisable(): void {
        this.stop();
    }

    consumeCommands(): readonly AudioSourceComponentCommand<TSchema>[] {
        const commands = this._pendingCommands.splice(0);
        if (this._autoplayPending) {
            commands.unshift({ kind: 'play' });
            this._autoplayPending = false;
        }
        return Object.freeze(commands);
    }

    syncState(state: AudioSourceState<TSchema>): void {
        this._lastKnownState = state.playbackState;
    }

    toDescriptor(): AudioSourceDefinition<TSchema> {
        const transform = this._useTransform ? (this.transform as Transform | undefined) : undefined;
        let spatial = cloneSpatialization(this._spatial);

        if (transform) {
            const position = cloneAudioVector3(transform.worldPosition);
            const orientation = cloneAudioVector3(
                transform.worldRotation.rotateVector(Vec3.BACK, Vec3.create()) as AudioVector3
            );

            if (!spatial) {
                spatial = {
                    mode: '3d',
                    position,
                    orientation,
                };
            } else if (spatial.mode === '2d') {
                spatial = {
                    ...spatial,
                    position,
                };
            } else {
                spatial = {
                    ...spatial,
                    position,
                    orientation,
                };
            }
        }

        return {
            id: this._sourceId,
            busId: this._busId,
            clip: this._clip,
            volume: this._volume,
            muted: this._muted || !this.enabled,
            loop: this._loop,
            autoplay: this._autoplay,
            playbackRate: this._playbackRate,
            detuneCents: this._detuneCents,
            pan: this._pan,
            spatial,
            startOffsetSeconds: this._startOffsetSeconds,
            metadata: this._metadata,
        };
    }

    serialize(): Record<string, unknown> {
        return {
            sourceId: this._sourceId,
            busId: this._busId,
            clip: toAudioClipSelector(this._clip),
            volume: this._volume,
            muted: this._muted,
            loop: this._loop,
            autoplay: this._autoplay,
            playbackRate: this._playbackRate,
            detuneCents: this._detuneCents,
            pan: this._pan,
            spatial: cloneSpatialization(this._spatial),
            startOffsetSeconds: this._startOffsetSeconds,
            useTransform: this._useTransform,
            metadata: this._metadata,
        };
    }

    deserialize(data: Record<string, any>): void {
        if (typeof data.sourceId === 'string') {
            this.sourceId = data.sourceId;
        }
        if (typeof data.busId === 'string') {
            this.busId = data.busId;
        }
        if ('clip' in data) {
            this.clip = data.clip;
        }
        if (isFiniteNumber(data.volume)) {
            this.volume = data.volume;
        }
        if (typeof data.muted === 'boolean') {
            this.muted = data.muted;
        }
        if (typeof data.loop === 'boolean') {
            this.loop = data.loop;
        }
        if (typeof data.autoplay === 'boolean') {
            this.autoplay = data.autoplay;
        }
        if (isFiniteNumber(data.playbackRate)) {
            this.playbackRate = data.playbackRate;
        }
        if (isFiniteNumber(data.detuneCents)) {
            this.detuneCents = data.detuneCents;
        }
        if (isFiniteNumber(data.pan)) {
            this.pan = data.pan;
        }
        if (data.spatial) {
            this.spatial = data.spatial;
        }
        if (isFiniteNumber(data.startOffsetSeconds)) {
            this.startOffsetSeconds = data.startOffsetSeconds;
        }
        if (typeof data.useTransform === 'boolean') {
            this.useTransform = data.useTransform;
        }
        if (data.metadata && typeof data.metadata === 'object') {
            this.metadata = data.metadata;
        }
    }

    clone(): this {
        return new AudioSourceComponent<TSchema>({
            sourceId: this._sourceId,
            busId: this._busId,
            clip: this._clip,
            volume: this._volume,
            muted: this._muted,
            loop: this._loop,
            autoplay: this._autoplay,
            playbackRate: this._playbackRate,
            detuneCents: this._detuneCents,
            pan: this._pan,
            spatial: this._spatial,
            startOffsetSeconds: this._startOffsetSeconds,
            useTransform: this._useTransform,
            metadata: this._metadata,
            enabled: this.enabled,
        }) as this;
    }
}