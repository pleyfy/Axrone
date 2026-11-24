namespace Axrone.Scene.Prefab;

using System.Buffers;

/// <summary>
/// Entity identity and provenance preparation shared by JSON reads, composition
/// resolution and instantiation.
/// </summary>
public static class ScenePrefabNodeIdentity
{
    /// <summary>
    /// Requires a stable entity node id and reports the owning prefab and
    /// declaration index when it is missing.
    /// </summary>
    /// <exception cref="ScenePrefabException">
    /// Thrown with <see cref="ScenePrefabErrorCodes.MissingStableNodeId"/> for a
    /// null, empty or whitespace id.
    /// </exception>
    public static string RequireStableNodeId(string? nodeId, string prefabId, int index)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prefabId);
        if (string.IsNullOrWhiteSpace(nodeId))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.MissingStableNodeId,
                $"Prefab '{prefabId}' entity at index {index} is missing a stable nodeId.");
        }

        return nodeId;
    }

    /// <summary>Returns an entity snapshot with source, synthesizing origin from its owning definition.</summary>
    public static SceneEntitySnapshot EnsureProvenance(
        SceneEntitySnapshot entity,
        string prefabId,
        IReadOnlyList<string> lineage,
        int index)
    {
        ArgumentNullException.ThrowIfNull(entity);

        RequireStableNodeId(entity.NodeId, prefabId, index);
        return entity.Source is { } source
            ? entity
            : entity.WithSource(CreateFallback(prefabId, entity.NodeId, lineage, index));
    }

    /// <summary>Creates fallback provenance for a definition-level entity without an explicit source.</summary>
    public static ScenePrefabNodeSource CreateFallback(
        string prefabId,
        string nodeId,
        IReadOnlyList<string> lineage,
        int index) =>
        new(prefabId, RequireStableNodeId(nodeId, prefabId, index), default, FromSequence(lineage));

    /// <summary>Builds a fixed path from a stable ID sequence without allocating an intermediate array.</summary>
    public static ScenePrefabIdPath FromSequence(IReadOnlyList<string> values)
    {
        ArgumentNullException.ThrowIfNull(values);

        if (values.Count > ScenePrefabIdPath.Capacity)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidProvenance,
                $"Prefab identity sequence exceeds the fixed capacity of {ScenePrefabIdPath.Capacity}.");
        }

        if (values.Count == 0)
        {
            return ScenePrefabIdPath.Empty;
        }

        int count = values.Count;
        string[] buffer = ArrayPool<string>.Shared.Rent(count);
        try
        {
            for (int i = 0; i < count; i++)
            {
                string value = values[i]
                    ?? throw new ScenePrefabException(
                        ScenePrefabErrorCodes.InvalidProvenance,
                        "Prefab identity sequence elements must be non-null.");
                buffer[i] = value;
            }

            return ScenePrefabIdPath.Create(buffer.AsSpan(0, count));
        }
        finally
        {
            ArrayPool<string>.Shared.Return(buffer, clearArray: true);
        }
    }
}
