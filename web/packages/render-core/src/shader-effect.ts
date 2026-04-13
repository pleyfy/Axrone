import { RenderValidationError } from './errors';

export type RenderShaderStageName = 'vertex' | 'fragment';
export type RenderShaderValueType =
    | 'float'
    | 'vec2'
    | 'vec3'
    | 'vec4'
    | 'int'
    | 'ivec2'
    | 'ivec3'
    | 'ivec4'
    | 'uint'
    | 'uvec2'
    | 'uvec3'
    | 'uvec4'
    | 'bool'
    | 'bvec2'
    | 'bvec3'
    | 'bvec4'
    | 'mat3'
    | 'mat4'
    | 'sampler2D'
    | 'samplerCube';

export type RenderShaderSerializableValue =
    | string
    | number
    | boolean
    | null
    | readonly RenderShaderSerializableValue[]
    | { readonly [key: string]: RenderShaderSerializableValue };

export interface RenderShaderInspectorOptionDefinition {
    readonly label: string;
    readonly value: string | number | boolean;
}

export interface RenderShaderInspectorControlDefinition {
    readonly label?: string;
    readonly group?: string;
    readonly control?: 'auto' | 'color' | 'slider' | 'texture' | 'toggle' | 'select';
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly options?: readonly RenderShaderInspectorOptionDefinition[];
    readonly hidden?: boolean;
}

export interface RenderShaderPropertyDefinition {
    readonly name: string;
    readonly type: RenderShaderValueType;
    readonly arrayLength?: number;
    readonly stages?: readonly RenderShaderStageName[];
    readonly scope?: 'material' | 'object' | 'camera' | 'frame' | 'system' | 'internal';
    readonly defaultValue?: RenderShaderSerializableValue;
    readonly inspector?: RenderShaderInspectorControlDefinition;
}

export interface RenderShaderInterfaceDefinition {
    readonly name: string;
    readonly type: RenderShaderValueType;
    readonly interpolation?: 'flat' | 'smooth';
}

export interface RenderShaderAttributeDefinition {
    readonly name: string;
    readonly type: RenderShaderValueType;
    readonly location?: number;
}

export interface RenderShaderLibraryDefinition {
    readonly id: string;
    readonly code: string | readonly string[];
}

export interface RenderShaderStageDefinition {
    readonly version?: string;
    readonly precision?: 'lowp' | 'mediump' | 'highp';
    readonly directives?: readonly string[];
    readonly inputs?: readonly RenderShaderInterfaceDefinition[];
    readonly outputs?: readonly RenderShaderInterfaceDefinition[];
    readonly declarations?: readonly (string | readonly string[])[];
    readonly includes?: readonly string[];
    readonly main: readonly string[];
}

export interface RenderShaderEffectRenderStateDefinition {
    readonly depthTest?: boolean;
    readonly cull?: boolean;
    readonly blend?: boolean;
}

export interface RenderShaderEffectDefinition {
    readonly format: 'axrone.shader/effect';
    readonly version: 1;
    readonly id: string;
    readonly attributes?: readonly RenderShaderAttributeDefinition[];
    readonly varyings?: readonly RenderShaderInterfaceDefinition[];
    readonly properties?: readonly RenderShaderPropertyDefinition[];
    readonly libraries?: readonly RenderShaderLibraryDefinition[];
    readonly vertex: RenderShaderStageDefinition;
    readonly fragment: RenderShaderStageDefinition;
    readonly renderState?: RenderShaderEffectRenderStateDefinition;
}

export interface CompiledRenderShaderEffect {
    readonly id: string;
    readonly vertexSource: string;
    readonly fragmentSource: string;
    readonly uniformNames: readonly string[];
}

const DEFAULT_SHADER_VERSION = '300 es';
const SHADER_STAGES = Object.freeze(['vertex', 'fragment'] as const);

const toArray = (
    value: string | readonly string[] | undefined
): readonly string[] | undefined => {
    if (typeof value === 'string') {
        return [value];
    }

    return value ? [...value] : undefined;
};

const flattenDeclarations = (
    declarations: readonly (string | readonly string[])[] | undefined
): string[] => {
    if (!declarations) {
        return [];
    }

    const lines: string[] = [];
    for (const declaration of declarations) {
        if (typeof declaration === 'string') {
            lines.push(declaration);
            continue;
        }

        lines.push(...declaration);
    }

    return lines;
};

const cloneInspector = (
    value: RenderShaderInspectorControlDefinition | undefined
): RenderShaderInspectorControlDefinition | undefined =>
    value
        ? {
              label: value.label,
              group: value.group,
              control: value.control,
              min: value.min,
              max: value.max,
              step: value.step,
                            options: value.options
                                    ? value.options.map((option) => ({
                                                label: option.label,
                                                value: option.value,
                                        }))
                                    : undefined,
              hidden: value.hidden,
          }
        : undefined;

