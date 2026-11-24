namespace Axrone.Ecs.Tests;

internal readonly struct EcsEntityMarker(float value)
{
    internal readonly float Value = value;
}

public sealed class EcsEntityRegistryTests : IDisposable
{
    private readonly World _world;

    public EcsEntityRegistryTests()
    {
        ComponentRegistry.Register<EcsEntityMarker>();
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
        EcsEntityName name = EcsEntityNames.Intern("entity.roundtrip.player");
        EcsEntityTag tag = EcsEntityTags.Intern("entity.roundtrip.hero");

        _world.RegisterEntity(entity, name, tag, layer: 3);

        _world.RegisteredEntityCount.Should().Be(1);
        _world.TryGetEntity(entity, out EcsEntityInfo info).Should().BeTrue();
        info.Name.Should().Be(name);
        info.Tag.Should().Be(tag);
        info.Layer.Should().Be(3);
        info.Entity.Should().Be(entity);
        name.ToString().Should().Be("entity.roundtrip.player");
    }

    [Fact]
    public void Name_Resolves_To_Its_Entity()
    {
        Entity entity = NewEntity();
        EcsEntityName name = EcsEntityNames.Intern("entity.resolution.camera");

        _world.RegisterEntity(entity, name);

        _world.TryFindEntity(name, out Entity found).Should().BeTrue();
        found.Should().Be(entity);
        _world.TryFindEntity(EcsEntityNames.Intern("entity.resolution.missing"), out _).Should().BeFalse();
    }

    [Fact]
    public void Untagged_Registration_Keeps_The_Slot_Default()
    {
        Entity entity = NewEntity();
        _world.RegisterEntity(entity, EcsEntityNames.Intern("entity.untagged"));

        _world.TryGetEntity(entity, out EcsEntityInfo info).Should().BeTrue();
        info.Tag.Should().Be(EcsEntityTag.Empty);
        _world.GetEntitiesByTag(EcsEntityTags.Intern("entity.untagged.none"), stackalloc Entity[4]).Should().Be(0);
    }

    [Fact]
    public void Re_Registering_The_Same_Entity_Replaces_Its_Identity()
    {
        Entity entity = NewEntity();
        EcsEntityTag before = EcsEntityTags.Intern("entity.reindex.before");
        EcsEntityTag after = EcsEntityTags.Intern("entity.reindex.after");
        Span<Entity> buffer = stackalloc Entity[4];

        _world.RegisterEntity(entity, EcsEntityNames.Intern("entity.reindex"), before, layer: 1);
        _world.RegisterEntity(entity, EcsEntityNames.Intern("entity.reindex"), after, layer: 2);

        _world.RegisteredEntityCount.Should().Be(1);
        _world.GetEntitiesByTag(before, buffer).Should().Be(0);
        _world.GetEntitiesByTag(after, buffer).Should().Be(1);
        _world.GetEntitiesByLayer(2, buffer).Should().Be(1);
        _world.GetEntitiesByLayer(1, buffer).Should().Be(0);
        _world.TryGetEntity(entity, out EcsEntityInfo info).Should().BeTrue();
        info.Tag.Should().Be(after);
    }

    [Fact]
    public void Duplicate_Name_On_Another_Entity_Is_A_Typed_Conflict()
    {
        Entity first = NewEntity();
        Entity second = NewEntity();
        EcsEntityName name = EcsEntityNames.Intern("entity.duplicate.name");

        _world.RegisterEntity(first, name);

        _ = ((Action)(() => _world.RegisterEntity(second, name)))
            .Should().Throw<EcsEntityNameConflictException>();

        _world.RegisteredEntityCount.Should().Be(1);
        _world.TryFindEntity(name, out Entity owner).Should().BeTrue();
        owner.Should().Be(first);
    }

