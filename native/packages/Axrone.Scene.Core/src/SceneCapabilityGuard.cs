namespace Axrone.Scene;

/// <summary>
/// Explicit capability checks against the active component registry. The
/// guard turns a missing profile registration into a typed failure instead of
/// a later missing-column exception.
/// </summary>
public static class SceneCapabilityGuard
{
    /// <summary>Requires a registered data component type.</summary>
    public static void RequireData<T>(SceneComponentRegistry registry)
        where T : unmanaged, ISceneDataComponent
    {
        ArgumentNullException.ThrowIfNull(registry);
        if (!registry.TryGetDataByType(typeof(T), out _))
        {
            throw new SceneCapabilityException(
                typeof(T).Name,
                "data component is not registered in the active profile.");
        }
    }

    /// <summary>Requires a registered data component id.</summary>
    public static void RequireData(SceneComponentRegistry registry, SceneComponentTypeId typeId)
    {
        ArgumentNullException.ThrowIfNull(registry);
        if (!registry.TryGetData(typeId, out _))
        {
            throw new SceneCapabilityException(
                $"component:{typeId.Value}",
                "data component id is not registered in the active profile.");
        }
    }

    /// <summary>Requires a registered behaviour type.</summary>
    public static void RequireBehaviour<T>(SceneComponentRegistry registry)
        where T : class, ISceneBehaviour
    {
        ArgumentNullException.ThrowIfNull(registry);
        if (!registry.TryGetBehaviourByType(typeof(T), out _))
        {
            throw new SceneCapabilityException(
                typeof(T).Name,
                "behaviour is not registered in the active profile.");
        }
    }

    /// <summary>Requires a registered behaviour id.</summary>
    public static void RequireBehaviour(SceneComponentRegistry registry, SceneBehaviourTypeId typeId)
    {
        ArgumentNullException.ThrowIfNull(registry);
        if (!registry.TryGetBehaviour(typeId, out _))
        {
            throw new SceneCapabilityException(
                $"behaviour:{typeId.Value}",
                "behaviour id is not registered in the active profile.");
        }
    }
}
