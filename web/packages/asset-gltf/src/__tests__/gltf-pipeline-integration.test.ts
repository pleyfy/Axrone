import { describe, expect, it } from 'vitest';
import {
    AssetDatabase,
} from '@axrone/asset-core';
import {
    createGltfImporter,
    type GltfAssetSchema,
    type GltfRootJson,
} from '@axrone/asset-gltf';

// ---------------------------------------------------------------------------
// Shared helpers — construct minimal GLB binary buffers and JSON payloads
// ---------------------------------------------------------------------------

const trianglePositions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
const triangleIndices = new Uint16Array([0, 1, 2]);
const pngHeaderBytes = new Uint8Array([137, 80, 78, 71]);
const jpegHeaderBytes = new Uint8Array([0xFF, 0xD8, 0xFF, 0xE0]);

const encoder = new TextEncoder();

/** Build a minimal binary blob with positions + indices + a PNG image stub. */
const createBinaryBlob = (): Uint8Array => {
    const image = pngHeaderBytes;
    const total = trianglePositions.byteLength + triangleIndices.byteLength + image.byteLength + 2;
    const bytes = new Uint8Array(total);
    bytes.set(new Uint8Array(trianglePositions.buffer), 0);
    bytes.set(new Uint8Array(triangleIndices.buffer), trianglePositions.byteLength);
    bytes.set(image, trianglePositions.byteLength + triangleIndices.byteLength);
    return bytes;
};

/** Build a binary blob with positions, normals, tangents, UVs, indices, and an image. */
const createExtendedBinaryBlob = (): Uint8Array => {
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const tangents = new Float32Array([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 0, 1]);
    const indices = new Uint16Array([0, 1, 2]);
    const total =
        trianglePositions.byteLength +
        normals.byteLength +
        tangents.byteLength +
        uvs.byteLength +
        indices.byteLength +
        2 +
        pngHeaderBytes.byteLength;
    const bytes = new Uint8Array(total);
    let offset = 0;
    bytes.set(new Uint8Array(trianglePositions.buffer), offset); offset += trianglePositions.byteLength;
    bytes.set(new Uint8Array(normals.buffer), offset); offset += normals.byteLength;
    bytes.set(new Uint8Array(tangents.buffer), offset); offset += tangents.byteLength;
    bytes.set(new Uint8Array(uvs.buffer), offset); offset += uvs.byteLength;
    bytes.set(new Uint8Array(indices.buffer), offset); offset += indices.byteLength + 2;
    bytes.set(pngHeaderBytes, offset);
    return bytes;
};

/** Build a binary blob with rigging data (joints, weights, IBM, animation). */
const createRigBinaryBlob = (): Uint8Array => {
    const jointIndices = new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const jointWeights = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);
    const inverseBindMatrices = new Float32Array([
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        -0.5, 0.25, 0, 1,
    ]);
    const animationTimes = new Float32Array([0, 1]);
    const animationTranslations = new Float32Array([0, 0, 0, 1, 0, 0]);
    const total =
        trianglePositions.byteLength +
        jointIndices.byteLength +
        jointWeights.byteLength +
        triangleIndices.byteLength +
        2 +
        inverseBindMatrices.byteLength +
        animationTimes.byteLength +
        animationTranslations.byteLength;
    const bytes = new Uint8Array(total);
    let offset = 0;
    bytes.set(new Uint8Array(trianglePositions.buffer), offset); offset += trianglePositions.byteLength;
    bytes.set(new Uint8Array(jointIndices.buffer), offset); offset += jointIndices.byteLength;
    bytes.set(new Uint8Array(jointWeights.buffer), offset); offset += jointWeights.byteLength;
    bytes.set(new Uint8Array(triangleIndices.buffer), offset); offset += triangleIndices.byteLength + 2;
    bytes.set(new Uint8Array(inverseBindMatrices.buffer), offset); offset += inverseBindMatrices.byteLength;
    bytes.set(new Uint8Array(animationTimes.buffer), offset); offset += animationTimes.byteLength;
    bytes.set(new Uint8Array(animationTranslations.buffer), offset);
    return bytes;
};

