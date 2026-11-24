namespace Axrone.Scene.Prefab;

using System.Buffers;

/// <summary>Automatic conflict resolution policy used during merges.</summary>
public enum ScenePrefabConflictPolicy
{
    /// <summary>Report conflicts and drop the conflicting local operations.</summary>
    Manual = 0,

    /// <summary>Keep the local operation.</summary>
    PreferLocal = 1,

    /// <summary>Keep the incoming operation.</summary>
    PreferIncoming = 2,

    /// <summary>Drop both operations, reverting to the base value.</summary>
    PreferBase = 3
}

/// <summary>Resolution chosen for one conflict.</summary>
public enum ScenePrefabConflictResolution
{
    /// <summary>Leave the conflict unresolved and drop the local operation.</summary>
    Manual = 0,

    /// <summary>Keep the local operation.</summary>
    Local = 1,

    /// <summary>Keep the incoming operation.</summary>
    Incoming = 2,

    /// <summary>Revert to the base value.</summary>
    Base = 3
}

/// <summary>Kind stored by <see cref="ScenePrefabConflictBaseValue"/>.</summary>
public enum ScenePrefabConflictBaseValueKind
{
    /// <summary>The base definition has no value at the conflict key.</summary>
    None = 0,

    /// <summary>An entity snapshot.</summary>
    Entity = 1,

    /// <summary>A component snapshot.</summary>
    Component = 2,

    /// <summary>A JSON property, field or hierarchy value.</summary>
    Json = 3
}

/// <summary>
/// Base value reported with a merge conflict. The union keeps entity and
/// component snapshots unboxed while still exposing scalar values as JSON.
/// </summary>
public readonly struct ScenePrefabConflictBaseValue
{
    private readonly SceneEntitySnapshot? _entity;
    private readonly SceneComponentSnapshot? _component;
    private readonly JsonElement _json;

    private ScenePrefabConflictBaseValue(
        ScenePrefabConflictBaseValueKind kind,
        SceneEntitySnapshot? entity,
        SceneComponentSnapshot? component,
        JsonElement json)
    {
        Kind = kind;
        _entity = entity;
        _component = component;
        _json = json;
    }

    /// <summary>Stored value kind.</summary>
    public ScenePrefabConflictBaseValueKind Kind { get; }

    /// <summary>Entity snapshot for entity conflicts.</summary>
    public SceneEntitySnapshot? Entity => _entity;

    /// <summary>Component snapshot for component conflicts.</summary>
    public SceneComponentSnapshot? Component => _component;

    /// <summary>JSON value for field and property conflicts.</summary>
    public JsonElement Json => _json;

    /// <summary>Absent base value.</summary>
    public static ScenePrefabConflictBaseValue None =>
        new(ScenePrefabConflictBaseValueKind.None, null, null, default);

    /// <summary>Wraps an entity snapshot.</summary>
    public static ScenePrefabConflictBaseValue FromEntity(SceneEntitySnapshot entity)
    {
        ArgumentNullException.ThrowIfNull(entity);
        return new ScenePrefabConflictBaseValue(
            ScenePrefabConflictBaseValueKind.Entity,
            entity,
            null,
            default);
    }

    /// <summary>Wraps a component snapshot.</summary>
    public static ScenePrefabConflictBaseValue FromComponent(SceneComponentSnapshot component)
    {
        ArgumentNullException.ThrowIfNull(component);
        return new ScenePrefabConflictBaseValue(
            ScenePrefabConflictBaseValueKind.Component,
            null,
            component,
            default);
    }

    /// <summary>Wraps a JSON value.</summary>
    public static ScenePrefabConflictBaseValue FromJson(JsonElement value) =>
        new(ScenePrefabConflictBaseValueKind.Json, null, null, value.Clone());
}

/// <summary>One merge conflict between a local and an incoming operation.</summary>
public sealed class ScenePrefabConflict
{
    /// <summary>Creates a conflict record.</summary>
    public ScenePrefabConflict(
        string key,
        ScenePrefabOverrideOperation local,
        ScenePrefabOverrideOperation incoming,
        ScenePrefabConflictBaseValue baseValue)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(key);
        ArgumentNullException.ThrowIfNull(local);
        ArgumentNullException.ThrowIfNull(incoming);
        Key = key;
        Local = local;
        Incoming = incoming;
        BaseValue = baseValue;
    }

    /// <summary>Conflict key grouping operations on the same entity/property.</summary>
    public string Key { get; }

    /// <summary>Local operation.</summary>
    public ScenePrefabOverrideOperation Local { get; }

    /// <summary>Incoming operation.</summary>
    public ScenePrefabOverrideOperation Incoming { get; }

    /// <summary>Base value at the conflict key.</summary>
    public ScenePrefabConflictBaseValue BaseValue { get; }
}

