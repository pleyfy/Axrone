namespace Axrone.Scene.Rendering;

using System.Text.Json;

/// <summary>
/// Prefab codecs for the rendering data components. Asset references are
/// written as authoring names and interned again on read, so snapshots remain
/// readable and stable across processes without reflection.
/// </summary>
public static class SceneRenderingCodecs
{
    /// <summary>Registers codecs for every rendering component present in a registry.</summary>
    public static void Register(
        SceneCodecRegistry codecs,
        SceneComponentRegistry components,
        SceneAssetRegistry assets)
    {
        ArgumentNullException.ThrowIfNull(codecs);
        ArgumentNullException.ThrowIfNull(components);
        ArgumentNullException.ThrowIfNull(assets);

        SceneNameTable names = assets.Names;

        if (components.TryGetDataByType(typeof(SceneCamera), out _))
        {
            codecs.Register(new SceneCameraCodec());
        }

        if (components.TryGetDataByType(typeof(SceneCamera2D), out _))
        {
            codecs.Register(new SceneCamera2DCodec());
        }

        if (components.TryGetDataByType(typeof(SceneSpriteRenderer), out _))
        {
            codecs.Register(new SceneSpriteRendererCodec(names));
        }

        if (components.TryGetDataByType(typeof(SceneMeshRenderer), out _))
        {
            codecs.Register(new SceneMeshRendererCodec(names));
        }

        if (components.TryGetDataByType(typeof(SceneBillboardRenderer), out _))
        {
            codecs.Register(new SceneBillboardRendererCodec(names));
        }

        if (components.TryGetDataByType(typeof(SceneLineRenderer), out _))
        {
            codecs.Register(new SceneLineRendererCodec(names));
        }

        if (components.TryGetDataByType(typeof(SceneTrailRenderer), out _))
        {
            codecs.Register(new SceneTrailRendererCodec(names));
        }

        if (components.TryGetDataByType(typeof(SceneSpriteMask), out _))
        {
            codecs.Register(new SceneSpriteMaskCodec());
        }

        if (components.TryGetDataByType(typeof(SceneLodGroup), out _))
        {
            codecs.Register(new SceneLodGroupCodec(names));
        }

        if (components.TryGetDataByType(typeof(SceneReflectionProbe), out _))
        {
            codecs.Register(new SceneReflectionProbeCodec(names));
        }

        if (components.TryGetDataByType(typeof(SceneAreaLight), out _))
        {
            codecs.Register(new SceneAreaLightCodec());
        }

        if (components.TryGetDataByType(typeof(SceneInstancedMeshRenderer), out _))
        {
            codecs.Register(new SceneInstancedMeshRendererCodec(names));
        }

        if (components.TryGetDataByType(typeof(SceneSkinnedMeshRenderer), out _))
        {
            codecs.Register(new SceneSkinnedMeshRendererCodec(names));
        }

        if (components.TryGetDataByType(typeof(SceneDirectionalLight), out _))
        {
            codecs.Register(new SceneDirectionalLightCodec());
        }

        if (components.TryGetDataByType(typeof(SceneFog), out _))
        {
            codecs.Register(new SceneFogCodec());
        }

        if (components.TryGetDataByType(typeof(ScenePointLight), out _))
        {
            codecs.Register(new ScenePointLightCodec());
        }

        if (components.TryGetDataByType(typeof(SceneSpotLight), out _))
        {
            codecs.Register(new SceneSpotLightCodec());
        }
    }
}

