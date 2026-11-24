namespace Axrone.Scene.Gltf.Tests;

using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Gltf;
using FluentAssertions;
using Xunit;

public sealed class SceneGltfShaderTests
{
    [Fact]
    public void Library_BlocksAreOrderedAndResolvable()
    {
        SceneGltfShaderBlock[] blocks = SceneGltfShaderLibrary.Blocks.ToArray();

        blocks.Should().HaveCount(6);
        blocks[0].Id.Should().Be(SceneGltfShaderLibrary.UvBlockId);
        blocks[1].Id.Should().Be(SceneGltfShaderLibrary.PbrLightingBlockId);
        blocks[2].Id.Should().Be(SceneGltfShaderLibrary.ToonShadingBlockId);
        blocks[3].Id.Should().Be(SceneGltfShaderLibrary.ColorSpaceBlockId);
        blocks[4].Id.Should().Be(SceneGltfShaderLibrary.ShadowBlockId);
        blocks[5].Id.Should().Be(SceneGltfShaderLibrary.FogBlockId);

        SceneGltfShaderLibrary.TryGetCode(SceneGltfShaderLibrary.UvBlockId, out string? uv).Should().BeTrue();
        uv!.Should().Contain("transformGltfUv").And.Contain("selectGltfUv");

        SceneGltfShaderLibrary.TryGetCode(SceneGltfShaderLibrary.PbrLightingBlockId, out string? pbr).Should().BeTrue();
        pbr!.Should().Contain("distributionGgx").And.Contain("evaluateGltfDirectLight").And.Contain("evaluateGltfClearcoat");

        SceneGltfShaderLibrary.TryGetCode(SceneGltfShaderLibrary.ToonShadingBlockId, out string? toon).Should().BeTrue();
        toon!.Should().Contain("toonBand").And.Contain("toonRim");

        SceneGltfShaderLibrary.TryGetCode(SceneGltfShaderLibrary.ColorSpaceBlockId, out string? colorSpace).Should().BeTrue();
        colorSpace!.Should().Contain("linearToSrgb");

        SceneGltfShaderLibrary.TryGetCode(SceneGltfShaderLibrary.ShadowBlockId, out string? shadow).Should().BeTrue();
        shadow!.Should().Contain("gltfResolveShadowFactor")
            .And.Contain("gltfShadowPcf")
            .And.Contain("gltfShadowEsm")
            .And.Contain("gltfShadowVsm");

        SceneGltfShaderLibrary.TryGetCode(SceneGltfShaderLibrary.FogBlockId, out string? fog).Should().BeTrue();
        fog!.Should().Contain("gltfApplyFog").And.Contain("gltfHeightFogFactor");

        SceneGltfShaderLibrary.TryGetCode("gltf.unknown", out _).Should().BeFalse();
    }

    [Fact]
    public void Properties_PbrCatalogMatchesTheDeclaredShaderContract()
    {
        string[] names = Names(SceneGltfShaderProperties.Pbr);

        names.Should().StartWith(["u_Model", "u_View", "u_Projection"]);
        names.Should().OnlyHaveUniqueItems();
        names.Should().Contain(
        [
            "u_Albedo",
            "u_AlbedoMap",
            "u_PbrMap",
            "_AlphaMode",
            "_AlphaCutoff",
            "_DoubleSided",
            "_BaseColorFactor",
            "_BaseColorTexture_ST",
            "_NormalTexture_Scale",
            "_OcclusionTexture_Strength",
            "_ClearcoatFactor",
            "_ClearcoatNormalTexture_Scale",
            "_AnisotropyStrength",
            "_TransmissionFactor",
            "_SubsurfaceFactor",
            "_IridescenceFactor"
        ]);
        names.Should().NotContain("_ShadowColor");

        SceneGltfShaderProperties.TryGetMaterialProperty("_BaseColorTexture_TexCoord", out SceneGltfShaderProperty texCoord)
            .Should().BeTrue();
        texCoord.Type.Should().Be(SceneGltfShaderPropertyType.Int);
        texCoord.Scope.Should().Be(SceneGltfShaderScope.Material);

        SceneGltfShaderProperties.IsKnownMaterialProperty("_BaseColorFactor").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("_ShadowColor").Should().BeTrue();
        SceneGltfShaderProperties.IsKnownMaterialProperty("not_a_property").Should().BeFalse();
    }

    [Fact]
    public void Properties_CatalogsAreDeterministic()
    {
        Names(SceneGltfShaderProperties.Pbr).Should().Equal(Names(SceneGltfShaderProperties.Pbr));
        Names(SceneGltfShaderProperties.Unlit).Should().Equal(Names(SceneGltfShaderProperties.Unlit));
        Names(SceneGltfShaderProperties.Toon).Should().Equal(Names(SceneGltfShaderProperties.Toon));

        Names(SceneGltfShaderProperties.Unlit).Should().Contain("_BaseColorFactor").And.NotContain("_MetallicFactor");
        Names(SceneGltfShaderProperties.Toon).Should().Contain(
        [
            "_ShadowColor",
            "_ShadowThreshold",
            "_ShadowSmoothness",
            "_HighlightThreshold",
            "_HighlightColor",
            "_RimColor",
            "_RimThreshold",
            "_RimSmoothness",
            "_OutlineWidth",
            "_OutlineColor"
        ]);
    }

