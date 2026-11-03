namespace Axrone.Scene.Prefab;

/// <summary>Reference kinds accepted by prefab composition.</summary>
public enum ScenePrefabReferenceKind
{
    /// <summary>The definition travels with the reference.</summary>
    Inline = 0,

    /// <summary>The definition is resolved from a prefab source by id.</summary>
    Registry = 1
}

/// <summary>
/// Points at a prefab definition either inline or through a registry id with an
/// optional revision pin.
/// </summary>
public sealed class ScenePrefabReference
{
    private ScenePrefabReference(
        ScenePrefabReferenceKind kind,
        ScenePrefabDefinition? prefab,
        string? prefabId,
        string? revision)
    {
        Kind = kind;
        Prefab = prefab;
        PrefabId = prefabId;
        Revision = revision;
    }

    /// <summary>Reference kind.</summary>
    public ScenePrefabReferenceKind Kind { get; }

    /// <summary>Inline definition for inline references.</summary>
    public ScenePrefabDefinition? Prefab { get; }

    /// <summary>Prefab id for registry references.</summary>
    public string? PrefabId { get; }

    /// <summary>Optional revision pin for registry references.</summary>
    public string? Revision { get; }

    /// <summary>Wraps a definition that travels with the reference.</summary>
    public static ScenePrefabReference FromInline(ScenePrefabDefinition prefab)
    {
        ArgumentNullException.ThrowIfNull(prefab);
        return new ScenePrefabReference(ScenePrefabReferenceKind.Inline, prefab, null, null);
    }

    /// <summary>References a prefab by registry id.</summary>
    public static ScenePrefabReference FromRegistry(string prefabId, string? revision = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prefabId);
        return new ScenePrefabReference(
            ScenePrefabReferenceKind.Registry,
            null,
            prefabId,
            string.IsNullOrEmpty(revision) ? null : revision);
    }
}

/// <summary>
/// One nested prefab instance: the resolved actors are scoped under the
/// instance id, prefixed, attached to an optional parent and adjusted by the
/// instance's own override operations.
/// </summary>
public sealed class ScenePrefabNestedInstance
{
    /// <summary>Creates a nested instance descriptor.</summary>
    public ScenePrefabNestedInstance(
        string instanceId,
        ScenePrefabReference reference,
        string? parentNodeId = null,
        string? namePrefix = null,
        IReadOnlyList<ScenePrefabOverrideOperation>? overrides = null)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(instanceId);
        ArgumentNullException.ThrowIfNull(reference);

        InstanceId = instanceId;
        Reference = reference;
        ParentNodeId = string.IsNullOrEmpty(parentNodeId) ? null : parentNodeId;
        NamePrefix = string.IsNullOrEmpty(namePrefix) ? null : namePrefix;
        Overrides = overrides is null ? [] : [.. overrides];
    }

    /// <summary>Instance id used to scope node ids inside the host prefab.</summary>
    public string InstanceId { get; }

    /// <summary>Referenced prefab.</summary>
    public ScenePrefabReference Reference { get; }

    /// <summary>Optional host node that parents every nested root.</summary>
    public string? ParentNodeId { get; }

    /// <summary>Optional prefix applied to every nested actor name.</summary>
    public string? NamePrefix { get; }

    /// <summary>Instance-local override operations.</summary>
    public IReadOnlyList<ScenePrefabOverrideOperation> Overrides { get; }
}

/// <summary>Source consulted by <see cref="ScenePrefabResolver"/> for registry references.</summary>
public interface IScenePrefabSource
{
    /// <summary>Resolves a prefab by id, or null when it is not registered.</summary>
    ScenePrefabDefinition? GetPrefab(string prefabId);
}

/// <summary>
/// Thread-safe prefab registry. Registration is cold; reads resolve through a
/// lock so callers never observe a partially replaced entry.
/// </summary>
public sealed class ScenePrefabRegistry : IScenePrefabSource
{
    private readonly Lock _gate = new();
    private readonly Dictionary<string, ScenePrefabDefinition> _byId = new(StringComparer.Ordinal);
    private readonly IScenePrefabSource? _fallback;
    private int _version;

