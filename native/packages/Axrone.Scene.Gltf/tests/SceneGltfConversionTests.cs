namespace Axrone.Scene.Gltf.Tests;

using System.Collections.Immutable;
using Axrone.AssetGltf;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Gltf;
using Axrone.Scene.Prefab;
using Axrone.Scene.Snapshot;
using FluentAssertions;
using Xunit;

public sealed class SceneGltfConversionTests
{
    [Fact]
    public void Import_IncludesBuiltInShaderDefinitions()
    {
        SceneGltfImportResult result = SceneGltfAdapter.Import(SceneGltfTestFactory.Result());

        result.Snapshot.Shaders.Should().ContainSingle();
        result.Snapshot.Shaders[0].Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/pbr"));
        result.Snapshot.Materials[0].ShaderId.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/pbr"));
        result.Diagnostics.Should().BeEmpty();
    }

    [Fact]
    public void Import_DedupesShaderDefinitionsInMaterialOrder()
    {
        ImmutableArray<GltfMaterialAsset> materials =
        [
            SceneGltfTestFactory.Material(id: "material0", doubleSided: true),
            SceneGltfTestFactory.Material(id: "material1", doubleSided: true),
            SceneGltfTestFactory.Material(id: "material2", alphaMode: GltfAlphaMode.Blend)
        ];

        SceneGltfImportResult result = SceneGltfAdapter.Import(SceneGltfTestFactory.Result(materials: materials));

        result.Snapshot.Shaders.Should().HaveCount(2);
        result.Snapshot.Shaders[0].Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/pbr/double-sided"));
        result.Snapshot.Shaders[1].Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/pbr/blend"));
        result.Snapshot.Shaders[1].Blend.Should().BeTrue();
        result.Snapshot.Shaders[0].Cull.Should().BeFalse();
    }

    [Fact]
    public void Import_CanSkipBuiltInShaderDefinitions()
    {
        SceneGltfImportResult result = SceneGltfAdapter.Import(
            SceneGltfTestFactory.Result(),
            new SceneGltfImportOptions { IncludeBuiltInShaders = false });

        result.Snapshot.Shaders.Should().BeEmpty();
    }

