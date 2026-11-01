namespace Axrone.Ui.Scene;

using System.Text.Json;
using Axrone.Scene;

/// <summary>
/// Versioned JSON codec for <see cref="SceneUiHost"/>. Unknown versions, modes
/// and billboard policies are rejected; numeric sizes are clamped into the
/// supported ranges so a malformed payload cannot create an invalid surface.
/// </summary>
public sealed class SceneUiHostCodec : SceneDataCodec<SceneUiHost>
{
    /// <summary>Payload version written by this codec.</summary>
    public const int CurrentVersion = 1;

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneUiHost value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteNumber("version", CurrentVersion);
        writer.WriteNumber("assetId", value.AssetId.Value);
        writer.WriteString("renderMode", WriteRenderMode(value.RenderMode));
        writer.WriteString("billboard", WriteBillboard(value.Billboard));
        writer.WriteNumber("worldWidth", SceneUiHostLimits.ClampWorldSize(value.WorldWidth));
        writer.WriteNumber("worldHeight", SceneUiHostLimits.ClampWorldSize(value.WorldHeight));
        writer.WriteNumber("textureScale", SceneUiHostLimits.ClampTextureScale(value.TextureScale));
        writer.WriteBoolean("receiveInput", value.ReceiveInput);
        writer.WriteBoolean("enabled", value.Enabled);
        writer.WriteBoolean("visible", value.Visible);
        writer.WriteNumber("sortingOrder", value.SortingOrder);
    }

    /// <inheritdoc/>
    public override SceneUiHost Read(JsonElement data)
    {
        if (data.TryGetProperty("version", out JsonElement versionElement) &&
            (!versionElement.TryGetInt32(out int version) || version != CurrentVersion))
        {
            throw Invalid($"SceneUiHost payload version '{versionElement}' is not supported.");
        }

        SceneUiHost value = SceneUiHost.Default;
        if (data.TryGetProperty("assetId", out JsonElement assetId))
        {
            value.AssetId = assetId.TryGetUInt64(out ulong symbol) ? new SceneStringId(symbol) : throw Invalid("SceneUiHost assetId must be an unsigned 64-bit symbol.");
        }

        if (data.TryGetProperty("renderMode", out JsonElement renderMode))
        {
            value.RenderMode = ReadRenderMode(renderMode);
        }

        if (data.TryGetProperty("billboard", out JsonElement billboard))
        {
            value.Billboard = ReadBillboard(billboard);
        }

        if (data.TryGetProperty("worldWidth", out JsonElement worldWidth))
        {
            value.WorldWidth = SceneUiHostLimits.ClampWorldSize(worldWidth.GetSingle());
        }

        if (data.TryGetProperty("worldHeight", out JsonElement worldHeight))
        {
            value.WorldHeight = SceneUiHostLimits.ClampWorldSize(worldHeight.GetSingle());
        }

        if (data.TryGetProperty("textureScale", out JsonElement textureScale))
        {
            value.TextureScale = SceneUiHostLimits.ClampTextureScale(textureScale.GetSingle());
        }

        if (data.TryGetProperty("receiveInput", out JsonElement receiveInput))
        {
            value.ReceiveInput = receiveInput.GetBoolean();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        if (data.TryGetProperty("visible", out JsonElement visible))
        {
            value.Visible = visible.GetBoolean();
        }

        if (data.TryGetProperty("sortingOrder", out JsonElement sortingOrder))
        {
            value.SortingOrder = sortingOrder.GetInt32();
        }

        return value;
    }

    private static string WriteRenderMode(SceneUiHostRenderMode mode) =>
        mode == SceneUiHostRenderMode.WorldSpace ? "world-space" : "screen-overlay";

    private static SceneUiHostRenderMode ReadRenderMode(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.String && element.ValueEquals("screen-overlay"))
        {
            return SceneUiHostRenderMode.ScreenOverlay;
        }

        if (element.ValueKind == JsonValueKind.String && element.ValueEquals("world-space"))
        {
            return SceneUiHostRenderMode.WorldSpace;
        }

        throw Invalid($"SceneUiHost renderMode '{element}' is not supported.");
    }

    private static string WriteBillboard(SceneUiHostBillboard billboard) =>
        billboard == SceneUiHostBillboard.CameraFacing ? "camera-facing" : "none";

    private static SceneUiHostBillboard ReadBillboard(JsonElement element)
    {
        if (element.ValueKind == JsonValueKind.String && element.ValueEquals("none"))
        {
            return SceneUiHostBillboard.None;
        }

        if (element.ValueKind == JsonValueKind.String && element.ValueEquals("camera-facing"))
        {
            return SceneUiHostBillboard.CameraFacing;
        }

        throw Invalid($"SceneUiHost billboard '{element}' is not supported.");
    }

    private static SceneValidationException Invalid(string message) =>
        new(SceneErrorCodes.ValidationInvalid, message);
}
