namespace Axrone.Scene.Assets.Tests;

using FluentAssertions;
using Xunit;

public sealed class MaterialContractV2Tests
{
    [Fact]
    public void Models_CoverAllThirteenBuiltinFamilies()
    {
        MaterialContractV2.Models.Should().HaveCount(13);
        MaterialContractV2.TryGetModel("pbr", out MaterialModelDefinitionV2? pbr).Should().BeTrue();
        pbr!.DefaultShaderId.Should().Be("gltf/pbr");

        MaterialContractV2.TryGetModel("toon", out MaterialModelDefinitionV2? toon).Should().BeTrue();
        toon!.PassPlan.Should().Contain(entry => entry.Phase == "outline" && entry.ShaderId == "gltf/toon-outline" && entry.CullMode == "front");

        MaterialContractV2.TryGetModel("composable", out MaterialModelDefinitionV2? composable).Should().BeTrue();
        composable!.OutputSlots.Should().Contain(slot => slot.Key == "surfaceAttributes" && slot.ValueType == "surfaceAttributes");

        MaterialContractV2.TryGetModel("volume", out MaterialModelDefinitionV2? volume).Should().BeTrue();
        volume!.Domain.Should().Be(MaterialDomainId.Volume);
        volume.ShadingModel.Should().Be(SceneMaterialShadingModel.Volume);
        volume.DefaultShaderId.Should().Be("gltf/volume");
        volume.DefaultTemplateId.Should().Be("volume-fog-cloud");

        MaterialContractV2.ResolveModelFromShaderId("gltf/water/blend/double-sided").Should().Be(MaterialModelId.Water);
        MaterialContractV2.ResolveModelFromShaderId("post-process/contract").Should().Be(MaterialModelId.PostProcess);
        MaterialContractV2.ResolveModelFromShaderId("gltf/volume").Should().Be(MaterialModelId.Volume);
        MaterialContractV2.ResolveModelFromShaderId("gltf/volume/blend").Should().Be(MaterialModelId.Volume);
    }

    [Theory]
    [InlineData("vertexOffset", "vertex", "vec3", "_VertexOffset", "[0, 0, 0]", true)]
    [InlineData("baseColor", "volume", "vec3", "_BaseColorFactor", "[0.85, 0.9, 0.95]", false)]
    [InlineData("volumeDensity", "volume", "float", "_VolumeDensity", "1.2", true)]
    [InlineData("volumeAbsorption", "volume", "float", "_VolumeAbsorption", "0.85", true)]
    [InlineData("volumeScatterColor", "volume", "vec3", "_VolumeScatterColor", "[0.95, 0.98, 1]", true)]
    [InlineData("volumeAnisotropy", "volume", "float", "_VolumeAnisotropy", "0.45", true)]
    [InlineData("emission", "volume", "vec3", "_EmissiveFactor", "[0, 0, 0]", true)]
    [InlineData("emissionIntensity", "volume", "float", "_EmissiveIntensity", "1", true)]
    public void VolumeSlots_MirrorContractJsonSectionBindingAndDefault(
        string key,
        string section,
        string valueType,
        string bindingKey,
        string defaultValue,
        bool optional)
    {
        MaterialContractV2.GetModel(MaterialModelId.Volume).OutputSlots
            .Should().ContainSingle(slot => slot.Key == key)
            .Which.Should().Match<MaterialOutputSlotV2>(slot =>
                slot.Section == section &&
                slot.ValueType == valueType &&
                slot.BindingKey == bindingKey &&
                slot.DefaultValue == defaultValue &&
                slot.Optional == optional);
    }