/// <summary>Merge configuration.</summary>
public sealed record ScenePrefabMergeOptions
{
    /// <summary>Automatic resolution policy; defaults to manual conflict reporting.</summary>
    public ScenePrefabConflictPolicy ConflictPolicy { get; init; } = ScenePrefabConflictPolicy.Manual;

    /// <summary>Optional per-conflict resolver that overrides the policy.</summary>
    public Func<ScenePrefabConflict, ScenePrefabConflictResolution>? ConflictResolver { get; init; }
}

/// <summary>Merged operations, unresolved conflicts and the derived definition.</summary>
public sealed class ScenePrefabMergeResult
{
    /// <summary>Creates a merge result.</summary>
    public ScenePrefabMergeResult(
        IReadOnlyList<ScenePrefabOverrideOperation> overrides,
        IReadOnlyList<ScenePrefabConflict> conflicts,
        ScenePrefabDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(overrides);
        ArgumentNullException.ThrowIfNull(conflicts);
        ArgumentNullException.ThrowIfNull(definition);
        Overrides = [.. overrides];
        Conflicts = [.. conflicts];
        Definition = definition;
    }

    /// <summary>Merged override operations.</summary>
    public IReadOnlyList<ScenePrefabOverrideOperation> Overrides { get; }

    /// <summary>Conflicts left unresolved.</summary>
    public IReadOnlyList<ScenePrefabConflict> Conflicts { get; }

    /// <summary>Whether every incoming change was merged without conflicts.</summary>
    public bool Resolved => Conflicts.Count == 0;

    /// <summary>Base definition with the merged overrides applied.</summary>
    public ScenePrefabDefinition Definition { get; }
}

/// <summary>
/// Three-way merge over resolved prefab definitions. Local and incoming deltas
/// are computed against the base; conflicting operations are grouped by the
/// entity/component/property they touch and resolved through the policy.
/// </summary>
public static class ScenePrefabMerge
{
    /// <summary>Merges local and incoming definitions over a shared base.</summary>
    public static ScenePrefabMergeResult Merge(
        ScenePrefabDefinition basePrefab,
        ScenePrefabDefinition local,
        ScenePrefabDefinition incoming,
        ScenePrefabMergeOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(basePrefab);
        ArgumentNullException.ThrowIfNull(local);
        ArgumentNullException.ThrowIfNull(incoming);

        options ??= new ScenePrefabMergeOptions();

        IReadOnlyList<ScenePrefabOverrideOperation> localOverrides =
            ScenePrefabDiff.Compute(basePrefab, local).Overrides;
        IReadOnlyList<ScenePrefabOverrideOperation> incomingOverrides =
            ScenePrefabDiff.Compute(basePrefab, incoming).Overrides;

        var merged = new List<ScenePrefabOverrideOperation>(localOverrides);
        var conflicts = new List<ScenePrefabConflict>();
        var conflictIndices = new List<int>();

        for (int incomingIndex = 0; incomingIndex < incomingOverrides.Count; incomingIndex++)
        {
            ScenePrefabOverrideOperation incomingOperation = incomingOverrides[incomingIndex];

            if (ContainsSameOperation(merged, incomingOperation))
            {
                continue;
            }

            conflictIndices.Clear();
            for (int i = 0; i < merged.Count; i++)
            {
                if (OperationsConflict(merged[i], incomingOperation))
                {
                    conflictIndices.Add(i);
                }
            }

            if (conflictIndices.Count == 0)
            {
                merged.Add(incomingOperation);
                continue;
            }

            ScenePrefabConflict firstConflict =
                CreateConflict(basePrefab, merged[conflictIndices[0]], incomingOperation);
            ScenePrefabConflictResolution choice = ResolveConflict(firstConflict, options);

            if (choice == ScenePrefabConflictResolution.Manual)
            {
                var conflicting = new ScenePrefabOverrideOperation[conflictIndices.Count];
                for (int i = 0; i < conflictIndices.Count; i++)
                {
                    conflicting[i] = merged[conflictIndices[i]];
                }

                RemoveDescending(merged, conflictIndices);

                for (int i = 0; i < conflicting.Length; i++)
                {
                    conflicts.Add(CreateConflict(basePrefab, conflicting[i], incomingOperation));
                }

                continue;
            }

            if (choice == ScenePrefabConflictResolution.Local)
            {
                continue;
            }

            RemoveDescending(merged, conflictIndices);

            if (choice == ScenePrefabConflictResolution.Incoming)
            {
                merged.Add(incomingOperation);
            }
        }

        return new ScenePrefabMergeResult(
            merged,
            conflicts,
            ScenePrefabOverrides.Apply(basePrefab, merged));
    }

