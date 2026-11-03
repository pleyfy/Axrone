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
        ScenePrefabDefinition inner = Composed("prefab/inner", [Actor("root")]);
        ScenePrefabDefinition middle = Composed(
            "prefab/middle",
            [Actor("host")],
            nested: [new ScenePrefabNestedInstance("mid", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition host = Composed(
            "prefab/host",
            [Actor("outer")],
            nested: [new ScenePrefabNestedInstance("outer", ScenePrefabReference.FromInline(middle))]);

        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(host).Definition;
        SceneActorSnapshot scoped = Find(resolved, "outer::mid::root");

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
        ScenePrefabDefinition inner = Composed("prefab/inner", [Actor("root")]);
        ScenePrefabDefinition definition = Composed(
            "prefab/host",
            [Actor("outer")],
            nested: [new ScenePrefabNestedInstance("outer", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(definition).Definition;

        byte[] json = ScenePrefabJson.Serialize(resolved);
        ScenePrefabDefinition read = ScenePrefabJson.Deserialize(json);
        byte[] rewritten = ScenePrefabJson.Serialize(read);

        rewritten.Should().Equal(json);
        Find(read, "outer::root").Source.Should().Be(Find(resolved, "outer::root").Source);
    }

    [Fact]
    public void OldActorsWithoutSourceRemainCompatible()
    {
        const string payload = """
            {
              "version": 2,
              "id": "prefab/legacy",
              "kind": "prefab",
              "actors": [
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

        read.Actors.Should().ContainSingle().Which.Source.Should().BeNull();
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
              "actors": [
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
            [Actor("root")],
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
              "actors": [
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
        ScenePrefabDefinition basePrefab = Composed("prefab/base", [Actor("root")]);
        ScenePrefabDefinition target = Composed("prefab/target", [Actor("root", source: source)]);

        ScenePrefabDiffResult diff = ScenePrefabDiff.Compute(basePrefab, target);
        ScenePrefabDefinition applied = ScenePrefabOverrides.Apply(basePrefab, diff.Overrides);

        diff.Overrides.Should().Contain(operation => operation is ScenePrefabAddActorOperation);
        applied.Actors.Should().ContainSingle().Which.Source.Should().Be(source);
    }

    [Fact]
    public void ProvenanceSurvivesNestedMergeRevertToBase()
    {
        ScenePrefabDefinition inner = Composed("prefab/inner", [Actor("root", name: "Base")]);
        ScenePrefabDefinition basePrefab = Composed(
            "prefab/base",
            [Actor("outer")],
            nested: [new ScenePrefabNestedInstance("instance", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition resolvedBase = new ScenePrefabResolver().Resolve(basePrefab).Definition;
        SceneActorSnapshot scoped = Find(resolvedBase, "instance::root");
        ScenePrefabNodeSource expectedSource = scoped.Source!.Value;

        ScenePrefabDefinition local = WithRenamedScopedActor(resolvedBase, scoped, "Local");
        ScenePrefabDefinition incoming = WithRenamedScopedActor(resolvedBase, scoped, "Incoming");

        ScenePrefabMergeResult merged = ScenePrefabMerge.Merge(
            resolvedBase,
            local,
            incoming,
            new ScenePrefabMergeOptions { ConflictPolicy = ScenePrefabConflictPolicy.PreferBase });

        merged.Resolved.Should().BeTrue();
        SceneActorSnapshot reverted = Find(merged.Definition, scoped.NodeId);
        reverted.Name.Should().Be("Base");
        reverted.Source.Should().Be(expectedSource);
    }

    [Fact]
    public void InstantiateRecordsProvenanceForEachCreatedActor()
    {
        SceneProfile profile = SceneProfiles.CreateCore3D();
        SceneCodecRegistry codecs = new(profile.Registry);
        using SceneWorld world = profile.CreateWorld();
        ScenePrefabDefinition inner = Composed("prefab/inner", [Actor("root")]);
        ScenePrefabDefinition host = Composed(
            "prefab/host",
            [Actor("outer")],
            nested: [new ScenePrefabNestedInstance("outer", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(host).Definition;

        ScenePrefabInstantiationResult result = ScenePrefabInstantiator.Instantiate(world, codecs, resolved);

        result.Sources.Should().HaveCount(resolved.Actors.Count);
        for (int i = 0; i < resolved.Actors.Count; i++)
        {
            result.Sources[i].Should().Be(resolved.Actors[i].Source);
        }

        int scopedIndex = resolved.Actors.ToList().FindIndex(actor => actor.NodeId == "outer::root");
        scopedIndex.Should().BePositive();
        result.Sources[scopedIndex].InstancePath.Count.Should().Be(1);
        result.Sources[scopedIndex].InstancePath[0].Should().Be("outer");
        result.NodeMap["outer::root"].Should().Be(result.Actors[scopedIndex]);
    }

    [Fact]
    public void UnpackStripsProvenance()
    {
        ScenePrefabDefinition inner = Composed("prefab/inner", [Actor("root")]);
        ScenePrefabDefinition host = Composed(
            "prefab/host",
            [Actor("outer")],
            nested: [new ScenePrefabNestedInstance("outer", ScenePrefabReference.FromInline(inner))]);
        ScenePrefabDefinition resolved = new ScenePrefabResolver().Resolve(host).Definition;
        resolved.Actors.Should().OnlyContain(actor => actor.Source.HasValue);

        ScenePrefabDefinition unpacked = ScenePrefabVariants.Unpack(resolved);

        unpacked.Actors.Should().OnlyContain(actor => actor.Source == null);
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

    private static ScenePrefabDefinition Composed(
        string id,
        IReadOnlyList<SceneActorSnapshot> actors,
        ScenePrefabMetadata? metadata = null,
        IReadOnlyList<ScenePrefabNestedInstance>? nested = null) =>
        new(id, actors, metadata: metadata, nested: nested);

    private static SceneActorSnapshot Actor(
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

    private static ScenePrefabDefinition WithRenamedScopedActor(
        ScenePrefabDefinition definition,
        SceneActorSnapshot scoped,
        string name)
    {
        SceneActorSnapshot[] actors = new SceneActorSnapshot[definition.Actors.Count];
        for (int i = 0; i < definition.Actors.Count; i++)
        {
            SceneActorSnapshot actor = definition.Actors[i];
            actors[i] = actor.NodeId == scoped.NodeId
                ? new SceneActorSnapshot(
                    actor.NodeId,
                    name,
                    actor.Layer,
                    actor.Tag,
                    actor.Active,
                    actor.Persistent,
                    actor.Pooled,
                    actor.Components,
                    actor.ParentNodeId,
                    actor.Source)
                : actor;
        }

        return new ScenePrefabDefinition(definition.Id, actors);
    }

    private static SceneActorSnapshot Find(ScenePrefabDefinition definition, string nodeId) =>
        definition.Actors.Single(actor => string.Equals(actor.NodeId, nodeId, StringComparison.Ordinal));

    private static byte[] Replace(byte[] payload, string oldValue, string newValue)
    {
        string text = Encoding.UTF8.GetString(payload);
        int index = text.IndexOf(oldValue, StringComparison.Ordinal);
        index.Should().BeGreaterThanOrEqualTo(0);
        return Encoding.UTF8.GetBytes(text[..index] + newValue + text[(index + oldValue.Length)..]);
    }
}
