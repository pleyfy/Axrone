using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using Axrone.Scene.Runtime;
using Axrone.Scene.Snapshot;

using var runtime = new SceneRuntime(new SceneRuntimeOptions
{
    RuntimeProfile = SceneRuntimeProfiles.ThreeD,
    ViewportWidth = 320,
    ViewportHeight = 180
});

SceneAssetId<MeshAssetTag> meshId = runtime.Assets.CreateId<MeshAssetTag>("smoke/mesh");
runtime.Assets.Meshes.Register(SceneMeshFactory.CreateBox(meshId));

SceneAssetId<ShaderAssetTag> shaderId = runtime.Assets.CreateId<ShaderAssetTag>("smoke/shader");
runtime.Assets.Shaders.Register(new SceneShaderDefinition(
    shaderId,
    "void main(){}",
    "void main(){}"));

SceneAssetId<MaterialAssetTag> materialId = runtime.Assets.CreateId<MaterialAssetTag>("smoke/material");
runtime.Assets.Materials.Register(new SceneMaterialDefinition(
    materialId,
    shaderId,
    new SceneMaterialSurface()));

SceneAssetId<RenderPassAssetTag> passId = runtime.Assets.CreateId<RenderPassAssetTag>("main");
runtime.Assets.RenderPasses.Register(new SceneRenderPassDefinition(
    passId,
    clearMask: SceneClearMask.Color | SceneClearMask.Depth,
    clearColor: new Vec4(0.05f, 0.05f, 0.08f, 1.0f)));
runtime.Frame.RebuildPasses();

SceneEntity cameraEntity = runtime.World.CreateEntity("SmokeCamera");
runtime.World.GetTransform3D(cameraEntity).SetPosition(new Vec3(0.0f, 0.0f, 10.0f));
SceneCamera camera = SceneCamera.Default;
camera.Primary = true;
runtime.World.AddData(cameraEntity, camera);

SceneEntity boxEntity = runtime.World.CreateEntity("SmokeBox");
SceneMeshRenderer renderer = SceneMeshRenderer.Default;
renderer.MeshId = meshId;
renderer.MaterialId = materialId;
renderer.PassId = passId;
runtime.World.AddData(boxEntity, renderer);
runtime.World.UpdateTransforms();

if (!runtime.Frame.Plan(0))
{
    Console.Error.WriteLine("scene-smoke failed: no camera frame");
    return 1;
}

int items = runtime.Frame.CollectItems(passId);
if (items != 1)
{
    Console.Error.WriteLine($"scene-smoke failed: expected one render item, found {items}");
    return 2;
}

SceneSnapshot snapshot = runtime.CaptureSnapshot("prefab/smoke");
byte[] json = SceneSnapshotJson.Serialize(snapshot, runtime.Assets.Names);
SceneSnapshot restored = SceneSnapshotJson.Deserialize(json);

if (restored.Meshes.Count != 1 ||
    restored.Prefab.Entities.Count != runtime.World.EntityCount)
{
    Console.Error.WriteLine("scene-smoke failed: snapshot round trip mismatch");
    return 3;
}

Console.WriteLine(
    $"scene-smoke ok items={items} entities={runtime.World.EntityCount} bytes={json.Length}");
return 0;
