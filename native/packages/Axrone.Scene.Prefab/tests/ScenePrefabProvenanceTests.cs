namespace Axrone.Scene.Prefab.Tests;

using System.Globalization;
using System.Text;
using System.Text.Json;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Prefab;
using FluentAssertions;
using Xunit;

public sealed class ScenePrefabProvenanceTests
{
    [Fact]
    public void NestedResolutionWritesInstancePathInConstructionOrder()
    {
        ScenePrefabDefinition inner = Composed("prefab/inner", [Entity("root")]);
        ScenePrefabDefinition middle = Composed(
            "prefab/middle",
            [Entity("host")],
            nested: [new ScenePrefabNestedInstance("mid", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition host = Composed(
            "prefab/host",
            [Entity("outer")],
            nested: [new ScenePrefabNestedInstance("outer", ScenePrefabReference.FromInline(middle))]);

        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(host).Definition;
        SceneEntitySnapshot scoped = Find(resolved, "outer::mid::root");

        scoped.Source.Should().NotBeNull();
        scoped.Source!.Value.PrefabId.Should().Be("prefab/inner");
        scoped.Source.Value.NodeId.Should().Be("root");
        scoped.Source.Value.InstancePath.Count.Should().Be(2);
        scoped.Source.Value.InstancePath[0].Should().Be("mid");
        scoped.Source.Value.InstancePath[1].Should().Be("outer");
    }

    [Fact]
    public void ProvenanceRoundTripsJsonDeterministically()
    {
        ScenePrefabDefinition inner = Composed("prefab/inner", [Entity("root")]);
        ScenePrefabDefinition definition = Composed(
            "prefab/host",
            [Entity("outer")],
            nested: [new ScenePrefabNestedInstance("outer", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(definition).Definition;

        byte[] json = ScenePrefabJson.Serialize(resolved);
        ScenePrefabDefinition read = ScenePrefabJson.Deserialize(json);
        byte[] rewritten = ScenePrefabJson.Serialize(read);

        rewritten.Should().Equal(json);
        Find(read, "outer::root").Source.Should().Be(Find(resolved, "outer::root").Source);
    }

    [Fact]
    public void OldEntitiesWithoutSourceRemainCompatible()
    {
        const string payload = """
            {
              "version": 2,
              "id": "prefab/legacy",
              "kind": "prefab",
              "entities": [
                {
                  "nodeId": "root",
                  "parentNodeId": null,
                  "name": "Root",
                  "layer": 0,
                  "tag": "Default",
                  "active": true,
                  "persistent": false,
                  "pooled": false,
                  "components": []
                }
              ]
            }
            """;

        ScenePrefabDefinition read = ScenePrefabJson.Deserialize(Encoding.UTF8.GetBytes(payload));

        read.Entities.Should().ContainSingle().Which.Source.Should().BeNull();
    }

    [Theory]
    [InlineData("42", ScenePrefabErrorCodes.InvalidProvenance)]
    [InlineData(@"""source""", ScenePrefabErrorCodes.InvalidProvenance)]
    public void WrongTypedSourceIsRejected(string value, string code)
    {
        string payload = $$"""
            {
              "version": 2,
              "id": "prefab/source",
              "kind": "prefab",
              "entities": [
                {
                  "nodeId": "root",
                  "parentNodeId": null,
                  "name": "Root",
                  "layer": 0,
                  "tag": "Default",
                  "active": true,
                  "persistent": false,
                  "pooled": false,
                  "source": {{value}},
                  "components": []
                }
              ]
            }
            """;

        Action read = () => ScenePrefabJson.Deserialize(Encoding.UTF8.GetBytes(payload));

        read.Should().Throw<ScenePrefabException>().Which.Code.Should().Be(code);
    }

    [Fact]
    public void WrongTypedTagsAndNullElementsFailClosed()
    {
        ScenePrefabDefinition tagged = Composed(
            "prefab/tags",
            [Entity("root")],
            metadata: new ScenePrefabMetadata { Tags = ["combat"] });

        byte[] wrongTags = Replace(ScenePrefabJson.Serialize(tagged), """["combat"]""", "42");
        Action tags = () => ScenePrefabJson.Deserialize(wrongTags);
        tags.Should().Throw<ScenePrefabException>().Which.Code.Should().Be(ScenePrefabErrorCodes.Invalid);

        byte[] nullTag = Replace(ScenePrefabJson.Serialize(tagged), """["combat"]""", "[null]");
        Action nullElement = () => ScenePrefabJson.Deserialize(nullTag);
        nullElement.Should().Throw<ScenePrefabException>()
            .Which.Code.Should().Be(ScenePrefabErrorCodes.InvalidNullElement);
    }

    [Fact]
    public void MissingStableNodeIdReportsPrefabAndIndex()
    {
        const string payload = """
            {
              "version": 2,
              "id": "prefab/bad",
              "kind": "prefab",
              "entities": [
                {
                  "nodeId": "root",
                  "parentNodeId": null,
                  "name": "Root",
                  "layer": 0,
                  "tag": "Default",
                  "active": true,
                  "persistent": false,
                  "pooled": false,
                  "components": []
                },
                {
                  "nodeId": "",
                  "parentNodeId": null,
                  "name": "Broken",
                  "layer": 0,
                  "tag": "Default",
                  "active": true,
                  "persistent": false,
                  "pooled": false,
                  "components": []
                }
              ]
            }
            """;

        Action read = () => ScenePrefabJson.Deserialize(Encoding.UTF8.GetBytes(payload));

        read.Should().Throw<ScenePrefabException>()
            .Where(exception =>
                exception.Code == ScenePrefabErrorCodes.MissingStableNodeId &&
                exception.Message.Contains("prefab/bad", StringComparison.Ordinal) &&
                exception.Message.Contains("index 1", StringComparison.Ordinal));
    }

    [Fact]
    public void SourceOnlyChangeIsPreservedByVariantDiff()
    {
        ScenePrefabNodeSource source = new("prefab/base", "root");
        ScenePrefabDefinition basePrefab = Composed("prefab/base", [Entity("root")]);
        ScenePrefabDefinition target = Composed("prefab/target", [Entity("root", source: source)]);

        ScenePrefabDiffResult diff = ScenePrefabDiff.Compute(basePrefab, target);
        ScenePrefabDefinition applied = ScenePrefabOverrides.Apply(basePrefab, diff.Overrides);

        diff.Overrides.Should().Contain(operation => operation is ScenePrefabAddEntityOperation);
        applied.Entities.Should().ContainSingle().Which.Source.Should().Be(source);
    }

    [Fact]
    public void ProvenanceSurvivesNestedMergeRevertToBase()
    {
        ScenePrefabDefinition inner = Composed("prefab/inner", [Entity("root", name: "Base")]);
        ScenePrefabDefinition basePrefab = Composed(
            "prefab/base",
            [Entity("outer")],
            nested: [new ScenePrefabNestedInstance("instance", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition resolvedBase = new ScenePrefabResolver().Resolve(basePrefab).Definition;
        SceneEntitySnapshot scoped = Find(resolvedBase, "instance::root");
        ScenePrefabNodeSource expectedSource = scoped.Source!.Value;

        ScenePrefabDefinition local = WithRenamedScopedEntity(resolvedBase, scoped, "Local");
        ScenePrefabDefinition incoming = WithRenamedScopedEntity(resolvedBase, scoped, "Incoming");

        ScenePrefabMergeResult merged = ScenePrefabMerge.Merge(
            resolvedBase,
            local,
            incoming,
            new ScenePrefabMergeOptions { ConflictPolicy = ScenePrefabConflictPolicy.PreferBase });

        merged.Resolved.Should().BeTrue();
        SceneEntitySnapshot reverted = Find(merged.Definition, scoped.NodeId);
        reverted.Name.Should().Be("Base");
        reverted.Source.Should().Be(expectedSource);
    }

    [Fact]
    public void InstantiateRecordsProvenanceForEachCreatedEntity()
    {
        SceneProfile profile = SceneProfiles.CreateCore3D();
        SceneCodecRegistry codecs = new(profile.Registry);
        using SceneWorld world = profile.CreateWorld();
        ScenePrefabDefinition inner = Composed("prefab/inner", [Entity("root")]);
        ScenePrefabDefinition host = Composed(
            "prefab/host",
            [Entity("outer")],
            nested: [new ScenePrefabNestedInstance("outer", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(host).Definition;

        ScenePrefabInstantiationResult result = ScenePrefabInstantiator.Instantiate(world, codecs, resolved);

        result.Sources.Should().HaveCount(resolved.Entities.Count);
        for (int i = 0; i < resolved.Entities.Count; i++)
        {
            result.Sources[i].Should().Be(resolved.Entities[i].Source);
        }

        int scopedIndex = resolved.Entities.ToList().FindIndex(entity => entity.NodeId == "outer::root");
        scopedIndex.Should().BePositive();
        result.Sources[scopedIndex].InstancePath.Count.Should().Be(1);
        result.Sources[scopedIndex].InstancePath[0].Should().Be("outer");
        result.NodeMap["outer::root"].Should().Be(result.Entities[scopedIndex]);
    }

    [Fact]
    public void UnpackStripsProvenance()
    {
        ScenePrefabDefinition inner = Composed("prefab/inner", [Entity("root")]);
        ScenePrefabDefinition host = Composed(
            "prefab/host",
            [Entity("outer")],
            nested: [new ScenePrefabNestedInstance("outer", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(host).Definition;
        resolved.Entities.Should().OnlyContain(entity => entity.Source.HasValue);

        ScenePrefabDefinition unpacked = ScenePrefabVariants.Unpack(resolved);

        unpacked.Entities.Should().OnlyContain(entity => entity.Source == null);
    }

    [Fact]
    public void SourcePathExtensionAndLookupAreZeroAllocationWarm()
    {
        ScenePrefabIdPath path = ScenePrefabIdPath.Create(["mid", "outer"]);
        var source = new ScenePrefabNodeSource("prefab/inner", "root", path, path);
        ScenePrefabNodeSource appended = source.WithInstancePath("host");

        long before = GC.GetAllocatedBytesForCurrentThread();
        int checksum = 0;
        for (int i = 0; i < 1024; i++)
        {
            ScenePrefabNodeSource next = source.WithInstancePath("host");
            checksum += next.GetHashCode() == appended.GetHashCode() ? next.InstancePath[2].Length : 0;
            checksum += next.Equals(appended) ? 1 : 0;
        }

        long delta = GC.GetAllocatedBytesForCurrentThread() - before;
        checksum.Should().BeGreaterThan(0);
        delta.Should().Be(0);
    }

    [Fact]
    public void FixedPathRejectsCapacityOverflow()
    {
        string[] values = new string[ScenePrefabIdPath.Capacity + 1];
        for (int i = 0; i < values.Length; i++)
        {
            values[i] = "instance-" + i.ToString();
        }

        Action create = () => ScenePrefabIdPath.Create(values);

        create.Should().Throw<ScenePrefabException>()
            .Which.Code.Should().Be(ScenePrefabErrorCodes.InvalidProvenance);
    }

    [Fact]
    public void FallbackDiagnosticReportsCallerIndex()
    {
        Action create = () => ScenePrefabNodeIdentity.CreateFallback(
            "prefab/indexed",
            string.Empty,
            [],
            2);

        create.Should().Throw<ScenePrefabException>()
            .Where(exception =>
                exception.Code == ScenePrefabErrorCodes.MissingStableNodeId &&
                exception.Message.Contains("prefab/indexed", StringComparison.Ordinal) &&
                exception.Message.Contains("index 2", StringComparison.Ordinal));
    }

    private static ScenePrefabDefinition Composed(
        string id,
        IReadOnlyList<SceneEntitySnapshot> entities,
        ScenePrefabMetadata? metadata = null,
        IReadOnlyList<ScenePrefabNestedInstance>? nested = null) =>
        new(id, entities, metadata: metadata, nested: nested);

    private static SceneEntitySnapshot Entity(
        string nodeId,
        string? name = null,
        ScenePrefabNodeSource? source = null) =>
        new(
            nodeId,
            name ?? nodeId,
            0,
            "Default",
            active: true,
            persistent: false,
            pooled: false,
            [],
            null,
            source);

    private static ScenePrefabDefinition WithRenamedScopedEntity(
        ScenePrefabDefinition definition,
        SceneEntitySnapshot scoped,
        string name)
    {
        SceneEntitySnapshot[] entities = new SceneEntitySnapshot[definition.Entities.Count];
        for (int i = 0; i < definition.Entities.Count; i++)
        {
            SceneEntitySnapshot entity = definition.Entities[i];
            entities[i] = entity.NodeId == scoped.NodeId
                ? new SceneEntitySnapshot(
                    entity.NodeId,
                    name,
                    entity.Layer,
                    entity.Tag,
                    entity.Active,
                    entity.Persistent,
                    entity.Pooled,
                    entity.Components,
                    entity.ParentNodeId,
                    entity.Source)
                : entity;
        }

        return new ScenePrefabDefinition(definition.Id, entities);
    }

    private static SceneEntitySnapshot Find(ScenePrefabDefinition definition, string nodeId) =>
        definition.Entities.Single(entity => string.Equals(entity.NodeId, nodeId, StringComparison.Ordinal));

    private static byte[] Replace(byte[] payload, string oldValue, string newValue)
    {
        string text = Encoding.UTF8.GetString(payload);
        int index = text.IndexOf(oldValue, StringComparison.Ordinal);
        index.Should().BeGreaterThanOrEqualTo(0);
        return Encoding.UTF8.GetBytes(text[..index] + newValue + text[(index + oldValue.Length)..]);
    }
}