/// <summary>JSON codec for <see cref="SceneCamera"/>.</summary>
public sealed class SceneCameraCodec : SceneDataCodec<SceneCamera>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneCamera value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteBoolean("primary", value.Primary);
        writer.WriteBoolean("enabled", value.Enabled);
        writer.WriteBoolean("orthographic", value.Orthographic);
        writer.WriteString("fovAxis", WriteFovAxis(value.FieldOfViewAxis));
        writer.WriteNumber("fieldOfView", value.FieldOfViewDegrees);
        writer.WriteNumber("orthographicSize", value.OrthographicSize);
        writer.WriteNumber("near", value.Near);
        writer.WriteNumber("far", value.Far);
        writer.WriteNumber("clearMask", (int)value.ClearMask);
        SceneJson.WriteVec4(writer, "clearColor", value.ClearColor);
        writer.WriteNumber("clearDepth", value.ClearDepth);
    }

    /// <inheritdoc/>
    public override SceneCamera Read(JsonElement data)
    {
        SceneCamera camera = SceneCamera.Default;

        if (data.TryGetProperty("primary", out JsonElement primary))
        {
            camera.Primary = primary.GetBoolean();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            camera.Enabled = enabled.GetBoolean();
        }

        if (data.TryGetProperty("orthographic", out JsonElement orthographic))
        {
            camera.Orthographic = orthographic.GetBoolean();
        }

        if (data.TryGetProperty("fovAxis", out JsonElement axis))
        {
            camera.FieldOfViewAxis = ReadFovAxis(axis);
        }

        if (data.TryGetProperty("fieldOfView", out JsonElement fieldOfView))
        {
            camera.FieldOfViewDegrees = fieldOfView.GetSingle();
        }

        if (data.TryGetProperty("orthographicSize", out JsonElement orthographicSize))
        {
            camera.OrthographicSize = orthographicSize.GetSingle();
        }

        if (data.TryGetProperty("near", out JsonElement near))
        {
            camera.Near = near.GetSingle();
        }

        if (data.TryGetProperty("far", out JsonElement far))
        {
            camera.Far = far.GetSingle();
        }

        if (data.TryGetProperty("clearMask", out JsonElement clearMask))
        {
            camera.ClearMask = (SceneClearMask)clearMask.GetInt32();
        }

        if (data.TryGetProperty("clearColor", out JsonElement clearColor))
        {
            camera.ClearColor = SceneJson.ReadVec4(clearColor, "clearColor");
        }

        if (data.TryGetProperty("clearDepth", out JsonElement clearDepth))
        {
            camera.ClearDepth = clearDepth.GetSingle();
        }

        return camera;
    }

    private static string WriteFovAxis(SceneCameraFovAxis axis) => axis switch
    {
        SceneCameraFovAxis.Horizontal => "horizontal",
        _ => "vertical"
    };

    private static SceneCameraFovAxis ReadFovAxis(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw SceneJson.Invalid("Camera 'fovAxis' must be a string.");
        }

        return element.GetString() switch
        {
            "vertical" => SceneCameraFovAxis.Vertical,
            "horizontal" => SceneCameraFovAxis.Horizontal,
            _ => throw SceneJson.Invalid(
                $"Camera 'fovAxis' must be 'vertical' or 'horizontal'; received '{element.GetString()}'.")
        };
    }
}

/// <summary>JSON codec for <see cref="SceneMeshRenderer"/>.</summary>
public sealed class SceneMeshRendererCodec : SceneDataCodec<SceneMeshRenderer>
{
    private readonly SceneNameTable _names;

    /// <summary>Creates a codec that resolves asset symbols through a name table.</summary>
    public SceneMeshRendererCodec(SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(names);
        _names = names;
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneMeshRenderer value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJson.WriteAssetId(writer, "mesh", value.MeshId, _names);
        SceneJson.WriteAssetId(writer, "material", value.MaterialId, _names);
        SceneJson.WriteAssetId(writer, "pass", value.PassId, _names);
        writer.WriteBoolean("visible", value.Visible);
        writer.WriteBoolean("receiveLighting", value.ReceiveLighting);
        writer.WriteBoolean("transparent", value.Transparent);
        writer.WriteNumber("renderOrder", value.RenderOrder);

        if (value.Bounds is { } bounds)
        {
            writer.WriteStartObject("bounds");
            SceneJson.WriteVec3(writer, "center", bounds.Center);
            writer.WriteNumber("radius", bounds.Radius);
            writer.WriteEndObject();
        }
    }

