import type { AssetDatabase, AssetRecord, AssetSchema, AssetSelector } from '@axrone/asset-core';
import type { IEventEmitter } from '@axrone/event';
import type { IVec3Like } from '@axrone/numeric';
import type { DeepReadonly } from '@axrone/utility';

export type { DeepReadonly };

type Brand<TValue, TBrand extends string> = TValue & { readonly __audioBrand: TBrand };

export type AudioBusId = Brand<string, 'AudioBusId'>;
export type AudioClipId = Brand<string, 'AudioClipId'>;
export type AudioListenerId = Brand<string, 'AudioListenerId'>;
export type AudioSourceId = Brand<string, 'AudioSourceId'>;
export type AudioSnapshotId = Brand<string, 'AudioSnapshotId'>;

export interface AudioJsonObject {
    readonly [key: string]: AudioJsonValue;
}

export interface AudioJsonArray extends ReadonlyArray<AudioJsonValue> {}

export type AudioJsonPrimitive = string | number | boolean | null;
export type AudioJsonValue = AudioJsonPrimitive | AudioJsonObject | AudioJsonArray;

export type AudioPatch<T> = T extends (...args: never[]) => unknown
    ? never
    : T extends ReadonlyArray<infer TItem>
      ? readonly TItem[]
      : T extends object
        ? { readonly [TKey in keyof T]?: AudioPatch<T[TKey]> }
        : T;

export interface AudioVector3 extends IVec3Like {}

export type AudioDistanceModel = 'none' | 'linear' | 'inverse' | 'exponential';
export type AudioPanningModel = 'equalpower' | 'HRTF';
export type AudioPlaybackState = 'idle' | 'playing' | 'paused' | 'stopped' | 'disposed';
export type AudioSystemStatus = 'idle' | 'running' | 'suspended' | 'disposed';

export interface AudioClipBase {
    readonly loopStartSeconds?: number;
    readonly loopEndSeconds?: number;
    readonly metadata?: Readonly<Record<string, AudioJsonValue>>;
}

export interface AudioBufferClipAssetData extends AudioClipBase {
    readonly kind: 'buffer';
    readonly buffer: AudioBuffer;
}

export interface AudioPcmClipAssetData extends AudioClipBase {
    readonly kind: 'pcm';
    readonly sampleRate: number;
    readonly channelData: readonly Float32Array[];
}

export interface AudioEncodedClipAssetData extends AudioClipBase {
    readonly kind: 'encoded';
    readonly data: ArrayBuffer | ArrayBufferView;
    readonly mimeType?: string;
}

export interface AudioUrlClipAssetData extends AudioClipBase {
    readonly kind: 'url';
    readonly url: string;
    readonly mimeType?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly credentials?: RequestCredentials;
}

export type AudioClipAssetData =
    | AudioBufferClipAssetData
    | AudioPcmClipAssetData
    | AudioEncodedClipAssetData
    | AudioUrlClipAssetData;

export interface AudioAssetSchema extends AssetSchema {
    readonly audioClip: AudioClipAssetData;
}

export type AudioClipAssetSelector<TSchema extends AudioAssetSchema = AudioAssetSchema> =
    AssetSelector<TSchema>;

export interface AudioRegisteredClipSelector {
    readonly kind: 'registered';
    readonly clipId: AudioClipId;
}

export interface AudioAssetClipSelector<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly kind: 'asset';
    readonly selector: AudioClipAssetSelector<TSchema>;
}

export interface AudioInlineClipSelector {
    readonly kind: 'inline';
    readonly clip: AudioClipAssetData;
}

export type AudioClipSelector<TSchema extends AudioAssetSchema = AudioAssetSchema> =
    | AudioRegisteredClipSelector
    | AudioAssetClipSelector<TSchema>
    | AudioInlineClipSelector;

export type AudioClipInput<TSchema extends AudioAssetSchema = AudioAssetSchema> =
    | AudioClipSelector<TSchema>
    | AudioClipAssetSelector<TSchema>
    | AudioClipAssetData
    | AudioBuffer;

