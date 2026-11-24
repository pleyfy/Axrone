namespace Axrone.Scene;

/// <summary>
/// Stable error codes emitted by the scene core. Codes are part of the public
/// contract: tooling matches them, while message text remains human-facing.
/// </summary>
public static class SceneErrorCodes
{
    /// <summary>Entity handle is unknown or its generation is stale.</summary>
    public const string EntityStale = "scene.entity.stale";

    /// <summary>Entity handle does not resolve in the owning world.</summary>
    public const string EntityNotFound = "scene.entity.not-found";

    /// <summary>The entity has already been destroyed.</summary>
    public const string EntityDestroyed = "scene.entity.destroyed";

    /// <summary>A component of the same type is already attached.</summary>
    public const string ComponentDuplicate = "scene.component.duplicate";

    /// <summary>The requested component is not attached.</summary>
    public const string ComponentMissing = "scene.component.missing";

    /// <summary>The component type has no registration in the active profile.</summary>
    public const string ComponentUnregistered = "scene.component.unregistered";

    /// <summary>The component or behaviour id budget is exhausted.</summary>
    public const string ComponentLimit = "scene.component.limit";

    /// <summary>A structural mutation was attempted while iteration was active.</summary>
    public const string StructuralMutation = "scene.structural-mutation";

    /// <summary>The active profile does not provide a required capability.</summary>
    public const string CapabilityMissing = "scene.capability.missing";

    /// <summary>The lifecycle request is not valid in the current state.</summary>
    public const string LifecycleInvalid = "scene.lifecycle.invalid";

    /// <summary>The runtime has been disposed.</summary>
    public const string LifecycleDisposed = "scene.lifecycle.disposed";

    /// <summary>The runtime terminated on an unrecoverable fault.</summary>
    public const string LifecycleFaulted = "scene.lifecycle.faulted";

    /// <summary>A configuration value is outside its accepted domain.</summary>
    public const string ConfigurationInvalid = "scene.configuration.invalid";

    /// <summary>A definition failed validation.</summary>
    public const string ValidationInvalid = "scene.validation.invalid";

    /// <summary>Two different names produced the same symbol.</summary>
    public const string NameCollision = "scene.name.collision";

    /// <summary>A scene profile is malformed.</summary>
    public const string ProfileInvalid = "scene.profile.invalid";
}
