namespace Axrone.Scene.Prefab.Tests;

using System.Text.Json;
using Axrone.Scene;
using Axrone.Scene.Prefab;
using FluentAssertions;
using Xunit;

public sealed class ScenePrefabNestingTests
{
    private static readonly int[] NestedPosition = [1, 2, 3];

    [Fact]
    public void Variant_AppliesOverridesOverBase()
    {
        ScenePrefabDefinition basePrefab = CreateBasePrefab();
        var variant = new ScenePrefabDefinition(
            "prefab/variant",
            [],
            ScenePrefabKind.Variant,
            basePrefab: ScenePrefabReference.FromInline(basePrefab),
            overrides:
            [
                new ScenePrefabSetEntityFieldOperation(
                    "child",
                    ScenePrefabEntityField.Name,
                    ScenePrefabEntityFieldValue.FromString("VariantChild"))
            ]);

        ScenePrefabResolutionResult result = new ScenePrefabResolver().Resolve(variant);

        result.Definition.Kind.Should().Be(ScenePrefabKind.Resolved);
        result.Definition.Entities.Should().HaveCount(2);
        result.Definition.Entities[1].Name.Should().Be("VariantChild");
        result.Lineage.Should().ContainInOrder("prefab/base", "prefab/variant");
    }

    [Fact]
    public void NestedInstance_ScopesNodeIdsAndPrefixesNames()
    {
        ScenePrefabDefinition basePrefab = CreateBasePrefab();
        var host = new ScenePrefabDefinition(
            "prefab/host",
            [Entity("host-root")],
            nested:
            [
                new ScenePrefabNestedInstance(
                    "turret",
                    ScenePrefabReference.FromInline(basePrefab),
                    parentNodeId: "host-root",
                    namePrefix: "T-")
            ]);

        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(host).Definition;

        resolved.Entities.Select(entity => entity.NodeId)
            .Should().ContainInOrder("host-root", "turret::root", "turret::child");
        resolved.Entities[1].Name.Should().Be("T-root");
        resolved.Entities[1].ParentNodeId.Should().Be("host-root");
        resolved.Entities[2].ParentNodeId.Should().Be("turret::root");
    }

    [Fact]
    public void NestedInstanceOverrides_ApplyWithinScope()
    {
        ScenePrefabDefinition basePrefab = CreateBasePrefab();
        var host = new ScenePrefabDefinition(
            "prefab/host",
            [Entity("host-root")],
            nested:
            [
                new ScenePrefabNestedInstance(
                    "turret",
                    ScenePrefabReference.FromInline(basePrefab),
                    parentNodeId: "host-root",
                    overrides:
                    [
                        new ScenePrefabSetEntityFieldOperation(
                            "child",
                            ScenePrefabEntityField.Name,
                            ScenePrefabEntityFieldValue.FromString("Gun")),
                        new ScenePrefabSetComponentPropertyOperation(
                            "child",
                            ScenePrefabComponentSelector.FromType("Transform"),
                            new ScenePrefabPropertyPath(
                                ScenePrefabPropertyPathSegment.ForName("position")),
                            JsonSerializer.SerializeToElement(NestedPosition))
                    ])
            ]);

        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(host).Definition;

        SceneEntitySnapshot child = resolved.Entities[2];
        child.NodeId.Should().Be("turret::child");
        child.Name.Should().Be("Gun");
        child.Components[0].Data.GetProperty("position")[2].GetInt32().Should().Be(3);
    }

    [Fact]
    public void HostOverrides_AddressScopedNodes()
    {
        ScenePrefabDefinition basePrefab = CreateBasePrefab();
        var host = new ScenePrefabDefinition(
            "prefab/host",
            [Entity("host-root")],
            nested:
            [
                new ScenePrefabNestedInstance(
                    "turret",
                    ScenePrefabReference.FromInline(basePrefab),
                    parentNodeId: "host-root")
            ],
            overrides:
            [
                new ScenePrefabRemoveEntityOperation("turret::child")
            ]);

        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(host).Definition;

        resolved.Entities.Select(entity => entity.NodeId)
            .Should().ContainInOrder("host-root", "turret::root");
    }

    [Fact]
    public void BaseEntities_AreReplacedByOwnEntities()
    {
        ScenePrefabDefinition basePrefab = CreateBasePrefab();
        var variant = new ScenePrefabDefinition(
            "prefab/variant",
            [Entity("child", parentNodeId: "root", name: "Replaced")],
            ScenePrefabKind.Variant,
            basePrefab: ScenePrefabReference.FromInline(basePrefab));

        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(variant).Definition;

        resolved.Entities.Should().HaveCount(2);
        resolved.Entities[1].Name.Should().Be("Replaced");
    }