    private static bool ContainsSameOperation(
        List<ScenePrefabOverrideOperation> operations,
        ScenePrefabOverrideOperation candidate)
    {
        for (int i = 0; i < operations.Count; i++)
        {
            if (ScenePrefabComparisons.SameOperation(operations[i], candidate))
            {
                return true;
            }
        }

        return false;
    }

    private static void RemoveDescending(List<ScenePrefabOverrideOperation> operations, List<int> indices)
    {
        indices.Sort();
        for (int i = indices.Count - 1; i >= 0; i--)
        {
            operations.RemoveAt(indices[i]);
        }
    }

    private static ScenePrefabConflictResolution ResolveConflict(
        ScenePrefabConflict conflict,
        ScenePrefabMergeOptions options)
    {
        if (options.ConflictResolver is { } resolver)
        {
            return resolver(conflict);
        }

        return options.ConflictPolicy switch
        {
            ScenePrefabConflictPolicy.PreferLocal => ScenePrefabConflictResolution.Local,
            ScenePrefabConflictPolicy.PreferIncoming => ScenePrefabConflictResolution.Incoming,
            ScenePrefabConflictPolicy.PreferBase => ScenePrefabConflictResolution.Base,
            _ => ScenePrefabConflictResolution.Manual
        };
    }

    private static bool OperationsConflict(
        ScenePrefabOverrideOperation left,
        ScenePrefabOverrideOperation right)
    {
        ScenePrefabOperationDescriptor leftDescriptor = Describe(left);
        ScenePrefabOperationDescriptor rightDescriptor = Describe(right);

        if (!string.Equals(leftDescriptor.EntityId, rightDescriptor.EntityId, StringComparison.Ordinal))
        {
            return false;
        }

        if (leftDescriptor.Scope is ScenePrefabOperationScope.EntityRemove or ScenePrefabOperationScope.EntityAdd ||
            rightDescriptor.Scope is ScenePrefabOperationScope.EntityRemove or ScenePrefabOperationScope.EntityAdd)
        {
            return true;
        }

        if (leftDescriptor.ComponentKey is null && rightDescriptor.ComponentKey is null)
        {
            if (leftDescriptor.FieldKey is null || rightDescriptor.FieldKey is null)
            {
                return true;
            }

            return string.Equals(leftDescriptor.FieldKey, rightDescriptor.FieldKey, StringComparison.Ordinal);
        }

        if (leftDescriptor.ComponentKey is null || rightDescriptor.ComponentKey is null)
        {
            return false;
        }

        if (!string.Equals(leftDescriptor.ComponentKey, rightDescriptor.ComponentKey, StringComparison.Ordinal))
        {
            return false;
        }

        if (leftDescriptor.Scope is ScenePrefabOperationScope.ComponentAdd or
                ScenePrefabOperationScope.ComponentRemove or
                ScenePrefabOperationScope.ComponentReplace ||
            rightDescriptor.Scope is ScenePrefabOperationScope.ComponentAdd or
                ScenePrefabOperationScope.ComponentRemove or
                ScenePrefabOperationScope.ComponentReplace)
        {
            return true;
        }

        if (leftDescriptor.Path is not { } leftPath || rightDescriptor.Path is not { } rightPath)
        {
            return true;
        }

        return IsPathAncestor(leftPath, rightPath) || IsPathAncestor(rightPath, leftPath);
    }

