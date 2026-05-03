import type { LightKind } from './constants';
import type { LightDefinition, LightingEnvironment } from './types';
import type { LightingRigId, LightingVersion } from './brands';

export interface InternalLightRecord<K extends LightKind = LightKind> {
    readonly definition: LightDefinition<K>;
    readonly sequence: number;
}

export interface LightingRigSnapshot {
    readonly id: LightingRigId;
    readonly version: LightingVersion;
    readonly environment: LightingEnvironment;
    readonly entries: readonly InternalLightRecord[];
}

export const LIGHTING_RIG_ACCESS: unique symbol = Symbol('AXRONE_LIGHTING_RIG_ACCESS');

export interface LightingRigReadable {
    readonly [LIGHTING_RIG_ACCESS]: () => LightingRigSnapshot;
}