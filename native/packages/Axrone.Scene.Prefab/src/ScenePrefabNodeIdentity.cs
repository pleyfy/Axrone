namespace Axrone.Scene.Prefab;

using System.Buffers;

/// <summary>
/// Actor identity and provenance preparation shared by JSON reads, composition
/// resolution and instantiation.
/// </summary>
public static class ScenePrefabNodeIdentity
{
    /// <summary>
    /// Requires a stable actor node id and reports the owning prefab and
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
                $"Prefab '{prefabId}' actor at index {index} is missing a stable nodeId.");
        }

        return nodeId;
    }

    /// <summary>Returns an actor snapshot with source, synthesizing origin from its owning definition.</summary>
    public static SceneActorSnapshot EnsureProvenance(
        SceneActorSnapshot actor,
        string prefabId,
        IReadOnlyList<string> lineage,
        int index)
    {
        ArgumentNullException.ThrowIfNull(actor);

        RequireStableNodeId(actor.NodeId, prefabId, index);
        return actor.Source is { } source
            ? actor
            : actor.WithSource(CreateFallback(prefabId, actor.NodeId, lineage));
    }

    /// <summary>Creates fallback provenance for a definition-level actor without an explicit source.</summary>
    public static ScenePrefabNodeSource CreateFallback(
        string prefabId,
        string nodeId,
        IReadOnlyList<string> lineage) =>
        new(prefabId, RequireStableNodeId(nodeId, prefabId, 0), default, FromSequence(lineage));

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
