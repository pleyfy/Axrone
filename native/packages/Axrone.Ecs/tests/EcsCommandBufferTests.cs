namespace Axrone.Ecs.Tests;

internal struct EcsTestUnregistered
{
    public int Value;
}

public sealed class EcsCommandBufferTests : IDisposable
{
    private readonly World _world;

    public EcsCommandBufferTests()
    {
        ComponentRegistry.Register<EcsTestPosition>();
        ComponentRegistry.Register<EcsTestVelocity>();
        ComponentRegistry.Register<EcsTestHealth>();
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void AddSetRemoveCommandsApplyInEnqueueOrder()
    {
        Entity entity = _world.BeginEntity().With(new EcsTestPosition(1.0f, 0.0f)).Commit();
        var buffer = new EntityCommandBuffer();

        buffer.EnqueueAdd(entity, new EcsTestVelocity(5.0f));
        buffer.EnqueueSet(entity, new EcsTestPosition(9.0f, 0.0f));
        buffer.EnqueueRemove<EcsTestVelocity>(entity);
        buffer.Count.Should().Be(3);

        buffer.Playback(_world);

        buffer.Count.Should().Be(0);
        _world.HasComponent<EcsTestVelocity>(entity).Should().BeFalse();
        _world.GetComponent<EcsTestPosition>(entity).X.Should().BeApproximately(9.0f, 1e-4f);
        _world.WasRemoved<EcsTestVelocity>(entity, -1).Should().BeTrue();
    }

    [Fact]
    public void PayloadRoundTripsEveryField()
    {
        Entity entity = _world.BeginEntity().Commit();
        var buffer = new EntityCommandBuffer();
        buffer.EnqueueAdd(entity, new EcsTestHealth(42.5f));
        buffer.Playback(_world);

        _world.GetComponent<EcsTestHealth>(entity).Hp.Should().BeApproximately(42.5f, 1e-4f);
    }

    [Fact]
    public void RepeatedCommandsSurviveBufferGrowth()
    {
        Entity entity = _world.BeginEntity().Commit();
        var buffer = new EntityCommandBuffer(4);

        for (int index = 0; index < 1000; index++)
        {
            if (index == 0)
            {
                buffer.EnqueueAdd(entity, new EcsTestPosition(index, 0.0f));
            }
            else
            {
                buffer.EnqueueSet(entity, new EcsTestPosition(index, 0.0f));
            }
        }

        buffer.Playback(_world);

        _world.GetComponent<EcsTestPosition>(entity).X.Should().BeApproximately(999.0f, 1e-4f);
    }

    [Fact]
    public void BuffersPlayedInIndexOrderAreDeterministic()
    {
        Entity entity = _world.BeginEntity().With(new EcsTestPosition(0.0f, 0.0f)).Commit();

        var first = new EntityCommandBuffer();
        first.EnqueueSet(entity, new EcsTestPosition(1.0f, 0.0f));
        var second = new EntityCommandBuffer();
        second.EnqueueSet(entity, new EcsTestPosition(2.0f, 0.0f));

        first.Playback(_world);
        second.Playback(_world);
        _world.GetComponent<EcsTestPosition>(entity).X.Should().BeApproximately(2.0f, 1e-4f);

        first.EnqueueSet(entity, new EcsTestPosition(3.0f, 0.0f));
        second.EnqueueSet(entity, new EcsTestPosition(4.0f, 0.0f));
        second.Playback(_world);
        first.Playback(_world);
        _world.GetComponent<EcsTestPosition>(entity).X.Should().BeApproximately(3.0f, 1e-4f);
    }

    [Fact]
    public void PlaybackDrainsAndTheBufferCanBeReused()
    {
        Entity entity = _world.BeginEntity().Commit();
        var buffer = new EntityCommandBuffer();

        buffer.EnqueueAdd(entity, new EcsTestVelocity(1.0f));
        buffer.Playback(_world);
        buffer.Count.Should().Be(0);

        buffer.EnqueueSet(entity, new EcsTestVelocity(4.0f));
        buffer.Playback(_world);
        _world.GetComponent<EcsTestVelocity>(entity).VX.Should().BeApproximately(4.0f, 1e-4f);
    }

    [Fact]
    public void UnregisteredComponentBindingFailsClosed()
    {
        Entity entity = _world.BeginEntity().Commit();
        var buffer = new EntityCommandBuffer();
        buffer.EnqueueAdd(entity, new EcsTestUnregistered { Value = 1 });

        Action playback = () => buffer.Playback(_world);
        playback.Should().Throw<EcsConfigurationException>().WithMessage("*no registered*");
    }

    [Fact]
    public void PayloadlessSetCommandFailsClosed()
    {
        Entity entity = _world.BeginEntity().With(new EcsTestPosition(1.0f, 0.0f)).Commit();
        var buffer = new EntityCommandBuffer();
        buffer.Enqueue(EntityCommand.Set(entity, ComponentType<EcsTestPosition>.Id));

        Action playback = () => buffer.Playback(_world);
        playback.Should().Throw<EcsConfigurationException>().WithMessage("*payload*");
    }

    [Fact]
    public void EnqueueDoesNotAllocateInSteadyState()
    {
        Entity entity = _world.BeginEntity().Commit();
        var buffer = new EntityCommandBuffer(1024);
        var position = new EcsTestPosition(1.0f, 2.0f);

        EcsAllocationHarness.Outcome outcome = EcsAllocationHarness.AssertEveryWindowClean(
            () =>
            {
                for (int command = 0; command < 100; command++)
                {
                    buffer.EnqueueAdd(entity, in position);
                }

                buffer.Clear();
            },
            betweenWindows: null,
            EcsAllocationHarness.Windows,
            EcsAllocationHarness.PrimePasses,
            "command buffer enqueue",
            [new EcsGatePhase("enqueue-one", () => buffer.EnqueueAdd(entity, in position))]);

        outcome.MeasuredWindows.Should().Be(EcsAllocationHarness.Windows);
    }
}