    private static bool IsPathAncestor(ScenePrefabPropertyPath ancestor, ScenePrefabPropertyPath descendant)
    {
        if (ancestor.Count > descendant.Count)
        {
            return false;
        }

        for (int i = 0; i < ancestor.Count; i++)
        {
            ScenePrefabPropertyPathSegment left = ancestor[i];
            ScenePrefabPropertyPathSegment right = descendant[i];
            if (left.IsIndex != right.IsIndex)
            {
                return false;
            }

            if (left.IsIndex)
            {
                if (left.Index != right.Index)
                {
                    return false;
                }
            }
            else if (!string.Equals(left.Name, right.Name, StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    private static ScenePrefabConflict CreateConflict(
        ScenePrefabDefinition basePrefab,
        ScenePrefabOverrideOperation local,
        ScenePrefabOverrideOperation incoming)
    {
        ScenePrefabOperationDescriptor localDescriptor = Describe(local);
        ScenePrefabOperationDescriptor incomingDescriptor = Describe(incoming);
        ScenePrefabConflictBaseValue baseValue = ExtractBaseValue(basePrefab, localDescriptor);

        return new ScenePrefabConflict(
            CreateConflictKey(localDescriptor, incomingDescriptor),
            local,
            incoming,
            baseValue);
    }

    private static ScenePrefabConflictBaseValue ExtractBaseValue(
        ScenePrefabDefinition basePrefab,
        in ScenePrefabOperationDescriptor descriptor)
    {
        Dictionary<string, SceneEntitySnapshot> entities = ScenePrefabComparisons.IndexEntities(basePrefab.Entities);
        if (!entities.TryGetValue(descriptor.EntityId, out SceneEntitySnapshot? entity))
        {
            return ScenePrefabConflictBaseValue.None;
        }

        if (descriptor.ComponentKey is null)
        {
            return descriptor.FieldKey is null
                ? ScenePrefabConflictBaseValue.FromEntity(entity)
                : ExtractFieldValue(entity, descriptor.FieldKey);
        }

        Dictionary<string, ScenePrefabComparisons.IndexedComponent> components =
            ScenePrefabComparisons.IndexComponents(entity.Components);
        if (!components.TryGetValue(descriptor.ComponentKey, out ScenePrefabComparisons.IndexedComponent entry))
        {
            return ScenePrefabConflictBaseValue.None;
        }

        if (descriptor.Path is not { Count: > 0 } path)
        {
            return ScenePrefabConflictBaseValue.FromComponent(entry.Component);
        }

        return TryReadPayloadValue(entry.Component.Data, path, out JsonElement value)
            ? ScenePrefabConflictBaseValue.FromJson(value)
            : ScenePrefabConflictBaseValue.None;
    }

    private static ScenePrefabConflictBaseValue ExtractFieldValue(
        SceneEntitySnapshot entity,
        string fieldKey) => fieldKey switch
        {
            "parentNodeId" => ScenePrefabConflictBaseValue.FromJson(JsonString(entity.ParentNodeId)),
            "name" => ScenePrefabConflictBaseValue.FromJson(JsonString(entity.Name)),
            "layer" => ScenePrefabConflictBaseValue.FromJson(JsonInt32(entity.Layer)),
            "tag" => ScenePrefabConflictBaseValue.FromJson(JsonString(entity.Tag)),
            "active" => ScenePrefabConflictBaseValue.FromJson(JsonBoolean(entity.Active)),
            "persistent" => ScenePrefabConflictBaseValue.FromJson(JsonBoolean(entity.Persistent)),
            "pooled" => ScenePrefabConflictBaseValue.FromJson(JsonBoolean(entity.Pooled)),
            _ => ScenePrefabConflictBaseValue.None
        };

    private static JsonElement JsonString(string? value) => CreateElement(
        value is null
            ? static writer => writer.WriteNullValue()
            : writer => writer.WriteStringValue(value));

    private static JsonElement JsonInt32(int value) => CreateElement(
        number => number.WriteNumberValue(value));

    private static JsonElement JsonBoolean(bool value) => CreateElement(
        flag => flag.WriteBooleanValue(value));

    private static JsonElement CreateElement(Action<Utf8JsonWriter> write)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            write(writer);
        }

        using JsonDocument document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }

    private static bool TryReadPayloadValue(
        JsonElement data,
        ScenePrefabPropertyPath path,
        out JsonElement value)
    {
        value = data;

        for (int i = 0; i < path.Count; i++)
        {
            ScenePrefabPropertyPathSegment segment = path[i];
            if (segment.IsIndex)
            {
                if (value.ValueKind != JsonValueKind.Array ||
                    segment.Index >= value.GetArrayLength())
                {
                    return false;
                }

                value = value[segment.Index];
                continue;
            }

            if (value.ValueKind != JsonValueKind.Object ||
                !value.TryGetProperty(segment.Name, out JsonElement property))
            {
                return false;
            }

            value = property;
        }

        return true;
    }

    private static string CreateConflictKey(
        in ScenePrefabOperationDescriptor left,
        in ScenePrefabOperationDescriptor right)
    {
        string? componentKey = left.ComponentKey ?? right.ComponentKey;
        if (componentKey is null)
        {
            return left.FieldKey is { } field && string.Equals(field, right.FieldKey, StringComparison.Ordinal)
                ? $"entity:{left.EntityId}:field:{field}"
                : $"entity:{left.EntityId}";
        }

        ScenePrefabPropertyPath? path = left.Path ?? right.Path;
        return path is { Count: > 0 }
            ? $"component:{left.EntityId}:{componentKey}:path:{SerializePath(path)}"
            : $"component:{left.EntityId}:{componentKey}";
    }

    private static string SerializePath(ScenePrefabPropertyPath path)
    {
        var builder = new System.Text.StringBuilder();
        for (int i = 0; i < path.Count; i++)
        {
            ScenePrefabPropertyPathSegment segment = path[i];
            if (segment.IsIndex)
            {
                builder.Append('[').Append(segment.Index).Append(']');
                continue;
            }

            if (builder.Length > 0)
            {
                builder.Append('.');
            }

            builder.Append(segment.Name);
        }

        return builder.ToString();
    }

    private static ScenePrefabOperationDescriptor Describe(ScenePrefabOverrideOperation operation) =>
        operation switch
        {
            ScenePrefabAddEntityOperation add => new ScenePrefabOperationDescriptor(
                add.Entity.NodeId,
                ScenePrefabOperationScope.EntityAdd,
                null,
                null,
                null),
            ScenePrefabRemoveEntityOperation remove => new ScenePrefabOperationDescriptor(
                remove.NodeId,
                ScenePrefabOperationScope.EntityRemove,
                null,
                null,
                null),
            ScenePrefabReparentEntityOperation reparent => new ScenePrefabOperationDescriptor(
                reparent.NodeId,
                ScenePrefabOperationScope.EntityField,
                null,
                "parentNodeId",
                null),
            ScenePrefabSetEntityFieldOperation setField => new ScenePrefabOperationDescriptor(
                setField.NodeId,
                ScenePrefabOperationScope.EntityField,
                null,
                FieldKey(setField.Field),
                null),
            ScenePrefabAddComponentOperation addComponent => new ScenePrefabOperationDescriptor(
                addComponent.NodeId,
                ScenePrefabOperationScope.ComponentAdd,
                addComponent.Component.Id is { } componentId
                    ? $"id:{componentId}"
                    : $"type:{addComponent.Component.Type}",
                null,
                null),
            ScenePrefabRemoveComponentOperation removeComponent => new ScenePrefabOperationDescriptor(
                removeComponent.NodeId,
                ScenePrefabOperationScope.ComponentRemove,
                ScenePrefabComparisons.SelectorKey(removeComponent.Selector),
                null,
                null),
            ScenePrefabReplaceComponentOperation replaceComponent => new ScenePrefabOperationDescriptor(
                replaceComponent.NodeId,
                ScenePrefabOperationScope.ComponentReplace,
                ScenePrefabComparisons.SelectorKey(replaceComponent.Selector),
                null,
                null),
            ScenePrefabSetComponentPropertyOperation setProperty => new ScenePrefabOperationDescriptor(
                setProperty.NodeId,
                ScenePrefabOperationScope.ComponentProperty,
                ScenePrefabComparisons.SelectorKey(setProperty.Selector),
                null,
                setProperty.Path),
            ScenePrefabUnsetComponentPropertyOperation unsetProperty => new ScenePrefabOperationDescriptor(
                unsetProperty.NodeId,
                ScenePrefabOperationScope.ComponentProperty,
                ScenePrefabComparisons.SelectorKey(unsetProperty.Selector),
                null,
                unsetProperty.Path),
            _ => throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                $"Unknown override operation '{operation.GetType().Name}'.")
        };

    private static string FieldKey(ScenePrefabEntityField field) => field switch
    {
        ScenePrefabEntityField.Name => "name",
        ScenePrefabEntityField.Layer => "layer",
        ScenePrefabEntityField.Tag => "tag",
        ScenePrefabEntityField.Active => "active",
        ScenePrefabEntityField.Persistent => "persistent",
        ScenePrefabEntityField.Pooled => "pooled",
        _ => field.ToString()
    };
}

/// <summary>Operation scopes used for conflict detection.</summary>
internal enum ScenePrefabOperationScope
{
    EntityAdd,
    EntityRemove,
    EntityField,
    ComponentAdd,
    ComponentRemove,
    ComponentReplace,
    ComponentProperty
}

/// <summary>Conflict-relevant operation identity.</summary>
internal readonly record struct ScenePrefabOperationDescriptor(
    string EntityId,
    ScenePrefabOperationScope Scope,
    string? ComponentKey,
    string? FieldKey,
    ScenePrefabPropertyPath? Path);
