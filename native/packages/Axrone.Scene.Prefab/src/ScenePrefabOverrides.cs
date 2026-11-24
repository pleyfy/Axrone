namespace Axrone.Scene.Prefab;

/// <summary>Override operation discriminator.</summary>
public enum ScenePrefabOverrideKind
{
    /// <summary>Creates one entity snapshot.</summary>
    AddEntity = 0,

    /// <summary>Removes an entity and its subtree.</summary>
    RemoveEntity = 1,

    /// <summary>Moves an entity under another parent.</summary>
    ReparentEntity = 2,

    /// <summary>Replaces one entity field.</summary>
    SetEntityField = 3,

    /// <summary>Inserts a component snapshot.</summary>
    AddComponent = 4,

    /// <summary>Removes a component snapshot.</summary>
    RemoveComponent = 5,

    /// <summary>Replaces a component snapshot in place.</summary>
    ReplaceComponent = 6,

    /// <summary>Writes one value inside a component payload.</summary>
    SetComponentProperty = 7,

    /// <summary>Removes one value from a component payload.</summary>
    UnsetComponentProperty = 8
}

/// <summary>Entity fields addressable by <see cref="ScenePrefabSetEntityFieldOperation"/>.</summary>
public enum ScenePrefabEntityField
{
    /// <summary>Entity name.</summary>
    Name = 0,

    /// <summary>Entity layer.</summary>
    Layer = 1,

    /// <summary>Entity tag.</summary>
    Tag = 2,

    /// <summary>Starts-active flag.</summary>
    Active = 3,

    /// <summary>Persistent flag.</summary>
    Persistent = 4,

    /// <summary>Pooled flag.</summary>
    Pooled = 5
}

/// <summary>Kind stored by <see cref="ScenePrefabEntityFieldValue"/>.</summary>
public enum ScenePrefabEntityFieldValueKind
{
    /// <summary>No value assigned.</summary>
    None = 0,

    /// <summary>UTF-16 string.</summary>
    Text = 1,

    /// <summary>32-bit signed integer.</summary>
    Number = 2,

    /// <summary>Boolean.</summary>
    Flag = 3
}

/// <summary>
/// Field value carried by a set-entity-field override. A dedicated union keeps
/// the operation free of boxing while the applier validates the field/value pair.
/// </summary>
public readonly record struct ScenePrefabEntityFieldValue
{
    private readonly string? _stringValue;
    private readonly int _int32Value;
    private readonly bool _booleanValue;

    private ScenePrefabEntityFieldValue(
        ScenePrefabEntityFieldValueKind kind,
        string? stringValue,
        int int32Value,
        bool booleanValue)
    {
        Kind = kind;
        _stringValue = stringValue;
        _int32Value = int32Value;
        _booleanValue = booleanValue;
    }

    /// <summary>Stored value kind.</summary>
    public ScenePrefabEntityFieldValueKind Kind { get; }

    /// <summary>Creates a string value.</summary>
    public static ScenePrefabEntityFieldValue FromString(string value)
    {
        ArgumentNullException.ThrowIfNull(value);
        return new ScenePrefabEntityFieldValue(ScenePrefabEntityFieldValueKind.Text, value, 0, false);
    }

    /// <summary>Creates an integer value.</summary>
    public static ScenePrefabEntityFieldValue FromInt32(int value) =>
        new(ScenePrefabEntityFieldValueKind.Number, null, value, false);

    /// <summary>Creates a boolean value.</summary>
    public static ScenePrefabEntityFieldValue FromBoolean(bool value) =>
        new(ScenePrefabEntityFieldValueKind.Flag, null, 0, value);

    /// <summary>Returns the string payload.</summary>
    /// <exception cref="ScenePrefabException">The value is not a string.</exception>
    public string AsString() => Kind == ScenePrefabEntityFieldValueKind.Text
        ? _stringValue!
        : throw new ScenePrefabException(
            ScenePrefabErrorCodes.InvalidOverride,
            $"Entity field value is '{Kind}', not a string.");

    /// <summary>Returns the integer payload.</summary>
    /// <exception cref="ScenePrefabException">The value is not an integer.</exception>
    public int AsInt32() => Kind == ScenePrefabEntityFieldValueKind.Number
        ? _int32Value
        : throw new ScenePrefabException(
            ScenePrefabErrorCodes.InvalidOverride,
            $"Entity field value is '{Kind}', not an integer.");

    /// <summary>Returns the boolean payload.</summary>
    /// <exception cref="ScenePrefabException">The value is not a boolean.</exception>
    public bool AsBoolean() => Kind == ScenePrefabEntityFieldValueKind.Flag
        ? _booleanValue
        : throw new ScenePrefabException(
            ScenePrefabErrorCodes.InvalidOverride,
            $"Entity field value is '{Kind}', not a boolean.");
}

