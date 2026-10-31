namespace Axrone.Ui.Rendering.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using Axrone.Utility.Slots;
using FluentAssertions;
using Xunit;

public sealed class UiSceneOverlayBridgeTests
{
    private static SceneActor LiveActor() => SceneActor.FromSlot(0, new Generation(1));

    private static UiFrame BuildFrame()
    {
        UiDrawList list = new(1);
        list.Add(UiRenderCommand.Quad(new UiNodeId(1), new Rect(0, 0, 4, 4), UiColor.White, 0));
        return list.Build(new UiViewport(100, 100, 1, 0, 0), list.ComputeMetrics());
    }

    [Fact]
    public void ScreenAttachmentIsStored()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        using UiSceneOverlayBridge bridge = new(host);

        UiOverlayAttachment attachment = new(new UiDocumentId(1), SceneActor.Null, UiOverlaySpace.Screen, 5, 1.0f);
        bridge.TryAttach(in attachment).Should().BeTrue();

        bridge.AttachmentCount.Should().Be(1);
        bridge.TryGetAttachment(new UiDocumentId(1), out UiOverlayAttachment stored).Should().BeTrue();
        stored.Space.Should().Be(UiOverlaySpace.Screen);
        stored.ZOrder.Should().Be(5);
    }

    [Fact]
    public void DuplicateAndInvalidDocumentsAreRejected()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        using UiSceneOverlayBridge bridge = new(host);

        UiOverlayAttachment valid = new(new UiDocumentId(1), SceneActor.Null, UiOverlaySpace.Screen, 0, 1.0f);
        UiOverlayAttachment duplicate = valid with { ZOrder = 9 };
        UiOverlayAttachment invalid = valid with { Document = UiDocumentId.Invalid };

        bridge.TryAttach(in valid).Should().BeTrue();
        bridge.TryAttach(in duplicate).Should().BeFalse();
        bridge.TryAttach(in invalid).Should().BeFalse();
        bridge.AttachmentCount.Should().Be(1);
    }

    [Fact]
    public void WorldAttachmentRequiresActorAndScale()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        using UiSceneOverlayBridge bridge = new(host);

        UiOverlayAttachment noActor = new(new UiDocumentId(1), SceneActor.Null, UiOverlaySpace.World, 0, 100.0f);
        UiOverlayAttachment zeroScale = new(new UiDocumentId(2), LiveActor(), UiOverlaySpace.World, 0, 0.0f);
        UiOverlayAttachment negativeScale = new(new UiDocumentId(3), LiveActor(), UiOverlaySpace.World, 0, -1.0f);
        UiOverlayAttachment valid = new(new UiDocumentId(4), LiveActor(), UiOverlaySpace.World, 0, 100.0f);

        bridge.TryAttach(in noActor).Should().BeFalse();
        bridge.TryAttach(in zeroScale).Should().BeFalse();
        bridge.TryAttach(in negativeScale).Should().BeFalse();
        bridge.TryAttach(in valid).Should().BeTrue();
        bridge.AttachmentCount.Should().Be(1);
    }

    [Fact]
    public void DetachPreservesRemainingOrder()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        using UiSceneOverlayBridge bridge = new(host);

        for (uint i = 1; i <= 3; i++)
        {
            UiOverlayAttachment attachment = new(new UiDocumentId(i), SceneActor.Null, UiOverlaySpace.Screen, 0, 1.0f);
            bridge.TryAttach(in attachment);
        }

        bridge.TryDetach(new UiDocumentId(2)).Should().BeTrue();
        bridge.TryDetach(new UiDocumentId(2)).Should().BeFalse();
        bridge.AttachmentCount.Should().Be(2);
        bridge.TryGetAttachment(new UiDocumentId(1), out _).Should().BeTrue();
        bridge.TryGetAttachment(new UiDocumentId(3), out _).Should().BeTrue();
        bridge.TryGetAttachment(new UiDocumentId(2), out _).Should().BeFalse();
    }

    [Fact]
    public void SubmitRoutesAttachedFramesToTheHost()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        using UiSceneOverlayBridge bridge = new(host);
        UiOverlayAttachment attachment = new(new UiDocumentId(1), SceneActor.Null, UiOverlaySpace.Screen, 0, 1.0f);
        bridge.TryAttach(in attachment);
        UiFrame frame = BuildFrame();

        bridge.TrySubmitFrame(new UiDocumentId(1), frame).Should().BeTrue();
        host.PendingCount.Should().Be(1);
        bridge.SubmittedFrames.Should().Be(1);

        host.Flush();
        backend.FrameCount.Should().Be(1);
    }

    [Fact]
    public void SubmitRejectsUnattachedDocumentsAndNullFrames()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        using UiSceneOverlayBridge bridge = new(host);
        UiFrame frame = BuildFrame();

        bridge.TrySubmitFrame(new UiDocumentId(1), frame).Should().BeFalse();
        bridge.TrySubmitFrame(new UiDocumentId(1), null!).Should().BeFalse();
        host.PendingCount.Should().Be(0);
    }

    [Fact]
    public void DisposeIsIdempotentAndRejectsFurtherUse()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        UiSceneOverlayBridge bridge = new(host);
        UiOverlayAttachment attachment = new(new UiDocumentId(1), SceneActor.Null, UiOverlaySpace.Screen, 0, 1.0f);
        bridge.TryAttach(in attachment);

        bridge.Dispose();
        bridge.Dispose();

        bridge.AttachmentCount.Should().Be(0);
        Action attach = () =>
        {
            UiOverlayAttachment next = new(new UiDocumentId(2), SceneActor.Null, UiOverlaySpace.Screen, 0, 1.0f);
            bridge.TryAttach(in next);
        };
        Action submit = () => bridge.TrySubmitFrame(new UiDocumentId(1), BuildFrame());

        attach.Should().Throw<ObjectDisposedException>();
        submit.Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void AttachGrowsStorageBeyondInitialCapacity()
    {
        using UiRecordingBackend backend = new();
        using UiFrameRenderHost host = new(backend);
        using UiSceneOverlayBridge bridge = new(host);

        for (uint i = 1; i <= 20; i++)
        {
            UiOverlayAttachment attachment = new(new UiDocumentId(i), SceneActor.Null, UiOverlaySpace.Screen, (int)i, 1.0f);
            bridge.TryAttach(in attachment).Should().BeTrue();
        }

        bridge.AttachmentCount.Should().Be(20);
        bridge.TryGetAttachment(new UiDocumentId(20), out UiOverlayAttachment last).Should().BeTrue();
        last.ZOrder.Should().Be(20);
    }
}
