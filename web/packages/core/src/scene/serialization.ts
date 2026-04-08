import { Mat4, Quat, Vec2, Vec3, Vec4 } from '@axrone/numeric';
import type {
    SceneMorphTargetDefinition,
    SceneMeshDefinition,
    SceneSerializedValue,
    SceneTextureBindingDefinition,
} from './types';

const cloneMorphTargets = (
    morphTargets: readonly SceneMorphTargetDefinition[] | undefined
): readonly SceneMorphTargetDefinition[] | undefined =>
    morphTargets
        ? Object.freeze(
              morphTargets.map((target) => ({
                  ...(typeof target.name === 'string' ? { name: target.name } : {}),
                  attributes: Object.freeze(
                      target.attributes.map((attribute) => ({
                          semantic: attribute.semantic,
                          componentCount: attribute.componentCount,
                          values: new Float32Array(attribute.values),
                      }))
                  ),
              }))
          )
        : undefined;

const asSerializedArray = (value: readonly unknown[]): readonly SceneSerializedValue[] =>
    value.map((item) => encodeSceneValue(item));

export const encodeSceneValue = (value: unknown): SceneSerializedValue => {
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }

    if (value instanceof Vec2) {
        return { $type: 'Vec2', value: [value.x, value.y] };
    }

    if (value instanceof Vec3) {
        return { $type: 'Vec3', value: [value.x, value.y, value.z] };
    }

    if (value instanceof Vec4) {
        return { $type: 'Vec4', value: [value.x, value.y, value.z, value.w] };
    }

    if (value instanceof Quat) {
        return { $type: 'Quat', value: [value.x, value.y, value.z, value.w] };
    }

    if (value instanceof Mat4) {
        return { $type: 'Mat4', value: [...value.data] };
    }

    if (
        value instanceof Float32Array ||
        value instanceof Int32Array ||
        value instanceof Uint32Array ||
        value instanceof Uint16Array ||
        value instanceof Uint8Array
    ) {
        return {
            $type: value.constructor.name,
            value: [...value],
        };
    }

    if (Array.isArray(value)) {
        return asSerializedArray(value);
    }

    if (typeof value === 'object') {
        const encoded: Record<string, SceneSerializedValue> = {};

        for (const [key, entry] of Object.entries(value)) {
            encoded[key] = encodeSceneValue(entry);
        }

        return encoded;
    }

    return String(value);
};

export const decodeSceneValue = (value: SceneSerializedValue): unknown => {
    if (
        value === null ||
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean'
    ) {
        return value;
    }

    if (Array.isArray(value)) {
        return value.map((entry) => decodeSceneValue(entry));
    }

    if ('$type' in value && 'value' in value) {
        const encodedType = value.$type;
        const encodedValue = value.value;

        if (!Array.isArray(encodedValue)) {
            return encodedValue;
        }

        switch (encodedType) {
            case 'Vec2':
                return new Vec2(Number(encodedValue[0]), Number(encodedValue[1]));
            case 'Vec3':
                return new Vec3(
                    Number(encodedValue[0]),
                    Number(encodedValue[1]),
                    Number(encodedValue[2])
                );
            case 'Vec4':
                return new Vec4(
                    Number(encodedValue[0]),
                    Number(encodedValue[1]),
                    Number(encodedValue[2]),
                    Number(encodedValue[3])
                );
            case 'Quat':
                return new Quat(
                    Number(encodedValue[0]),
                    Number(encodedValue[1]),
                    Number(encodedValue[2]),
                    Number(encodedValue[3])
                );
            case 'Mat4':
                return new Mat4(encodedValue.map((entry) => Number(entry)));
            case 'Float32Array':
                return new Float32Array(encodedValue.map((entry) => Number(entry)));
            case 'Int32Array':
                return new Int32Array(encodedValue.map((entry) => Number(entry)));
            case 'Uint32Array':
                return new Uint32Array(encodedValue.map((entry) => Number(entry)));
            case 'Uint16Array':
                return new Uint16Array(encodedValue.map((entry) => Number(entry)));
            case 'Uint8Array':
                return new Uint8Array(encodedValue.map((entry) => Number(entry)));
            default:
                return encodedValue.map((entry) => decodeSceneValue(entry as SceneSerializedValue));
        }
    }

    const decoded: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
        decoded[key] = decodeSceneValue(entry);
    }
    return decoded;
};

export const cloneMeshDefinition = (definition: SceneMeshDefinition): SceneMeshDefinition => {
    const vertices = ArrayBuffer.isView(definition.vertices)
        ? new Uint8Array(
              definition.vertices.buffer.slice(
                  definition.vertices.byteOffset,
                  definition.vertices.byteOffset + definition.vertices.byteLength
              )
          )
        : definition.vertices;

    let indices: Uint8Array | Uint16Array | Uint32Array | undefined;
    if (definition.indices instanceof Uint8Array) {
        indices = new Uint8Array(definition.indices);
    } else if (definition.indices instanceof Uint16Array) {
        indices = new Uint16Array(definition.indices);
    } else if (definition.indices instanceof Uint32Array) {
        indices = new Uint32Array(definition.indices);
    }

    return {
        ...definition,
        vertices,
        indices,
        attributes: definition.attributes.map((attribute) => ({ ...attribute })),
        ...(definition.morphTargets
            ? { morphTargets: cloneMorphTargets(definition.morphTargets) }
            : {}),
    };
};