/// <summary>One segment of a component property path.</summary>
public readonly record struct ScenePrefabPropertyPathSegment
{
    private readonly string? _name;

    private ScenePrefabPropertyPathSegment(string? name, int index)
    {
        _name = name;
        Index = index;
    }

    /// <summary>Whether the segment addresses an array index.</summary>
    public bool IsIndex => _name is null;

    /// <summary>Member name for object segments; empty for array indices.</summary>
    public string Name => _name ?? string.Empty;

    /// <summary>Array index for index segments.</summary>
    public int Index { get; }

    /// <summary>Creates an object-member segment.</summary>
    public static ScenePrefabPropertyPathSegment ForName(string name)
    {
        if (string.IsNullOrEmpty(name))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidPath,
                "Property path member names must not be empty.");
        }

        return new ScenePrefabPropertyPathSegment(name, 0);
    }

    /// <summary>Creates an array-index segment.</summary>
    public static ScenePrefabPropertyPathSegment ForIndex(int index)
    {
        if (index < 0)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidPath,
                $"Property path indices must not be negative; received {index}.");
        }

        return new ScenePrefabPropertyPathSegment(null, index);
    }
}

/// <summary>Segment sequence addressing a value inside a component payload.</summary>
public sealed class ScenePrefabPropertyPath : IReadOnlyList<ScenePrefabPropertyPathSegment>
{
    private readonly ScenePrefabPropertyPathSegment[] _segments;

    /// <summary>Creates a path from ordered segments.</summary>
    public ScenePrefabPropertyPath(params ScenePrefabPropertyPathSegment[] segments)
    {
        ArgumentNullException.ThrowIfNull(segments);
        _segments = [.. segments];
    }

    /// <summary>Empty path addressing the payload root.</summary>
    public static ScenePrefabPropertyPath Root { get; } = new();

    /// <summary>Number of segments.</summary>
    public int Count => _segments.Length;

    /// <summary>Returns the segment at an index.</summary>
    public ScenePrefabPropertyPathSegment this[int index] => _segments[index];

    /// <summary>Enumerates segments from root to leaf.</summary>
    public IEnumerator<ScenePrefabPropertyPathSegment> GetEnumerator() =>
        ((IEnumerable<ScenePrefabPropertyPathSegment>)_segments).GetEnumerator();

    System.Collections.IEnumerator System.Collections.IEnumerable.GetEnumerator() =>
        GetEnumerator();
}

/// <summary>Component selector kinds.</summary>
public enum ScenePrefabComponentSelectorKind
{
    /// <summary>Match by stable component id.</summary>
    Id = 0,

    /// <summary>Match by component type and occurrence.</summary>
    Type = 1
}

/// <summary>
/// Locates one component snapshot. Id selectors fall back to the optional type
/// when the id is absent, matching the authoring workflow.
/// </summary>
public readonly record struct ScenePrefabComponentSelector
{
    private ScenePrefabComponentSelector(
        ScenePrefabComponentSelectorKind kind,
        string? componentId,
        string? type,
        int occurrence)
    {
        Kind = kind;
        ComponentId = componentId;
        Type = type;
        Occurrence = occurrence;
    }

    /// <summary>Selector kind.</summary>
    public ScenePrefabComponentSelectorKind Kind { get; }

    /// <summary>Stable component id for id selectors.</summary>
    public string? ComponentId { get; }

    /// <summary>Component type name.</summary>
    public string? Type { get; }

    /// <summary>Zero-based occurrence for type selectors.</summary>
    public int Occurrence { get; }

    /// <summary>Selects a component by stable id, with an optional type fallback.</summary>
    public static ScenePrefabComponentSelector FromId(string componentId, string? type = null)
    {
        if (string.IsNullOrWhiteSpace(componentId))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                "Component id selectors require a non-empty id.");
        }

        return new ScenePrefabComponentSelector(
            ScenePrefabComponentSelectorKind.Id,
            componentId,
            type,
            0);
    }

    /// <summary>Selects the occurrence-th component of a type.</summary>
    public static ScenePrefabComponentSelector FromType(string type, int occurrence = 0)
    {
        if (string.IsNullOrWhiteSpace(type))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                "Component type selectors require a non-empty type.");
        }

        if (occurrence < 0)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                $"Component occurrence must not be negative; received {occurrence}.");
        }

        return new ScenePrefabComponentSelector(
            ScenePrefabComponentSelectorKind.Type,
            null,
            type,
            occurrence);
    }
}

