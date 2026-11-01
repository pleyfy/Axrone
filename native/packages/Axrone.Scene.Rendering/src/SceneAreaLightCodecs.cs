namespace Axrone.Scene.Rendering;

using System.Text.Json;

/// <summary>JSON codec for <see cref="SceneAreaLight"/>.</summary>
public sealed class SceneAreaLightCodec : SceneDataCodec<SceneAreaLight>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneAreaLight value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteString("shape", value.Shape == SceneAreaLightShape.Disk ? "disk" : "rect");
        SceneJson.WriteVec2(writer, "size", value.Size);
        SceneJson.WriteVec3(writer, "color", value.Color);
        writer.WriteNumber("intensity", value.Intensity);
        writer.WriteNumber("range", value.Range);
        writer.WriteNumber("attenuation", value.Attenuation);
        writer.WriteBoolean("twoSided", value.TwoSided);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneAreaLight Read(JsonElement data)
    {
        SceneAreaLight value = SceneAreaLight.Default;

        if (data.TryGetProperty("shape", out JsonElement shape))
        {
            value.Shape = ReadShape(shape);
        }

        if (data.TryGetProperty("size", out JsonElement size))
        {
            value.Size = SceneJson.ReadVec2(size, "size");
        }

        if (data.TryGetProperty("color", out JsonElement color))
        {
            value.Color = SceneJson.ReadVec3(color, "color");
        }

        if (data.TryGetProperty("intensity", out JsonElement intensity))
        {
            value.Intensity = intensity.GetSingle();
        }

        if (data.TryGetProperty("range", out JsonElement range))
        {
            value.Range = range.GetSingle();
        }

        if (data.TryGetProperty("attenuation", out JsonElement attenuation))
        {
            value.Attenuation = attenuation.GetSingle();
        }

        if (data.TryGetProperty("twoSided", out JsonElement twoSided))
        {
            value.TwoSided = twoSided.GetBoolean();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            value.Enabled = enabled.GetBoolean();
        }

        return value;
    }

    private static SceneAreaLightShape ReadShape(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw SceneJson.Invalid("Area light 'shape' must be a string.");
        }

        return element.GetString() switch
        {
            "rect" => SceneAreaLightShape.Rect,
            "disk" => SceneAreaLightShape.Disk,
            _ => throw SceneJson.Invalid(
                $"Area light 'shape' must be 'rect' or 'disk'; received '{element.GetString()}'.")
        };
    }
}
