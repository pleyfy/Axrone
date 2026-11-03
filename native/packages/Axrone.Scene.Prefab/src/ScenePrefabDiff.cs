namespace Axrone.Scene.Prefab;

/// <summary>Override operations that transform one definition into another.</summary>
public sealed class ScenePrefabDiffResult
{
    /// <summary>Creates a diff result.</summary>
    public ScenePrefabDiffResult(
        string basePrefabId,
        string targetPrefabId,
        IReadOnlyList<ScenePrefabOverrideOperation> overrides)
    {
        ArgumentNullException.ThrowIfNull(overrides);
        BasePrefabId = basePrefabId;
        TargetPrefabId = targetPrefabId;
        Overrides = [.. overrides];
    }

    /// <summary>Base definition id.</summary>
    public string BasePrefabId { get; }

    /// <summary>Target definition id.</summary>
    public string TargetPrefabId { get; }

    /// <summary>Operations that turn the base into the target.</summary>
    public IReadOnlyList<ScenePrefabOverrideOperation> Overrides { get; }
}

/// <summary>
/// Computes the minimal override delta between two resolved definitions.
/// Actors, fields and components are compared structurally; component payloads
/// are diffed property by property so variants carry the smallest delta.
/// </summary>
public static class ScenePrefabDiff
{
    /// <summary>Computes the delta from <paramref name="basePrefab"/> to <paramref name="target"/>.</summary>
    public static ScenePrefabDiffResult Compute(
        ScenePrefabDefinition basePrefab,
        ScenePrefabDefinition target)
    {
        ArgumentNullException.ThrowIfNull(basePrefab);
        ArgumentNullException.ThrowIfNull(target);

        var baseById = ScenePrefabComparisons.IndexActors(basePrefab.Actors);
        var targetById = ScenePrefabComparisons.IndexActors(target.Actors);
        HashSet<string> affectedByProvenance = CollectAffectedBySourceChange(
            basePrefab,
            baseById,
            targetById);
        var overrides = new List<ScenePrefabOverrideOperation>();

        EmitRemovedActors(basePrefab, targetById, affectedByProvenance, overrides);
        EmitAddedActors(target, baseById, affectedByProvenance, overrides);

        for (int i = 0; i < basePrefab.Actors.Count; i++)
        {
            SceneActorSnapshot baseActor = basePrefab.Actors[i];
            if (!affectedByProvenance.Contains(baseActor.NodeId) &&
                targetById.TryGetValue(baseActor.NodeId, out SceneActorSnapshot? targetActor))
            {
                DiffActor(baseActor, targetActor, overrides);
            }
        }

        return new ScenePrefabDiffResult(basePrefab.Id, target.Id, overrides);
    }

    private static HashSet<string> CollectAffectedBySourceChange(
        ScenePrefabDefinition basePrefab,
        Dictionary<string, SceneActorSnapshot> baseById,
        Dictionary<string, SceneActorSnapshot> targetById)
    {
        var roots = new HashSet<string>(StringComparer.Ordinal);
        foreach (KeyValuePair<string, SceneActorSnapshot> targetEntry in targetById)
        {
            if (baseById.TryGetValue(targetEntry.Key, out SceneActorSnapshot? baseActor) &&
                !ScenePrefabComparisons.SameSource(baseActor.Source, targetEntry.Value.Source))
            {
                roots.Add(targetEntry.Key);
            }
        }

        if (roots.Count == 0)
        {
            return roots;
        }

        var children = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        foreach (SceneActorSnapshot actor in basePrefab.Actors)
        {
            if (actor.ParentNodeId is { } parent)
            {
                if (!children.TryGetValue(parent, out List<string>? list))
                {
                    list = [];
                    children[parent] = list;
                }

                list.Add(actor.NodeId);
            }
        }

        var affected = new HashSet<string>(roots, StringComparer.Ordinal);
        var queue = new Queue<string>(roots);
        while (queue.Count > 0)
        {
            string current = queue.Dequeue();
            if (!children.TryGetValue(current, out List<string>? childNodes))
            {
                continue;
            }

            foreach (string child in childNodes)
            {
                if (affected.Add(child))
                {
                    queue.Enqueue(child);
                }
            }
        }

        return affected;
    }

    private static void EmitRemovedActors(
        ScenePrefabDefinition basePrefab,
        Dictionary<string, SceneActorSnapshot> targetById,
        HashSet<string> affectedByProvenance,
        List<ScenePrefabOverrideOperation> overrides)
    {
        var removed = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < basePrefab.Actors.Count; i++)
        {
            SceneActorSnapshot actor = basePrefab.Actors[i];
            if (!targetById.ContainsKey(actor.NodeId) || affectedByProvenance.Contains(actor.NodeId))
            {
                removed.Add(actor.NodeId);
            }
        }