/// <summary>Base type for prefab override operations.</summary>
public abstract class ScenePrefabOverrideOperation
{
    /// <summary>Operation discriminator.</summary>
    public abstract ScenePrefabOverrideKind Kind { get; }
}

/// <summary>Creates one entity snapshot.</summary>
public sealed class ScenePrefabAddEntityOperation : ScenePrefabOverrideOperation
{
    /// <summary>Creates an add-entity operation.</summary>
    public ScenePrefabAddEntityOperation(SceneEntitySnapshot entity, string? afterNodeId = null)
    {
        ArgumentNullException.ThrowIfNull(entity);
        Entity = entity;
        AfterNodeId = string.IsNullOrEmpty(afterNodeId) ? null : afterNodeId;
    }

    /// <summary>Entity snapshot to insert.</summary>
    public SceneEntitySnapshot Entity { get; }

    /// <summary>Optional anchor node; null appends.</summary>
    public string? AfterNodeId { get; }

    /// <inheritdoc/>
    public override ScenePrefabOverrideKind Kind => ScenePrefabOverrideKind.AddEntity;
}

/// <summary>Removes an entity and its subtree.</summary>
public sealed class ScenePrefabRemoveEntityOperation : ScenePrefabOverrideOperation
{
    /// <summary>Creates a remove-entity operation.</summary>
    public ScenePrefabRemoveEntityOperation(string nodeId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        NodeId = nodeId;
    }

    /// <summary>Subtree root node id.</summary>
    public string NodeId { get; }

    /// <inheritdoc/>
    public override ScenePrefabOverrideKind Kind => ScenePrefabOverrideKind.RemoveEntity;
}

/// <summary>Moves an entity under another parent.</summary>
public sealed class ScenePrefabReparentEntityOperation : ScenePrefabOverrideOperation
{
    /// <summary>Creates a reparent-entity operation.</summary>
    public ScenePrefabReparentEntityOperation(string nodeId, string? parentNodeId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        NodeId = nodeId;
        ParentNodeId = string.IsNullOrEmpty(parentNodeId) ? null : parentNodeId;
    }

    /// <summary>Entity to move.</summary>
    public string NodeId { get; }

    /// <summary>New parent node id; null makes the entity a root.</summary>
    public string? ParentNodeId { get; }

    /// <inheritdoc/>
    public override ScenePrefabOverrideKind Kind => ScenePrefabOverrideKind.ReparentEntity;
}

/// <summary>Replaces one entity field.</summary>
public sealed class ScenePrefabSetEntityFieldOperation : ScenePrefabOverrideOperation
{
    /// <summary>Creates a set-entity-field operation.</summary>
    public ScenePrefabSetEntityFieldOperation(
        string nodeId,
        ScenePrefabEntityField field,
        ScenePrefabEntityFieldValue value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        NodeId = nodeId;
        Field = field;
        Value = value;
        Validate(field, value);
    }

    /// <summary>Target entity node id.</summary>
    public string NodeId { get; }

    /// <summary>Field to replace.</summary>
    public ScenePrefabEntityField Field { get; }

    /// <summary>Replacement value.</summary>
    public ScenePrefabEntityFieldValue Value { get; }

    /// <inheritdoc/>
    public override ScenePrefabOverrideKind Kind => ScenePrefabOverrideKind.SetEntityField;

    private static void Validate(ScenePrefabEntityField field, ScenePrefabEntityFieldValue value)
    {
        ScenePrefabEntityFieldValueKind expected = field switch
        {
            ScenePrefabEntityField.Name or ScenePrefabEntityField.Tag =>
                ScenePrefabEntityFieldValueKind.Text,
            ScenePrefabEntityField.Layer => ScenePrefabEntityFieldValueKind.Number,
            _ => ScenePrefabEntityFieldValueKind.Flag
        };

        if (value.Kind != expected)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                $"Entity field '{field}' expects a {expected} value; received {value.Kind}.");
        }
    }
}

