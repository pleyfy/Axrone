import { describe, expect, it } from 'vitest';
import type {
    GltfMaterialDefinition,
    GltfMeshDefinition,
    GltfPrefabDefinition,
    GltfSamplerDefinition,
    GltfShaderDefinition,
    GltfTextureDefinition,
} from '@axrone/asset-gltf';
import {
    adaptGltfMaterialDefinitionToScene,
    adaptGltfMeshDefinitionToScene,
    adaptGltfPrefabDefinitionToScene,
    adaptGltfSamplerDefinitionToScene,
    adaptGltfShaderDefinitionToScene,
    adaptGltfTextureDefinitionToScene,
} from '../scene-definition-adapter';

const createMinimalMesh = (): GltfMeshDefinition => ({
    id: 'mesh/source',
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    attributes: [
        {
            semantic: 'position',
            componentCount: 3,
            offset: 0,
            stride: 12,
        },
    ],
    indices: new Uint16Array([0, 1, 2]),
});

describe('scene-definition-adapter', () => {
    describe('adaptGltfMeshDefinitionToScene', () => {
        it('converts glTF mesh min-max bounds into scene bounding spheres', () => {
            const adapted = adaptGltfMeshDefinitionToScene(createMinimalMesh(), 'mesh/runtime', {
                min: [0, 0, 0],
                max: [1, 1, 0],
            });

            expect(adapted.id).toBe('mesh/runtime');
            expect(adapted.bounds).toEqual({
                kind: 'sphere',
                center: [0.5, 0.5, 0],
                radius: Math.sqrt(0.5),
            });
        });

        it('omits bounds when none are provided', () => {
            const adapted = adaptGltfMeshDefinitionToScene(createMinimalMesh(), 'mesh/no-bounds');

            expect(adapted.bounds).toBeUndefined();
        });

        it('clones attributes array so input is not mutated', () => {
            const mesh = createMinimalMesh();
            const adapted = adaptGltfMeshDefinitionToScene(mesh, 'mesh/clone');

            adapted.attributes.push({ semantic: 'normal', componentCount: 3, offset: 0, stride: 12 });
            expect(mesh.attributes).toHaveLength(1);
        });

        it('maps morph targets with cloned attributes', () => {
            const mesh: GltfMeshDefinition = {
                ...createMinimalMesh(),
                morphTargets: [
                    {
                        name: 'smile',
                        attributes: [{ semantic: 'position', componentCount: 3, offset: 0, stride: 12 }],
                    },
                ],
            };

            const adapted = adaptGltfMeshDefinitionToScene(mesh, 'mesh/morph');

            expect(adapted.morphTargets).toHaveLength(1);
            expect(adapted.morphTargets![0].name).toBe('smile');
            adapted.morphTargets![0].attributes.push({
                semantic: 'normal',
                componentCount: 3,
                offset: 0,
                stride: 12,
            });
            expect(mesh.morphTargets![0].attributes).toHaveLength(1);
        });
    });

    describe('adaptGltfPrefabDefinitionToScene', () => {
        it('converts a prefab with nested entities and components', () => {
            const prefab: GltfPrefabDefinition = {
                id: 'prefab/test',
                entities: [
                    {
                        id: 'entity-1',
                        name: 'Root',
                        components: [
                            {
                                scriptKey: 'transform',
                                data: { position: [1, 2, 3] },
                            } as any,
                            {
                                scriptKey: 'mesh-renderer',
                                data: { meshKey: 'mesh/0' },
                            } as any,
                        ],
                    },
                    {
                        id: 'entity-2',
                        name: 'Child',
                        components: [
                            {
                                scriptKey: 'light',
                                data: { intensity: 0.8 },
                            } as any,
                        ],
                    },
                ],
            };

            const adapted = adaptGltfPrefabDefinitionToScene(prefab);

            expect(adapted.id).toBe('prefab/test');
            expect(adapted.entities).toHaveLength(2);
            expect(adapted.entities[0].components).toHaveLength(2);
            expect(adapted.entities[0].components[0].data).toEqual({ position: [1, 2, 3] });
            expect(adapted.entities[1].components[0].scriptKey).toBe('light');
        });

        it('does not mutate the input prefab', () => {
            const prefab: GltfPrefabDefinition = {
                id: 'prefab/immutable',
                entities: [
                    {
                        id: 'entity-1',
                        name: 'Root',
                        components: [{ scriptKey: 'transform', data: { x: 1 } } as any],
                    },
                ],
            };

            const adapted = adaptGltfPrefabDefinitionToScene(prefab);
            adapted.entities.push({ id: 'entity-new', name: 'Injected', components: [] } as any);

            expect(prefab.entities).toHaveLength(1);
        });
    });

    describe('adaptGltfMaterialDefinitionToScene', () => {
        it('shallow-copies uniforms and textures', () => {
            const material: GltfMaterialDefinition = {
                id: 'mat/0',
                shaderId: 'gltf/pbr',
                uniforms: { _BaseColorFactor: [1, 0, 0, 1] },
                textures: { baseColor: 'tex/0' },
            };

            const adapted = adaptGltfMaterialDefinitionToScene(material);

            expect(adapted.id).toBe('mat/0');
            expect(adapted.uniforms).toEqual({ _BaseColorFactor: [1, 0, 0, 1] });
            expect(adapted.textures).toEqual({ baseColor: 'tex/0' });
        });

        it('handles material without optional uniforms or textures', () => {
            const material: GltfMaterialDefinition = {
                id: 'mat/bare',
                shaderId: 'gltf/unlit',
            };

            const adapted = adaptGltfMaterialDefinitionToScene(material);

            expect(adapted.uniforms).toBeUndefined();
            expect(adapted.textures).toBeUndefined();
        });

        it('preserves surface and passes when present', () => {
            const material = {
                id: 'mat/surface',
                shaderId: 'gltf/pbr',
                surface: { shadingModel: 'pbr' as const, alphaMode: 'opaque' as const },
                passes: [{ id: 'main' }],
            } as unknown as GltfMaterialDefinition;

            const adapted = adaptGltfMaterialDefinitionToScene(material);

            expect(adapted.surface).toEqual({ shadingModel: 'pbr', alphaMode: 'opaque' });
            expect(adapted.passes).toEqual([{ id: 'main' }]);
        });
    });

    describe('adaptGltfTextureDefinitionToScene', () => {
        it('copies compressed source levels as a new array', () => {
            const texture: GltfTextureDefinition = {
                id: 'tex/compressed',
                samplerId: 'sampler/0',
                format: 0 as any,
                generateMipmaps: false,
                source: {
                    kind: 'compressed',
                    bytes: new Uint8Array([1, 2, 3]),
                    levels: [
                        { level: 0, width: 4, height: 4, byteOffset: 0, byteLength: 3 },
                    ] as any,
                    container: 'ktx2',
                },
            };

            const adapted = adaptGltfTextureDefinitionToScene(texture);

            expect(adapted.source.kind).toBe('compressed');
            if (adapted.source.kind === 'compressed') {
                expect(adapted.source.levels).toHaveLength(1);
                adapted.source.levels.push({
                    level: 1,
                    width: 2,
                    height: 2,
                    byteOffset: 3,
                    byteLength: 0,
                } as any);
                expect(texture.source.kind === 'compressed' && texture.source.levels).toHaveLength(1);
            }
        });

        it('shallow-copies non-compressed source', () => {
            const texture: GltfTextureDefinition = {
                id: 'tex/url',
                samplerId: 'sampler/0',
                format: 0 as any,
                source: { kind: 'url', url: 'textures/albedo.png' },
            };

            const adapted = adaptGltfTextureDefinitionToScene(texture);

            expect(adapted.source).toEqual({ kind: 'url', url: 'textures/albedo.png' });
            expect(adapted.source).not.toBe(texture.source);
        });
    });

    describe('adaptGltfSamplerDefinitionToScene', () => {
        it('passes through all sampler properties', () => {
            const sampler: GltfSamplerDefinition = {
                id: 'sampler/linear',
                wrapS: 'repeat',
                wrapT: 'mirrored-repeat',
                minFilter: 'linear-mipmap-linear',
                magFilter: 'linear',
            };

            const adapted = adaptGltfSamplerDefinitionToScene(sampler);

            expect(adapted).toEqual({
                id: 'sampler/linear',
                wrapS: 'repeat',
                wrapT: 'mirrored-repeat',
                minFilter: 'linear-mipmap-linear',
                magFilter: 'linear',
            });
        });
    });

    describe('adaptGltfShaderDefinitionToScene', () => {
        it('copies attributes and uniforms arrays', () => {
            const shader: GltfShaderDefinition = {
                id: 'shader/0',
                attributes: { position: 'a_Position' },
                uniforms: [{ name: '_BaseColorFactor', type: 'vec4' } as any],
            };

            const adapted = adaptGltfShaderDefinitionToScene(shader);

            expect(adapted.id).toBe('shader/0');
            expect(adapted.attributes).toEqual({ position: 'a_Position' });
            expect(adapted.attributes).not.toBe(shader.attributes);
            expect(adapted.uniforms).toHaveLength(1);
            expect(adapted.uniforms).not.toBe(shader.uniforms);
        });

        it('handles shader without optional attributes or uniforms', () => {
            const shader: GltfShaderDefinition = {
                id: 'shader/bare',
            };

            const adapted = adaptGltfShaderDefinitionToScene(shader);

            expect(adapted.attributes).toBeUndefined();
            expect(adapted.uniforms).toBeUndefined();
        });
    });
});