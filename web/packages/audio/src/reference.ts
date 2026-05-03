import { createAssetReference, isAssetReference } from '@axrone/asset-core';
import type { AssetId, AssetRecord, AssetReference } from '@axrone/asset-core';
import type {
    AudioAssetSchema,
    AudioBusId,
    AudioClipId,
    AudioListenerId,
    AudioSnapshotId,
    AudioSourceId,
    AudioVector3,
} from './types';

const normalizeIdentifier = (value: string, label: string): string => {
    const normalized = value.trim();
    if (normalized.length === 0) {
        throw new TypeError(`${label} cannot be empty`);
    }

    return normalized;
};

export const asAudioBusId = (value: string): AudioBusId => value as AudioBusId;
export const asAudioClipId = (value: string): AudioClipId => value as AudioClipId;
export const asAudioListenerId = (value: string): AudioListenerId => value as AudioListenerId;
export const asAudioSourceId = (value: string): AudioSourceId => value as AudioSourceId;
export const asAudioSnapshotId = (value: string): AudioSnapshotId => value as AudioSnapshotId;

export const MASTER_AUDIO_BUS_ID = asAudioBusId('master');

export const normalizeAudioBusId = (value: string | AudioBusId): AudioBusId =>
    asAudioBusId(normalizeIdentifier(String(value), 'Audio bus id'));

export const normalizeAudioClipId = (value: string | AudioClipId): AudioClipId =>
    asAudioClipId(normalizeIdentifier(String(value), 'Audio clip id'));

export const normalizeAudioListenerId = (value: string | AudioListenerId): AudioListenerId =>
    asAudioListenerId(normalizeIdentifier(String(value), 'Audio listener id'));

export const normalizeAudioSourceId = (value: string | AudioSourceId): AudioSourceId =>
    asAudioSourceId(normalizeIdentifier(String(value), 'Audio source id'));

export const normalizeAudioSnapshotId = (value: string | AudioSnapshotId): AudioSnapshotId =>
    asAudioSnapshotId(normalizeIdentifier(String(value), 'Audio snapshot id'));

export const createAudioClipAssetReference = (id: AssetId): AssetReference<'audioClip'> =>
    createAssetReference('audioClip', id);

export const isAudioClipAssetReference = (value: unknown): value is AssetReference<'audioClip'> =>
    isAssetReference(value) && value.kind === 'audioClip';

export const isAudioClipAssetRecord = <TSchema extends AudioAssetSchema = AudioAssetSchema>(
    value: unknown
): value is AssetRecord<TSchema> =>
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as AssetRecord<TSchema>).kind === 'audioClip' &&
    'data' in value;

export const cloneAudioVector3 = (value: AudioVector3 | undefined, fallback?: AudioVector3): AudioVector3 => {
    const source = value ?? fallback ?? { x: 0, y: 0, z: 0 };
    return {
        x: Number(source.x) || 0,
        y: Number(source.y) || 0,
        z: Number(source.z) || 0,
    };
};