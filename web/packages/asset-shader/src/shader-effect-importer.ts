import {
    AssetImportPipeline,
    type AssetImportPipelineOptions,
    type AssetImportResult,
    type AssetImportSource,
    type AssetImporter,
} from '@axrone/asset-core';
import { isPlainObject } from '@axrone/utility';
import {
    cloneRenderShaderEffectDefinition,
    compileRenderShaderEffect,
    type RenderShaderAttributeDefinition,
    type RenderShaderEffectDefinition,
    type RenderShaderInspectorControlDefinition,
    type RenderShaderInspectorOptionDefinition,
    type RenderShaderInterfaceDefinition,
    type RenderShaderLibraryDefinition,
    type RenderShaderPropertyDefinition,
    type RenderShaderSerializableValue,
    type RenderShaderStageDefinition,
    type RenderShaderStageName,
    type RenderShaderValueType,
} from '@axrone/render-core';

export type AssetShaderImportKind = 'shaderEffect';

export type AssetShaderImportSchema = {
    readonly [key: string]: unknown;
    readonly shaderEffect: RenderShaderEffectDefinition;
};

export type AssetShaderImportResult = AssetImportResult<
    AssetShaderImportSchema,
    AssetShaderImportKind
>;

export interface AssetShaderImportPipelineOptions
    extends Omit<AssetImportPipelineOptions<AssetShaderImportSchema>, 'importers'> {
    readonly importers?: readonly AssetImporter<AssetShaderImportSchema>[];
}

export interface ShaderEffectJsonSource {
    readonly format?: RenderShaderEffectDefinition['format'];
    readonly version?: RenderShaderEffectDefinition['version'];
    readonly id?: string;
    readonly attributes?: readonly unknown[];
    readonly varyings?: readonly unknown[];
    readonly properties?: readonly unknown[];
    readonly libraries?: readonly unknown[];
    readonly vertex?: unknown;
    readonly fragment?: unknown;
    readonly renderState?: unknown;
    readonly effect?: ShaderEffectJsonSource;
}

const SHADER_VALUE_TYPES = new Set<RenderShaderValueType>([
    'float',
    'vec2',
    'vec3',
    'vec4',
    'int',
    'ivec2',
    'ivec3',
    'ivec4',
    'uint',
    'uvec2',
    'uvec3',
    'uvec4',
    'bool',
    'bvec2',
    'bvec3',
    'bvec4',
    'mat3',
    'mat4',
    'sampler2D',
    'samplerCube',
]);
const SHADER_STAGE_NAMES = new Set<RenderShaderStageName>(['vertex', 'fragment']);
const INSPECTOR_CONTROL_TYPES = new Set<
    NonNullable<RenderShaderInspectorControlDefinition['control']>
>(['auto', 'color', 'slider', 'texture', 'toggle', 'select']);
const INTERFACE_INTERPOLATIONS = new Set<
    NonNullable<RenderShaderInterfaceDefinition['interpolation']>
>(['flat', 'smooth']);
const INSPECTOR_GROUP_FALLBACK = 'Properties';

const isShaderSerializableValue = (value: unknown): value is RenderShaderSerializableValue => {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return true;
    }

    if (Array.isArray(value)) {
        return value.every((entry) => isShaderSerializableValue(entry));
    }

    if (isPlainObject(value)) {
        return Object.values(value).every((entry) => isShaderSerializableValue(entry));
    }

    return false;
};

const readJsonLikeSource = (source: AssetImportSource): unknown => {
    if (source.kind === 'json') {
        return source.data;
    }

    if (source.kind === 'text') {
        return JSON.parse(source.data) as unknown;
    }

    throw new Error(`Unsupported shader effect import source kind: ${source.kind}`);
};

const deriveShaderEffectIdFromSource = (
    source: AssetImportSource,
    fallback: string = 'shader-effect'
): string => {
    const uri = source.uri?.trim();
    if (!uri) {
        return fallback;
    }

    const leaf = uri.split(/[\\/]/).pop() ?? fallback;
    return (
        leaf
            .replace(/\.effect\.json$/i, '')
            .replace(/\.shader\.json$/i, '')
            .replace(/\.json$/i, '')
            .replace(/\.[^.]+$/i, '') || fallback
    );
};