export const serializeMeshDefinition = (definition: SceneMeshDefinition): SceneSerializedValue => {
    const vertices = ArrayBuffer.isView(definition.vertices)
        ? [
              ...new Uint8Array(
                  definition.vertices.buffer,
                  definition.vertices.byteOffset,
                  definition.vertices.byteLength
              ),
          ]
        : [];

    const indices =
        definition.indices instanceof Uint8Array ||
        definition.indices instanceof Uint16Array ||
        definition.indices instanceof Uint32Array
            ? [...definition.indices]
            : null;

    return {
        id: definition.id,
        vertices,
        indices,
        morphTargets: definition.morphTargets
            ? definition.morphTargets.map((target) => ({
                  name: target.name ?? null,
                  attributes: target.attributes.map((attribute) => ({
                      semantic: attribute.semantic,
                      componentCount: attribute.componentCount,
                      values: [...attribute.values],
                  })),
              }))
            : null,
        vertexCount: definition.vertexCount ?? null,
        topology: definition.topology ?? 'triangles',
        usage: definition.usage ?? null,
        attributes: definition.attributes.map((attribute) => ({ ...attribute })),
        vertexArrayType: ArrayBuffer.isView(definition.vertices)
            ? definition.vertices.constructor.name
            : 'Uint8Array',
        indexArrayType: definition.indices ? definition.indices.constructor.name : null,
    };
};

export const deserializeMeshDefinition = (value: SceneSerializedValue): SceneMeshDefinition => {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error('Invalid serialized mesh definition');
    }

    const objectValue = value as Record<string, SceneSerializedValue>;
    const vertices = Array.isArray(objectValue.vertices)
        ? new Uint8Array(objectValue.vertices.map((entry) => Number(entry)))
        : new Uint8Array();

    let indices: Uint8Array | Uint16Array | Uint32Array | undefined;
    if (Array.isArray(objectValue.indices)) {
        const type =
            typeof objectValue.indexArrayType === 'string'
                ? objectValue.indexArrayType
                : 'Uint16Array';
        const numeric = objectValue.indices.map((entry) => Number(entry));

        switch (type) {
            case 'Uint8Array':
                indices = new Uint8Array(numeric);
                break;
            case 'Uint32Array':
                indices = new Uint32Array(numeric);
                break;
            default:
                indices = new Uint16Array(numeric);
                break;
        }
    }

    return {
        id: String(objectValue.id),
        vertices,
        indices,
        morphTargets: Array.isArray(objectValue.morphTargets)
            ? Object.freeze(
                  objectValue.morphTargets.map((target: SceneSerializedValue) => {
                      if (target === null || Array.isArray(target) || typeof target !== 'object') {
                          throw new Error('Invalid serialized mesh morph target');
                      }

                      const targetObject = target as Record<string, SceneSerializedValue>;

                      return {
                          ...(typeof targetObject.name === 'string'
                              ? { name: targetObject.name }
                              : {}),
                          attributes: Array.isArray(targetObject.attributes)
                              ? Object.freeze(
                                    targetObject.attributes.map(
                                        (attribute: SceneSerializedValue) => {
                                        if (
                                            attribute === null ||
                                            Array.isArray(attribute) ||
                                            typeof attribute !== 'object'
                                        ) {
                                            throw new Error(
                                                'Invalid serialized mesh morph target attribute'
                                            );
                                        }

                                        const attributeObject = attribute as Record<
                                            string,
                                            SceneSerializedValue
                                        >;

                                        return {
                                            semantic: String(
                                                attributeObject.semantic
                                            ) as NonNullable<
                                                SceneMeshDefinition['morphTargets']
                                            >[number]['attributes'][number]['semantic'],
                                            componentCount: 3 as const,
                                            values: new Float32Array(
                                                Array.isArray(attributeObject.values)
                                                    ? attributeObject.values.map(
                                                          (entry: SceneSerializedValue) =>
                                                              Number(entry)
                                                      )
                                                    : []
                                            ),
                                        };
                                    }
                                    )
                                )
                              : Object.freeze([]),
                      };
                  })
              )
            : undefined,
        vertexCount:
            typeof objectValue.vertexCount === 'number' ? objectValue.vertexCount : undefined,
        topology: (typeof objectValue.topology === 'string'
            ? objectValue.topology
            : 'triangles') as SceneMeshDefinition['topology'],
        usage: typeof objectValue.usage === 'number' ? objectValue.usage : undefined,
        attributes: Array.isArray(objectValue.attributes)
            ? objectValue.attributes.map((attribute) => {
                  if (
                      attribute === null ||
                      Array.isArray(attribute) ||
                      typeof attribute !== 'object'
                  ) {
                      throw new Error('Invalid serialized mesh attribute');
                  }
                  return {
                      semantic: String(
                          attribute.semantic
                      ) as SceneMeshDefinition['attributes'][number]['semantic'],
                      componentCount: Number(attribute.componentCount) as 1 | 2 | 3 | 4,
                      offset: Number(attribute.offset),
                      stride: Number(attribute.stride),
                      type: typeof attribute.type === 'number' ? attribute.type : undefined,
                      normalized:
                          typeof attribute.normalized === 'boolean'
                              ? attribute.normalized
                              : undefined,
                      integer:
                          typeof attribute.integer === 'boolean'
                              ? attribute.integer
                              : undefined,
                  };
              })
            : [],
    };
};

export const cloneTextureBinding = (
    binding: SceneTextureBindingDefinition
): SceneTextureBindingDefinition => {
    if (typeof binding === 'string') {
        return binding;
    }

    return { ...binding };
};
