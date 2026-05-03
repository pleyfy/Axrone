export {
    script,
    Script,
    getComponentMetadata,
    setComponentMetadata,
    getAllScripts,
    getDependencyTree,
    validateAllScripts,
    getScriptMetrics,
    clearScriptCaches,
    __debugScriptSystem,
} from './script';

export {
    property,
    getComponentPropertyMetadata,
    getComponentPropertyMetadataByKey,
    setComponentPropertyMetadata,
    clearComponentPropertyMetadataCaches,
} from './property';

export type { ScriptMetadata, ScriptDecoratorOptions, ValidationResult } from './script';
export type {
    PropertyMetadata,
    PropertyDecoratorOptions,
    PropertyTypeId,
    PropertyTypeReference,
} from './property';