    /// <summary>Creates a registry with an optional fallback source.</summary>
    public ScenePrefabRegistry(IScenePrefabSource? fallback = null)
    {
        _fallback = fallback;
    }

    /// <summary>Number of registered definitions.</summary>
    public int Count
    {
        get
        {
            lock (_gate)
            {
                return _byId.Count;
            }
        }
    }

    /// <summary>Monotonic revision incremented on every mutation.</summary>
    public int Version
    {
        get
        {
            lock (_gate)
            {
                return _version;
            }
        }
    }

    /// <summary>Registers or replaces a definition.</summary>
    public ScenePrefabRegistry Register(ScenePrefabDefinition definition)
    {
        ArgumentNullException.ThrowIfNull(definition);

        lock (_gate)
        {
            _byId[definition.Id] = definition;
            _version++;
        }

        return this;
    }

    /// <summary>Registers or replaces every definition.</summary>
    public ScenePrefabRegistry RegisterAll(IReadOnlyList<ScenePrefabDefinition> definitions)
    {
        ArgumentNullException.ThrowIfNull(definitions);

        lock (_gate)
        {
            for (int i = 0; i < definitions.Count; i++)
            {
                ScenePrefabDefinition definition = definitions[i];
                ArgumentNullException.ThrowIfNull(definition);
                _byId[definition.Id] = definition;
            }

            if (definitions.Count > 0)
            {
                _version++;
            }
        }

        return this;
    }

    /// <summary>Removes a definition.</summary>
    public bool Unregister(string prefabId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prefabId);

        lock (_gate)
        {
            if (!_byId.Remove(prefabId))
            {
                return false;
            }

            _version++;
            return true;
        }
    }

    /// <summary>Removes every definition.</summary>
    public void Clear()
    {
        lock (_gate)
        {
            if (_byId.Count == 0)
            {
                return;
            }

            _byId.Clear();
            _version++;
        }
    }

    /// <inheritdoc/>
    public ScenePrefabDefinition? GetPrefab(string prefabId)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prefabId);

        lock (_gate)
        {
            if (_byId.TryGetValue(prefabId, out ScenePrefabDefinition? definition))
            {
                return definition;
            }
        }

        return _fallback?.GetPrefab(prefabId);
    }
}

/// <summary>Resolved definition plus resolution metadata.</summary>
public sealed class ScenePrefabResolutionResult
{
    /// <summary>Creates a resolution result.</summary>
    public ScenePrefabResolutionResult(ScenePrefabDefinition definition, bool cacheHit)
    {
        ArgumentNullException.ThrowIfNull(definition);
        Definition = definition;
        CacheHit = cacheHit;
    }

    /// <summary>Fully resolved, standalone definition.</summary>
    public ScenePrefabDefinition Definition { get; }

    /// <summary>Resolution lineage from the root prefab to the resolved one.</summary>
    public IReadOnlyList<string> Lineage => Definition.Lineage;

    /// <summary>Whether the result came from the resolver cache.</summary>
    public bool CacheHit { get; }
}

/// <summary>
/// Resolves variants and nested instances into one flat definition. Resolution
/// applies base actors, nested instance scopes and override layers in authoring
/// order, then validates the final hierarchy exactly once.
/// </summary>
public sealed class ScenePrefabResolver
{
    private readonly IScenePrefabSource? _source;
    private readonly bool _enableCache;
    private readonly Lock _gate = new();
    private readonly Dictionary<string, CacheEntry> _cache = new(StringComparer.Ordinal);

    /// <summary>Creates a resolver over an optional prefab source.</summary>
    public ScenePrefabResolver(IScenePrefabSource? source = null, bool enableCache = true)
    {
        _source = source;
        _enableCache = enableCache;
    }

