namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;
using Axrone.Utility.Slots;
using FluentAssertions;
using Xunit;

public sealed class SceneIdentifierTests
{
    [Fact]
    public void SceneActor_FromSlot_RoundTrips()
    {
        SceneActor actor = SceneActor.FromSlot(3, new Generation(2));

        actor.IsValid.Should().BeTrue();
        actor.Slot.Should().Be(3);
        actor.Generation.Value.Should().Be(2U);
        actor.Entity.Id.Value.Should().Be(4);
        actor.Entity.Version.Value.Should().Be(2);
        actor.ToString().Should().Be("SceneActor[3v2]");
    }

    [Fact]
    public void SceneActor_Null_IsNotValid()
    {
        SceneActor.Null.IsNull.Should().BeTrue();
        SceneActor.Null.IsValid.Should().BeFalse();
        SceneActor.Null.Slot.Should().Be(-1);
        SceneActor.Null.ToString().Should().Be("SceneActor[Null]");
    }

    [Fact]
    public void SceneComponentMask_SetsAndClearsBits()
    {
        SceneComponentMask mask = SceneComponentMask.Empty;
        mask.IsEmpty.Should().BeTrue();

        mask = mask.With(new SceneComponentTypeId(3));
        mask = mask.With(new SceneComponentTypeId(70));

        mask.IsSet(new SceneComponentTypeId(3)).Should().BeTrue();
        mask.IsSet(new SceneComponentTypeId(70)).Should().BeTrue();
        mask.IsSet(new SceneComponentTypeId(4)).Should().BeFalse();
        mask.ContainsAll(new SceneComponentMask(0, 0)).Should().BeTrue();

        mask = mask.Without(new SceneComponentTypeId(3));
        mask.IsSet(new SceneComponentTypeId(3)).Should().BeFalse();
        mask.IsSet(new SceneComponentTypeId(70)).Should().BeTrue();
    }

    [Fact]
    public void SceneStringId_IsStable()
    {
        SceneStringId first = SceneStringId.FromName("Transform3D");
        SceneStringId second = SceneStringId.FromName("Transform3D");
        SceneStringId other = SceneStringId.FromName("Transform2D");

        first.Should().Be(second);
        first.Should().NotBe(other);
        first.IsValid.Should().BeTrue();
        SceneStringId.Invalid.IsValid.Should().BeFalse();
    }

    [Fact]
    public void SceneNameTable_InternsAndResolves()
    {
        var names = new SceneNameTable();

        SceneStringId id = names.Intern("Camera");
        names.Intern("Camera").Should().Be(id);
        names.TryResolve(id, out string? resolved).Should().BeTrue();
        resolved.Should().Be("Camera");
        names.TryGetId("Camera", out SceneStringId lookedUp).Should().BeTrue();
        lookedUp.Should().Be(id);
        names.SnapshotNames().Should().ContainSingle().Which.Should().Be("Camera");
    }

    [Fact]
    public void Registry_RegistersDataAndBehaviourTypes()
    {
        var registry = new SceneComponentRegistry();
        SceneDataComponentDescriptor data = registry.RegisterData<Transform3DProbe>(
            "Transform3DProbe",
            SceneComponentTraits.Serializable);
        SceneBehaviourDescriptor behaviour = registry.RegisterBehaviour<ProbeBehaviour>(
            "ProbeBehaviour",
            priority: 7);

        data.TypeId.Value.Should().Be(0);
        data.Kind.Should().Be(SceneComponentKind.Data);
        data.Size.Should().BeGreaterThan(0);
        registry.GetDataByType(typeof(Transform3DProbe)).Should().BeSameAs(data);
        registry.TryGetData(data.TypeId, out SceneDataComponentDescriptor? lookedUp).Should().BeTrue();
        lookedUp.Should().BeSameAs(data);

        behaviour.TypeId.Value.Should().Be(0);
        behaviour.Priority.Should().Be(7);
        registry.GetBehaviourByType(typeof(ProbeBehaviour)).Should().BeSameAs(behaviour);
        registry.TryGetBehaviour(behaviour.TypeId, out SceneBehaviourDescriptor? lookedUpBehaviour).Should().BeTrue();
        lookedUpBehaviour.Should().BeSameAs(behaviour);

        registry.Seal();
        registry.IsSealed.Should().BeTrue();
        Action registerAfterSeal = () => registry.RegisterData<Transform3DProbe>("Again");
        registerAfterSeal.Should().Throw<SceneValidationException>();
    }

    [Fact]
    public void Registry_RejectsDuplicateNamesAcrossTiers()
    {
        var registry = new SceneComponentRegistry();
        registry.RegisterData<Transform3DProbe>("Shared");

        Action register = () => registry.RegisterBehaviour<ProbeBehaviour>("Shared");
        register.Should().Throw<SceneValidationException>();
    }

    private struct Transform3DProbe : ISceneDataComponent
    {
        public int Value;

        public Transform3DProbe(int value) => Value = value;
    }

    private sealed class ProbeBehaviour : ISceneBehaviour
    {
        public void OnAttach(SceneBehaviourContext context)
        {
        }
    }
}