export interface AudioSpatialAttenuation {
    readonly model?: AudioDistanceModel;
    readonly refDistance?: number;
    readonly maxDistance?: number;
    readonly rolloffFactor?: number;
    readonly minGain?: number;
}

export interface Audio2DSpatialization {
    readonly mode: '2d';
    readonly position?: AudioVector3;
    readonly pan?: number;
    readonly attenuation?: AudioSpatialAttenuation;
}

export interface Audio3DSpatialization {
    readonly mode: '3d';
    readonly position?: AudioVector3;
    readonly orientation?: AudioVector3;
    readonly attenuation?: AudioSpatialAttenuation;
    readonly panningModel?: AudioPanningModel;
    readonly coneInnerAngle?: number;
    readonly coneOuterAngle?: number;
    readonly coneOuterGain?: number;
}

export type AudioSpatialization = Audio2DSpatialization | Audio3DSpatialization;

export interface AudioBusDefinition {
    readonly id: AudioBusId | string;
    readonly parentId?: AudioBusId | string;
    readonly volume?: number;
    readonly mute?: boolean;
    readonly pan?: number;
    readonly metadata?: Readonly<Record<string, AudioJsonValue>>;
}

export type AudioBusPatch = AudioPatch<Omit<AudioBusDefinition, 'id'>>;

export interface AudioBusState {
    readonly id: AudioBusId;
    readonly parentId?: AudioBusId;
    readonly volume: number;
    readonly mute: boolean;
    readonly pan: number;
    readonly effectiveGain: number;
    readonly childIds: readonly AudioBusId[];
    readonly metadata: Readonly<Record<string, AudioJsonValue>>;
}

export interface AudioListenerDescriptor {
    readonly id?: AudioListenerId | string;
    readonly active?: boolean;
    readonly enabled?: boolean;
    readonly position?: AudioVector3;
    readonly forward?: AudioVector3;
    readonly up?: AudioVector3;
    readonly metadata?: Readonly<Record<string, AudioJsonValue>>;
}

export type AudioListenerPatch = AudioPatch<Omit<AudioListenerDescriptor, 'id'>>;

export interface AudioListenerState {
    readonly id: AudioListenerId;
    readonly active: boolean;
    readonly enabled: boolean;
    readonly position: AudioVector3;
    readonly forward: AudioVector3;
    readonly up: AudioVector3;
    readonly metadata: Readonly<Record<string, AudioJsonValue>>;
}

export interface AudioSourceDefinition<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly id?: AudioSourceId | string;
    readonly busId?: AudioBusId | string;
    readonly clip?: AudioClipInput<TSchema>;
    readonly volume?: number;
    readonly muted?: boolean;
    readonly loop?: boolean;
    readonly autoplay?: boolean;
    readonly playbackRate?: number;
    readonly detuneCents?: number;
    readonly pan?: number;
    readonly spatial?: AudioSpatialization;
    readonly startOffsetSeconds?: number;
    readonly metadata?: Readonly<Record<string, AudioJsonValue>>;
}

export type AudioSourcePatch<TSchema extends AudioAssetSchema = AudioAssetSchema> = AudioPatch<
    Omit<AudioSourceDefinition<TSchema>, 'id'>
>;

export interface AudioSourceState<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly id: AudioSourceId;
    readonly busId: AudioBusId;
    readonly clip?: AudioClipSelector<TSchema>;
    readonly volume: number;
    readonly muted: boolean;
    readonly loop: boolean;
    readonly autoplay: boolean;
    readonly playbackRate: number;
    readonly detuneCents: number;
    readonly pan: number;
    readonly spatial?: AudioSpatialization;
    readonly startOffsetSeconds: number;
    readonly metadata: Readonly<Record<string, AudioJsonValue>>;
    readonly playbackState: AudioPlaybackState;
    readonly currentOffsetSeconds: number;
    readonly durationSeconds?: number;
    readonly playSequence: number;
}

export interface AudioSourcePlayRequest<TSchema extends AudioAssetSchema = AudioAssetSchema>
    extends AudioSourcePatch<TSchema> {
    readonly when?: number;
    readonly offsetSeconds?: number;
    readonly durationSeconds?: number;
    readonly replace?: boolean;
}