    /// <summary>Resolves a definition, optionally applying live instance overrides.</summary>
    public ScenePrefabResolutionResult Resolve(
        ScenePrefabDefinition definition,
        IReadOnlyList<ScenePrefabOverrideOperation>? liveOverrides = null)
    {
        ArgumentNullException.ThrowIfNull(definition);

        ScenePrefabDefinition resolved = ResolveDefinition(definition, []);
        return new ScenePrefabResolutionResult(ApplyLive(resolved, liveOverrides), cacheHit: false);
    }

    /// <summary>Resolves a reference.</summary>
    public ScenePrefabResolutionResult Resolve(
        ScenePrefabReference reference,
        IReadOnlyList<ScenePrefabOverrideOperation>? liveOverrides = null)
    {
        ArgumentNullException.ThrowIfNull(reference);

        if (reference.Kind == ScenePrefabReferenceKind.Inline)
        {
            return Resolve(reference.Prefab!, liveOverrides);
        }

        return Resolve(reference.PrefabId!, reference.Revision, liveOverrides);
    }

    /// <summary>Resolves a registry prefab by id.</summary>
    public ScenePrefabResolutionResult Resolve(
        string prefabId,
        IReadOnlyList<ScenePrefabOverrideOperation>? liveOverrides = null) =>
        Resolve(prefabId, revision: null, liveOverrides);

    private ScenePrefabResolutionResult Resolve(
        string prefabId,
        string? revision,
        IReadOnlyList<ScenePrefabOverrideOperation>? liveOverrides)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(prefabId);

        string? cacheKey = CreateCacheKey(prefabId, revision, liveOverrides);
        if (cacheKey is not null && TryGetCached(cacheKey, out ScenePrefabDefinition? cached))
        {
            return new ScenePrefabResolutionResult(cached, cacheHit: true);
        }

        var reference = ScenePrefabReference.FromRegistry(prefabId, revision);
        ScenePrefabDefinition resolved = ResolveDefinition(
            ResolveReference(reference, []),
            []);
        resolved = ApplyLive(resolved, liveOverrides);

        if (cacheKey is not null)
        {
            StoreCached(cacheKey, resolved);
        }

