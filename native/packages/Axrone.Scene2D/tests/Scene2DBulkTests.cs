namespace Scene2DTests;

public class Scene2DBulkTests
{
    [Fact]
    public void BulkCreationMatchesIndividualCreationState()
    {
        Scene2DSpriteSpec[] specs = CreateSpecs(8);
        using Scene2D bulkScene = Scene2D.Create();
        using Scene2D singleScene = Scene2D.Create();

        var bulkEntities = new SceneEntity[specs.Length];
        int created = bulkScene.CreateSprites(specs, bulkEntities);
        created.Should().Be(specs.Length);

        var singleEntities = new SceneEntity[specs.Length];
        for (int i = 0; i < specs.Length; i++)
        {
            SceneEntityConfig entityConfig = specs[i].EntityConfig;
            Scene2DSpriteConfig spriteConfig = specs[i].Sprite;
            SceneEntity entity = singleScene.CreateSpriteEntity(in entityConfig, in spriteConfig);
            Vec2 position = specs[i].Position;
            singleScene.World.GetTransform2D(entity).SetPosition(in position);
            singleEntities[i] = entity;
        }

        singleScene.World.UpdateTransforms();
        bulkScene.EntityCount.Should().Be(singleScene.EntityCount);
        bulkScene.Capacity.Should().Be(singleScene.Capacity);

        for (int i = 0; i < specs.Length; i++)
        {
            bulkEntities[i].Should().Be(singleEntities[i]);
            bulkScene.World.GetName(bulkEntities[i]).Should().Be(singleScene.World.GetName(singleEntities[i]));
            bulkScene.World.GetWorldPosition2D(bulkEntities[i])
                .Should().Be(singleScene.World.GetWorldPosition2D(singleEntities[i]));

            bulkScene.World.TryGetData(bulkEntities[i], out Scene2DSpriteRenderer bulkRenderer).Should().BeTrue();
            singleScene.World.TryGetData(singleEntities[i], out Scene2DSpriteRenderer singleRenderer).Should().BeTrue();
            bulkRenderer.TextureId.Should().Be(singleRenderer.TextureId);
            bulkRenderer.PassId.Should().Be(singleRenderer.PassId);
            bulkRenderer.Size.Should().Be(singleRenderer.Size);
            bulkRenderer.Anchor.Should().Be(singleRenderer.Anchor);
            bulkRenderer.Color.Should().Be(singleRenderer.Color);
            bulkRenderer.UvRect.Should().Be(singleRenderer.UvRect);
            bulkRenderer.SortingLayer.Should().Be(singleRenderer.SortingLayer);
            bulkRenderer.RenderOrder.Should().Be(singleRenderer.RenderOrder);
            bulkRenderer.Depth.Should().Be(singleRenderer.Depth);
            bulkRenderer.FlipX.Should().Be(singleRenderer.FlipX);
            bulkRenderer.FlipY.Should().Be(singleRenderer.FlipY);
        }
    }

    [Fact]
    public void BulkCreationKeepsInputOrderAndDeterministicIdentities()
    {
        Scene2DSpriteSpec[] specs = CreateSpecs(16);
        using Scene2D scene = Scene2D.Create();
        var entities = new SceneEntity[specs.Length];

        scene.CreateSprites(specs, entities).Should().Be(specs.Length);

        for (int i = 0; i < specs.Length; i++)
        {
            entities[i].Slot.Should().Be(i);
            scene.World.GetWorldPosition2D(entities[i]).Should().Be(specs[i].Position);
            scene.World.TryGetData(entities[i], out Scene2DSpriteRenderer renderer).Should().BeTrue();
            renderer.RenderOrder.Should().Be(i);
            renderer.TextureId.Should().Be(specs[i].Sprite.TextureId);
        }
    }

