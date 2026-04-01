export * from './base-material';

export * from './standard-material';
export * from './pbr-material';

export * from './material-manager';

export type {
    MaterialPropertyValue,
    MaterialProperty,
    MaterialKeyword,
    MaterialConfig,
    StandardMaterialConfig,
    PBRMaterialConfig,
    UnlitMaterialConfig,
} from './base-material';

export {
    MaterialType,
    BlendMode,
    CullMode,
    DepthTest,
    ShadowCasting,
    LightMode,
} from './base-material';

export { StandardMaterialComponent as StandardMaterial } from './standard-material';
export { PBRMaterialComponent as PBRMaterial } from './pbr-material';
export { materialManager } from './material-manager';

export { createMaterial, getMaterial, destroyMaterial, cloneMaterial } from './material-manager';