        return new ScenePrefabResolutionResult(resolved, cacheHit: false);
    }

    private static ScenePrefabDefinition ApplyLive(
        ScenePrefabDefinition resolved,
        IReadOnlyList<ScenePrefabOverrideOperation>? liveOverrides) =>
        liveOverrides is { Count: > 0 }
            ? ScenePrefabOverrides.Apply(resolved, liveOverrides)
            : resolved;

    private ScenePrefabDefinition ResolveReference(
        ScenePrefabReference reference,
        List<string> stack)
    {
        if (reference.Kind == ScenePrefabReferenceKind.Inline)
        {
            return ResolveDefinition(reference.Prefab!, stack);
        }

        ScenePrefabDefinition? definition = _source?.GetPrefab(reference.PrefabId!);
        if (definition is null)
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.ResolutionFailed,
                $"Prefab '{reference.PrefabId}' is not registered in the active source.");
        }

        if (reference.Revision is { } expected &&
            definition.Metadata?.Revision is { } actual &&
            !string.Equals(expected, actual, StringComparison.Ordinal))
        {
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.ResolutionFailed,
                $"Prefab '{reference.PrefabId}' revision mismatch: expected '{expected}' but found '{actual}'.");
        }

        return ResolveDefinition(definition, stack);
    }

    private ScenePrefabDefinition ResolveDefinition(
        ScenePrefabDefinition definition,
        List<string> stack)
    {
        if (stack.Contains(definition.Id))
        {
            stack.Add(definition.Id);
            string chain = string.Join(" -> ", stack);
            stack.RemoveAt(stack.Count - 1);
            throw new ScenePrefabException(
                ScenePrefabErrorCodes.ResolutionFailed,
                $"Prefab resolution cycle detected: {chain}.");
        }

        stack.Add(definition.Id);
        try
        {
            ScenePrefabDefinition? baseResolved = null;
            IReadOnlyList<string> lineage;

            if (definition.Base is { } baseReference)
            {
                baseResolved = ResolveReference(baseReference, stack);
                lineage = [.. baseResolved.Lineage, definition.Id];
            }
            else
            {
                lineage = definition.Lineage.Count > 0
                    ? [.. definition.Lineage]
                    : [definition.Id];
            }

            var state = new ScenePrefabOverrideState(
                definition.Id,
                ScenePrefabKind.Resolved,
                definition.Metadata,
                lineage);

            if (baseResolved is not null)
            {
                state.AddActors(baseResolved.Actors);
            }

            state.AddActors(definition.Actors);

            for (int i = 0; i < definition.Nested.Count; i++)
            {
                ScenePrefabNestedInstance nested = definition.Nested[i];
                ScenePrefabDefinition nestedResolved = ResolveReference(nested.Reference, stack);
                state.AddActors(ScenePrefabNestedScope.ScopeActors(
                    nestedResolved.Actors,
                    nested,
                    nestedResolved.Id,
                    nestedResolved.Lineage));
                state.ApplyRange(ScenePrefabNestedScope.ScopeOperations(
                    nested.Overrides,
                    nested,
                    nestedResolved.Id,
                    nestedResolved.Lineage));
            }

            state.ApplyRange(definition.Overrides);
            return state.ToDefinition();
        }
        finally
        {
            stack.RemoveAt(stack.Count - 1);
        }
    }

    private string? CreateCacheKey(
        string prefabId,
        string? revision,
        IReadOnlyList<ScenePrefabOverrideOperation>? liveOverrides)
    {
        if (!_enableCache ||
            liveOverrides is { Count: > 0 } ||
            _source is not ScenePrefabRegistry registry ||
            revision is not null)
        {
            return null;
        }

        return $"{registry.Version}:{prefabId}";
    }

    private bool TryGetCached(string cacheKey, out ScenePrefabDefinition definition)
    {
        lock (_gate)
        {
            if (_cache.TryGetValue(cacheKey, out CacheEntry entry))
            {
                definition = entry.Definition;
                return true;
            }
        }

        definition = null!;
        return false;
    }

    private void StoreCached(string cacheKey, ScenePrefabDefinition definition)
    {
        lock (_gate)
        {
            _cache[cacheKey] = new CacheEntry(definition);

            if (_cache.Count > 64)
            {
                var stale = new List<string>();
                foreach (string key in _cache.Keys)
                {
                    if (!string.Equals(key, cacheKey, StringComparison.Ordinal))
                    {
                        stale.Add(key);
                    }
                }

                for (int i = 0; i < stale.Count; i++)
                {
                    _cache.Remove(stale[i]);
                }
            }
        }
    }

    private readonly record struct CacheEntry(ScenePrefabDefinition Definition);
}

/// <summary>Node-id scoping rules for nested prefab instances.</summary>
internal static class ScenePrefabNestedScope
{
    /// <summary>Joins an instance id and node id into the host-scoped node id.</summary>
    public static string ScopedNodeId(string instanceId, string nodeId) =>
        $"{instanceId}::{nodeId}";

    /// <summary>Scopes actors under an instance id, parent and optional name prefix.</summary>
    public static SceneActorSnapshot[] ScopeActors(
        IReadOnlyList<SceneActorSnapshot> actors,
        ScenePrefabNestedInstance nested,
        string sourcePrefabId,
        IReadOnlyList<string> sourceLineage)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(sourcePrefabId);

