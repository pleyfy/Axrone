namespace Axrone.AssetGltf;

/// <summary>Resource limits applied before decoding untrusted glTF input.</summary>
public sealed class GltfImportLimits
{
    /// <summary>Default limits for typical editor and runtime imports.</summary>
    public static GltfImportLimits Default { get; } = new();

    /// <summary>Maximum source payload size in bytes.</summary>
    public int MaxSourceBytes { get; init; } = 256 * 1024 * 1024;

    /// <summary>Maximum sum of declared buffer byte lengths.</summary>
    public long MaxBufferBytes { get; init; } = 2L * 1024 * 1024 * 1024;

    /// <summary>Maximum number of accessors.</summary>
    public int MaxAccessorCount { get; init; } = 16_777_216;

    /// <summary>Maximum number of nodes.</summary>
    public int MaxNodeCount { get; init; } = 1_000_000;

    /// <summary>Maximum number of meshes.</summary>
    public int MaxMeshCount { get; init; } = 1_000_000;

    /// <summary>Maximum number of primitives across all meshes.</summary>
    public int MaxPrimitiveCount { get; init; } = 16_777_216;

    /// <summary>Maximum number of vertex attribute entries across all maps.</summary>
    public int MaxAttributeCount { get; init; } = 16_777_216;

    /// <summary>Maximum number of morph target entries.</summary>
    public int MaxMorphTargetCount { get; init; } = 16_777_216;

    /// <summary>Maximum number of primitive material-variant mappings.</summary>
    public int MaxMaterialVariantCount { get; init; } = 1_000_000;

    /// <summary>Maximum transient parse storage (slabs, pools, and the string arena).</summary>
    public long MaxParseBytes { get; init; } = 256L * 1024 * 1024;

    /// <summary>Maximum number of textures.</summary>
    public int MaxTextureCount { get; init; } = 65_536;

    /// <summary>Maximum estimated decoded bytes across accessors and interleaved mesh output.</summary>
    public long MaxDecodedBytes { get; init; } = 2L * 1024 * 1024 * 1024;

    /// <summary>Maximum decoded raster and transcoded texture bytes retained by one import.</summary>
    public long MaxTextureBytes { get; init; } = 512L * 1024 * 1024;
}