    [Fact]
    public void Unregister_Drops_Indexes_And_Is_Idempotent()
    {
        Entity entity = NewEntity();
        EcsEntityName name = EcsEntityNames.Intern("entity.unregister");
        EcsEntityTag tag = EcsEntityTags.Intern("entity.unregister.tag");
        Span<Entity> buffer = stackalloc Entity[4];

        _world.RegisterEntity(entity, name, tag, layer: 7);
        _world.UnregisterEntity(entity).Should().BeTrue();
        _world.UnregisterEntity(entity).Should().BeFalse();

        _world.RegisteredEntityCount.Should().Be(0);
        _world.TryGetEntity(entity, out _).Should().BeFalse();
        _world.TryFindEntity(name, out _).Should().BeFalse();
        _world.GetEntitiesByTag(tag, buffer).Should().Be(0);
        _world.GetEntitiesByLayer(7, buffer).Should().Be(0);
    }

    [Fact]
    public void Destroying_An_Entity_Clears_Its_Entity_Registration()
    {
        Entity entity = NewEntity();
        EcsEntityName name = EcsEntityNames.Intern("entity.destroy.cleanup");
        EcsEntityTag tag = EcsEntityTags.Intern("entity.destroy.tag");
        Span<Entity> buffer = stackalloc Entity[4];

        _world.RegisterEntity(entity, name, tag, layer: 5);
        _world.DestroyEntity(entity);

        _world.RegisteredEntityCount.Should().Be(0);
        _world.TryFindEntity(name, out _).Should().BeFalse();
        _world.GetEntitiesByTag(tag, buffer).Should().Be(0);
        _world.GetEntitiesByLayer(5, buffer).Should().Be(0);
    }

    [Fact]
    public void Stale_Handle_Never_Resolves_To_A_Recycled_Slot_Entity()
    {
        Entity first = NewEntity();
        EcsEntityName name = EcsEntityNames.Intern("entity.recycle.name");
        _world.RegisterEntity(first, name);

        _world.DestroyEntity(first);
        Entity recycled = NewEntity();
        EcsEntityName other = EcsEntityNames.Intern("entity.recycle.other");
        _world.RegisterEntity(recycled, other);

        _world.TryGetEntity(first, out _).Should().BeFalse();
        _world.UnregisterEntity(first).Should().BeFalse();
        _world.TryGetEntity(recycled, out EcsEntityInfo info).Should().BeTrue();
        info.Name.Should().Be(other);
    }

    [Fact]
    public void Registering_On_A_Dead_Entity_Is_Rejected()
    {
        Entity entity = NewEntity();
        _world.DestroyEntity(entity);

        _ = ((Action)(() => _world.RegisterEntity(entity, EcsEntityNames.Intern("entity.dead"))))
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
        EcsEntityTag shared = EcsEntityTags.Intern("entity.filter.shared");
        EcsEntityTag unique = EcsEntityTags.Intern("entity.filter.unique");

        _world.RegisterEntity(entities[0], EcsEntityNames.Intern("entity.filter.a"), shared, layer: 10);
        _world.RegisterEntity(entities[1], EcsEntityNames.Intern("entity.filter.b"), unique, layer: 10);
        _world.RegisterEntity(entities[2], EcsEntityNames.Intern("entity.filter.c"), shared, layer: 11);

        int tagged = _world.GetEntitiesByTag(shared, buffer);
        tagged.Should().Be(2);
        buffer[..tagged].ToArray().Should().Equal(entities[0], entities[2]);

        _world.GetEntitiesByLayer(10, buffer).Should().Be(2);
        _world.GetEntitiesByLayer(11, buffer).Should().Be(1);
        _world.GetRegisteredEntities(buffer).Should().Be(3);
    }

    [Fact]
    public void Closed_World_Rejects_New_Entity_Registrations_But_Unregister_Stays_Quiet()
    {
        Entity entity = NewEntity();
        EcsEntityName name = EcsEntityNames.Intern("entity.closed");
        _world.RegisterEntity(entity, name);
        _world.Dispose();

        _ = ((Action)(() => _world.RegisterEntity(entity, name))).Should().Throw<EcsWorldClosedException>();
        _ = ((Action)(() => _world.GetRegisteredEntities(stackalloc Entity[1]))).Should().Throw<EcsWorldClosedException>();
        _world.UnregisterEntity(entity).Should().BeFalse();
        _world.RegisteredEntityCount.Should().Be(0);
    }
}
