export const LightKind = Object.freeze({
    Directional: 'directional',
    Point: 'point',
    Spot: 'spot',
} as const);

export type LightKind = (typeof LightKind)[keyof typeof LightKind];

export const LightKinds = Object.freeze([
    LightKind.Directional,
    LightKind.Point,
    LightKind.Spot,
] as const);

export const LightSortMode = Object.freeze({
    None: 'none',
    Priority: 'priority',
    Influence: 'influence',
} as const);

export type LightSortMode = (typeof LightSortMode)[keyof typeof LightSortMode];

export const LightTypeCode = Object.freeze({
    [LightKind.Directional]: 0,
    [LightKind.Point]: 1,
    [LightKind.Spot]: 2,
} as const satisfies Record<LightKind, number>);

export type LightTypeCode<K extends LightKind = LightKind> = (typeof LightTypeCode)[K];

export const LightingDocumentVersion = 1 as const;
export type LightingDocumentVersion = typeof LightingDocumentVersion;