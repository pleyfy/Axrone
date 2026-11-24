namespace Axrone.Scene.Prefab.Tests;

using System.Text;
using System.Text.Json;
using Axrone.Scene;
using Axrone.Scene.Prefab;
using FluentAssertions;
using Xunit;

public sealed class ScenePrefabCompositionJsonTests
{
    [Fact]
    public void Json_RoundTripsCompositionLayers()
    {
        ScenePrefabDefinition basePrefab = CreateBase();
        ScenePrefabDefinition definition = CreateComposed(basePrefab);

        byte[] json = ScenePrefabJson.Serialize(definition);
        ScenePrefabDefinition read = ScenePrefabJson.Deserialize(json);
        byte[] rewritten = ScenePrefabJson.Serialize(read);

        read.Id.Should().Be(definition.Id);
        read.Kind.Should().Be(ScenePrefabKind.Variant);
        read.Base!.Kind.Should().Be(ScenePrefabReferenceKind.Registry);
        read.Base.PrefabId.Should().Be("prefab/base");
        read.Base.Revision.Should().Be("3");
        read.Nested.Should().HaveCount(1);
        read.Nested[0].InstanceId.Should().Be("turret");
        read.Nested[0].Reference.Kind.Should().Be(ScenePrefabReferenceKind.Inline);
        read.Nested[0].NamePrefix.Should().Be("T-");
        read.Nested[0].Overrides.Should().HaveCount(1);
        read.Overrides.Should().HaveCount(9);
        read.Lineage.Should().ContainInOrder("prefab/base", "prefab/variant");
        rewritten.Should().Equal(json);
    }

    [Fact]
    public void Json_PreservesOperationSelectorsAndPaths()
    {
        ScenePrefabDefinition definition = CreateComposed(CreateBase());

        ScenePrefabDefinition read = ScenePrefabJson.Deserialize(ScenePrefabJson.Serialize(definition));

        ScenePrefabRemoveComponentOperation remove = read.Overrides.OfType<ScenePrefabRemoveComponentOperation>()
            .Should().ContainSingle().Subject;
        remove.Selector.Kind.Should().Be(ScenePrefabComponentSelectorKind.Type);
        remove.Selector.Type.Should().Be("Camera");
        remove.Selector.Occurrence.Should().Be(1);

        ScenePrefabSetComponentPropertyOperation setProperty =
            read.Overrides.OfType<ScenePrefabSetComponentPropertyOperation>().Should().ContainSingle().Subject;
        setProperty.Selector.Kind.Should().Be(ScenePrefabComponentSelectorKind.Id);
        setProperty.Selector.ComponentId.Should().Be("body");
        setProperty.Path.Count.Should().Be(2);
        setProperty.Path[0].Name.Should().Be("position");
        setProperty.Path[1].Index.Should().Be(1);
        setProperty.Value.GetInt32().Should().Be(5);

        ScenePrefabSetEntityFieldOperation setField = read.Overrides.OfType<ScenePrefabSetEntityFieldOperation>()
            .Should().ContainSingle().Subject;
        setField.Field.Should().Be(ScenePrefabEntityField.Name);
        setField.Value.AsString().Should().Be("Renamed");
    }

    [Fact]
    public void Json_ReadsVersionOnePayloads()
    {
        const string payload = """
            {
              "version": 1,
              "id": "prefab/legacy",
              "kind": "prefab",
              "entities": [
                {
                  "nodeId": "root",
                  "parentNodeId": null,
                  "name": "Root",
                  "layer": 2,
                  "tag": "Untagged",
                  "active": true,
                  "persistent": false,
                  "pooled": false,
                  "components": [
                    { "type": "Transform", "data": { "position": [1, 2, 3] } }
                  ]
                }
              ],
              "metadata": { "revision": "1" }
            }
            """;

        ScenePrefabDefinition read = ScenePrefabJson.Deserialize(Encoding.UTF8.GetBytes(payload));

        read.Id.Should().Be("prefab/legacy");
        read.Kind.Should().Be(ScenePrefabKind.Prefab);
        read.Entities.Should().ContainSingle().Which.Name.Should().Be("Root");
        read.Metadata!.Revision.Should().Be("1");
        read.Base.Should().BeNull();
        read.Nested.Should().BeEmpty();
        read.Overrides.Should().BeEmpty();
    }

    [Fact]
    public void CreateVariant_StoresDeltaAndResolves()
    {
        ScenePrefabDefinition variant = ScenePrefabVariants.CreateVariant(
            "prefab/base",
            "prefab/variant",
            [
                new ScenePrefabSetEntityFieldOperation(
                    "root",
                    ScenePrefabEntityField.Tag,
                    ScenePrefabEntityFieldValue.FromString("Variant"))
            ]);

        variant.Kind.Should().Be(ScenePrefabKind.Variant);
        variant.Entities.Should().BeEmpty();
        variant.Base!.PrefabId.Should().Be("prefab/base");

        var registry = new ScenePrefabRegistry();
        registry.Register(CreateBase());
        registry.Register(variant);

        ScenePrefabDefinition resolved = new ScenePrefabResolver(registry).Resolve("prefab/variant").Definition;

        resolved.Kind.Should().Be(ScenePrefabKind.Resolved);
        resolved.Entities.Should().HaveCount(2);
        resolved.Entities[0].Tag.Should().Be("Variant");
        resolved.Lineage.Should().ContainInOrder("prefab/base", "prefab/variant");
    }

