namespace Axrone.Asset2D;

/// <summary>Zero-allocation import input: path plus content.</summary>
public readonly ref struct AssetImportContext
{
    /// <summary>Source path.</summary>
    public ReadOnlySpan<char> Path { get; }

    /// <summary>Source content.</summary>
    public ReadOnlySpan<byte> Content { get; }

    /// <summary>Creates a context.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public AssetImportContext(ReadOnlySpan<char> path, ReadOnlySpan<byte> content)
    {
        Path = path;
        Content = content;
    }
}

/// <summary>Visitor over the import result union.</summary>
public interface IImportResultVisitor<TCoordPolicy, out T>
    where TCoordPolicy : struct, ICoordinatePolicy
{
    /// <summary>Visits a successful atlas.</summary>
    T OnAtlas(SpriteAtlas<TCoordPolicy> atlas);

    /// <summary>Visits a failure.</summary>
    T OnFailure(string message);
}

/// <summary>
/// Zero-allocation discriminated union representing polymorphic outcome of an asset import operation.
/// </summary>
/// <typeparam name="TCoordPolicy">UV coordinate policy.</typeparam>
[StructLayout(LayoutKind.Sequential)]
public readonly struct Asset2DImportResult<TCoordPolicy>
    where TCoordPolicy : struct, ICoordinatePolicy
{
    /// <summary>Result discriminant.</summary>
    public enum ResultKind : byte
    {
        /// <summary>Import failed.</summary>
        Failure = 0,

        /// <summary>Atlas imported.</summary>
        Atlas = 1,
    }

    /// <summary>Discriminant.</summary>
    public ResultKind Kind { get; }

    /// <summary>Imported atlas.</summary>
    public SpriteAtlas<TCoordPolicy>? Atlas { get; }

    /// <summary>Failure message.</summary>
    public string? ErrorMessage { get; }

    /// <summary>Stable machine code for the failure; null on success or legacy message-only failures.</summary>
    public string? ErrorCode { get; }

    /// <summary>Whether the import succeeded.</summary>
    [MemberNotNullWhen(true, nameof(Atlas))]
    public bool IsSuccess => Kind == ResultKind.Atlas && Atlas is not null;

    private Asset2DImportResult(
        ResultKind kind,
        SpriteAtlas<TCoordPolicy>? atlas,
        string? errorMessage,
        string? errorCode)
    {
        Kind = kind;
        Atlas = atlas;
        ErrorMessage = errorMessage;
        ErrorCode = errorCode;
    }

    /// <summary>Creates a success.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Asset2DImportResult<TCoordPolicy> Success(SpriteAtlas<TCoordPolicy> atlas) =>
        new(ResultKind.Atlas, atlas, null, null);

    /// <summary>Creates a failure with an optional stable machine code.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Asset2DImportResult<TCoordPolicy> Failure(string message, string? errorCode = null) =>
        new(ResultKind.Failure, null, message, errorCode);

    /// <summary>Dispatches on the discriminant.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public T Match<T, TVisitor>(ref TVisitor visitor)
        where TVisitor : struct, IImportResultVisitor<TCoordPolicy, T>, allows ref struct
    {
        return Kind switch
        {
            ResultKind.Atlas when Atlas is not null => visitor.OnAtlas(Atlas),
            ResultKind.Failure => visitor.OnFailure(ErrorMessage ?? "Unknown failure"),
            _ => throw new InvalidOperationException($"Invalid discriminated union kind for {typeof(T).FullName}."),
        };
    }
}

/// <summary>What one importer probe concluded about a source.</summary>
public enum Asset2DProbeVerdict : byte
{
    /// <summary>The source belongs to a different format; the importer declines it.</summary>
    NotMine = 0,

    /// <summary>The source is this format and structurally readable.</summary>
    Mine = 1,

    /// <summary>The source is this format but broken; the coded reason is carried.</summary>
    MineButUnreadable = 2,
}

/// <summary>
/// Coded probe outcome. Only <see cref="Asset2DProbeVerdict.NotMine"/> may collapse into a
/// "not my format" answer; a broken document keeps its reason so the chain can report it.
/// </summary>
/// <param name="Verdict">Probe conclusion.</param>
/// <param name="ErrorCode">Stable machine code, when the verdict carries a failure.</param>
/// <param name="Reason">Human-readable detail, when the verdict carries a failure.</param>
public readonly record struct Asset2DProbe(Asset2DProbeVerdict Verdict, string? ErrorCode, string? Reason)
{
    /// <summary>The importer declines the source.</summary>
    public static Asset2DProbe Decline() => new(Asset2DProbeVerdict.NotMine, null, null);

    /// <summary>The importer recognises a readable source.</summary>
    public static Asset2DProbe Accept() => new(Asset2DProbeVerdict.Mine, null, null);

    /// <summary>The importer recognises the source but cannot parse it.</summary>
    public static Asset2DProbe Unreadable(string errorCode, string reason) =>
        new(Asset2DProbeVerdict.MineButUnreadable, errorCode, reason);
}

