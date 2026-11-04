namespace Axrone.Scene.Runtime.Tests;

using Axrone.Numeric;
using Axrone.Physics3D;
using Axrone.Scene;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneJointBridge3DTests
{
    [Fact]
    public void JointBridge_FixedJointResolvesPairAndStaysLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(2.0f, 5.0f, 0.0f));

        SceneFixedJoint3D joint = SceneFixedJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.PendingJointCount.Should().Be(0);
        joints.FaultCount.Should().Be(0);
        physics.PhysicsWorld.Joints.Count.Should().Be(1);
        joints.TryGetJoint(actorA, SceneJointKind3D.Fixed, out JointId jointId).Should().BeTrue();
        physics.PhysicsWorld.Joints.IsValid(jointId).Should().BeTrue();
    }

    [Fact]
    public void JointBridge_HingeWithLimitsAndMotorStaysLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(0.0f, 2.0f, 0.0f));

        SceneHingeJoint3D joint = SceneHingeJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.Axis = new Vec3(0.0f, 1.0f, 0.0f);
        joint.UseLimits = true;
        joint.Limits = new SceneJointLimits3D(-1.0f, 1.0f, 0.2f, 0.01f);
        joint.UseMotor = true;
        joint.Motor = new SceneJointMotor3D(1.5f, 30.0f, false);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.FaultCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_ZeroAxisHingeFaultsWithCount()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(0.0f, 2.0f, 0.0f));

        SceneHingeJoint3D joint = SceneHingeJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.Axis = Vec3.Zero;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.FaultCount.Should().Be(1);
        joints.JointCount.Should().Be(0);
        physics.PhysicsWorld.Joints.Count.Should().Be(0);
    }

    [Fact]
    public void JointBridge_NegativeCharacterSpanFaults()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(0.0f, 2.0f, 0.0f));

        SceneCharacterJoint3D joint = SceneCharacterJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.LowTwistLimit = new SceneSoftJointLimit3D(1.0f, 0.0f, 0.0f);
        joint.HighTwistLimit = new SceneSoftJointLimit3D(0.5f, 0.0f, 0.0f);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.FaultCount.Should().Be(1);
        joints.JointCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_CharacterWithValidSpansStaysLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(0.0f, 2.0f, 0.0f));

        SceneCharacterJoint3D joint = SceneCharacterJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.LowTwistLimit = new SceneSoftJointLimit3D(-0.4f, 0.0f, 0.0f);
        joint.HighTwistLimit = new SceneSoftJointLimit3D(0.4f, 0.0f, 0.0f);
        joint.Swing1Limit = new SceneSoftJointLimit3D(0.6f, 0.0f, 0.0f);
        joint.Swing2Limit = new SceneSoftJointLimit3D(0.0f, 0.0f, 0.0f);
        joint.MotorSpeed = 0.5f;
        joint.MaxMotorTorque = 10.0f;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.FaultCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_SpringAutoConfiguredRestLengthStaysLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(0.0f, 2.0f, 0.0f));

        SceneSpringJoint3D joint = SceneSpringJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.Spring = 20.0f;
        joint.Damper = 1.0f;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.FaultCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_SliderStaysLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(0.0f, 2.0f, 0.0f));

        SceneSliderJoint3D joint = SceneSliderJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.Axis = new Vec3(0.0f, 1.0f, 0.0f);
        joint.UseLimits = true;
        joint.Limits = new SceneJointLimits3D(-1.0f, 1.0f, 0.0f, 0.0f);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.FaultCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_ConfigurablePerAxisModesStayLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(0.0f, 2.0f, 0.0f));

        SceneConfigurableJoint3D joint = SceneConfigurableJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.XMotion = 2.0f;
        joint.LinearLimit = new SceneSoftJointLimit3D(0.5f, 0.0f, 0.0f);
        joint.YMotion = 1.0f;
        joint.ZMotion = 0.0f;
        joint.AngularXMotion = 2.0f;
        joint.LowAngularXLimit = new SceneSoftJointLimit3D(-0.3f, 0.0f, 0.0f);
        joint.HighAngularXLimit = new SceneSoftJointLimit3D(0.3f, 0.0f, 0.0f);
        joint.TargetVelocity = new Vec3(0.0f, 0.0f, 0.0f);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.FaultCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_PendsUntilConnectedBodyHasRigidbody()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = world.CreateActor("NoBodyYet");
        world.GetTransform3D(actorB).SetPosition(new Vec3(0.0f, 2.0f, 0.0f));
        world.UpdateTransforms();

        SceneFixedJoint3D joint = SceneFixedJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(0);
        joints.PendingJointCount.Should().Be(1);

        world.AddData(actorB, SceneRigidbody3D.Default);
        world.AddData(actorB, SceneCollider3D.Default);
        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.PendingJointCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_ComponentRemovalDestroysSolverJoint()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(2.0f, 5.0f, 0.0f));

        SceneFixedJoint3D joint = SceneFixedJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();
        physics.PhysicsWorld.Joints.Count.Should().Be(1);

        world.RemoveData<SceneFixedJoint3D>(actorA);
        joints.SyncJoints();

        joints.JointCount.Should().Be(0);
        physics.PhysicsWorld.Joints.Count.Should().Be(0);
    }

    [Fact]
    public void JointBridge_DataChangeRebuildsWithoutLeak()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(0.0f, 2.0f, 0.0f));

        SceneHingeJoint3D joint = SceneHingeJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.Axis = new Vec3(0.0f, 1.0f, 0.0f);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        SceneHingeJoint3D updated = world.GetData<SceneHingeJoint3D>(actorA);
        updated.UseLimits = true;
        updated.Limits = new SceneJointLimits3D(-0.5f, 0.5f, 0.0f, 0.0f);
        world.GetData<SceneHingeJoint3D>(actorA) = updated;
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        physics.PhysicsWorld.Joints.Count.Should().Be(1);
    }

    [Fact]
    public void JointBridge_TwoJointsOnSameBodyPairAreIndependent()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(2.0f, 5.0f, 0.0f));
        SceneJointActorRef pair = SceneJointActorRef.FromActor(actorB);

        SceneFixedJoint3D weld = SceneFixedJoint3D.Default;
        weld.ConnectedBody = pair;
        world.AddData(actorA, weld);

        SceneSpringJoint3D spring = SceneSpringJoint3D.Default;
        spring.ConnectedBody = pair;
        world.AddData(actorA, spring);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(2);
        physics.PhysicsWorld.Joints.Count.Should().Be(2);
        joints.TryGetJoint(actorA, SceneJointKind3D.Fixed, out JointId weldId).Should().BeTrue();

        world.RemoveData<SceneSpringJoint3D>(actorA);
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.TryGetJoint(actorA, SceneJointKind3D.Fixed, out JointId surviving).Should().BeTrue();
        surviving.Should().Be(weldId);
    }

    [Fact]
    public void JointBridge_ZeroMassScaleFaults()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(2.0f, 5.0f, 0.0f));

        SceneFixedJoint3D joint = SceneFixedJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.MassScale = 0.0f;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.FaultCount.Should().Be(1);
        joints.JointCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_DestroyedBodyPendsAndRebuildsOnRestore()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec3(0.0f, 5.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec3(2.0f, 5.0f, 0.0f));

        SceneFixedJoint3D joint = SceneFixedJoint3D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();
        joints.JointCount.Should().Be(1);

        SceneRigidbody3D disabled = world.GetData<SceneRigidbody3D>(actorB);
        disabled.Enabled = false;
        world.GetData<SceneRigidbody3D>(actorB) = disabled;
        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(0);
        joints.PendingJointCount.Should().Be(1);

        SceneRigidbody3D restored = world.GetData<SceneRigidbody3D>(actorB);
        restored.Enabled = true;
        world.GetData<SceneRigidbody3D>(actorB) = restored;
        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        physics.PhysicsWorld.Joints.Count.Should().Be(1);
    }

    [Fact]
    public void JointBridge_AllSixKindsResolveOnSeparatePairs()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge3D(world);
        using var joints = new SceneJointBridge3D(world, physics);

        SceneActor host = AddBody(world, "Host", new Vec3(0.0f, 30.0f, 0.0f));

        SceneActor targetA = AddBody(world, "TA", new Vec3(2.0f, 5.0f, 0.0f));
        SceneActor targetB = AddBody(world, "TB", new Vec3(2.0f, 10.0f, 0.0f));
        SceneActor targetC = AddBody(world, "TC", new Vec3(2.0f, 15.0f, 0.0f));
        SceneActor targetD = AddBody(world, "TD", new Vec3(2.0f, 20.0f, 0.0f));
        SceneActor targetE = AddBody(world, "TE", new Vec3(2.0f, 25.0f, 0.0f));
        SceneActor targetF = AddBody(world, "TF", new Vec3(2.0f, 30.0f, 0.0f));

        SceneFixedJoint3D fixedJoint = SceneFixedJoint3D.Default;
        fixedJoint.ConnectedBody = SceneJointActorRef.FromActor(targetA);
        world.AddData(host, fixedJoint);

        SceneHingeJoint3D hinge = SceneHingeJoint3D.Default;
        hinge.ConnectedBody = SceneJointActorRef.FromActor(targetB);
        hinge.AutoConfigureConnectedAnchor = false;
        world.AddData(host, hinge);

        SceneSliderJoint3D slider = SceneSliderJoint3D.Default;
        slider.ConnectedBody = SceneJointActorRef.FromActor(targetC);
        slider.AutoConfigureConnectedAnchor = false;
        world.AddData(host, slider);

        SceneSpringJoint3D spring = SceneSpringJoint3D.Default;
        spring.ConnectedBody = SceneJointActorRef.FromActor(targetD);
        spring.AutoConfigureDistance = false;
        spring.MinDistance = 2.0f;
        spring.MaxDistance = 2.0f;
        world.AddData(host, spring);

        SceneCharacterJoint3D character = SceneCharacterJoint3D.Default;
        character.ConnectedBody = SceneJointActorRef.FromActor(targetE);
        character.AutoConfigureConnectedAnchor = false;
        world.AddData(host, character);

        SceneConfigurableJoint3D configurable = SceneConfigurableJoint3D.Default;
        configurable.ConnectedBody = SceneJointActorRef.FromActor(targetF);
        configurable.AutoConfigureConnectedAnchor = false;
        world.AddData(host, configurable);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.FaultCount.Should().Be(0);
        joints.JointCount.Should().Be(6);
        joints.TryGetJoint(host, SceneJointKind3D.Character, out _).Should().BeTrue();
        joints.TryGetJoint(host, SceneJointKind3D.Configurable, out _).Should().BeTrue();
    }

    private static SceneActor AddBody(SceneWorld world, string name, Vec3 position, bool staticBody = false)
    {
        SceneActor actor = world.CreateActor(name);
        world.GetTransform3D(actor).SetPosition(position);
        world.AddData(actor, staticBody ? SceneRigidbody3D.Static : SceneRigidbody3D.Default);
        world.AddData(actor, SceneCollider3D.Default);
        world.UpdateTransforms();
        return actor;
    }

    private static SceneWorld CreateWorld()
    {
        var profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/joints-3d")))
            .AddTransform3D()
            .AddPhysics3D()
            .Build();

        return profile.CreateWorld();
    }
}