/// <summary>Inserts a component snapshot.</summary>
public sealed class ScenePrefabAddComponentOperation : ScenePrefabOverrideOperation
{
    /// <summary>Creates an add-component operation.</summary>
    public ScenePrefabAddComponentOperation(
        string nodeId,
        SceneComponentSnapshot component,
        int? index = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        ArgumentNullException.ThrowIfNull(component);
        NodeId = nodeId;
        Component = component;
        Index = index;
    }

    /// <summary>Target entity node id.</summary>
    public string NodeId { get; }

    /// <summary>Component snapshot to insert.</summary>
    public SceneComponentSnapshot Component { get; }

    /// <summary>Optional insertion index, clamped to the component count.</summary>
    public int? Index { get; }

    /// <inheritdoc/>
    public override ScenePrefabOverrideKind Kind => ScenePrefabOverrideKind.AddComponent;
}

/// <summary>Removes a component snapshot.</summary>
public sealed class ScenePrefabRemoveComponentOperation : ScenePrefabOverrideOperation
{
    /// <summary>Creates a remove-component operation.</summary>
    public ScenePrefabRemoveComponentOperation(string nodeId, ScenePrefabComponentSelector selector)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        NodeId = nodeId;
        Selector = selector;
    }

    /// <summary>Target entity node id.</summary>
    public string NodeId { get; }

    /// <summary>Component selector.</summary>
    public ScenePrefabComponentSelector Selector { get; }

    /// <inheritdoc/>
    public override ScenePrefabOverrideKind Kind => ScenePrefabOverrideKind.RemoveComponent;
}

/// <summary>Replaces a component snapshot in place.</summary>
public sealed class ScenePrefabReplaceComponentOperation : ScenePrefabOverrideOperation
{
    /// <summary>Creates a replace-component operation.</summary>
    public ScenePrefabReplaceComponentOperation(
        string nodeId,
        ScenePrefabComponentSelector selector,
        SceneComponentSnapshot component)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        ArgumentNullException.ThrowIfNull(component);
        NodeId = nodeId;
        Selector = selector;
        Component = component;
    }

    /// <summary>Target entity node id.</summary>
    public string NodeId { get; }

    /// <summary>Component selector.</summary>
    public ScenePrefabComponentSelector Selector { get; }

    /// <summary>Replacement snapshot.</summary>
    public SceneComponentSnapshot Component { get; }

    /// <inheritdoc/>
    public override ScenePrefabOverrideKind Kind => ScenePrefabOverrideKind.ReplaceComponent;
}

/// <summary>Writes one value inside a component payload.</summary>
public sealed class ScenePrefabSetComponentPropertyOperation : ScenePrefabOverrideOperation
{
    /// <summary>Creates a set-component-property operation.</summary>
    public ScenePrefabSetComponentPropertyOperation(
        string nodeId,
        ScenePrefabComponentSelector selector,
        ScenePrefabPropertyPath path,
        JsonElement value)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        ArgumentNullException.ThrowIfNull(path);
        NodeId = nodeId;
        Selector = selector;
        Path = path;
        Value = value.Clone();
    }

    /// <summary>Target entity node id.</summary>
    public string NodeId { get; }

    /// <summary>Component selector.</summary>
    public ScenePrefabComponentSelector Selector { get; }

    /// <summary>Property path inside the payload.</summary>
    public ScenePrefabPropertyPath Path { get; }

    /// <summary>Detached replacement value.</summary>
    public JsonElement Value { get; }

    /// <inheritdoc/>
    public override ScenePrefabOverrideKind Kind => ScenePrefabOverrideKind.SetComponentProperty;
}

/// <summary>Removes one value from a component payload.</summary>
public sealed class ScenePrefabUnsetComponentPropertyOperation : ScenePrefabOverrideOperation
{
    /// <summary>Creates an unset-component-property operation.</summary>
    public ScenePrefabUnsetComponentPropertyOperation(
        string nodeId,
        ScenePrefabComponentSelector selector,
        ScenePrefabPropertyPath path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        ArgumentNullException.ThrowIfNull(path);
        NodeId = nodeId;
        Selector = selector;
        Path = path;
    }

    /// <summary>Target entity node id.</summary>
    public string NodeId { get; }

    /// <summary>Component selector.</summary>
    public ScenePrefabComponentSelector Selector { get; }

    /// <summary>Property path inside the payload.</summary>
    public ScenePrefabPropertyPath Path { get; }

    /// <inheritdoc/>
    public override ScenePrefabOverrideKind Kind => ScenePrefabOverrideKind.UnsetComponentProperty;
}