/** Standard triangle JSON used across most tests. */
const createTriangleJson = (): GltfRootJson => ({
    asset: { version: '2.0', generator: 'vitest' },
    buffers: [{ byteLength: 48 }],
    bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 6 },
        { buffer: 0, byteOffset: 42, byteLength: 4 },
    ],
    accessors: [
        {
            bufferView: 0, componentType: 5126, count: 3, type: 'VEC3',
            min: [0, 0, 0], max: [1, 1, 0],
        },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    images: [{ bufferView: 2, mimeType: 'image/png', name: 'Albedo' }],
    samplers: [{ minFilter: 9987, magFilter: 9729, wrapS: 10497, wrapT: 10497 }],
    textures: [{ source: 0, sampler: 0, name: 'Base' }],
    materials: [
        {
            name: 'Material',
            pbrMetallicRoughness: {
                baseColorFactor: [1, 0.5, 0.25, 1],
                baseColorTexture: { index: 0 },
                metallicFactor: 0.1,
                roughnessFactor: 0.9,
            },
        },
    ],
    meshes: [
        {
            name: 'Triangle',
            primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
        },
    ],
    nodes: [{ name: 'Root', mesh: 0 }],
    scenes: [{ name: 'Main', nodes: [0] }],
    scene: 0,
});

/** Extended JSON with normals, tangents, UVs. */
const createExtendedMeshJson = (): GltfRootJson => ({
    asset: { version: '2.0', generator: 'vitest' },
    buffers: [{ byteLength: 156 }],
    bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },    // positions
        { buffer: 0, byteOffset: 36, byteLength: 36 },    // normals
        { buffer: 0, byteOffset: 72, byteLength: 48 },    // tangents
        { buffer: 0, byteOffset: 120, byteLength: 24 },   // uvs
        { buffer: 0, byteOffset: 144, byteLength: 6 },    // indices
        { buffer: 0, byteOffset: 152, byteLength: 4 },    // image (png header)
    ],
    accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
        { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
        { bufferView: 3, componentType: 5126, count: 3, type: 'VEC2' },
        { bufferView: 4, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    images: [{ bufferView: 5, mimeType: 'image/png', name: 'Albedo' }],
    samplers: [{ minFilter: 9987, magFilter: 9729, wrapS: 10497, wrapT: 10497 }],
    textures: [{ source: 0, sampler: 0, name: 'Base' }],
    materials: [
        {
            name: 'Material',
            pbrMetallicRoughness: {
                baseColorFactor: [1, 1, 1, 1],
                baseColorTexture: { index: 0 },
                metallicFactor: 0.0,
                roughnessFactor: 1.0,
            },
            normalTexture: { index: 0 },
        },
    ],
    meshes: [
        {
            name: 'ExtendedTriangle',
            primitives: [
                {
                    attributes: { POSITION: 0, NORMAL: 1, TANGENT: 2, TEXCOORD_0: 3 },
                    indices: 4,
                    material: 0,
                },
            ],
        },
    ],
    nodes: [{ name: 'Root', mesh: 0 }],
    scenes: [{ name: 'Main', nodes: [0] }],
    scene: 0,
});

/** Rig JSON with skin and animation. */
const createRigJson = (): GltfRootJson => ({
    asset: { version: '2.0', generator: 'vitest' },
    buffers: [{ byteLength: 212 }],
    bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36 },
        { buffer: 0, byteOffset: 36, byteLength: 24 },
        { buffer: 0, byteOffset: 60, byteLength: 48 },
        { buffer: 0, byteOffset: 108, byteLength: 6 },
        { buffer: 0, byteOffset: 116, byteLength: 64 },
        { buffer: 0, byteOffset: 180, byteLength: 8 },
        { buffer: 0, byteOffset: 188, byteLength: 24 },
    ],
    accessors: [
        { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 0] },
        { bufferView: 1, componentType: 5123, count: 3, type: 'VEC4' },
        { bufferView: 2, componentType: 5126, count: 3, type: 'VEC4' },
        { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' },
        { bufferView: 4, componentType: 5126, count: 1, type: 'MAT4' },
        { bufferView: 5, componentType: 5126, count: 2, type: 'SCALAR', min: [0], max: [1] },
        { bufferView: 6, componentType: 5126, count: 2, type: 'VEC3' },
    ],
    meshes: [
        {
            name: 'Triangle',
            primitives: [
                {
                    attributes: { POSITION: 0, JOINTS_0: 1, WEIGHTS_0: 2 },
                    indices: 3,
                    material: 0,
                },
            ],
        },
    ],
    materials: [
        {
            name: 'Rig Material',
            pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 },
        },
    ],
    nodes: [
        { name: 'Joint Root' },
        { name: 'Mesh Root', mesh: 0, skin: 0 },
    ],
    skins: [
        { inverseBindMatrices: 4, skeleton: 0, joints: [0], name: 'Rig' },
    ],
    animations: [
        {
            name: 'Move',
            samplers: [{ input: 5, output: 6 }],
            channels: [{ sampler: 0, target: { node: 1, path: 'translation' } }],
        },
    ],
    scenes: [{ name: 'Main', nodes: [0, 1] }],
    scene: 0,
});