/// <summary>Shared probe helpers for the JSON atlas importers.</summary>
internal static class Asset2DProbeHelper
{
    /// <summary>Stable code for a JSON document that is recognised as ours but cannot be read.</summary>
    public const string MalformedJson = "asset2d.atlas.json.malformed";

    /// <summary>Stable code for a failure raised while importing a recognised source.</summary>
    public const string ImportFailed = "asset2d.atlas.import.failed";

    /// <summary>Stable code for a source every importer in the chain declined.</summary>
    public const string NoImporter = "asset2d.importer.not-found";

    /// <summary>Stable code for a canonical atlas without a textureSize section.</summary>
    public const string TextureSizeMissing = "asset2d.atlas.textureSize.missing";

    /// <summary>Stable code for a canonical atlas without any frame.</summary>
    public const string FramesEmpty = "asset2d.atlas.frames.empty";

    /// <summary>Stable code for a TexturePacker atlas without frames or a meta size.</summary>
    public const string PackedSectionsMissing = "asset2d.atlas.texturepacker.sections.missing";

    /// <summary>Whether the payload opens as a JSON object or array (after BOM and whitespace).</summary>
    public static bool StartsAsJson(ReadOnlySpan<byte> content)
    {
        int index = 0;
        if (content.Length >= 3 && content[0] == 0xEF && content[1] == 0xBB && content[2] == 0xBF)
        {
            index = 3;
        }

        while (index < content.Length && content[index] is (byte)' ' or (byte)'\t' or (byte)'\r' or (byte)'\n')
        {
            index++;
        }

        return index < content.Length && content[index] is (byte)'{' or (byte)'[';
    }
}

/// <summary>Importer policy contract: probe, then import.</summary>
public interface IAssetImporterPolicy<TCoordPolicy>
    where TCoordPolicy : struct, ICoordinatePolicy
{
    /// <summary>Importer identity.</summary>
    static abstract string ImporterId { get; }

    /// <summary>Priority; higher wins.</summary>
    static abstract int Priority { get; }

    /// <summary>Whether this importer accepts the source.</summary>
    static abstract bool CanImport(in AssetImportContext context);

    /// <summary>Probes the source and keeps the coded reason when the source is ours but broken.</summary>
    static abstract Asset2DProbe Probe(in AssetImportContext context);

    /// <summary>Imports the source.</summary>
    static abstract Asset2DImportResult<TCoordPolicy> Import(in AssetImportContext context);
}

/// <summary>
/// Monomorphized zero-vtable importer chain dispatcher.
/// </summary>
public readonly struct ImporterChain<TPrimary, TSecondary, TCoordPolicy>
    where TPrimary : struct, IAssetImporterPolicy<TCoordPolicy>
    where TSecondary : struct, IAssetImporterPolicy<TCoordPolicy>
    where TCoordPolicy : struct, ICoordinatePolicy
{
    /// <summary>Runs the chain: primary first, then secondary.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static Asset2DImportResult<TCoordPolicy> Import(in AssetImportContext context)
    {
        Asset2DProbe primary = TPrimary.Probe(in context);
        if (primary.Verdict == Asset2DProbeVerdict.Mine)
        {
            return TPrimary.Import(in context);
        }

        Asset2DProbe secondary = TSecondary.Probe(in context);
        if (secondary.Verdict == Asset2DProbeVerdict.Mine)
        {
            return TSecondary.Import(in context);
        }

        Asset2DProbe cause = primary.Verdict == Asset2DProbeVerdict.MineButUnreadable
            ? primary
            : secondary.Verdict == Asset2DProbeVerdict.MineButUnreadable
                ? secondary
                : default;

        if (cause.Verdict == Asset2DProbeVerdict.MineButUnreadable)
        {
            return Asset2DImportResult<TCoordPolicy>.Failure(
                $"No importer could read the asset at '{context.Path.ToString()}': {cause.Reason}",
                cause.ErrorCode);
        }

        return Asset2DImportResult<TCoordPolicy>.Failure(
            $"No registered importer could process asset at: '{context.Path.ToString()}'",
            Asset2DProbeHelper.NoImporter);
    }
}

