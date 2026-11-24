namespace Axrone.Input.Tests;

/// <summary>
/// Pointer-lock policy: state follows the platform rather than the request, the mouse press
/// behaviour honours the configured mode, an external release is noticed, and disposal obeys the
/// exit policy. The frame half proves that relative motion never moves the hit-test point.
/// </summary>
public sealed class PointerLockTests
{
    private static InputPointerLockOptions On(bool requestOnMouseDown = false, bool exitOnDispose = true, bool raw = true) =>
        new(true, requestOnMouseDown, exitOnDispose, raw);

    [Fact]
    public void Disabled_NeverTouchesThePlatform()
    {
        int requests = 0;
        var controller = new PointerLockController(
            new InputPointerLockOptions(),
            request: () => { requests++; return true; });

        controller.State.Should().Be(PointerLockState.Disabled);
        controller.TryRequest().Should().BeFalse();
        requests.Should().Be(0);
        controller.OnMouseDown().Should().BeFalse();
        controller.SyncWithPlatform().Should().BeFalse();
    }

    [Fact]
    public void TryRequest_KeepsStateUnlockedWhenThePlatformRefuses()
    {
        var controller = new PointerLockController(On(), request: () => false);

        controller.TryRequest().Should().BeFalse("a refused lock is not a lock");
        controller.State.Should().Be(PointerLockState.Unlocked);
        controller.IsLocked.Should().BeFalse();
        controller.ReportsRelativeMotion.Should().BeFalse();
    }

    [Fact]
    public void TryRequest_IsIdempotentOnceLocked()
    {
        int requests = 0;
        var controller = new PointerLockController(On(), request: () => { requests++; return true; });

        controller.TryRequest().Should().BeTrue();
        controller.TryRequest().Should().BeTrue();
        requests.Should().Be(1, "an already held lock is not requested twice");
        controller.ReportsRelativeMotion.Should().BeTrue();
    }

    [Fact]
    public void UseRawMovement_Off_KeepsTheAbsolutePositionWhileLocked()
    {
        var controller = new PointerLockController(On(raw: false), request: () => true);

        controller.TryRequest().Should().BeTrue();
        controller.IsLocked.Should().BeTrue();
        controller.ReportsRelativeMotion.Should().BeFalse();
    }

    [Fact]
    public void Release_KeepsTheLockWhenThePlatformRefuses()
    {
        bool refused = true;
        var controller = new PointerLockController(On(), request: () => true, release: () => !refused);

        controller.TryRequest();
        controller.Release().Should().BeFalse();
        controller.IsLocked.Should().BeTrue();

        refused = false;
        controller.Release().Should().BeTrue();
        controller.IsLocked.Should().BeFalse();
        controller.Release().Should().BeTrue("releasing an unlocked controller is already satisfied");
    }

    [Fact]
    public void MouseDown_RequestsOnlyWhenConfiguredAndAlwaysEscapesALock()
    {
        var withoutRequest = new PointerLockController(On(), request: () => true);
        withoutRequest.OnMouseDown().Should().BeFalse();
        withoutRequest.IsLocked.Should().BeFalse();

        var withRequest = new PointerLockController(On(requestOnMouseDown: true), request: () => true);
        withRequest.OnMouseDown().Should().BeTrue();
        withRequest.IsLocked.Should().BeTrue();
        withRequest.OnMouseDown().Should().BeTrue("a press while locked is the escape hatch");
        withRequest.IsLocked.Should().BeFalse();
    }

    [Fact]
    public void SyncWithPlatform_NoticesAnExternalRelease()
    {
        var transitions = new List<PointerLockState>();
        bool locked = true;
        var controller = new PointerLockController(On(), request: () => true, isLocked: () => locked);
        controller.Changed = transitions.Add;

        controller.TryRequest().Should().BeTrue();
        locked = false;

        controller.SyncWithPlatform().Should().BeTrue();
        controller.State.Should().Be(PointerLockState.Unlocked);
        controller.SyncWithPlatform().Should().BeFalse("the state already matches the platform");

        transitions.Should().Equal(PointerLockState.Locked, PointerLockState.Unlocked);
    }

    [Fact]
    public void SyncWithoutAPollablePlatform_IsInert()
    {
        var controller = new PointerLockController(On(), request: () => true);
        controller.TryRequest();
        controller.SyncWithPlatform().Should().BeFalse();
        controller.IsLocked.Should().BeTrue();
    }

    [Fact]
    public void Disposal_HonoursTheExitPolicy()
    {
        int releases = 0;
        var exits = new PointerLockController(On(), request: () => true, release: () => { releases++; return true; });
        exits.TryRequest();
        exits.OnDisposed().Should().BeTrue();
        exits.IsLocked.Should().BeFalse();
        releases.Should().Be(1);

        var keeps = new PointerLockController(On(exitOnDispose: false), request: () => true);
        keeps.TryRequest();
        keeps.OnDisposed().Should().BeTrue("the policy says nothing has to be released");
        keeps.IsLocked.Should().BeTrue();
    }

    [Fact]
    public void Frame_RelativeMotionNeverMovesTheHitTestPoint()
    {
        using var input = new InputFrameCoordinator();
        var stamp = InputTimestamp.Now();

        input.RingBuffer.TryEnqueue(RawInputEvent.CreateMouseMove(DeviceIndex.Primary, 100.0f, 50.0f, stamp));
        input.NewFrame();
        input.MousePosition.X.Should().Be(100.0f);

        input.RingBuffer.TryEnqueue(RawInputEvent.CreateMouseDelta(DeviceIndex.Primary, 12.0f, -7.0f, stamp));
        input.RingBuffer.TryEnqueue(RawInputEvent.CreateMouseDelta(DeviceIndex.Primary, 3.0f, 1.0f, stamp));
        input.NewFrame();

        input.MouseDelta.X.Should().Be(15.0f);
        input.MouseDelta.Y.Should().Be(-6.0f);
        input.MousePosition.X.Should().Be(100.0f, "a locked pointer has no absolute coordinate to update");
        input.MousePosition.Y.Should().Be(50.0f);

        input.NewFrame();
        input.MouseDelta.X.Should().Be(0.0f);
    }
}