    [Fact]
    public void CreatePbr_ProducesBuiltInDefinition()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName(SceneGltfShaders.PbrShaderName));
        shader.VertexSource.Should().Contain("#version 330 core");
        shader.VertexSource.Should().Contain("layout(location = 0) in vec3 a_Position;");
        shader.VertexSource.Should().Contain("uniform mat4 u_Model;");
        shader.FragmentSource.Should().Contain("uniform sampler2D u_AlbedoMap;");
        shader.FragmentSource.Should().Contain("uniform int _AlphaMode;");
        shader.FragmentSource.Should().Contain("evaluateGltfDirectLight");
        shader.FragmentSource.Should().Contain("_BaseColorTexture_ST");
        shader.FragmentSource.Should().Contain("float shadowFactor = gltfResolveShadowFactor(v_WorldPosition, normal, lightDirection);");
        shader.FragmentSource.Should().Contain("evaluateGltfDirectLight(normal, viewDir, albedo, metallic, roughness, F0, lightDirection, u_LightColor, u_LightIntensity) * shadowFactor");
        shader.FragmentSource.Should().Contain("evaluateGltfClearcoat(normal, viewDir, clearcoat, clearcoatRoughness, lightDirection, u_LightColor, u_LightIntensity) * shadowFactor");
        shader.FragmentSource.Should().Contain("gltfApplyFog(color, v_WorldPosition, u_CameraPosition)");
        shader.VertexSource.Should().Contain("out vec3 v_WorldPosition;");
        shader.Uniforms.Should().Contain(["u_ShadowMap", "u_ShadowEnabled", "u_ShadowCascadeCount", "u_ShadowFilter", "u_ShadowSplits", "u_ShadowTiles", "u_ShadowTexelSize", "u_ShadowLightMatrices", "u_ShadowDepthBias", "u_ShadowNormalBias"]);
        shader.Uniforms.Should().Contain(["u_HeightFogEnabled", "u_HeightFogColor", "u_HeightFogDensity", "u_HeightFogFalloff", "u_HeightFogGroundHeight"]);
        shader.Uniforms.Should().Contain("_BaseColorFactor").And.Contain("u_ReceiveLighting");
        shader.Attributes[SceneMeshSemantic.Tangent].Should().Be("a_Tangent");
        shader.DepthTest.Should().BeTrue();
        shader.Cull.Should().BeTrue();
        shader.Blend.Should().BeFalse();

        AssertDeclaredUniformsAreCatalogued(shader, SceneGltfShaderProperties.Pbr);
    }

    [Fact]
    public void CreateUnlit_UsesColorSpaceAndSkipsLitInputs()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreateUnlit();

        shader.Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName(SceneGltfShaders.UnlitShaderName));
        shader.FragmentSource.Should().Contain("u_OutputGamma");
        shader.FragmentSource.Should().Contain("vec3(u_OutputGamma)");
        shader.FragmentSource.Should().NotContain("evaluateGltfDirectLight");
        shader.FragmentSource.Should().NotContain("gltfResolveShadowFactor");
        shader.FragmentSource.Should().NotContain("u_ShadowMap");
        shader.FragmentSource.Should().Contain("gltfApplyFog(baseColor.rgb, v_WorldPosition, u_CameraPosition)");
        shader.VertexSource.Should().Contain("out vec3 v_WorldPosition;");
        shader.Uniforms.Should().NotContain(["u_ShadowMap", "u_ShadowEnabled", "u_ShadowLightMatrices"]);
        shader.Attributes.Should().NotContainKey(SceneMeshSemantic.Normal);
        shader.Attributes.Should().NotContainKey(SceneMeshSemantic.Tangent);
        shader.Uniforms.Should().Contain("_BaseColorFactor");

        AssertDeclaredUniformsAreCatalogued(shader, SceneGltfShaderProperties.Unlit);
    }

    [Fact]
    public void CreateToon_ProducesToonShadingDefinition()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreateToon();

        shader.Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName(SceneGltfShaders.ToonShaderName));
        shader.FragmentSource.Should().Contain("toonBand");
        shader.FragmentSource.Should().Contain("_ShadowColor");
        shader.FragmentSource.Should().NotContain("gltfResolveShadowFactor");
        shader.FragmentSource.Should().NotContain("u_ShadowMap");
        shader.FragmentSource.Should().Contain("gltfApplyFog(color, v_WorldPosition, u_CameraPosition)");
        shader.Uniforms.Should().NotContain(["u_ShadowMap", "u_ShadowEnabled", "u_ShadowLightMatrices"]);
        shader.Uniforms.Should().Contain("_ShadowColor").And.Contain("_RimColor").And.Contain("_OutlineWidth");
        shader.Attributes.Should().ContainKey(SceneMeshSemantic.Normal);
        shader.Attributes.Should().NotContainKey(SceneMeshSemantic.Tangent);

        AssertDeclaredUniformsAreCatalogued(shader, SceneGltfShaderProperties.Toon);
    }

    [Fact]
    public void TryCreate_ResolvesVariantsAndCachesBaseDefinitions()
    {
        SceneGltfShaders.TryCreate("gltf/pbr", names: null, out SceneShaderDefinition? pbr).Should().BeTrue();
        SceneGltfShaders.TryCreate("gltf/pbr", names: null, out SceneShaderDefinition? again).Should().BeTrue();
        ReferenceEquals(pbr, again).Should().BeTrue();

        SceneGltfShaders.TryCreate("gltf/pbr/blend/double-sided", names: null, out SceneShaderDefinition? variant)
            .Should().BeTrue();
        variant!.Blend.Should().BeTrue();
        variant.Cull.Should().BeFalse();
        variant.Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromName("gltf/pbr/blend/double-sided"));

        SceneGltfShaders.TryCreate("gltf/unlit/double-sided", names: null, out SceneShaderDefinition? unlitVariant)
            .Should().BeTrue();
        unlitVariant!.Cull.Should().BeFalse();
        unlitVariant.Blend.Should().BeFalse();

        SceneGltfShaders.TryCreate("studio/water", names: null, out _).Should().BeFalse();
    }

    [Fact]
    public void ResolveVariantId_OrdersSuffixesDeterministically()
    {
        SceneGltfShaders.ResolveVariantId("gltf/pbr", blend: false, doubleSided: false).Should().Be("gltf/pbr");
        SceneGltfShaders.ResolveVariantId("gltf/pbr", blend: true, doubleSided: false).Should().Be("gltf/pbr/blend");
        SceneGltfShaders.ResolveVariantId("gltf/pbr", blend: false, doubleSided: true).Should().Be("gltf/pbr/double-sided");
        SceneGltfShaders.ResolveVariantId("gltf/pbr", blend: true, doubleSided: true)
            .Should().Be("gltf/pbr/blend/double-sided");
    }

    [Fact]
    public void TryCreate_WithNameTable_InternsShaderId()
    {
        var names = new SceneNameTable();

        SceneGltfShaders.TryCreate("gltf/toon/blend", names, out SceneShaderDefinition? shader).Should().BeTrue();

        shader!.Id.Should().Be(SceneAssetId<ShaderAssetTag>.FromSymbol(names.Intern("gltf/toon/blend")));
    }

    private static string[] Names(ReadOnlySpan<SceneGltfShaderProperty> properties)
    {
        var names = new string[properties.Length];
        for (int i = 0; i < properties.Length; i++)
        {
            names[i] = properties[i].Name;
        }

        return names;
    }

    private static void AssertDeclaredUniformsAreCatalogued(
        SceneShaderDefinition shader,
        ReadOnlySpan<SceneGltfShaderProperty> catalog)
    {
        string[] declared = DeclaredUniforms(shader.VertexSource, shader.FragmentSource);
        string[] expected = Names(catalog);

        declared.Should().OnlyHaveUniqueItems();
        for (int i = 0; i < declared.Length; i++)
        {
            expected.Should().Contain(declared[i], $"uniform '{declared[i]}' must be declared by the catalog");
            shader.Uniforms.Should().Contain(declared[i]);
        }
    }

    private static string[] DeclaredUniforms(string vertexSource, string fragmentSource)
    {
        var names = new List<string>();
        Collect(vertexSource, names);
        Collect(fragmentSource, names);
        return [.. names];

        static void Collect(string source, List<string> target)
        {
            ReadOnlySpan<char> remaining = source;
            while (!remaining.IsEmpty)
            {
                int lineEnd = remaining.IndexOf('\n');
                ReadOnlySpan<char> line;
                if (lineEnd < 0)
                {
                    line = remaining;
                    remaining = default;
                }
                else
                {
                    line = remaining[..lineEnd];
                    remaining = remaining[(lineEnd + 1)..];
                }

                line = line.Trim();
                if (!line.StartsWith("uniform ", StringComparison.Ordinal))
                {
                    continue;
                }

                ReadOnlySpan<char> body = line["uniform ".Length..].TrimEnd(';');
                int nameStart = body.LastIndexOf(' ') + 1;
                ReadOnlySpan<char> name = body[nameStart..];
                int bracket = name.IndexOf('[');
                if (bracket >= 0)
                {
                    name = name[..bracket];
                }

                target.Add(name.ToString());
            }
        }
    }
}
