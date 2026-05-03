import { syncPlaybackSpatialState } from './spatial';
import type {
    InternalListener,
    InternalPlayback,
    InternalSource,
} from './runtime';
import { disconnectNode } from './shared';
import type { AudioAssetSchema, AudioClipRecord } from '../types';

export interface AudioPlaybackStartOptions<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    readonly sequence: number;
    readonly clip: AudioClipRecord<TSchema>;
    readonly busNode: AudioNode;
    readonly when: number;
    readonly offsetSeconds: number;
    readonly durationSeconds?: number;
    readonly onEnded: () => void;
}

export class AudioPlaybackRuntime<TSchema extends AudioAssetSchema = AudioAssetSchema> {
    constructor(readonly context: AudioContext) {}

    startPlayback(
        source: InternalSource<TSchema>,
        options: AudioPlaybackStartOptions<TSchema>
    ): InternalPlayback<TSchema> {
        const sourceNode = this.context.createBufferSource();
        sourceNode.buffer = options.clip.buffer;
        sourceNode.loop = source.loop;
        sourceNode.playbackRate.value = source.playbackRate;
        sourceNode.detune.value = source.detuneCents;
        if (options.clip.loopStartSeconds !== undefined) {
            sourceNode.loopStart = options.clip.loopStartSeconds;
        }
        if (options.clip.loopEndSeconds !== undefined) {
            sourceNode.loopEnd = options.clip.loopEndSeconds;
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

        outputNode.connect(options.busNode);

        const playback: InternalPlayback<TSchema> = {
            sequence: options.sequence,
            sourceNode,
            gainNode,
            attenuationNode,
            spatialNode,
            outputNode,
            clip: options.clip,
            durationSeconds: options.durationSeconds,
            startOffsetSeconds: options.offsetSeconds,
            startedAtContextTime: options.when,
            control: 'playing',
        };

        sourceNode.onended = options.onEnded;

        try {
            if (options.durationSeconds !== undefined && options.durationSeconds > 0) {
                sourceNode.start(options.when, options.offsetSeconds, options.durationSeconds);
            } else {
                sourceNode.start(options.when, options.offsetSeconds);
            }
        } catch (error) {
            this.disposePlayback(playback);
            throw error;
        }

        return playback;
    }

    syncPlayback(
        source: InternalSource<TSchema>,
        listener: InternalListener | undefined
    ): void {
        if (!source.active) {
            return;
        }

        source.active.sourceNode.playbackRate.value = source.playbackRate;
        source.active.sourceNode.detune.value = source.detuneCents;
        syncPlaybackSpatialState(source.active, source, listener);
    }

    reconnectPlayback(playback: InternalPlayback<TSchema>, busNode: AudioNode): void {
        disconnectNode(playback.outputNode);
        playback.outputNode.connect(busNode);
    }

    disposePlayback(playback: InternalPlayback<TSchema>): void {
        playback.sourceNode.onended = null;
        disconnectNode(playback.sourceNode);
        disconnectNode(playback.gainNode);
        disconnectNode(playback.attenuationNode);
        disconnectNode(playback.spatialNode);
    }
}
