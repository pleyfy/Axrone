import type { Brand } from '@axrone/utility';
import type { LightKind } from './constants';

export type LightingRigId = Brand<string, 'LightingRigId'>;
export type LightingVersion = Brand<number, 'LightingVersion'>;
export type LightId<K extends LightKind = LightKind> = Brand<string, `LightId:${K}`>;

export const brandLightingRigId = (value: string): LightingRigId => value as LightingRigId;
export const brandLightingVersion = (value: number): LightingVersion =>
    value as LightingVersion;
export const brandLightId = <K extends LightKind>(kind: K, value: string): LightId<K> =>
    value as LightId<K>;