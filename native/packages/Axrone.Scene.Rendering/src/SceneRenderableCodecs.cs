namespace Axrone.Scene.Rendering;

using System.Text.Json;

/// <summary>JSON codec for <see cref="SceneBillboardRenderer"/>.</summary>
public sealed class SceneBillboardRendererCodec : SceneDataCodec<SceneBillboardRenderer>
{
    private readonly SceneNameTable _names;

    /// <summary>Creates a codec that resolves asset symbols through a name table.</summary>
    public SceneBillboardRendererCodec(SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(names);
        _names = names;
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneBillboardRenderer value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJson.WriteAssetId(writer, "texture", value.TextureId, _names);
        SceneJson.WriteAssetId(writer, "material", value.MaterialId, _names);
        SceneJson.WriteAssetId(writer, "pass", value.PassId, _names);
        writer.WriteBoolean("enabled", value.Enabled);
        writer.WriteBoolean("visible", value.Visible);
        writer.WriteBoolean("flipX", value.FlipX);
        writer.WriteBoolean("flipY", value.FlipY);
        writer.WriteString("mode", WriteMode(value.Mode));
        writer.WriteNumber("sortingLayer", value.SortingLayer);
        writer.WriteNumber("renderOrder", value.RenderOrder);
        writer.WriteNumber("depth", value.Depth);
        SceneJson.WriteVec2(writer, "size", value.Size);
        SceneJson.WriteVec2(writer, "anchor", value.Anchor);
        SceneJson.WriteVec4(writer, "color", value.Color);
        SceneJson.WriteVec4(writer, "uvRect", value.UvRect);
    }

    /// <inheritdoc/>
    public override SceneBillboardRenderer Read(JsonElement data)
    {
        SceneBillboardRenderer value = SceneBillboardRenderer.Default;

        if (SceneJson.TryReadAssetId(data, "texture", _names, out SceneAssetId<TextureAssetTag> texture))
        {
            value.TextureId = texture;
        }

        if (SceneJson.TryReadAssetId(data, "material", _names, out SceneAssetId<MaterialAssetTag> material))
        {
            value.MaterialId = material;
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

        if (data.TryGetProperty("flipX", out JsonElement flipX))
        {
            value.FlipX = flipX.GetBoolean();
        }

        if (data.TryGetProperty("flipY", out JsonElement flipY))
        {
            value.FlipY = flipY.GetBoolean();
        }

        if (data.TryGetProperty("mode", out JsonElement mode))
        {
            value.Mode = ReadMode(mode);
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

        if (data.TryGetProperty("size", out JsonElement size))
        {
            value.Size = SceneJson.ReadVec2(size, "size");
        }

        if (data.TryGetProperty("anchor", out JsonElement anchor))
        {
            value.Anchor = SceneJson.ReadVec2(anchor, "anchor");
        }

        if (data.TryGetProperty("color", out JsonElement color))
        {
            value.Color = SceneJson.ReadVec4(color, "color");
        }

        if (data.TryGetProperty("uvRect", out JsonElement uvRect))
        {
            value.UvRect = SceneJson.ReadVec4(uvRect, "uvRect");
        }

        return value;
    }

    private static string WriteMode(SceneBillboardMode mode) =>
        mode == SceneBillboardMode.Cylindrical ? "cylindrical" : "spherical";

    private static SceneBillboardMode ReadMode(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw SceneJson.Invalid("Billboard 'mode' must be a string.");
        }

        return element.GetString() switch
        {
            "spherical" => SceneBillboardMode.Spherical,
            "cylindrical" => SceneBillboardMode.Cylindrical,
            _ => throw SceneJson.Invalid(
                $"Billboard 'mode' must be 'spherical' or 'cylindrical'; received '{element.GetString()}'.")
        };
    }
}

/// <summary>JSON codec for <see cref="SceneLineRenderer"/>.</summary>
public sealed class SceneLineRendererCodec : SceneDataCodec<SceneLineRenderer>
{
    private readonly SceneNameTable _names;

    /// <summary>Creates a codec that resolves pass names through a name table.</summary>
    public SceneLineRendererCodec(SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(names);
        _names = names;
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneLineRenderer value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteNumber("polyline", value.PolylineId);
        SceneJson.WriteAssetId(writer, "pass", value.PassId, _names);
        writer.WriteBoolean("enabled", value.Enabled);
        writer.WriteBoolean("visible", value.Visible);
        writer.WriteBoolean("loop", value.Loop);
        writer.WriteNumber("width", value.Width);
        SceneJson.WriteVec4(writer, "color", value.Color);
        writer.WriteNumber("sortingLayer", value.SortingLayer);
        writer.WriteNumber("renderOrder", value.RenderOrder);
        writer.WriteNumber("depth", value.Depth);
        writer.WriteString("cap", WriteCap(value.Cap));
        writer.WriteString("join", WriteJoin(value.Join));
    }

    /// <inheritdoc/>
    public override SceneLineRenderer Read(JsonElement data)
    {
        SceneLineRenderer value = SceneLineRenderer.Default;

        if (data.TryGetProperty("polyline", out JsonElement polyline))
        {
            value.PolylineId = (uint)polyline.GetInt32();
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

        if (data.TryGetProperty("loop", out JsonElement loop))
        {
            value.Loop = loop.GetBoolean();
        }

        if (data.TryGetProperty("width", out JsonElement width))
        {
            value.Width = width.GetSingle();
        }

        if (data.TryGetProperty("color", out JsonElement color))
        {
            value.Color = SceneJson.ReadVec4(color, "color");
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

        if (data.TryGetProperty("cap", out JsonElement cap))
        {
            value.Cap = ReadCap(cap);
        }

        if (data.TryGetProperty("join", out JsonElement join))
        {
            value.Join = ReadJoin(join);
        }

        return value;
    }

    private static string WriteCap(SceneLineCap cap) => cap switch
    {
        SceneLineCap.Square => "square",
        SceneLineCap.Round => "round",
        _ => "butt"
    };

    private static SceneLineCap ReadCap(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw SceneJson.Invalid("Line 'cap' must be a string.");
        }

        return element.GetString() switch
        {
            "butt" => SceneLineCap.Butt,
            "square" => SceneLineCap.Square,
            "round" => SceneLineCap.Round,
            _ => throw SceneJson.Invalid(
                $"Line 'cap' must be 'butt', 'square' or 'round'; received '{element.GetString()}'.")
        };
    }

    private static string WriteJoin(SceneLineJoin join) => join switch
    {
        SceneLineJoin.Bevel => "bevel",
        SceneLineJoin.Round => "round",
        _ => "miter"
    };

    private static SceneLineJoin ReadJoin(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw SceneJson.Invalid("Line 'join' must be a string.");
        }

        return element.GetString() switch
        {
            "miter" => SceneLineJoin.Miter,
            "bevel" => SceneLineJoin.Bevel,
            "round" => SceneLineJoin.Round,
            _ => throw SceneJson.Invalid(
                $"Line 'join' must be 'miter', 'bevel' or 'round'; received '{element.GetString()}'.")
        };
    }
}
