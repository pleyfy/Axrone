import type {
    RenderShaderInspectorOptionDefinition,
    RenderShaderPropertyDefinition,
    RenderShaderSerializableValue,
} from '@axrone/render-core';
import type {
    SceneMaterialDefinition,
    SceneShaderDefinition,
    SceneTextureBindingDefinition,
    SceneUniformValue,
} from './types';

export type SceneMaterialInspectorControlKind =
    | 'number'
    | 'slider'
    | 'color'
    | 'texture'
    | 'toggle'
    | 'select';

export interface SceneMaterialInspectorControlDefinition {
    readonly name: string;
    readonly label: string;
    readonly group: string;
    readonly control: SceneMaterialInspectorControlKind;
    readonly valueType: RenderShaderPropertyDefinition['type'];
    readonly value?: RenderShaderSerializableValue | SceneTextureBindingDefinition;
    readonly defaultValue?: RenderShaderSerializableValue;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly options?: readonly RenderShaderInspectorOptionDefinition[];
}

export interface SceneMaterialInspectorSection {
    readonly id: string;
    readonly title: string;
    readonly controls: readonly SceneMaterialInspectorControlDefinition[];
}

const MATERIAL_SCOPE = 'material';
const HIDDEN_GROUP = 'Hidden';

const isSamplerType = (type: RenderShaderPropertyDefinition['type']): boolean =>
    type === 'sampler2D' || type === 'samplerCube';

const isBooleanType = (type: RenderShaderPropertyDefinition['type']): boolean =>
    type === 'bool' || type === 'bvec2' || type === 'bvec3' || type === 'bvec4';

const humanizePropertyName = (value: string): string =>
    value
        .replace(/^_+/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_-]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (match) => match.toUpperCase());

const slugify = (value: string): string =>
    value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'properties';

const normalizeUniformValue = (
    value: SceneUniformValue | undefined
): RenderShaderSerializableValue | undefined => {
    if (value === undefined) {
        return undefined;
    }

    if (typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (Array.isArray(value)) {
        return [...value];
    }

    if (ArrayBuffer.isView(value)) {
        return Array.from(value as ArrayLike<number>);
    }

    const candidate = value as Partial<Record<'x' | 'y' | 'z' | 'w', unknown>>;
    const vectorValues = [candidate.x, candidate.y, candidate.z, candidate.w].filter(
        (entry): entry is number => typeof entry === 'number'
    );
    if (vectorValues.length > 0) {
        return vectorValues;
    }

    return undefined;
};

const resolveControlKind = (
    property: RenderShaderPropertyDefinition
): SceneMaterialInspectorControlKind => {
    const explicitControl = property.inspector?.control;
    if (explicitControl && explicitControl !== 'auto') {
        switch (explicitControl) {
            case 'color':
            case 'slider':
            case 'texture':
            case 'toggle':
            case 'select':
                return explicitControl;
            default:
                break;
        }
    }

    if (property.inspector?.options?.length) {
        return 'select';
    }

    if (isSamplerType(property.type)) {
        return 'texture';
    }

    if (isBooleanType(property.type)) {
        return 'toggle';
    }

    if (
        property.inspector?.min !== undefined ||
        property.inspector?.max !== undefined ||
        property.inspector?.step !== undefined
    ) {
        return 'slider';
    }

    return 'number';
};

export const createSceneMaterialInspectorControls = (
    shader: SceneShaderDefinition,
    material?: SceneMaterialDefinition
): readonly SceneMaterialInspectorControlDefinition[] => {
    const properties = shader.effect?.properties ?? [];

    return properties
        .filter(
            (property) =>
                property.scope === MATERIAL_SCOPE &&
                property.inspector?.hidden !== true &&
                property.inspector?.group !== HIDDEN_GROUP
        )
        .map((property) => ({
            name: property.name,
            label: property.inspector?.label ?? humanizePropertyName(property.name),
            group: property.inspector?.group ?? 'Properties',
            control: resolveControlKind(property),
            valueType: property.type,
            value: isSamplerType(property.type)
                ? material?.textures?.[property.name]
                : normalizeUniformValue(material?.uniforms?.[property.name]),
            defaultValue: property.defaultValue,
            min: property.inspector?.min,
            max: property.inspector?.max,
            step: property.inspector?.step,
            options: property.inspector?.options ? [...property.inspector.options] : undefined,
        }));
};

export const createSceneMaterialInspectorSections = (
    shader: SceneShaderDefinition,
    material?: SceneMaterialDefinition
): readonly SceneMaterialInspectorSection[] => {
    const sections = new Map<string, SceneMaterialInspectorControlDefinition[]>();

    for (const control of createSceneMaterialInspectorControls(shader, material)) {
        const bucket = sections.get(control.group);
        if (bucket) {
            bucket.push(control);
            continue;
        }

        sections.set(control.group, [control]);
    }

    return [...sections.entries()].map(([title, controls]) => ({
        id: slugify(title),
        title,
        controls,
    }));
};
