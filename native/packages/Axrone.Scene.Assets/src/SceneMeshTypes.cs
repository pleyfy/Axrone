namespace Axrone.Scene.Assets;

/// <summary>Semantic meaning of one vertex attribute.</summary>
public enum SceneMeshSemantic : byte
{
    /// <summary>Object-space position.</summary>
    Position = 0,

    /// <summary>Object-space normal.</summary>
    Normal = 1,

    /// <summary>First texture coordinate set.</summary>
    Uv0 = 2,

    /// <summary>Second texture coordinate set.</summary>
    Uv1 = 3,

    /// <summary>Tangent frame.</summary>
    Tangent = 4,

    /// <summary>Vertex color.</summary>
    Color0 = 5,

    /// <summary>Skinning joint indices.</summary>
    Joints0 = 6,

    /// <summary>Skinning joint weights.</summary>
    Weights0 = 7,

    /// <summary>Second skinning joint index set.</summary>
    Joints1 = 8,

    /// <summary>Second skinning joint weight set.</summary>
    Weights1 = 9
}

/// <summary>Primitive topology of a mesh.</summary>
public enum SceneMeshTopology : byte
{
    /// <summary>Triangle list.</summary>
    Triangles = 0,

    /// <summary>Line list.</summary>
    Lines = 1,

    /// <summary>Point list.</summary>
    Points = 2
}

/// <summary>Index payload width.</summary>
public enum SceneIndexFormat : byte
{
    /// <summary>16-bit unsigned indices.</summary>
    UInt16 = 0,

    /// <summary>32-bit unsigned indices.</summary>
    UInt32 = 1
}

/// <summary>
/// One interleaved vertex attribute: semantic, component count and byte
/// placement. The layout is backend-agnostic; the renderer maps it to its own
/// vertex descriptor.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct SceneVertexAttribute
{
    /// <summary>Attribute semantic.</summary>
    public SceneMeshSemantic Semantic { get; }

    /// <summary>Number of components, 1 to 4.</summary>
    public byte ComponentCount { get; }

    /// <summary>Byte offset inside the vertex.</summary>
    public int Offset { get; }

    /// <summary>Vertex stride in bytes.</summary>
    public int Stride { get; }

    /// <summary>Whether fixed-point components are normalized.</summary>
    public bool Normalized { get; }

    /// <summary>Whether components are integer rather than float.</summary>
    public bool Integer { get; }

    /// <summary>Byte size of one component (1, 2 or 4).</summary>
    public byte ComponentSize { get; }

    /// <summary>Creates a validated vertex attribute.</summary>
    public SceneVertexAttribute(
        SceneMeshSemantic semantic,
        byte componentCount,
        int offset,
        int stride,
        bool normalized = false,
        bool integer = false,
        byte componentSize = 4)
    {
        if (componentCount is < 1 or > 4)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Vertex attribute '{semantic}' must have 1..4 components; received {componentCount}.");
        }

        if (componentSize is not (1 or 2 or 4 or 8))
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Vertex attribute '{semantic}' component size must be 1, 2, 4 or 8 bytes; received {componentSize}.");
        }

        if (offset < 0)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Vertex attribute '{semantic}' offset must not be negative.");
        }

        if (stride <= 0)
        {
            throw new SceneAssetException(
                SceneAssetErrorCodes.Invalid,
                $"Vertex attribute '{semantic}' stride must be positive.");
        }

        Semantic = semantic;
        ComponentCount = componentCount;
        Offset = offset;
        Stride = stride;
        Normalized = normalized;
        Integer = integer;
        ComponentSize = componentSize;
    }
}
