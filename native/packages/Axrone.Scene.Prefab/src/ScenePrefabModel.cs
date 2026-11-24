namespace Axrone.Scene.Prefab;

using System.Collections.Frozen;

/// <summary>Stable prefab error codes.</summary>
public static class ScenePrefabErrorCodes
{
    /// <summary>Definition or snapshot validation failed.</summary>
    public const string Invalid = "scene.prefab.invalid";

    /// <summary>Two entities share a node id.</summary>
    public const string DuplicateNode = "scene.prefab.duplicate-node";

    /// <summary>A parent node id does not resolve.</summary>
    public const string MissingParent = "scene.prefab.missing-parent";

    /// <summary>The hierarchy contains a cycle.</summary>
    public const string Cycle = "scene.prefab.cycle";

    /// <summary>A component snapshot has no registered codec.</summary>
    public const string UnknownComponent = "scene.prefab.unknown-component";

    /// <summary>An override references a node that is not present.</summary>
    public const string UnknownNode = "scene.prefab.unknown-node";

    /// <summary>An override operation is malformed or not applicable.</summary>
    public const string InvalidOverride = "scene.prefab.invalid-override";

    /// <summary>A component property path cannot be resolved.</summary>
    public const string InvalidPath = "scene.prefab.invalid-path";

    /// <summary>An entity already carries the component type or id.</summary>
    public const string DuplicateComponent = "scene.prefab.duplicate-component";

    /// <summary>A registry reference cannot be resolved, is stale or cycles.</summary>
    public const string ResolutionFailed = "scene.prefab.resolution-failed";

    /// <summary>Instantiation failed and was rolled back.</summary>
    public const string InstantiationFailed = "scene.prefab.instantiation-failed";

    /// <summary>An entity has no stable node id in its owning prefab context.</summary>
    public const string MissingStableNodeId = "scene.prefab.missing-stable-node-id";

    /// <summary>Provenance metadata is malformed or exceeds a fixed capacity.</summary>
    public const string InvalidProvenance = "scene.prefab.invalid-provenance";

    /// <summary>A JSON string sequence contains an explicit null element.</summary>
    public const string InvalidNullElement = "scene.prefab.invalid-null-element";
}

/// <summary>Prefab failure with an optional node id.</summary>
public sealed class ScenePrefabException : SceneException
{
    /// <summary>Node involved in the failure, when known.</summary>
    public string? NodeId { get; }

    /// <summary>Creates a prefab failure.</summary>
    public ScenePrefabException(string code, string message, string? nodeId = null, Exception? inner = null)
        : base(code, nodeId is null ? message : $"{nodeId}: {message}", inner)
    {
        NodeId = nodeId;
    }
}

/// <summary>Prefab definition kind.</summary>
public enum ScenePrefabKind
{
    /// <summary>Regular prefab.</summary>
    Prefab = 0,

    /// <summary>Variant over a base prefab.</summary>
    Variant = 1,

    /// <summary>Fully resolved definition.</summary>
    Resolved = 2
}

/// <summary>Optional authoring metadata.</summary>
public sealed record ScenePrefabMetadata
{
    /// <summary>Revision marker.</summary>
    public string? Revision { get; init; }

    /// <summary>Content locale.</summary>
    public string? Locale { get; init; }

    /// <summary>Last update timestamp.</summary>
    public string? UpdatedAt { get; init; }

    /// <summary>Authoring time zone.</summary>
    public string? TimeZone { get; init; }

    /// <summary>Free-form tags.</summary>
    public IReadOnlyList<string> Tags { get; init; } = [];
}

/// <summary>Serialized component payload.</summary>
public sealed class SceneComponentSnapshot
{
    /// <summary>Creates a component snapshot.</summary>
    public SceneComponentSnapshot(string type, JsonElement data, string? id = null)
    {
        if (string.IsNullOrWhiteSpace(type))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Component snapshots require a non-empty type name.");
        }

        if (data.ValueKind != JsonValueKind.Object)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Component '{type}' data must be a JSON object.",
                inner: null);
        }

        Type = type;
        Data = data.Clone();
        Id = id;
    }

    /// <summary>Registered component type name.</summary>
    public string Type { get; }

    /// <summary>Detached JSON object preserving the component payload.</summary>
    public JsonElement Data { get; }

    /// <summary>Optional stable component id.</summary>
    public string? Id { get; }
}

