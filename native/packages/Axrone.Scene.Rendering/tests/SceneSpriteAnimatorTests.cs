namespace Axrone.Scene.Rendering.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneSpriteAnimatorTests
{
    [Fact]
    public void Animator_AdvancesFramesAndWritesUvRect()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity entity = CreateSprite(world);
        var animator = world.AddBehaviour<SceneSpriteAnimatorBehaviour>(entity);
        animator.Play(CreateClip(loop: true));

        world.Start();
        SceneSpriteRenderer renderer = world.GetData<SceneSpriteRenderer>(entity);
        renderer.UvRect.Should().Be(new Vec4(0.0f, 0.0f, 0.5f, 1.0f));

        world.Update(0.1f);

        renderer = world.GetData<SceneSpriteRenderer>(entity);
        renderer.UvRect.Should().Be(new Vec4(0.5f, 0.0f, 0.5f, 1.0f));
        animator.FrameIndex.Should().Be(1);
    }

    [Fact]
    public void Animator_LoopsWhenClipLoops()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity entity = CreateSprite(world);
        var animator = world.AddBehaviour<SceneSpriteAnimatorBehaviour>(entity);
        animator.Play(CreateClip(loop: true));

        world.Start();
        world.Update(0.2f);

        animator.FrameIndex.Should().Be(0);
        animator.IsComplete.Should().BeFalse();
    }

    [Fact]
    public void Animator_StopsOnLastFrameWhenClipDoesNotLoop()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity entity = CreateSprite(world);
        var animator = world.AddBehaviour<SceneSpriteAnimatorBehaviour>(entity);
        animator.Play(CreateClip(loop: false));

        world.Start();
        world.Update(0.5f);

        animator.FrameIndex.Should().Be(1);
        animator.IsComplete.Should().BeTrue();
        world.GetData<SceneSpriteRenderer>(entity).UvRect
            .Should().Be(new Vec4(0.5f, 0.0f, 0.5f, 1.0f));
    }

    [Fact]
    public void Animator_PausedHoldsCurrentFrame()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity entity = CreateSprite(world);
        var animator = world.AddBehaviour<SceneSpriteAnimatorBehaviour>(entity);
        animator.Play(CreateClip(loop: true));

        world.Start();
        animator.Playing = false;
        world.Update(0.5f);

        animator.FrameIndex.Should().Be(0);
    }

    [Fact]
    public void Animator_AppliesFrameOverrides()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity entity = CreateSprite(world);
        var animator = world.AddBehaviour<SceneSpriteAnimatorBehaviour>(entity);

        var clip = new SceneSpriteAnimationClip(
            "override",
            [
                new SceneSpriteAnimationFrame(
                    new Vec4(0.0f, 0.0f, 1.0f, 1.0f),
                    1.0f,
                    size: new Vec2(3.0f, 4.0f),
                    anchor: new Vec2(0.25f, 0.75f))
            ]);
        animator.Play(clip);

        SceneSpriteRenderer renderer = world.GetData<SceneSpriteRenderer>(entity);
        renderer.Size.Should().Be(new Vec2(3.0f, 4.0f));
        renderer.Anchor.Should().Be(new Vec2(0.25f, 0.75f));
    }

    [Fact]
    public void Animator_IgnoresEntitiesWithoutSpriteRenderer()
    {
        using SceneWorld world = CreateWorld();
        SceneEntity entity = world.CreateEntity("Empty");
        var animator = world.AddBehaviour<SceneSpriteAnimatorBehaviour>(entity);
        animator.Play(CreateClip(loop: true));

        world.Start();
        world.Update(0.5f);

        animator.FrameIndex.Should().Be(1);
    }

    private static SceneSpriteAnimationClip CreateClip(bool loop) =>
        new(
            "walk",
            [
                new SceneSpriteAnimationFrame(new Vec4(0.0f, 0.0f, 0.5f, 1.0f), 0.1f),
                new SceneSpriteAnimationFrame(new Vec4(0.5f, 0.0f, 0.5f, 1.0f), 0.1f)
            ],
            loop);

    private static SceneWorld CreateWorld()
    {
        var profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/sprite-animator")))
            .AddTransform2D()
            .AddRendering2D(includeCamera: false)
            .Build();

        return profile.CreateWorld();
    }

    private static SceneEntity CreateSprite(SceneWorld world)
    {
        SceneEntity entity = world.CreateEntity("Sprite");
        world.AddData(entity, SceneSpriteRenderer.Default);
        return entity;
    }
}
