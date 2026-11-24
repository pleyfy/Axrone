namespace Axrone.Scene.Prefab;

using System.Buffers;

/// <summary>
/// Builds prefab definitions from a live scene world. Node ids are entity slots,
/// which keeps snapshots stable for the lifetime of one world.
/// </summary>
public static class ScenePrefabFactory
{
    /// <summary>Creates a prefab from every live entity.</summary>
    public static ScenePrefabDefinition Create(
        SceneWorld world,
        SceneCodecRegistry codecs,
        string id,
        ScenePrefabMetadata? metadata = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(codecs);

        if (string.IsNullOrWhiteSpace(id))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Prefab definitions require a non-empty id.");
        }

        var entities = new List<SceneEntitySnapshot>(world.EntityCount);

        foreach (SceneEntity entity in world.Entities)
        {
            string nodeId = entity.Slot.ToString(CultureInfo.InvariantCulture);
            SceneEntity parent = world.Hierarchy.ParentOf(entity);
            string? parentNodeId = parent.IsValid
                ? parent.Slot.ToString(CultureInfo.InvariantCulture)
                : null;

            SceneComponentMask mask = world.GetComponentMask(entity);
            var components = new List<SceneComponentSnapshot>(codecs.Count);
            ReadOnlySpan<SceneCodecRegistration> registrations = codecs.Registrations;

            for (int i = 0; i < registrations.Length; i++)
            {
                ref readonly SceneCodecRegistration registration = ref registrations[i];
                if (!mask.IsSet(registration.Descriptor.TypeId))
                {
                    continue;
                }

                string typeName = world.Names.Resolve(registration.Descriptor.Name);
                JsonElement data = CaptureComponent(world, entity, registration.Codec);
                components.Add(new SceneComponentSnapshot(typeName, data));
            }

            components.Sort(static (left, right) =>
                string.CompareOrdinal(left.Type, right.Type));

            entities.Add(new SceneEntitySnapshot(
                nodeId,
                world.GetName(entity),
                world.LayerOf(entity),
                world.GetTag(entity),
                world.IsActiveSelf(entity),
                world.IsPersistent(entity),
                world.IsPooled(entity),
                components,
                parentNodeId));
        }

        return new ScenePrefabDefinition(id, entities, ScenePrefabKind.Prefab, metadata);
    }

    private static JsonElement CaptureComponent(
        SceneWorld world,
        SceneEntity entity,
        ISceneDataCodec codec)
    {
        var buffer = new ArrayBufferWriter<byte>();
        using (var writer = new Utf8JsonWriter(buffer))
        {
            writer.WriteStartObject();
            codec.Write(world, entity, writer);
            writer.WriteEndObject();
        }

        using JsonDocument document = JsonDocument.Parse(buffer.WrittenMemory);
        return document.RootElement.Clone();
    }
}