/// <summary>
/// High-performance Utf8JsonReader canonical sprite atlas importer (Native AOT Safe, zero dynamic reflection).
/// </summary>
public readonly struct SpriteAtlasJsonImporter<TCoordPolicy> : IAssetImporterPolicy<TCoordPolicy>
    where TCoordPolicy : struct, ICoordinatePolicy
{
    /// <inheritdoc/>
    public static string ImporterId => "asset-2d.sprite-atlas.json";

    /// <inheritdoc/>
    public static int Priority => 20;

    /// <inheritdoc/>
    public static bool CanImport(in AssetImportContext context) =>
        Probe(in context).Verdict != Asset2DProbeVerdict.NotMine;

    /// <inheritdoc/>
    public static Asset2DProbe Probe(in AssetImportContext context)
    {
        ReadOnlySpan<byte> content = context.Content;
        if (!Asset2DProbeHelper.StartsAsJson(content))
        {
            return Asset2DProbe.Decline();
        }

        try
        {
            return IsCanonicalJsonPayload(content) ? Asset2DProbe.Accept() : Asset2DProbe.Decline();
        }
        catch (JsonException exception)
        {
            string position = exception.Path is { Length: > 0 } path
                ? $" at path '{path}'"
                : string.Empty;
            return Asset2DProbe.Unreadable(
                Asset2DProbeHelper.MalformedJson,
                $"Canonical atlas JSON is malformed{position}: {exception.Message}");
        }
    }

    /// <inheritdoc/>
    public static Asset2DImportResult<TCoordPolicy> Import(in AssetImportContext context)
    {
        try
        {
            string? atlasId = null;
            string? textureId = null;
            Size2D? textureSize = null;
            var framesList = new List<SpriteFrameDefinition>(32);
            var animationsList = new List<SpriteClipDefinition>(8);

            var reader = new Utf8JsonReader(context.Content);

            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.PropertyName)
                {
                    if (reader.ValueTextEquals("id"u8))
                    {
                        reader.Read();
                        atlasId = reader.GetString();
                    }
                    else if (reader.ValueTextEquals("textureId"u8))
                    {
                        reader.Read();
                        textureId = reader.GetString();
                    }
                    else if (reader.ValueTextEquals("textureSize"u8))
                    {
                        reader.Read();
                        float w = 0f;
                        float h = 0f;
                        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                        {
                            if (reader.TokenType == JsonTokenType.PropertyName)
                            {
                                if (reader.ValueTextEquals("width"u8) || reader.ValueTextEquals("w"u8))
                                {
                                    reader.Read();
                                    w = reader.GetSingle();
                                }
                                else if (reader.ValueTextEquals("height"u8) || reader.ValueTextEquals("h"u8))
                                {
                                    reader.Read();
                                    h = reader.GetSingle();
                                }
                                else
                                {
                                    reader.Skip();
                                }
                            }
                        }

                        textureSize = new Size2D(w, h);
                    }
                    else if (reader.ValueTextEquals("frames"u8))
                    {
                        reader.Read();
                        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                        {
                            if (reader.TokenType == JsonTokenType.StartObject)
                            {
                                framesList.Add(ParseFrame(ref reader));
                            }
                        }
                    }
                    else if (reader.ValueTextEquals("animations"u8))
                    {
                        reader.Read();
                        while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                        {
                            if (reader.TokenType == JsonTokenType.StartObject)
                            {
                                animationsList.Add(ParseClip(ref reader));
                            }
                        }
                    }
                }
            }

            atlasId ??= new string(SpriteAtlasUtil.DeriveAtlasId(context.Path));
            textureId ??= $"{atlasId}.png";

            if (!textureSize.HasValue)
            {
                return Asset2DImportResult<TCoordPolicy>.Failure(
                    "Missing textureSize section in JSON.",
                    Asset2DProbeHelper.TextureSizeMissing);
            }

            AtlasBuilder<AtlasBuildStage.Configured, TCoordPolicy> configured = AtlasBuilder.Create<TCoordPolicy>()
                .WithIdentity(new AtlasId(atlasId), new TextureId(textureId), textureSize.Value);

            if (framesList.Count == 0)
            {
                return Asset2DImportResult<TCoordPolicy>.Failure(
                    "Atlas contains no frames.",
                    Asset2DProbeHelper.FramesEmpty);
            }

            Span<SpriteFrameDefinition> framesSpan = CollectionsMarshal.AsSpan(framesList);
            AtlasBuilder<AtlasBuildStage.FramesDefined, TCoordPolicy> builder = configured.AddFrame(in framesSpan[0]);
            for (int i = 1; i < framesSpan.Length; i++)
            {
                builder = builder.AddFrame(in framesSpan[i]);
            }

            Span<SpriteClipDefinition> animSpan = CollectionsMarshal.AsSpan(animationsList);
            for (int i = 0; i < animSpan.Length; i++)
            {
                builder = builder.AddAnimation(in animSpan[i]);
            }

            return Asset2DImportResult<TCoordPolicy>.Success(builder.Build());
        }
        catch (Asset2DException exception)
        {
            return Asset2DImportResult<TCoordPolicy>.Failure(
                $"{ImporterId} rejected '{context.Path.ToString()}': {exception.Message}",
                exception.Code);
        }
        catch (Exception exception) when (
            exception is JsonException or NotSupportedException or FormatException or InvalidOperationException)
        {
            return Asset2DImportResult<TCoordPolicy>.Failure(
                $"{ImporterId} could not read '{context.Path.ToString()}': {exception.Message}",
                Asset2DProbeHelper.ImportFailed);
        }
    }

    private static SpriteFrameDefinition ParseFrame(ref Utf8JsonReader reader)
    {
        string frameId = string.Empty;
        Rect2D region = Rect2D.Zero;
        Size2D? sourceSize = null;
        Vec2? pivot = null;
        Border2D? sliceBorder = null;
        Milliseconds? duration = null;
        bool rotated = false;
        Vec2? trimOffset = null;

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("id"u8))
                {
                    reader.Read();
                    frameId = reader.GetString() ?? string.Empty;
                }
                else if (reader.ValueTextEquals("region"u8))
                {
                    reader.Read();
                    region = ParseRect(ref reader);
                }
                else if (reader.ValueTextEquals("sourceSize"u8))
                {
                    reader.Read();
                    sourceSize = ParseSize(ref reader);
                }
                else if (reader.ValueTextEquals("pivot"u8))
                {
                    reader.Read();
                    pivot = ParseVec2(ref reader);
                }
                else if (reader.ValueTextEquals("sliceBorder"u8))
                {
                    reader.Read();
                    sliceBorder = ParseBorder(ref reader);
                }
                else if (reader.ValueTextEquals("durationMs"u8) || reader.ValueTextEquals("duration"u8))
                {
                    reader.Read();
                    duration = new Milliseconds(reader.GetSingle());
                }
                else if (reader.ValueTextEquals("rotated"u8))
                {
                    reader.Read();
                    rotated = reader.GetBoolean();
                }
                else if (reader.ValueTextEquals("trimOffset"u8))
                {
                    reader.Read();
                    trimOffset = ParseVec2(ref reader);
                }
                else
                {
                    reader.Skip();
                }
            }
        }

        return new SpriteFrameDefinition
        {
            Id = new FrameId(frameId),
            Region = region,
            SourceSize = sourceSize,
            Pivot = pivot,
            SliceBorder = sliceBorder,
            Duration = duration,
            Rotated = rotated,
            TrimOffset = trimOffset,
        };
    }

    private static SpriteClipDefinition ParseClip(ref Utf8JsonReader reader)
    {
        string clipId = string.Empty;
        ImmutableArray<SpriteClipRefDefinition>.Builder frameRefs = ImmutableArray.CreateBuilder<SpriteClipRefDefinition>();
        float? fps = null;
        bool? loop = null;

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("id"u8))
                {
                    reader.Read();
                    clipId = reader.GetString() ?? string.Empty;
                }
                else if (reader.ValueTextEquals("fps"u8))
                {
                    reader.Read();
                    fps = reader.GetSingle();
                }
                else if (reader.ValueTextEquals("loop"u8))
                {
                    reader.Read();
                    loop = reader.GetBoolean();
                }
                else if (reader.ValueTextEquals("frames"u8))
                {
                    reader.Read();
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                    {
                        if (reader.TokenType == JsonTokenType.String)
                        {
                            frameRefs.Add(new SpriteClipRefDefinition(new FrameId(reader.GetString() ?? string.Empty)));
                        }
                        else if (reader.TokenType == JsonTokenType.StartObject)
                        {
                            string refId = string.Empty;
                            Milliseconds? dur = null;
                            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                            {
                                if (reader.TokenType == JsonTokenType.PropertyName)
                                {
                                    if (reader.ValueTextEquals("frameId"u8))
                                    {
                                        reader.Read();
                                        refId = reader.GetString() ?? string.Empty;
                                    }
                                    else if (reader.ValueTextEquals("durationMs"u8) || reader.ValueTextEquals("duration"u8))
                                    {
                                        reader.Read();
                                        dur = new Milliseconds(reader.GetSingle());
                                    }
                                    else
                                    {
                                        reader.Skip();
                                    }
                                }
                            }

                            frameRefs.Add(new SpriteClipRefDefinition(new FrameId(refId), dur));
                        }
                    }
                }
                else
                {
                    reader.Skip();
                }
            }
        }

        return new SpriteClipDefinition
        {
            Id = new ClipId(clipId),
            Frames = frameRefs.ToImmutable(),
            Fps = fps,
            Loop = loop,
        };
    }

    private static Rect2D ParseRect(ref Utf8JsonReader reader)
    {
        float x = 0f;
        float y = 0f;
        float w = 0f;
        float h = 0f;
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("x"u8)) { reader.Read(); x = reader.GetSingle(); }
                else if (reader.ValueTextEquals("y"u8)) { reader.Read(); y = reader.GetSingle(); }
                else if (reader.ValueTextEquals("width"u8) || reader.ValueTextEquals("w"u8)) { reader.Read(); w = reader.GetSingle(); }
                else if (reader.ValueTextEquals("height"u8) || reader.ValueTextEquals("h"u8)) { reader.Read(); h = reader.GetSingle(); }
                else
                {
                    reader.Skip();
                }
            }
        }

        return new Rect2D(x, y, w, h);
    }

    private static Size2D ParseSize(ref Utf8JsonReader reader)
    {
        float w = 0f;
        float h = 0f;
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("width"u8) || reader.ValueTextEquals("w"u8)) { reader.Read(); w = reader.GetSingle(); }
                else if (reader.ValueTextEquals("height"u8) || reader.ValueTextEquals("h"u8)) { reader.Read(); h = reader.GetSingle(); }
                else
                {
                    reader.Skip();
                }
            }
        }

        return new Size2D(w, h);
    }

    private static Vec2 ParseVec2(ref Utf8JsonReader reader)
    {
        float x = 0f;
        float y = 0f;
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("x"u8)) { reader.Read(); x = reader.GetSingle(); }
                else if (reader.ValueTextEquals("y"u8)) { reader.Read(); y = reader.GetSingle(); }
                else
                {
                    reader.Skip();
                }
            }
        }

        return new Vec2(x, y);
    }

    private static Border2D ParseBorder(ref Utf8JsonReader reader)
    {
        float l = 0f;
        float r = 0f;
        float t = 0f;
        float b = 0f;
        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("left"u8) || reader.ValueTextEquals("l"u8)) { reader.Read(); l = reader.GetSingle(); }
                else if (reader.ValueTextEquals("right"u8) || reader.ValueTextEquals("r"u8)) { reader.Read(); r = reader.GetSingle(); }
                else if (reader.ValueTextEquals("top"u8) || reader.ValueTextEquals("t"u8)) { reader.Read(); t = reader.GetSingle(); }
                else if (reader.ValueTextEquals("bottom"u8) || reader.ValueTextEquals("b"u8)) { reader.Read(); b = reader.GetSingle(); }
                else
                {
                    reader.Skip();
                }
            }
        }

        return new Border2D(l, r, t, b);
    }

    private static bool IsCanonicalJsonPayload(ReadOnlySpan<byte> utf8)
    {
        var reader = new Utf8JsonReader(utf8);
        bool hasId = false;
        bool hasTextureId = false;
        bool hasFrames = false;
        bool hasWidth = false;
        bool hasHeight = false;
        bool inTextureSize = false;
        int depth = 0;

        while (reader.Read())
        {
            switch (reader.TokenType)
            {
                case JsonTokenType.StartObject:
                case JsonTokenType.StartArray:
                    depth++;
                    break;
                case JsonTokenType.EndObject:
                    depth--;
                    if (depth == 1)
                    {
                        inTextureSize = false;
                    }

                    break;
                case JsonTokenType.EndArray:
                    depth--;
                    break;
                case JsonTokenType.PropertyName:
                    if (depth != 1 && !inTextureSize)
                    {
                        break;
                    }

                    if (!inTextureSize)
                    {
                        if (reader.ValueTextEquals("id"u8))
                        {
                            reader.Read();
                            hasId = reader.TokenType == JsonTokenType.String;
                        }
                        else if (reader.ValueTextEquals("textureId"u8))
                        {
                            reader.Read();
                            hasTextureId = reader.TokenType == JsonTokenType.String;
                        }
                        else if (reader.ValueTextEquals("textureSize"u8))
                        {
                            reader.Read();
                            if (reader.TokenType == JsonTokenType.StartObject)
                            {
                                depth++;
                                inTextureSize = true;
                            }
                        }
                        else if (reader.ValueTextEquals("frames"u8))
                        {
                            reader.Read();
                            hasFrames = reader.TokenType == JsonTokenType.StartArray;
                        }
                    }
                    else if (depth == 2)
                    {
                        if (reader.ValueTextEquals("width"u8))
                        {
                            reader.Read();
                            hasWidth = reader.TokenType == JsonTokenType.Number;
                        }
                        else if (reader.ValueTextEquals("height"u8))
                        {
                            reader.Read();
                            hasHeight = reader.TokenType == JsonTokenType.Number;
                        }
                    }

                    break;
                default:
                    break;
            }

            if (hasId && hasTextureId && hasFrames && hasWidth && hasHeight)
            {
                return true;
            }
        }

        return false;
    }
}

