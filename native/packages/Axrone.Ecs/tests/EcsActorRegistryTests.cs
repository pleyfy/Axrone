namespace Axrone.Ecs.Tests;

internal readonly struct EcsActorMarker(float value)
{
    internal readonly float Value = value;
}

public sealed class EcsActorRegistryTests : IDisposable
{
    private readonly World _world;

    public EcsActorRegistryTests()
    {
        ComponentRegistry.Register<EcsActorMarker>();
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private Entity NewEntity() => _world.BeginEntity().Commit();

    [Fact]
    public void Register_Then_Read_Identity_Round_Trips()
    {
        Entity entity = NewEntity();
        EcsActorName name = EcsActorNames.Intern("actor.roundtrip.player");
        EcsActorTag tag = EcsActorTags.Intern("actor.roundtrip.hero");

        _world.RegisterActor(entity, name, tag, layer: 3);

        _world.ActorCount.Should().Be(1);
        _world.TryGetActor(entity, out EcsActorInfo info).Should().BeTrue();
        info.Name.Should().Be(name);
        info.Tag.Should().Be(tag);
        info.Layer.Should().Be(3);
        info.Entity.Should().Be(entity);
        name.ToString().Should().Be("actor.roundtrip.player");
    }

    [Fact]
    public void Name_Resolves_To_Its_Entity()
    {
        Entity entity = NewEntity();
        EcsActorName name = EcsActorNames.Intern("actor.resolution.camera");

        _world.RegisterActor(entity, name);

        _world.TryFindActor(name, out Entity found).Should().BeTrue();
        found.Should().Be(entity);
        _world.TryFindActor(EcsActorNames.Intern("actor.resolution.missing"), out _).Should().BeFalse();
    }

    [Fact]
    public void Untagged_Registration_Keeps_The_Slot_Default()
    {
        Entity entity = NewEntity();
        _world.RegisterActor(entity, EcsActorNames.Intern("actor.untagged"));

        _world.TryGetActor(entity, out EcsActorInfo info).Should().BeTrue();
        info.Tag.Should().Be(EcsActorTag.Empty);
        _world.GetActorsByTag(EcsActorTags.Intern("actor.untagged.none"), stackalloc Entity[4]).Should().Be(0);
    }

    [Fact]
    public void Re_Registering_The_Same_Entity_Replaces_Its_Identity()
    {
        Entity entity = NewEntity();
        EcsActorTag before = EcsActorTags.Intern("actor.reindex.before");
        EcsActorTag after = EcsActorTags.Intern("actor.reindex.after");
        Span<Entity> buffer = stackalloc Entity[4];

        _world.RegisterActor(entity, EcsActorNames.Intern("actor.reindex"), before, layer: 1);
        _world.RegisterActor(entity, EcsActorNames.Intern("actor.reindex"), after, layer: 2);

        _world.ActorCount.Should().Be(1);
        _world.GetActorsByTag(before, buffer).Should().Be(0);
        _world.GetActorsByTag(after, buffer).Should().Be(1);
        _world.GetActorsByLayer(2, buffer).Should().Be(1);
        _world.GetActorsByLayer(1, buffer).Should().Be(0);
        _world.TryGetActor(entity, out EcsActorInfo info).Should().BeTrue();
        info.Tag.Should().Be(after);
    }

    [Fact]
    public void Duplicate_Name_On_Another_Entity_Is_A_Typed_Conflict()
    {
        Entity first = NewEntity();
        Entity second = NewEntity();
        EcsActorName name = EcsActorNames.Intern("actor.duplicate.name");

        _world.RegisterActor(first, name);

        _ = ((Action)(() => _world.RegisterActor(second, name)))
            .Should().Throw<EcsActorNameConflictException>();

        _world.ActorCount.Should().Be(1);
        _world.TryFindActor(name, out Entity owner).Should().BeTrue();
        owner.Should().Be(first);
    }

    [Fact]
    public void Unregister_Drops_Indexes_And_Is_Idempotent()
    {
        Entity entity = NewEntity();
        EcsActorName name = EcsActorNames.Intern("actor.unregister");
        EcsActorTag tag = EcsActorTags.Intern("actor.unregister.tag");
        Span<Entity> buffer = stackalloc Entity[4];

        _world.RegisterActor(entity, name, tag, layer: 7);
        _world.UnregisterActor(entity).Should().BeTrue();
        _world.UnregisterActor(entity).Should().BeFalse();

        _world.ActorCount.Should().Be(0);
        _world.TryGetActor(entity, out _).Should().BeFalse();
        _world.TryFindActor(name, out _).Should().BeFalse();
        _world.GetActorsByTag(tag, buffer).Should().Be(0);
        _world.GetActorsByLayer(7, buffer).Should().Be(0);
    }

    [Fact]
    public void Destroying_An_Entity_Clears_Its_Actor_Registration()
    {
        Entity entity = NewEntity();
        EcsActorName name = EcsActorNames.Intern("actor.destroy.cleanup");
        EcsActorTag tag = EcsActorTags.Intern("actor.destroy.tag");
        Span<Entity> buffer = stackalloc Entity[4];

        _world.RegisterActor(entity, name, tag, layer: 5);
        _world.DestroyEntity(entity);

        _world.ActorCount.Should().Be(0);
        _world.TryFindActor(name, out _).Should().BeFalse();
        _world.GetActorsByTag(tag, buffer).Should().Be(0);
        _world.GetActorsByLayer(5, buffer).Should().Be(0);
    }

    [Fact]
    public void Stale_Handle_Never_Resolves_To_A_Recycled_Slot_Actor()
    {
        Entity first = NewEntity();
        EcsActorName name = EcsActorNames.Intern("actor.recycle.name");
        _world.RegisterActor(first, name);

        _world.DestroyEntity(first);
        Entity recycled = NewEntity();
        EcsActorName other = EcsActorNames.Intern("actor.recycle.other");
        _world.RegisterActor(recycled, other);

        _world.TryGetActor(first, out _).Should().BeFalse();
        _world.UnregisterActor(first).Should().BeFalse();
        _world.TryGetActor(recycled, out EcsActorInfo info).Should().BeTrue();
        info.Name.Should().Be(other);
    }

    [Fact]
    public void Registering_On_A_Dead_Entity_Is_Rejected()
    {
        Entity entity = NewEntity();
        _world.DestroyEntity(entity);

        _ = ((Action)(() => _world.RegisterActor(entity, EcsActorNames.Intern("actor.dead"))))
            .Should().Throw<EcsEntityException>();
    }

    [Fact]
    public void Tag_And_Layer_Filters_Return_Exact_Handles_In_Span_Order()
    {
        Span<Entity> buffer = stackalloc Entity[8];
        Entity[] entities =
        [
            NewEntity(),
            NewEntity(),
            NewEntity(),
        ];
        EcsActorTag shared = EcsActorTags.Intern("actor.filter.shared");
        EcsActorTag unique = EcsActorTags.Intern("actor.filter.unique");

        _world.RegisterActor(entities[0], EcsActorNames.Intern("actor.filter.a"), shared, layer: 10);
        _world.RegisterActor(entities[1], EcsActorNames.Intern("actor.filter.b"), unique, layer: 10);
        _world.RegisterActor(entities[2], EcsActorNames.Intern("actor.filter.c"), shared, layer: 11);

        int tagged = _world.GetActorsByTag(shared, buffer);
        tagged.Should().Be(2);
        buffer[..tagged].ToArray().Should().Equal(entities[0], entities[2]);

        _world.GetActorsByLayer(10, buffer).Should().Be(2);
        _world.GetActorsByLayer(11, buffer).Should().Be(1);
        _world.GetActors(buffer).Should().Be(3);
    }

    [Fact]
    public void Closed_World_Rejects_New_Actor_Registrations_But_Unregister_Stays_Quiet()
    {
        Entity entity = NewEntity();
        EcsActorName name = EcsActorNames.Intern("actor.closed");
        _world.RegisterActor(entity, name);
        _world.Dispose();

        _ = ((Action)(() => _world.RegisterActor(entity, name))).Should().Throw<EcsWorldClosedException>();
        _ = ((Action)(() => _world.GetActors(stackalloc Entity[1]))).Should().Throw<EcsWorldClosedException>();
        _world.UnregisterActor(entity).Should().BeFalse();
        _world.ActorCount.Should().Be(0);
    }
}
