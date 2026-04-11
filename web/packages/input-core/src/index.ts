export const INPUT_CORE_CAPABILITY_ID = 'input/core';
export const INPUT_CORE_CAPABILITY_PACKAGE = '@axrone/input-core';
export const INPUT_CORE_OWNER_PACKAGE = '@axrone/input';

const INPUT_CORE_CAPABILITY = Object.freeze({
    id: INPUT_CORE_CAPABILITY_ID,
    packageName: INPUT_CORE_CAPABILITY_PACKAGE,
    ownerPackage: INPUT_CORE_OWNER_PACKAGE,
});

export type InputCoreCapability = typeof INPUT_CORE_CAPABILITY;

export const getInputCoreCapability = (): InputCoreCapability => INPUT_CORE_CAPABILITY;

export * from '@axrone/input';