/// <summary>Serialized entity and its component list.</summary>
public sealed class SceneEntitySnapshot
{
    /// <summary>Creates an entity snapshot.</summary>
    public SceneEntitySnapshot(
        string nodeId,
        string name,
        ushort layer,
        string tag,
        bool active,
        bool persistent,
        bool pooled,
        IReadOnlyList<SceneComponentSnapshot> components,
        string? parentNodeId = null,
        ScenePrefabNodeSource? source = null)
    {
        if (string.IsNullOrWhiteSpace(nodeId))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Entity snapshots require a non-empty node id.");
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Entity '{nodeId}' requires a non-empty name.",
                nodeId);
        }

        if (string.IsNullOrWhiteSpace(tag))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Entity '{nodeId}' requires a non-empty tag.",
                nodeId);
        }

        ArgumentNullException.ThrowIfNull(components);

        NodeId = nodeId;
        ParentNodeId = parentNodeId;
        Name = name;
        Layer = layer;
        Tag = tag;
        Active = active;
        Persistent = persistent;
        Pooled = pooled;
        Components = [.. components];
        Source = source;
    }

    /// <summary>Stable node id inside the prefab.</summary>
    public string NodeId { get; }

    /// <summary>Parent node id, or null for a root.</summary>
    public string? ParentNodeId { get; }

    /// <summary>Entity name.</summary>
    public string Name { get; }

    /// <summary>Entity layer.</summary>
    public ushort Layer { get; }

    /// <summary>Entity tag.</summary>
    public string Tag { get; }

    /// <summary>Whether the entity starts active.</summary>
    public bool Active { get; }

    /// <summary>Whether the entity is persistent.</summary>
    public bool Persistent { get; }

    /// <summary>Whether the entity is pooled.</summary>
    public bool Pooled { get; }

    /// <summary>Component snapshots in declaration order.</summary>
    public IReadOnlyList<SceneComponentSnapshot> Components { get; }

    /// <summary>Stable prefab origin, or null for an authored snapshot without composition provenance.</summary>
    public ScenePrefabNodeSource? Source { get; }

    /// <summary>Returns the same entity snapshot with composition provenance removed.</summary>
    public SceneEntitySnapshot WithoutSource() => Source is null
        ? this
        : new SceneEntitySnapshot(
            NodeId,
            Name,
            Layer,
            Tag,
            Active,
            Persistent,
            Pooled,
            Components,
            ParentNodeId);

    /// <summary>Returns a copy carrying composition provenance.</summary>
    public SceneEntitySnapshot WithSource(ScenePrefabNodeSource source) => new(
        NodeId,
        Name,
        Layer,
        Tag,
        Active,
        Persistent,
        Pooled,
        Components,
        ParentNodeId,
        source);
}