/// <summary>
/// High-performance TexturePacker format JSON importer (zero DTO allocations, Native AOT safe).
/// </summary>
public readonly struct TexturePackerSpriteAtlasImporter<TCoordPolicy> : IAssetImporterPolicy<TCoordPolicy>
    where TCoordPolicy : struct, ICoordinatePolicy
{
    /// <inheritdoc/>
    public static string ImporterId => "asset-2d.sprite-atlas.texturepacker";

    /// <inheritdoc/>
    public static int Priority => 10;

    /// <inheritdoc/>
    public static bool CanImport(in AssetImportContext context) =>
        Probe(in context).Verdict != Asset2DProbeVerdict.NotMine;

    /// <inheritdoc/>
    public static Asset2DProbe Probe(in AssetImportContext context)
    {
        ReadOnlySpan<byte> content = context.Content;
        if (!Asset2DProbeHelper.StartsAsJson(content))
        {
            return Asset2DProbe.Decline();
        }

        try
        {
            return IsTexturePackerJson(content) ? Asset2DProbe.Accept() : Asset2DProbe.Decline();
        }
        catch (JsonException exception)
        {
            string position = exception.Path is { Length: > 0 } path
                ? $" at path '{path}'"
                : string.Empty;
            return Asset2DProbe.Unreadable(
                Asset2DProbeHelper.MalformedJson,
                $"TexturePacker atlas JSON is malformed{position}: {exception.Message}");
        }
    }

    /// <inheritdoc/>
    public static Asset2DImportResult<TCoordPolicy> Import(in AssetImportContext context)
    {
        try
        {
            var frameList = new List<SpriteFrameDefinition>(64);
            string? metaImage = null;
            Size2D? metaSize = null;

            var frameTags = new List<(string Name, int From, int To, string Direction)>(4);
            var reader = new Utf8JsonReader(context.Content);

            while (reader.Read())
            {
                if (reader.TokenType == JsonTokenType.PropertyName)
                {
                    if (reader.ValueTextEquals("frames"u8))
                    {
                        reader.Read();
                        if (reader.TokenType == JsonTokenType.StartObject)
                        {
                            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                            {
                                if (reader.TokenType == JsonTokenType.PropertyName)
                                {
                                    string frameKey = reader.GetString()!;
                                    reader.Read();
                                    frameList.Add(ParseTexturePackerFrame(ref reader, frameKey));
                                }
                            }
                        }
                    }
                    else if (reader.ValueTextEquals("meta"u8))
                    {
                        reader.Read();
                        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                        {
                            if (reader.TokenType == JsonTokenType.PropertyName)
                            {
                                if (reader.ValueTextEquals("image"u8))
                                {
                                    reader.Read();
                                    metaImage = reader.GetString();
                                }
                                else if (reader.ValueTextEquals("size"u8))
                                {
                                    reader.Read();
                                    float w = 0f;
                                    float h = 0f;
                                    while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                                    {
                                        if (reader.TokenType == JsonTokenType.PropertyName)
                                        {
                                            if (reader.ValueTextEquals("w"u8)) { reader.Read(); w = reader.GetSingle(); }
                                            else if (reader.ValueTextEquals("h"u8)) { reader.Read(); h = reader.GetSingle(); }
                                            else
                                            {
                                                reader.Skip();
                                            }
                                        }
                                    }

                                    metaSize = new Size2D(w, h);
                                }
                                else if (reader.ValueTextEquals("frameTags"u8))
                                {
                                    reader.Read();
                                    while (reader.Read() && reader.TokenType != JsonTokenType.EndArray)
                                    {
                                        if (reader.TokenType == JsonTokenType.StartObject)
                                        {
                                            string name = string.Empty;
                                            int from = 0;
                                            int to = 0;
                                            string dir = "forward";
                                            while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                                            {
                                                if (reader.TokenType == JsonTokenType.PropertyName)
                                                {
                                                    if (reader.ValueTextEquals("name"u8)) { reader.Read(); name = reader.GetString() ?? string.Empty; }
                                                    else if (reader.ValueTextEquals("from"u8)) { reader.Read(); from = reader.GetInt32(); }
                                                    else if (reader.ValueTextEquals("to"u8)) { reader.Read(); to = reader.GetInt32(); }
                                                    else if (reader.ValueTextEquals("direction"u8)) { reader.Read(); dir = reader.GetString() ?? "forward"; }
                                                    else
                                                    {
                                                        reader.Skip();
                                                    }
                                                }
                                            }

                                            frameTags.Add((name, from, to, dir));
                                        }
                                    }
                                }
                                else
                                {
                                    reader.Skip();
                                }
                            }
                        }
                    }
                }
            }

            if (frameList.Count == 0 || !metaSize.HasValue)
            {
                return Asset2DImportResult<TCoordPolicy>.Failure(
                    "TexturePacker JSON missing required 'frames' or 'meta' root sections.",
                    Asset2DProbeHelper.PackedSectionsMissing);
            }

            string atlasId = context.Path.IsEmpty
                ? (!string.IsNullOrWhiteSpace(metaImage) ? metaImage.Trim() : "sprite-atlas")
                : new string(SpriteAtlasUtil.DeriveAtlasId(context.Path));
            string textureId = !string.IsNullOrWhiteSpace(metaImage)
                ? metaImage.Trim()
                : atlasId;

            AtlasBuilder<AtlasBuildStage.Configured, TCoordPolicy> configured = AtlasBuilder.Create<TCoordPolicy>()
                .WithIdentity(new AtlasId(atlasId), new TextureId(textureId), metaSize.Value);

            Span<SpriteFrameDefinition> framesSpan = CollectionsMarshal.AsSpan(frameList);
            AtlasBuilder<AtlasBuildStage.FramesDefined, TCoordPolicy> builder = configured.AddFrame(in framesSpan[0]);
            for (int i = 1; i < framesSpan.Length; i++)
            {
                builder = builder.AddFrame(in framesSpan[i]);
            }

            for (int t = 0; t < frameTags.Count; t++)
            {
                (string Name, int From, int To, string Direction) tag = frameTags[t];
                bool reverse = string.Equals(tag.Direction, "reverse", StringComparison.OrdinalIgnoreCase);
                int length = Math.Max(0, tag.To - tag.From + 1);

                ImmutableArray<SpriteClipRefDefinition>.Builder refBuilder = ImmutableArray.CreateBuilder<SpriteClipRefDefinition>();
                for (int i = 0; i < length; i++)
                {
                    int idx = reverse ? tag.To - i : tag.From + i;
                    if ((uint)idx >= (uint)frameList.Count)
                    {
                        ThrowHelper.ThrowValidation($"TexturePacker frame tag '{tag.Name}' references missing frame index {idx}.");
                    }

                    SpriteFrameDefinition target = frameList[idx];
                    refBuilder.Add(new SpriteClipRefDefinition(target.Id, target.Duration ?? new Milliseconds(1000f / 12f)));
                }

                if (refBuilder.Count > 0)
                {
                    builder = builder.AddAnimation(new SpriteClipDefinition
                    {
                        Id = new ClipId(tag.Name),
                        Frames = refBuilder.ToImmutable(),
                        Fps = 12f,
                        Loop = !reverse,
                    });
                }
            }

            return Asset2DImportResult<TCoordPolicy>.Success(builder.Build());
        }
        catch (Asset2DException exception)
        {
            return Asset2DImportResult<TCoordPolicy>.Failure(
                $"{ImporterId} rejected '{context.Path.ToString()}': {exception.Message}",
                exception.Code);
        }
        catch (Exception exception) when (
            exception is JsonException or NotSupportedException or FormatException or InvalidOperationException)
        {
            return Asset2DImportResult<TCoordPolicy>.Failure(
                $"{ImporterId} could not read '{context.Path.ToString()}': {exception.Message}",
                Asset2DProbeHelper.ImportFailed);
        }
    }

    private static SpriteFrameDefinition ParseTexturePackerFrame(ref Utf8JsonReader reader, string frameKey)
    {
        float fx = 0f;
        float fy = 0f;
        float fw = 0f;
        float fh = 0f;
        bool rotated = false;
        float srcW = 0f;
        float srcH = 0f;
        float? ssX = null;
        float? ssY = null;
        float? pivX = null;
        float? pivY = null;
        float? durationMs = null;

        while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
        {
            if (reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("frame"u8))
                {
                    reader.Read();
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                    {
                        if (reader.TokenType == JsonTokenType.PropertyName)
                        {
                            if (reader.ValueTextEquals("x"u8)) { reader.Read(); fx = reader.GetSingle(); }
                            else if (reader.ValueTextEquals("y"u8)) { reader.Read(); fy = reader.GetSingle(); }
                            else if (reader.ValueTextEquals("w"u8)) { reader.Read(); fw = reader.GetSingle(); }
                            else if (reader.ValueTextEquals("h"u8)) { reader.Read(); fh = reader.GetSingle(); }
                            else
                            {
                                reader.Skip();
                            }
                        }
                    }
                }
                else if (reader.ValueTextEquals("rotated"u8))
                {
                    reader.Read();
                    rotated = reader.GetBoolean();
                }
                else if (reader.ValueTextEquals("sourceSize"u8))
                {
                    reader.Read();
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                    {
                        if (reader.TokenType == JsonTokenType.PropertyName)
                        {
                            if (reader.ValueTextEquals("w"u8)) { reader.Read(); srcW = reader.GetSingle(); }
                            else if (reader.ValueTextEquals("h"u8)) { reader.Read(); srcH = reader.GetSingle(); }
                            else
                            {
                                reader.Skip();
                            }
                        }
                    }
                }
                else if (reader.ValueTextEquals("spriteSourceSize"u8))
                {
                    reader.Read();
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                    {
                        if (reader.TokenType == JsonTokenType.PropertyName)
                        {
                            if (reader.ValueTextEquals("x"u8)) { reader.Read(); ssX = reader.GetSingle(); }
                            else if (reader.ValueTextEquals("y"u8)) { reader.Read(); ssY = reader.GetSingle(); }
                            else
                            {
                                reader.Skip();
                            }
                        }
                    }
                }
                else if (reader.ValueTextEquals("pivot"u8))
                {
                    reader.Read();
                    while (reader.Read() && reader.TokenType != JsonTokenType.EndObject)
                    {
                        if (reader.TokenType == JsonTokenType.PropertyName)
                        {
                            if (reader.ValueTextEquals("x"u8)) { reader.Read(); pivX = reader.GetSingle(); }
                            else if (reader.ValueTextEquals("y"u8)) { reader.Read(); pivY = reader.GetSingle(); }
                            else
                            {
                                reader.Skip();
                            }
                        }
                    }
                }
                else if (reader.ValueTextEquals("duration"u8))
                {
                    reader.Read();
                    durationMs = reader.GetSingle();
                }
                else
                {
                    reader.Skip();
                }
            }
        }

        float regionW = rotated ? fh : fw;
        float regionH = rotated ? fw : fh;
        var region = new Rect2D(fx, fy, regionW, regionH);
        var sourceSize = new Size2D(srcW > 0f ? srcW : regionW, srcH > 0f ? srcH : regionH);
        Vec2 pivot = pivX.HasValue && pivY.HasValue ? new Vec2(pivX.Value, pivY.Value) : new Vec2(0.5f, 0.5f);
        Vec2? trimOffset = ssX.HasValue && ssY.HasValue ? new Vec2(ssX.Value, ssY.Value) : null;

        return new SpriteFrameDefinition
        {
            Id = new FrameId(frameKey),
            Region = region,
            SourceSize = sourceSize,
            Pivot = pivot,
            SliceBorder = null,
            Duration = durationMs.HasValue && durationMs.Value > 0f ? new Milliseconds(durationMs.Value) : null,
            Rotated = rotated,
            TrimOffset = trimOffset,
        };
    }

    private static bool IsTexturePackerJson(ReadOnlySpan<byte> utf8)
    {
        var reader = new Utf8JsonReader(utf8);
        bool hasFramesObject = false;
        bool hasMeta = false;

        while (reader.Read())
        {
            if (reader.TokenType == JsonTokenType.PropertyName)
            {
                if (reader.ValueTextEquals("frames"u8))
                {
                    reader.Read();
                    if (reader.TokenType == JsonTokenType.StartObject)
                    {
                        hasFramesObject = true;
                    }
                }
                else if (reader.ValueTextEquals("meta"u8))
                {
                    hasMeta = true;
                }
            }

            if (hasFramesObject && hasMeta)
            {
                return true;
            }
        }

        return hasFramesObject;
    }
}

