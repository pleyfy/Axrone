namespace Axrone.Scene.Rendering.Tests;

using System.Text.Json;
using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering;
using FluentAssertions;
using Xunit;

public sealed class SceneSpriteMaskTests
{
    private static SceneSpriteRenderer Sprite() => new()
    {
        TextureId = SceneAssetId<TextureAssetTag>.FromName("texture/sprite"),
        PassId = SceneRenderPassIds.Main,
        Enabled = true,
        Visible = true,
        SortingLayer = 0,
        RenderOrder = 0,
        Size = Vec2.One,
        SourceSize = Vec2.One,
        Anchor = new Vec2(0.5f, 0.5f),
        Color = Vec4.One,
        UvRect = new Vec4(0, 0, 1, 1),
        Depth = 0
    };

    [Fact]
    public void ResolverFindsMaskOnTheSpriteActor()
    {
        using SceneWorld world = RenderingFixture.CreateSpriteRenderableWorld(SceneRenderableFeatures.SpriteMask);
        SceneActor actor = world.CreateActor("Sprite");

        SceneSpriteMask mask = SceneSpriteMask.Default;
        mask.Kind = SceneSpriteMaskKind.Ellipse;
        mask.Rect = new Vec4(0.1f, 0.2f, 0.3f, 0.4f);
        world.AddData(actor, mask);

        SceneSpriteMaskResolver.TryResolve(world, actor, out SceneSpriteMask resolved).Should().BeTrue();
        resolved.Kind.Should().Be(SceneSpriteMaskKind.Ellipse);
        resolved.Rect.Should().Be(new Vec4(0.1f, 0.2f, 0.3f, 0.4f));
    }

    [Fact]
    public void NearestEnabledAncestorMaskWins()
    {
        using SceneWorld world = RenderingFixture.CreateSpriteRenderableWorld(SceneRenderableFeatures.SpriteMask);
        SceneActor root = world.CreateActor("Root");
        SceneActor group = world.CreateActor("Group");
        SceneActor sprite = world.CreateActor("Sprite");
        world.Hierarchy.SetParent(group, root);
        world.Hierarchy.SetParent(sprite, group);

        SceneSpriteMask rootMask = SceneSpriteMask.Default;
        rootMask.Rect = new Vec4(0, 0, 1, 1);
        world.AddData(root, rootMask);

        SceneSpriteMask groupMask = SceneSpriteMask.Default;
        groupMask.Kind = SceneSpriteMaskKind.Ellipse;
        groupMask.Invert = true;
        world.AddData(group, groupMask);

        SceneSpriteMaskResolver.TryResolve(world, sprite, out SceneSpriteMask resolved).Should().BeTrue();
        resolved.Kind.Should().Be(SceneSpriteMaskKind.Ellipse);
        resolved.Invert.Should().BeTrue();
    }

    [Fact]
    public void DisabledNearestMaskFallsThroughToAncestor()
    {
        using SceneWorld world = RenderingFixture.CreateSpriteRenderableWorld(SceneRenderableFeatures.SpriteMask);
        SceneActor parent = world.CreateActor("Parent");
        SceneActor child = world.CreateActor("Child");
        world.Hierarchy.SetParent(child, parent);

        SceneSpriteMask parentMask = SceneSpriteMask.Default;
        parentMask.Rect = new Vec4(0.25f, 0.25f, 0.5f, 0.5f);
        world.AddData(parent, parentMask);

        SceneSpriteMask disabled = SceneSpriteMask.Default;
        disabled.Enabled = false;
        world.AddData(child, disabled);

        SceneSpriteMaskResolver.TryResolve(world, child, out SceneSpriteMask resolved).Should().BeTrue();
        resolved.Rect.Should().Be(new Vec4(0.25f, 0.25f, 0.5f, 0.5f));
    }