const cloneInterfaces = (
    value: readonly RenderShaderInterfaceDefinition[] | undefined
): readonly RenderShaderInterfaceDefinition[] | undefined =>
    value?.map((entry) => ({
        name: entry.name,
        type: entry.type,
        interpolation: entry.interpolation,
    }));

const cloneAttributes = (
    value: readonly RenderShaderAttributeDefinition[] | undefined
): readonly RenderShaderAttributeDefinition[] | undefined =>
    value?.map((entry) => ({
        name: entry.name,
        type: entry.type,
        location: entry.location,
    }));

const cloneProperties = (
    value: readonly RenderShaderPropertyDefinition[] | undefined
): readonly RenderShaderPropertyDefinition[] | undefined =>
    value?.map((entry) => ({
        name: entry.name,
        type: entry.type,
        arrayLength: entry.arrayLength,
        stages: entry.stages ? [...entry.stages] : undefined,
        scope: entry.scope,
        defaultValue: entry.defaultValue,
        inspector: cloneInspector(entry.inspector),
    }));

const cloneLibraries = (
    value: readonly RenderShaderLibraryDefinition[] | undefined
): readonly RenderShaderLibraryDefinition[] | undefined =>
    value?.map((entry) => ({
        id: entry.id,
        code: typeof entry.code === 'string' ? entry.code : [...entry.code],
    }));

const cloneStage = (stage: RenderShaderStageDefinition): RenderShaderStageDefinition => ({
    version: stage.version,
    precision: stage.precision,
    directives: stage.directives ? [...stage.directives] : undefined,
    inputs: cloneInterfaces(stage.inputs),
    outputs: cloneInterfaces(stage.outputs),
    declarations: stage.declarations
        ? stage.declarations.map((entry) =>
              typeof entry === 'string' ? entry : [...entry]
          )
        : undefined,
    includes: stage.includes ? [...stage.includes] : undefined,
    main: [...stage.main],
});

const formatInterfaceLine = (
    direction: 'in' | 'out',
    definition: RenderShaderInterfaceDefinition
): string => {
    const interpolation =
        definition.interpolation && definition.interpolation !== 'smooth'
            ? `${definition.interpolation} `
            : '';

    return `${interpolation}${direction} ${definition.type} ${definition.name};`;
};

const toStageSet = (
    stages: readonly RenderShaderStageName[] | undefined
): ReadonlySet<RenderShaderStageName> =>
    new Set<RenderShaderStageName>(
        stages && stages.length > 0 ? stages : SHADER_STAGES
    );

const collectLibraries = (
    effect: RenderShaderEffectDefinition,
    includeIds: readonly string[] | undefined
): string[] => {
    if (!includeIds || includeIds.length === 0) {
        return [];
    }

    const libraryMap = new Map<string, string | readonly string[]>();
    for (const library of effect.libraries ?? []) {
        if (libraryMap.has(library.id)) {
            throw new RenderValidationError('INVALID_EFFECT', 'en', {
                effectId: effect.id,
                libraryId: library.id,
                reason: 'duplicate-library',
            });
        }

        libraryMap.set(library.id, library.code);
    }

    const lines: string[] = [];
    for (const includeId of includeIds) {
        const libraryCode = libraryMap.get(includeId);
        if (!libraryCode) {
            throw new RenderValidationError('INVALID_EFFECT', 'en', {
                effectId: effect.id,
                libraryId: includeId,
                reason: 'missing-library',
            });
        }

        if (typeof libraryCode === 'string') {
            lines.push(libraryCode);
            continue;
        }

        lines.push(...libraryCode);
    }

    return lines;
};

const collectUniformDeclarations = (
    effect: RenderShaderEffectDefinition,
    stage: RenderShaderStageName
): string[] => {
    const declarations = new Map<string, string>();

    for (const property of effect.properties ?? []) {
        const stageSet = toStageSet(property.stages);
        if (!stageSet.has(stage)) {
            continue;
        }

        const arraySuffix =
            property.arrayLength !== undefined
                ? (() => {
                      if (
                          Number.isInteger(property.arrayLength) === false ||
                          property.arrayLength <= 0
                      ) {
                          throw new RenderValidationError('INVALID_EFFECT', 'en', {
                              effectId: effect.id,
                              property: property.name,
                              reason: 'invalid-uniform-array-length',
                          });
                      }

                      return `[${property.arrayLength}]`;
                  })()
                : '';
        const line = `uniform ${property.type} ${property.name}${arraySuffix};`;
        const previous = declarations.get(property.name);
        if (previous && previous !== line) {
            throw new RenderValidationError('INVALID_EFFECT', 'en', {
                effectId: effect.id,
                property: property.name,
                reason: 'conflicting-uniform',
            });
        }

        declarations.set(property.name, line);
    }

    return [...declarations.values()];
};