export interface AudioStopOptions {
    readonly when?: number;
}

export interface AudioPlaybackHandle {
    readonly sourceId: AudioSourceId;
    readonly sequence: number;
    stop(options?: AudioStopOptions): void;
    pause(): void;
    resume(): Promise<void>;
}

export interface AudioClipRegistration<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly id: AudioClipId | string;
    readonly clip: AudioClipInput<TSchema>;
}

export interface AudioClipRecord<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly id: AudioClipId;
    readonly selector: AudioClipSelector<TSchema>;
    readonly buffer: AudioBuffer;
    readonly durationSeconds: number;
    readonly sampleRate: number;
    readonly channelCount: number;
    readonly loopStartSeconds?: number;
    readonly loopEndSeconds?: number;
    readonly metadata: Readonly<Record<string, AudioJsonValue>>;
}

export interface AudioMixerSnapshotBusState {
    readonly id: AudioBusId | string;
    readonly volume?: number;
    readonly mute?: boolean;
    readonly pan?: number;
}

export interface AudioMixerSnapshot {
    readonly id?: AudioSnapshotId | string;
    readonly buses: readonly AudioMixerSnapshotBusState[];
}

export interface AudioSnapshotTransitionOptions {
    readonly durationSeconds?: number;
    readonly atTime?: number;
}

export interface AudioSystemSnapshot<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly version: 1;
    readonly status: Exclude<AudioSystemStatus, 'disposed'>;
    readonly capturedAtEpochMs: number;
    readonly activeListenerId?: AudioListenerId;
    readonly buses: readonly AudioBusState[];
    readonly listeners: readonly AudioListenerState[];
    readonly sources: readonly AudioSourceState<TSchema>[];
}

export interface AudioRestoreOptions {
    readonly clearExisting?: boolean;
    readonly restorePlayback?: boolean;
    readonly transition?: AudioSnapshotTransitionOptions;
}

export interface AudioRetryContext<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly operation:
        | 'asset.resolve'
        | 'context.resume'
        | 'context.suspend'
        | 'source.play'
        | 'source.resume';
    readonly attempt: number;
    readonly sourceId?: AudioSourceId;
    readonly clip?: AudioClipSelector<TSchema>;
}

export interface AudioRetryPolicy<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly attempts?: number;
    readonly backoffMs?: number | ((attempt: number) => number);
    readonly shouldRetry?: (
        error: unknown,
        context: Readonly<AudioRetryContext<TSchema>>
    ) => boolean;
}

export interface AudioAssetResolver<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    resolveClip(
        selector: AudioClipAssetSelector<TSchema>
    ):
        | Promise<AssetRecord<TSchema> | AudioClipAssetData | undefined>
        | AssetRecord<TSchema>
        | AudioClipAssetData
        | undefined;
}

export interface AudioSystemOptions<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly context?: AudioContext;
    readonly createContext?: () => AudioContext;
    readonly destination?: AudioNode;
    readonly locale?: string;
    readonly messageResolver?: AudioMessageResolver;
    readonly assetDatabase?: AssetDatabase<TSchema>;
    readonly assetResolver?: AudioAssetResolver<TSchema>;
    readonly buses?: readonly AudioBusDefinition[];
    readonly listeners?: readonly AudioListenerDescriptor[];
    readonly sources?: readonly AudioSourceDefinition<TSchema>[];
    readonly autoResume?: boolean;
    readonly resumeRetryPolicy?: AudioRetryPolicy<TSchema>;
    readonly assetRetryPolicy?: AudioRetryPolicy<TSchema>;
}

export type AudioRuntimeEventType =
    | 'bus:upserted'
    | 'bus:removed'
    | 'listener:upserted'
    | 'listener:removed'
    | 'listener:activated'
    | 'source:upserted'
    | 'source:removed'
    | 'source:played'
    | 'source:paused'
    | 'source:resumed'
    | 'source:stopped'
    | 'source:ended'
    | 'source:error'
    | 'snapshot:captured'
    | 'snapshot:restored'
    | 'system:suspended'
    | 'system:resumed'
    | 'system:disposed';