/** Wrap a JSON + binary into a valid GLB Uint8Array. */
const createGlb = (json: GltfRootJson, bin: Uint8Array): Uint8Array => {
    const jsonBytes = encoder.encode(JSON.stringify(json));
    const jsonPadding = (4 - (jsonBytes.byteLength % 4)) % 4;
    const paddedJson = new Uint8Array(jsonBytes.byteLength + jsonPadding);
    paddedJson.set(jsonBytes);
    paddedJson.fill(0x20, jsonBytes.byteLength);

    const binPadding = (4 - (bin.byteLength % 4)) % 4;
    const paddedBin = new Uint8Array(bin.byteLength + binPadding);
    paddedBin.set(bin);

    const totalLength = 12 + 8 + paddedJson.byteLength + 8 + paddedBin.byteLength;
    const glb = new Uint8Array(totalLength);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0x46546c67, true);   // magic
    view.setUint32(4, 2, true);             // version
    view.setUint32(8, totalLength, true);   // total length
    view.setUint32(12, paddedJson.byteLength, true);
    view.setUint32(16, 0x4e4f534a, true);   // JSON chunk type
    glb.set(paddedJson, 20);
    const binHeaderOffset = 20 + paddedJson.byteLength;
    view.setUint32(binHeaderOffset, paddedBin.byteLength, true);
    view.setUint32(binHeaderOffset + 4, 0x004e4942, true); // BIN chunk type
    glb.set(paddedBin, binHeaderOffset + 8);
    return glb;
};

/** Create a GLB with invalid magic bytes. */
const createInvalidMagicGlb = (json: GltfRootJson, bin: Uint8Array): Uint8Array => {
    const glb = createGlb(json, bin);
    const view = new DataView(glb.buffer);
    view.setUint32(0, 0xDEADBEEF, true); // corrupt magic
    return glb;
};

/** Create a truncated GLB (cut off mid-chunk). */
const createTruncatedGlb = (json: GltfRootJson, bin: Uint8Array): Uint8Array => {
    const glb = createGlb(json, bin);
    return glb.slice(0, Math.floor(glb.byteLength / 2));
};

/** Helper to run a full import and return the receipt. */
const importGlb = async (json: GltfRootJson, bin: Uint8Array, uri = 'models/test.glb') => {
    const database = new AssetDatabase<GltfAssetSchema>({
        importers: [createGltfImporter()],
    });
    return database.import({
        kind: 'bytes',
        data: createGlb(json, bin),
        uri,
        mimeType: 'model/gltf-binary',
    });
};

// ===========================================================================
// Tests
// ===========================================================================

