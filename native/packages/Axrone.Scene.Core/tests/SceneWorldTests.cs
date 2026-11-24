namespace Axrone.Scene.Core.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneWorldTests
{
    [Fact]
    public void CreateEntity_InitializesTransformAndMask()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);

        SceneEntity entity = world.CreateEntity("Player");

        world.EntityCount.Should().Be(1);
        world.ActiveEntityCount.Should().Be(1);
        world.HasTransform3D.Should().BeTrue();
        world.HasData<SceneTransform3D>(entity).Should().BeTrue();
        world.GetData<SceneTransform3D>(entity).Position.Should().Be(Vec3.Zero);
        world.GetComponentMask(entity).IsSet(world.Registry.GetDataByType(typeof(SceneTransform3D)).TypeId)
            .Should().BeTrue();
    }

    [Fact]
    public void TransformMutation_RebuildsWorldMatrix()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity();

        world.GetTransform3D(entity).SetPosition(new Vec3(1.0f, 2.0f, 3.0f));
        world.UpdateTransforms();

        world.GetWorldPosition3D(entity).Should().Be(new Vec3(1.0f, 2.0f, 3.0f));
    }

    [Fact]
    public void Reparent_ComposesParentWorldMatrix()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity parent = world.CreateEntity("Parent");
        SceneEntity child = world.CreateEntity("Child");

        world.GetTransform3D(parent).SetPosition(new Vec3(10.0f, 0.0f, 0.0f));
        world.GetTransform3D(child).SetPosition(new Vec3(1.0f, 0.0f, 0.0f));
        world.Hierarchy.SetParent(child, parent);
        world.UpdateTransforms();

        world.GetWorldPosition3D(child).Should().Be(new Vec3(11.0f, 0.0f, 0.0f));
        world.Hierarchy.DepthOf(child).Should().Be(1);
        world.Hierarchy.ParentOf(child).Should().Be(parent);
    }

    [Fact]
    public void WorldMatrix_UsesRowVectorTranslation()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity();
        world.GetTransform3D(entity).SetPosition(new Vec3(1.0f, 2.0f, 3.0f));
        world.UpdateTransforms();

        Mat4 matrix = world.GetWorldMatrix3D(entity);

        matrix.M41.Should().Be(1.0f);
        matrix.M42.Should().Be(2.0f);
        matrix.M43.Should().Be(3.0f);
        matrix.M14.Should().Be(0.0f);
        matrix.M24.Should().Be(0.0f);
        matrix.M34.Should().Be(0.0f);

        Vec4 transformed = matrix * new Vec4(0.0f, 0.0f, 0.0f, 1.0f);
        transformed.Should().Be(new Vec4(1.0f, 2.0f, 3.0f, 1.0f));
    }

    [Fact]
    public void WorldMatrix_RotationMatchesQuaternionRotation()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity parent = world.CreateEntity("Parent");
        SceneEntity child = world.CreateEntity("Child");
        Quat parentRotation = Quat.CreateFromYawPitchRoll(MathF.PI / 2.0f, 0.0f, 0.0f);

        world.GetTransform3D(parent).SetRotation(parentRotation);
        world.GetTransform3D(child).SetPosition(new Vec3(0.0f, 0.0f, -1.0f));
        world.Hierarchy.SetParent(child, parent);
        world.UpdateTransforms();

        Vec3 expected = parentRotation * new Vec3(0.0f, 0.0f, -1.0f);
        world.GetWorldPosition3D(child).Should().Be(expected);
    }

    [Fact]
    public void WorldRotation_PropagatesToChildren()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity parent = world.CreateEntity("Parent");
        SceneEntity child = world.CreateEntity("Child");
        Quat parentRotation = Quat.CreateFromYawPitchRoll(MathF.PI / 2.0f, 0.0f, 0.0f);

        world.GetTransform3D(parent).SetRotation(parentRotation);
        world.GetTransform3D(child).SetRotation(Quat.Identity);
        world.Hierarchy.SetParent(child, parent);
        world.UpdateTransforms();

        Quat childWorldRotation = world.GetWorldRotation3D(child);
        childWorldRotation.Should().Be(parentRotation);
    }

    [Fact]
    public void ActiveInHierarchy_PropagatesThroughHierarchy()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity parent = world.CreateEntity();
        SceneEntity child = world.CreateEntity();
        world.Hierarchy.SetParent(child, parent);

        world.SetActive(parent, false);

        world.IsActiveSelf(parent).Should().BeFalse();
        world.IsActiveInHierarchy(parent).Should().BeFalse();
        world.IsActiveSelf(child).Should().BeTrue();
        world.IsActiveInHierarchy(child).Should().BeFalse();
        world.ActiveEntityCount.Should().Be(0);

        world.SetActive(parent, true);

        world.IsActiveInHierarchy(child).Should().BeTrue();
        world.ActiveEntityCount.Should().Be(2);
    }

    [Fact]
    public void DestroyEntity_InvalidatesHandleAndDetachesChildren()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity parent = world.CreateEntity();
        SceneEntity child = world.CreateEntity();
        world.Hierarchy.SetParent(child, parent);

        world.DestroyEntity(parent).Should().BeTrue();

        world.EntityCount.Should().Be(1);
        world.TryGetEntity(parent, out _).Should().BeFalse();
        world.Hierarchy.ParentOf(child).Should().Be(SceneEntity.Null);
        Action access = () => world.GetTransform3D(parent);
        access.Should().Throw<SceneStaleHandleException>();
    }

    [Fact]
    public void DataComponent_AddGetRemove_RoundTrips()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity();

        ref Health health = ref world.AddData(entity, new Health { Value = 42 });
        health.Value.Should().Be(42);
        world.GetData<Health>(entity).Value.Should().Be(42);
        world.TryGetData<Health>(entity, out Health copy).Should().BeTrue();
        copy.Value.Should().Be(42);

        world.GetData<Health>(entity).Value = 99;
        world.GetData<Health>(entity).Value.Should().Be(99);

        world.RemoveData<Health>(entity).Should().BeTrue();
        world.HasData<Health>(entity).Should().BeFalse();
    }

    [Fact]
    public void Behaviour_LifecycleAndUpdate_RunInOrder()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        world.Start();
        SceneEntity entity = world.CreateEntity();

        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(entity);

        behaviour.LoadCount.Should().Be(1);
        behaviour.StartCount.Should().Be(1);
        behaviour.EnableCount.Should().Be(1);

        world.Update(0.016f);
        behaviour.Updates.Should().Be(1);

        world.RemoveBehaviour(behaviour).Should().BeTrue();
        behaviour.DestroyCount.Should().Be(1);
        behaviour.DisableCount.Should().Be(1);
    }

    [Fact]
    public void Behaviour_PriorityOrdersDispatch()
    {
        var registry = new SceneComponentRegistry();
        var log = new List<string>();
        registry.RegisterData<SceneTransform3D>("Transform3D", SceneComponentTraits.Required);
        registry.RegisterBehaviour<HighOrderBehaviour>("HighOrder", () => new HighOrderBehaviour(log), priority: 10);
        registry.RegisterBehaviour<LowOrderBehaviour>("LowOrder", () => new LowOrderBehaviour(log), priority: 0);

        using var world = new SceneWorld(registry);
        world.Start();
        SceneEntity entity = world.CreateEntity();
        world.AddBehaviour<HighOrderBehaviour>(entity);
        world.AddBehaviour<LowOrderBehaviour>(entity);

        world.Update(0.016f);

        log.Should().Equal("high", "low");
    }

    [Fact]
    public void BehaviourFault_IsIsolatedAndReported()
    {
        var diagnostics = new RecordingDiagnosticsSink();
        var registry = new SceneComponentRegistry();
        registry.RegisterData<SceneTransform3D>("Transform3D", SceneComponentTraits.Required);
        registry.RegisterBehaviour<ThrowingBehaviour>("Throwing", priority: 10);
        registry.RegisterBehaviour<CounterBehaviour>("Counter", priority: 0);

        using var world = new SceneWorld(registry, diagnostics);
        world.Start();
        SceneEntity entity = world.CreateEntity();
        world.AddBehaviour<ThrowingBehaviour>(entity);
        CounterBehaviour counter = world.AddBehaviour<CounterBehaviour>(entity);

        world.Update(0.016f);

        counter.Updates.Should().Be(1);
        diagnostics.Diagnostics.Should().ContainSingle();
        diagnostics.Diagnostics[0].Code.Should().Be(SceneDiagnosticCodes.BehaviourFaulted);
    }

    [Fact]
    public void BehaviourFault_FailFastRethrows()
    {
        var registry = new SceneComponentRegistry();
        registry.RegisterData<SceneTransform3D>("Transform3D", SceneComponentTraits.Required);
        registry.RegisterBehaviour<ThrowingBehaviour>("Throwing");

        using var world = new SceneWorld(
            registry,
            diagnostics: null,
            new SceneWorldOptions(64, SceneWorldErrorPolicy.FailFast));
        world.Start();
        SceneEntity entity = world.CreateEntity();
        world.AddBehaviour<ThrowingBehaviour>(entity);

        Action update = () => world.Update(0.016f);
        update.Should().Throw<InvalidOperationException>().WithMessage("behaviour fault");
    }

    [Fact]
    public void StructuralMutation_DuringEntityVisit_Throws()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        _ = world.CreateEntity();
        _ = world.CreateEntity();

        var visitor = new CreatingVisitor(world);
        int context = 0;
        Action visit = () => world.VisitEntities(ref visitor, ref context);

        visit.Should().Throw<SceneStructuralMutationException>();
    }

    [Fact]
    public void SteadyState_UpdateDoesNotAllocate()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        world.Start();
        SceneEntity entity = world.CreateEntity();
        _ = world.AddBehaviour<CounterBehaviour>(entity);

        for (int i = 0; i < 100; i++)
        {
            world.Update(0.016f);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++)
        {
            world.Update(0.016f);
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void SteadyState_TransformUpdateDoesNotAllocate()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneEntity entity = world.CreateEntity();
        world.GetTransform3D(entity).SetPosition(new Vec3(1.0f, 2.0f, 3.0f));
        world.UpdateTransforms();

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++)
        {
            world.GetTransform3D(entity).Translate(new Vec3(0.0f, 0.0f, 0.0f));
            world.UpdateTransforms();
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void EntityEnumeration_DoesNotAllocate()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        for (int i = 0; i < 8; i++)
        {
            _ = world.CreateEntity();
        }

        for (int pass = 0; pass < 10; pass++)
        {
            int count = 0;
            foreach (SceneEntity _ in world.Entities)
            {
                count++;
            }

            count.Should().Be(8);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int pass = 0; pass < 1000; pass++)
        {
            int count = 0;
            foreach (SceneEntity _ in world.Entities)
            {
                count++;
            }

            _ = count;
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void Dispose_IsIdempotent()
    {
        SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        _ = world.CreateEntity();

        world.Dispose();
        world.Dispose();

        world.IsDisposed.Should().BeTrue();
        Action create = () => world.CreateEntity();
        create.Should().Throw<SceneDisposedException>();
    }

    private struct CreatingVisitor : ISceneEntityVisitor<int>
    {
        private readonly SceneWorld _world;

        public CreatingVisitor(SceneWorld world) => _world = world;

        public bool Visit(SceneEntity entity, scoped ref int context)
        {
            _ = _world.CreateEntity();
            context++;
            return true;
        }
    }
}