    [Fact]
    public void Convert_CopiesCallerShadersBeforeBuiltIns()
    {
        var customShader = new SceneShaderDefinition(
            SceneAssetId<ShaderAssetTag>.FromName("studio/water"),
            "void main(){}",
            "void main(){}");
        ImmutableArray<GltfMaterialAsset> materials =
        [
            SceneGltfTestFactory.Material(id: "material0", shaderId: "studio/water"),
            SceneGltfTestFactory.Material(id: "material1")
        ];

        SceneGltfConversion conversion = SceneGltfAdapter.Convert(
            SceneGltfTestFactory.Result(materials: materials),
            new SceneGltfImportOptions { Shaders = [customShader] });

        conversion.Shaders.Should().HaveCount(2);
        conversion.Shaders[0].Should().BeSameAs(customShader);
        conversion.Shaders[1].Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/pbr"));
        conversion.Materials[0].ShaderId.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("studio/water"));
        conversion.Diagnostics.Should().NotContain(diagnostic => diagnostic.Code == "scene.gltf.missing-shader");
    }

    [Fact]
    public void Convert_ReportsMissingCustomShaderDefinitions()
    {
        SceneGltfConversion conversion = SceneGltfAdapter.Convert(
            SceneGltfTestFactory.Result(
                materials: [SceneGltfTestFactory.Material(shaderId: "studio/water")]));

        conversion.Shaders.Should().BeEmpty();
        conversion.Materials[0].ShaderId.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("studio/water"));
        conversion.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.missing-shader");
    }

    [Fact]
    public void Convert_DedupesSharedSamplers()
    {
        GltfTextureSampler sampler = new(9729, 9987, 10497, 10497);
        ImmutableArray<GltfTextureAsset> textures =
        [
            SceneGltfTestFactory.Texture(id: "texture0", sampler: sampler),
            SceneGltfTestFactory.Texture(id: "texture1", sampler: sampler)
        ];
        ImmutableArray<GltfMaterialAsset> materials =
        [
            SceneGltfTestFactory.Material(
                textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
                {
                    [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding("texture0"),
                    [GltfTextureUsage.Normal] = SceneGltfTestFactory.Binding("texture1")
                })
        ];

        SceneGltfConversion conversion = SceneGltfAdapter.Convert(
            SceneGltfTestFactory.Result(materials: materials, textures: textures));

        conversion.Samplers.Should().ContainSingle();
        conversion.Textures.Should().HaveCount(2);
        conversion.Textures[0].SamplerId.Should().Be(conversion.Samplers[0].Id);
        conversion.Textures[1].SamplerId.Should().Be(conversion.Samplers[0].Id);
        conversion.Materials[0].Surface.AlbedoMap!.Value.SamplerId.Should().Be(conversion.Samplers[0].Id);
        conversion.Materials[0].Surface.NormalMap!.Value.SamplerId.Should().Be(conversion.Samplers[0].Id);
    }

    [Fact]
    public void Convert_MarksColorTexturesAsSrgb()
    {
        ImmutableArray<GltfTextureAsset> textures =
        [
            SceneGltfTestFactory.Texture(id: "texture0"),
            SceneGltfTestFactory.Texture(id: "texture1"),
            SceneGltfTestFactory.Texture(id: "texture2")
        ];
        ImmutableArray<GltfMaterialAsset> materials =
        [
            SceneGltfTestFactory.Material(
                textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
                {
                    [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding("texture0"),
                    [GltfTextureUsage.Normal] = SceneGltfTestFactory.Binding("texture1"),
                    [GltfTextureUsage.Emissive] = SceneGltfTestFactory.Binding("texture2")
                })
        ];

        SceneGltfConversion conversion = SceneGltfAdapter.Convert(
            SceneGltfTestFactory.Result(materials: materials, textures: textures));

        FindTexture(conversion.Textures, "gltf/texture0").Format.Should().Be(SceneTextureFormat.Srgba8);
        FindTexture(conversion.Textures, "gltf/texture1").Format.Should().Be(SceneTextureFormat.Rgba8);
        FindTexture(conversion.Textures, "gltf/texture2").Format.Should().Be(SceneTextureFormat.Srgba8);
    }

    [Fact]
    public void Convert_ReportsUnsupportedTexturesAndDropsBindings()
    {
        ImmutableArray<GltfTextureAsset> textures =
        [
            SceneGltfTestFactory.Texture(
                id: "texture0",
                payload: new GltfExternalTexturePayload("texture.png"))
        ];
        ImmutableArray<GltfMaterialAsset> materials =
        [
            SceneGltfTestFactory.Material(
                textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
                {
                    [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding("texture0")
                })
        ];

        SceneGltfConversion conversion = SceneGltfAdapter.Convert(
            SceneGltfTestFactory.Result(materials: materials, textures: textures));

        conversion.Textures.Should().BeEmpty();
        conversion.Samplers.Should().BeEmpty();
        conversion.Materials[0].Surface.AlbedoMap.Should().BeNull();
        conversion.Materials[0].Surface.Features.Should().NotHaveFlag(SceneMaterialFeatures.AlbedoMap);
        conversion.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.unsupported-texture");
        conversion.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.missing-texture");
    }

    [Fact]
    public void Convert_ReportsUnsupportedMeshAttributes()
    {
        var attributes = ImmutableArray.Create(
            new GltfVertexAttribute(0, 12, 5126, GltfMeshSemantic.Position, 3, false, false),
            new GltfVertexAttribute(0, 12, 5126, GltfMeshSemantic.Uv2, 2, false, false));
        var mesh = new GltfMeshAsset
        {
            Id = "mesh0",
            MeshIndex = 0,
            PrimitiveIndex = 0,
            Definition = new GltfMeshDefinition(
                "mesh0",
                new byte[36],
                attributes,
                [],
                new byte[6],
                VertexCount: 3,
                IndexCount: 3,
                Index16Bit: true,
                GltfMeshTopology.Triangles)
        };

        SceneGltfConversion conversion = SceneGltfAdapter.Convert(
            SceneGltfTestFactory.Result(meshes: [mesh]));

        conversion.Meshes[0].Attributes.Should().ContainSingle();
        conversion.Meshes[0].Attributes[0].Semantic.Should().Be(SceneMeshSemantic.Position);
        conversion.Diagnostics.Should().Contain(diagnostic => diagnostic.Code == "scene.gltf.unsupported-attribute");
    }

    [Fact]
    public void Convert_ThrowsOnDuplicateMaterialIds()
    {
        ImmutableArray<GltfMaterialAsset> materials =
        [
            SceneGltfTestFactory.Material(id: "material0"),
            SceneGltfTestFactory.Material(id: "material0")
        ];

        Action convert = () => SceneGltfAdapter.Convert(SceneGltfTestFactory.Result(materials: materials));

        convert.Should().Throw<SceneGltfException>()
            .Which.Code.Should().Be(SceneGltfErrorCodes.Invalid);
    }

    [Fact]
    public void Convert_ThrowsOnDuplicateTextureIds()
    {
        ImmutableArray<GltfTextureAsset> textures =
        [
            SceneGltfTestFactory.Texture(id: "texture0"),
            SceneGltfTestFactory.Texture(id: "texture0")
        ];

        Action convert = () => SceneGltfAdapter.Convert(SceneGltfTestFactory.Result(textures: textures));

        convert.Should().Throw<SceneGltfException>()
            .Which.Code.Should().Be(SceneGltfErrorCodes.Invalid);
    }

    [Fact]
    public void Convert_ThrowsOnEmptyMeshId()
    {
        var mesh = new GltfMeshAsset
        {
            Id = "mesh0",
            MeshIndex = 0,
            PrimitiveIndex = 0,
            Definition = new GltfMeshDefinition(
                " ",
                new byte[36],
                [new GltfVertexAttribute(0, 12, 5126, GltfMeshSemantic.Position, 3, false, false)],
                [],
                new byte[6],
                VertexCount: 3,
                IndexCount: 3,
                Index16Bit: true,
                GltfMeshTopology.Triangles)
        };

        Action convert = () => SceneGltfAdapter.Convert(SceneGltfTestFactory.Result(meshes: [mesh]));

        convert.Should().Throw<SceneGltfException>()
            .Which.Code.Should().Be(SceneGltfErrorCodes.Invalid);
    }

    [Fact]
    public void Import_ThrowsWhenNoPrefabIsPresent()
    {
        GltfImportResult result = SceneGltfTestFactory.Result(prefabs: []);

        Action import = () => SceneGltfAdapter.Import(result);

        import.Should().Throw<SceneGltfException>()
            .Which.Code.Should().Be(SceneGltfErrorCodes.Invalid);
    }

    [Fact]
    public void Convert_DoesNotRequireAPrefab()
    {
        GltfImportResult result = SceneGltfTestFactory.Result(prefabs: []);

        SceneGltfConversion conversion = SceneGltfAdapter.Convert(result);

        conversion.Materials.Should().ContainSingle();
        conversion.Meshes.Should().ContainSingle();
    }

    [Fact]
    public void Import_ToonOptionProducesToonSnapshot()
    {
        SceneGltfImportResult result = SceneGltfAdapter.Import(
            SceneGltfTestFactory.Result(),
            new SceneGltfImportOptions { ShadingModel = SceneGltfShadingModel.Toon });

        result.Snapshot.Materials[0].ShaderId.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/toon"));
        result.Snapshot.Materials[0].Surface.ShadingModel.Should().Be(SceneMaterialShadingModel.Toon);
        result.Snapshot.Shaders.Should().ContainSingle();
        result.Snapshot.Shaders[0].Uniforms.Should().Contain("_ShadowColor");
    }

    [Fact]
    public void Convert_AndImportShareTheSameDefinitionPipeline()
    {
        GltfImportResult source = SceneGltfTestFactory.Result(
            materials:
            [
                SceneGltfTestFactory.Material(
                    alphaMode: GltfAlphaMode.Blend,
                    textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
                    {
                        [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding("texture0")
                    })
            ]);

        SceneGltfConversion conversion = SceneGltfAdapter.Convert(source);
        SceneSnapshot snapshot = SceneGltfAdapter.Import(source).Snapshot;

        snapshot.Materials.Should().HaveCount(conversion.Materials.Count);
        snapshot.Meshes.Should().HaveCount(conversion.Meshes.Count);
        snapshot.Textures.Should().HaveCount(conversion.Textures.Count);
        snapshot.Samplers.Should().HaveCount(conversion.Samplers.Count);
        snapshot.Shaders.Should().HaveCount(conversion.Shaders.Count);

        for (int i = 0; i < conversion.Materials.Count; i++)
        {
            snapshot.Materials[i].Id.Should().Be(conversion.Materials[i].Id);
            snapshot.Materials[i].ShaderId.Should().Be(conversion.Materials[i].ShaderId);
        }

        snapshot.Shaders[0].Id.Should().Be(conversion.Shaders[0].Id);
    }

    [Fact]
    public void Import_IsDeterministicForIdenticalInputs()
    {
        GltfImportResult source = SceneGltfTestFactory.Result(
            materials:
            [
                SceneGltfTestFactory.Material(
                    alphaMode: GltfAlphaMode.Mask,
                    doubleSided: true,
                    scalars: new Dictionary<string, float> { ["_MetallicFactor"] = 0.3f },
                    textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
                    {
                        [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding("texture0"),
                        [GltfTextureUsage.Normal] = SceneGltfTestFactory.Binding("texture1")
                    })
            ],
            textures:
            [
                SceneGltfTestFactory.Texture(id: "texture0"),
                SceneGltfTestFactory.Texture(id: "texture1")
            ]);

        var firstNames = new SceneNameTable();
        var secondNames = new SceneNameTable();
        SceneSnapshot first = SceneGltfAdapter.Import(
            source,
            new SceneGltfImportOptions { Names = firstNames }).Snapshot;
        SceneSnapshot second = SceneGltfAdapter.Import(
            source,
            new SceneGltfImportOptions { Names = secondNames }).Snapshot;

        byte[] firstJson = SceneSnapshotJson.Serialize(first, firstNames);
        byte[] secondJson = SceneSnapshotJson.Serialize(second, secondNames);

        firstJson.Should().Equal(secondJson);
    }

    [Fact]
    public void Import_RoundTripsThroughSnapshotJson()
    {
        var names = new SceneNameTable();
        GltfImportResult source = SceneGltfTestFactory.Result(
            materials:
            [
                SceneGltfTestFactory.Material(
                    alphaMode: GltfAlphaMode.Mask,
                    alphaCutoff: 0.25f,
                    doubleSided: true,
                    floats: new Dictionary<string, float[]>
                    {
                        ["_BaseColorFactor"] = [0.4f, 0.5f, 0.6f, 1.0f]
                    },
                    scalars: new Dictionary<string, float> { ["_ClearcoatFactor"] = 0.5f },
                    textures: new Dictionary<GltfTextureUsage, GltfMaterialTextureBinding>
                    {
                        [GltfTextureUsage.BaseColor] = SceneGltfTestFactory.Binding(
                            "texture0",
                            texCoord: 1,
                            transformScale: new Vec2(2.0f, 2.0f),
                            transformOffset: new Vec2(0.25f, 0.5f),
                            rotation: 0.75f,
                            transformTexCoord: 1)
                    })
            ]);

        SceneSnapshot snapshot = SceneGltfAdapter.Import(
            source,
            new SceneGltfImportOptions { Names = names }).Snapshot;
        byte[] json = SceneSnapshotJson.Serialize(snapshot, names);
        SceneSnapshot read = SceneSnapshotJson.Deserialize(json);

        read.Shaders.Should().ContainSingle();
        read.Shaders[0].Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/pbr/double-sided"));
        read.Materials.Should().ContainSingle();

        SceneMaterialDefinition material = read.Materials[0];
        material.Surface.Features.Should().HaveFlag(SceneMaterialFeatures.Clearcoat);
        material.Surface.Features.Should().HaveFlag(SceneMaterialFeatures.SecondUv);
        material.Surface.AlphaMode.Should().Be(SceneMaterialAlphaMode.Mask);
        material.Surface.AlphaCutoff.Should().BeApproximately(0.25f, 1e-6f);
        material.Surface.Tiling.Should().Be(new Vec2(2.0f, 2.0f));
        material.Surface.Offset.Should().Be(new Vec2(0.25f, 0.5f));
        material.Surface.AlbedoMap!.Value.UvSet.Should().Be(SceneUvSet.Uv1);
        material.Surface.AlbedoMap!.Value.Rotation.Should().BeApproximately(0.75f, 1e-6f);

        material.Passes.Should().HaveCount(3);
        material.Passes[2].Id.Should().Be("shadow-caster");
        material.Passes[2].Priority.Should().Be(1);

        material.Uniforms["_ClearcoatFactor"].Should().Be(SceneUniformValue.FromFloat(0.5f));
        material.Uniforms["_AlphaCutoff"].Should().Be(SceneUniformValue.FromFloat(0.25f));
        material.Uniforms["_BaseColorTexture_TexCoord"].Should().Be(SceneUniformValue.FromInt(1));

        read.Prefab.Actors.Should().ContainSingle();
        read.Prefab.Actors[0].Components.Should().Contain(component => component.Type == "MeshRenderer");
    }

    private static SceneTextureDefinition FindTexture(
        IReadOnlyList<SceneTextureDefinition> textures,
        string id)
    {
        SceneAssetId<TextureAssetTag> expected = SceneAssetId<TextureAssetTag>.FromName(id);
        for (int i = 0; i < textures.Count; i++)
        {
            if (textures[i].Id == expected)
            {
                return textures[i];
            }
        }

        throw new InvalidOperationException($"Texture '{id}' was not converted.");
    }
}
