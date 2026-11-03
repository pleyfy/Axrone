namespace Axrone.Scene.Prefab;

using System.Buffers;
using System.Text.Json.Nodes;

/// <summary>
/// Applies override operations to an immutable prefab definition. Every apply
/// pass materializes a fresh definition, so callers can keep the authored base
/// untouched while variants and instances derive their own state.
/// </summary>
public static class ScenePrefabOverrides
{
    /// <summary>Applies operations in order and returns the derived definition.</summary>
    /// <exception cref="ScenePrefabException">
    /// A node, component or property path cannot be resolved, or the resulting
    /// hierarchy is invalid.
    /// </exception>
    public static ScenePrefabDefinition Apply(
        ScenePrefabDefinition definition,
        IReadOnlyList<ScenePrefabOverrideOperation> operations)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ArgumentNullException.ThrowIfNull(operations);

        var state = new ScenePrefabOverrideState(definition);
        state.ApplyRange(operations);
        return state.ToDefinition();
    }
}

/// <summary>
/// Mutable composition state shared by override application and prefab
/// resolution. Mutation stays internal; consumers only observe materialized,
/// validated definitions.
/// </summary>
internal sealed class ScenePrefabOverrideState
{
    private readonly List<ActorState> _actors;
    private readonly Dictionary<string, ActorState> _byNode;

    public ScenePrefabOverrideState(
        string id,
        ScenePrefabKind kind,
        ScenePrefabMetadata? metadata,
        IReadOnlyList<string> lineage)
    {
        Id = id;
        Kind = kind;
        Metadata = metadata;
        Lineage = [.. lineage];
        _actors = [];
        _byNode = new Dictionary<string, ActorState>(StringComparer.Ordinal);
    }

    public ScenePrefabOverrideState(ScenePrefabDefinition definition)
        : this(definition.Id, definition.Kind, definition.Metadata, definition.Lineage)
    {
        AddActors(definition.Actors);
    }

    public string Id { get; }

    public ScenePrefabKind Kind { get; }

    public ScenePrefabMetadata? Metadata { get; }

    public IReadOnlyList<string> Lineage { get; }

    /// <summary>
    /// Merges actors by node id: existing entries are replaced in place and new
    /// entries append, matching the authoring merge order.
    /// </summary>
    public void AddActors(IReadOnlyList<SceneActorSnapshot> actors)
    {
        for (int i = 0; i < actors.Count; i++)
        {
            SceneActorSnapshot prepared = ScenePrefabNodeIdentity.EnsureProvenance(
                actors[i],
                Id,
                Lineage,
                i);
            var actor = new ActorState(prepared);
            if (_byNode.TryGetValue(actor.NodeId, out ActorState? existing))
            {
                int index = _actors.IndexOf(existing);
                _actors[index] = actor;
                _byNode[actor.NodeId] = actor;
                continue;
            }

            _actors.Add(actor);
            _byNode.Add(actor.NodeId, actor);
        }
    }

    public void ApplyRange(IReadOnlyList<ScenePrefabOverrideOperation> operations)
    {
        for (int i = 0; i < operations.Count; i++)
        {
            Apply(operations[i]);
        }
    }

    public void Apply(ScenePrefabOverrideOperation operation)
    {
        ArgumentNullException.ThrowIfNull(operation);

        switch (operation)
        {
            case ScenePrefabAddActorOperation add:
                AddActor(add);
                break;
            case ScenePrefabRemoveActorOperation remove:
                RemoveActor(remove);
                break;
            case ScenePrefabReparentActorOperation reparent:
                ReparentActor(reparent);
                break;
            case ScenePrefabSetActorFieldOperation setField:
                SetActorField(setField);
                break;
            case ScenePrefabAddComponentOperation addComponent:
                AddComponent(addComponent);
                break;
            case ScenePrefabRemoveComponentOperation removeComponent:
                RemoveComponent(removeComponent);
                break;
            case ScenePrefabReplaceComponentOperation replaceComponent:
                ReplaceComponent(replaceComponent);
                break;
            case ScenePrefabSetComponentPropertyOperation setProperty:
                SetComponentProperty(setProperty);
                break;
            case ScenePrefabUnsetComponentPropertyOperation unsetProperty:
                UnsetComponentProperty(unsetProperty);
                break;
            default:
                throw new ScenePrefabException(
                    ScenePrefabErrorCodes.InvalidOverride,
                    $"Unknown override operation '{operation.GetType().Name}'.");
        }
    }