        if (removed.Count == 0)
        {
            return;
        }

        for (int i = 0; i < basePrefab.Actors.Count; i++)
        {
            SceneActorSnapshot actor = basePrefab.Actors[i];
            if (!removed.Contains(actor.NodeId))
            {
                continue;
            }

            // Removing the subtree root removes its descendants; emitting both
            // would fail on the second operation.
            if (actor.ParentNodeId is { } parentNodeId && removed.Contains(parentNodeId))
            {
                continue;
            }

            overrides.Add(new ScenePrefabRemoveActorOperation(actor.NodeId));
        }
    }

    private static void EmitAddedActors(
        ScenePrefabDefinition target,
        Dictionary<string, SceneActorSnapshot> baseById,
        HashSet<string> affectedByProvenance,
        List<ScenePrefabOverrideOperation> overrides)
    {
        var added = new HashSet<string>(StringComparer.Ordinal);
        for (int i = 0; i < target.Actors.Count; i++)
        {
            SceneActorSnapshot actor = target.Actors[i];
            if (!baseById.ContainsKey(actor.NodeId) || affectedByProvenance.Contains(actor.NodeId))
            {
                added.Add(actor.NodeId);
            }
        }

        if (added.Count == 0)
        {
            return;
        }

        foreach (SceneActorSnapshot actor in ScenePrefabComparisons.TopologicalOrder(target.Actors, added))
        {
            overrides.Add(new ScenePrefabAddActorOperation(actor));
        }
    }

    private static void DiffActor(
        SceneActorSnapshot baseActor,
        SceneActorSnapshot targetActor,
        List<ScenePrefabOverrideOperation> overrides)
    {
        string nodeId = baseActor.NodeId;

        if (!string.Equals(baseActor.ParentNodeId, targetActor.ParentNodeId, StringComparison.Ordinal))
        {
            overrides.Add(new ScenePrefabReparentActorOperation(nodeId, targetActor.ParentNodeId));
        }

        if (!string.Equals(baseActor.Name, targetActor.Name, StringComparison.Ordinal))
        {
            overrides.Add(SetField(nodeId, ScenePrefabActorField.Name, ScenePrefabActorFieldValue.FromString(targetActor.Name)));
        }

        if (baseActor.Layer != targetActor.Layer)
        {
            overrides.Add(SetField(nodeId, ScenePrefabActorField.Layer, ScenePrefabActorFieldValue.FromInt32(targetActor.Layer)));
        }

        if (!string.Equals(baseActor.Tag, targetActor.Tag, StringComparison.Ordinal))
        {
            overrides.Add(SetField(nodeId, ScenePrefabActorField.Tag, ScenePrefabActorFieldValue.FromString(targetActor.Tag)));
        }

        if (baseActor.Active != targetActor.Active)
        {
            overrides.Add(SetField(nodeId, ScenePrefabActorField.Active, ScenePrefabActorFieldValue.FromBoolean(targetActor.Active)));
        }

        if (baseActor.Persistent != targetActor.Persistent)
        {
            overrides.Add(SetField(nodeId, ScenePrefabActorField.Persistent, ScenePrefabActorFieldValue.FromBoolean(targetActor.Persistent)));
        }

        if (baseActor.Pooled != targetActor.Pooled)
        {
            overrides.Add(SetField(nodeId, ScenePrefabActorField.Pooled, ScenePrefabActorFieldValue.FromBoolean(targetActor.Pooled)));
        }

        DiffComponents(nodeId, baseActor.Components, targetActor.Components, overrides);
    }

    private static ScenePrefabSetActorFieldOperation SetField(
        string nodeId,
        ScenePrefabActorField field,
        ScenePrefabActorFieldValue value) => new(nodeId, field, value);

    private static void DiffComponents(
        string nodeId,
        IReadOnlyList<SceneComponentSnapshot> baseComponents,
        IReadOnlyList<SceneComponentSnapshot> targetComponents,
        List<ScenePrefabOverrideOperation> overrides)
    {
        Dictionary<string, ScenePrefabComparisons.IndexedComponent> baseIndex =
            ScenePrefabComparisons.IndexComponents(baseComponents);
        Dictionary<string, ScenePrefabComparisons.IndexedComponent> targetIndex =
            ScenePrefabComparisons.IndexComponents(targetComponents);

        foreach (KeyValuePair<string, ScenePrefabComparisons.IndexedComponent> entry in baseIndex)
        {
            if (!targetIndex.ContainsKey(entry.Key))
            {
                overrides.Add(new ScenePrefabRemoveComponentOperation(nodeId, entry.Value.Selector));
            }
        }

        foreach (KeyValuePair<string, ScenePrefabComparisons.IndexedComponent> entry in targetIndex)
        {
            if (!baseIndex.ContainsKey(entry.Key))
            {
                overrides.Add(new ScenePrefabAddComponentOperation(
                    nodeId,
                    entry.Value.Component,
                    entry.Value.Index));
            }
        }

        foreach (KeyValuePair<string, ScenePrefabComparisons.IndexedComponent> entry in baseIndex)
        {
            if (!targetIndex.TryGetValue(entry.Key, out ScenePrefabComparisons.IndexedComponent targetEntry))
            {
                continue;
            }

            SceneComponentSnapshot baseComponent = entry.Value.Component;
            SceneComponentSnapshot targetComponent = targetEntry.Component;

            if (!string.Equals(baseComponent.Type, targetComponent.Type, StringComparison.Ordinal))
            {
                overrides.Add(new ScenePrefabReplaceComponentOperation(
                    nodeId,
                    entry.Value.Selector,
                    targetComponent));
                continue;
            }

            DiffComponentValue(
                nodeId,
                entry.Value.Selector,
                baseComponent.Data,
                targetComponent.Data,
                ScenePrefabPropertyPath.Root,
                overrides);
        }
    }

    private static void DiffComponentValue(
        string nodeId,
        in ScenePrefabComponentSelector selector,
        JsonElement baseValue,
        JsonElement targetValue,
        ScenePrefabPropertyPath path,
        List<ScenePrefabOverrideOperation> overrides)
    {
        if (JsonElement.DeepEquals(baseValue, targetValue))
        {
            return;
        }

        if (baseValue.ValueKind == JsonValueKind.Object && targetValue.ValueKind == JsonValueKind.Object)
        {
            foreach (JsonProperty baseProperty in baseValue.EnumerateObject())
            {
                var segment = ScenePrefabPropertyPathSegment.ForName(baseProperty.Name);
                if (targetValue.TryGetProperty(baseProperty.Name, out JsonElement targetProperty))
                {
                    DiffComponentValue(
                        nodeId,
                        selector,
                        baseProperty.Value,
                        targetProperty,
                        ScenePrefabComparisons.Append(path, segment),
                        overrides);
                }
                else
                {
                    overrides.Add(new ScenePrefabUnsetComponentPropertyOperation(
                        nodeId,
                        selector,
                        ScenePrefabComparisons.Append(path, segment)));
                }
            }

            foreach (JsonProperty targetProperty in targetValue.EnumerateObject())
            {
                if (baseValue.TryGetProperty(targetProperty.Name, out _))
                {
                    continue;
                }

                overrides.Add(new ScenePrefabSetComponentPropertyOperation(
                    nodeId,
                    selector,
                    ScenePrefabComparisons.Append(
                        path,
                        ScenePrefabPropertyPathSegment.ForName(targetProperty.Name)),
                    targetProperty.Value));
            }

            return;
        }

        if (baseValue.ValueKind == JsonValueKind.Array && targetValue.ValueKind == JsonValueKind.Array)
        {
            int baseLength = baseValue.GetArrayLength();
            int targetLength = targetValue.GetArrayLength();
            int common = Math.Min(baseLength, targetLength);

            for (int i = 0; i < common; i++)
            {
                DiffComponentValue(
                    nodeId,
                    selector,
                    baseValue[i],
                    targetValue[i],
                    ScenePrefabComparisons.Append(path, ScenePrefabPropertyPathSegment.ForIndex(i)),
                    overrides);
            }

            // Removals run from the tail so every index still addresses the
            // element it was computed from.
            for (int i = baseLength - 1; i >= common; i--)
            {
                overrides.Add(new ScenePrefabUnsetComponentPropertyOperation(
                    nodeId,
                    selector,
                    ScenePrefabComparisons.Append(path, ScenePrefabPropertyPathSegment.ForIndex(i))));
            }

            for (int i = common; i < targetLength; i++)
            {
                overrides.Add(new ScenePrefabSetComponentPropertyOperation(
                    nodeId,
                    selector,
                    ScenePrefabComparisons.Append(path, ScenePrefabPropertyPathSegment.ForIndex(i)),
                    targetValue[i]));
            }

            return;
        }

        overrides.Add(new ScenePrefabSetComponentPropertyOperation(nodeId, selector, path, targetValue));
    }
}

