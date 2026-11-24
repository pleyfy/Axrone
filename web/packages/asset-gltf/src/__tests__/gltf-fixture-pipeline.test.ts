import { describe, expect, it, beforeAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    AssetDatabase,
} from '@axrone/asset-core';
import {
    createGltfImporter,
    visitComponent,
    mapComponents,
    type GltfAssetSchema,
    type GltfRootJson,
} from '@axrone/asset-gltf';

// ---------------------------------------------------------------------------
// Fixture path — resolve relative to this test file → repo root → Assets/
// ---------------------------------------------------------------------------

const FIXTURE_PATH = path.resolve(
    __dirname,
    '../../../../../../Assets/Models/EN_Character_Stickman_01.glb'
);

// ---------------------------------------------------------------------------
// Load the fixture once for all tests
// ---------------------------------------------------------------------------

let fixtureBytes: Uint8Array;

beforeAll(() => {
    const buffer = fs.readFileSync(FIXTURE_PATH);
    fixtureBytes = new Uint8Array(buffer);
});

// ---------------------------------------------------------------------------
// GLB header parsing helpers
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;
const GLB_BIN_CHUNK_TYPE = 0x004e4942;

const parseGlbHeader = (bytes: Uint8Array) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const magic = view.getUint32(0, true);
    const version = view.getUint32(4, true);
    const totalLength = view.getUint32(8, true);
    return { magic, version, totalLength, view };
};

const extractGlbChunks = (bytes: Uint8Array) => {
    const { view, totalLength } = parseGlbHeader(bytes);
    let offset = 12;

    const chunks: Array<{ type: number; data: Uint8Array }> = [];
    while (offset < totalLength) {
        const chunkLength = view.getUint32(offset, true);
        const chunkType = view.getUint32(offset + 4, true);
        const chunkData = bytes.slice(offset + 8, offset + 8 + chunkLength);
        chunks.push({ type: chunkType, data: chunkData });
        offset += 8 + chunkLength;
    }
    return chunks;
};

const extractGlbJson = (bytes: Uint8Array): GltfRootJson => {
    const chunks = extractGlbChunks(bytes);
    const jsonChunk = chunks.find((c) => c.type === GLB_JSON_CHUNK_TYPE);
    expect(jsonChunk).toBeDefined();
    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(jsonChunk!.data)) as GltfRootJson;
};

// ---------------------------------------------------------------------------
// Shared import helper — feed the raw fixture bytes through the pipeline
// ---------------------------------------------------------------------------

