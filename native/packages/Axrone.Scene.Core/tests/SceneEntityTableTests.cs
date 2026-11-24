namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneEntityTableTests
{
    [Fact]
    public void AllocateFreeReuse_BumpsGeneration()
    {
        var table = new SceneEntityTable(4);

        SceneEntity first = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);
        int slot = first.Slot;
        table.LiveCount.Should().Be(1);
        table.Free(slot);
        table.LiveCount.Should().Be(0);
        table.TryResolve(first, out _).Should().BeFalse();

        SceneEntity second = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 1, true, false, false);

        second.Slot.Should().Be(slot);
        second.Generation.Should().NotBe(first.Generation);
        table.TryResolve(second, out int resolvedSlot).Should().BeTrue();
        resolvedSlot.Should().Be(slot);
    }

    [Fact]
    public void Allocate_UsesAscendingSlots()
    {
        var table = new SceneEntityTable(4);

        SceneEntity first = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);
        SceneEntity second = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);
        SceneEntity third = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);

        first.Slot.Should().Be(0);
        second.Slot.Should().Be(1);
        third.Slot.Should().Be(2);

        table.Free(1);
        SceneEntity reused = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);
        reused.Slot.Should().Be(1);
    }

    [Fact]
    public void Grow_PreservesLiveEntities()
    {
        var table = new SceneEntityTable(2);
        SceneEntity first = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);
        SceneEntity second = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);
        SceneEntity third = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);

        table.Capacity.Should().BeGreaterThanOrEqualTo(4);
        table.TryResolve(first, out _).Should().BeTrue();
        table.TryResolve(second, out _).Should().BeTrue();
        table.TryResolve(third, out _).Should().BeTrue();
        table.LiveCount.Should().Be(3);
    }

    [Fact]
    public void Clear_InvalidatesEveryHandle()
    {
        var table = new SceneEntityTable(4);
        SceneEntity first = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);
        SceneEntity second = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);

        table.Clear();

        table.LiveCount.Should().Be(0);
        table.TryResolve(first, out _).Should().BeFalse();
        table.TryResolve(second, out _).Should().BeFalse();
    }

    [Fact]
    public void StaleHandle_IsRejected()
    {
        var table = new SceneEntityTable(4);
        SceneEntity entity = table.Allocate(SceneStringId.Invalid, SceneStringId.Invalid, 0, true, false, false);
        table.Free(entity.Slot);

        Action resolve = () => table.Resolve(entity);

        resolve.Should().Throw<SceneStaleHandleException>();
    }
}
