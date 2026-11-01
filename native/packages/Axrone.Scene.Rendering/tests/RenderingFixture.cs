namespace Axrone.Scene.Rendering.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;

internal static class RenderingFixture
{
    public static SceneProfile CreateProfile()
    {
        var builder = new SceneProfileBuilder(
            new SceneProfileId(SceneStringId.FromName("test/rendering")));
        return builder
            .AddTransform3D()
            .AddRendering3D()
            .AddLighting3D()
            .Build();
    }

    public static SceneWorld CreateRenderableWorld(SceneRenderableFeatures features)
    {
        var builder = new SceneProfileBuilder(
            new SceneProfileId(SceneStringId.FromName("test/renderables")));
        SceneProfile profile = builder
            .AddTransform3D()
            .AddRendering3D()
            .AddSceneRenderables(features)
            .Build();
        return profile.CreateWorld();
    }

    public static SceneMeshDefinition CreateMesh(
        SceneAssetRegistry assets,
        string name,
        float radius = 1.0f)
    {
        SceneAssetId<MeshAssetTag> id = assets.CreateId<MeshAssetTag>(name);
        SceneVertexAttribute[] attributes =
        [
            new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)
        ];
        byte[] vertices = new byte[36];
        byte[] indices = new byte[6];

        return new SceneMeshDefinition(
            id,
            vertices,
            attributes,
            indices: indices,
            bounds: new BoundingSphere3(Vec3.Zero, radius));
    }

    public static SceneActor CreateCamera(
        SceneWorld world,
        Vec3 position,
        bool primary = false)
    {
        SceneActor actor = world.CreateActor("Camera");
        world.GetTransform3D(actor).SetPosition(position);
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = primary;
        world.AddData(actor, camera);
        world.UpdateTransforms();
        return actor;
    }
}
