namespace Axrone.Scene.Assets.Tests;

using FluentAssertions;
using Xunit;

public sealed class MaterialContractV2Tests
{
    [Fact]
    public void Models_CoverAllTwelveBuiltinFamilies()
    {
        MaterialContractV2.Models.Should().HaveCount(12);
        MaterialContractV2.TryGetModel("pbr", out MaterialModelDefinitionV2? pbr).Should().BeTrue();
        pbr!.DefaultShaderId.Should().Be("gltf/pbr");

        MaterialContractV2.TryGetModel("toon", out MaterialModelDefinitionV2? toon).Should().BeTrue();
        toon!.PassPlan.Should().Contain(entry => entry.Phase == "outline" && entry.ShaderId == "gltf/toon-outline" && entry.CullMode == "front");

        MaterialContractV2.TryGetModel("composable", out MaterialModelDefinitionV2? composable).Should().BeTrue();
        composable!.OutputSlots.Should().Contain(slot => slot.Key == "surfaceAttributes" && slot.ValueType == "surfaceAttributes");

        MaterialContractV2.ResolveModelFromShaderId("gltf/water/blend/double-sided").Should().Be(MaterialModelId.Water);
        MaterialContractV2.ResolveModelFromShaderId("post-process/contract").Should().Be(MaterialModelId.PostProcess);
    }

    [Fact]
    public void Capabilities_EnforceProfileAndDomainRulesTruthfully()
    {
        MaterialContractV2.ResolveDomainCapability(MaterialDomainId.Surface, MaterialRenderProfileId.WebGl2Standard)
            .Should().Be(MaterialCapabilityStatus.Supported);
        MaterialContractV2.ResolveDomainCapability(MaterialDomainId.Decal, MaterialRenderProfileId.WebGl2Minimal)
            .Should().Be(MaterialCapabilityStatus.Unsupported);
        MaterialContractV2.ResolveDomainCapability(MaterialDomainId.Volume, MaterialRenderProfileId.WebGl2Standard)
            .Should().Be(MaterialCapabilityStatus.Unsupported);

        MaterialContractV2.ResolveSlotCapability(MaterialModelId.Pbr, "clearcoat", MaterialRenderProfileId.WebGl2Minimal)
            .Should().Be(MaterialCapabilityStatus.Unsupported);
        MaterialContractV2.ResolveSlotCapability(MaterialModelId.Pbr, "ambientOcclusion", MaterialRenderProfileId.Native)
            .Should().Be(MaterialCapabilityStatus.Supported);
        MaterialContractV2.ResolveSlotCapability(MaterialModelId.Pbr, "opacityMap", MaterialRenderProfileId.WebGl2Standard)
            .Should().Be(MaterialCapabilityStatus.Supported);
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
}