const ensurePlainObject = (value: unknown, label: string): Record<string, unknown> => {
    if (!isPlainObject(value)) {
        throw new Error(`${label} must be an object`);
    }

    return value;
};

const ensureString = (value: unknown, label: string): string => {
    if (typeof value !== 'string' || value.trim() === '') {
        throw new Error(`${label} must be a non-empty string`);
    }

    return value;
};

const ensureOptionalString = (value: unknown, label: string): string | undefined => {
    if (value === undefined) {
        return undefined;
    }

    return ensureString(value, label);
};

const ensureOptionalBoolean = (value: unknown, label: string): boolean | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'boolean') {
        throw new Error(`${label} must be a boolean`);
    }

    return value;
};

const ensureOptionalFiniteNumber = (value: unknown, label: string): number | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'number' || Number.isFinite(value) === false) {
        throw new Error(`${label} must be a finite number`);
    }

    return value;
};

const ensureOptionalPositiveInteger = (value: unknown, label: string): number | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value !== 'number' || Number.isInteger(value) === false || value <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }

    return value;
};

const ensureShaderValueType = (value: unknown, label: string): RenderShaderValueType => {
    const normalized = ensureString(value, label) as RenderShaderValueType;
    if (!SHADER_VALUE_TYPES.has(normalized)) {
        throw new Error(`${label} must be a supported shader value type`);
    }

    return normalized;
};

const ensureOptionalStringArray = (
    value: unknown,
    label: string
): readonly string[] | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (Array.isArray(value) === false) {
        throw new Error(`${label} must be an array of strings`);
    }

    return value.map((entry, index) => ensureString(entry, `${label}[${index}]`));
};

const ensureStageNames = (
    value: unknown,
    label: string
): readonly RenderShaderStageName[] | undefined => {
    const stages = ensureOptionalStringArray(value, label);
    if (!stages) {
        return undefined;
    }

    return stages.map((stage, index) => {
        const normalized = stage as RenderShaderStageName;
        if (!SHADER_STAGE_NAMES.has(normalized)) {
            throw new Error(`${label}[${index}] must be 'vertex' or 'fragment'`);
        }
        return normalized;
    });
};

const normalizeInspectorOptions = (
    value: unknown,
    label: string
): readonly RenderShaderInspectorOptionDefinition[] | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (Array.isArray(value) === false) {
        throw new Error(`${label} must be an array`);
    }

    return value.map((entry, index) => {
        const object = ensurePlainObject(entry, `${label}[${index}]`);
        const optionValue = object.value;
        if (
            typeof optionValue !== 'string' &&
            typeof optionValue !== 'number' &&
            typeof optionValue !== 'boolean'
        ) {
            throw new Error(`${label}[${index}].value must be a string, number, or boolean`);
        }

        return {
            label: ensureString(object.label, `${label}[${index}].label`),
            value: optionValue,
        };
    });
};

const normalizeInspector = (
    value: unknown,
    label: string
): RenderShaderInspectorControlDefinition | undefined => {
    if (value === undefined) {
        return undefined;
    }

    const object = ensurePlainObject(value, label);
    const control = object.control as RenderShaderInspectorControlDefinition['control'] | undefined;
    if (control !== undefined && !INSPECTOR_CONTROL_TYPES.has(control)) {
        throw new Error(`${label}.control must be a supported inspector control`);
    }

    return {
        label: ensureOptionalString(object.label, `${label}.label`),
        group: ensureOptionalString(object.group, `${label}.group`),
        control,
        min: ensureOptionalFiniteNumber(object.min, `${label}.min`),
        max: ensureOptionalFiniteNumber(object.max, `${label}.max`),
        step: ensureOptionalFiniteNumber(object.step, `${label}.step`),
        options: normalizeInspectorOptions(object.options, `${label}.options`),
        hidden: ensureOptionalBoolean(object.hidden, `${label}.hidden`),
    };
};