    [Fact]
    public void ApplyOverridesToBase_ProducesStandalonePrefab()
    {
        ScenePrefabDefinition basePrefab = CreateBase();

        ScenePrefabDefinition baked = ScenePrefabVariants.ApplyOverridesToBase(
            basePrefab,
            [
                new ScenePrefabSetEntityFieldOperation(
                    "child",
                    ScenePrefabEntityField.Active,
                    ScenePrefabEntityFieldValue.FromBoolean(false))
            ]);

        baked.Id.Should().Be("prefab/base");
        baked.Kind.Should().Be(ScenePrefabKind.Prefab);
        baked.Base.Should().BeNull();
        baked.Entities[1].Active.Should().BeFalse();
    }

    [Fact]
    public void Unpack_DropsCompositionMetadata()
    {
        var registry = new ScenePrefabRegistry();
        registry.Register(CreateBase());
        ScenePrefabDefinition resolved = new ScenePrefabResolver(registry).Resolve("prefab/base").Definition;

        ScenePrefabDefinition unpacked = ScenePrefabVariants.Unpack(resolved, unpackedId: "prefab/unpacked");

        unpacked.Id.Should().Be("prefab/unpacked");
        unpacked.Kind.Should().Be(ScenePrefabKind.Prefab);
        unpacked.Base.Should().BeNull();
        unpacked.Nested.Should().BeEmpty();
        unpacked.Overrides.Should().BeEmpty();
        unpacked.Lineage.Should().BeEmpty();
        unpacked.Entities.Should().HaveCount(2);
    }

    private static ScenePrefabDefinition CreateBase() => new(
        "prefab/base",
        [
            Entity("root", tag: "Root"),
            Entity(
                "child",
                parentNodeId: "root",
                components: Component("Transform", """{"position":[0,0,0]}"""))
        ],
        metadata: new ScenePrefabMetadata { Revision = "1" });

    private static ScenePrefabDefinition CreateComposed(ScenePrefabDefinition basePrefab)
    {
        SceneComponentSnapshot addedComponent = Component("Light", """{"intensity":2}""");
        SceneComponentSnapshot replacement = Component("Camera", """{"fov":90}""", id: "body");

        return new ScenePrefabDefinition(
            "prefab/variant",
            [],
            ScenePrefabKind.Variant,
            metadata: new ScenePrefabMetadata
            {
                Revision = "3",
                Tags = ["combat", "turret"]
            },
            basePrefab: ScenePrefabReference.FromRegistry("prefab/base", "3"),
            nested:
            [
                new ScenePrefabNestedInstance(
                    "turret",
                    ScenePrefabReference.FromInline(basePrefab),
                    parentNodeId: "root",
                    namePrefix: "T-",
                    overrides:
                    [
                        new ScenePrefabSetEntityFieldOperation(
                            "child",
                            ScenePrefabEntityField.Layer,
                            ScenePrefabEntityFieldValue.FromInt32(2))
                    ])
            ],
            overrides:
            [
                new ScenePrefabAddEntityOperation(Entity("extra"), "root"),
                new ScenePrefabRemoveEntityOperation("turret::child"),
                new ScenePrefabReparentEntityOperation("child", null),
                new ScenePrefabSetEntityFieldOperation(
                    "child",
                    ScenePrefabEntityField.Name,
                    ScenePrefabEntityFieldValue.FromString("Renamed")),
                new ScenePrefabAddComponentOperation("child", addedComponent, 0),
                new ScenePrefabRemoveComponentOperation(
                    "child",
                    ScenePrefabComponentSelector.FromType("Camera", 1)),
                new ScenePrefabReplaceComponentOperation(
                    "child",
                    ScenePrefabComponentSelector.FromId("body", "Camera"),
                    replacement),
                new ScenePrefabSetComponentPropertyOperation(
                    "child",
                    ScenePrefabComponentSelector.FromId("body"),
                    new ScenePrefabPropertyPath(
                        ScenePrefabPropertyPathSegment.ForName("position"),
                        ScenePrefabPropertyPathSegment.ForIndex(1)),
                    JsonSerializer.SerializeToElement(5)),
                new ScenePrefabUnsetComponentPropertyOperation(
                    "child",
                    ScenePrefabComponentSelector.FromType("Transform"),
                    new ScenePrefabPropertyPath(
                        ScenePrefabPropertyPathSegment.ForName("uniforms"),
                        ScenePrefabPropertyPathSegment.ForName("tint")))
            ],
            lineage: ["prefab/base", "prefab/variant"]);
    }

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

    private static SceneComponentSnapshot Component(string type, string json, string? id = null)
    {
        using JsonDocument document = JsonDocument.Parse(json);
        return new SceneComponentSnapshot(type, document.RootElement.Clone(), id);
    }
}
