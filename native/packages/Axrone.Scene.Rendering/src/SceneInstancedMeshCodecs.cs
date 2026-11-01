namespace Axrone.Scene.Rendering;

using System.Text.Json;

/// <summary>JSON codec for <see cref="SceneInstancedMeshRenderer"/>.</summary>
public sealed class SceneInstancedMeshRendererCodec : SceneDataCodec<SceneInstancedMeshRenderer>
{
    private readonly SceneNameTable _names;

    /// <summary>Creates a codec that resolves mesh, material and pass names.</summary>
    public SceneInstancedMeshRendererCodec(SceneNameTable names)
    {
        ArgumentNullException.ThrowIfNull(names);
        _names = names;
    }

    /// <inheritdoc/>
    public override void Write(Utf8JsonWriter writer, in SceneInstancedMeshRenderer value)
    {
        ArgumentNullException.ThrowIfNull(writer);

        SceneJson.WriteAssetId(writer, "mesh", value.MeshId, _names);
        SceneJson.WriteAssetId(writer, "material", value.MaterialId, _names);
        SceneJson.WriteAssetId(writer, "pass", value.PassId, _names);
        writer.WriteNumber("group", value.InstanceGroupId);
        writer.WriteBoolean("visible", value.Visible);
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
    public override SceneInstancedMeshRenderer Read(JsonElement data)
    {
        SceneInstancedMeshRenderer value = SceneInstancedMeshRenderer.Default;

        if (SceneJson.TryReadAssetId(data, "mesh", _names, out SceneAssetId<MeshAssetTag> mesh))
        {
            value.MeshId = mesh;
        }

        if (SceneJson.TryReadAssetId(data, "material", _names, out SceneAssetId<MaterialAssetTag> material))
        {
            value.MaterialId = material;
        }

        if (SceneJson.TryReadAssetId(data, "pass", _names, out SceneAssetId<RenderPassAssetTag> pass))
        {
            value.PassId = pass;
        }

        if (data.TryGetProperty("group", out JsonElement group))
        {
            value.InstanceGroupId = (uint)group.GetInt32();
        }

        if (data.TryGetProperty("visible", out JsonElement visible))
        {
            value.Visible = visible.GetBoolean();
        }

        if (data.TryGetProperty("transparent", out JsonElement transparent))
        {
            value.Transparent = transparent.GetBoolean();
        }

        if (data.TryGetProperty("renderOrder", out JsonElement renderOrder))
        {
            value.RenderOrder = renderOrder.GetInt32();
        }

        if (data.TryGetProperty("bounds", out JsonElement bounds) && bounds.ValueKind == JsonValueKind.Object)
        {
            Vec3 center = SceneJson.ReadVec3(bounds.GetProperty("center"), "center");
            float radius = bounds.TryGetProperty("radius", out JsonElement radiusElement) ? radiusElement.GetSingle() : 0.0f;
            value.Bounds = new BoundingSphere3(center, radius);
        }

        return value;
    }
}
