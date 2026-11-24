namespace Axrone.Scene.Rendering;

/// <summary>
/// Selects the frame camera: the first active primary camera, otherwise the
/// first active enabled camera in stable entity order.
/// </summary>
public static class SceneCameraSelector
{
    /// <summary>Selects a camera entity.</summary>
    public static bool TrySelect(SceneWorld world, out SceneEntity cameraEntity)
    {
        ArgumentNullException.ThrowIfNull(world);

        SceneEntity fallback = SceneEntity.Null;
        foreach (SceneEntity entity in world.Entities)
        {
            // Entities carrying the 2D marker are owned by the 2D selector.
            if (!world.IsActiveInHierarchy(entity) ||
                !world.HasData<SceneCamera>(entity) ||
                world.HasData<SceneCamera2D>(entity))
            {
                continue;
            }

            ref SceneCamera camera = ref world.GetData<SceneCamera>(entity);
            if (!camera.Enabled)
            {
                continue;
            }

            if (camera.Primary)
            {
                cameraEntity = entity;
                return true;
            }

            if (fallback.IsNull)
            {
                fallback = entity;
            }
        }

        cameraEntity = fallback;
        return cameraEntity.IsValid;
    }
}
