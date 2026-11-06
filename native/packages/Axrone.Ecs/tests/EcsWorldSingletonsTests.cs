namespace Axrone.Ecs.Tests;

internal readonly struct EcsSingletonConfig(int quality, float scale)
{
    internal readonly int Quality = quality;
    internal readonly float Scale = scale;
}

internal readonly struct EcsSingletonClock(double seconds)
{
    internal readonly double Seconds = seconds;
}

public sealed class EcsWorldSingletonsTests : IDisposable
{
    private readonly World _world;

    public EcsWorldSingletonsTests()
    {
        ComponentRegistry.Register<EcsSingletonConfig>();
        ComponentRegistry.Register<EcsSingletonClock>();
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private Entity NewEntity() => _world.BeginEntity().Commit();

    [Fact]
    public void Set_Then_Read_Returns_The_Instance_And_Its_Owner()
    {
        Entity owner = NewEntity();
        _world.SetSingleton(owner, new EcsSingletonConfig(3, 1.5f));

        _world.TryGetSingleton(out EcsSingletonConfig value).Should().BeTrue();
        value.Quality.Should().Be(3);
        value.Scale.Should().Be(1.5f);
        _world.TryGetSingletonEntity<EcsSingletonConfig>(out Entity entity).Should().BeTrue();
        entity.Should().Be(owner);
        _world.HasSingleton<EcsSingletonConfig>().Should().BeTrue();
        _world.SingletonCount.Should().Be(1);
    }

    [Fact]
    public void Missing_Singleton_Reports_False_Instead_Of_Undefined()
    {
        _world.TryGetSingleton(out EcsSingletonClock value).Should().BeFalse();
        value.Seconds.Should().Be(0.0);
        _world.TryGetSingletonEntity<EcsSingletonClock>(out Entity entity).Should().BeFalse();
        entity.Should().Be(Entity.Null);
    }

    [Fact]
    public void Second_Entity_Cannot_Claim_The_Same_Component_Type()
    {
        Entity owner = NewEntity();
        Entity intruder = NewEntity();
        _world.SetSingleton(owner, new EcsSingletonConfig(1, 1.0f));

        EcsSingletonConflictException error = _world.Invoking(w => w.SetSingleton(intruder, new EcsSingletonConfig(2, 2.0f)))
            .Should().Throw<EcsSingletonConflictException>().Which;

        error.Owner.Should().Be(owner);
        error.Attempted.Should().Be(intruder);
        _world.TryGetSingleton(out EcsSingletonConfig value).Should().BeTrue();
        value.Quality.Should().Be(1);
    }

    [Fact]
    public void Re_Registering_The_Owner_Replaces_The_Value_Without_A_Second_Claim()
    {
        Entity owner = NewEntity();
        _world.SetSingleton(owner, new EcsSingletonConfig(1, 1.0f));
        _world.SetSingleton(owner, new EcsSingletonConfig(9, 3.0f));

        _world.SingletonCount.Should().Be(1);
        _world.TryGetSingleton(out EcsSingletonConfig value).Should().BeTrue();
        value.Quality.Should().Be(9);
        _world.TryGetSingletonEntity<EcsSingletonConfig>(out Entity entity).Should().BeTrue();
        entity.Should().Be(owner);
    }

    [Fact]
    public void Singleton_Values_Are_Visible_Through_Queries()
    {
        Entity owner = NewEntity();
        Entity plain = NewEntity();
        _world.AddComponent(plain, new EcsSingletonConfig(0, 0.0f));
        _world.SetSingleton(owner, new EcsSingletonConfig(7, 2.0f));

        int seen = 0;
        foreach (Chunk1<EcsSingletonConfig> chunk in _world.Query<EcsSingletonConfig>())
        {
            seen += chunk.Length;
        }

        seen.Should().Be(2);
        _world.GetComponent<EcsSingletonConfig>(owner).Quality.Should().Be(7);
    }

    [Fact]
    public void RemoveComponent_On_The_Owner_Frees_The_Slot()
    {
        Entity owner = NewEntity();
        _world.SetSingleton(owner, new EcsSingletonConfig(4, 4.0f));

        _world.RemoveComponent<EcsSingletonConfig>(owner);

        _world.HasSingleton<EcsSingletonConfig>().Should().BeFalse();
        _world.SingletonCount.Should().Be(0);
    }

    [Fact]
    public void RemoveSingleton_Drops_The_Component_And_The_Claim()
    {
        Entity owner = NewEntity();
        _world.SetSingleton(owner, new EcsSingletonConfig(5, 5.0f));

        _world.RemoveSingleton<EcsSingletonConfig>().Should().BeTrue();
        _world.RemoveSingleton<EcsSingletonConfig>().Should().BeFalse();

        _world.HasComponent<EcsSingletonConfig>(owner).Should().BeFalse();
        _world.SingletonCount.Should().Be(0);
    }

    [Fact]
    public void Destroying_The_Owner_Frees_The_Slot()
    {
        Entity owner = NewEntity();
        Entity keep = NewEntity();
        _world.SetSingleton(owner, new EcsSingletonConfig(6, 6.0f));
        _world.SetSingleton(keep, new EcsSingletonClock(12.0));

        _world.DestroyEntity(owner);

        _world.HasSingleton<EcsSingletonConfig>().Should().BeFalse();
        _world.HasSingleton<EcsSingletonClock>().Should().BeTrue();
        _world.SingletonCount.Should().Be(1);
    }

    [Fact]
    public void A_Recycled_Handle_Cannot_Keep_An_Old_Singleton_Claim()
    {
        Entity owner = NewEntity();
        _world.SetSingleton(owner, new EcsSingletonConfig(8, 8.0f));
        _world.DestroyEntity(owner);

        Entity recycled = _world.BeginEntity().Commit();
        recycled.Id.Should().Be(owner.Id);
        _world.HasSingleton<EcsSingletonConfig>().Should().BeFalse();
        _world.SetSingleton(recycled, new EcsSingletonConfig(11, 1.0f));
        _world.TryGetSingleton(out EcsSingletonConfig value).Should().BeTrue();
        value.Quality.Should().Be(11);
    }

    [Fact]
    public void Closing_The_World_Drops_Every_Claim()
    {
        Entity survivor = NewEntity();
        _world.SetSingleton(NewEntity(), new EcsSingletonConfig(1, 1.0f));
        _world.SetSingleton(survivor, new EcsSingletonClock(2.0));
        _world.Dispose();

        _world.SingletonCount.Should().Be(0);
        _ = ((Action)(() => _world.SetSingleton(survivor, new EcsSingletonConfig(2, 2.0f))))
            .Should().Throw<EcsWorldClosedException>();
    }
}