    /// <inheritdoc/>
    public override SceneMeshRenderer Read(JsonElement data)
    {
        SceneMeshRenderer renderer = SceneMeshRenderer.Default;

        if (SceneJson.TryReadAssetId(data, "mesh", _names, out SceneAssetId<MeshAssetTag> mesh))
        {
            renderer.MeshId = mesh;
        }

        if (SceneJson.TryReadAssetId(data, "material", _names, out SceneAssetId<MaterialAssetTag> material))
        {
            renderer.MaterialId = material;
        }

        if (SceneJson.TryReadAssetId(data, "pass", _names, out SceneAssetId<RenderPassAssetTag> pass))
        {
            renderer.PassId = pass;
        }

        if (data.TryGetProperty("visible", out JsonElement visible))
        {
            renderer.Visible = visible.GetBoolean();
        }

        if (data.TryGetProperty("receiveLighting", out JsonElement receiveLighting))
        {
            renderer.ReceiveLighting = receiveLighting.GetBoolean();
        }

        if (data.TryGetProperty("transparent", out JsonElement transparent))
        {
            renderer.Transparent = transparent.GetBoolean();
        }

        if (data.TryGetProperty("renderOrder", out JsonElement renderOrder))
        {
            renderer.RenderOrder = renderOrder.GetInt32();
        }

        if (data.TryGetProperty("bounds", out JsonElement bounds) &&
            bounds.ValueKind == JsonValueKind.Object)
        {
            Vec3 center = bounds.TryGetProperty("center", out JsonElement centerElement)
                ? SceneJson.ReadVec3(centerElement, "bounds.center")
                : Vec3.Zero;
            float radius = bounds.TryGetProperty("radius", out JsonElement radiusElement)
                ? radiusElement.GetSingle()
                : 0.0f;
            renderer.Bounds = new BoundingSphere3(center, radius);
        }

        return renderer;
    }
}

/// <summary>JSON codec for <see cref="SceneCamera2D"/>.</summary>
public sealed class SceneCamera2DCodec : SceneDataCodec<SceneCamera2D>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneCamera2D value)
    {
        ArgumentNullException.ThrowIfNull(writer);
        writer.WriteNumber("depth", value.Depth);
    }

    /// <inheritdoc/>
    public override SceneCamera2D Read(JsonElement data)
    {
        SceneCamera2D camera = SceneCamera2D.Default;
        if (data.TryGetProperty("depth", out JsonElement depth))
        {
            camera.Depth = depth.GetSingle();
        }

        return camera;
    }
}

/// <summary>JSON codec for <see cref="SceneSpriteRenderer"/>.</summary>
public sealed class SceneSpriteRendererCodec : SceneDataCodec<SceneSpriteRenderer>
{
    private readonly SceneNameTable _names;

    /// <summary>Creates a codec that resolves asset symbols through a name table.</summary>
    public SceneSpriteRendererCodec(SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(names);
        _names = names;
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneSpriteRenderer value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJson.WriteAssetId(writer, "texture", value.TextureId, _names);
        SceneJson.WriteAssetId(writer, "material", value.MaterialId, _names);
        SceneJson.WriteAssetId(writer, "pass", value.PassId, _names);
        writer.WriteBoolean("enabled", value.Enabled);
        writer.WriteBoolean("visible", value.Visible);
        writer.WriteBoolean("flipX", value.FlipX);
        writer.WriteBoolean("flipY", value.FlipY);
        writer.WriteNumber("sortingLayer", value.SortingLayer);
        writer.WriteNumber("renderOrder", value.RenderOrder);
        writer.WriteNumber("depth", value.Depth);
        SceneJson.WriteVec2(writer, "size", value.Size);
        SceneJson.WriteVec2(writer, "sourceSize", value.SourceSize);
        SceneJson.WriteVec2(writer, "anchor", value.Anchor);
        SceneJson.WriteVec4(writer, "color", value.Color);
        SceneJson.WriteVec4(writer, "uvRect", value.UvRect);
    }