    [Fact]
    public void CapacityGrowthIsDeterministicAcrossBatchShapes()
    {
        Scene2DSpriteSpec[] specs = CreateSpecs(20);
        using Scene2D oneBatch = Scene2D.Create(new Scene2DCreateOptions
        {
            WorldOptions = new SceneWorldOptions(4)
        });
        using Scene2D chunked = Scene2D.Create(new Scene2DCreateOptions
        {
            WorldOptions = new SceneWorldOptions(4)
        });

        var oneBatchEntities = new SceneEntity[specs.Length];
        oneBatch.CreateSprites(specs, oneBatchEntities).Should().Be(specs.Length);

        var chunkEntities = new SceneEntity[5];
        for (int offset = 0; offset < specs.Length; offset += 5)
        {
            chunked.CreateSprites(specs.AsSpan(offset, 5), chunkEntities).Should().Be(5);
        }

        oneBatch.EntityCount.Should().Be(chunked.EntityCount);
        oneBatch.Capacity.Should().Be(chunked.Capacity);
        oneBatch.Capacity.Should().Be(32);
    }

    [Fact]
    public void WarmBulkCreationAllocatesZeroBytes()
    {
        using Scene2D scene = Scene2D.Create(new Scene2DCreateOptions
        {
            WorldOptions = new SceneWorldOptions(32)
        });
        Scene2DSpriteSpec[] specs = CreateSpecs(16);
        var entities = new SceneEntity[specs.Length];

        scene.CreateSprites(specs, entities);
        scene.World.DestroyAllEntities();
        scene.CreateSprites(specs, entities);
        scene.World.DestroyAllEntities();

        long before = GC.GetAllocatedBytesForCurrentThread();
        int created = scene.CreateSprites(specs, entities);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        created.Should().Be(specs.Length);
        delta.Should().Be(0);
    }

    [Fact]
    public void InvalidSpecRollsBackBeforeAnyEntityIsCreated()
    {
        Scene2DSpriteSpec[] specs = CreateSpecs(4);
        specs[2] = new Scene2DSpriteSpec { Position = new Vec2(float.NaN, 0.0f) };
        using Scene2D scene = Scene2D.Create();
        var entities = new SceneEntity[specs.Length];

        Action create = () => scene.CreateSprites(specs, entities);

        create.Should().Throw<SceneValidationException>();
        scene.EntityCount.Should().Be(0);
    }

    [Fact]
    public void ShortDestinationIsRejectedBeforeAnyEntityIsCreated()
    {
        Scene2DSpriteSpec[] specs = CreateSpecs(4);
        using Scene2D scene = Scene2D.Create();

        Action create = () => scene.CreateSprites(specs, new SceneEntity[1]);

        create.Should().Throw<ArgumentException>();
        scene.EntityCount.Should().Be(0);
    }

    [Fact]
    public void EmptyBulkIsANoOp()
    {
        using Scene2D scene = Scene2D.Create();

        int created = scene.CreateSprites(
            ReadOnlySpan<Scene2DSpriteSpec>.Empty,
            Span<SceneEntity>.Empty);

        created.Should().Be(0);
        scene.EntityCount.Should().Be(0);
    }

    [Fact]
    public void BulkCreationRequiresACompletePayloadProfile()
    {
        var runtime = SceneRuntimeProfiles.CreateCustom("test/core-2d", SceneProfiles.CreateCore2D());

        Action create = () => Scene2D.Create(new Scene2DCreateOptions { RuntimeProfile = runtime });

        create.Should().Throw<SceneCapabilityException>().Which.Capability.Should().Be("Scene2D");
    }

    private static Scene2DSpriteSpec[] CreateSpecs(int count)
    {
        var specs = new Scene2DSpriteSpec[count];
        for (int i = 0; i < count; i++)
        {
            specs[i] = new Scene2DSpriteSpec
            {
                EntityConfig = new SceneEntityConfig("Sprite"),
                Sprite = new Scene2DSpriteConfig
                {
                    TextureId = SceneStringId.FromName("texture/hero"),
                    Size = new Vec2(1.0f + i, 2.0f),
                    Anchor = new Vec2(0.25f, 0.75f),
                    Color = new Vec4(1.0f, 0.5f, 0.25f, 1.0f),
                    SortingLayer = i % 3,
                    RenderOrder = i,
                    Depth = i * 0.01f
                },
                Position = new Vec2(i, i * 0.5f)
            };
        }

        return specs;
    }
}
