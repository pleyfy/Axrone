namespace Axrone.Scene.Prefab;

/// <summary>
/// Authoring helpers for derived prefabs: variants that store only a delta,
/// baking overrides back into a base definition, and unpacking a resolved
/// instance into a standalone prefab.
/// </summary>
public static class ScenePrefabVariants
{
    /// <summary>Creates a variant that stores overrides relative to a base prefab id.</summary>
    public static ScenePrefabDefinition CreateVariant(
        string baseId,
        string variantId,
        IReadOnlyList<ScenePrefabOverrideOperation>? overrides = null,
        ScenePrefabMetadata? metadata = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(baseId);
        ArgumentException.ThrowIfNullOrWhiteSpace(variantId);

        return new ScenePrefabDefinition(
            variantId,
            [],
            ScenePrefabKind.Variant,
            metadata,
            basePrefab: ScenePrefabReference.FromRegistry(baseId),
            overrides: overrides);
    }

    /// <summary>Bakes overrides into a base definition, producing a standalone prefab.</summary>
    public static ScenePrefabDefinition ApplyOverridesToBase(
        ScenePrefabDefinition basePrefab,
        IReadOnlyList<ScenePrefabOverrideOperation>? overrides = null)
    {
        ArgumentNullException.ThrowIfNull(basePrefab);

        ScenePrefabDefinition applied = overrides is { Count: > 0 }
            ? ScenePrefabOverrides.Apply(basePrefab, overrides)
            : basePrefab;

        return new ScenePrefabDefinition(
            basePrefab.Id,
            applied.Entities,
            ScenePrefabKind.Prefab,
            basePrefab.Metadata);
    }

    /// <summary>
    /// Unpacks a resolved definition into a standalone prefab: overrides are
    /// applied, composition layers are dropped and the result carries no base,
    /// nested, override or lineage metadata.
    /// </summary>
    public static ScenePrefabDefinition Unpack(
        ScenePrefabDefinition definition,
        IReadOnlyList<ScenePrefabOverrideOperation>? overrides = null,
        string? unpackedId = null)
    {
        ArgumentNullException.ThrowIfNull(definition);

        ScenePrefabDefinition applied = overrides is { Count: > 0 }
            ? ScenePrefabOverrides.Apply(definition, overrides)
            : definition;
        SceneEntitySnapshot[] unpacked = new SceneEntitySnapshot[applied.Entities.Count];
        for (int i = 0; i < applied.Entities.Count; i++)
        {
            unpacked[i] = applied.Entities[i].WithoutSource();
        }

        return new ScenePrefabDefinition(
            string.IsNullOrWhiteSpace(unpackedId) ? definition.Id : unpackedId,
            unpacked,
            ScenePrefabKind.Prefab,
            definition.Metadata);
    }
}