export interface AudioRuntimeEventBase {
    readonly type: AudioRuntimeEventType;
    readonly sequence: number;
    readonly timestamp: number;
    readonly contextTime: number;
    readonly systemStatus: AudioSystemStatus;
}

export interface AudioBusUpsertedEvent extends AudioRuntimeEventBase {
    readonly type: 'bus:upserted';
    readonly bus: AudioBusState;
}

export interface AudioBusRemovedEvent extends AudioRuntimeEventBase {
    readonly type: 'bus:removed';
    readonly busId: AudioBusId;
    readonly fallbackBusId?: AudioBusId;
}

export interface AudioListenerUpsertedEvent extends AudioRuntimeEventBase {
    readonly type: 'listener:upserted';
    readonly listener: AudioListenerState;
}

export interface AudioListenerRemovedEvent extends AudioRuntimeEventBase {
    readonly type: 'listener:removed';
    readonly listenerId: AudioListenerId;
}

export interface AudioListenerActivatedEvent extends AudioRuntimeEventBase {
    readonly type: 'listener:activated';
    readonly listener: AudioListenerState;
}

export interface AudioSourceStateEvent<
    TSchema extends AudioAssetSchema = AudioAssetSchema,
    TType extends
        | 'source:upserted'
        | 'source:removed'
        | 'source:played'
        | 'source:paused'
        | 'source:resumed'
        | 'source:stopped'
        | 'source:ended' =
        | 'source:upserted'
        | 'source:removed'
        | 'source:played'
        | 'source:paused'
        | 'source:resumed'
        | 'source:stopped'
        | 'source:ended',
> extends AudioRuntimeEventBase {
    readonly type: TType;
    readonly source: AudioSourceState<TSchema>;
}

export interface AudioSourceErrorEvent<TSchema extends AudioAssetSchema = AudioAssetSchema>
    extends AudioRuntimeEventBase {
    readonly type: 'source:error';
    readonly operation: 'play' | 'resume';
    readonly sourceId: AudioSourceId;
    readonly reason: unknown;
    readonly source?: AudioSourceState<TSchema>;
}

export interface AudioSnapshotCapturedEvent extends AudioRuntimeEventBase {
    readonly type: 'snapshot:captured';
    readonly snapshotKind: 'mixer' | 'system';
    readonly snapshotId?: AudioSnapshotId;
    readonly busCount: number;
    readonly listenerCount: number;
    readonly sourceCount: number;
}

export interface AudioSnapshotRestoredEvent extends AudioRuntimeEventBase {
    readonly type: 'snapshot:restored';
    readonly snapshotId?: AudioSnapshotId;
    readonly busCount: number;
    readonly listenerCount: number;
    readonly sourceCount: number;
    readonly restorePlayback: boolean;
}

export interface AudioSystemLifecycleEvent extends AudioRuntimeEventBase {
    readonly type: 'system:suspended' | 'system:resumed' | 'system:disposed';
}

export type AudioRuntimeEvent<TSchema extends AudioAssetSchema = AudioAssetSchema> =
    | AudioBusUpsertedEvent
    | AudioBusRemovedEvent
    | AudioListenerUpsertedEvent
    | AudioListenerRemovedEvent
    | AudioListenerActivatedEvent
    | AudioSourceStateEvent<TSchema>
    | AudioSourceErrorEvent<TSchema>
    | AudioSnapshotCapturedEvent
    | AudioSnapshotRestoredEvent
    | AudioSystemLifecycleEvent;

export type AudioRuntimeEventChannel = 'audio:*' | AudioRuntimeEventType;

export type AudioRuntimeEventMap<TSchema extends AudioAssetSchema = AudioAssetSchema> = Readonly<
    {
        'audio:*': AudioRuntimeEvent<TSchema>;
    } & {
        [TType in AudioRuntimeEventType]: Extract<
            AudioRuntimeEvent<TSchema>,
            { readonly type: TType }
        >;
    }
>;

