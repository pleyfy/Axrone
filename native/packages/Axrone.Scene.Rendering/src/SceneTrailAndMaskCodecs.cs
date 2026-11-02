namespace Axrone.Scene.Rendering;

using System.Text.Json;

/// <summary>JSON codec for <see cref="SceneTrailRenderer"/>.</summary>
public sealed class SceneTrailRendererCodec : SceneDataCodec<SceneTrailRenderer>
{
    private readonly SceneNameTable _names;

    /// <summary>Creates a codec that resolves pass names through a name table.</summary>
    public SceneTrailRendererCodec(SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(names);
        _names = names;
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneTrailRenderer value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteNumber("trail", value.TrailId);
        SceneJson.WriteAssetId(writer, "pass", value.PassId, _names);
        writer.WriteBoolean("enabled", value.Enabled);
        writer.WriteBoolean("visible", value.Visible);
        writer.WriteNumber("width", value.Width);
        writer.WriteNumber("lifetime", value.LifetimeSeconds);
        SceneJson.WriteVec4(writer, "color", value.Color);
        writer.WriteString("fade", value.Fade == SceneTrailFade.Constant ? "constant" : "linear");
        writer.WriteNumber("sortingLayer", value.SortingLayer);
        writer.WriteNumber("renderOrder", value.RenderOrder);
        writer.WriteNumber("depth", value.Depth);
    }

    /// <inheritdoc/>
    public override SceneTrailRenderer Read(JsonElement data)
    {
        SceneTrailRenderer value = SceneTrailRenderer.Default;

        if (data.TryGetProperty("trail", out JsonElement trail))
        {
            value.TrailId = (uint)trail.GetInt32();
        }

        if (SceneJson.TryReadAssetId(data, "pass", _names, out SceneAssetId<RenderPassAssetTag> pass))
        {
            value.PassId = pass;
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        if (data.TryGetProperty("visible", out JsonElement visible))
        {
            value.Visible = visible.GetBoolean();
        }

        if (data.TryGetProperty("width", out JsonElement width))
        {
            value.Width = width.GetSingle();
        }

        if (data.TryGetProperty("lifetime", out JsonElement lifetime))
        {
            value.LifetimeSeconds = lifetime.GetSingle();
        }

        if (data.TryGetProperty("color", out JsonElement color))
        {
            value.Color = SceneJson.ReadVec4(color, "color");
        }

        if (data.TryGetProperty("fade", out JsonElement fade))
        {
            value.Fade = ReadFade(fade);
        }

        if (data.TryGetProperty("sortingLayer", out JsonElement sortingLayer))
        {
            value.SortingLayer = sortingLayer.GetInt32();
        }

        if (data.TryGetProperty("renderOrder", out JsonElement renderOrder))
        {
            value.RenderOrder = renderOrder.GetInt32();
        }

        if (data.TryGetProperty("depth", out JsonElement depth))
        {
            value.Depth = depth.GetSingle();
        }

        return value;
    }

    private static SceneTrailFade ReadFade(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw SceneJson.Invalid("Trail 'fade' must be a string.");
        }

        return element.GetString() switch
        {
            "linear" => SceneTrailFade.Linear,
            "constant" => SceneTrailFade.Constant,
            _ => throw SceneJson.Invalid(
                $"Trail 'fade' must be 'linear' or 'constant'; received '{element.GetString()}'.")
        };
    }
}

/// <summary>JSON codec for <see cref="SceneSpriteMask"/>.</summary>
public sealed class SceneSpriteMaskCodec : SceneDataCodec<SceneSpriteMask>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneSpriteMask value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteString("kind", WriteKind(value.Kind));
        SceneJson.WriteVec4(writer, "rect", value.Rect);
        writer.WriteNumber("feather", value.Feather);
        writer.WriteNumber("cornerRadius", value.CornerRadius);
        writer.WriteBoolean("invert", value.Invert);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneSpriteMask Read(JsonElement data)
    {
        SceneSpriteMask value = SceneSpriteMask.Default;

        if (data.TryGetProperty("kind", out JsonElement kind))
        {
            value.Kind = ReadKind(kind);
        }

        if (data.TryGetProperty("rect", out JsonElement rect))
        {
            value.Rect = SceneJson.ReadVec4(rect, "rect");
        }

        if (data.TryGetProperty("feather", out JsonElement feather))
        {
            value.Feather = feather.GetSingle();
        }

        if (data.TryGetProperty("cornerRadius", out JsonElement cornerRadius))
        {
            value.CornerRadius = cornerRadius.GetSingle();
        }

        if (data.TryGetProperty("invert", out JsonElement invert))
        {
            value.Invert = invert.GetBoolean();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        return value;
    }

    private static string WriteKind(SceneSpriteMaskKind kind) => kind switch
    {
        SceneSpriteMaskKind.Ellipse => "ellipse",
        SceneSpriteMaskKind.RoundedRect => "roundedRect",
        _ => "rect"
    };

    private static SceneSpriteMaskKind ReadKind(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw SceneJson.Invalid("Sprite mask 'kind' must be a string.");
        }

        return element.GetString() switch
        {
            "rect" => SceneSpriteMaskKind.Rect,
            "ellipse" => SceneSpriteMaskKind.Ellipse,
            "roundedRect" => SceneSpriteMaskKind.RoundedRect,
            _ => throw SceneJson.Invalid(
                $"Sprite mask 'kind' must be 'rect', 'ellipse' or 'roundedRect'; received '{element.GetString()}'.")
        };
    }
}
