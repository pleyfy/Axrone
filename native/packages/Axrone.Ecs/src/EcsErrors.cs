namespace Axrone.Ecs;

/// <summary>
/// Coded ECS error.
/// </summary>
public class EcsException(string code, string message) : Exception(message)
{
    /// <summary>Machine-readable code.</summary>
    public string Code { get; } = code;
}

/// <summary>
/// Unknown or stale entity.
/// </summary>
public sealed class EcsEntityException(Entity entity, string message)
    : EcsException("ecs.entity-not-found", message)
{
    /// <summary>Offending entity.</summary>
    public Entity Entity { get; } = entity;
}

/// <summary>
/// Missing component on an entity.
/// </summary>
public sealed class EcsComponentException(string? componentName, string message)
    : EcsException("ecs.component-not-found", message)
{
    /// <summary>Component name when known.</summary>
    public string? ComponentName { get; } = componentName;
}

/// <summary>
/// Invalid ECS configuration.
/// </summary>
public sealed class EcsConfigurationException(string code, string message) : EcsException(code, message);

/// <summary>
/// Operation attempted against a disposed world.
/// </summary>
/// <param name="operation">API name that was rejected.</param>
public sealed class EcsWorldClosedException(string operation)
    : EcsException("ecs.world-closed", $"World is disposed; '{operation}' is unavailable.");

/// <summary>
/// A singleton component is already owned by another entity.
/// </summary>
/// <param name="componentId">Component type involved.</param>
/// <param name="owner">Entity holding the registration.</param>
/// <param name="attempted">Entity that tried to take the slot.</param>
public sealed class EcsSingletonConflictException(ComponentId componentId, Entity owner, Entity attempted)
    : EcsException(
        "ecs.singleton-conflict",
        $"Singleton component {componentId} is owned by {owner}; {attempted} cannot register a second instance.")
{
    /// <summary>Component type involved.</summary>
    public ComponentId ComponentId { get; } = componentId;

    /// <summary>Current owner.</summary>
    public Entity Owner { get; } = owner;

    /// <summary>Rejected entity.</summary>
    public Entity Attempted { get; } = attempted;
}

/// <summary>
/// An actor name is already claimed by another live entity.
/// </summary>
/// <param name="name">Claimed actor name.</param>
/// <param name="owner">Entity that owns the name.</param>
/// <param name="attempted">Entity that tried to take it.</param>
public sealed class EcsActorNameConflictException(EcsActorName name, Entity owner, Entity attempted)
    : EcsException(
        "ecs.actor-name-conflict",
        $"Actor '{name}' is owned by {owner}; {attempted} cannot claim the same name.")
{
    /// <summary>Claimed actor name.</summary>
    public EcsActorName Name { get; } = name;

    /// <summary>Current owner.</summary>
    public Entity Owner { get; } = owner;

    /// <summary>Rejected entity.</summary>
    public Entity Attempted { get; } = attempted;
}

/// <summary>
/// Centralized ECS throw helpers; throwing paths stay out of hot methods.
/// </summary>
internal static class EcsThrowHelper
{
    /// <summary>Throws when an entity handle is unknown or stale.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowEntityNotFound(in Entity entity) =>
        throw new EcsEntityException(entity, $"Entity {entity} does not exist or its version is stale.");

    /// <summary>Throws when a component is missing on an entity.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowComponentNotFound(string name) =>
        throw new EcsComponentException(name, $"Component '{name}' is not present on the entity.");

    /// <summary>Throws when a component id has no registered column factory.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowUnknownComponentType(ComponentId id) =>
        throw new EcsConfigurationException("ecs.unknown-component", $"Component id {id.Value} has no registered column factory.");

    /// <summary>Throws when the component type budget is exhausted.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowMaxComponentsExceeded() =>
        throw new EcsConfigurationException("ecs.max-components", "Component type limit of 256 exceeded.");

    /// <summary>Throws on non-exhaustive discriminated-union dispatch.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowExhaustiveMatchFailure() =>
        throw new EcsConfigurationException("ecs.exhaustive-match", "Non-exhaustive match on a discriminated union branch.");

    /// <summary>Throws when a removal journal is created with a non-positive capacity.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidJournalCapacity(int capacity) =>
        throw new EcsConfigurationException("ecs.invalid-journal-capacity", $"Removal journal capacity must be positive, but was {capacity}.");

    /// <summary>Throws when a command payload length does not match the component size.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidCommandPayload(int actual, int expected) =>
        throw new EcsConfigurationException(
            "ecs.invalid-command-payload",
            $"Command payload length {actual} does not match the component size {expected}.");

    /// <summary>Throws when a capacity or count is outside its valid range.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowArgumentOutOfRange(string paramName) =>
        throw new ArgumentOutOfRangeException(paramName);

    /// <summary>Throws when a nested parallel job would deadlock on the shared pool.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowParallelReentrancy() =>
        throw new EcsConfigurationException(
            "ecs.parallel-reentrancy",
            "A chunk-parallel job cannot run from inside a parallel system batch; mark the system structural.");

