namespace Axrone.Ui.Scene;

/// <summary>World-space matrix helpers shared by input mapping and rendering.</summary>
public static class SceneUiHostMath
{
    /// <summary>
    /// Builds the world-space quad model: host transform for fixed orientation,
    /// or a camera-facing basis anchored at the host position.
    /// </summary>
    public static bool TryBuildWorldModel(
        SceneWorld world,
        SceneActor actor,
        in SceneUiHost component,
        in Vec3 cameraPosition,
        out Mat4 model)
    {
        ArgumentNullException.ThrowIfNull(world);
        model = default;
        if (!world.HasData<SceneTransform3D>(actor))
        {
            return false;
        }

        Mat4 worldMatrix = world.GetWorldMatrix3D(actor);
        float width = SceneUiHostLimits.ClampWorldSize(component.WorldWidth);
        float height = SceneUiHostLimits.ClampWorldSize(component.WorldHeight);

        if (component.Billboard != SceneUiHostBillboard.CameraFacing)
        {
            model = Mat4.CreateScale(width, height, 1.0f) * worldMatrix;
            return true;
        }

        Vec3 position = new(worldMatrix.M41, worldMatrix.M42, worldMatrix.M43);
        Vec3 forward = cameraPosition - position;
        if (!Vec3.TryNormalize(forward, out Vec3 normalized))
        {
            normalized = Vec3.UnitZ;
        }

        Vec3 up = MathF.Abs(Vec3.Dot(normalized, Vec3.UnitY)) > 0.999f ? Vec3.UnitX : Vec3.UnitY;
        Quat rotation = Quat.LookRotation(normalized, up);
        model = Mat4.CreateScale(width, height, 1.0f)
            * Mat4.CreateFromQuaternion(rotation)
            * Mat4.CreateTranslation(position);
        return true;
    }
}
