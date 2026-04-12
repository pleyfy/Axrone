export type Brand<T, TTag extends string> = T & { readonly __brand: TTag };

export type AnimationRigId = Brand<string, 'AnimationRigId'>;
export type AnimationClipId = Brand<string, 'AnimationClipId'>;
export type AnimationLayerId = Brand<string, 'AnimationLayerId'>;
export type AnimationStateId = Brand<string, 'AnimationStateId'>;
export type AnimationParameterId = Brand<string, 'AnimationParameterId'>;
export type AnimationCurveId = Brand<string, 'AnimationCurveId'>;
export type AnimationIkJobId = Brand<string, 'AnimationIkJobId'>;
export type AnimationRetargetProfileId = Brand<string, 'AnimationRetargetProfileId'>;

export const brandString = <TTag extends string>(value: string): Brand<string, TTag> =>
    value as Brand<string, TTag>;