import type {
    AudioAssetSchema,
    AudioBusId,
    AudioClipRecord,
    AudioJsonValue,
    AudioListenerId,
    AudioSourceId,
    AudioSourceState,
    AudioSpatialization,
    AudioVector3,
} from '../types';

export interface InternalBus {
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

export interface InternalListener {
    readonly id: AudioListenerId;
    active: boolean;
    enabled: boolean;
    position: AudioVector3;
    forward: AudioVector3;
    up: AudioVector3;
    metadata: Readonly<Record<string, AudioJsonValue>>;
}

export interface InternalPlayback<TSchema extends AudioAssetSchema = AudioAssetSchema> {
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

export interface InternalSource<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly id: AudioSourceId;
    busId: AudioBusId;
    clip?: import('../types').AudioClipSelector<TSchema>;
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