export type AudioEventEmitter<TSchema extends AudioAssetSchema = AudioAssetSchema> = IEventEmitter<
    AudioRuntimeEventMap<TSchema>
>;

export interface AudioDiagnosticsCounters {
    readonly emittedEventCount: number;
    readonly busMutationCount: number;
    readonly listenerMutationCount: number;
    readonly sourceMutationCount: number;
    readonly playbackCommandCount: number;
    readonly playbackCompletionCount: number;
    readonly playbackErrorCount: number;
    readonly snapshotOperationCount: number;
    readonly lifecycleTransitionCount: number;
}

export interface AudioDiagnosticsSnapshot<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly capturedAtEpochMs: number;
    readonly systemStatus: AudioSystemStatus;
    readonly activeListenerId?: AudioListenerId;
    readonly busCount: number;
    readonly listenerCount: number;
    readonly sourceCount: number;
    readonly activePlaybackCount: number;
    readonly counters: AudioDiagnosticsCounters;
    readonly lastEvent?: AudioRuntimeEvent<TSchema>;
}

export type AudioSourceComponentCommand<TSchema extends AudioAssetSchema = AudioAssetSchema> =
    | {
          readonly kind: 'play';
          readonly request?: AudioSourcePlayRequest<TSchema>;
      }
    | {
          readonly kind: 'pause';
      }
    | {
          readonly kind: 'resume';
      }
    | {
          readonly kind: 'stop';
          readonly options?: AudioStopOptions;
      };

export type AudioValidationMessageCode =
    | `audio.invalid-${
          | 'bus-id'
          | 'clip'
          | 'context'
          | 'distance'
          | 'gain'
          | 'listener'
          | 'pan'
          | 'parent-bus'
          | 'playback-rate'
          | 'source'
          | 'snapshot'
          | 'time'
          | 'vector'}`
    | 'audio.bus.cycle';

export type AudioRuntimeMessageCode =
    | 'audio.asset.resolve-failed'
    | 'audio.bus.missing'
    | 'audio.context.resume-failed'
    | 'audio.context.suspend-failed'
    | 'audio.disposed'
    | 'audio.listener.missing'
    | 'audio.snapshot.invalid'
    | 'audio.source.missing'
    | 'audio.source.play-failed'
    | 'audio.source.resume-failed'
    | 'audio.unavailable';

export type AudioMessageCode = AudioValidationMessageCode | AudioRuntimeMessageCode;

export type AudioMessageDescriptor =
    | {
          readonly code: 'audio.invalid-bus-id';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-clip';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-context';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-distance';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-gain';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-listener';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-pan';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-parent-bus';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-playback-rate';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-source';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-snapshot';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-time';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.invalid-vector';
          readonly value: unknown;
      }
    | {
          readonly code: 'audio.bus.cycle';
          readonly busId: string;
          readonly parentId: string;
      }
    | {
          readonly code: 'audio.asset.resolve-failed';
          readonly selector: unknown;
          readonly reason: unknown;
      }
    | {
          readonly code: 'audio.bus.missing';
          readonly busId: string;
      }
    | {
          readonly code: 'audio.context.resume-failed';
          readonly reason: unknown;
      }
    | {
          readonly code: 'audio.context.suspend-failed';
          readonly reason: unknown;
      }
    | {
          readonly code: 'audio.disposed';
      }
    | {
          readonly code: 'audio.listener.missing';
          readonly listenerId: string;
      }
    | {
          readonly code: 'audio.snapshot.invalid';
          readonly reason: string;
      }
    | {
          readonly code: 'audio.source.missing';
          readonly sourceId: string;
      }
    | {
          readonly code: 'audio.source.play-failed';
          readonly sourceId: string;
          readonly reason: unknown;
      }
    | {
          readonly code: 'audio.source.resume-failed';
          readonly sourceId: string;
          readonly reason: unknown;
      }
    | {
          readonly code: 'audio.unavailable';
          readonly reason: string;
      };

export type AudioMessageResolver = (
    descriptor: AudioMessageDescriptor,
    locale: string
) => string | undefined;
