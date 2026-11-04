using Axrone.Asset;
using AssetPipelineContext = Axrone.Asset.AssetImportContext;
using AssetPipelineResult = Axrone.Asset.AssetImportResult;

namespace Axrone.Asset2D;

/// <summary>
/// Axrone.Asset pipeline importer for sprite atlas JSON: matches atlas sources
/// by path and content probing, then upserts the resolved top-left atlas.
/// </summary>
public sealed class SpriteAtlasAssetImporter : IAssetImporter
{
    /// <inheritdoc/>
    public AssetImporterId Id => new("axrone.importer.sprite-atlas");

    /// <inheritdoc/>
    public int Priority => 20;

    /// <inheritdoc/>
    public IReadOnlyList<string> SourceKinds => ["bytes", "text"];

    /// <inheritdoc/>
    public IReadOnlyList<string> Extensions => [".spriteatlas.json", ".atlas.json", ".json"];

    /// <inheritdoc/>
    public bool CanImport(AssetPipelineContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (!TryGetSource(context, out byte[]? bytes, out string path))
        {
            return false;
        }

        AssetImportContext ours = new(path.AsSpan(), bytes);
        return SpriteAtlasJsonImporter<TopLeftOriginPolicy>.CanImport(in ours)
            || TexturePackerSpriteAtlasImporter<TopLeftOriginPolicy>.CanImport(in ours);
    }

    /// <inheritdoc/>
    public ValueTask<AssetPipelineResult> ImportAsync(AssetPipelineContext context, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(context);
        if (!TryGetSource(context, out byte[]? bytes, out string path))
        {
            throw new Asset2DException("asset-2d.import", "Sprite atlas importer received an unsupported source payload.");
        }

        AssetImportContext ours = new(path.AsSpan(), bytes);
        Asset2DImportResult<TopLeftOriginPolicy> result =
            ImporterChain<TexturePackerSpriteAtlasImporter<TopLeftOriginPolicy>, SpriteAtlasJsonImporter<TopLeftOriginPolicy>, TopLeftOriginPolicy>.Import(in ours);

        if (!result.IsSuccess)
        {
            throw new Asset2DException(
                "asset-2d.import",
                result.ErrorCode is null
                    ? result.ErrorMessage ?? "Sprite atlas import failed."
                    : $"[{result.ErrorCode}] {result.ErrorMessage ?? "Sprite atlas import failed."}");
        }

        SpriteAtlas<TopLeftOriginPolicy> atlas = result.Atlas;
        AssetWriteInput<object> primary = new(
            Kind: "sprite-atlas",
            Id: null,
            Key: context.BaseKey,
            Name: atlas.Id.Value,
            Data: (object)atlas,
            Metadata: context.Metadata);

        return ValueTask.FromResult(new AssetPipelineResult { Primary = primary });
    }

    private static bool TryGetSource(AssetPipelineContext context, out byte[]? bytes, out string path)
    {
        path = context.SourceUri?.Value ?? context.BaseKey.Value ?? string.Empty;
        switch (context.Source.RawData)
        {
            case byte[] raw:
                bytes = raw;
                return true;
            case string text:
                bytes = Encoding.UTF8.GetBytes(text);
                return true;
            default:
                bytes = null;
                return false;
        }
    }
}
