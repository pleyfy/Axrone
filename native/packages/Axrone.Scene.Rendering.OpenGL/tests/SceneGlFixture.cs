namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;

internal sealed class SceneGlFixture : IDisposable
{
    public SceneGlFixture()
    {
        Api = new MockGLApi { EnableCallLogging = true };
        Context = new GLContext(Api);
        Assets = new SceneAssetRegistry();

        SceneAssetId<ShaderAssetTag> shaderId = Assets.CreateId<ShaderAssetTag>("test/shader");
        Shader = new SceneShaderDefinition(
            shaderId,
            "void main(){}",
            "void main(){}");
        Assets.Shaders.Register(Shader);

        SceneAssetId<MeshAssetTag> meshId = Assets.CreateId<MeshAssetTag>("test/mesh");
        SceneVertexAttribute[] attributes =
        [
            new SceneVertexAttribute(SceneMeshSemantic.Position, 3, 0, 12)
        ];
        Mesh = new SceneMeshDefinition(
            meshId,
            new byte[36],
            attributes,
            indices: new byte[6],
            bounds: new BoundingSphere3(Vec3.Zero, 1.0f));
        Assets.Meshes.Register(Mesh);

        SceneAssetId<MaterialAssetTag> materialId = Assets.CreateId<MaterialAssetTag>("test/material");
        Material = new SceneMaterialDefinition(
            materialId,
            shaderId,
            new SceneMaterialSurface());
        Assets.Materials.Register(Material);
        Cache = new SceneGlAssetCache(Context, Assets);
    }

    public MockGLApi Api { get; }

    public GLContext Context { get; }

    public SceneGlAssetCache Cache { get; }

    public SceneAssetRegistry Assets { get; }

    public SceneShaderDefinition Shader { get; }

    public SceneMeshDefinition Mesh { get; }

    public SceneMaterialDefinition Material { get; }

    public SceneWorld CreateWorld(out SceneActor cameraActor, out SceneActor rendererActor)
    {
        var builder = new SceneProfileBuilder(
            new SceneProfileId(SceneStringId.FromName("test/gl-rendering")));
        SceneProfile profile = builder
            .AddTransform3D()
            .AddRendering3D()
            .Build();

        SceneWorld world = profile.CreateWorld();

        cameraActor = world.CreateActor("Camera");
        world.GetTransform3D(cameraActor).SetPosition(new Vec3(0.0f, 0.0f, 10.0f));
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = true;
        world.AddData(cameraActor, camera);

        rendererActor = world.CreateActor("Renderer");
        SceneMeshRenderer renderer = SceneMeshRenderer.Default;
        renderer.MeshId = Mesh.Id;
        renderer.MaterialId = Material.Id;
        world.AddData(rendererActor, renderer);

        world.UpdateTransforms();
        return world;
    }

    public SceneRenderItem CreateItem(SceneActor rendererActor) => new()
    {
        Actor = rendererActor,
        MeshId = Mesh.Id,
        MaterialId = Material.Id,
        ReceiveLighting = true
    };

    public void Dispose()
    {
        Cache.Dispose();
        Context.Dispose();
    }
}