/// <summary>Structural comparisons and indexing shared by diff and merge.</summary>
internal static class ScenePrefabComparisons
{
    internal readonly record struct IndexedComponent(
        ScenePrefabComponentSelector Selector,
        SceneComponentSnapshot Component,
        int Index);

    public static Dictionary<string, SceneActorSnapshot> IndexActors(
        IReadOnlyList<SceneActorSnapshot> actors)
    {
        var index = new Dictionary<string, SceneActorSnapshot>(actors.Count, StringComparer.Ordinal);
        for (int i = 0; i < actors.Count; i++)
        {
            index[actors[i].NodeId] = actors[i];
        }

        return index;
    }

    public static Dictionary<string, IndexedComponent> IndexComponents(
        IReadOnlyList<SceneComponentSnapshot> components)
    {
        var index = new Dictionary<string, IndexedComponent>(components.Count, StringComparer.Ordinal);
        for (int i = 0; i < components.Count; i++)
        {
            SceneComponentSnapshot component = components[i];
            ScenePrefabComponentSelector selector = component.Id is { } id
                ? ScenePrefabComponentSelector.FromId(id, component.Type)
                : ScenePrefabComponentSelector.FromType(component.Type, OccurrenceAt(components, i));
            index[SelectorKey(selector)] = new IndexedComponent(selector, component, i);
        }

        return index;
    }

