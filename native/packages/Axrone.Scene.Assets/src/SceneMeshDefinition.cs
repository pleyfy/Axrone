namespace Axrone.Scene.Assets;

/// <summary>
/// Immutable CPU-side mesh definition. Vertex and index payloads are exposed
/// as read-only memory views; the caller retains ownership of the backing
/// arrays and must not mutate them after registration.
/// </summary>
public sealed class SceneMeshDefinition : ISceneAssetDefinition<MeshAssetTag>
{
    /// <summary>Creates a mesh definition.</summary>
    public SceneMeshDefinition(
        SceneAssetId<MeshAssetTag> id,
        ReadOnlyMemory<byte> vertices,
        IReadOnlyList<SceneVertexAttribute> attributes,
        int vertexCount = 0,
        ReadOnlyMemory<byte> indices = default,
        SceneIndexFormat indexFormat = SceneIndexFormat.UInt16,
        int indexCount = 0,
        SceneMeshTopology topology = SceneMeshTopology.Triangles,
        BoundingSphere3? bounds = null,
        IReadOnlyList<SceneMorphTargetDefinition>? morphTargets = null)
    {
        if (!id.IsValid)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                "Mesh definitions require a non-empty id.");
        }

        if (vertices.IsEmpty)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Mesh '{id}' requires vertex data.");
        }

        ArgumentNullException.ThrowIfNull(attributes);
        if (attributes.Count == 0)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Mesh '{id}' requires at least one vertex attribute.");
        }

        SceneVertexAttribute[] attributeArray = [.. attributes];
        int stride = attributeArray[0].Stride;
        for (int i = 1; i < attributeArray.Length; i++)
        {
            if (attributeArray[i].Stride != stride)
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Mesh '{id}' attributes must share one interleaved stride.");
            }
        }

        int resolvedVertexCount = vertexCount > 0
            ? vertexCount
            : vertices.Length / stride;

        if (resolvedVertexCount <= 0)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Mesh '{id}' vertex data is shorter than one vertex.");
        }

        int indexWidth = indexFormat == SceneIndexFormat.UInt16 ? 2 : 4;
        int resolvedIndexCount;
        if (indices.IsEmpty)
        {
            if (indexCount != 0)
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Mesh '{id}' declares indices but provides no index payload.");
            }

            resolvedIndexCount = 0;
        }
        else
        {
            if (indices.Length % indexWidth != 0)
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Mesh '{id}' index payload is not aligned to the index width.");
            }

            int available = indices.Length / indexWidth;
            resolvedIndexCount = indexCount > 0 ? indexCount : available;
            if (resolvedIndexCount > available)
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Mesh '{id}' declares more indices than the payload contains.");
            }
        }

        SceneMorphTargetDefinition[] morphTargetArray = morphTargets is null ? [] : [.. morphTargets];
        for (int i = 0; i < morphTargetArray.Length; i++)
        {
            SceneMorphTargetDefinition target = morphTargetArray[i];
            if (target.Stride < target.ComponentCount * sizeof(float) ||
                target.ComponentCount is < 1 or > 4)
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Mesh '{id}' morph target {i} has an invalid stride or component count.");
            }

            if (target.DeltaBuffer.Length < resolvedVertexCount * target.Stride)
            {
                throw new SceneAssetException(
                    SceneAssetErrorCodes.Invalid,
                    $"Mesh '{id}' morph target {i} delta buffer is shorter than the vertex count requires.");
            }
        }

        Id = id;
        Vertices = vertices;
        Indices = indices;
        Attributes = attributeArray;
        VertexStride = stride;
        VertexCount = resolvedVertexCount;
        IndexFormat = indexFormat;
        IndexCount = resolvedIndexCount;
        Topology = topology;
        Bounds = bounds;
        MorphTargets = morphTargetArray;
    }

    /// <inheritdoc/>
    public SceneAssetId<MeshAssetTag> Id { get; }

    /// <summary>Interleaved vertex bytes.</summary>
    public ReadOnlyMemory<byte> Vertices { get; }

    /// <summary>Optional index bytes.</summary>
    public ReadOnlyMemory<byte> Indices { get; }

    /// <summary>Vertex attributes in declaration order.</summary>
    public IReadOnlyList<SceneVertexAttribute> Attributes { get; }

    /// <summary>Interleaved vertex stride in bytes.</summary>
    public int VertexStride { get; }

    /// <summary>Number of vertices.</summary>
    public int VertexCount { get; }

    /// <summary>Index payload width.</summary>
    public SceneIndexFormat IndexFormat { get; }

    /// <summary>Number of indices.</summary>
    public int IndexCount { get; }

    /// <summary>Primitive topology.</summary>
    public SceneMeshTopology Topology { get; }

    /// <summary>Optional local-space bounding sphere.</summary>
    public BoundingSphere3? Bounds { get; }

    /// <summary>Morph target delta streams in target order.</summary>
    public IReadOnlyList<SceneMorphTargetDefinition> MorphTargets { get; }
}