const normalizeInterfaces = (
    value: unknown,
    label: string
): readonly RenderShaderInterfaceDefinition[] | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (Array.isArray(value) === false) {
        throw new Error(`${label} must be an array`);
    }

    return value.map((entry, index) => {
        const object = ensurePlainObject(entry, `${label}[${index}]`);
        const interpolation = object.interpolation as
            | RenderShaderInterfaceDefinition['interpolation']
            | undefined;
        if (interpolation !== undefined && !INTERFACE_INTERPOLATIONS.has(interpolation)) {
            throw new Error(`${label}[${index}].interpolation must be 'flat' or 'smooth'`);
        }

        return {
            name: ensureString(object.name, `${label}[${index}].name`),
            type: ensureShaderValueType(object.type, `${label}[${index}].type`),
            interpolation,
        };
    });
};

const normalizeAttributes = (
    value: unknown,
    label: string
): readonly RenderShaderAttributeDefinition[] | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (Array.isArray(value) === false) {
        throw new Error(`${label} must be an array`);
    }

    return value.map((entry, index) => {
        const object = ensurePlainObject(entry, `${label}[${index}]`);
        const location = object.location;
        if (
            location !== undefined &&
            (typeof location !== 'number' || Number.isInteger(location) === false || location < 0)
        ) {
            throw new Error(`${label}[${index}].location must be a non-negative integer`);
        }

        return {
            name: ensureString(object.name, `${label}[${index}].name`),
            type: ensureShaderValueType(object.type, `${label}[${index}].type`),
            location,
        };
    });
};

const normalizeLibraries = (
    value: unknown,
    label: string
): readonly RenderShaderLibraryDefinition[] | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (Array.isArray(value) === false) {
        throw new Error(`${label} must be an array`);
    }

    return value.map((entry, index) => {
        const object = ensurePlainObject(entry, `${label}[${index}]`);
        const codeValue = object.code;
        let code: string | readonly string[];
        if (typeof codeValue === 'string') {
            code = codeValue;
        } else if (Array.isArray(codeValue)) {
            code = codeValue.map((line, lineIndex) =>
                ensureString(line, `${label}[${index}].code[${lineIndex}]`)
            );
        } else {
            throw new Error(`${label}[${index}].code must be a string or string array`);
        }

        return {
            id: ensureString(object.id, `${label}[${index}].id`),
            code,
        };
    });
};

const normalizeProperties = (
    value: unknown,
    label: string
): readonly RenderShaderPropertyDefinition[] | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (Array.isArray(value) === false) {
        throw new Error(`${label} must be an array`);
    }

    return value.map((entry, index) => {
        const object = ensurePlainObject(entry, `${label}[${index}]`);
        const scope = object.scope as RenderShaderPropertyDefinition['scope'] | undefined;
        if (
            scope !== undefined &&
            !['material', 'object', 'camera', 'frame', 'system', 'internal'].includes(scope)
        ) {
            throw new Error(`${label}[${index}].scope must be a supported property scope`);
        }

        const defaultValue = object.defaultValue;
        if (defaultValue !== undefined && !isShaderSerializableValue(defaultValue)) {
            throw new Error(`${label}[${index}].defaultValue must be JSON serializable`);
        }

        return {
            name: ensureString(object.name, `${label}[${index}].name`),
            type: ensureShaderValueType(object.type, `${label}[${index}].type`),
            arrayLength: ensureOptionalPositiveInteger(
                object.arrayLength,
                `${label}[${index}].arrayLength`
            ),
            stages: ensureStageNames(object.stages, `${label}[${index}].stages`),
            scope,
            defaultValue: defaultValue as RenderShaderSerializableValue | undefined,
            inspector: normalizeInspector(object.inspector, `${label}[${index}].inspector`),
        };
    });
};

const normalizeDeclarations = (
    value: unknown,
    label: string
): readonly (string | readonly string[])[] | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (Array.isArray(value) === false) {
        throw new Error(`${label} must be an array`);
    }

    return value.map((entry, index) => {
        if (typeof entry === 'string') {
            return entry;
        }
        if (Array.isArray(entry)) {
            return entry.map((line, lineIndex) =>
                ensureString(line, `${label}[${index}][${lineIndex}]`)
            );
        }

        throw new Error(`${label}[${index}] must be a string or string array`);
    });
};