describe('T-06: GLTF Full Pipeline Integration', () => {
    // -----------------------------------------------------------------------
    // 1. GLB Binary Parsing
    // -----------------------------------------------------------------------
    describe('GLB Binary Parsing', () => {
        it('writes the correct GLB magic bytes (0x46546C67 = "glTF")', () => {
            const glb = createGlb(createTriangleJson(), createBinaryBlob());
            const view = new DataView(glb.buffer);
            expect(view.getUint32(0, true)).toBe(0x46546c67);
        });

        it('writes GLB version 2 in the header', () => {
            const glb = createGlb(createTriangleJson(), createBinaryBlob());
            const view = new DataView(glb.buffer);
            expect(view.getUint32(4, true)).toBe(2);
        });

        it('encodes the total byte length in the 12-byte header', () => {
            const glb = createGlb(createTriangleJson(), createBinaryBlob());
            const view = new DataView(glb.buffer);
            expect(view.getUint32(8, true)).toBe(glb.byteLength);
        });

        it('structures the JSON chunk followed by the BIN chunk with correct chunk types', () => {
            const glb = createGlb(createTriangleJson(), createBinaryBlob());
            const view = new DataView(glb.buffer);
            // JSON chunk type at offset 16
            expect(view.getUint32(16, true)).toBe(0x4e4f534a); // "JSON"
            const jsonChunkLength = view.getUint32(12, true);
            const binHeaderOffset = 20 + jsonChunkLength;
            // BIN chunk type
            expect(view.getUint32(binHeaderOffset + 4, true)).toBe(0x004e4942); // "BIN\0"
        });

        it('rejects GLB data with invalid magic bytes during import', async () => {
            const database = new AssetDatabase<GltfAssetSchema>({
                importers: [createGltfImporter()],
            });
            const invalidGlb = createInvalidMagicGlb(createTriangleJson(), createBinaryBlob());

            await expect(
                database.import({
                    kind: 'bytes',
                    data: invalidGlb,
                    uri: 'models/invalid.glb',
                    mimeType: 'model/gltf-binary',
                })
            ).rejects.toThrow();
        });

        it('rejects truncated GLB data that is too short to contain valid chunks', async () => {
            const database = new AssetDatabase<GltfAssetSchema>({
                importers: [createGltfImporter()],
            });
            const truncatedGlb = createTruncatedGlb(createTriangleJson(), createBinaryBlob());

            await expect(
                database.import({
                    kind: 'bytes',
                    data: truncatedGlb,
                    uri: 'models/truncated.glb',
                    mimeType: 'model/gltf-binary',
                })
            ).rejects.toThrow();
        });
    });

    // -----------------------------------------------------------------------
    // 2. Mesh Extraction
    // -----------------------------------------------------------------------
    describe('Mesh Extraction', () => {
        it('extracts vertex positions from POSITION accessor into mesh definition', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const mesh = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
            expect(mesh).toBeDefined();
            expect(mesh?.data.definition.attributes).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ semantic: 'position', componentCount: 3 }),
                ])
            );
        });

        it('extracts index buffer from indices accessor', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const mesh = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
            expect(mesh?.data.definition.indices).toEqual(new Uint16Array([0, 1, 2]));
        });

        it('maps NORMAL, TANGENT, and TEXCOORD_0 attributes from extended mesh JSON', async () => {
            const receipt = await importGlb(createExtendedMeshJson(), createExtendedBinaryBlob());
            const mesh = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
            const semantics = mesh?.data.definition.attributes.map((a) => a.semantic);
            expect(semantics).toContain('position');
            expect(semantics).toContain('normal');
            expect(semantics).toContain('tangent');
            expect(semantics).toContain('uv0');
        });

        it('reports vertex count matching the accessor count', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const mesh = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
            expect(mesh?.data.definition.vertexCount).toBe(3);
        });

        it('computes bounding box from accessor min/max values', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const mesh = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
            expect(mesh?.data.bounds).toEqual({
                min: [0, 0, 0],
                max: [1, 1, 0],
            });
        });

        it('sets topology to triangles for mode 4 or default primitive mode', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const mesh = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
            expect(mesh?.data.definition.topology).toBe('triangles');
        });
    });

    // -----------------------------------------------------------------------
    // 3. Material Extraction
    // -----------------------------------------------------------------------
    describe('Material Extraction', () => {
        it('extracts PBR metallic-roughness base color factor into uniforms', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const material = receipt.assets.find((entry) => entry.kind === 'gltf.material');
            expect(material?.data.definition.uniforms).toMatchObject({
                _BaseColorFactor: [1, 0.5, 0.25, 1],
            });
        });

        it('maps metallic and roughness factors into material uniforms', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const material = receipt.assets.find((entry) => entry.kind === 'gltf.material');
            expect(material?.data.definition.uniforms).toMatchObject({
                _MetallicFactor: 0.1,
                _RoughnessFactor: 0.9,
            });
        });

        it('binds base color texture reference to the material texture map', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const material = receipt.assets.find((entry) => entry.kind === 'gltf.material');
            const texture = receipt.assets.find((entry) => entry.kind === 'gltf.texture');
            expect(material?.data.definition.textures?._BaseColorTexture).toBe(texture?.key);
        });

        it('defaults alpha mode to OPAQUE when not specified', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const material = receipt.assets.find((entry) => entry.kind === 'gltf.material');
            expect(material?.data.alphaMode).toBe('OPAQUE');
        });

        it('handles MASK alpha mode with alpha cutoff', async () => {
            const json = createTriangleJson();
            const maskedJson: GltfRootJson = {
                ...json,
                materials: [
                    {
                        ...json.materials![0]!,
                        alphaMode: 'MASK',
                        alphaCutoff: 0.25,
                    },
                ],
            };
            const receipt = await importGlb(maskedJson, createBinaryBlob());
            const material = receipt.assets.find((entry) => entry.kind === 'gltf.material');
            expect(material?.data.alphaMode).toBe('MASK');
            expect(material?.data.alphaCutoff).toBe(0.25);
        });
    });

    // -----------------------------------------------------------------------
    // 4. Animation / Skeleton Extraction
    // -----------------------------------------------------------------------
    describe('Animation / Skeleton Extraction', () => {
        it('extracts skeleton joint hierarchy from skin definition', async () => {
            const receipt = await importGlb(createRigJson(), createRigBinaryBlob());
            const skin = receipt.assets.find((entry) => entry.kind === 'gltf.skin');
            expect(skin?.data.jointNodeIds).toEqual(['node/0']);
            expect(skin?.data.skeletonNodeId).toBe('node/0');
        });

        it('parses animation clip channels and samplers into tracks', async () => {
            const receipt = await importGlb(createRigJson(), createRigBinaryBlob());
            const animation = receipt.assets.find((entry) => entry.kind === 'gltf.animation');
            expect(animation?.data.tracks).toHaveLength(1);
            expect(animation?.data.tracks[0]).toMatchObject({
                targetNodeId: 'node/1',
                path: 'translation',
                keyframeCount: 2,
            });
        });

        it('maps interpolation type to LINEAR by default when not specified', async () => {
            const receipt = await importGlb(createRigJson(), createRigBinaryBlob());
            const animation = receipt.assets.find((entry) => entry.kind === 'gltf.animation');
            expect(animation?.data.tracks[0]?.interpolation).toBe('LINEAR');
        });

        it('extracts skin inverse bind matrices in column-major order', async () => {
            const receipt = await importGlb(createRigJson(), createRigBinaryBlob());
            const skin = receipt.assets.find((entry) => entry.kind === 'gltf.skin');
            expect(skin?.data.inverseBindMatrices).toBeDefined();
            // The IBM in the blob is column-major; the importer transposes it
            expect(skin?.data.inverseBindMatrices).toEqual(
                new Float32Array([
                    1, 0, 0, -0.5,
                    0, 1, 0, 0.25,
                    0, 0, 1, 0,
                    0, 0, 0, 1,
                ])
            );
        });

        it('computes animation duration from the maximum keyframe time', async () => {
            const receipt = await importGlb(createRigJson(), createRigBinaryBlob());
            const animation = receipt.assets.find((entry) => entry.kind === 'gltf.animation');
            expect(animation?.data.duration).toBe(1);
        });

        it('extracts animation keyframe times and values from accessors', async () => {
            const receipt = await importGlb(createRigJson(), createRigBinaryBlob());
            const animation = receipt.assets.find((entry) => entry.kind === 'gltf.animation');
            const track = animation?.data.tracks[0];
            expect(track?.times).toEqual(new Float32Array([0, 1]));
            expect(track?.values).toEqual(new Float32Array([0, 0, 0, 1, 0, 0]));
        });
    });

    // -----------------------------------------------------------------------
    // 5. Texture Extraction
    // -----------------------------------------------------------------------
    describe('Texture Extraction', () => {
        it('extracts embedded buffer image as a raw texture payload', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const texture = receipt.assets.find((entry) => entry.kind === 'gltf.texture');
            expect(texture).toBeDefined();
            expect(texture?.data.payload.kind).toBe('raw');
            if (texture?.data.payload.kind === 'raw') {
                expect(texture.data.payload.bytes).toBeInstanceOf(Uint8Array);
                expect(texture.data.payload.bytes.length).toBeGreaterThan(0);
            }
        });

        it('detects MIME type image/png from embedded buffer view images', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const texture = receipt.assets.find((entry) => entry.kind === 'gltf.texture');
            expect(texture?.data.payload.mimeType).toBe('image/png');
        });

        it('maps texture sampler parameters (wrap, filter) from the JSON sampler', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const texture = receipt.assets.find((entry) => entry.kind === 'gltf.texture');
            expect(texture?.data.sampler.wrapS).toBe('REPEAT');
            expect(texture?.data.sampler.wrapT).toBe('REPEAT');
            expect(texture?.data.sampler.magFilter).toBe('LINEAR');
            expect(texture?.data.sampler.minFilter).toBe('LINEAR_MIPMAP_LINEAR');
        });

        it('detects image/jpeg MIME type when the image declares it', async () => {
            const jpegBin = new Uint8Array(pngHeaderBytes.byteLength + trianglePositions.byteLength + triangleIndices.byteLength + 2);
            jpegBin.set(new Uint8Array(trianglePositions.buffer), 0);
            jpegBin.set(new Uint8Array(triangleIndices.buffer), trianglePositions.byteLength);
            jpegBin.set(jpegHeaderBytes, trianglePositions.byteLength + triangleIndices.byteLength + 2);

            const json: GltfRootJson = {
                ...createTriangleJson(),
                images: [{ bufferView: 2, mimeType: 'image/jpeg', name: 'JpegImage' }],
            };
            const receipt = await importGlb(json, createBinaryBlob());
            const texture = receipt.assets.find((entry) => entry.kind === 'gltf.texture');
            expect(texture?.data.payload.mimeType).toBe('image/jpeg');
        });
    });

    // -----------------------------------------------------------------------
    // 6. Scene / Prefab Structure
    // -----------------------------------------------------------------------
    describe('Scene / Prefab Structure', () => {
        it('preserves node hierarchy with parent-child relationships in prefab entities', async () => {
            const json: GltfRootJson = {
                ...createTriangleJson(),
                nodes: [
                    { name: 'Parent', children: [1] },
                    { name: 'Child', mesh: 0 },
                ],
            };
            const receipt = await importGlb(json, createBinaryBlob());
            const prefab = receipt.assets.find((entry) => entry.kind === 'gltf.prefab');
            const parentEntity = prefab?.data.definition.entities.find((a) => a.name === 'Parent');
            const childEntity = prefab?.data.definition.entities.find((a) => a.name === 'Child');
            expect(parentEntity).toBeDefined();
            expect(childEntity).toBeDefined();
            // The child should have a parent reference to the parent entity
            expect(childEntity?.parent).toBe(parentEntity?.id);
        });

        it('decomposes TRS transforms from node translation/rotation/scale', async () => {
            const json: GltfRootJson = {
                ...createTriangleJson(),
                nodes: [
                    {
                        name: 'TransformedNode',
                        mesh: 0,
                        translation: [1, 2, 3],
                        rotation: [0, 0, 0, 1],
                        scale: [2, 2, 2],
                    },
                ],
            };
            const receipt = await importGlb(json, createBinaryBlob());
            const prefab = receipt.assets.find((entry) => entry.kind === 'gltf.prefab');
            const entity = prefab?.data.definition.entities.find((a) => a.name === 'TransformedNode');
            const transform = entity?.components.find((c) => c.type === 'Transform');
            expect(transform?.data).toMatchObject({
                position: [1, 2, 3],
                rotation: [0, 0, 0, 1],
                scale: [2, 2, 2],
            });
        });

        it('generates MeshRenderer component snapshot referencing mesh and material keys', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const prefab = receipt.assets.find((entry) => entry.kind === 'gltf.prefab');
            const mesh = receipt.assets.find((entry) => entry.kind === 'gltf.mesh');
            const material = receipt.assets.find((entry) => entry.kind === 'gltf.material');

            const meshRenderer = prefab?.data.definition.entities[0]?.components.find(
                (c) => c.type === 'MeshRenderer'
            );
            expect(meshRenderer?.data).toMatchObject({
                meshId: mesh?.key,
                materialId: material?.key,
            });
        });

        it('generates Animator component for nodes with skin and animation', async () => {
            const receipt = await importGlb(createRigJson(), createRigBinaryBlob());
            const prefab = receipt.assets.find((entry) => entry.kind === 'gltf.prefab');
            const animator = prefab?.data.definition.entities[0]?.components.find(
                (c) => c.type === 'Animator'
            );
            expect(animator).toBeDefined();
            expect(animator?.data).toMatchObject({
                clipId: 'Move',
                playing: true,
            });
        });
    });

    // -----------------------------------------------------------------------
    // 7. End-to-End Document Stats & Asset Counts
    // -----------------------------------------------------------------------
    describe('End-to-End Document Stats', () => {
        it('produces correct asset counts in the document stats for a simple triangle', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            const doc = receipt.primary.data;
            expect(doc.stats.meshCount).toBe(1);
            expect(doc.stats.materialCount).toBe(1);
            expect(doc.stats.textureCount).toBe(1);
            expect(doc.stats.sceneCount).toBe(1);
            expect(doc.stats.nodeCount).toBe(1);
        });

        it('produces correct stats for a rigged, animated model', async () => {
            const receipt = await importGlb(createRigJson(), createRigBinaryBlob());
            const doc = receipt.primary.data;
            expect(doc.stats.skinCount).toBe(1);
            expect(doc.stats.animationCount).toBe(1);
            expect(doc.stats.meshCount).toBe(1);
            expect(doc.stats.nodeCount).toBe(2);
        });

        it('records the document format as glb for binary imports', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            expect(receipt.primary.data.format).toBe('glb');
        });

        it('records the glTF asset version from the JSON header', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            expect(receipt.primary.data.version).toBe('2.0');
        });

        it('records the generator string from the JSON asset block', async () => {
            const receipt = await importGlb(createTriangleJson(), createBinaryBlob());
            expect(receipt.primary.data.generator).toBe('vitest');
        });
    });

    // -----------------------------------------------------------------------
    // 8. Error Handling & Edge Cases
    // -----------------------------------------------------------------------
    describe('Error Handling & Edge Cases', () => {
        it('throws on unsupported required extensions', async () => {
            const json: GltfRootJson = {
                ...createTriangleJson(),
                extensionsRequired: ['KHR_materials_specular'],
            };
            await expect(importGlb(json, createBinaryBlob())).rejects.toThrow(
                'Unsupported required glTF extensions: KHR_materials_specular'
            );
        });

        it('creates a default material for primitives without an explicit material', async () => {
            const json = createTriangleJson();
            const noMatJson: GltfRootJson = {
                ...json,
                materials: undefined,
                meshes: [
                    {
                        name: 'Triangle',
                        primitives: [{ attributes: { POSITION: 0 }, indices: 1 }],
                    },
                ],
            };
            const receipt = await importGlb(noMatJson, createBinaryBlob());
            const material = receipt.assets.find((entry) => entry.kind === 'gltf.material');
            expect(material).toBeDefined();
            expect(material?.key).toContain('material/default');
        });

        it('produces a warning diagnostic for unsupported optional extensions', async () => {
            const json: GltfRootJson = {
                ...createTriangleJson(),
                extensionsUsed: ['KHR_materials_specular'],
            };
            const receipt = await importGlb(json, createBinaryBlob());
            expect(receipt.diagnostics).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({
                        code: 'gltf.extension.unsupported',
                        level: 'warning',
                    }),
                ])
            );
        });

        it('handles an empty scene with no meshes gracefully', async () => {
            const json: GltfRootJson = {
                asset: { version: '2.0', generator: 'vitest' },
                nodes: [{ name: 'EmptyNode' }],
                scenes: [{ name: 'EmptyScene', nodes: [0] }],
                scene: 0,
            };
            const receipt = await importGlb(json, new Uint8Array(0));
            expect(receipt.primary.data.stats.meshCount).toBe(0);
            expect(receipt.primary.data.stats.nodeCount).toBe(1);
        });
    });
});