/// <summary>Immutable prefab definition.</summary>
public sealed class ScenePrefabDefinition
{
    /// <summary>Creates a prefab definition and validates its composition layers.</summary>
    public ScenePrefabDefinition(
        string id,
        IReadOnlyList<SceneEntitySnapshot> entities,
        ScenePrefabKind kind = ScenePrefabKind.Prefab,
        ScenePrefabMetadata? metadata = null,
        ScenePrefabReference? basePrefab = null,
        IReadOnlyList<ScenePrefabNestedInstance>? nested = null,
        IReadOnlyList<ScenePrefabOverrideOperation>? overrides = null,
        IReadOnlyList<string>? lineage = null)
    {
        if (string.IsNullOrWhiteSpace(id))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                "Prefab definitions require a non-empty id.");
        }

        ArgumentNullException.ThrowIfNull(entities);

        ScenePrefabNestedInstance[] nestedArray = nested is null ? [] : [.. nested];
        ScenePrefabOverrideOperation[] overrideArray = overrides is null ? [] : [.. overrides];

        if (kind == ScenePrefabKind.Variant && basePrefab is null)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Variant prefab '{id}' requires a base reference.");
        }

        if (kind == ScenePrefabKind.Resolved &&
            (basePrefab is not null || nestedArray.Length > 0 || overrideArray.Length > 0))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Resolved prefab '{id}' cannot declare base, nested or override layers.");
        }

        ValidateNestedInstances(id, nestedArray);

        SceneEntitySnapshot[] entityArray = [.. entities];
        // Layered definitions may reference entities inherited from a base or a
        // nested instance, so links are only validated once resolution flattens
        // them into a standalone definition.
        bool selfContained = basePrefab is null && nestedArray.Length == 0;
        ValidateHierarchy(id, entityArray, validateLinks: selfContained);

        Id = id;
        Kind = kind;
        Entities = entityArray;
        Metadata = metadata;
        Base = basePrefab;
        Nested = nestedArray;
        Overrides = overrideArray;
        Lineage = lineage is null ? [] : [.. lineage];
    }

    /// <summary>Prefab id.</summary>
    public string Id { get; }

    /// <summary>Definition kind.</summary>
    public ScenePrefabKind Kind { get; }

    /// <summary>Entities in declaration order.</summary>
    public IReadOnlyList<SceneEntitySnapshot> Entities { get; }

    /// <summary>Optional metadata.</summary>
    public ScenePrefabMetadata? Metadata { get; }

    /// <summary>Optional base prefab this definition derives from.</summary>
    public ScenePrefabReference? Base { get; }

    /// <summary>Nested prefab instances merged into this definition.</summary>
    public IReadOnlyList<ScenePrefabNestedInstance> Nested { get; }

    /// <summary>Override operations applied after base, nested and own entities.</summary>
    public IReadOnlyList<ScenePrefabOverrideOperation> Overrides { get; }

    /// <summary>Resolution lineage from the root prefab to this definition.</summary>
    public IReadOnlyList<string> Lineage { get; }

    private static void ValidateNestedInstances(
        string prefabId,
        ScenePrefabNestedInstance[] nested)
    {
        if (nested.Length == 0)
        {
            return;
        }

        HashSet<string> instanceIds = new(StringComparer.Ordinal);
        for (int i = 0; i < nested.Length; i++)
        {
            ScenePrefabNestedInstance instance = nested[i];
            if (!instanceIds.Add(instance.InstanceId))
            {
                throw new ScenePrefabException(
                    ScenePrefabErrorCodes.DuplicateNode,
                    $"Prefab '{prefabId}' declares nested instance id '{instance.InstanceId}' more than once.",
                    instance.InstanceId);
            }
        }
    }

    private static void ValidateHierarchy(
        string prefabId,
        SceneEntitySnapshot[] entities,
        bool validateLinks)
    {
        Dictionary<string, SceneEntitySnapshot> byNode = new(StringComparer.Ordinal);
        for (int i = 0; i < entities.Length; i++)
        {
            SceneEntitySnapshot entity = entities[i];
            if (!byNode.TryAdd(entity.NodeId, entity))
            {
                throw new ScenePrefabException(
                    ScenePrefabErrorCodes.DuplicateNode,
                    $"Prefab '{prefabId}' declares node id '{entity.NodeId}' more than once.",
                    entity.NodeId);
            }
        }

        foreach (SceneEntitySnapshot entity in entities)
        {
            HashSet<string> componentTypes = new(StringComparer.Ordinal);
            HashSet<string> componentIds = new(StringComparer.Ordinal);

            for (int i = 0; i < entity.Components.Count; i++)
            {
                SceneComponentSnapshot component = entity.Components[i];
                if (!componentTypes.Add(component.Type))
                {
                    throw new ScenePrefabException(
                        ScenePrefabErrorCodes.DuplicateComponent,
                        $"Entity '{entity.NodeId}' declares component type '{component.Type}' more than once.",
                        entity.NodeId);
                }

                if (component.Id is { } componentId && !componentIds.Add(componentId))
                {
                    throw new ScenePrefabException(
                        ScenePrefabErrorCodes.DuplicateComponent,
                        $"Entity '{entity.NodeId}' declares component id '{componentId}' more than once.",
                        entity.NodeId);
                }
            }
        }

        if (!validateLinks)
        {
            return;
        }

        foreach (SceneEntitySnapshot entity in entities)
        {
            if (entity.ParentNodeId is not { } parentId)
            {
                continue;
            }

            if (!byNode.ContainsKey(parentId))
            {
                throw new ScenePrefabException(
                    ScenePrefabErrorCodes.MissingParent,
                    $"Parent node '{parentId}' does not exist.",
                    entity.NodeId);
            }
        }

        foreach (SceneEntitySnapshot entity in entities)
        {
            HashSet<string> seen = new(StringComparer.Ordinal);
            string? current = entity.NodeId;
            while (current is not null)
            {
                if (!seen.Add(current))
                {
                    throw new ScenePrefabException(
                        ScenePrefabErrorCodes.Cycle,
                        $"Prefab '{prefabId}' contains a hierarchy cycle at '{current}'.",
                        current);
                }

                current = byNode[current].ParentNodeId;
            }
        }
    }
}

/// <summary>Instantiation settings.</summary>
public record ScenePrefabInstantiateOptions
{
    /// <summary>Optional prefix applied to every entity name.</summary>
    public string? NamePrefix { get; init; }

    /// <summary>
    /// Resolver used to flatten variants and nested instances before creation.
    /// When null, a resolver without a registry source is used, so inline
    /// references still work and registry references fail loudly.
    /// </summary>
    public ScenePrefabResolver? Resolver { get; init; }

    /// <summary>Instance overrides applied after resolution and before creation.</summary>
    public IReadOnlyList<ScenePrefabOverrideOperation>? LiveOverrides { get; init; }
}

/// <summary>Entities created by one instantiation, keyed by prefab node id.</summary>
public sealed class ScenePrefabInstantiationResult
{
    /// <summary>Creates an instantiation result.</summary>
    public ScenePrefabInstantiationResult(
        IReadOnlyList<SceneEntity> entities,
        IReadOnlyDictionary<string, SceneEntity> nodeMap,
        IReadOnlyList<ScenePrefabNodeSource>? sources = null)
    {
        ArgumentNullException.ThrowIfNull(entities);
        ArgumentNullException.ThrowIfNull(nodeMap);

        Entities = [.. entities];
        NodeMap = nodeMap.ToFrozenDictionary(StringComparer.Ordinal);
        Sources = sources is null ? [] : [.. sources];
    }

    /// <summary>Created entities in prefab declaration order.</summary>
    public IReadOnlyList<SceneEntity> Entities { get; }

    /// <summary>Created entities keyed by node id.</summary>
    public IReadOnlyDictionary<string, SceneEntity> NodeMap { get; }

    /// <summary>Provenance for each entity in <see cref="Entities"/> declaration order.</summary>
    public IReadOnlyList<ScenePrefabNodeSource> Sources { get; }
}
