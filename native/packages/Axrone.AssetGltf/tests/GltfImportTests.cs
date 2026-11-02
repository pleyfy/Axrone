namespace Axrone.AssetGltf.Tests;

public sealed class GltfImportTests
{
    [Fact]
    public async Task Import_SingleTriangleGlb_ReturnsMeshAndPrefab()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        byte[] posBytes = new byte[positions.Length * 4];
        Buffer.BlockCopy(positions, 0, posBytes, 0, posBytes.Length);
        byte[] idxBytes = [0, 0, 1, 0, 2, 0];

        byte[] bin = new byte[posBytes.Length + idxBytes.Length];
        Buffer.BlockCopy(posBytes, 0, bin, 0, posBytes.Length);
        Buffer.BlockCopy(idxBytes, 0, bin, posBytes.Length, idxBytes.Length);

        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"name": "S", "nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"name": "M", "primitives": [{"attributes": {"POSITION": 0}, "indices": 1, "mode": 4}]}],
              "accessors": [
                {"bufferView": 0, "byteOffset": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "byteOffset": 0, "componentType": 5123, "count": 3, "type": "SCALAR"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 6}
              ],
              "buffers": [{"byteLength": 42}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);

        var importer = new GltfImporter(new GltfImporterOptions { Id = "test.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Diagnostics.Should().BeEmpty();
        result.Meshes.Should().HaveCount(1);
        result.Meshes[0].Definition.VertexCount.Should().Be(3);
        result.Meshes[0].Definition.IndexCount.Should().Be(3);
        result.Meshes[0].Definition.Index16Bit.Should().BeTrue();
        result.Meshes[0].Definition.Topology.Should().Be(GltfMeshTopology.Triangles);
        result.Meshes[0].Bounds.Should().NotBeNull();
        result.Prefabs.Should().HaveCount(1);
        result.Prefabs[0].RootNodeIds.Should().HaveCount(1);
        result.Prefabs[0].Definition.Actors.Should().HaveCount(1);
        result.Document.Stats.MeshCount.Should().Be(1);
        result.Document.Stats.PrimitiveCount.Should().Be(1);
        result.Document.Stats.SceneCount.Should().Be(1);
        result.Document.Stats.NodeCount.Should().Be(1);
        result.Document.Format.Should().Be("glb");
    }

    [Fact]
    public async Task Import_MultiPrimitiveMesh_UsesCompiledPrimitiveKeys()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        byte[] posBytes = new byte[positions.Length * 4];
        Buffer.BlockCopy(positions, 0, posBytes, 0, posBytes.Length);
        byte[] idxBytes = [0, 0, 1, 0, 2, 0];

        byte[] bin = new byte[posBytes.Length + idxBytes.Length];
        Buffer.BlockCopy(posBytes, 0, bin, 0, posBytes.Length);
        Buffer.BlockCopy(idxBytes, 0, bin, posBytes.Length, idxBytes.Length);

        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"name": "S", "nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"name": "M", "primitives": [
                {"attributes": {"POSITION": 0}, "indices": 1, "mode": 4},
                {"attributes": {"POSITION": 0}, "indices": 1, "mode": 4}
              ]}],
              "accessors": [
                {"bufferView": 0, "byteOffset": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "byteOffset": 0, "componentType": 5123, "count": 3, "type": "SCALAR"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 6}
              ],
              "buffers": [{"byteLength": 42}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "multi.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        string[] expectedKeys = ["gltf/mesh/0:0", "gltf/mesh/0:1"];
        result.Meshes.Select(static mesh => mesh.Id).Should().Equal(expectedKeys);
        result.Prefabs.Should().ContainSingle();
        result.Prefabs[0].MeshKeys.Should().Equal(expectedKeys);

        GltfPrefabAsset prefab = result.Prefabs[0];
        prefab.Definition.Actors.Should().HaveCount(3);

        string[] rendererMeshIds = prefab.Definition.Actors
            .SelectMany(static actor => actor.Components)
            .OfType<GltfMeshRendererComponent>()
            .Select(static component => component.MeshId)
            .ToArray();

        rendererMeshIds.Should().Equal(expectedKeys);
        rendererMeshIds.Should().OnlyContain(id => result.Meshes.Any(mesh => mesh.Id == id));
    }

    [Fact]
    public async Task Import_SceneLessDocument_ProducesEmptySceneGraph()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "materials": [{"name": "LibraryMaterial"}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "library.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Document.Scenes.Should().BeEmpty();
        result.Prefabs.Should().BeEmpty();
        result.Document.DefaultScene.Should().Be(-1);
        result.Materials.Should().ContainSingle();
        result.Materials[0].Id.Should().Be("gltf/material/0");
        result.Diagnostics.Should().BeEmpty();
    }

    [Fact]
    public async Task Import_SparseOnlyPositionAccessor_AppliesZeroBasedPatch()
    {
        byte[] bin = new byte[16];
        BinaryPrimitives.WriteUInt16LittleEndian(bin.AsSpan(0, 2), 1);
        BinaryPrimitives.WriteSingleLittleEndian(bin.AsSpan(4, 4), 0f);
        BinaryPrimitives.WriteSingleLittleEndian(bin.AsSpan(8, 4), 1f);
        BinaryPrimitives.WriteSingleLittleEndian(bin.AsSpan(12, 4), 0f);

        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
              "accessors": [{
                "componentType": 5126,
                "count": 3,
                "type": "VEC3",
                "sparse": {
                  "count": 1,
                  "indices": {"bufferView": 0, "componentType": 5123},
                  "values": {"bufferView": 1}
                }
              }],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 2},
                {"buffer": 0, "byteOffset": 4, "byteLength": 12}
              ],
              "buffers": [{"byteLength": 16}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "sparse.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Diagnostics.Should().BeEmpty();
        GltfMeshDefinition definition = result.Meshes[0].Definition;
        ReadOnlySpan<float> vertices = System.Runtime.InteropServices.MemoryMarshal.Cast<byte, float>(definition.Vertices.Span);
        vertices.ToArray().Should().Equal(0f, 0f, 0f, 0f, 1f, 0f, 0f, 0f, 0f);
        definition.VertexCount.Should().Be(3);
        result.Meshes[0].Bounds!.Value.Min.Should().Be(new Vec3(0f, 0f, 0f));
        result.Meshes[0].Bounds!.Value.Max.Should().Be(new Vec3(0f, 1f, 0f));
    }

    [Fact]
    public async Task Import_MorphWeightAnimation_DerivesComponentCountFromOutputAccessor()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        float[] times = [0f, 1f, 2f];
        float[] weights = [0f, 0f, 1f, 0f, 0.5f, 1f];

        byte[] bin = new byte[144];
        Buffer.BlockCopy(positions, 0, bin, 0, 36);
        Buffer.BlockCopy(positions, 0, bin, 36, 36);
        Buffer.BlockCopy(positions, 0, bin, 72, 36);
        Buffer.BlockCopy(times, 0, bin, 108, 12);
        Buffer.BlockCopy(weights, 0, bin, 120, 24);

        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "Morph", "mesh": 0, "weights": [0, 0]}],
              "meshes": [{"primitives": [{
                "attributes": {"POSITION": 0},
                "targets": [{"POSITION": 1}, {"POSITION": 2}]
              }]}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 2, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 3, "componentType": 5126, "count": 3, "type": "SCALAR"},
                {"bufferView": 4, "componentType": 5126, "count": 6, "type": "SCALAR"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 36},
                {"buffer": 0, "byteOffset": 72, "byteLength": 36},
                {"buffer": 0, "byteOffset": 108, "byteLength": 12},
                {"buffer": 0, "byteOffset": 120, "byteLength": 24}
              ],
              "buffers": [{"byteLength": 144}],
              "animations": [{
                "name": "MorphAnimation",
                "samplers": [{"input": 3, "output": 4, "interpolation": "LINEAR"}],
                "channels": [{"sampler": 0, "target": {"node": 0, "path": "weights"}}]
              }]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "morph.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        GltfAnimationTrackAsset track = result.Animations[0].Tracks[0];
        track.Path.Should().Be(GltfAnimationPath.Weights);
        track.KeyframeCount.Should().Be(3);
        track.ValueComponentCount.Should().Be(2);
        track.SampleStride.Should().Be(2);
        track.Values.Length.Should().Be(6);
        track.Values.Span.ToArray().Should().Equal(weights);
    }

    [Fact]
    public async Task Import_RequiredDracoWithoutDecoder_ThrowsCodedError()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "extensionsUsed": ["KHR_draco_mesh_compression"],
              "extensionsRequired": ["KHR_draco_mesh_compression"],
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{
                "attributes": {"POSITION": 0},
                "extensions": {
                  "KHR_draco_mesh_compression": {"bufferView": 0, "attributes": {"POSITION": 0}}
                }
              }]}],
              "accessors": [{"componentType": 5126, "count": 3, "type": "VEC3"}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 0}],
              "buffers": [{"byteLength": 0}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "draco.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfUnsupportedExtensionError>())
            .Which.Code.Should().Be("gltf.extension.unsupported");
    }

    [Fact]
    public async Task Import_MaterialWithoutPbr_UsesSpecBaseColorDefault()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "materials": [{"name": "SpecDefault"}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "material.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        GltfMaterialAsset material = result.Materials.Should().ContainSingle().Subject;
        material.Definition.FloatUniforms["_BaseColorFactor"].Should().Equal(1f, 1f, 1f, 1f);
        material.Definition.ScalarUniforms["_MetallicFactor"].Should().Be(1f);
        material.Definition.ScalarUniforms["_RoughnessFactor"].Should().Be(1f);
    }

    [Fact]
    public async Task Import_GltfOneDocument_ThrowsSchemaError()
    {
        const string json = """{"asset": {"version": "1.0"}}""";
        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "legacy.gltf" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfSchemaError>())
            .Which.Code.Should().Be("gltf.schema.invalid");
    }

    [Fact]
    public async Task Import_Cameras_ParsesPerspectiveAndOrthographicSettings()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0, 1]}],
              "nodes": [
                {"name": "Perspective", "camera": 0},
                {"name": "Orthographic", "camera": 1}
              ],
              "cameras": [
                {"name": "P", "type": "perspective", "perspective": {"yfov": 0.7, "zfar": 200, "znear": 0.1}},
                {"name": "O", "type": "orthographic", "orthographic": {"xmag": 2, "ymag": 4, "zfar": 50, "znear": 0.5}}
              ]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "cameras.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Document.Stats.CameraCount.Should().Be(2);

        GltfCameraComponent[] cameras = result.Prefabs[0].Definition.Actors
            .SelectMany(static actor => actor.Components)
            .OfType<GltfCameraComponent>()
            .ToArray();

        cameras.Should().HaveCount(2);
        cameras.Count(static camera => camera.Primary).Should().Be(1);
        cameras.Should().ContainSingle(static camera => camera.Orthographic)
            .Which.OrthographicSize.Should().Be(4f);
        cameras.Should().ContainSingle(static camera => !camera.Orthographic)
            .Which.FieldOfView.Should().Be(0.7f);
    }

    [Fact]
    public async Task Import_EncodedPngPayload_DoesNotClaimDecodedFormat()
    {
        byte[] bin = [137, 80, 78, 71];
        const string json = """
            {
              "asset": {"version": "2.0"},
              "images": [{"bufferView": 0, "mimeType": "image/png"}],
              "textures": [{"source": 0}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 4}],
              "buffers": [{"byteLength": 4}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "texture.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.Unknown);
        texture.Payload.Should().BeOfType<GltfRawTexturePayload>()
            .Which.MimeType.Should().Be("image/png");
    }

    [Fact]
    public async Task Import_EmbeddedImageDataUri_DecodesPayload()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "images": [{"uri": "data:image/png;base64,iVBORw0KGgo="}],
              "textures": [{"source": 0}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "embedded.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        GltfRawTexturePayload payload = texture.Payload.Should().BeOfType<GltfRawTexturePayload>().Subject;
        payload.MimeType.Should().Be("image/png");
        payload.Bytes.Length.Should().Be(8);
        texture.RuntimeFormat.Should().Be(GltfTextureFormat.Unknown);
    }

    [Fact]
    public async Task Import_ExternalImage_ResolvesThroughResourceResolver()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "images": [{"uri": "textures/albedo.png", "mimeType": "image/png"}],
              "textures": [{"source": 0}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        byte[] imageBytes = [1, 2, 3, 4];
        GltfResourceRequest? observedRequest = null;
        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "external.glb",
            ResourceResolver = (request, _) =>
            {
                observedRequest = request;
                return ValueTask.FromResult<GltfResolvedResource?>(
                    new GltfResolvedResource(imageBytes, "image/png"));
            },
        });

        GltfImportResult result = await importer.ImportAsync(glb);

        observedRequest.Should().NotBeNull();
        observedRequest!.Value.Kind.Should().Be("image");
        GltfTextureAsset texture = result.Textures.Should().ContainSingle().Subject;
        GltfRawTexturePayload payload = texture.Payload.Should().BeOfType<GltfRawTexturePayload>().Subject;
        payload.Bytes.ToArray().Should().Equal(imageBytes);
        payload.MimeType.Should().Be("image/png");
    }

    [Fact]
    public async Task Import_AccessorOverrunsBufferView_ThrowsAccessorError()
    {
        byte[] bin = new byte[8];
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 8}],
              "buffers": [{"byteLength": 8}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "overrun.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfAccessorError>())
            .Which.Code.Should().Be("gltf.accessor.invalid");
    }

    [Fact]
    public async Task Import_IndexOutsideVertexRange_ThrowsAccessorError()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        byte[] bin = new byte[44];
        Buffer.BlockCopy(positions, 0, bin, 0, 36);
        BinaryPrimitives.WriteUInt16LittleEndian(bin.AsSpan(36, 2), 0);
        BinaryPrimitives.WriteUInt16LittleEndian(bin.AsSpan(38, 2), 1);
        BinaryPrimitives.WriteUInt16LittleEndian(bin.AsSpan(40, 2), 3);

        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5123, "count": 3, "type": "SCALAR"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 6}
              ],
              "buffers": [{"byteLength": 44}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "indices.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfAccessorError>())
            .Which.Code.Should().Be("gltf.accessor.invalid");
    }

    [Fact]
    public async Task Import_AttributeCountMismatch_ThrowsAccessorError()
    {
        byte[] bin = new byte[60];
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {"POSITION": 0, "NORMAL": 1}}]}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5126, "count": 2, "type": "VEC3"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 24}
              ],
              "buffers": [{"byteLength": 60}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "attributes.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfAccessorError>())
            .Which.Code.Should().Be("gltf.accessor.invalid");
    }

    [Fact]
    public async Task Import_MorphTargetCountMismatch_ThrowsAccessorError()
    {
        byte[] bin = new byte[60];
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{
                "attributes": {"POSITION": 0},
                "targets": [{"POSITION": 1}]
              }]}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5126, "count": 2, "type": "VEC3"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 24}
              ],
              "buffers": [{"byteLength": 60}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "morph-count.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfAccessorError>())
            .Which.Code.Should().Be("gltf.accessor.invalid");
    }

    [Fact]
    public async Task Import_SkinInverseBindMatrices_RequireFloatMat4()
    {
        byte[] bin = new byte[48];
        const string json = """
            {
              "asset": {"version": "2.0"},
              "nodes": [{"name": "Joint"}],
              "skins": [{"joints": [0], "inverseBindMatrices": 0}],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 1, "type": "VEC3"}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 48}],
              "buffers": [{"byteLength": 48}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "skin.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfAccessorError>())
            .Which.Code.Should().Be("gltf.accessor.invalid");
    }

    [Fact]
    public async Task Import_AnimationInputMustBeFloatScalar()
    {
        byte[] bin = new byte[60];
        const string json = """
            {
              "asset": {"version": "2.0"},
              "nodes": [{"name": "Target"}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC2"},
                {"bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC3"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 24},
                {"buffer": 0, "byteOffset": 24, "byteLength": 36}
              ],
              "buffers": [{"byteLength": 60}],
              "animations": [{
                "samplers": [{"input": 0, "output": 1, "interpolation": "LINEAR"}],
                "channels": [{"sampler": 0, "target": {"node": 0, "path": "translation"}}]
              }]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "animation-type.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfAccessorError>())
            .Which.Code.Should().Be("gltf.accessor.invalid");
    }

    [Fact]
    public async Task Import_LocalLightBudgetOption_ControlsRuntimeLimitWarning()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "extensionsUsed": ["KHR_lights_punctual"],
              "extensions": {
                "KHR_lights_punctual": {
                  "lights": [
                    {"type": "point", "intensity": 1, "range": 5},
                    {"type": "point", "intensity": 1, "range": 5},
                    {"type": "point", "intensity": 1, "range": 5}
                  ]
                }
              },
              "scene": 0,
              "scenes": [{"nodes": [0, 1, 2]}],
              "nodes": [
                {"name": "L0", "extensions": {"KHR_lights_punctual": {"light": 0}}},
                {"name": "L1", "extensions": {"KHR_lights_punctual": {"light": 1}}},
                {"name": "L2", "extensions": {"KHR_lights_punctual": {"light": 2}}}
              ]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "lights.glb",
            MaxLocalLightsBudget = 2,
        });

        GltfImportResult result = await importer.ImportAsync(glb);

        result.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code == "gltf.light.local.runtime-limit");
        result.Prefabs[0].Definition.Actors
            .SelectMany(static actor => actor.Components)
            .OfType<GltfPointLightComponent>()
            .Should().HaveCount(3);
    }

    [Fact]
    public async Task Import_MaterialWithoutAlphaCutoff_UsesConfiguredThreshold()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "materials": [{"name": "Masked", "alphaMode": "MASK"}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "alpha.glb",
            AlphaCutoffThreshold = 0.25f,
        });

        GltfImportResult result = await importer.ImportAsync(glb);

        GltfMaterialAsset material = result.Materials.Should().ContainSingle().Subject;
        material.AlphaCutoff.Should().Be(0.25f);
        material.Definition.ScalarUniforms["_AlphaCutoff"].Should().Be(0.25f);
    }

    [Fact]
    public async Task Import_MaterialMissingTexture_ThrowsSchemaError()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "materials": [{
                "pbrMetallicRoughness": {"baseColorTexture": {"index": 1}}
              }]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "material-texture.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfSchemaError>())
            .Which.Code.Should().Be("gltf.schema.invalid");
    }

    [Fact]
    public async Task Import_MeshMissingMaterial_ThrowsSchemaError()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        byte[] bin = new byte[44];
        Buffer.BlockCopy(positions, 0, bin, 0, 36);
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "material": 1}]}],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36}],
              "buffers": [{"byteLength": 44}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "mesh-material.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfSchemaError>())
            .Which.Code.Should().Be("gltf.schema.invalid");
    }

    [Fact]
    public async Task Import_PrefabMaterialKeys_ArePopulated()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        byte[] bin = new byte[44];
        Buffer.BlockCopy(positions, 0, bin, 0, 36);
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "material": 0}]}],
              "materials": [{"name": "M"}],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36}],
              "buffers": [{"byteLength": 44}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "prefab-material.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Prefabs[0].MaterialKeys.Should().Equal("gltf/material/0");
        result.Prefabs[0].Definition.Actors
            .SelectMany(static actor => actor.Components)
            .OfType<GltfMeshRendererComponent>()
            .Should().ContainSingle()
            .Which.MaterialId.Should().Be("gltf/material/0");
    }

    [Fact]
    public async Task Import_MissingAssetVersion_ThrowsSchemaError()
    {
        const string json = """{"asset": {}}""";
        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "no-version.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfSchemaError>())
            .Which.Code.Should().Be("gltf.schema.invalid");
    }

    [Fact]
    public async Task Import_SparseIndexOutsideAccessor_ThrowsAccessorError()
    {
        byte[] bin = new byte[16];
        BinaryPrimitives.WriteUInt16LittleEndian(bin.AsSpan(0, 2), 3);
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
              "accessors": [{
                "componentType": 5126,
                "count": 3,
                "type": "VEC3",
                "sparse": {
                  "count": 1,
                  "indices": {"bufferView": 0, "componentType": 5123},
                  "values": {"bufferView": 1}
                }
              }],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 2},
                {"buffer": 0, "byteOffset": 4, "byteLength": 12}
              ],
              "buffers": [{"byteLength": 16}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "sparse-range.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfAccessorError>())
            .Which.Code.Should().Be("gltf.accessor.invalid");
    }

    [Fact]
    public async Task Import_IndexAccessorMustBeUnsignedScalar()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        byte[] bin = new byte[48];
        Buffer.BlockCopy(positions, 0, bin, 0, 36);
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5126, "count": 3, "type": "SCALAR"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 12}
              ],
              "buffers": [{"byteLength": 48}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "index-type.glb" });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfAccessorError>())
            .Which.Code.Should().Be("gltf.accessor.invalid");
    }

    [Fact]
    public async Task Import_UnknownMorphTargetAttribute_IsBypassedWithWarning()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        byte[] bin = new byte[72];
        Buffer.BlockCopy(positions, 0, bin, 0, 36);
        Buffer.BlockCopy(positions, 0, bin, 36, 36);
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{
                "attributes": {"POSITION": 0},
                "targets": [{"POSITION": 1, "CUSTOM": 1}]
              }]}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC3"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 36}
              ],
              "buffers": [{"byteLength": 72}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "morph-semantic.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Diagnostics.Should().Contain(diagnostic =>
            diagnostic.Code == "gltf.mesh.target.attribute.unsupported");
        result.Meshes[0].Definition.MorphTargets.Should().ContainSingle();
    }

    [Fact]
    public async Task Import_SourceUri_IsPreservedOnDocument()
    {
        const string json = """{"asset": {"version": "2.0"}}""";
        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "uri.gltf",
            SourceUri = "models/uri.gltf",
        });

        GltfImportResult result = await importer.ImportAsync(glb);

        result.Document.Uri.Should().Be("models/uri.gltf");
    }

    [Fact]
    public async Task Import_PreCancelledToken_Throws()
    {
        const string json = """{"asset": {"version": "2.0"}}""";
        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "cancelled.glb" });
        using var cancellation = new CancellationTokenSource();
        cancellation.Cancel();

        Func<Task> act = () => importer.ImportAsync(glb, cancellation.Token).AsTask();

        await act.Should().ThrowAsync<OperationCanceledException>();
    }

    [Fact]
    public async Task Import_NodeLimitExceeded_ThrowsLimitError()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "nodes": [{"name": "A"}, {"name": "B"}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "limit.glb",
            Limits = new GltfImportLimits { MaxNodeCount = 1 },
        });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfLimitExceededError>())
            .Which.Limit.Should().Be("MaxNodeCount");
    }

    [Fact]
    public async Task Import_DecodedByteLimitExceeded_ThrowsLimitError()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        byte[] bin = new byte[44];
        Buffer.BlockCopy(positions, 0, bin, 0, 36);
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36}],
              "buffers": [{"byteLength": 44}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "decoded-limit.glb",
            Limits = new GltfImportLimits { MaxDecodedBytes = 1 },
        });

        Func<Task> act = () => importer.ImportAsync(glb).AsTask();

        (await act.Should().ThrowAsync<GltfLimitExceededError>())
            .Which.Limit.Should().Be("MaxDecodedBytes");
    }

    [Fact]
    public async Task Import_ModernMaterialExtensions_ProduceUniformsAndBindings()
    {
        byte[] bin = [137, 80, 78, 71];
        const string json = """
            {
              "asset": {"version": "2.0"},
              "extensionsUsed": [
                "KHR_materials_specular",
                "KHR_materials_sheen",
                "KHR_materials_transmission",
                "KHR_materials_volume",
                "KHR_materials_ior",
                "KHR_materials_iridescence",
                "KHR_materials_anisotropy",
                "KHR_materials_dispersion"
              ],
              "buffers": [{"byteLength": 4}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 4}],
              "images": [{"bufferView": 0, "mimeType": "image/png"}],
              "textures": [{"source": 0}],
              "materials": [{
                "name": "Modern",
                "extensions": {
                  "KHR_materials_specular": {
                    "specularFactor": 0.5,
                    "specularColorFactor": [0.9, 0.8, 0.7],
                    "specularTexture": {"index": 0}
                  },
                  "KHR_materials_sheen": {
                    "sheenColorFactor": [1, 0.5, 0.25],
                    "sheenColorTexture": {"index": 0},
                    "sheenRoughnessFactor": 0.4
                  },
                  "KHR_materials_transmission": {"transmissionFactor": 0.8},
                  "KHR_materials_volume": {
                    "thicknessFactor": 0.2,
                    "attenuationDistance": 3,
                    "attenuationColor": [0.5, 0.6, 0.7]
                  },
                  "KHR_materials_ior": {"ior": 1.4},
                  "KHR_materials_iridescence": {
                    "iridescenceFactor": 0.6,
                    "iridescenceIor": 1.2,
                    "iridescenceThicknessMinimum": 120,
                    "iridescenceThicknessMaximum": 300
                  },
                  "KHR_materials_anisotropy": {
                    "anisotropyStrength": 0.7,
                    "anisotropyRotation": 0.3
                  },
                  "KHR_materials_dispersion": {"dispersion": 0.1}
                }
              }]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions
        {
            Id = "modern.glb",
            DecodeEncodedTextures = false,
        });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Diagnostics.Should().BeEmpty();
        GltfMaterialAsset material = result.Materials.Should().ContainSingle().Subject;
        material.Definition.ScalarUniforms["_SpecularFactor"].Should().Be(0.5f);
        material.Definition.FloatUniforms["_SpecularColorFactor"].Should().Equal(0.9f, 0.8f, 0.7f);
        material.Definition.FloatUniforms["_SheenColorFactor"].Should().Equal(1f, 0.5f, 0.25f);
        material.Definition.ScalarUniforms["_SheenRoughnessFactor"].Should().Be(0.4f);
        material.Definition.ScalarUniforms["_TransmissionFactor"].Should().Be(0.8f);
        material.Definition.ScalarUniforms["_ThicknessFactor"].Should().Be(0.2f);
        material.Definition.ScalarUniforms["_AttenuationDistance"].Should().Be(3f);
        material.Definition.FloatUniforms["_AttenuationColor"].Should().Equal(0.5f, 0.6f, 0.7f);
        material.Definition.ScalarUniforms["_IorFactor"].Should().Be(1.4f);
        material.Definition.ScalarUniforms["_IridescenceFactor"].Should().Be(0.6f);
        material.Definition.ScalarUniforms["_IridescenceIor"].Should().Be(1.2f);
        material.Definition.ScalarUniforms["_IridescenceThicknessMinimum"].Should().Be(120f);
        material.Definition.ScalarUniforms["_IridescenceThicknessMaximum"].Should().Be(300f);
        material.Definition.ScalarUniforms["_AnisotropyStrength"].Should().Be(0.7f);
        material.Definition.ScalarUniforms["_AnisotropyRotation"].Should().Be(0.3f);
        material.Definition.ScalarUniforms["_Dispersion"].Should().Be(0.1f);
        material.Textures.Should().ContainKey(GltfTextureUsage.Specular);
        material.Textures.Should().ContainKey(GltfTextureUsage.SheenColor);
        material.Definition.ScalarUniforms.Should().ContainKey("_SpecularTexture_Scale");
        material.Definition.ScalarUniforms.Should().ContainKey("_SheenColorTexture_Scale");
    }

    [Fact]
    public async Task Import_WebpTextureExtension_SelectsExtensionSource()
    {
        const string json = """
            {
              "asset": {"version": "2.0"},
              "extensionsUsed": ["EXT_texture_webp"],
              "images": [
                {"uri": "fallback.png", "mimeType": "image/png"},
                {"uri": "preferred.webp", "mimeType": "image/webp"}
              ],
              "textures": [{
                "source": 0,
                "extensions": {"EXT_texture_webp": {"source": 1}}
              }]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), []);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "webp.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Textures[0].ImageIndex.Should().Be(1);
        result.Textures[0].Payload.Should().BeOfType<GltfExternalTexturePayload>()
            .Which.Uri.Should().Be("preferred.webp");
    }

    [Fact]
    public async Task Import_MaterialVariants_ProduceDocumentAndMeshMappings()
    {
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        byte[] bin = new byte[44];
        Buffer.BlockCopy(positions, 0, bin, 0, 36);
        const string json = """
            {
              "asset": {"version": "2.0"},
              "extensionsUsed": ["KHR_materials_variants"],
              "extensions": {
                "KHR_materials_variants": {
                  "variants": [{"name": "Red"}, {"name": "Blue"}]
                }
              },
              "materials": [{"name": "Base"}, {"name": "RedMat"}, {"name": "BlueMat"}],
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{
                "attributes": {"POSITION": 0},
                "material": 0,
                "extensions": {
                  "KHR_materials_variants": {
                    "mappings": [
                      {"variants": [0], "material": 1},
                      {"variants": [1], "material": 2}
                    ]
                  }
                }
              }]}],
              "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"}],
              "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 36}],
              "buffers": [{"byteLength": 44}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "variants.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Document.MaterialVariants.Should().HaveCount(2);
        result.Document.MaterialVariants[0].Name.Should().Be("Red");
        result.Document.MaterialVariants[1].Name.Should().Be("Blue");

        GltfMeshAsset mesh = result.Meshes.Should().ContainSingle().Subject;
        mesh.MaterialVariants.Should().HaveCount(2);
        mesh.MaterialVariants[0].Variants.Should().Equal(0);
        mesh.MaterialVariants[0].MaterialIndex.Should().Be(1);
        mesh.MaterialVariants[1].Variants.Should().Equal(1);
        mesh.MaterialVariants[1].MaterialIndex.Should().Be(2);
    }

    [Fact]
    public async Task Import_SecondaryVertexSemantics_ArePreserved()
    {
        byte[] bin = new byte[168];
        float[] positions = [0f, 0f, 0f, 1f, 0f, 0f, 0f, 1f, 0f];
        Buffer.BlockCopy(positions, 0, bin, 0, 36);
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{"attributes": {
                "POSITION": 0,
                "JOINTS_1": 1,
                "WEIGHTS_1": 2,
                "TEXCOORD_2": 3,
                "COLOR_1": 4
              }}]}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5121, "count": 3, "type": "VEC4"},
                {"bufferView": 2, "componentType": 5126, "count": 3, "type": "VEC4"},
                {"bufferView": 3, "componentType": 5126, "count": 3, "type": "VEC2"},
                {"bufferView": 4, "componentType": 5126, "count": 3, "type": "VEC4"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 12},
                {"buffer": 0, "byteOffset": 48, "byteLength": 48},
                {"buffer": 0, "byteOffset": 96, "byteLength": 24},
                {"buffer": 0, "byteOffset": 120, "byteLength": 48}
              ],
              "buffers": [{"byteLength": 168}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "semantics.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        result.Meshes[0].Definition.Attributes
            .Select(static attribute => attribute.Semantic)
            .Should().BeEquivalentTo(
            [
                GltfMeshSemantic.Position,
                GltfMeshSemantic.Joints1,
                GltfMeshSemantic.Weights1,
                GltfMeshSemantic.Uv2,
                GltfMeshSemantic.Color1,
            ]);
    }

    [Fact]
    public async Task Import_AnimationPointer_ProducesPointerTrack()
    {
        byte[] bin = new byte[60];
        float[] times = [0f, 1f, 2f];
        Buffer.BlockCopy(times, 0, bin, 0, 12);
        const string json = """
            {
              "asset": {"version": "2.0"},
              "extensionsUsed": ["KHR_animation_pointer"],
              "materials": [{"name": "M"}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "SCALAR"},
                {"bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC4"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 12},
                {"buffer": 0, "byteOffset": 12, "byteLength": 48}
              ],
              "buffers": [{"byteLength": 60}],
              "animations": [{
                "samplers": [{"input": 0, "output": 1, "interpolation": "LINEAR"}],
                "channels": [{
                  "sampler": 0,
                  "target": {
                    "extensions": {
                      "KHR_animation_pointer": {
                        "pointer": "/materials/0/pbrMetallicRoughness/baseColorFactor"
                      }
                    }
                  }
                }]
              }]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        var importer = new GltfImporter(new GltfImporterOptions { Id = "pointer.glb" });
        GltfImportResult result = await importer.ImportAsync(glb);

        GltfAnimationTrackAsset track = result.Animations[0].Tracks[0];
        track.Path.Should().Be(GltfAnimationPath.Pointer);
        track.Pointer.Should().Be("/materials/0/pbrMetallicRoughness/baseColorFactor");
        track.TargetNodeIndex.Should().Be(-1);
        track.ValueComponentCount.Should().Be(4);
        track.Values.Length.Should().Be(12);
    }

    [Fact]
    public async Task Import_MorphTargetWithMultipleAttributes_ProducesBothDeltas()
    {
        byte[] bin = new byte[108];
        const string json = """
            {
              "asset": {"version": "2.0"},
              "scene": 0,
              "scenes": [{"nodes": [0]}],
              "nodes": [{"name": "N", "mesh": 0}],
              "meshes": [{"primitives": [{
                "attributes": {"POSITION": 0},
                "targets": [{"POSITION": 1, "NORMAL": 2}]
              }]}],
              "accessors": [
                {"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 1, "componentType": 5126, "count": 3, "type": "VEC3"},
                {"bufferView": 2, "componentType": 5126, "count": 3, "type": "VEC3"}
              ],
              "bufferViews": [
                {"buffer": 0, "byteOffset": 0, "byteLength": 36},
                {"buffer": 0, "byteOffset": 36, "byteLength": 36},
                {"buffer": 0, "byteOffset": 72, "byteLength": 36}
              ],
              "buffers": [{"byteLength": 108}]
            }
            """;

        byte[] glb = BuildGlb(System.Text.Encoding.UTF8.GetBytes(json), bin);
        GltfImportResult result = await new GltfImporter(new GltfImporterOptions { Id = "morph.glb" })
            .ImportAsync(glb);

        var targets = result.Meshes[0].Definition.MorphTargets;
        targets.Should().HaveCount(2);
        targets.Select(static target => target.Semantic)
            .Should().Equal(GltfMorphTargetSemantic.Position, GltfMorphTargetSemantic.Normal);
    }

    private static byte[] BuildGlb(byte[] json, byte[] bin)
    {
        int jsonPad = (4 - (json.Length % 4)) % 4;
        int binPad = (4 - (bin.Length % 4)) % 4;
        int total = 12 + 8 + json.Length + jsonPad + 8 + bin.Length + binPad;
        byte[] outBuf = new byte[total];
        BinaryPrimitives.WriteUInt32LittleEndian(outBuf.AsSpan(0, 4), 0x46546C67);
        BinaryPrimitives.WriteUInt32LittleEndian(outBuf.AsSpan(4, 4), 2u);
        BinaryPrimitives.WriteUInt32LittleEndian(outBuf.AsSpan(8, 4), (uint)total);
        BinaryPrimitives.WriteUInt32LittleEndian(outBuf.AsSpan(12, 4), (uint)(json.Length + jsonPad));
        BinaryPrimitives.WriteUInt32LittleEndian(outBuf.AsSpan(16, 4), 0x4E4F534A);
        Buffer.BlockCopy(json, 0, outBuf, 20, json.Length);
        for (int i = 0; i < jsonPad; i++)
        {
            outBuf[20 + json.Length + i] = 0x20;
        }

        int off = 20 + json.Length + jsonPad;
        BinaryPrimitives.WriteUInt32LittleEndian(outBuf.AsSpan(off, 4), (uint)(bin.Length + binPad));
        BinaryPrimitives.WriteUInt32LittleEndian(outBuf.AsSpan(off + 4, 4), 0x004E4942);
        Buffer.BlockCopy(bin, 0, outBuf, off + 8, bin.Length);
        return outBuf;
    }
}
