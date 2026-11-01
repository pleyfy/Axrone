namespace Axrone.Scene.Rendering;

using System.Text.Json;

/// <summary>JSON codec for <see cref="SceneLodGroup"/>.</summary>
public sealed class SceneLodGroupCodec : SceneDataCodec<SceneLodGroup>
{
    private readonly SceneNameTable _names;

    /// <summary>Creates a codec that resolves mesh, material and pass names.</summary>
    public SceneLodGroupCodec(SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(names);
        _names = names;
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneLodGroup value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteStartArray("levels");
        for (int i = 0; i < value.LevelCount; i++)
        {
            SceneLodLevel level = value.GetLevel(i);
            writer.WriteStartObject();
            SceneJson.WriteAssetId(writer, "mesh", level.MeshId, _names);
            SceneJson.WriteAssetId(writer, "material", level.MaterialId, _names);
            writer.WriteNumber("threshold", level.Threshold);
            writer.WriteEndObject();
        }

        writer.WriteEndArray();
        writer.WriteString("metric", value.Metric == SceneLodMetric.ScreenRadius ? "screenRadius" : "distance");
        writer.WriteNumber("hysteresis", value.Hysteresis);
        writer.WriteBoolean("enabled", value.Enabled);
        SceneJson.WriteAssetId(writer, "pass", value.PassId, _names);
        writer.WriteBoolean("receiveLighting", value.ReceiveLighting);
        writer.WriteBoolean("transparent", value.Transparent);
        writer.WriteNumber("renderOrder", value.RenderOrder);
        SceneJson.WriteVec3(writer, "localCenter", value.LocalCenter);
        writer.WriteNumber("radius", value.Radius);
    }

    /// <inheritdoc/>
    public override SceneLodGroup Read(JsonElement data)
    {
        SceneLodGroup value = SceneLodGroup.Default;
        value.LevelCount = 0;

        if (data.TryGetProperty("levels", out JsonElement levels) && levels.ValueKind == JsonValueKind.Array)
        {
            int index = 0;
            foreach (JsonElement element in levels.EnumerateArray())
            {
                if (index >= SceneLodGroup.MaxLevels || element.ValueKind != JsonValueKind.Object)
                {
                    break;
                }

                SceneLodLevel level = default;
                SceneJson.TryReadAssetId(element, "mesh", _names, out SceneAssetId<MeshAssetTag> mesh);
                SceneJson.TryReadAssetId(element, "material", _names, out SceneAssetId<MaterialAssetTag> material);
                level = new SceneLodLevel(mesh, material, element.TryGetProperty("threshold", out JsonElement threshold) ? threshold.GetSingle() : 0.0f);
                value.SetLevel(index, in level);
                index++;
            }
        }

        if (data.TryGetProperty("metric", out JsonElement metric))
        {
            value.Metric = ReadMetric(metric);
        }

        if (data.TryGetProperty("hysteresis", out JsonElement hysteresis))
        {
            value.Hysteresis = hysteresis.GetSingle();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        if (SceneJson.TryReadAssetId(data, "pass", _names, out SceneAssetId<RenderPassAssetTag> pass))
        {
            value.PassId = pass;
        }

        if (data.TryGetProperty("receiveLighting", out JsonElement receiveLighting))
        {
            value.ReceiveLighting = receiveLighting.GetBoolean();
        }

        if (data.TryGetProperty("transparent", out JsonElement transparent))
        {
            value.Transparent = transparent.GetBoolean();
        }

        if (data.TryGetProperty("renderOrder", out JsonElement renderOrder))
        {
            value.RenderOrder = renderOrder.GetInt32();
        }

        if (data.TryGetProperty("localCenter", out JsonElement localCenter))
        {
            value.LocalCenter = SceneJson.ReadVec3(localCenter, "localCenter");
        }

        if (data.TryGetProperty("radius", out JsonElement radius))
        {
            value.Radius = radius.GetSingle();
        }

        return value;
    }

    private static SceneLodMetric ReadMetric(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw SceneJson.Invalid("LOD 'metric' must be a string.");
        }

        return element.GetString() switch
        {
            "distance" => SceneLodMetric.Distance,
            "screenRadius" => SceneLodMetric.ScreenRadius,
            _ => throw SceneJson.Invalid(
                $"LOD 'metric' must be 'distance' or 'screenRadius'; received '{element.GetString()}'.")
        };
    }
}

/// <summary>JSON codec for <see cref="SceneReflectionProbe"/>.</summary>
public sealed class SceneReflectionProbeCodec : SceneDataCodec<SceneReflectionProbe>
{
    private readonly SceneNameTable _names;

    /// <summary>Creates a codec that resolves cubemap names.</summary>
    public SceneReflectionProbeCodec(SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(names);
        _names = names;
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneReflectionProbe value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJson.WriteAssetId(writer, "cubemap", value.CubemapId, _names);
        SceneJson.WriteVec3(writer, "localCenter", value.LocalCenter);
        SceneJson.WriteVec3(writer, "extents", value.Extents);
        writer.WriteNumber("intensity", value.Intensity);
        writer.WriteNumber("priority", value.Priority);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneReflectionProbe Read(JsonElement data)
    {
        SceneReflectionProbe value = SceneReflectionProbe.Default;

        if (SceneJson.TryReadAssetId(data, "cubemap", _names, out SceneAssetId<TextureAssetTag> cubemap))
        {
            value.CubemapId = cubemap;
        }

        if (data.TryGetProperty("localCenter", out JsonElement localCenter))
        {
            value.LocalCenter = SceneJson.ReadVec3(localCenter, "localCenter");
        }

        if (data.TryGetProperty("extents", out JsonElement extents))
        {
            value.Extents = SceneJson.ReadVec3(extents, "extents");
        }

        if (data.TryGetProperty("intensity", out JsonElement intensity))
        {
            value.Intensity = intensity.GetSingle();
        }

        if (data.TryGetProperty("priority", out JsonElement priority))
        {
            value.Priority = priority.GetInt32();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        return value;
    }
}