        var scoped = new SceneActorSnapshot[actors.Count];
        for (int i = 0; i < actors.Count; i++)
        {
            SceneActorSnapshot actor = ScenePrefabNodeIdentity.EnsureProvenance(
                actors[i],
                sourcePrefabId,
                sourceLineage,
                i);
            string? parentNodeId = actor.ParentNodeId is { } parent
                ? ScopedNodeId(nested.InstanceId, parent)
                : nested.ParentNodeId;
            string name = nested.NamePrefix is { } prefix
                ? string.Concat(prefix, actor.Name)
                : actor.Name;
            ScenePrefabNodeSource source = actor.Source!.Value.WithInstancePath(nested.InstanceId);

            scoped[i] = new SceneActorSnapshot(
                ScopedNodeId(nested.InstanceId, actor.NodeId),
                name,
                actor.Layer,
                actor.Tag,
                actor.Active,
                actor.Persistent,
                actor.Pooled,
                actor.Components,
                parentNodeId,
                source);
        }

        return scoped;
    }

    /// <summary>Scopes instance-local override operations to the host node ids.</summary>
    public static ScenePrefabOverrideOperation[] ScopeOperations(
        IReadOnlyList<ScenePrefabOverrideOperation> operations,
        ScenePrefabNestedInstance nested,
        string sourcePrefabId,
        IReadOnlyList<string> sourceLineage)
    {
        var scoped = new ScenePrefabOverrideOperation[operations.Count];
        for (int i = 0; i < operations.Count; i++)
        {
            scoped[i] = Scope(operations[i], nested, sourcePrefabId, sourceLineage);
        }

        return scoped;
    }

    private static ScenePrefabOverrideOperation Scope(
        ScenePrefabOverrideOperation operation,
        ScenePrefabNestedInstance nested,
        string sourcePrefabId,
        IReadOnlyList<string> sourceLineage)
    {
        string ScopeId(string nodeId) => ScopedNodeId(nested.InstanceId, nodeId);

        return operation switch
        {
            ScenePrefabAddActorOperation add => new ScenePrefabAddActorOperation(
                ScopeActors([add.Actor], nested, sourcePrefabId, sourceLineage)[0],
                add.AfterNodeId is { } afterNodeId ? ScopeId(afterNodeId) : null),
            ScenePrefabRemoveActorOperation remove => new ScenePrefabRemoveActorOperation(
                ScopeId(remove.NodeId)),
            ScenePrefabReparentActorOperation reparent => new ScenePrefabReparentActorOperation(
                ScopeId(reparent.NodeId),
                reparent.ParentNodeId is { } parentNodeId
                    ? ScopeId(parentNodeId)
                    : nested.ParentNodeId),
            ScenePrefabSetActorFieldOperation setField => new ScenePrefabSetActorFieldOperation(
                ScopeId(setField.NodeId),
                setField.Field,
                setField.Value),
            ScenePrefabAddComponentOperation addComponent => new ScenePrefabAddComponentOperation(
                ScopeId(addComponent.NodeId),
                addComponent.Component,
                addComponent.Index),
            ScenePrefabRemoveComponentOperation removeComponent => new ScenePrefabRemoveComponentOperation(
                ScopeId(removeComponent.NodeId),
                removeComponent.Selector),
            ScenePrefabReplaceComponentOperation replaceComponent => new ScenePrefabReplaceComponentOperation(
                ScopeId(replaceComponent.NodeId),
                replaceComponent.Selector,
                replaceComponent.Component),
            ScenePrefabSetComponentPropertyOperation setProperty =>
                new ScenePrefabSetComponentPropertyOperation(
                    ScopeId(setProperty.NodeId),
                    setProperty.Selector,
                    setProperty.Path,
                    setProperty.Value),
            ScenePrefabUnsetComponentPropertyOperation unsetProperty =>
                new ScenePrefabUnsetComponentPropertyOperation(
                    ScopeId(unsetProperty.NodeId),
                    unsetProperty.Selector,
                    unsetProperty.Path),
            _ => throw new ScenePrefabException(
                ScenePrefabErrorCodes.InvalidOverride,
                $"Unknown override operation '{operation.GetType().Name}'.")
        };
    }
}