    [Fact]
    public void VolumeSlots_KeepFragmentStageOrderAndRejectVertexDisplacement()
    {
        MaterialOutputSlotV2[] slots = [.. MaterialContractV2.GetModel(MaterialModelId.Volume).OutputSlots];

        slots.Should().HaveCount(8);
        slots.Select(slot => slot.Key).Should().ContainInOrder(
            "vertexOffset",
            "baseColor",
            "volumeDensity",
            "volumeAbsorption",
            "volumeScatterColor",
            "volumeAnisotropy",
            "emission",
            "emissionIntensity");
        slots.Should().NotContain(slot => slot.Key == "depthOffset");
        slots.Single(slot => slot.Key == "vertexOffset").Capability
            .Should().Be(MaterialCapabilityStatus.Unsupported);
        slots.Single(slot => slot.Key == "vertexOffset").Stage
            .Should().Be(MaterialStageId.Vertex);
        slots.Single(slot => slot.Key == "emissionIntensity").Advanced.Should().BeTrue();
    }

    [Theory]
    [InlineData("pbr", 5)]
    [InlineData("composable", 5)]
    [InlineData("toon", 3)]
    [InlineData("hair", 3)]
    [InlineData("cloth", 3)]
    [InlineData("foliage", 3)]
    [InlineData("water", 2)]
    [InlineData("volume", 1)]
    public void PassPlans_KeepExtendedPbrChainSeparatedFromThreePassSurfaceChain(
        string modelId,
        int expectedPassCount)
    {
        MaterialContractV2.TryGetModel(modelId, out MaterialModelDefinitionV2? model).Should().BeTrue();
        model!.PassPlan.Should().HaveCount(expectedPassCount);
    }

    [Fact]
    public void PassPlans_EmitRefractionAndSubsurfaceOnlyOnPbrFamily()
    {
        foreach (MaterialModelId modelId in new[] { MaterialModelId.Pbr, MaterialModelId.Composable })
        {
            MaterialPassPlanEntryV2[] plan = [.. MaterialContractV2.GetModel(modelId).PassPlan];

            plan.Select(entry => entry.Id).Should().ContainInOrder(
                "main",
                "forward-add",
                "shadow-caster",
                "refraction-copy",
                "sss-blur");
            plan.Single(entry => entry.Id == "refraction-copy").Phase.Should().Be("refraction");
            plan.Single(entry => entry.Id == "refraction-copy").ShaderId.Should().Be("post-process/contract");
            plan.Single(entry => entry.Id == "refraction-copy").EnabledWhenUniformNonZero
                .Should().Be("_TransmissionFactor");
            plan.Single(entry => entry.Id == "sss-blur").Phase.Should().Be("subsurface");
            plan.Single(entry => entry.Id == "sss-blur").EnabledWhenUniformNonZero
                .Should().Be("_SubsurfaceFactor");
        }

        foreach (MaterialModelId modelId in new[]
        {
            MaterialModelId.Hair,
            MaterialModelId.Cloth,
            MaterialModelId.Foliage,
        })
        {
            MaterialContractV2.GetModel(modelId).PassPlan
                .Should().NotContain(entry =>
                    entry.Id == "refraction-copy" || entry.Id == "sss-blur");
        }
    }

    [Fact]
    public void Capabilities_EnforceProfileAndDomainRulesTruthfully()
    {
        MaterialContractV2.ResolveDomainCapability(MaterialDomainId.Surface, MaterialRenderProfileId.WebGl2Standard)
            .Should().Be(MaterialCapabilityStatus.Supported);
        MaterialContractV2.ResolveDomainCapability(MaterialDomainId.Decal, MaterialRenderProfileId.WebGl2Minimal)
            .Should().Be(MaterialCapabilityStatus.Unsupported);

        MaterialContractV2.ResolveDomainCapability(MaterialDomainId.Volume, MaterialRenderProfileId.WebGl2Standard)
            .Should().Be(MaterialCapabilityStatus.Supported);
        MaterialContractV2.ResolveDomainCapability(MaterialDomainId.Volume, MaterialRenderProfileId.WebGl2Minimal)
            .Should().Be(MaterialCapabilityStatus.Unsupported);
        MaterialContractV2.ResolveDomainCapability(MaterialDomainId.Volume, MaterialRenderProfileId.Native)
            .Should().Be(MaterialCapabilityStatus.Unsupported);

        MaterialContractV2.ResolveSlotCapability(MaterialModelId.Pbr, "clearcoat", MaterialRenderProfileId.WebGl2Minimal)
            .Should().Be(MaterialCapabilityStatus.Unsupported);
        MaterialContractV2.ResolveSlotCapability(MaterialModelId.Pbr, "ambientOcclusion", MaterialRenderProfileId.Native)
            .Should().Be(MaterialCapabilityStatus.Supported);
        MaterialContractV2.ResolveSlotCapability(MaterialModelId.Pbr, "opacityMap", MaterialRenderProfileId.WebGl2Standard)
            .Should().Be(MaterialCapabilityStatus.Supported);
    }

