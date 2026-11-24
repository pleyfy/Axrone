namespace Axrone.Scene.Prefab.Tests;

using System.Text.Json;
using Axrone.Scene;
using Axrone.Scene.Prefab;
using FluentAssertions;
using Xunit;

public sealed class ScenePrefabDiffMergeTests
{
    [Fact]
    public void Diff_EmitsEntityFieldAndHierarchyChanges()
    {
        ScenePrefabDefinition basePrefab = Create(
            "prefab/base",
            Entity("root"),
            Entity("child", parentNodeId: "root"));
        ScenePrefabDefinition target = Create(
            "prefab/target",
            Entity("root"),
            Entity("child", name: "Renamed", layer: 4));

        ScenePrefabDiffResult diff = ScenePrefabDiff.Compute(basePrefab, target);

        diff.Overrides.Should().HaveCount(3);
        diff.Overrides.Should().Contain(operation => operation is ScenePrefabReparentEntityOperation);
        diff.Overrides.OfType<ScenePrefabSetEntityFieldOperation>()
            .Should().Contain(operation => operation.Field == ScenePrefabEntityField.Name)
            .And.Contain(operation => operation.Field == ScenePrefabEntityField.Layer);
    }

    [Fact]
    public void Diff_EmitsComponentAddRemoveAndPropertyChanges()
    {
        ScenePrefabDefinition basePrefab = Create(
            "prefab/base",
            Entity(
                "root",
                components:
                [
                    Component("Transform", """{"position":[0,0,0]}"""),
                    Component("Camera", """{"fov":60}""")
                ]));
        ScenePrefabDefinition target = Create(
            "prefab/target",
            Entity(
                "root",
                components:
                [
                    Component("Transform", """{"position":[1,0,0]}"""),
                    Component("Light", """{"intensity":2}""")
                ]));

        ScenePrefabDiffResult diff = ScenePrefabDiff.Compute(basePrefab, target);

        diff.Overrides.Should().Contain(operation => operation is ScenePrefabAddComponentOperation);
        diff.Overrides.OfType<ScenePrefabRemoveComponentOperation>()
            .Should().ContainSingle(operation => operation.Selector.Type == "Camera");
        ScenePrefabSetComponentPropertyOperation property =
            diff.Overrides.OfType<ScenePrefabSetComponentPropertyOperation>().Should().ContainSingle().Subject;
        property.Path.Count.Should().Be(2);
        property.Path[0].Name.Should().Be("position");
        property.Path[1].Index.Should().Be(0);
        property.Value.GetInt32().Should().Be(1);
    }

    [Fact]
    public void Diff_RemovesEachSubtreeRootOnce()
    {
        ScenePrefabDefinition basePrefab = Create(
            "prefab/base",
            Entity("root"),
            Entity("branch", parentNodeId: "root"),
            Entity("leaf", parentNodeId: "branch"));
        ScenePrefabDefinition target = Create("prefab/target", Entity("root"));

        ScenePrefabDiffResult diff = ScenePrefabDiff.Compute(basePrefab, target);

        diff.Overrides.OfType<ScenePrefabRemoveEntityOperation>()
            .Should().ContainSingle()
            .Which.NodeId.Should().Be("branch");
    }

    [Fact]
    public void Diff_AddsParentsBeforeChildren()
    {
        ScenePrefabDefinition basePrefab = Create("prefab/base", Entity("root"));
        ScenePrefabDefinition target = Create(
            "prefab/target",
            Entity("root"),
            Entity("child", parentNodeId: "added-parent"),
            Entity("added-parent", parentNodeId: "root"));

        ScenePrefabDiffResult diff = ScenePrefabDiff.Compute(basePrefab, target);

        string[] added = diff.Overrides.OfType<ScenePrefabAddEntityOperation>()
            .Select(operation => operation.Entity.NodeId)
            .ToArray();
        added.Should().ContainInOrder("added-parent", "child");
    }

    [Fact]
    public void Diff_IsEmptyForIdenticalDefinitions()
    {
        ScenePrefabDefinition definition = Create(
            "prefab/base",
            Entity("root", components: Component("Transform", """{"position":[0,0,0]}""")));

        ScenePrefabDiffResult diff = ScenePrefabDiff.Compute(definition, definition);

        diff.Overrides.Should().BeEmpty();
    }

