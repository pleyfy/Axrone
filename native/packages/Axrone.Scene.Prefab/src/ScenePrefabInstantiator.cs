namespace Axrone.Scene.Prefab;

/// <summary>
/// Two-phase prefab instantiation: entities and hierarchy first, components
/// second. Any failure rolls the created entities back before a coded prefab
/// error is thrown.
/// </summary>
public static class ScenePrefabInstantiator
{
    /// <summary>Instantiates a prefab into a scene world.</summary>
    public static ScenePrefabInstantiationResult Instantiate(
        SceneWorld world,
        SceneCodecRegistry codecs,
        ScenePrefabDefinition prefab,
        ScenePrefabInstantiateOptions? options = null)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(codecs);
        ArgumentNullException.ThrowIfNull(prefab);

        ScenePrefabDefinition effective = Prepare(prefab, options);
        var created = new List<SceneEntity>(effective.Entities.Count);
        var sources = new List<ScenePrefabNodeSource>(effective.Entities.Count);
        var nodeMap = new Dictionary<string, SceneEntity>(effective.Entities.Count, StringComparer.Ordinal);

        try
        {
            for (int i = 0; i < effective.Entities.Count; i++)
            {
                SceneEntitySnapshot snapshot = effective.Entities[i];
                string name = options?.NamePrefix is { Length: > 0 } prefix
                    ? string.Concat(prefix, snapshot.Name)
                    : snapshot.Name;

                SceneEntity entity = world.CreateEntity(new SceneEntityConfig(
                    name,
                    snapshot.Tag,
                    snapshot.Layer,
                    snapshot.Active,
                    snapshot.Persistent,
                    snapshot.Pooled));

                created.Add(entity);
                sources.Add(snapshot.Source ?? ScenePrefabNodeIdentity.CreateFallback(
                    effective.Id,
                    snapshot.NodeId,
                    effective.Lineage,
                    i));
                nodeMap.Add(snapshot.NodeId, entity);
            }

            for (int i = 0; i < effective.Entities.Count; i++)
            {
                SceneEntitySnapshot snapshot = effective.Entities[i];
                if (snapshot.ParentNodeId is not { } parentNodeId)
                {
                    continue;
                }

                if (!nodeMap.TryGetValue(parentNodeId, out SceneEntity parent))
                {
                    throw new ScenePrefabException(
                        ScenePrefabErrorCodes.MissingParent,
                        $"Parent node '{parentNodeId}' was not created.",
                        snapshot.NodeId);
                }

                world.Hierarchy.SetParent(nodeMap[snapshot.NodeId], parent);
            }

            for (int i = 0; i < effective.Entities.Count; i++)
            {
                SceneEntitySnapshot snapshot = effective.Entities[i];
                SceneEntity entity = nodeMap[snapshot.NodeId];

                for (int componentIndex = 0; componentIndex < snapshot.Components.Count; componentIndex++)
                {
                    SceneComponentSnapshot component = snapshot.Components[componentIndex];
                    if (!codecs.TryGet(component.Type, out ISceneDataCodec? codec))
                    {
                        throw new ScenePrefabException(
                            ScenePrefabErrorCodes.UnknownComponent,
                            $"No codec is registered for component '{component.Type}'.",
                            snapshot.NodeId);
                    }

                    codec.ReadInto(world, entity, component.Data);
                }
            }

            return new ScenePrefabInstantiationResult(created, nodeMap, sources);
        }
        catch (Exception exception)
        {
            Rollback(world, created);

            if (exception is ScenePrefabException)
            {
                throw;
            }

            throw new ScenePrefabException(
                ScenePrefabErrorCodes.InstantiationFailed,
                "Prefab instantiation failed and was rolled back.",
                inner: exception);
        }
    }

    /// <summary>
    /// Flattens variant and nested composition, then applies live instance
    /// overrides. Registry references require a resolver with a prefab source;
    /// without one they fail loudly instead of instantiating nothing.
    /// </summary>
    private static ScenePrefabDefinition Prepare(
        ScenePrefabDefinition prefab,
        ScenePrefabInstantiateOptions? options)
    {
        ScenePrefabDefinition effective = prefab;
        bool hasComposition =
            prefab.Base is not null ||
            prefab.Nested.Count > 0 ||
            prefab.Overrides.Count > 0;

        if (hasComposition)
        {
            ScenePrefabResolver resolver = options?.Resolver ?? new ScenePrefabResolver();
            effective = resolver.Resolve(effective).Definition;
        }

        if (options?.LiveOverrides is { Count: > 0 } overrides)
        {
            effective = ScenePrefabOverrides.Apply(effective, overrides);
        }

        return effective;
    }

    private static void Rollback(SceneWorld world, List<SceneEntity> created)
    {
        for (int i = created.Count - 1; i >= 0; i--)
        {
            try
            {
                world.DestroyEntity(created[i]);
            }
            catch
            {
                // Rollback must continue through every entity; the original
                // instantiation failure remains the reported cause.
            }
        }

        created.Clear();
    }
}