    public ScenePrefabDefinition ToDefinition()
    {
        var snapshots = new SceneActorSnapshot[_actors.Count];
        for (int i = 0; i < _actors.Count; i++)
        {
            snapshots[i] = _actors[i].ToSnapshot();
        }

        return new ScenePrefabDefinition(Id, snapshots, Kind, Metadata, lineage: Lineage);
    }

    private void AddActor(ScenePrefabAddActorOperation operation)
    {
        var actor = new ActorState(operation.Actor);
        if (_byNode.ContainsKey(actor.NodeId))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.DuplicateNode,
                $"Actor '{actor.NodeId}' already exists.",
                actor.NodeId);
        }

        if (operation.AfterNodeId is not { } afterNodeId)
        {
            _actors.Add(actor);
            _byNode.Add(actor.NodeId, actor);
            return;
        }

        ActorState anchor = EnsureActor(afterNodeId);
        _actors.Insert(_actors.IndexOf(anchor) + 1, actor);
        _byNode.Add(actor.NodeId, actor);
    }

    private void RemoveActor(ScenePrefabRemoveActorOperation operation)
    {
        EnsureActor(operation.NodeId);

        var removed = new HashSet<string>(StringComparer.Ordinal);
        var pending = new Stack<string>();
        pending.Push(operation.NodeId);

        while (pending.Count > 0)
        {
            string nodeId = pending.Pop();
            if (!removed.Add(nodeId))
            {
                continue;
            }

            for (int i = 0; i < _actors.Count; i++)
            {
                if (string.Equals(_actors[i].ParentNodeId, nodeId, StringComparison.Ordinal))
                {
                    pending.Push(_actors[i].NodeId);
                }
            }
        }

        _actors.RemoveAll(actor => removed.Contains(actor.NodeId));
        foreach (string nodeId in removed)
        {
            _byNode.Remove(nodeId);
        }
    }

    private void ReparentActor(ScenePrefabReparentActorOperation operation)
    {
        ActorState actor = EnsureActor(operation.NodeId);
        if (operation.ParentNodeId is { } parentNodeId)
        {
            EnsureActor(parentNodeId);
        }

        actor.ParentNodeId = operation.ParentNodeId;
    }

    private void SetActorField(ScenePrefabSetActorFieldOperation operation)
    {
        ActorState actor = EnsureActor(operation.NodeId);

        switch (operation.Field)
        {
            case ScenePrefabActorField.Name:
                actor.Name = operation.Value.AsString();
                break;
            case ScenePrefabActorField.Layer:
                actor.Layer = ToLayer(operation.Value.AsInt32(), actor.NodeId);
                break;
            case ScenePrefabActorField.Tag:
                actor.Tag = operation.Value.AsString();
                break;
            case ScenePrefabActorField.Active:
                actor.Active = operation.Value.AsBoolean();
                break;
            case ScenePrefabActorField.Persistent:
                actor.Persistent = operation.Value.AsBoolean();
                break;
            case ScenePrefabActorField.Pooled:
                actor.Pooled = operation.Value.AsBoolean();
                break;
            default:
                throw new ScenePrefabException(
                    ScenePrefabErrorCodes.InvalidOverride,
                    $"Unknown actor field '{operation.Field}'.",
                    actor.NodeId);
        }
    }

    private void AddComponent(ScenePrefabAddComponentOperation operation)
    {
        ActorState actor = EnsureActor(operation.NodeId);
        SceneComponentSnapshot component = operation.Component;

        if (component.Id is { } componentId &&
            actor.Components.Exists(
                existing => string.Equals(existing.Id, componentId, StringComparison.Ordinal)))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.DuplicateComponent,
                $"Component id '{componentId}' is already present.",
                actor.NodeId);
        }

        if (actor.Components.Exists(
                existing => string.Equals(existing.Type, component.Type, StringComparison.Ordinal)))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.DuplicateComponent,
                $"Component type '{component.Type}' is already present.",
                actor.NodeId);
        }

        int index = operation.Index is { } requested
            ? Math.Clamp(requested, 0, actor.Components.Count)
            : actor.Components.Count;

        actor.Components.Insert(index, component);
    }

    private void RemoveComponent(ScenePrefabRemoveComponentOperation operation)
    {
        ActorState actor = EnsureActor(operation.NodeId);
        actor.Components.RemoveAt(EnsureComponentIndex(actor, operation.Selector));
    }

    private void ReplaceComponent(ScenePrefabReplaceComponentOperation operation)
    {
        ActorState actor = EnsureActor(operation.NodeId);
        int index = EnsureComponentIndex(actor, operation.Selector);

        SceneComponentSnapshot replacement = operation.Component;
        if (replacement.Id is { } componentId &&
            actor.Components.Exists(
                existing => !ReferenceEquals(existing, actor.Components[index]) &&
                            string.Equals(existing.Id, componentId, StringComparison.Ordinal)))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.DuplicateComponent,
                $"Component id '{componentId}' is already present.",
                actor.NodeId);
        }

        actor.Components[index] = replacement;
    }

    private void SetComponentProperty(ScenePrefabSetComponentPropertyOperation operation)
    {
        ActorState actor = EnsureActor(operation.NodeId);
        int index = EnsureComponentIndex(actor, operation.Selector);
        SceneComponentSnapshot component = actor.Components[index];

        JsonElement data = SetPayloadValue(component.Data, operation.Path, operation.Value);
        actor.Components[index] = new SceneComponentSnapshot(component.Type, data, component.Id);
    }

    private void UnsetComponentProperty(ScenePrefabUnsetComponentPropertyOperation operation)
    {
        ActorState actor = EnsureActor(operation.NodeId);
        int index = EnsureComponentIndex(actor, operation.Selector);
        SceneComponentSnapshot component = actor.Components[index];

        if (operation.Path.Count == 0)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidPath,
                "Component payload properties cannot unset the payload root.",
                actor.NodeId);
        }

        JsonElement data = UnsetPayloadValue(component.Data, operation.Path);
        if (data.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidPath,
                $"Unsetting '{Describe(operation.Path)}' removes the payload root.",
                actor.NodeId);
        }

        actor.Components[index] = new SceneComponentSnapshot(component.Type, data, component.Id);
    }

    private ActorState EnsureActor(string nodeId) =>
        _byNode.TryGetValue(nodeId, out ActorState? actor)
            ? actor
            : throw new ScenePrefabException(
                ScenePrefabErrorCodes.UnknownNode,
                $"Node '{nodeId}' does not exist.",
                nodeId);

    private static int EnsureComponentIndex(
        ActorState actor,
        in ScenePrefabComponentSelector selector)
    {
        int index = FindComponentIndex(actor.Components, selector);
        if (index >= 0)
        {
            return index;
        }

        throw new ScenePrefabException(
            ScenePrefabErrorCodes.UnknownComponent,
            $"Actor '{actor.NodeId}' has no component matching {Describe(selector)}.",
            actor.NodeId);
    }

    private static int FindComponentIndex(
        List<SceneComponentSnapshot> components,
        in ScenePrefabComponentSelector selector)
    {
        if (selector.Kind == ScenePrefabComponentSelectorKind.Id)
        {
            for (int i = 0; i < components.Count; i++)
            {
                if (string.Equals(components[i].Id, selector.ComponentId, StringComparison.Ordinal))
                {
                    return i;
                }
            }
        }

        if (selector.Type is not { } type)
        {
            return -1;
        }

        int targetOccurrence = selector.Kind == ScenePrefabComponentSelectorKind.Type
            ? selector.Occurrence
            : 0;
        int occurrence = 0;

        for (int i = 0; i < components.Count; i++)
        {
            if (!string.Equals(components[i].Type, type, StringComparison.Ordinal))
            {
                continue;
            }

            if (occurrence == targetOccurrence)
            {
                return i;
            }

            occurrence++;
        }

        return -1;
    }

    private static ushort ToLayer(int value, string nodeId)
    {
        if (value is < ushort.MinValue or > ushort.MaxValue)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                $"Layer must be within [0, {ushort.MaxValue}]; received {value}.",
                nodeId);
        }

        return (ushort)value;
    }

    private static string Describe(in ScenePrefabComponentSelector selector) =>
        selector.Kind == ScenePrefabComponentSelectorKind.Id
            ? $"id '{selector.ComponentId}'"
            : $"type '{selector.Type}' at occurrence {selector.Occurrence}";

    private static string Describe(ScenePrefabPropertyPath path)
    {
        var builder = new System.Text.StringBuilder();
        for (int i = 0; i < path.Count; i++)
        {
            ScenePrefabPropertyPathSegment segment = path[i];
            if (segment.IsIndex)
            {
                builder.Append('[').Append(segment.Index).Append(']');
            }
            else
            {
                if (builder.Length > 0)
                {
                    builder.Append('.');
                }

                builder.Append(segment.Name);
            }
        }

        return builder.ToString();
    }

    private static JsonElement SetPayloadValue(
        JsonElement payload,
        ScenePrefabPropertyPath path,
        JsonElement value)
    {
        if (path.Count == 0)
        {
            return CloneElement(value);
        }

        JsonNode? root = JsonNode.Parse(payload.GetRawText());
        JsonNode? updated = SetNode(root, path, 0, value);
        if (updated is null)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidPath,
                $"Setting '{Describe(path)}' produced an empty payload.");
        }

        return ToElement(updated);
    }

    private static JsonElement UnsetPayloadValue(JsonElement payload, ScenePrefabPropertyPath path)
    {
        JsonNode? root = JsonNode.Parse(payload.GetRawText());
        JsonNode? updated = UnsetNode(root, path, 0);
        if (updated is null)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidPath,
                $"Unsetting '{Describe(path)}' produced an empty payload.");
        }

        return ToElement(updated);
    }

    private static JsonNode? SetNode(
        JsonNode? current,
        ScenePrefabPropertyPath path,
        int index,
        JsonElement value)
    {
        if (index == path.Count)
        {
            return ParseValue(value);
        }

        ScenePrefabPropertyPathSegment segment = path[index];

        if (segment.IsIndex)
        {
            JsonArray array = current as JsonArray ?? new JsonArray();
            int target = segment.Index;
            JsonNode? existing = target < array.Count ? Detach(array, target) : null;
            JsonNode? updated = SetNode(existing, path, index + 1, value);

            while (array.Count < target)
            {
                array.Add(null);
            }

            array.Insert(target, updated);
            return array;
        }

        JsonObject obj = current as JsonObject ?? new JsonObject();
        string name = segment.Name;
        JsonNode? child = obj.TryGetPropertyValue(name, out _) ? Detach(obj, name) : null;
        JsonNode? nested = SetNode(child, path, index + 1, value);
        obj[name] = nested;
        return obj;
    }

    private static JsonNode? UnsetNode(JsonNode? current, ScenePrefabPropertyPath path, int index)
    {
        ScenePrefabPropertyPathSegment segment = path[index];
        bool last = index == path.Count - 1;

        if (segment.IsIndex)
        {
            JsonArray array = current as JsonArray ?? new JsonArray();
            int target = segment.Index;

            if (last)
            {
                if (target < array.Count)
                {
                    array.RemoveAt(target);
                }

                return array;
            }

            JsonNode? existing = target < array.Count ? Detach(array, target) : null;
            JsonNode? updated = UnsetNode(existing, path, index + 1);

            while (array.Count < target)
            {
                array.Add(null);
            }

            array.Insert(target, updated);
            return array;
        }

        JsonObject obj = current as JsonObject ?? new JsonObject();
        string name = segment.Name;

        if (last)
        {
            obj.Remove(name);
            return obj;
        }

        JsonNode? child = obj.TryGetPropertyValue(name, out _) ? Detach(obj, name) : null;
        JsonNode? nested = UnsetNode(child, path, index + 1);
        obj[name] = nested;
        return obj;
    }

    private static JsonNode? Detach(JsonArray array, int index)
    {
        JsonNode? node = array[index];
        array.RemoveAt(index);
        return node;
    }

    private static JsonNode? Detach(JsonObject obj, string name)
    {
        JsonNode? node = obj[name];
        obj.Remove(name);
        return node;
    }

    private static JsonNode? ParseValue(JsonElement value)
    {
        if (value.ValueKind == JsonValueKind.Undefined)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                "Component property values must not be undefined.");
        }

        return JsonNode.Parse(value.GetRawText());
    }

    private static JsonElement CloneElement(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidPath,
                "Component payloads must remain JSON objects.");
        }

        return value.Clone();
    }

    private static JsonElement ToElement(JsonNode node)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            node.WriteTo(writer);
        }

        using JsonDocument document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private sealed class ActorState
    {
        public ActorState(SceneActorSnapshot snapshot)
        {
            NodeId = snapshot.NodeId;
            ParentNodeId = snapshot.ParentNodeId;
            Name = snapshot.Name;
            Layer = snapshot.Layer;
            Tag = snapshot.Tag;
            Active = snapshot.Active;
            Persistent = snapshot.Persistent;
            Pooled = snapshot.Pooled;
            Components = [.. snapshot.Components];
            Source = snapshot.Source;
        }

        public string NodeId { get; }

        public string? ParentNodeId { get; set; }

        public string Name { get; set; }

        public ushort Layer { get; set; }

        public string Tag { get; set; }

        public bool Active { get; set; }

        public bool Persistent { get; set; }

        public bool Pooled { get; set; }

        public ScenePrefabNodeSource? Source { get; }

        public List<SceneComponentSnapshot> Components { get; }

        public SceneActorSnapshot ToSnapshot() => new(
            NodeId,
            Name,
            Layer,
            Tag,
            Active,
            Persistent,
            Pooled,
            Components,
            ParentNodeId,
            Source);
    }
}