    [Fact]
    public void Diff_ApplyReproducesTarget()
    {
        ScenePrefabDefinition basePrefab = Create(
            "prefab/base",
            Entity(
                "root",
                tag: "Base",
                components: Component(
                    "Transform",
                    """{"position":[0,0,0],"uniforms":{"tint":1,"mode":"lit"}}""")),
            Entity("child", parentNodeId: "root"));
        ScenePrefabDefinition target = Create(
            "prefab/target",
            Entity(
                "root",
                tag: "Target",
                active: false,
                components: Component(
                    "Transform",
                    """{"position":[0,5,0],"uniforms":{"tint":2,"extra":true}}""")),
            Entity("child", parentNodeId: "root", name: "Renamed"),
            Entity("added"));

        ScenePrefabDiffResult diff = ScenePrefabDiff.Compute(basePrefab, target);
        ScenePrefabDefinition replayed = ScenePrefabOverrides.Apply(basePrefab, diff.Overrides);

        replayed.Entities.Should().HaveCount(target.Entities.Count);
        for (int i = 0; i < target.Entities.Count; i++)
        {
            replayed.Entities[i].NodeId.Should().Be(target.Entities[i].NodeId);
            replayed.Entities[i].Name.Should().Be(target.Entities[i].Name);
            replayed.Entities[i].Tag.Should().Be(target.Entities[i].Tag);
            replayed.Entities[i].Active.Should().Be(target.Entities[i].Active);
            replayed.Entities[i].ParentNodeId.Should().Be(target.Entities[i].ParentNodeId);
            replayed.Entities[i].Components.Count.Should().Be(target.Entities[i].Components.Count);
            for (int c = 0; c < target.Entities[i].Components.Count; c++)
            {
                JsonElement.DeepEquals(
                        replayed.Entities[i].Components[c].Data,
                        target.Entities[i].Components[c].Data)
                    .Should().BeTrue();
            }
        }
    }

    [Fact]
    public void Merge_WithoutConflictsCombinesBothDeltas()
    {
        ScenePrefabDefinition basePrefab = Create("prefab/base", Entity("root", tag: "Base"));
        ScenePrefabDefinition local = Create("prefab/local", Entity("root", name: "Local", tag: "Base"));
        ScenePrefabDefinition incoming = Create("prefab/incoming", Entity("root", tag: "Incoming"));

        ScenePrefabMergeResult result = ScenePrefabMerge.Merge(basePrefab, local, incoming);

        result.Resolved.Should().BeTrue();
        result.Conflicts.Should().BeEmpty();
        result.Definition.Entities[0].Name.Should().Be("Local");
        result.Definition.Entities[0].Tag.Should().Be("Incoming");
    }

    [Fact]
    public void Merge_ManualReportsConflictsAndRevertsLocalOperation()
    {
        ScenePrefabDefinition basePrefab = Create("prefab/base", Entity("root", name: "Base"));
        ScenePrefabDefinition local = Create("prefab/local", Entity("root", name: "Local"));
        ScenePrefabDefinition incoming = Create("prefab/incoming", Entity("root", name: "Incoming"));

        ScenePrefabMergeResult result = ScenePrefabMerge.Merge(basePrefab, local, incoming);

        result.Resolved.Should().BeFalse();
        ScenePrefabConflict conflict = result.Conflicts.Should().ContainSingle().Subject;
        conflict.Key.Should().Be("entity:root:field:name");
        conflict.BaseValue.Kind.Should().Be(ScenePrefabConflictBaseValueKind.Json);
        conflict.BaseValue.Json.GetString().Should().Be("Base");
        result.Definition.Entities[0].Name.Should().Be("Base");
    }

    [Fact]
    public void Merge_PreferIncomingKeepsIncomingValue()
    {
        ScenePrefabDefinition basePrefab = Create("prefab/base", Entity("root", name: "Base"));
        ScenePrefabDefinition local = Create("prefab/local", Entity("root", name: "Local"));
        ScenePrefabDefinition incoming = Create("prefab/incoming", Entity("root", name: "Incoming"));

        ScenePrefabMergeResult result = ScenePrefabMerge.Merge(
            basePrefab,
            local,
            incoming,
            new ScenePrefabMergeOptions { ConflictPolicy = ScenePrefabConflictPolicy.PreferIncoming });

        result.Resolved.Should().BeTrue();
        result.Definition.Entities[0].Name.Should().Be("Incoming");
    }

