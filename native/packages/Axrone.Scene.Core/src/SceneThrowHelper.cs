namespace Axrone.Scene;

/// <summary>
/// Cold-path failure helpers. Keeping every throw out of line preserves the
/// JIT's inlining budget for the store and traversal hot paths.
/// </summary>
internal static class SceneThrowHelper
{
    /// <summary>Throws when an entity handle does not resolve.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowEntityNotFound(in SceneEntity entity) =>
        throw new SceneEntityNotFoundException(in entity);

    /// <summary>Throws when an entity generation has been recycled.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowStaleEntity(in SceneEntity entity) =>
        throw new SceneStaleHandleException(in entity);

    /// <summary>Throws when a singleton component is already attached.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowComponentDuplicate(in SceneEntity entity, string componentName) =>
        throw new SceneComponentException(
            SceneErrorCodes.ComponentDuplicate,
            in entity,
            componentName,
            "is already attached to the entity.");

    /// <summary>Throws when a requested component is absent.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowComponentMissing(in SceneEntity entity, string componentName) =>
        throw new SceneComponentException(
            SceneErrorCodes.ComponentMissing,
            in entity,
            componentName,
            "is not attached to the entity.");

    /// <summary>Throws when a data component type has no registration.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowComponentTypeUnregistered(SceneComponentTypeId typeId) =>
        throw new SceneValidationException(
            SceneErrorCodes.ComponentUnregistered,
            $"Data component type id {typeId.Value} has no registration.");

    /// <summary>Throws when a behaviour type has no registration.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowBehaviourTypeUnregistered(SceneBehaviourTypeId typeId) =>
        throw new SceneValidationException(
            SceneErrorCodes.ComponentUnregistered,
            $"Behaviour type id {typeId.Value} has no registration.");

    /// <summary>Throws when the component or behaviour id budget is exhausted.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowComponentLimitExceeded(ushort limit) =>
        throw new SceneConfigurationException(
            $"Component type limit of {limit} registrations has been exhausted.");

    /// <summary>Throws when iteration forbids a structural mutation.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowStructuralMutation(string operation) =>
        throw new SceneStructuralMutationException(operation);

    /// <summary>Throws when two names resolve to the same symbol.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowNameCollision(string name, SceneStringId existing) =>
        throw new SceneValidationException(
            SceneErrorCodes.NameCollision,
            $"Name '{name}' collides with existing symbol {existing}.");

    /// <summary>Throws when a capacity is not positive.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidCapacity(int capacity) =>
        throw new SceneConfigurationException(
            $"Capacity must be a positive value; received {capacity}.");

    /// <summary>Throws when a disposed world is touched.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowObjectDisposed(string objectName) =>
        throw new SceneDisposedException(objectName);

    /// <summary>Throws when a registration profile is malformed.</summary>
    [DoesNotReturn]
    [MethodImpl(MethodImplOptions.NoInlining)]
    public static void ThrowInvalidProfile(string reason) =>
        throw new SceneValidationException(SceneErrorCodes.ProfileInvalid, reason);
}
