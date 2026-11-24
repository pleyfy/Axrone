namespace Axrone.Scene.Gltf;

/// <summary>
/// Preview subject vertex: position, normal, two UV sets and a handed tangent frame,
/// interleaved in the order the scene shaders bind them.
/// </summary>
/// <remarks>
/// The geometry vocabulary in <c>Axrone.Geometry</c> describes one texture coordinate stream,
/// so <see cref="LayoutDescriptors"/> covers position, normal, the primary UV set and the
/// tangent; the second UV set is carried by the scene mesh attribute layout, which is what the
/// upload path reads.
/// </remarks>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly struct MaterialPreviewVertex : IVertex<MaterialPreviewVertex>
{
    /// <summary>Byte offset of the position stream.</summary>
    public const int PositionByteOffset = 0;

    /// <summary>Byte offset of the normal stream.</summary>
    public const int NormalByteOffset = 12;

    /// <summary>Byte offset of the first texture coordinate stream.</summary>
    public const int Uv0ByteOffset = 24;

    /// <summary>Byte offset of the second texture coordinate stream.</summary>
    public const int Uv1ByteOffset = 32;

    /// <summary>Byte offset of the tangent stream.</summary>
    public const int TangentByteOffset = 40;

    /// <summary>Position attribute.</summary>
    public readonly Position3D Position;

    /// <summary>Normal attribute.</summary>
    public readonly Normal3D Normal;

    /// <summary>First texture coordinate set, sampled by authored material maps.</summary>
    public readonly TexCoord Uv0;

    /// <summary>Second texture coordinate set, sampled by lightmap-style binds.</summary>
    public readonly TexCoord Uv1;

    /// <summary>Tangent frame with handedness in W.</summary>
    public readonly Tangent4D Tangent;

    /// <summary>Creates a preview vertex.</summary>
    /// <param name="position">Position attribute.</param>
    /// <param name="normal">Normal attribute.</param>
    /// <param name="uv0">First UV set.</param>
    /// <param name="uv1">Second UV set.</param>
    /// <param name="tangent">Tangent frame.</param>
    public MaterialPreviewVertex(
        in Position3D position,
        in Normal3D normal,
        in TexCoord uv0,
        in TexCoord uv1,
        in Tangent4D tangent)
    {
        Position = position;
        Normal = normal;
        Uv0 = uv0;
        Uv1 = uv1;
        Tangent = tangent;
    }

    /// <inheritdoc/>
    public static int ByteStride => Unsafe.SizeOf<MaterialPreviewVertex>();

    Position3D IVertex<MaterialPreviewVertex>.Position => Position;

    Normal3D IVertex<MaterialPreviewVertex>.Normal => Normal;

    TexCoord IVertex<MaterialPreviewVertex>.UV => Uv0;

    Tangent4D IVertex<MaterialPreviewVertex>.Tangent => Tangent;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static MaterialPreviewVertex Create(
        in Position3D position,
        in Normal3D normal,
        in TexCoord uv,
        in Tangent4D tangent) =>
        new(position, normal, uv, uv, tangent);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public MaterialPreviewVertex WithNormal(in Normal3D normal) =>
        new(Position, normal, Uv0, Uv1, Tangent);

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public MaterialPreviewVertex WithTangent(in Tangent4D tangent) =>
        new(Position, Normal, Uv0, Uv1, tangent);

    /// <summary>Returns a copy with a replaced second UV set.</summary>
    /// <param name="uv1">Second UV set.</param>
    /// <returns>The copied vertex.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public MaterialPreviewVertex WithSecondUv(in TexCoord uv1) =>
        new(Position, Normal, Uv0, uv1, Tangent);

    /// <summary>Returns a copy with both UV sets replaced.</summary>
    /// <param name="uv0">First UV set.</param>
    /// <param name="uv1">Second UV set.</param>
    /// <returns>The copied vertex.</returns>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public MaterialPreviewVertex WithUvs(in TexCoord uv0, in TexCoord uv1) =>
        new(Position, Normal, uv0, uv1, Tangent);

    private static readonly VertexAttributeDescriptor[] Descriptors =
    [
        new(AttributeSemantic.Position, 3, GLAttributeType.Float, false, PositionByteOffset),
        new(AttributeSemantic.Normal, 3, GLAttributeType.Float, false, NormalByteOffset),
        new(AttributeSemantic.TexCoord, 2, GLAttributeType.Float, false, Uv0ByteOffset),
        new(AttributeSemantic.Tangent, 4, GLAttributeType.Float, false, TangentByteOffset)
    ];

    /// <inheritdoc/>
    public static ReadOnlySpan<VertexAttributeDescriptor> LayoutDescriptors => Descriptors;
}
