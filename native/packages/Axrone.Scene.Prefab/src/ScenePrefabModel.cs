namespace Axrone.Scene.Prefab;

using System.Collections.Frozen;

/// <summary>Stable prefab error codes.</summary>
public static class ScenePrefabErrorCodes
{
    /// <summary>Definition or snapshot validation failed.</summary>
    public const string Invalid = "scene.prefab.invalid";

    /// <summary>Two actors share a node id.</summary>
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

    /// <summary>An actor already carries the component type or id.</summary>
    public const string DuplicateComponent = "scene.prefab.duplicate-component";

    /// <summary>A registry reference cannot be resolved, is stale or cycles.</summary>
    public const string ResolutionFailed = "scene.prefab.resolution-failed";

    /// <summary>Instantiation failed and was rolled back.</summary>
    public const string InstantiationFailed = "scene.prefab.instantiation-failed";

    /// <summary>An actor has no stable node id in its owning prefab context.</summary>
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

/// <summary>Serialized actor and its component list.</summary>
public sealed class SceneActorSnapshot
{
    /// <summary>Creates an actor snapshot.</summary>
    public SceneActorSnapshot(
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
                "Actor snapshots require a non-empty node id.");
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Actor '{nodeId}' requires a non-empty name.",
                nodeId);
        }

        if (string.IsNullOrWhiteSpace(tag))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.Invalid,
                $"Actor '{nodeId}' requires a non-empty tag.",
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

    /// <summary>Actor name.</summary>
    public string Name { get; }

    /// <summary>Actor layer.</summary>
    public ushort Layer { get; }

    /// <summary>Actor tag.</summary>
    public string Tag { get; }

    /// <summary>Whether the actor starts active.</summary>
    public bool Active { get; }

    /// <summary>Whether the actor is persistent.</summary>
    public bool Persistent { get; }

    /// <summary>Whether the actor is pooled.</summary>
    public bool Pooled { get; }

    /// <summary>Component snapshots in declaration order.</summary>
    public IReadOnlyList<SceneComponentSnapshot> Components { get; }

    /// <summary>Stable prefab origin, or null for an authored snapshot without composition provenance.</summary>
    public ScenePrefabNodeSource? Source { get; }

    /// <summary>Returns the same actor snapshot with composition provenance removed.</summary>
    public SceneActorSnapshot WithoutSource() => Source is null
        ? this
        : new SceneActorSnapshot(
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
    public SceneActorSnapshot WithSource(ScenePrefabNodeSource source) => new(
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
        IReadOnlyList<SceneActorSnapshot> actors,
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

        ArgumentNullException.ThrowIfNull(actors);

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

        SceneActorSnapshot[] actorArray = [.. actors];
        // Layered definitions may reference actors inherited from a base or a
        // nested instance, so links are only validated once resolution flattens
        // them into a standalone definition.
        bool selfContained = basePrefab is null && nestedArray.Length == 0;
        ValidateHierarchy(id, actorArray, validateLinks: selfContained);

        Id = id;
        Kind = kind;
        Actors = actorArray;
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

    /// <summary>Actors in declaration order.</summary>
    public IReadOnlyList<SceneActorSnapshot> Actors { get; }

    /// <summary>Optional metadata.</summary>
    public ScenePrefabMetadata? Metadata { get; }

    /// <summary>Optional base prefab this definition derives from.</summary>
    public ScenePrefabReference? Base { get; }

    /// <summary>Nested prefab instances merged into this definition.</summary>
    public IReadOnlyList<ScenePrefabNestedInstance> Nested { get; }

    /// <summary>Override operations applied after base, nested and own actors.</summary>
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
        SceneActorSnapshot[] actors,
        bool validateLinks)
    {
        Dictionary<string, SceneActorSnapshot> byNode = new(StringComparer.Ordinal);
        for (int i = 0; i < actors.Length; i++)
        {
            SceneActorSnapshot actor = actors[i];
            if (!byNode.TryAdd(actor.NodeId, actor))
            {
                throw new ScenePrefabException(
                    ScenePrefabErrorCodes.DuplicateNode,
                    $"Prefab '{prefabId}' declares node id '{actor.NodeId}' more than once.",
                    actor.NodeId);
            }
        }

        foreach (SceneActorSnapshot actor in actors)
        {
            HashSet<string> componentTypes = new(StringComparer.Ordinal);
            HashSet<string> componentIds = new(StringComparer.Ordinal);

            for (int i = 0; i < actor.Components.Count; i++)
            {
                SceneComponentSnapshot component = actor.Components[i];
                if (!componentTypes.Add(component.Type))
                {
                    throw new ScenePrefabException(
                        ScenePrefabErrorCodes.DuplicateComponent,
                        $"Actor '{actor.NodeId}' declares component type '{component.Type}' more than once.",
                        actor.NodeId);
                }

                if (component.Id is { } componentId && !componentIds.Add(componentId))
                {
                    throw new ScenePrefabException(
                        ScenePrefabErrorCodes.DuplicateComponent,
                        $"Actor '{actor.NodeId}' declares component id '{componentId}' more than once.",
                        actor.NodeId);
                }
            }
        }

        if (!validateLinks)
        {
            return;
        }

        foreach (SceneActorSnapshot actor in actors)
        {
            if (actor.ParentNodeId is not { } parentId)
            {
                continue;
            }

            if (!byNode.ContainsKey(parentId))
            {
                throw new ScenePrefabException(
                    ScenePrefabErrorCodes.MissingParent,
                    $"Parent node '{parentId}' does not exist.",
                    actor.NodeId);
            }
        }

        foreach (SceneActorSnapshot actor in actors)
        {
            HashSet<string> seen = new(StringComparer.Ordinal);
            string? current = actor.NodeId;
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
    /// <summary>Optional prefix applied to every actor name.</summary>
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

/// <summary>Actors created by one instantiation, keyed by prefab node id.</summary>
public sealed class ScenePrefabInstantiationResult
{
    /// <summary>Creates an instantiation result.</summary>
    public ScenePrefabInstantiationResult(
        IReadOnlyList<SceneActor> actors,
        IReadOnlyDictionary<string, SceneActor> nodeMap,
        IReadOnlyList<ScenePrefabNodeSource>? sources = null)
    {
        ArgumentNullException.ThrowIfNull(actors);
        ArgumentNullException.ThrowIfNull(nodeMap);

        Actors = [.. actors];
        NodeMap = nodeMap.ToFrozenDictionary(StringComparer.Ordinal);
        Sources = sources is null ? [] : [.. sources];
    }

    /// <summary>Created actors in prefab declaration order.</summary>
    public IReadOnlyList<SceneActor> Actors { get; }

    /// <summary>Created actors keyed by node id.</summary>
    public IReadOnlyDictionary<string, SceneActor> NodeMap { get; }

    /// <summary>Provenance for each actor in <see cref="Actors"/> declaration order.</summary>
    public IReadOnlyList<ScenePrefabNodeSource> Sources { get; }
}