    /// <inheritdoc/>
    public override SceneSpriteRenderer Read(JsonElement data)
    {
        SceneSpriteRenderer sprite = SceneSpriteRenderer.Default;

        if (SceneJson.TryReadAssetId(data, "texture", _names, out SceneAssetId<TextureAssetTag> texture))
        {
            sprite.TextureId = texture;
        }

        if (SceneJson.TryReadAssetId(data, "material", _names, out SceneAssetId<MaterialAssetTag> material))
        {
            sprite.MaterialId = material;
        }

        if (SceneJson.TryReadAssetId(data, "pass", _names, out SceneAssetId<RenderPassAssetTag> pass))
        {
            sprite.PassId = pass;
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            sprite.Enabled = enabled.GetBoolean();
        }

        if (data.TryGetProperty("visible", out JsonElement visible))
        {
            sprite.Visible = visible.GetBoolean();
        }

        if (data.TryGetProperty("flipX", out JsonElement flipX))
        {
            sprite.FlipX = flipX.GetBoolean();
        }

        if (data.TryGetProperty("flipY", out JsonElement flipY))
        {
            sprite.FlipY = flipY.GetBoolean();
        }

        if (data.TryGetProperty("sortingLayer", out JsonElement sortingLayer))
        {
            sprite.SortingLayer = sortingLayer.GetInt32();
        }

        if (data.TryGetProperty("renderOrder", out JsonElement renderOrder))
        {
            sprite.RenderOrder = renderOrder.GetInt32();
        }

        if (data.TryGetProperty("depth", out JsonElement depth))
        {
            sprite.Depth = depth.GetSingle();
        }

        if (data.TryGetProperty("size", out JsonElement size))
        {
            sprite.Size = SceneJson.ReadVec2(size, "size");
        }

        if (data.TryGetProperty("sourceSize", out JsonElement sourceSize))
        {
            sprite.SourceSize = SceneJson.ReadVec2(sourceSize, "sourceSize");
        }

        if (data.TryGetProperty("anchor", out JsonElement anchor))
        {
            sprite.Anchor = SceneJson.ReadVec2(anchor, "anchor");
        }

        if (data.TryGetProperty("color", out JsonElement color))
        {
            sprite.Color = SceneJson.ReadVec4(color, "color");
        }

        if (data.TryGetProperty("uvRect", out JsonElement uvRect))
        {
            sprite.UvRect = SceneJson.ReadVec4(uvRect, "uvRect");
        }

        return sprite;
    }
}

/// <summary>JSON codec for <see cref="SceneFog"/>.</summary>
public sealed class SceneFogCodec : SceneDataCodec<SceneFog>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneFog value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        writer.WriteBoolean("enabled", value.Enabled);
        SceneJson.WriteVec3(writer, "color", value.Color);
        writer.WriteString("mode", WriteMode(value.Mode));
        writer.WriteNumber("density", value.Density);
        writer.WriteNumber("rangeStart", value.RangeStart);
        writer.WriteNumber("rangeEnd", value.RangeEnd);
    }

    /// <inheritdoc/>
    public override SceneFog Read(JsonElement data)
    {
        SceneFog fog = SceneFog.Default;

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            fog.Enabled = enabled.GetBoolean();
        }

        if (data.TryGetProperty("color", out JsonElement color))
        {
            fog.Color = SceneJson.ReadVec3(color, "color");
        }

        if (data.TryGetProperty("mode", out JsonElement mode))
        {
            fog.Mode = ReadMode(mode);
        }

        if (data.TryGetProperty("density", out JsonElement density))
        {
            fog.Density = density.GetSingle();
        }

        if (data.TryGetProperty("rangeStart", out JsonElement rangeStart))
        {
            fog.RangeStart = rangeStart.GetSingle();
        }

        if (data.TryGetProperty("rangeEnd", out JsonElement rangeEnd))
        {
            fog.RangeEnd = rangeEnd.GetSingle();
        }

        return fog;
    }

    private static string WriteMode(SceneFogMode mode) => mode switch
    {
        SceneFogMode.Linear => "linear",
        SceneFogMode.ExponentialSquared => "exponential-squared",
        _ => "exponential"
    };

    private static SceneFogMode ReadMode(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.String)
        {
            throw SceneJson.Invalid("Fog 'mode' must be a string.");
        }

        return element.GetString() switch
        {
            "linear" => SceneFogMode.Linear,
            "exponential" => SceneFogMode.Exponential,
            "exponential-squared" => SceneFogMode.ExponentialSquared,
            _ => throw SceneJson.Invalid(
                $"Fog 'mode' must be 'linear', 'exponential' or 'exponential-squared'; received '{element.GetString()}'.")
        };
    }
}