    [Theory]
    [InlineData(MaterialRenderProfileId.WebGl2Standard, MaterialCapabilityStatus.Supported)]
    [InlineData(MaterialRenderProfileId.WebGl2Minimal, MaterialCapabilityStatus.Unsupported)]
    [InlineData(MaterialRenderProfileId.Native, MaterialCapabilityStatus.Unsupported)]
    public void VolumeCapabilities_ReportNativeRuntimeAsPending(
        MaterialRenderProfileId profile,
        MaterialCapabilityStatus expected)
    {
        MaterialContractV2.ResolveModelCapability(MaterialModelId.Volume, profile).Should().Be(expected);
        MaterialContractV2.ResolveSlotCapability(MaterialModelId.Volume, "volumeDensity", profile).Should().Be(expected);
    }

    [Fact]
    public void BuildPassesFromPlan_EmitsToonOutlineAndPassShaderIds()
    {
        SceneMaterialPass[] passes = MaterialContractV2.BuildPassesFromPlan(MaterialModelId.Toon, "gltf/toon");
        passes.Should().HaveCount(3);
        passes[0].Id.Should().Be("main");
        passes[0].ShaderId.Should().Be("gltf/toon");
        passes[1].Id.Should().Be("outline");
        passes[1].Phase.Should().Be("outline");
        passes[1].ShaderId.Should().Be("gltf/toon-outline");
        passes[1].CullMode.Should().Be("front");
        passes[1].EnabledWhenUniformNonZero.Should().Be("_OutlineWidth");
    }

    [Fact]
    public void BuildPassesFromPlan_EmitsVolumeRaymarchStateOverrides()
    {
        SceneMaterialPass[] passes = MaterialContractV2.BuildPassesFromPlan(MaterialModelId.Volume);

        passes.Should().ContainSingle();
        passes[0].Id.Should().Be("volume-raymarch");
        passes[0].Phase.Should().Be("volume");
        passes[0].ShaderId.Should().Be("gltf/volume");
        passes[0].CullMode.Should().Be("front");
        passes[0].Cull.Should().BeTrue();
        passes[0].DepthTest.Should().BeTrue();
        passes[0].DepthWrite.Should().BeFalse();
        passes[0].Blend.Should().BeTrue();
    }

    [Fact]
    public void BuildPassesFromPlan_PropagatesDepthTestAndBlendPerPass()
    {
        SceneMaterialPass[] passes = MaterialContractV2.BuildPassesFromPlan(MaterialModelId.Pbr);

        passes[0].DepthTest.Should().BeNull();
        passes[0].Blend.Should().BeNull();

        SceneMaterialPass refraction = passes.Single(pass => pass.Id == "refraction-copy");
        refraction.DepthTest.Should().BeFalse();
        refraction.DepthWrite.Should().BeFalse();
        refraction.Blend.Should().BeNull();

        SceneMaterialPass subsurface = passes.Single(pass => pass.Id == "sss-blur");
        subsurface.DepthTest.Should().BeFalse();
        subsurface.DepthWrite.Should().BeFalse();
        subsurface.Blend.Should().BeTrue();
    }
}
