namespace Axrone.AssetGltf;

/// <summary>Unparsed pipeline state.</summary>
public readonly struct StateUnparsed;

/// <summary>Schema-parsed pipeline state.</summary>
public readonly struct StateSchemaParsed;

/// <summary>Resource-resolved pipeline state.</summary>
public readonly struct StateResolved;

/// <summary>Importer options.</summary>
public sealed class GltfImporterOptions
{
    /// <summary>Document identity.</summary>
    public string Id
    {
        get => field;
        init => field = string.IsNullOrWhiteSpace(value) ? "asset.gltf" : value;
    } = "asset.gltf";

    /// <summary>Source document URI, when known.</summary>
    public string? SourceUri { get; init; }

    /// <summary>External resource resolver.</summary>
    public GltfResourceResolver? ResourceResolver { get; init; }

    /// <summary>PBR shader id.</summary>
    public string MaterialShaderId
    {
        get => field;
        init => field = string.IsNullOrWhiteSpace(value) ? "gltf/pbr" : value;
    } = "gltf/pbr";

    /// <summary>Alpha cutoff threshold.</summary>
    public float AlphaCutoffThreshold
    {
        get => field;
        init => field = Math.Clamp(value, 0.0f, 1.0f);
    } = 0.5f;

    /// <summary>Local light budget.</summary>
    public int MaxLocalLightsBudget
    {
        get => field;
        init => field = value < 1 ? 4 : value;
    } = 4;

    /// <summary>Texture transcode target.</summary>
    public GltfTextureFormat TranscodeTargetFormat
    {
        get => field;
        init => field = value;
    } = GltfTextureFormat.BC7_RGBA;

    /// <summary>
    /// Decodes embedded PNG images into RGBA8. Unknown encoded formats are retained as raw
    /// payloads with a diagnostic.
    /// </summary>
    public bool DecodeEncodedTextures { get; init; } = true;

    /// <summary>Resource limits for untrusted input.</summary>
    public GltfImportLimits Limits { get; init; } = GltfImportLimits.Default;
}

/// <summary>Typestate import pipeline container (transitions are extensions).</summary>
/// <typeparam name="TState">Pipeline state marker.</typeparam>
public sealed class GltfPipeline<TState>
{
    internal readonly ReadOnlyMemory<byte> SourceBytes;
    internal readonly string ContainerFormat;
    internal readonly ReadOnlyMemory<byte> JsonBytes;
    internal readonly ReadOnlyMemory<byte>? BinChunk;
    internal readonly GltfRawModel? RawModel;
    internal readonly GltfResourceRuntimeCache? ResourceRuntime;
    internal readonly List<GltfDiagnostic> Diagnostics;

    internal GltfPipeline(
        ReadOnlyMemory<byte> sourceBytes,
        string containerFormat,
        ReadOnlyMemory<byte> jsonBytes,
        ReadOnlyMemory<byte>? binChunk,
        GltfRawModel? rawModel,
        GltfResourceRuntimeCache? resourceRuntime,
        List<GltfDiagnostic> diagnostics)
    {
        SourceBytes = sourceBytes;
        ContainerFormat = containerFormat;
        JsonBytes = jsonBytes;
        BinChunk = binChunk;
        RawModel = rawModel;
        ResourceRuntime = resourceRuntime;
        Diagnostics = diagnostics;
    }

    /// <summary>Creates an unparsed pipeline.</summary>
    public static GltfPipeline<StateUnparsed> Create(ReadOnlyMemory<byte> sourceBytes)
    {
        return new GltfPipeline<StateUnparsed>(
            sourceBytes,
            "auto",
            ReadOnlyMemory<byte>.Empty,
            null,
            null,
            null,
            new List<GltfDiagnostic>());
    }
}

/// <summary>Pipeline stage transitions.</summary>
public static class GltfPipelineExtensions
{
    private static readonly HashSet<string> SupportedExtensions = new(StringComparer.Ordinal)
    {
        "EXT_meshopt_compression",
        "EXT_texture_avif",
        "EXT_texture_webp",
        "KHR_draco_mesh_compression",
        "KHR_lights_punctual",
        "KHR_materials_anisotropy",
        "KHR_materials_clearcoat",
        "KHR_materials_dispersion",
        "KHR_materials_emissive_strength",
        "KHR_materials_ior",
        "KHR_materials_iridescence",
        "KHR_materials_sheen",
        "KHR_materials_specular",
        "KHR_materials_transmission",
        "KHR_materials_unlit",
        "KHR_animation_pointer",
        "KHR_materials_variants",
        "KHR_materials_volume",
        "KHR_mesh_quantization",
        "KHR_texture_basisu",
        "KHR_texture_transform",
    };

    /// <summary>Splits the GLB container and parses the JSON schema.</summary>
    public static GltfPipeline<StateSchemaParsed> ParseSchema(this GltfPipeline<StateUnparsed> pipeline) =>
        pipeline.ParseSchema(GltfImportLimits.Default, default);

    /// <summary>Parses the container and JSON schema with explicit limits and cancellation.</summary>
    public static GltfPipeline<StateSchemaParsed> ParseSchema(
        this GltfPipeline<StateUnparsed> pipeline,
        GltfImportLimits limits,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(pipeline);
        ArgumentNullException.ThrowIfNull(limits);

        GltfContainerData container = GltfContainer.Parse(pipeline.SourceBytes);
        GltfRawModel rawModel = GltfJsonParser.Parse(container.JsonBytes.Span, limits, cancellationToken);
        try
        {
            ReadOnlySpan<byte> version = rawModel.GetStringBytes(rawModel.Version);
            if (version.Length < 3 || version[0] != (byte)'2' || version[1] != (byte)'.')
            {
                ThrowHelper.ThrowSchema(
                    $"Unsupported glTF version '{rawModel.GetString(rawModel.Version)}'. Only glTF 2.x is supported.");
            }

            return new GltfPipeline<StateSchemaParsed>(
                pipeline.SourceBytes,
                container.Format,
                container.JsonBytes,
                container.BinChunk,
                rawModel,
                null,
                pipeline.Diagnostics);
        }
        catch
        {
            rawModel.Dispose();
            throw;
        }
    }

    /// <summary>Validates extensions and attaches the resource runtime.</summary>
    public static GltfPipeline<StateResolved> ResolveResources(
        this GltfPipeline<StateSchemaParsed> pipeline,
        GltfResourceResolver? resolver)
    {
        ArgumentNullException.ThrowIfNull(pipeline);

        GltfRawModel rawModel = pipeline.RawModel!;
        try
        {
            foreach (string req in rawModel.ExtensionsRequired)
            {
                if (!SupportedExtensions.Contains(req))
                {
                    ThrowHelper.ThrowSchema($"Required glTF extension '{req}' is unsupported by the runtime engine.");
                }
            }

            foreach (string used in rawModel.ExtensionsUsed)
            {
                if (!SupportedExtensions.Contains(used))
                {
                    pipeline.Diagnostics.Add(new GltfDiagnostic(
                        GltfDiagnosticLevel.Warning,
                        "gltf.extension.unsupported",
                        $"Optional extension '{used}' is unhandled and will be bypassed."));
                }
            }
        }
        catch
        {
            rawModel.Dispose();
            throw;
        }

        var runtime = new GltfResourceRuntimeCache(pipeline.BinChunk, resolver);

        return new GltfPipeline<StateResolved>(
            pipeline.SourceBytes,
            pipeline.ContainerFormat,
            pipeline.JsonBytes,
            pipeline.BinChunk,
            rawModel,
            runtime,
            pipeline.Diagnostics);
    }
}
