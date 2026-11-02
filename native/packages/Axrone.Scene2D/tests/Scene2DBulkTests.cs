namespace Scene2DTests;

public class Scene2DBulkTests
{
    [Fact]
    public void BulkCreationMatchesIndividualCreationState()
    {
        Scene2DSpriteSpec[] specs = CreateSpecs(8);
        using Scene2D bulkScene = Scene2D.Create();
        using Scene2D singleScene = Scene2D.Create();

        var bulkActors = new SceneActor[specs.Length];
        int created = bulkScene.CreateSprites(specs, bulkActors);
        created.Should().Be(specs.Length);

        var singleActors = new SceneActor[specs.Length];
        for (int i = 0; i < specs.Length; i++)
        {
            SceneActorConfig actorConfig = specs[i].ActorConfig;
            Scene2DSpriteConfig spriteConfig = specs[i].Sprite;
            SceneActor actor = singleScene.CreateSpriteActor(in actorConfig, in spriteConfig);
            Vec2 position = specs[i].Position;
            singleScene.World.GetTransform2D(actor).SetPosition(in position);
            singleActors[i] = actor;
        }

        singleScene.World.UpdateTransforms();
        bulkScene.ActorCount.Should().Be(singleScene.ActorCount);
        bulkScene.Capacity.Should().Be(singleScene.Capacity);

        for (int i = 0; i < specs.Length; i++)
        {
            bulkActors[i].Should().Be(singleActors[i]);
            bulkScene.World.GetName(bulkActors[i]).Should().Be(singleScene.World.GetName(singleActors[i]));
            bulkScene.World.GetWorldPosition2D(bulkActors[i])
                .Should().Be(singleScene.World.GetWorldPosition2D(singleActors[i]));

            bulkScene.World.TryGetData(bulkActors[i], out Scene2DSpriteRenderer bulkRenderer).Should().BeTrue();
            singleScene.World.TryGetData(singleActors[i], out Scene2DSpriteRenderer singleRenderer).Should().BeTrue();
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
        var actors = new SceneActor[specs.Length];

        scene.CreateSprites(specs, actors).Should().Be(specs.Length);

        for (int i = 0; i < specs.Length; i++)
        {
            actors[i].Slot.Should().Be(i);
            scene.World.GetWorldPosition2D(actors[i]).Should().Be(specs[i].Position);
            scene.World.TryGetData(actors[i], out Scene2DSpriteRenderer renderer).Should().BeTrue();
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

        var oneBatchActors = new SceneActor[specs.Length];
        oneBatch.CreateSprites(specs, oneBatchActors).Should().Be(specs.Length);

        var chunkActors = new SceneActor[5];
        for (int offset = 0; offset < specs.Length; offset += 5)
        {
            chunked.CreateSprites(specs.AsSpan(offset, 5), chunkActors).Should().Be(5);
        }

        oneBatch.ActorCount.Should().Be(chunked.ActorCount);
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
        var actors = new SceneActor[specs.Length];

        scene.CreateSprites(specs, actors);
        scene.World.DestroyAllActors();
        scene.CreateSprites(specs, actors);
        scene.World.DestroyAllActors();

        long before = GC.GetAllocatedBytesForCurrentThread();
        int created = scene.CreateSprites(specs, actors);
        long delta = GC.GetAllocatedBytesForCurrentThread() - before;

        created.Should().Be(specs.Length);
        delta.Should().Be(0);
    }

    [Fact]
    public void InvalidSpecRollsBackBeforeAnyActorIsCreated()
    {
        Scene2DSpriteSpec[] specs = CreateSpecs(4);
        specs[2] = new Scene2DSpriteSpec { Position = new Vec2(float.NaN, 0.0f) };
        using Scene2D scene = Scene2D.Create();
        var actors = new SceneActor[specs.Length];

        Action create = () => scene.CreateSprites(specs, actors);

        create.Should().Throw<SceneValidationException>();
        scene.ActorCount.Should().Be(0);
    }

    [Fact]
    public void ShortDestinationIsRejectedBeforeAnyActorIsCreated()
    {
        Scene2DSpriteSpec[] specs = CreateSpecs(4);
        using Scene2D scene = Scene2D.Create();

        Action create = () => scene.CreateSprites(specs, new SceneActor[1]);

        create.Should().Throw<ArgumentException>();
        scene.ActorCount.Should().Be(0);
    }

    [Fact]
    public void EmptyBulkIsANoOp()
    {
        using Scene2D scene = Scene2D.Create();

        int created = scene.CreateSprites(
            ReadOnlySpan<Scene2DSpriteSpec>.Empty,
            Span<SceneActor>.Empty);

        created.Should().Be(0);
        scene.ActorCount.Should().Be(0);
    }

    [Fact]
    public void BulkCreationRequiresRendererCapability()
    {
        var runtime = SceneRuntimeProfiles.CreateCustom("test/core-2d", SceneProfiles.CreateCore2D());
        using Scene2D scene = Scene2D.Create(new Scene2DCreateOptions { RuntimeProfile = runtime });
        Scene2DSpriteSpec[] specs = CreateSpecs(2);
        var actors = new SceneActor[specs.Length];

        Action create = () => scene.CreateSprites(specs, actors);

        create.Should().Throw<SceneCapabilityException>().Which.Capability.Should().Be("SpriteRenderer");
        scene.ActorCount.Should().Be(0);
    }

    private static Scene2DSpriteSpec[] CreateSpecs(int count)
    {
        var specs = new Scene2DSpriteSpec[count];
        for (int i = 0; i < count; i++)
        {
            specs[i] = new Scene2DSpriteSpec
            {
                ActorConfig = new SceneActorConfig("Sprite"),
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