const normalizeStage = (
    value: unknown,
    label: string
): RenderShaderStageDefinition => {
    const object = ensurePlainObject(value, label);
    const precision = object.precision as RenderShaderStageDefinition['precision'] | undefined;
    if (precision !== undefined && !['lowp', 'mediump', 'highp'].includes(precision)) {
        throw new Error(`${label}.precision must be 'lowp', 'mediump', or 'highp'`);
    }

    return {
        version: ensureOptionalString(object.version, `${label}.version`),
        precision,
        directives: ensureOptionalStringArray(object.directives, `${label}.directives`),
        inputs: normalizeInterfaces(object.inputs, `${label}.inputs`),
        outputs: normalizeInterfaces(object.outputs, `${label}.outputs`),
        declarations: normalizeDeclarations(object.declarations, `${label}.declarations`),
        includes: ensureOptionalStringArray(object.includes, `${label}.includes`),
        main: ensureOptionalStringArray(object.main, `${label}.main`) ?? [],
    };
};

const normalizeRenderState = (
    value: unknown,
    label: string
): RenderShaderEffectDefinition['renderState'] => {
    if (value === undefined) {
        return undefined;
    }

    const object = ensurePlainObject(value, label);
    return {
        depthTest: ensureOptionalBoolean(object.depthTest, `${label}.depthTest`),
        cull: ensureOptionalBoolean(object.cull, `${label}.cull`),
        blend: ensureOptionalBoolean(object.blend, `${label}.blend`),
    };
};

export const normalizeShaderEffectJsonSource = (
    source: AssetImportSource,
    payload: unknown
): RenderShaderEffectDefinition => {
    const root = ensurePlainObject(payload, 'Shader effect payload');
    const candidate = root.effect
        ? ensurePlainObject(root.effect, 'Shader effect payload.effect')
        : root;
    const format = candidate.format;
    if (format !== undefined && format !== 'axrone.shader/effect') {
        throw new Error('Shader effect payload.format must be axrone.shader/effect');
    }

    const version = candidate.version;
    if (version !== undefined && version !== 1) {
        throw new Error('Shader effect payload.version must be 1');
    }

    const definition: RenderShaderEffectDefinition = {
        format: 'axrone.shader/effect',
        version: 1,
        id:
            typeof candidate.id === 'string' && candidate.id.trim() !== ''
                ? candidate.id
                : deriveShaderEffectIdFromSource(source),
        attributes: normalizeAttributes(candidate.attributes, 'Shader effect payload.attributes'),
        varyings: normalizeInterfaces(candidate.varyings, 'Shader effect payload.varyings'),
        properties: normalizeProperties(candidate.properties, 'Shader effect payload.properties'),
        libraries: normalizeLibraries(candidate.libraries, 'Shader effect payload.libraries'),
        vertex: normalizeStage(candidate.vertex, 'Shader effect payload.vertex'),
        fragment: normalizeStage(candidate.fragment, 'Shader effect payload.fragment'),
        renderState: normalizeRenderState(
            candidate.renderState,
            'Shader effect payload.renderState'
        ),
    };

    compileRenderShaderEffect(definition);
    return cloneRenderShaderEffectDefinition(definition);
};

export const createShaderEffectJsonImporter = (): AssetImporter<AssetShaderImportSchema> => ({
    id: 'asset-shader.effect.json',
    priority: 20,
    sourceKinds: ['json', 'text'],
    extensions: ['effect.json', 'shader.json', 'json'],
    canImport: ({ source }) => {
        try {
            normalizeShaderEffectJsonSource(source, readJsonLikeSource(source));
            return true;
        } catch {
            return false;
        }
    },
    import: ({ source }) => {
        const definition = normalizeShaderEffectJsonSource(source, readJsonLikeSource(source));
        return {
            primary: {
                kind: 'shaderEffect',
                data: definition,
                name: definition.id,
                metadata: source.uri
                    ? {
                          uri: source.uri,
                          mimeType: source.mimeType,
                          properties: {
                              inspectorGroup: INSPECTOR_GROUP_FALLBACK,
                          },
                      }
                    : undefined,
            },
        };
    },
});

export const createAssetShaderImportPipeline = (
    options: AssetShaderImportPipelineOptions = {}
): AssetImportPipeline<AssetShaderImportSchema> =>
    new AssetImportPipeline<AssetShaderImportSchema>({
        ...options,
        importers: [createShaderEffectJsonImporter(), ...(options.importers ?? [])],
    });