const importFixture = async () => {
    const database = new AssetDatabase<GltfAssetSchema>({
        importers: [createGltfImporter()],
    });

    const receipt = await database.import({
        kind: 'bytes',
        data: fixtureBytes,
        uri: 'models/EN_Character_Stickman_01.glb',
        mimeType: 'model/gltf-binary',
    });

    const document = receipt.primary;
    const prefab = receipt.assets.find((e) => e.kind === 'gltf.prefab');
    const meshes = receipt.assets.filter((e) => e.kind === 'gltf.mesh');
    const materials = receipt.assets.filter((e) => e.kind === 'gltf.material');
    const textures = receipt.assets.filter((e) => e.kind === 'gltf.texture');
    const skins = receipt.assets.filter((e) => e.kind === 'gltf.skin');
    const animations = receipt.assets.filter((e) => e.kind === 'gltf.animation');

    return { database, receipt, document, prefab, meshes, materials, textures, skins, animations };
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('T-06: GLTF Fixture Pipeline — EN_Character_Stickman_01.glb', () => {
    // -----------------------------------------------------------------------
    // 1. GLB Binary Header Validation
    // -----------------------------------------------------------------------
    describe('GLB binary header', () => {
        it('has the correct GLB magic bytes (0x46546C67 = "glTF")', () => {
            const { magic } = parseGlbHeader(fixtureBytes);
            expect(magic).toBe(GLB_MAGIC);
        });

        it('has GLB version 2 in the header', () => {
            const { version } = parseGlbHeader(fixtureBytes);
            expect(version).toBe(2);
        });

        it('reports total length matching the file size', () => {
            const { totalLength } = parseGlbHeader(fixtureBytes);
            expect(totalLength).toBe(fixtureBytes.byteLength);
        });

        it('contains a JSON chunk (type 0x4E4F534A) and a BIN chunk (type 0x004E4942)', () => {
            const chunks = extractGlbChunks(fixtureBytes);
            const chunkTypes = chunks.map((c) => c.type);
            expect(chunkTypes).toContain(GLB_JSON_CHUNK_TYPE);
            expect(chunkTypes).toContain(GLB_BIN_CHUNK_TYPE);
        });

        it('has a non-empty JSON chunk that parses as valid glTF JSON', () => {
            const json = extractGlbJson(fixtureBytes);
            expect(json).toBeDefined();
            expect(json.asset).toBeDefined();
            expect(json.asset.version).toBe('2.0');
        });

        it('has a non-empty BIN chunk with binary buffer data', () => {
            const chunks = extractGlbChunks(fixtureBytes);
            const binChunk = chunks.find((c) => c.type === GLB_BIN_CHUNK_TYPE);
            expect(binChunk).toBeDefined();
            expect(binChunk!.data.byteLength).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // 2. Full Pipeline Import — Asset Structure
    // -----------------------------------------------------------------------
    describe('full pipeline import', () => {
        it('produces a primary document asset of kind gltf.document', async () => {
            const { receipt } = await importFixture();
            expect(receipt.primary.kind).toBe('gltf.document');
        });

        it('produces at least one mesh asset', async () => {
            const { meshes } = await importFixture();
            expect(meshes.length).toBeGreaterThan(0);
        });

        it('produces at least one material asset', async () => {
            const { materials } = await importFixture();
            expect(materials.length).toBeGreaterThan(0);
        });

        it('produces zero texture assets (fixture has no embedded textures)', async () => {
            const { textures } = await importFixture();
            expect(textures.length).toBe(0);
        });

        it('produces skin data (character is skinned)', async () => {
            const { skins } = await importFixture();
            expect(skins.length).toBeGreaterThan(0);
        });

        it('produces animation clips', async () => {
            const { animations } = await importFixture();
            expect(animations.length).toBeGreaterThan(0);
        });
    });

    // -----------------------------------------------------------------------
    // 3. Document Asset Validation
    // -----------------------------------------------------------------------
    describe('document asset', () => {
        it('has format "glb" and version "2.0"', async () => {
            const { document } = await importFixture();
            expect(document.data.format).toBe('glb');
            expect(document.data.version).toBe('2.0');
        });

        it('reports meshCount > 0 in stats', async () => {
            const { document } = await importFixture();
            expect(document.data.stats.meshCount).toBeGreaterThan(0);
        });

        it('reports materialCount > 0 in stats', async () => {
            const { document } = await importFixture();
            expect(document.data.stats.materialCount).toBeGreaterThan(0);
        });

        it('reports textureCount of 0 in stats (fixture has no embedded textures)', async () => {
            const { document } = await importFixture();
            expect(document.data.stats.textureCount).toBe(0);
        });

        it('reports skinCount > 0 in stats', async () => {
            const { document } = await importFixture();
            expect(document.data.stats.skinCount).toBeGreaterThan(0);
        });

        it('reports animationCount > 0 in stats', async () => {
            const { document } = await importFixture();
            expect(document.data.stats.animationCount).toBeGreaterThan(0);
        });

        it('reports nodeCount > 0 in stats', async () => {
            const { document } = await importFixture();
            expect(document.data.stats.nodeCount).toBeGreaterThan(0);
        });

        it('lists at least one scene with a valid prefabKey', async () => {
            const { document, prefab } = await importFixture();
            expect(document.data.scenes.length).toBeGreaterThan(0);
            expect(document.data.scenes[0]!.prefabKey).toBe(prefab!.key);
        });

        it('tracks meshKeys, skinKeys, animationKeys, materialKeys, and textureKeys', async () => {
            const { document, meshes, skins, animations, materials, textures } = await importFixture();
            expect(document.data.meshKeys.length).toBe(meshes.length);
            expect(document.data.skinKeys.length).toBe(skins.length);
            expect(document.data.animationKeys.length).toBe(animations.length);
            expect(document.data.materialKeys.length).toBe(materials.length);
            expect(document.data.textureKeys.length).toBe(textures.length);
        });
    });

    // -----------------------------------------------------------------------
    // 4. Mesh Asset Validation
    // -----------------------------------------------------------------------
    describe('mesh assets', () => {
        it('each mesh has a valid topology', async () => {
            const { meshes } = await importFixture();
            for (const mesh of meshes) {
                expect(mesh.data.definition.topology).toBe('triangles');
            }
        });

        it('each mesh has vertex count > 0', async () => {
            const { meshes } = await importFixture();
            for (const mesh of meshes) {
                expect(mesh.data.definition.vertexCount).toBeGreaterThan(0);
            }
        });

        it('each mesh has position vertex attributes', async () => {
            const { meshes } = await importFixture();
            for (const mesh of meshes) {
                const positionAttr = mesh.data.definition.attributes.find(
                    (a) => a.semantic === 'position'
                );
                expect(positionAttr).toBeDefined();
                expect(positionAttr!.componentCount).toBe(3);
            }
        });

        it('each mesh has a valid bounding box', async () => {
            const { meshes } = await importFixture();
            for (const mesh of meshes) {
                expect(mesh.data.bounds).toBeDefined();
                expect(mesh.data.bounds.min).toBeDefined();
                expect(mesh.data.bounds.max).toBeDefined();
                expect(mesh.data.bounds.min.length).toBe(3);
                expect(mesh.data.bounds.max.length).toBe(3);
            }
        });
    });

    // -----------------------------------------------------------------------
    // 5. Material Asset Validation
    // -----------------------------------------------------------------------
    describe('material assets', () => {
        it('each material has PBR base color factor uniform', async () => {
            const { materials } = await importFixture();
            for (const material of materials) {
                expect(material.data.definition.uniforms._BaseColorFactor).toBeDefined();
                expect(material.data.definition.uniforms._BaseColorFactor.length).toBe(4);
            }
        });

        it('each material has metallic and roughness factor uniforms', async () => {
            const { materials } = await importFixture();
            for (const material of materials) {
                expect(typeof material.data.definition.uniforms._MetallicFactor).toBe('number');
                expect(typeof material.data.definition.uniforms._RoughnessFactor).toBe('number');
            }
        });

        it('each material has a valid alpha mode', async () => {
            const { materials } = await importFixture();
            const validAlphaModes = ['OPAQUE', 'MASK', 'BLEND'];
            for (const material of materials) {
                expect(validAlphaModes).toContain(material.data.alphaMode);
            }
        });
    });

    // -----------------------------------------------------------------------
    // 6. Skin Asset Validation
    // -----------------------------------------------------------------------
    describe('skin assets', () => {
        it('each skin has at least one joint node id', async () => {
            const { skins } = await importFixture();
            for (const skin of skins) {
                expect(skin.data.jointNodeIds.length).toBeGreaterThan(0);
            }
        });

        it('each skin joint node id follows the "node/N" format', async () => {
            const { skins } = await importFixture();
            for (const skin of skins) {
                for (const jointNodeId of skin.data.jointNodeIds) {
                    expect(jointNodeId).toMatch(/^node\/\d+$/);
                }
            }
        });

        it('each skin has inverse bind matrices matching joint count', async () => {
            const { skins } = await importFixture();
            for (const skin of skins) {
                if (skin.data.inverseBindMatrices) {
                    const expectedLength = skin.data.jointNodeIds.length * 16;
                    expect(skin.data.inverseBindMatrices.length).toBe(expectedLength);
                }
            }
        });
    });

    // -----------------------------------------------------------------------
    // 7. Animation Asset Validation
    // -----------------------------------------------------------------------
    describe('animation assets', () => {
        it('each animation has a positive duration', async () => {
            const { animations } = await importFixture();
            for (const anim of animations) {
                expect(anim.data.duration).toBeGreaterThan(0);
            }
        });

        it('each animation has at least one track', async () => {
            const { animations } = await importFixture();
            for (const anim of animations) {
                expect(anim.data.tracks.length).toBeGreaterThan(0);
            }
        });

        it('each animation track targets a valid node', async () => {
            const { animations } = await importFixture();
            for (const anim of animations) {
                for (const track of anim.data.tracks) {
                    expect(track.targetNodeId).toMatch(/^node\/\d+$/);
                }
            }
        });

        it('each animation track has a valid path (translation, rotation, or scale)', async () => {
            const { animations } = await importFixture();
            const validPaths = ['translation', 'rotation', 'scale', 'weights'];
            for (const anim of animations) {
                for (const track of anim.data.tracks) {
                    expect(validPaths).toContain(track.path);
                }
            }
        });

        it('each animation track has keyframe count > 0', async () => {
            const { animations } = await importFixture();
            for (const anim of animations) {
                for (const track of anim.data.tracks) {
                    expect(track.keyframeCount).toBeGreaterThan(0);
                }
            }
        });
    });

    // -----------------------------------------------------------------------
    // 8. Prefab / Node Hierarchy Validation
    // -----------------------------------------------------------------------
    describe('prefab definition', () => {
        it('has at least one entity for the mesh-bearing node(s)', async () => {
            const { prefab } = await importFixture();
            expect(prefab!.data.definition.entities.length).toBeGreaterThanOrEqual(1);
        });

        it('every entity has a Transform component', async () => {
            const { prefab } = await importFixture();
            for (const entity of prefab!.data.definition.entities) {
                const transform = entity.components.find((c) => c.type === 'Transform');
                expect(transform).toBeDefined();
            }
        });

        it('has valid parent-child relationships (parentNodeId references are valid)', async () => {
            const { prefab } = await importFixture();
            const entityNodeIds = new Set(prefab!.data.definition.entities.map((a) => a.nodeId));
            for (const entity of prefab!.data.definition.entities) {
                if (entity.parentNodeId !== null) {
                    expect(entityNodeIds.has(entity.parentNodeId)).toBe(true);
                }
            }
        });

        it('has at least one entity with a MeshRenderer component', async () => {
            const { prefab } = await importFixture();
            const meshRenderers = prefab!.data.definition.entities.filter((a) =>
                a.components.some((c) => c.type === 'MeshRenderer')
            );
            expect(meshRenderers.length).toBeGreaterThan(0);
        });

        it('MeshRenderer components reference valid mesh and material keys', async () => {
            const { prefab, meshes, materials } = await importFixture();
            const meshKeys = new Set(meshes.map((m) => m.key));
            const materialKeys = new Set(materials.map((m) => m.key));

            for (const entity of prefab!.data.definition.entities) {
                for (const comp of entity.components) {
                    if (comp.type === 'MeshRenderer') {
                        const data = comp.data as { meshId?: string; materialId?: string };
                        if (data.meshId) {
                            expect(meshKeys.has(data.meshId)).toBe(true);
                        }
                        if (data.materialId) {
                            expect(materialKeys.has(data.materialId)).toBe(true);
                        }
                    }
                }
            }
        });
    });

    // -----------------------------------------------------------------------
    // 9. Component Snapshot Visitor
    // -----------------------------------------------------------------------
    describe('component snapshots via visitComponent', () => {
        it('visitComponent correctly identifies Transform components', async () => {
            const { prefab } = await importFixture();
            const rootEntity = prefab!.data.definition.entities[0]!;
            const transformComp = rootEntity.components.find((c) => c.type === 'Transform');
            expect(transformComp).toBeDefined();

            const result = visitComponent(
                transformComp!,
                {
                    Transform: (data) => ({
                        type: 'transform' as const,
                        position: data.position,
                    }),
                },
                { type: 'unknown' as const }
            );
            expect(result.type).toBe('transform');
        });

        it('visitComponent correctly identifies MeshRenderer components', async () => {
            const { prefab } = await importFixture();
            const meshEntity = prefab!.data.definition.entities.find((a) =>
                a.components.some((c) => c.type === 'MeshRenderer')
            );
            expect(meshEntity).toBeDefined();

            const meshRendererComp = meshEntity!.components.find((c) => c.type === 'MeshRenderer');
            const result = visitComponent(
                meshRendererComp!,
                {
                    MeshRenderer: (data) => ({
                        type: 'meshRenderer' as const,
                        meshId: (data as any).meshId,
                    }),
                },
                { type: 'unknown' as const }
            );
            expect(result.type).toBe('meshRenderer');
        });

        it('visitComponent returns fallback for unknown component types', async () => {
            const { prefab } = await importFixture();
            const rootEntity = prefab!.data.definition.entities[0]!;
            const transformComp = rootEntity.components.find((c) => c.type === 'Transform');

            const result = visitComponent(
                transformComp!,
                {}, // no visitors registered
                { type: 'fallback' as const }
            );
            expect(result.type).toBe('fallback');
        });

        it('mapComponents returns a new entity with transformed components', async () => {
            const { prefab } = await importFixture();
            const rootEntity = prefab!.data.definition.entities[0]!;
            const mapped = mapComponents(rootEntity, (comp) => comp);
            expect(mapped.components.length).toBe(rootEntity.components.length);
            expect(mapped.nodeId).toBe(rootEntity.nodeId);
            expect(mapped.name).toBe(rootEntity.name);
        });
    });

    // -----------------------------------------------------------------------
    // 10. Prefab Serialization Round-Trip
    // -----------------------------------------------------------------------
    describe('prefab serialization', () => {
        it('prefab definition can be serialized to JSON and deserialized back', async () => {
            const { prefab } = await importFixture();
            const definition = prefab!.data.definition;

            // Serialize
            const serialized = JSON.stringify(definition);
            expect(serialized).toBeDefined();
            expect(serialized.length).toBeGreaterThan(0);

            // Deserialize
            const deserialized = JSON.parse(serialized);
            expect(deserialized).toBeDefined();
            expect(deserialized.id).toBe(definition.id);
            expect(deserialized.entities.length).toBe(definition.entities.length);
        });

        it('serialized prefab preserves entity hierarchy', async () => {
            const { prefab } = await importFixture();
            const definition = prefab!.data.definition;

            const serialized = JSON.parse(JSON.stringify(definition));

            for (let i = 0; i < definition.entities.length; i++) {
                expect(serialized.entities[i].nodeId).toBe(definition.entities[i]!.nodeId);
                expect(serialized.entities[i].parentNodeId).toBe(definition.entities[i]!.parentNodeId);
                expect(serialized.entities[i].name).toBe(definition.entities[i]!.name);
                expect(serialized.entities[i].components.length).toBe(
                    definition.entities[i]!.components.length
                );
            }
        });

        it('serialized prefab preserves component data', async () => {
            const { prefab } = await importFixture();
            const definition = prefab!.data.definition;

            const serialized = JSON.parse(JSON.stringify(definition));

            for (let i = 0; i < definition.entities.length; i++) {
                const originalComponents = definition.entities[i]!.components;
                const serializedComponents = serialized.entities[i].components;

                for (let j = 0; j < originalComponents.length; j++) {
                    expect(serializedComponents[j].type).toBe(originalComponents[j]!.type);
                }
            }
        });
    });

    // -----------------------------------------------------------------------
    // 11. Texture Asset Validation
    // -----------------------------------------------------------------------
    describe('texture assets', () => {
        it('fixture has no embedded textures so texture assets array is empty', async () => {
            const { textures } = await importFixture();
            expect(textures.length).toBe(0);
        });

        it('document textureKeys array is empty when no textures exist', async () => {
            const { document } = await importFixture();
            expect(document.data.textureKeys.length).toBe(0);
        });
    });

    // -----------------------------------------------------------------------
    // 12. Diagnostics
    // -----------------------------------------------------------------------
    describe('diagnostics', () => {
        it('produces a diagnostics array (may be empty for clean imports)', async () => {
            const { receipt } = await importFixture();
            expect(Array.isArray(receipt.diagnostics)).toBe(true);
        });

        it('does not contain any error-level diagnostics for a valid fixture', async () => {
            const { receipt } = await importFixture();
            const errors = receipt.diagnostics.filter((d) => d.level === 'error');
            expect(errors.length).toBe(0);
        });
    });
});