    [Fact]
    public void Merge_PreferLocalKeepsLocalValue()
    {
        ScenePrefabDefinition basePrefab = Create("prefab/base", Entity("root", name: "Base"));
        ScenePrefabDefinition local = Create("prefab/local", Entity("root", name: "Local"));
        ScenePrefabDefinition incoming = Create("prefab/incoming", Entity("root", name: "Incoming"));

        ScenePrefabMergeResult result = ScenePrefabMerge.Merge(
            basePrefab,
            local,
            incoming,
            new ScenePrefabMergeOptions { ConflictPolicy = ScenePrefabConflictPolicy.PreferLocal });

        result.Resolved.Should().BeTrue();
        result.Definition.Entities[0].Name.Should().Be("Local");
    }

    [Fact]
    public void Merge_PreferBaseDropsBothValues()
    {
        ScenePrefabDefinition basePrefab = Create("prefab/base", Entity("root", name: "Base"));
        ScenePrefabDefinition local = Create("prefab/local", Entity("root", name: "Local"));
        ScenePrefabDefinition incoming = Create("prefab/incoming", Entity("root", name: "Incoming"));

        ScenePrefabMergeResult result = ScenePrefabMerge.Merge(
            basePrefab,
            local,
            incoming,
            new ScenePrefabMergeOptions { ConflictPolicy = ScenePrefabConflictPolicy.PreferBase });

        result.Resolved.Should().BeTrue();
        result.Definition.Entities[0].Name.Should().Be("Base");
    }

    [Fact]
    public void Merge_CustomResolverSelectsPerConflict()
    {
        ScenePrefabDefinition basePrefab = Create(
            "prefab/base",
            Entity("root", name: "Base", tag: "Base"));
        ScenePrefabDefinition local = Create(
            "prefab/local",
            Entity("root", name: "LocalName", tag: "LocalTag"));
        ScenePrefabDefinition incoming = Create(
            "prefab/incoming",
            Entity("root", name: "IncomingName", tag: "IncomingTag"));

        var options = new ScenePrefabMergeOptions
        {
            ConflictResolver = conflict => conflict.Key.Contains(":name", StringComparison.Ordinal)
                ? ScenePrefabConflictResolution.Local
                : ScenePrefabConflictResolution.Incoming
        };

        ScenePrefabMergeResult result = ScenePrefabMerge.Merge(basePrefab, local, incoming, options);

        result.Resolved.Should().BeTrue();
        result.Definition.Entities[0].Name.Should().Be("LocalName");
        result.Definition.Entities[0].Tag.Should().Be("IncomingTag");
    }

    [Fact]
    public void Merge_ComponentPropertyConflictsExposeBaseValue()
    {
        ScenePrefabDefinition basePrefab = Create(
            "prefab/base",
            Entity("root", components: Component("Transform", """{"position":[0,0,0]}""")));
        ScenePrefabDefinition local = Create(
            "prefab/local",
            Entity("root", components: Component("Transform", """{"position":[1,0,0]}""")));
        ScenePrefabDefinition incoming = Create(
            "prefab/incoming",
            Entity("root", components: Component("Transform", """{"position":[2,0,0]}""")));

        ScenePrefabMergeResult result = ScenePrefabMerge.Merge(basePrefab, local, incoming);

        ScenePrefabConflict conflict = result.Conflicts.Should().ContainSingle().Subject;
        conflict.Key.Should().Contain("component:root:");
        conflict.BaseValue.Kind.Should().Be(ScenePrefabConflictBaseValueKind.Json);
        conflict.BaseValue.Json.GetInt32().Should().Be(0);
        result.Definition.Entities[0].Components[0].Data
            .GetProperty("position")[0].GetInt32().Should().Be(0);
    }

    private static ScenePrefabDefinition Create(string id, params SceneEntitySnapshot[] entities) =>
        new(id, entities);

    private static SceneEntitySnapshot Entity(
        string nodeId,
        string? parentNodeId = null,
        string? name = null,
        string tag = "Untagged",
        bool active = true,
        ushort layer = 0,
        params SceneComponentSnapshot[] components) =>
        new(
            nodeId,
            name ?? nodeId,
            layer,
            tag,
            active,
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