/// <summary>Atlas path and naming helpers.</summary>
public static class SpriteAtlasUtil
{
    /// <summary>Resolves a frame without allocating.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SpriteAtlasFrame? GetFrame<TCoordPolicy>(SpriteAtlas<TCoordPolicy> atlas, FrameId id)
        where TCoordPolicy : struct, ICoordinatePolicy
    {
        ArgumentNullException.ThrowIfNull(atlas);
        return atlas.GetFrame(id);
    }

    /// <summary>Resolves an animation clip without allocating.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static SpriteAnimationClip? GetAnimation<TCoordPolicy>(SpriteAtlas<TCoordPolicy> atlas, ClipId id)
        where TCoordPolicy : struct, ICoordinatePolicy
    {
        ArgumentNullException.ThrowIfNull(atlas);
        return atlas.GetAnimation(id);
    }
    private static readonly string[] KnownExtensions =
    [
        ".spriteatlas.json",
        ".atlas.json",
        ".texturepacker.json",
        ".json",
    ];

    /// <summary>Derives an atlas id from a path or URI without allocating.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static ReadOnlySpan<char> DeriveAtlasId(ReadOnlySpan<char> pathOrUri)
    {
        if (pathOrUri.IsEmpty)
        {
            return "atlas";
        }

        int queryIdx = pathOrUri.IndexOfAny('?', '#');
        if (queryIdx >= 0)
        {
            pathOrUri = pathOrUri[..queryIdx];
        }

        int lastSlash = pathOrUri.LastIndexOfAny('/', '\\');
        ReadOnlySpan<char> fileName = lastSlash >= 0 ? pathOrUri[(lastSlash + 1)..] : pathOrUri;

        foreach (string ext in KnownExtensions)
        {
            if (fileName.EndsWith(ext, StringComparison.OrdinalIgnoreCase))
            {
                fileName = fileName[..^ext.Length];
                break;
            }
        }

        int dot = fileName.LastIndexOf('.');
        if (dot >= 0)
        {
            fileName = fileName[..dot];
        }

        return fileName.IsEmpty ? "atlas" : fileName;
    }
}