    public static string SelectorKey(in ScenePrefabComponentSelector selector) =>
        selector.Kind == ScenePrefabComponentSelectorKind.Id
            ? $"id:{selector.ComponentId}"
            : $"type:{selector.Type}#{selector.Occurrence}";

    public static bool SameSelector(
        in ScenePrefabComponentSelector left,
        in ScenePrefabComponentSelector right) =>
        left.Kind == right.Kind &&
        string.Equals(left.ComponentId, right.ComponentId, StringComparison.Ordinal) &&
        string.Equals(left.Type, right.Type, StringComparison.Ordinal) &&
        left.Occurrence == right.Occurrence;

    public static bool SamePath(ScenePrefabPropertyPath left, ScenePrefabPropertyPath right)
    {
        if (left.Count != right.Count)
        {
            return false;
        }

        for (int i = 0; i < left.Count; i++)
        {
            ScenePrefabPropertyPathSegment leftSegment = left[i];
            ScenePrefabPropertyPathSegment rightSegment = right[i];
            if (leftSegment.IsIndex != rightSegment.IsIndex)
            {
                return false;
            }

            if (leftSegment.IsIndex)
            {
                if (leftSegment.Index != rightSegment.Index)
                {
                    return false;
                }
            }
            else if (!string.Equals(leftSegment.Name, rightSegment.Name, StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    public static bool SameActor(SceneActorSnapshot left, SceneActorSnapshot right)
    {
        if (!string.Equals(left.NodeId, right.NodeId, StringComparison.Ordinal) ||
            !string.Equals(left.ParentNodeId, right.ParentNodeId, StringComparison.Ordinal) ||
            !string.Equals(left.Name, right.Name, StringComparison.Ordinal) ||
            left.Layer != right.Layer ||
            !string.Equals(left.Tag, right.Tag, StringComparison.Ordinal) ||
            left.Active != right.Active ||
            left.Persistent != right.Persistent ||
            left.Pooled != right.Pooled ||
            !SameSource(left.Source, right.Source) ||
            left.Components.Count != right.Components.Count)
        {
            return false;
        }

        for (int i = 0; i < left.Components.Count; i++)
        {
            if (!SameComponent(left.Components[i], right.Components[i]))
            {
                return false;
            }
        }

        return true;
    }

    public static bool SameComponent(SceneComponentSnapshot left, SceneComponentSnapshot right) =>
        string.Equals(left.Id, right.Id, StringComparison.Ordinal) &&
        string.Equals(left.Type, right.Type, StringComparison.Ordinal) &&
        JsonElement.DeepEquals(left.Data, right.Data);

    public static bool SameSource(ScenePrefabNodeSource? left, ScenePrefabNodeSource? right) =>
        left == right;

    public static bool SameOperation(
        ScenePrefabOverrideOperation left,
        ScenePrefabOverrideOperation right)
    {
        if (left.Kind != right.Kind)
        {
            return false;
        }

        return (left, right) switch
        {
            (ScenePrefabAddActorOperation a, ScenePrefabAddActorOperation b) =>
                string.Equals(a.AfterNodeId, b.AfterNodeId, StringComparison.Ordinal) &&
                SameActor(a.Actor, b.Actor),
            (ScenePrefabRemoveActorOperation a, ScenePrefabRemoveActorOperation b) =>
                string.Equals(a.NodeId, b.NodeId, StringComparison.Ordinal),
            (ScenePrefabReparentActorOperation a, ScenePrefabReparentActorOperation b) =>
                string.Equals(a.NodeId, b.NodeId, StringComparison.Ordinal) &&
                string.Equals(a.ParentNodeId, b.ParentNodeId, StringComparison.Ordinal),
            (ScenePrefabSetActorFieldOperation a, ScenePrefabSetActorFieldOperation b) =>
                string.Equals(a.NodeId, b.NodeId, StringComparison.Ordinal) &&
                a.Field == b.Field &&
                a.Value == b.Value,
            (ScenePrefabAddComponentOperation a, ScenePrefabAddComponentOperation b) =>
                string.Equals(a.NodeId, b.NodeId, StringComparison.Ordinal) &&
                a.Index == b.Index &&
                SameComponent(a.Component, b.Component),
            (ScenePrefabRemoveComponentOperation a, ScenePrefabRemoveComponentOperation b) =>
                string.Equals(a.NodeId, b.NodeId, StringComparison.Ordinal) &&
                SameSelector(a.Selector, b.Selector),
            (ScenePrefabReplaceComponentOperation a, ScenePrefabReplaceComponentOperation b) =>
                string.Equals(a.NodeId, b.NodeId, StringComparison.Ordinal) &&
                SameSelector(a.Selector, b.Selector) &&
                SameComponent(a.Component, b.Component),
            (ScenePrefabSetComponentPropertyOperation a, ScenePrefabSetComponentPropertyOperation b) =>
                string.Equals(a.NodeId, b.NodeId, StringComparison.Ordinal) &&
                SameSelector(a.Selector, b.Selector) &&
                SamePath(a.Path, b.Path) &&
                JsonElement.DeepEquals(a.Value, b.Value),
            (ScenePrefabUnsetComponentPropertyOperation a, ScenePrefabUnsetComponentPropertyOperation b) =>
                string.Equals(a.NodeId, b.NodeId, StringComparison.Ordinal) &&
                SameSelector(a.Selector, b.Selector) &&
                SamePath(a.Path, b.Path),
            _ => false
        };
    }

    public static ScenePrefabPropertyPath Append(
        ScenePrefabPropertyPath path,
        ScenePrefabPropertyPathSegment segment)
    {
        var segments = new ScenePrefabPropertyPathSegment[path.Count + 1];
        for (int i = 0; i < path.Count; i++)
        {
            segments[i] = path[i];
        }

        segments[path.Count] = segment;
        return new ScenePrefabPropertyPath(segments);
    }

    public static List<SceneActorSnapshot> TopologicalOrder(
        IReadOnlyList<SceneActorSnapshot> actors,
        HashSet<string> pending)
    {
        var byId = IndexActors(actors);
        var ordered = new List<SceneActorSnapshot>(pending.Count);
        var visited = new HashSet<string>(StringComparer.Ordinal);

        for (int i = 0; i < actors.Count; i++)
        {
            SceneActorSnapshot actor = actors[i];
            if (pending.Contains(actor.NodeId))
            {
                Visit(actor, byId, pending, visited, ordered);
            }
        }

        return ordered;
    }

    private static void Visit(
        SceneActorSnapshot actor,
        Dictionary<string, SceneActorSnapshot> byId,
        HashSet<string> pending,
        HashSet<string> visited,
        List<SceneActorSnapshot> ordered)
    {
        if (!visited.Add(actor.NodeId))
        {
            return;
        }

        if (actor.ParentNodeId is { } parentId &&
            pending.Contains(parentId) &&
            byId.TryGetValue(parentId, out SceneActorSnapshot? parent))
        {
            Visit(parent, byId, pending, visited, ordered);
        }

        ordered.Add(actor);
    }

    private static int OccurrenceAt(IReadOnlyList<SceneComponentSnapshot> components, int index)
    {
        string type = components[index].Type;
        int occurrence = 0;
        for (int i = 0; i < index; i++)
        {
            if (string.Equals(components[i].Type, type, StringComparison.Ordinal))
            {
                occurrence++;
            }
        }

        return occurrence;
    }
}
