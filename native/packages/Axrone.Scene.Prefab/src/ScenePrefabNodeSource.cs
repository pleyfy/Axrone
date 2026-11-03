namespace Axrone.Scene.Prefab;

/// <summary>
/// Bounded ordered sequence of stable prefab identifiers. The fixed inline
/// storage keeps source path extension and lookup allocation-free; sequences
/// beyond the authoring budget fail closed with a typed provenance error.
/// </summary>
public readonly struct ScenePrefabIdPath : IEquatable<ScenePrefabIdPath>
{
    /// <summary>Maximum number of stable identifiers addressable by one path.</summary>
    public const int Capacity = 16;

    private readonly byte _count;
    private readonly Slots _slots;

    private ScenePrefabIdPath(byte count, Slots slots)
    {
        _count = count;
        _slots = slots;
    }

    /// <summary>Empty path value.</summary>
    public static ScenePrefabIdPath Empty => default;

    /// <summary>Number of populated slots.</summary>
    public int Count => _count;

    /// <summary>Whether the path contains no identifiers.</summary>
    public bool IsEmpty => _count == 0;

    /// <summary>Reads an identifier by ordinal position.</summary>
    public string this[int index]
    {
        get
        {
            if ((uint)index >= (uint)_count)
            {
                throw new ArgumentOutOfRangeException(nameof(index));
            }

            return _slots[index]!;
        }
    }

    /// <summary>Builds a validated sequence, rejecting values beyond the fixed capacity.</summary>
    public static ScenePrefabIdPath Create(ReadOnlySpan<string> values)
    {
        if (values.Length > Capacity)
        {
            ThrowTooLong();
        }

        var slots = new Slots();
        for (int i = 0; i < values.Length; i++)
        {
            ValidateValue(values[i]);
            slots[i] = values[i];
        }

        return new ScenePrefabIdPath((byte)values.Length, slots);
    }

    /// <summary>Returns a path with one validated identifier appended.</summary>
    public ScenePrefabIdPath Append(string value)
    {
        if (_count == Capacity)
        {
            ThrowTooLong();
        }

        ValidateValue(value);
        Slots slots = _slots;
        slots[_count] = value;
        return new ScenePrefabIdPath((byte)(_count + 1), slots);
    }

    /// <inheritdoc/>
    public bool Equals(ScenePrefabIdPath other)
    {
        if (_count != other._count)
        {
            return false;
        }

        for (int i = 0; i < _count; i++)
        {
            if (!string.Equals(_slots[i], other._slots[i], StringComparison.Ordinal))
            {
                return false;
            }
        }

        return true;
    }

    /// <inheritdoc/>
    public override bool Equals(object? obj) => obj is ScenePrefabIdPath other && Equals(other);

    /// <inheritdoc/>
    public override int GetHashCode()
    {
        var hash = new HashCode();
        for (int i = 0; i < _count; i++)
        {
            hash.Add(_slots[i], StringComparer.Ordinal);
        }

        return hash.ToHashCode();
    }

    /// <summary>Determines whether two paths contain the same identifiers in order.</summary>
    public static bool operator ==(ScenePrefabIdPath left, ScenePrefabIdPath right) =>
        left.Equals(right);

    /// <summary>Determines whether two paths differ.</summary>
    public static bool operator !=(ScenePrefabIdPath left, ScenePrefabIdPath right) =>
        !left.Equals(right);

    /// <summary>Writes the populated identifiers as JSON strings.</summary>
    public void WriteTo(Utf8JsonWriter writer, string name)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteStartArray(name);
        for (int i = 0; i < _count; i++)
        {
            writer.WriteStringValue(_slots[i]);
        }

        writer.WriteEndArray();
    }

    private static void ValidateValue(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidProvenance,
                "Prefab identity path elements must be non-empty.");
        }
    }

    [DoesNotReturn]
    private static void ThrowTooLong() =>
        throw new ScenePrefabException(
            ScenePrefabErrorCodes.InvalidProvenance,
            $"Prefab identity path exceeds the fixed capacity of {Capacity}.");

    [InlineArray(Capacity)]
    private partial struct Slots
    {
        private string? _element0;
    }
}

/// <summary>Stable origin of one prefab actor in a composed prefab hierarchy.</summary>
public readonly record struct ScenePrefabNodeSource
{
    /// <summary>Prefab that owns the original node.</summary>
    public string PrefabId { get; }

    /// <summary>Unscoped node id of the original actor.</summary>
    public string NodeId { get; }

    /// <summary>Nested instance ids from the outermost host to the owning instance.</summary>
    public ScenePrefabIdPath InstancePath { get; }

    /// <summary>Variant resolution chain copied from the owning definition.</summary>
    public ScenePrefabIdPath Lineage { get; }

    /// <summary>Creates validated provenance metadata.</summary>
    public ScenePrefabNodeSource(
        string prefabId,
        string nodeId,
        ScenePrefabIdPath instancePath = default,
        ScenePrefabIdPath lineage = default)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prefabId);
        ArgumentException.ThrowIfNullOrWhiteSpace(nodeId);
        PrefabId = prefabId;
        NodeId = nodeId;
        InstancePath = instancePath;
        Lineage = lineage;
    }

    /// <summary>Creates provenance from an optional identifier sequence.</summary>
    public static ScenePrefabNodeSource Create(
        string prefabId,
        string nodeId,
        ReadOnlySpan<string> instancePath = default,
        ReadOnlySpan<string> lineage = default) =>
        new(
            prefabId,
            nodeId,
            ScenePrefabIdPath.Create(instancePath),
            ScenePrefabIdPath.Create(lineage));

    /// <summary>Returns a copy with one nested instance appended to the path.</summary>
    public ScenePrefabNodeSource WithInstancePath(string instanceId) =>
        new(PrefabId, NodeId, InstancePath.Append(instanceId), Lineage);

    /// <summary>
    /// Equality is structural so JSON and dictionary consumers never depend on
    /// reference identity of backing sequence arrays.
    /// </summary>
    public bool Equals(ScenePrefabNodeSource other) =>
        string.Equals(PrefabId, other.PrefabId, StringComparison.Ordinal) &&
        string.Equals(NodeId, other.NodeId, StringComparison.Ordinal) &&
        InstancePath.Equals(other.InstancePath) &&
        Lineage.Equals(other.Lineage);

    /// <inheritdoc/>
    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(PrefabId, StringComparer.Ordinal);
        hash.Add(NodeId, StringComparer.Ordinal);
        hash.Add(InstancePath);
        hash.Add(Lineage);
        return hash.ToHashCode();
    }
}
