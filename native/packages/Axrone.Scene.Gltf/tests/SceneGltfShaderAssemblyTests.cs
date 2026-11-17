using System.Text.RegularExpressions;
using Axrone.Scene.Assets;
using Axrone.Scene.Gltf;
using FluentAssertions;

namespace Axrone.Scene.Gltf.Tests;

/// <summary>
/// Regression locks for the built-in glTF shader assembly: desktop GL rejects
/// two-argument <c>clamp</c>, and the ambient term must not be gated by
/// view-dependent Fresnel or grazing faces render black.
/// </summary>
public sealed class SceneGltfShaderAssemblyTests
{
    private static readonly Regex ClampCall = new(@"clamp\(", RegexOptions.Compiled);

    [Fact]
    public void PbrFragment_AppliesAmbientWithoutFresnelGating()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.FragmentSource.Should().Contain(
            "vec3 diffuseAmbient = irradiance * albedo * (1.0 - metallic);",
            "ambient diffuse must not be multiplied by a Fresnel term");

        string diffuseLine = SingleLine(shader.FragmentSource, "vec3 diffuseAmbient");
        diffuseLine.Should().NotContain("fresnel", "grazing faces must not be gated by Fresnel");
        diffuseLine.Should().NotContain("0.65", "the native-only hemisphere attenuation must be gone");
        diffuseLine.Should().NotContain("0.25", "the native-only ambient attenuation must be gone");
    }

    [Fact]
    public void PbrFragment_MatchesWebGltfIblIrradiance()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.FragmentSource.Should().Contain(
            "vec3 hemiIrradiance = mix(u_GroundLight, u_SkyLight, hemiFactor);");
        shader.FragmentSource.Should().Contain(
            "vec3 irradiance = hemiIrradiance + (u_AmbientLight * 0.45);");
        shader.FragmentSource.Should().Contain(
            "vec3 prefilteredEnv = mix(u_GroundLight * 0.5, u_SkyLight, specHemiFactor);");
        shader.FragmentSource.Should().NotContain(
            "mix(prefilteredEnv, u_AmbientLight, 0.25)",
            "the native-only ambient env mix must be gone");
    }

    [Fact]
    public void PbrFragment_MatchesWebGltfEnvBrdf()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.FragmentSource.Should().Contain(
            "float NdotV = max(dot(normal, viewDir), 0.001);");
        shader.FragmentSource.Should().Contain(
            "float oneMinusNdotV = max(1.0 - NdotV, 0.0);");
        shader.FragmentSource.Should().Contain(
            "clamp(pow(roughness, 0.6 + 0.2 * NdotV) * oneMinusNdotV * 1.7, 0.0, 1.0)");
        shader.FragmentSource.Should().Contain(
            "clamp(pow(roughness, 2.0 * NdotV) * oneMinusNdotV * 0.5 + 0.02, 0.0, 1.0)");
        shader.FragmentSource.Should().Contain(
            "vec3 envSpecular = prefilteredEnv * (envF * envBRDF.x + envBRDF.y);");
        shader.FragmentSource.Should().Contain("vec3 fresnelSchlickRoughness(float cosTheta, vec3 F0, float roughness)");
        shader.FragmentSource.Should().Contain(
            "vec3 envF = fresnelSchlickRoughness(max(dot(normal, viewDir), 0.0), F0, roughness);");
    }

    [Fact]
    public void PbrFragment_ThreadsF0ThroughSpecularBrdf()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.FragmentSource.Should().Contain(
            "vec3 evaluateSpecularBrdf(vec3 N, vec3 V, vec3 L, float roughness, vec3 F0)");
        shader.FragmentSource.Should().Contain("vec3 F = fresnelSchlick(VdotH, F0);");
        shader.FragmentSource.Should().NotContain(
            "fresnelSchlick(VdotH, vec3(0.04))",
            "the dielectric-only Fresnel must be replaced by the material F0");
        shader.FragmentSource.Should().Contain(
            "vec3 specular = evaluateSpecularBrdf(normal, viewDir, lightDir, roughness, F0);");
    }

    [Fact]
    public void PbrFragment_HasNoEditorPreviewMatteShortcut()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.FragmentSource.Should().NotContain(
            "u_EditorPreview == 1",
            "WebGL2 renders authored materials with the same compiled PBR in both tabs; the matte branch was native-only");
        shader.FragmentSource.Should().NotContain("editorLighting");
        shader.FragmentSource.Should().NotContain("editorColor");
        shader.FragmentSource.Should().NotContain("editorLightDirection");
    }

    [Fact]
    public void PbrFragment_KeepsTheFrameUniformsCatalogued()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.Uniforms.Should().Contain(
            [
                "u_EditorPreview",
                "u_OutputGamma",
                "u_SkyLight",
                "u_GroundLight",
                "u_DirectionalLightAmbientColor"
            ],
            "the executor still binds these, so they must stay in the catalog even when unused in GLSL");
        shader.FragmentSource.Should().Contain("uniform int u_EditorPreview;");
        shader.FragmentSource.Should().Contain("uniform vec3 u_DirectionalLightAmbientColor;");
    }

    [Fact]
    public void PbrFragment_UsesOneUnifiedLightingPathForBothTabs()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.FragmentSource.Should().Contain("mix(u_GroundLight, u_SkyLight, hemiFactor)");
        shader.FragmentSource.Should().Contain("u_AmbientLight * 0.45");
        shader.FragmentSource.Should().Contain("irradiance += u_DirectionalLightAmbientColor;");
        shader.FragmentSource.Should().Contain("evaluateGltfSheen");
        shader.FragmentSource.Should().Contain("linearToSrgb(color)");
        shader.FragmentSource.Should().Contain(
            "vec3 diffuse = kD * albedo / PI",
            "the single PBR path keeps the physical /PI diffuse the editor branch used to bypass");
    }

    [Fact]
    public void PbrFragment_DisablesSheenWhenTheFactorIsZero()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.FragmentSource.Should().Contain(
            "float sheenFactor = clamp(_SheenFactor, 0.0, 1.0);");
        shader.FragmentSource.Should().Contain(
            "vec3 sheenColor = _SheenColorFactor * sheenFactor;");
        shader.FragmentSource.Should().NotContain(
            "_SheenFactor > 0.0 ? clamp(_SheenFactor, 0.0, 1.0) : 1.0",
            "a zero sheen factor must not fall back to full-strength sheen");
        shader.FragmentSource.Should().NotContain(
            "sheenScale",
            "the inverted sheenScale fallback must never come back");
        shader.FragmentSource.Should().NotContain(
            "sheenColor * (1.0 - max(dot(normal, viewDir), 0.0)) * irradiance",
            "the native-only IBL sheen wash blinded upward-facing normals");
        shader.FragmentSource.Should().Contain("evaluateGltfSheen");
    }

    [Fact]
    public void PbrFragment_AppliesSheenAsShadowedDirectLightOnly()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.FragmentSource.Should().Contain(
            "float sheenRoughness = clamp(_SheenRoughnessFactor, 0.04, 1.0);");
        shader.FragmentSource.Should().Contain(
            "uniform float _SheenRoughnessFactor;",
            "sheen roughness was previously declared-but-dead; the lobe now reads it");
        shader.FragmentSource.Should().Contain(
            "evaluateGltfSheen(normal, viewDir, lightDirection, sheenColor, sheenRoughness) * u_LightColor * u_LightIntensity * shadowFactor");
        shader.FragmentSource.Should().Contain(
            "evaluateGltfSheen(normal, viewDir, pointDirection, sheenColor, sheenRoughness) * u_PointLightColor * u_PointLightIntensity * pointAttenuation");
        shader.FragmentSource.Should().Contain(
            "evaluateGltfSheen(normal, viewDir, spotDirection, sheenColor, sheenRoughness) * u_SpotLightColor * u_SpotLightIntensity * spotAttenuationValue");

        CountOccurrences(shader.FragmentSource, "if (sheenFactor > 0.001) {")
            .Should().Be(3, "WebGL2 gates sheen once per directional, point and spot light");
        CountOccurrences(shader.FragmentSource, "evaluateGltfSheen(normal, viewDir,")
            .Should().Be(3);
    }

    [Fact]
    public void PbrGamePath_AddsTheDirectionalAmbientColorToIrradiance()
    {
        SceneShaderDefinition shader = SceneGltfShaders.CreatePbr();

        shader.FragmentSource.Should().Contain(
            "irradiance += u_DirectionalLightAmbientColor;",
            "compiler-generated-pbr.ts:846 folds the directional ambient into the IBL irradiance of the full PBR path");
        shader.FragmentSource.Should().Contain(
            "uniform vec3 u_DirectionalLightAmbientColor;",
            "the uniform must be declared, not merely referenced, or the program fails to link");

        CountOccurrences(shader.FragmentSource, "u_DirectionalLightAmbientColor")
            .Should().Be(
                2,
                "one declaration plus exactly one add now that both tabs share the single PBR path");
    }

    [Theory]
    [InlineData("gltf/pbr")]
    [InlineData("gltf/pbr/blend")]
    [InlineData("gltf/pbr/double-sided")]
    public void PbrShaders_AddDirectionalAmbientOnceInTheUnifiedPath(string shaderName)
    {
        ArgumentNullException.ThrowIfNull(shaderName);
        SceneGltfShaders.TryCreate(shaderName, names: null, out SceneShaderDefinition? shader)
            .Should().BeTrue();

        string source = shader!.FragmentSource;

        CountOccurrences(source, "irradiance += u_DirectionalLightAmbientColor;")
            .Should().Be(1, $"{shaderName} must add the ambient exactly once, with no editor-preview duplicate");
        source.Should().NotContain("u_EditorPreview == 1", $"{shaderName} must not keep a matte shortcut");

        source.Should().Contain(
            "if (u_ReceiveLighting) {\n        irradiance += u_DirectionalLightAmbientColor;\n    }",
            $"{shaderName} must gate the ambient add on receive-lighting, like the WebGL2 reference");
    }

    [Theory]
    [InlineData("gltf/pbr")]
    [InlineData("gltf/pbr/blend")]
    [InlineData("gltf/pbr/double-sided")]
    public void PbrShaders_NeverApplySheenWithoutAFactor(string shaderName)
    {
        ArgumentNullException.ThrowIfNull(shaderName);
        SceneGltfShaders.TryCreate(shaderName, names: null, out SceneShaderDefinition? shader)
            .Should().BeTrue();

        string source = shader!.FragmentSource;
        int gates = CountOccurrences(source, "if (sheenFactor > 0.001) {");
        int calls = CountOccurrences(source, "evaluateGltfSheen(normal, viewDir,");

        calls.Should().Be(3, $"{shaderName} evaluates sheen for the directional, point and spot light");
        gates.Should().Be(calls, $"{shaderName} must never evaluate sheen outside the factor guard");
    }

    [Fact]
    public void SheenLibraryFunctionMatchesTheWebGltfCharlieLobe()
    {
        SceneGltfShaderLibrary.TryGetCode(
            SceneGltfShaderLibrary.PbrLightingBlockId,
            out string? lighting).Should().BeTrue();

        lighting!.Should().Contain(
            "vec3 evaluateGltfSheen(vec3 N, vec3 V, vec3 L, vec3 sheenColor, float sheenRoughness)");
        lighting.Should().Contain(
            "float D = (2.0 + invRoughnessSq) * pow(sin2h, invRoughnessSq * 0.5) / (2.0 * PI);");
        lighting.Should().Contain(
            "float F = VdotH * exp2((-5.55473 * VdotH - 6.98316) * VdotH);");
        lighting.Should().Contain("return sheenColor * D * F * NdotL;");
    }

    [Theory]
    [InlineData("gltf/pbr")]
    [InlineData("gltf/unlit")]
    [InlineData("gltf/toon")]
    public void BuiltInShaders_ApplyTheFrameOutputGamma(string shaderId)
    {
        SceneGltfShaders.TryCreate(shaderId, names: null, out SceneShaderDefinition? shader)
            .Should().BeTrue();

        shader!.FragmentSource.Should().Contain("u_OutputGamma");
        shader.FragmentSource.Should().Contain("vec3(u_OutputGamma)");
        shader.FragmentSource.Should().Contain(
            "u_OutputGamma < 0.99",
            "the game path must take the exact sRGB transfer curve in linear projects");
        shader.FragmentSource.Should().Contain("linearToSrgb(color)");
    }

    [Theory]
    [InlineData("gltf/pbr")]
    [InlineData("gltf/unlit")]
    [InlineData("gltf/toon")]
    [InlineData("gltf/pbr/blend")]
    [InlineData("gltf/pbr/double-sided")]
    [InlineData("gltf/unlit/blend/double-sided")]
    public void AssembledSources_NeverCallTwoArgumentClamp(string shaderId)
    {
        SceneGltfShaders.TryCreate(shaderId, names: null, out SceneShaderDefinition? shader)
            .Should().BeTrue();

        foreach (string source in new[] { shader!.VertexSource, shader.FragmentSource })
        {
            foreach (Match match in ClampCall.Matches(source))
            {
                CountArguments(source, match.Index + match.Length - 1)
                    .Should().Be(3, $"{shaderId} must use the GLSL three-argument clamp");
            }
        }
    }

    [Theory]
    [InlineData("gltf/pbr")]
    [InlineData("gltf/pbr/blend")]
    [InlineData("gltf/pbr/double-sided")]
    [InlineData("gltf/toon")]
    public void DirectionalLightShadersNegateLightToSceneVector(string shaderName)
    {
        ArgumentNullException.ThrowIfNull(shaderName);
        SceneGltfShaders.TryCreate(shaderName, names: null, out SceneShaderDefinition? shader)
            .Should().BeTrue();

        shader!.FragmentSource.Should().Contain("normalize(-u_LightDirection)");
    }

    [Theory]
    [InlineData("gltf/pbr")]
    [InlineData("gltf/pbr/blend")]
    [InlineData("gltf/pbr/double-sided")]
    public void PbrShaders_NeverCallHighlightCompression(string shaderName)
    {
        ArgumentNullException.ThrowIfNull(shaderName);
        SceneGltfShaders.TryCreate(shaderName, names: null, out SceneShaderDefinition? shader)
            .Should().BeTrue();

        shader!.FragmentSource.Should().NotContain(
            "= gltfSoftCompressHighlights(",
            "WebGL2 gltf/pbr has no in-shader highlight compression; the rolloff dulled bright floors and speculars");
    }

    private static int CountOccurrences(string source, string needle)
    {
        int count = 0;
        for (int index = source.IndexOf(needle, StringComparison.Ordinal);
            index >= 0;
            index = source.IndexOf(needle, index + needle.Length, StringComparison.Ordinal))
        {
            count++;
        }

        return count;
    }

    private static string SingleLine(string source, string prefix)
    {
        string? match = null;
        foreach (string candidate in source.Split('\n'))
        {
            if (!candidate.TrimStart().StartsWith(prefix, StringComparison.Ordinal))
            {
                continue;
            }

            if (match is not null)
            {
                throw new InvalidOperationException($"Shader line '{prefix}' is not unique.");
            }

            match = candidate.Trim();
        }

        return match ?? throw new InvalidOperationException($"Shader line '{prefix}' not found.");
    }

    private static int CountArguments(string source, int openParenthesisIndex)
    {
        int depth = 0;
        int arguments = 1;

        for (int index = openParenthesisIndex; index < source.Length; index++)
        {
            char character = source[index];

            if (character == '(')
            {
                depth++;
            }
            else if (character == ')')
            {
                depth--;

                if (depth == 0)
                {
                    return arguments;
                }
            }
            else if (character == ',' && depth == 1)
            {
                arguments++;
            }
        }

        return arguments;
    }
}