/// <summary>JSON codec for <see cref="SceneDirectionalLight"/>.</summary>
public sealed class SceneDirectionalLightCodec : SceneDataCodec<SceneDirectionalLight>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneDirectionalLight value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJson.WriteVec3(writer, "color", value.Color);
        SceneJson.WriteVec3(writer, "ambient", value.Ambient);
        writer.WriteNumber("intensity", value.Intensity);
        writer.WriteBoolean("primary", value.Primary);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneDirectionalLight Read(JsonElement data)
    {
        SceneDirectionalLight light = SceneDirectionalLight.Default;

        if (data.TryGetProperty("color", out JsonElement color))
        {
            light.Color = SceneJson.ReadVec3(color, "color");
        }

        if (data.TryGetProperty("ambient", out JsonElement ambient))
        {
            light.Ambient = SceneJson.ReadVec3(ambient, "ambient");
        }

        if (data.TryGetProperty("intensity", out JsonElement intensity))
        {
            light.Intensity = intensity.GetSingle();
        }

        if (data.TryGetProperty("primary", out JsonElement primary))
        {
            light.Primary = primary.GetBoolean();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            light.Enabled = enabled.GetBoolean();
        }

        return light;
    }
}

/// <summary>JSON codec for <see cref="ScenePointLight"/>.</summary>
public sealed class ScenePointLightCodec : SceneDataCodec<ScenePointLight>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in ScenePointLight value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJson.WriteVec3(writer, "color", value.Color);
        writer.WriteNumber("intensity", value.Intensity);
        writer.WriteNumber("range", value.Range);
        writer.WriteNumber("attenuation", value.Attenuation);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override ScenePointLight Read(JsonElement data)
    {
        ScenePointLight light = ScenePointLight.Default;

        if (data.TryGetProperty("color", out JsonElement color))
        {
            light.Color = SceneJson.ReadVec3(color, "color");
        }

        if (data.TryGetProperty("intensity", out JsonElement intensity))
        {
            light.Intensity = intensity.GetSingle();
        }

        if (data.TryGetProperty("range", out JsonElement range))
        {
            light.Range = range.GetSingle();
        }

        if (data.TryGetProperty("attenuation", out JsonElement attenuation))
        {
            light.Attenuation = attenuation.GetSingle();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            light.Enabled = enabled.GetBoolean();
        }

        return light;
    }
}

