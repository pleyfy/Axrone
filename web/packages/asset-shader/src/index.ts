export const ASSET_SHADER_CAPABILITY_ID = 'asset/shader';
export const ASSET_SHADER_CAPABILITY_PACKAGE = '@axrone/asset-shader';
export const ASSET_SHADER_OWNER_PACKAGE = '@axrone/asset-core';

const ASSET_SHADER_CAPABILITY = Object.freeze({
    id: ASSET_SHADER_CAPABILITY_ID,
    packageName: ASSET_SHADER_CAPABILITY_PACKAGE,
    ownerPackage: ASSET_SHADER_OWNER_PACKAGE,
});

export type AssetShaderCapability = typeof ASSET_SHADER_CAPABILITY;

export const getAssetShaderCapability = (): AssetShaderCapability => ASSET_SHADER_CAPABILITY;

export type {
    AssetShaderImportKind,
    AssetShaderImportPipelineOptions,
    AssetShaderImportResult,
    AssetShaderImportSchema,
    ShaderEffectJsonSource,
} from './shader-effect-importer';
export {
    createAssetShaderImportPipeline,
    createShaderEffectJsonImporter,
    normalizeShaderEffectJsonSource,
} from './shader-effect-importer';

export type {
    CompiledRenderShaderEffect,
    RenderShaderAttributeDefinition,
    RenderShaderEffectDefinition,
    RenderShaderEffectRenderStateDefinition,
    RenderShaderInspectorControlDefinition,
    RenderShaderInspectorOptionDefinition,
    RenderShaderInterfaceDefinition,
    RenderShaderLibraryDefinition,
    RenderShaderPropertyDefinition,
    RenderShaderSerializableValue,
    RenderShaderStageDefinition,
    RenderShaderStageName,
    RenderShaderValueType,
} from '@axrone/render-core';
export {
    cloneRenderShaderEffectDefinition,
    compileRenderShaderEffect,
} from '@axrone/render-core';

export * from '@axrone/asset-core';