/// <summary>Preflight limit validation for untrusted glTF documents.</summary>
internal static class GltfLimitsValidator
{
    /// <summary>Validates document counts and estimated decode budgets.</summary>
    public static void Validate(int sourceLength, GltfRawModel model, GltfImportLimits limits)
    {
        if (sourceLength > limits.MaxSourceBytes)
        {
            ThrowHelper.ThrowLimit("MaxSourceBytes", sourceLength, limits.MaxSourceBytes);
        }

        if (model.AccessorCount > limits.MaxAccessorCount)
        {
            ThrowHelper.ThrowLimit("MaxAccessorCount", model.AccessorCount, limits.MaxAccessorCount);
        }

        if (model.NodeCount > limits.MaxNodeCount)
        {
            ThrowHelper.ThrowLimit("MaxNodeCount", model.NodeCount, limits.MaxNodeCount);
        }

        if (model.MeshCount > limits.MaxMeshCount)
        {
            ThrowHelper.ThrowLimit("MaxMeshCount", model.MeshCount, limits.MaxMeshCount);
        }

        if (model.Textures.Count > limits.MaxTextureCount)
        {
            ThrowHelper.ThrowLimit("MaxTextureCount", model.Textures.Count, limits.MaxTextureCount);
        }

        long bufferBytes = 0;
        for (int i = 0; i < model.Buffers.Count; i++)
        {
            int byteLength = model.Buffers[i].ByteLength;
            if (byteLength > 0)
            {
                bufferBytes = AddChecked("MaxBufferBytes", bufferBytes, byteLength, limits.MaxBufferBytes);
            }
        }

        long decodedBytes = 0;
        for (int i = 0; i < model.AccessorCount; i++)
        {
            GltfRawModel.Accessor accessor = model.Accessors[i];
            long bytes = (long)accessor.Count * GltfAccessorRuntime.GetTypeElementCount(accessor.Type) * 4;
            if (accessor.Sparse.HasSparse)
            {
                bytes += (long)accessor.Sparse.Count * GltfAccessorRuntime.GetTypeElementCount(accessor.Type) * 4;
            }

            decodedBytes = AddChecked("MaxDecodedBytes", decodedBytes, bytes, limits.MaxDecodedBytes);
        }

        // Meshopt views decompress into transient parse storage before any
        // accessor reads them; an oversized view would otherwise allocate past
        // every decoded-byte budget because accessors may cover only a slice.
        long parseBytes = 0;
        for (int i = 0; i < model.BufferViews.Count; i++)
        {
            GltfRawModel.BufferView view = model.BufferViews[i];
            if (view.Meshopt is null)
            {
                continue;
            }

            if (view.Meshopt.Count < 0 || view.Meshopt.ByteStride <= 0)
            {
                ThrowHelper.ThrowSchema($"BufferView {i} has an invalid meshopt element layout.");
            }

            long decompressed = (long)view.Meshopt.Count * view.Meshopt.ByteStride;
            parseBytes = AddChecked("MaxParseBytes", parseBytes, decompressed, limits.MaxParseBytes);
        }

        for (int i = 0; i < model.MeshCount; i++)
        {
            GltfRawModel.Mesh mesh = model.Meshes[i];
            for (int p = 0; p < mesh.Primitives.Length; p++)
            {
                GltfRawModel.Primitive primitive = model.GetPrimitive(mesh, p);
                int vertexCount = 0;
                long stride = 0;
                GltfAttributeMap attributeMap = model.GetAttributes(primitive);
                for (int a = 0; a < attributeMap.Count; a++)
                {
                    int attributeAccessor = attributeMap[a].Accessor;
                    if ((uint)attributeAccessor >= (uint)model.AccessorCount)
                    {
                        continue;
                    }

                    GltfRawModel.Accessor accessor = model.GetAccessor(attributeAccessor);
                    vertexCount = Math.Max(vertexCount, accessor.Count);
                    stride += GltfAccessorRuntime.GetTypeElementCount(accessor.Type) * 4;
                }

                decodedBytes = AddChecked(
                    "MaxDecodedBytes",
                    decodedBytes,
                    (long)vertexCount * stride,
                    limits.MaxDecodedBytes);

                if (primitive.HasIndices &&
                    (uint)primitive.Indices < (uint)model.AccessorCount)
                {
                    decodedBytes = AddChecked(
                        "MaxDecodedBytes",
                        decodedBytes,
                        (long)model.GetAccessor(primitive.Indices).Count * 4,
                        limits.MaxDecodedBytes);
                }

                int targetCount = GltfRawModel.GetMorphTargetCount(primitive);
                for (int t = 0; t < targetCount; t++)
                {
                    GltfAttributeMap targetMap = model.GetAttributes(model.GetMorphTarget(primitive, t));
                    for (int a = 0; a < targetMap.Count; a++)
                    {
                        int targetAccessor = targetMap[a].Accessor;
                        if ((uint)targetAccessor >= (uint)model.AccessorCount)
                        {
                            continue;
                        }

                        GltfRawModel.Accessor accessor = model.GetAccessor(targetAccessor);
                        decodedBytes = AddChecked(
                            "MaxDecodedBytes",
                            decodedBytes,
                            (long)accessor.Count * GltfAccessorRuntime.GetTypeElementCount(accessor.Type) * 4,
                            limits.MaxDecodedBytes);
                    }
                }
            }
        }
    }

    private static long AddChecked(string limit, long current, long addition, long maximum)
    {
        if (addition > 0 && current > long.MaxValue - addition)
        {
            ThrowHelper.ThrowLimit(limit, long.MaxValue, maximum);
        }

        long next = current + addition;
        if (next > maximum)
        {
            ThrowHelper.ThrowLimit(limit, next, maximum);
        }

        return next;
    }
}