const collectInterfaceDeclarations = (
    effect: RenderShaderEffectDefinition,
    stage: RenderShaderStageName,
    direction: 'in' | 'out'
): string[] => {
    const definitions = new Map<string, string>();
    const sourceDefinitions: RenderShaderInterfaceDefinition[] = [];

    if (stage === 'vertex' && direction === 'out') {
        sourceDefinitions.push(...(effect.varyings ?? []));
    }

    if (stage === 'fragment' && direction === 'in') {
        sourceDefinitions.push(...(effect.varyings ?? []));
    }

    const stageDefinitions =
        direction === 'in'
            ? effect[stage].inputs ?? []
            : effect[stage].outputs ?? [];
    sourceDefinitions.push(...stageDefinitions);

    for (const definition of sourceDefinitions) {
        const line = formatInterfaceLine(direction, definition);
        const previous = definitions.get(definition.name);
        if (previous && previous !== line) {
            throw new RenderValidationError('INVALID_EFFECT', 'en', {
                effectId: effect.id,
                interfaceName: definition.name,
                direction,
                stage,
                reason: 'conflicting-interface',
            });
        }

        definitions.set(definition.name, line);
    }

    return [...definitions.values()];
};

const collectAttributeDeclarations = (effect: RenderShaderEffectDefinition): string[] => {
    const declarations = new Map<string, string>();

    for (const attribute of effect.attributes ?? []) {
        const prefix =
            attribute.location !== undefined
                ? `layout(location = ${attribute.location}) `
                : '';
        const line = `${prefix}in ${attribute.type} ${attribute.name};`;
        const previous = declarations.get(attribute.name);
        if (previous && previous !== line) {
            throw new RenderValidationError('INVALID_EFFECT', 'en', {
                effectId: effect.id,
                attribute: attribute.name,
                reason: 'conflicting-attribute',
            });
        }

        declarations.set(attribute.name, line);
    }

    return [...declarations.values()];
};

const buildStageSource = (
    effect: RenderShaderEffectDefinition,
    stageName: RenderShaderStageName
): string => {
    const stage = effect[stageName];
    const sections: string[] = [];

    sections.push(`#version ${stage.version ?? DEFAULT_SHADER_VERSION}`);

    if (stage.directives?.length) {
        sections.push(stage.directives.join('\n'));
    }

    if (stage.precision) {
        sections.push(`precision ${stage.precision} float;`);
    }

    if (stageName === 'vertex') {
        const attributeLines = collectAttributeDeclarations(effect);
        if (attributeLines.length > 0) {
            sections.push(attributeLines.join('\n'));
        }
    }

    const inputLines = collectInterfaceDeclarations(effect, stageName, 'in');
    if (inputLines.length > 0) {
        sections.push(inputLines.join('\n'));
    }

    const outputLines = collectInterfaceDeclarations(effect, stageName, 'out');
    if (outputLines.length > 0) {
        sections.push(outputLines.join('\n'));
    }

    const uniformLines = collectUniformDeclarations(effect, stageName);
    if (uniformLines.length > 0) {
        sections.push(uniformLines.join('\n'));
    }

    const declarationLines = flattenDeclarations(stage.declarations);
    if (declarationLines.length > 0) {
        sections.push(declarationLines.join('\n'));
    }

    const libraryLines = collectLibraries(effect, stage.includes);
    if (libraryLines.length > 0) {
        sections.push(libraryLines.join('\n'));
    }

    sections.push(`void main() {\n${stage.main.map((line) => `    ${line}`).join('\n')}\n}`);

    return sections.join('\n\n');
};

export const cloneRenderShaderEffectDefinition = (
    effect: RenderShaderEffectDefinition
): RenderShaderEffectDefinition => ({
    format: effect.format,
    version: effect.version,
    id: effect.id,
    attributes: cloneAttributes(effect.attributes),
    varyings: cloneInterfaces(effect.varyings),
    properties: cloneProperties(effect.properties),
    libraries: cloneLibraries(effect.libraries),
    vertex: cloneStage(effect.vertex),
    fragment: cloneStage(effect.fragment),
    renderState: effect.renderState
        ? {
              depthTest: effect.renderState.depthTest,
              cull: effect.renderState.cull,
              blend: effect.renderState.blend,
          }
        : undefined,
});

export const compileRenderShaderEffect = (
    effect: RenderShaderEffectDefinition
): CompiledRenderShaderEffect => ({
    id: effect.id,
    vertexSource: buildStageSource(effect, 'vertex'),
    fragmentSource: buildStageSource(effect, 'fragment'),
    uniformNames: (effect.properties ?? []).map((property) => property.name),
});