    /// <summary>Throws when fewer command buffers than workers were supplied.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidCommandBufferCount(int actual, int required) =>
        throw new EcsConfigurationException(
            "ecs.command-buffer-count",
            $"Parallel command playback requires at least {required} buffers, but received {actual}.");

    /// <summary>Throws when a system id is the invalid sentinel.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidSystemId() =>
        throw new EcsConfigurationException("ecs.invalid-system-id", "A system id must be non-zero.");

    /// <summary>Throws when a system id is registered twice.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowDuplicateSystem(SystemId id) =>
        throw new EcsConfigurationException(
            "ecs.duplicate-system",
            $"System id {id.Value} is already registered.");

    /// <summary>Throws when a system dependency was never registered.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowMissingSystemDependency(SystemId system, SystemId dependency) =>
        throw new EcsConfigurationException(
            "ecs.system-missing-dependency",
            $"System {system.Value} depends on unregistered system {dependency.Value}.");

    /// <summary>Throws when system dependencies contain a cycle.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSystemCycle(SystemId system) =>
        throw new EcsConfigurationException(
            "ecs.system-cycle",
            $"System dependency cycle detected at system {system.Value}.");

    /// <summary>Throws when a dependency is scheduled in a later phase.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSystemPhaseDependency(SystemId system, SystemId dependency) =>
        throw new EcsConfigurationException(
            "ecs.system-phase-dependency",
            $"System {system.Value} cannot depend on {dependency.Value} in a later phase.");

    /// <summary>Throws when a snapshot component has no registered codec.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSnapshotMissingCodec(ComponentId id) =>
        throw new EcsConfigurationException(
            "ecs.snapshot-missing-codec",
            $"Component id {id.Value} has no registered snapshot codec.");

    /// <summary>Throws when a snapshot stable id has no registered codec.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSnapshotMissingStableCodec(ushort stableId) =>
        throw new EcsConfigurationException(
            "ecs.snapshot-missing-codec",
            $"Snapshot stable component id {stableId} has no registered codec.");

    /// <summary>Throws when a snapshot is structurally invalid.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSnapshotInvalid(string detail) =>
        throw new EcsConfigurationException("ecs.snapshot-invalid", detail);

    /// <summary>Throws when the snapshot checksum does not match.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSnapshotChecksum() =>
        throw new EcsConfigurationException("ecs.snapshot-checksum", "Snapshot checksum does not match the payload.");

    /// <summary>Throws when a snapshot restore targets a non-empty world.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSnapshotNotEmpty() =>
        throw new EcsConfigurationException(
            "ecs.snapshot-not-empty",
            "Snapshot restore requires an empty world.");

    /// <summary>Throws when two codecs claim the same stable id.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSnapshotDuplicateStableId(ushort stableId) =>
        throw new EcsConfigurationException(
            "ecs.snapshot-duplicate-stable-id",
            $"Snapshot stable component id {stableId} is already registered.");

    /// <summary>Throws when a codec payload does not consume exactly its declared length.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSnapshotInvalidPayload() =>
        throw new EcsConfigurationException(
            "ecs.snapshot-invalid-payload",
            "Snapshot component payload did not consume exactly its declared length.");

    /// <summary>Throws when an API is used after the world was disposed.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowWorldClosed(string operation) =>
        throw new EcsWorldClosedException(operation);

    /// <summary>Throws when an interned symbol is blank.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowEmptySymbol(string kind) =>
        throw new EcsConfigurationException("ecs.empty-symbol", $"A {kind} symbol must contain at least one non-whitespace character.");

    /// <summary>Throws when a symbol table reaches its slot ceiling.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSymbolLimitExceeded(string kind, int limit) =>
        throw new EcsConfigurationException(
            "ecs.symbol-limit",
            $"The {kind} symbol table is limited to {limit} interned symbols.");

    /// <summary>Throws when a symbol slot was never interned.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowUnknownSymbol(string kind, int slot) =>
        throw new EcsConfigurationException("ecs.unknown-symbol", $"Slot {slot} is not an interned {kind} symbol.");

    /// <summary>Throws when a singleton component slot is claimed by a different entity.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowSingletonConflict(ComponentId componentId, Entity owner, Entity attempted) =>
        throw new EcsSingletonConflictException(componentId, owner, attempted);

    /// <summary>Throws when an actor registration targets a missing entity.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowActorEntityNotFound(in Entity entity) =>
        throw new EcsEntityException(entity, "Actor registration requires a live entity.");

    /// <summary>Throws when an actor name slot is unresolved.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidActorName(string operation) =>
        throw new EcsConfigurationException(
            "ecs.invalid-actor-name",
            $"'{operation}' requires an interned actor name; use EcsActorNames.Intern.");

    /// <summary>Throws when an actor name is owned by another live entity.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowActorNameConflict(in EcsActorName name, in Entity owner, in Entity attempted) =>
        throw new EcsActorNameConflictException(name, owner, attempted);
}
