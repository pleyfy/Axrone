namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Render.OpenGL.Native;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

/// <summary>
/// Covers Material Contract v2 multi-pass plans reaching the fixed-function state:
/// the volume raymarch pass must own its depth, cull, and blend overrides, and an
/// extended PBR plan must enable blending only on the passes that ask for it.
/// </summary>
public sealed class SceneGlVolumePassTests
{
    private const string VertexShader = """
        #version 330 core
        layout(location = 0) in vec3 a_Position;
        uniform mat4 u_Model;
        uniform mat4 u_ViewProjection;
        void main()
        {
            gl_Position = vec4(a_Position, 1.0) * u_Model * u_ViewProjection;
        }
        """;

    private const string FragmentShader = """
        #version 330 core
        out vec4 fragColor;
        void main()
        {
            fragColor = vec4(1.0);
        }
        """;

    [Fact]
    public void ApplyState_UsesVolumeRaymarchPassOverrides()
    {
        using var fixture = new SceneGlFixture();
        using var shader = new SceneGlShader(fixture.Context, "gltf/volume", VertexShader, FragmentShader);
        SceneMaterialDefinition definition = new(
            fixture.Assets.CreateId<MaterialAssetTag>("material/volume"),
            fixture.Shader.Id,
            new SceneMaterialSurface(),
            MaterialContractV2.BuildPassesFromPlan(MaterialModelId.Volume));
        SceneGlMaterial material = new(definition, shader, []);
        SceneRenderPassDefinition pass = new(
            fixture.Assets.CreateId<RenderPassAssetTag>("volume-raymarch"),
            clearMask: SceneClearMask.None);

        SceneGlDrawExecutor.ApplyState(fixture.Context, transparent: false, material, pass);

        fixture.Context.State.DepthTestEnabled.Should().BeTrue();
        fixture.Context.State.DepthMask.Should().BeFalse();
        fixture.Context.State.CullFaceEnabled.Should().BeTrue();
        fixture.Context.State.CullMode.Should().Be(GLConst.Front);
        fixture.Context.State.BlendEnabled.Should().BeTrue();
    }

    [Fact]
    public void ApplyState_KeepsOpaqueMainPassUnblendedInExtendedPbrPlan()
    {
        using var fixture = new SceneGlFixture();
        using var shader = new SceneGlShader(fixture.Context, "gltf/pbr", VertexShader, FragmentShader);
        SceneMaterialDefinition definition = new(
            fixture.Assets.CreateId<MaterialAssetTag>("material/pbr-extended"),
            fixture.Shader.Id,
            new SceneMaterialSurface(),
            MaterialContractV2.BuildPassesFromPlan(MaterialModelId.Pbr));
        SceneGlMaterial material = new(definition, shader, []);

        SceneGlDrawExecutor.ApplyState(
            fixture.Context,
            transparent: false,
            material,
            new SceneRenderPassDefinition(
                fixture.Assets.CreateId<RenderPassAssetTag>("main"),
                clearMask: SceneClearMask.None));
        fixture.Context.State.BlendEnabled.Should().BeFalse();
        fixture.Context.State.DepthMask.Should().BeTrue();

        SceneGlDrawExecutor.ApplyState(
            fixture.Context,
            transparent: false,
            material,
            new SceneRenderPassDefinition(
                fixture.Assets.CreateId<RenderPassAssetTag>("sss-blur"),
                clearMask: SceneClearMask.None));
        fixture.Context.State.BlendEnabled.Should().BeTrue();
        fixture.Context.State.DepthMask.Should().BeFalse();
    }

    [Fact]
    public void Resolve_FallsBackToPrimaryPassWhenNoMatchedPassGiven()
    {
        using var fixture = new SceneGlFixture();
        using var shader = new SceneGlShader(fixture.Context, "gltf/particle", VertexShader, FragmentShader);
        SceneMaterialDefinition definition = new(
            fixture.Assets.CreateId<MaterialAssetTag>("material/blended"),
            fixture.Shader.Id,
            new SceneMaterialSurface(),
            [new SceneMaterialPass("main", blend: true)]);
        SceneGlMaterial material = new(definition, shader, []);
        SceneRenderPassDefinition pass = new(
            fixture.Assets.CreateId<RenderPassAssetTag>("main"),
            clearMask: SceneClearMask.None);

        SceneGlBlendMapping implicitPass = SceneGlBlendStateMapper.Resolve(material, pass, transparent: false);
        SceneGlBlendMapping explicitPass = SceneGlBlendStateMapper.Resolve(
            material,
            pass,
            transparent: false,
            material.PrimaryPass);
        SceneGlBlendMapping disabled = SceneGlBlendStateMapper.Resolve(
            material,
            pass,
            transparent: false,
            new SceneMaterialPass("shadow-caster", blend: false));

        implicitPass.Enabled.Should().BeTrue();
        implicitPass.Should().Be(explicitPass);
        disabled.Enabled.Should().BeFalse();
    }

    [Fact]
    public void IsPassEnabled_SkipsRefractionAndSubsurfaceWhenGatingUniformIsZero()
    {
        SceneMaterialPass[] passes = MaterialContractV2.BuildPassesFromPlan(MaterialModelId.Pbr);
        SceneMaterialPass refraction = passes.Single(pass => pass.Id == "refraction-copy");
        SceneMaterialPass subsurface = passes.Single(pass => pass.Id == "sss-blur");

        refraction.EnabledWhenUniformNonZero.Should().Be("_TransmissionFactor");
        subsurface.EnabledWhenUniformNonZero.Should().Be("_SubsurfaceFactor");
        refraction.DepthTest.Should().BeFalse();
        subsurface.DepthTest.Should().BeFalse();
        subsurface.Blend.Should().BeTrue();
    }
}