    [Fact]
    public void Registry_ResolvesByIdAndEnforcesRevision()
    {
        var registry = new ScenePrefabRegistry();
        registry.Register(CreateBasePrefab(revision: "2"));

        var resolver = new ScenePrefabResolver(registry);
        ScenePrefabDefinition resolved = resolver.Resolve("prefab/base").Definition;
        resolved.Entities.Should().HaveCount(2);

        var staleReference = new ScenePrefabDefinition(
            "prefab/variant",
            [],
            ScenePrefabKind.Variant,
            basePrefab: ScenePrefabReference.FromRegistry("prefab/base", "1"));

        Action act = () => resolver.Resolve(staleReference);
        act.Should().Throw<ScenePrefabException>()
            .Where(exception => exception.Code == ScenePrefabErrorCodes.ResolutionFailed)
            .WithMessage("*revision mismatch*");
    }

    [Fact]
    public void Resolver_DetectsReferenceCycles()
    {
        var registry = new ScenePrefabRegistry();
        registry.Register(new ScenePrefabDefinition(
            "prefab/a",
            [],
            ScenePrefabKind.Variant,
            basePrefab: ScenePrefabReference.FromRegistry("prefab/b")));
        registry.Register(new ScenePrefabDefinition(
            "prefab/b",
            [],
            ScenePrefabKind.Variant,
            basePrefab: ScenePrefabReference.FromRegistry("prefab/a")));

        Action act = () => new ScenePrefabResolver(registry).Resolve("prefab/a");

        act.Should().Throw<ScenePrefabException>()
            .Where(exception => exception.Code == ScenePrefabErrorCodes.ResolutionFailed)
            .WithMessage("*cycle*");
    }

    [Fact]
    public void Resolver_CachesUntilRegistryChanges()
    {
        var registry = new ScenePrefabRegistry();
        registry.Register(CreateBasePrefab());
        var resolver = new ScenePrefabResolver(registry);

        resolver.Resolve("prefab/base").CacheHit.Should().BeFalse();
        resolver.Resolve("prefab/base").CacheHit.Should().BeTrue();

        registry.Register(CreateBasePrefab(revision: "2"));
        resolver.Resolve("prefab/base").CacheHit.Should().BeFalse();
    }

    [Fact]
    public void Resolver_AppliesLiveOverrides()
    {
        var registry = new ScenePrefabRegistry();
        registry.Register(CreateBasePrefab());
        var resolver = new ScenePrefabResolver(registry);

        ScenePrefabDefinition resolved = resolver.Resolve(
            "prefab/base",
            [
                new ScenePrefabSetEntityFieldOperation(
                    "root",
                    ScenePrefabEntityField.Tag,
                    ScenePrefabEntityFieldValue.FromString("Live"))
            ]).Definition;

        resolved.Entities[0].Tag.Should().Be("Live");
        resolved.Kind.Should().Be(ScenePrefabKind.Resolved);
        resolver.Resolve("prefab/base").Definition.Entities[0].Tag.Should().Be("Root");
    }

    [Fact]
    public void MissingRegistryPrefab_Throws()
    {
        var resolver = new ScenePrefabResolver(new ScenePrefabRegistry());

        Action act = () => resolver.Resolve("prefab/missing");

        act.Should().Throw<ScenePrefabException>()
            .Where(exception => exception.Code == ScenePrefabErrorCodes.ResolutionFailed);
    }

    [Fact]
    public void NestedInstanceIds_MustBeUnique()
    {
        ScenePrefabDefinition basePrefab = CreateBasePrefab();

        Action act = () => _ = new ScenePrefabDefinition(
            "prefab/host",
            [Entity("host-root")],
            nested:
            [
                new ScenePrefabNestedInstance("dup", ScenePrefabReference.FromInline(basePrefab)),
                new ScenePrefabNestedInstance("dup", ScenePrefabReference.FromInline(basePrefab))
            ]);

        act.Should().Throw<ScenePrefabException>()
            .Where(exception => exception.Code == ScenePrefabErrorCodes.DuplicateNode);
    }

    private static ScenePrefabDefinition CreateBasePrefab(string? revision = null) =>
        new(
            "prefab/base",
            [
                Entity("root", tag: "Root"),
                Entity(
                    "child",
                    parentNodeId: "root",
                    components: Component("Transform", """{"position":[0,0,0]}"""))
            ],
            metadata: revision is null ? null : new ScenePrefabMetadata { Revision = revision });

    private static SceneEntitySnapshot Entity(
        string nodeId,
        string? parentNodeId = null,
        string? name = null,
        string tag = "Untagged",
        params SceneComponentSnapshot[] components) =>
        new(
            nodeId,
            name ?? nodeId,
            0,
            tag,
            active: true,
            persistent: false,
            pooled: false,
            components,
            parentNodeId);

    private static SceneComponentSnapshot Component(string type, string json)
    {
        using JsonDocument document = JsonDocument.Parse(json);
        return new SceneComponentSnapshot(type, document.RootElement.Clone());
    }
}