/// <summary>JSON codec for <see cref="SceneSpotLight"/>.</summary>
public sealed class SceneSpotLightCodec : SceneDataCodec<SceneSpotLight>
{
    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneSpotLight value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJson.WriteVec3(writer, "color", value.Color);
        writer.WriteNumber("intensity", value.Intensity);
        writer.WriteNumber("range", value.Range);
        writer.WriteNumber("attenuation", value.Attenuation);
        writer.WriteNumber("innerConeAngle", value.InnerConeAngleRadians);
        writer.WriteNumber("outerConeAngle", value.OuterConeAngleRadians);
        writer.WriteBoolean("enabled", value.Enabled);
    }

    /// <inheritdoc/>
    public override SceneSpotLight Read(JsonElement data)
    {
        SceneSpotLight light = SceneSpotLight.Default;

        if (data.TryGetProperty("color", out JsonElement color))
        {
            light.Color = SceneJson.ReadVec3(color, "color");
        }

        if (data.TryGetProperty("intensity", out JsonElement intensity))
        {
            light.Intensity = intensity.GetSingle();
        }

        if (data.TryGetProperty("range", out JsonElement range))
        {
            light.Range = range.GetSingle();
        }

        if (data.TryGetProperty("attenuation", out JsonElement attenuation))
        {
            light.Attenuation = attenuation.GetSingle();
        }

        if (data.TryGetProperty("innerConeAngle", out JsonElement innerConeAngle))
        {
            light.InnerConeAngleRadians = innerConeAngle.GetSingle();
        }

        if (data.TryGetProperty("outerConeAngle", out JsonElement outerConeAngle))
        {
            light.OuterConeAngleRadians = outerConeAngle.GetSingle();
        }

        if (data.TryGetProperty("enabled", out JsonElement enabled))
        {
            light.Enabled = enabled.GetBoolean();
        }

        return light;
    }
}

/// <summary>Shared JSON primitives for the rendering codecs.</summary>
internal static class SceneJson
{
    public static void WriteAssetId<TTag>(
        Utf8JsonWriter writer,
        string name,
        SceneAssetId<TTag> id,
        SceneNameTable names)
        where TTag : struct
    {
        if (!id.IsValid)
        {
            return;
        }

        if (!names.TryResolve(id.Value, out string? resolved))
        {
            throw Invalid(
                $"Asset reference '{name}' is not present in the scene name table; " +
                "create ids through SceneAssetRegistry.CreateId.");
        }

        writer.WriteString(name, resolved);
    }

    public static bool TryReadAssetId<TTag>(
        JsonElement data,
        string name,
        SceneNameTable names,
        out SceneAssetId<TTag> id)
        where TTag : struct
    {
        id = default;
        if (!data.TryGetProperty(name, out JsonElement element))
        {
            return false;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            throw Invalid($"Asset reference '{name}' must be a string.");
        }

        string? value = element.GetString();
        id = string.IsNullOrEmpty(value)
            ? default
            : SceneAssetId<TTag>.FromSymbol(names.Intern(value));
        return true;
    }

    public static void WriteVec2(Utf8JsonWriter writer, string name, in Vec2 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteEndArray();
    }

    public static void WriteVec3(Utf8JsonWriter writer, string name, in Vec3 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteEndArray();
    }

    public static void WriteVec4(Utf8JsonWriter writer, string name, in Vec4 value)
    {
        writer.WriteStartArray(name);
        writer.WriteNumberValue(value.X);
        writer.WriteNumberValue(value.Y);
        writer.WriteNumberValue(value.Z);
        writer.WriteNumberValue(value.W);
        writer.WriteEndArray();
    }

    public static Vec2 ReadVec2(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 2)
        {
            throw Invalid($"'{name}' must be a two-component array.");
        }

        return new Vec2(
            element[0].GetSingle(),
            element[1].GetSingle());
    }

    public static Vec3 ReadVec3(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 3)
        {
            throw Invalid($"'{name}' must be a three-component array.");
        }

        return new Vec3(
            element[0].GetSingle(),
            element[1].GetSingle(),
            element[2].GetSingle());
    }

    public static Vec4 ReadVec4(JsonElement element, string name)
    {
        if (element.ValueKind != JsonValueKind.Array || element.GetArrayLength() < 4)
        {
            throw Invalid($"'{name}' must be a four-component array.");
        }

        return new Vec4(
            element[0].GetSingle(),
            element[1].GetSingle(),
            element[2].GetSingle(),
            element[3].GetSingle());
    }

    [DoesNotReturn]
    public static SceneValidationException Invalid(string message) =>
        throw new SceneValidationException(SceneErrorCodes.ValidationInvalid, message);
}
