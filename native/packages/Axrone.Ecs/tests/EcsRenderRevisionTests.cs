namespace Axrone.Ecs.Tests;

internal readonly struct EcsRevisionMarker(int value)
{
    internal readonly int Value = value;
}

public sealed class EcsRenderRevisionTests : IDisposable
{
    private readonly World _world;

    public EcsRenderRevisionTests()
    {
        ComponentRegistry.Register<EcsRevisionMarker>();
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void Every_Mutation_Advances_The_Revision()
    {
        uint before = _world.RenderRevision;

        Entity entity = _world.BeginEntity().Commit();
        _world.RenderRevision.Should().Be(before + 1);

        _world.AddComponent(entity, new EcsRevisionMarker(1));
        _world.RenderRevision.Should().Be(before + 2);

        _world.AddComponent(entity, new EcsRevisionMarker(2));
        _world.RenderRevision.Should().Be(before + 3);

        _world.SetComponent(entity, new EcsRevisionMarker(3));
        _world.RenderRevision.Should().Be(before + 4);

        _world.RemoveComponent<EcsRevisionMarker>(entity);
        _world.RenderRevision.Should().Be(before + 5);

        _world.DestroyEntity(entity);
        _world.RenderRevision.Should().Be(before + 6);
    }

    [Fact]
    public void Reads_Leave_The_Revision_Untouched()
    {
        Entity entity = _world.BeginEntity().With(new EcsRevisionMarker(1)).Commit();
        uint before = _world.RenderRevision;

        _ = _world.GetComponent<EcsRevisionMarker>(entity);
        _ = _world.HasComponent<EcsRevisionMarker>(entity);
        _ = _world.TryGetSingleton(out EcsRevisionMarker value);
        _ = value.Value;
        _world.Step();

        _world.RenderRevision.Should().Be(before);
    }
}