    [Fact]
    public void MissingMaskResolvesToFalse()
    {
        using SceneWorld world = RenderingFixture.CreateSpriteRenderableWorld(SceneRenderableFeatures.SpriteMask);
        SceneActor actor = world.CreateActor("Sprite");

        SceneSpriteMaskResolver.TryResolve(world, actor, out _).Should().BeFalse();
    }

    [Fact]
    public void MalformedMaskIsIgnored()
    {
        using SceneWorld world = RenderingFixture.CreateSpriteRenderableWorld(SceneRenderableFeatures.SpriteMask);
        SceneActor actor = world.CreateActor("Sprite");
        SceneSpriteMask mask = SceneSpriteMask.Default;
        mask.Rect = new Vec4(0, 0, 0, 0);
        world.AddData(actor, mask);

        SceneSpriteMaskResolver.TryResolve(world, actor, out _).Should().BeFalse();
    }

    [Fact]
    public void SpriteCollectorPropagatesEffectiveMask()
    {
        using SceneWorld world = RenderingFixture.CreateSpriteRenderableWorld(SceneRenderableFeatures.SpriteMask);
        SceneActor cameraActor = RenderingFixture.CreateCamera(world, new Vec3(0.0f, 0.0f, 10.0f), primary: true);
        SceneCameraFrame frame = new SceneCameraFrameCollector().Collect(world, cameraActor, 800, 600)!;

        SceneActor parent = world.CreateActor("Mask");
        SceneSpriteMask mask = SceneSpriteMask.Default;
        mask.Kind = SceneSpriteMaskKind.Ellipse;
        mask.Rect = new Vec4(0.2f, 0.2f, 0.6f, 0.6f);
        mask.Invert = true;
        world.AddData(parent, mask);

        SceneActor sprite = world.CreateActor("Sprite");
        world.Hierarchy.SetParent(sprite, parent);
        world.AddData(sprite, Sprite());
        world.UpdateTransforms();

        var collector = new SceneSpriteItemCollector();
        collector.Collect(world, frame, SceneRenderPassIds.Main).Should().Be(1);

        SceneSpriteRenderItem item = collector.Items[0];
        item.HasMask.Should().BeTrue();
        item.MaskKind.Should().Be(SceneSpriteMaskKind.Ellipse);
        item.MaskRect.Should().Be(new Vec4(0.2f, 0.2f, 0.6f, 0.6f));
        item.MaskInvert.Should().BeTrue();
        item.MaskFeather.Should().Be(0.0f);
        item.MaskCornerRadius.Should().Be(0.0f);
    }

    [Fact]
    public void CodecRoundTripsMaskFields()
    {
        var codec = new SceneSpriteMaskCodec();
        var value = new SceneSpriteMask
        {
            Kind = SceneSpriteMaskKind.Ellipse,
            Rect = new Vec4(0.1f, 0.2f, 0.3f, 0.4f),
            Invert = true,
            Feather = 0.2f,
            CornerRadius = 0.25f,
            Enabled = false
        };

        JsonElement payload = JsonCapture.Capture(writer => codec.Write(writer, value));
        SceneSpriteMask restored = codec.Read(payload);

        payload.GetProperty("kind").GetString().Should().Be("ellipse");
        restored.Kind.Should().Be(SceneSpriteMaskKind.Ellipse);
        restored.Rect.Should().Be(new Vec4(0.1f, 0.2f, 0.3f, 0.4f));
        restored.Invert.Should().BeTrue();
        restored.Feather.Should().BeApproximately(0.2f, 1e-6f);
        restored.CornerRadius.Should().BeApproximately(0.25f, 1e-6f);
        restored.Enabled.Should().BeFalse();
    }

    [Fact]
    public void CodecRejectsUnknownKind()
    {
        var codec = new SceneSpriteMaskCodec();
        JsonElement payload = JsonCapture.Capture(writer => writer.WriteString("kind", "star"));

        Action read = () => codec.Read(payload);

        read.Should().Throw<SceneValidationException>()
            .Where(exception => exception.Code == SceneErrorCodes.ValidationInvalid);
    }
}
