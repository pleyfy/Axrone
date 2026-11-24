namespace Axrone.Scene.Core.Tests;

using Axrone.Numeric;
using Axrone.Scene;
using FluentAssertions;
using Xunit;

public sealed class SceneWorldTests
{
    [Fact]
    public void CreateActor_InitializesTransformAndMask()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);

        SceneActor actor = world.CreateActor("Player");

        world.ActorCount.Should().Be(1);
        world.ActiveActorCount.Should().Be(1);
        world.HasTransform3D.Should().BeTrue();
        world.HasData<SceneTransform3D>(actor).Should().BeTrue();
        world.GetData<SceneTransform3D>(actor).Position.Should().Be(Vec3.Zero);
        world.GetComponentMask(actor).IsSet(world.Registry.GetDataByType(typeof(SceneTransform3D)).TypeId)
            .Should().BeTrue();
    }

    [Fact]
    public void TransformMutation_RebuildsWorldMatrix()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneActor actor = world.CreateActor();

        world.GetTransform3D(actor).SetPosition(new Vec3(1.0f, 2.0f, 3.0f));
        world.UpdateTransforms();

        world.GetWorldPosition3D(actor).Should().Be(new Vec3(1.0f, 2.0f, 3.0f));
    }

    [Fact]
    public void Reparent_ComposesParentWorldMatrix()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneActor parent = world.CreateActor("Parent");
        SceneActor child = world.CreateActor("Child");

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
        SceneActor actor = world.CreateActor();
        world.GetTransform3D(actor).SetPosition(new Vec3(1.0f, 2.0f, 3.0f));
        world.UpdateTransforms();

        Mat4 matrix = world.GetWorldMatrix3D(actor);

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
        SceneActor parent = world.CreateActor("Parent");
        SceneActor child = world.CreateActor("Child");
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
        SceneActor parent = world.CreateActor("Parent");
        SceneActor child = world.CreateActor("Child");
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
        SceneActor parent = world.CreateActor();
        SceneActor child = world.CreateActor();
        world.Hierarchy.SetParent(child, parent);

        world.SetActive(parent, false);

        world.IsActiveSelf(parent).Should().BeFalse();
        world.IsActiveInHierarchy(parent).Should().BeFalse();
        world.IsActiveSelf(child).Should().BeTrue();
        world.IsActiveInHierarchy(child).Should().BeFalse();
        world.ActiveActorCount.Should().Be(0);

        world.SetActive(parent, true);

        world.IsActiveInHierarchy(child).Should().BeTrue();
        world.ActiveActorCount.Should().Be(2);
    }

    [Fact]
    public void DestroyActor_InvalidatesHandleAndDetachesChildren()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneActor parent = world.CreateActor();
        SceneActor child = world.CreateActor();
        world.Hierarchy.SetParent(child, parent);

        world.DestroyActor(parent).Should().BeTrue();

        world.ActorCount.Should().Be(1);
        world.TryGetActor(parent, out _).Should().BeFalse();
        world.Hierarchy.ParentOf(child).Should().Be(SceneActor.Null);
        Action access = () => world.GetTransform3D(parent);
        access.Should().Throw<SceneStaleHandleException>();
    }

    [Fact]
    public void DataComponent_AddGetRemove_RoundTrips()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        SceneActor actor = world.CreateActor();

        ref Health health = ref world.AddData(actor, new Health { Value = 42 });
        health.Value.Should().Be(42);
        world.GetData<Health>(actor).Value.Should().Be(42);
        world.TryGetData<Health>(actor, out Health copy).Should().BeTrue();
        copy.Value.Should().Be(42);

        world.GetData<Health>(actor).Value = 99;
        world.GetData<Health>(actor).Value.Should().Be(99);

        world.RemoveData<Health>(actor).Should().BeTrue();
        world.HasData<Health>(actor).Should().BeFalse();
    }

    [Fact]
    public void Behaviour_LifecycleAndUpdate_RunInOrder()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        world.Start();
        SceneActor actor = world.CreateActor();

        CounterBehaviour behaviour = world.AddBehaviour<CounterBehaviour>(actor);

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
        SceneActor actor = world.CreateActor();
        world.AddBehaviour<HighOrderBehaviour>(actor);
        world.AddBehaviour<LowOrderBehaviour>(actor);

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
        SceneActor actor = world.CreateActor();
        world.AddBehaviour<ThrowingBehaviour>(actor);
        CounterBehaviour counter = world.AddBehaviour<CounterBehaviour>(actor);

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
        SceneActor actor = world.CreateActor();
        world.AddBehaviour<ThrowingBehaviour>(actor);

        Action update = () => world.Update(0.016f);
        update.Should().Throw<InvalidOperationException>().WithMessage("behaviour fault");
    }

    [Fact]
    public void StructuralMutation_DuringActorVisit_Throws()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        _ = world.CreateActor();
        _ = world.CreateActor();

        var visitor = new CreatingVisitor(world);
        int context = 0;
        Action visit = () => world.VisitActors(ref visitor, ref context);

        visit.Should().Throw<SceneStructuralMutationException>();
    }

    [Fact]
    public void SteadyState_UpdateDoesNotAllocate()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        world.Start();
        SceneActor actor = world.CreateActor();
        _ = world.AddBehaviour<CounterBehaviour>(actor);

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
        SceneActor actor = world.CreateActor();
        world.GetTransform3D(actor).SetPosition(new Vec3(1.0f, 2.0f, 3.0f));
        world.UpdateTransforms();

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int i = 0; i < 1000; i++)
        {
            world.GetTransform3D(actor).Translate(new Vec3(0.0f, 0.0f, 0.0f));
            world.UpdateTransforms();
        }

        long after = GC.GetAllocatedBytesForCurrentThread();
        (after - before).Should().Be(0);
    }

    [Fact]
    public void ActorEnumeration_DoesNotAllocate()
    {
        using SceneWorld world = SceneWorldFixture.Create3DWorld(out _);
        for (int i = 0; i < 8; i++)
        {
            _ = world.CreateActor();
        }

        for (int pass = 0; pass < 10; pass++)
        {
            int count = 0;
            foreach (SceneActor _ in world.Actors)
            {
                count++;
            }

            count.Should().Be(8);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int pass = 0; pass < 1000; pass++)
        {
            int count = 0;
            foreach (SceneActor _ in world.Actors)
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
        _ = world.CreateActor();

        world.Dispose();
        world.Dispose();

        world.IsDisposed.Should().BeTrue();
        Action create = () => world.CreateActor();
        create.Should().Throw<SceneDisposedException>();
    }

    private struct CreatingVisitor : ISceneActorVisitor<int>
    {
        private readonly SceneWorld _world;

        public CreatingVisitor(SceneWorld world) => _world = world;

        public bool Visit(SceneActor actor, scoped ref int context)
        {
            _ = _world.CreateActor();
            context++;
            return true;
        }
    }
}
