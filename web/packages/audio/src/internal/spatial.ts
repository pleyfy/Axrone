import { cloneAudioVector3 } from '../reference';
import type {
    Audio3DSpatialization,
    AudioSpatialAttenuation,
    AudioSpatialization,
    AudioVector3,
} from '../types';
import {
    clamp,
    DEFAULT_LISTENER_FORWARD,
    DEFAULT_LISTENER_POSITION,
    DEFAULT_LISTENER_UP,
    isFiniteNumber,
    normalizeVector3,
} from './shared';

export interface AudioSpatialListenerState {
    readonly enabled: boolean;
    readonly position: AudioVector3;
    readonly forward: AudioVector3;
    readonly up: AudioVector3;
}

export interface AudioSpatialPlaybackNodes {
    readonly gainNode: GainNode;
    readonly attenuationNode: GainNode;
    readonly spatialNode?: StereoPannerNode | PannerNode;
}

export interface AudioSpatialSourceState {
    readonly muted: boolean;
    readonly volume: number;
    readonly pan: number;
    readonly spatial?: AudioSpatialization;
}

export const DEFAULT_ATTENUATION = Object.freeze({
    model: 'inverse',
    refDistance: 1,
    maxDistance: 10000,
    rolloffFactor: 1,
    minGain: 0,
} satisfies Required<AudioSpatialAttenuation>);

const isStereoPannerNode = (value: unknown): value is StereoPannerNode =>
    typeof StereoPannerNode !== 'undefined' && value instanceof StereoPannerNode;

const isPannerNode = (value: unknown): value is PannerNode =>
    typeof PannerNode !== 'undefined' && value instanceof PannerNode;

export const cloneSpatialization = (
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

export const normalizeAttenuation = (
    value: AudioSpatialAttenuation | undefined
): Required<AudioSpatialAttenuation> => ({
    model: value?.model ?? DEFAULT_ATTENUATION.model,
    refDistance: isFiniteNumber(value?.refDistance)
        ? Math.max(0.0001, value.refDistance)
        : DEFAULT_ATTENUATION.refDistance,
    maxDistance: isFiniteNumber(value?.maxDistance)
        ? Math.max(0.0001, value.maxDistance)
        : DEFAULT_ATTENUATION.maxDistance,
    rolloffFactor: isFiniteNumber(value?.rolloffFactor)
        ? Math.max(0, value.rolloffFactor)
        : DEFAULT_ATTENUATION.rolloffFactor,
    minGain: isFiniteNumber(value?.minGain)
        ? clamp(value.minGain, 0, 1)
        : DEFAULT_ATTENUATION.minGain,
});

export const attenuationGainForDistance = (
    distance: number,
    value: AudioSpatialAttenuation | undefined
): number => {
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

export const syncAudioListenerToContext = (
    audioListener: AudioListener,
    target?: AudioSpatialListenerState
): void => {
    const position = target?.position ?? DEFAULT_LISTENER_POSITION;
    const forward = target?.forward ?? DEFAULT_LISTENER_FORWARD;
    const up = target?.up ?? DEFAULT_LISTENER_UP;

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
};

export const applyPannerState = (
    panner: PannerNode,
    spatial: Audio3DSpatialization,
    position: AudioVector3,
    orientation: AudioVector3
): void => {
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
};

export const syncPlaybackSpatialState = (
    playback: AudioSpatialPlaybackNodes,
    source: AudioSpatialSourceState,
    listener?: AudioSpatialListenerState
): void => {
    playback.gainNode.gain.value = source.muted ? 0 : source.volume;

    if (!source.spatial) {
        playback.attenuationNode.gain.value = 1;
        if (isStereoPannerNode(playback.spatialNode)) {
            playback.spatialNode.pan.value = source.pan;
        }
        return;
    }

    if (source.spatial.mode === '2d') {
        const position = normalizeVector3(source.spatial.position, DEFAULT_LISTENER_POSITION);
        const listenerPosition = listener?.position ?? DEFAULT_LISTENER_POSITION;
        playback.attenuationNode.gain.value = listener?.enabled
            ? attenuationGainForDistance(distance2D(position, listenerPosition), source.spatial.attenuation)
            : 1;
        if (isStereoPannerNode(playback.spatialNode)) {
            playback.spatialNode.pan.value = effectivePanFor2D(
                position,
                listenerPosition,
                source.pan + (source.spatial.pan ?? 0),
                source.spatial.attenuation
            );
        }
        return;
    }

    const position = normalizeVector3(source.spatial.position, DEFAULT_LISTENER_POSITION);
    const orientation = normalizeVector3(source.spatial.orientation, DEFAULT_LISTENER_FORWARD);
    const listenerPosition = listener?.position ?? DEFAULT_LISTENER_POSITION;
    playback.attenuationNode.gain.value = listener?.enabled
        ? attenuationGainForDistance(distance3D(position, listenerPosition), source.spatial.attenuation)
        : 1;
    if (isPannerNode(playback.spatialNode)) {
        applyPannerState(playback.spatialNode, source.spatial, position, orientation);
    }
};
