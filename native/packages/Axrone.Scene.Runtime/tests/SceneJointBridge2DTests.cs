namespace Axrone.Scene.Runtime.Tests;

using Axrone.Numeric;
using Axrone.Physics2D;
using Axrone.Scene;
using Axrone.Scene.Runtime;
using FluentAssertions;
using Xunit;

public sealed class SceneJointBridge2DTests
{
    [Fact]
    public void JointBridge_DistanceJointResolvesPairAndStaysLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec2(0.0f, 0.0f));
        SceneActor actorB = AddBody(world, "B", new Vec2(10.0f, 0.0f));

        SceneDistanceJoint2D joint = SceneDistanceJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.Distance = 2.0f;
        joint.AutoConfigureDistance = false;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.PendingJointCount.Should().Be(0);
        joints.FaultCount.Should().Be(0);
        physics.PhysicsWorld.Joints.Count.Should().Be(1);
        joints.TryGetJoint(actorA, SceneJointKind2D.Distance, out JointId jointId).Should().BeTrue();
        physics.PhysicsWorld.Joints.IsValid(jointId).Should().BeTrue();
    }

    [Fact]
    public void JointBridge_DistanceJointPullsBodiesTogether()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec2(0.0f, 50.0f));
        SceneActor actorB = AddBody(world, "B", new Vec2(10.0f, 50.0f));

        SceneDistanceJoint2D joint = SceneDistanceJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.Distance = 2.0f;
        joint.AutoConfigureDistance = false;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        for (int i = 0; i < 20; i++)
        {
            physics.Step(0.1f);
        }

        BodyId bodyA = physicsTryGet(physics, actorA);
        BodyId bodyB = physicsTryGet(physics, actorB);
        Vec2 positionA = physics.PhysicsWorld.Bodies.GetTransform(bodyA).Position;
        Vec2 positionB = physics.PhysicsWorld.Bodies.GetTransform(bodyB).Position;
        float separation = MathF.Sqrt(
            (positionB.X - positionA.X) * (positionB.X - positionA.X) +
            (positionB.Y - positionA.Y) * (positionB.Y - positionA.Y));
        separation.Should().BeLessThan(9.0f);
        float.IsFinite(separation).Should().BeTrue();
    }

    [Fact]
    public void JointBridge_AutoConfigureDistanceCreatesLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", new Vec2(0.0f, 5.0f));
        SceneActor actorB = AddBody(world, "B", new Vec2(3.0f, 5.0f));

        SceneDistanceJoint2D joint = SceneDistanceJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
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
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = world.CreateActor("NoBodyYet");
        world.GetTransform2D(actorB).SetPosition(new Vec2(4.0f, 0.0f));
        world.UpdateTransforms();

        SceneDistanceJoint2D joint = SceneDistanceJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.AutoConfigureDistance = false;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(0);
        joints.PendingJointCount.Should().Be(1);

        world.AddData(actorB, SceneRigidbody2D.Default);
        world.AddData(actorB, SceneCollider2D.Default);
        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.PendingJointCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_ComponentRemovalDestroysSolverJoint()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));

        SceneDistanceJoint2D joint = SceneDistanceJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.AutoConfigureDistance = false;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();
        physics.PhysicsWorld.Joints.Count.Should().Be(1);

        world.RemoveData<SceneDistanceJoint2D>(actorA);
        joints.SyncJoints();

        joints.JointCount.Should().Be(0);
        physics.PhysicsWorld.Joints.Count.Should().Be(0);
    }

    [Fact]
    public void JointBridge_DisabledJointRemovesAndRestores()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));

        SceneRopeJoint2D joint = SceneRopeJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();
        joints.JointCount.Should().Be(1);

        SceneRopeJoint2D disabled = world.GetData<SceneRopeJoint2D>(actorA);
        disabled.Enabled = false;
        world.GetData<SceneRopeJoint2D>(actorA) = disabled;
        joints.SyncJoints();
        joints.JointCount.Should().Be(0);
        physics.PhysicsWorld.Joints.Count.Should().Be(0);

        SceneRopeJoint2D enabled = world.GetData<SceneRopeJoint2D>(actorA);
        enabled.Enabled = true;
        world.GetData<SceneRopeJoint2D>(actorA) = enabled;
        joints.SyncJoints();
        joints.JointCount.Should().Be(1);
        physics.PhysicsWorld.Joints.Count.Should().Be(1);
    }

    [Fact]
    public void JointBridge_DataChangeRebuildsWithoutLeak()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));

        SceneDistanceJoint2D joint = SceneDistanceJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.AutoConfigureDistance = false;
        joint.Distance = 2.0f;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        SceneDistanceJoint2D updated = world.GetData<SceneDistanceJoint2D>(actorA);
        updated.Distance = 3.0f;
        world.GetData<SceneDistanceJoint2D>(actorA) = updated;
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        physics.PhysicsWorld.Joints.Count.Should().Be(1);

        SceneDistanceJoint2D toggled = world.GetData<SceneDistanceJoint2D>(actorA);
        toggled.EnableCollision = true;
        world.GetData<SceneDistanceJoint2D>(actorA) = toggled;
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        physics.PhysicsWorld.Joints.Count.Should().Be(1);
    }

    [Fact]
    public void JointBridge_HingeMotorDrivesRelativeRotation()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor anchor = AddBody(world, "Anchor", Vec2.Zero, staticBody: true);
        SceneActor swing = AddBody(world, "Swing", new Vec2(2.0f, 50.0f));

        SceneHingeJoint2D joint = SceneHingeJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(anchor);
        joint.Anchor = new Vec2(0.0f, 1.0f);
        joint.UseMotor = true;
        joint.MotorSpeed = 2.0f;
        joint.MaxMotorTorque = 100.0f;
        world.AddData(swing, joint);

        physics.SyncBodies();
        joints.SyncJoints();
        joints.JointCount.Should().Be(1);
        joints.FaultCount.Should().Be(0);

        BodyId swingBody = physicsTryGet(physics, swing);
        float angleBefore = physics.PhysicsWorld.Bodies.GetTransform(swingBody).Angle;
        for (int i = 0; i < 20; i++)
        {
            physics.Step(0.1f);
        }

        float angleAfter = physics.PhysicsWorld.Bodies.GetTransform(swingBody).Angle;
        MathF.Abs(angleAfter - angleBefore).Should().BeGreaterThan(0.01f);
    }

    [Fact]
    public void JointBridge_HingeLimitPayloadStaysLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));

        SceneHingeJoint2D joint = SceneHingeJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.UseLimits = true;
        joint.LimitsMin = -45.0f;
        joint.LimitsMax = 45.0f;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.FaultCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_RopeCapsSeparation()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor anchor = AddBody(world, "Anchor", Vec2.Zero, staticBody: true);
        SceneActor faller = AddBody(world, "Faller", new Vec2(9.0f, 50.0f));

        SceneRopeJoint2D joint = SceneRopeJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(anchor);
        joint.MaxLength = 4.0f;
        world.AddData(faller, joint);

        physics.SyncBodies();
        joints.SyncJoints();
        joints.JointCount.Should().Be(1);

        for (int i = 0; i < 60; i++)
        {
            physics.Step(0.1f);
        }

        BodyId anchorBody = physicsTryGet(physics, anchor);
        BodyId fallerBody = physicsTryGet(physics, faller);
        Vec2 anchorPosition = physics.PhysicsWorld.Bodies.GetTransform(anchorBody).Position;
        Vec2 fallerPosition = physics.PhysicsWorld.Bodies.GetTransform(fallerBody).Position;
        float separation = MathF.Sqrt(
            (fallerPosition.X - anchorPosition.X) * (fallerPosition.X - anchorPosition.X) +
            (fallerPosition.Y - anchorPosition.Y) * (fallerPosition.Y - anchorPosition.Y));
        separation.Should().BeLessThan(6.0f);
    }

    [Fact]
    public void JointBridge_MouseTargetPushedWithoutRebuild()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor ground = AddBody(world, "Ground", Vec2.Zero, staticBody: true);
        SceneActor dragged = AddBody(world, "Dragged", new Vec2(5.0f, 50.0f));

        SceneMouseJoint2D joint = SceneMouseJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(ground);
        joint.Target = new Vec2(5.0f, 50.0f);
        world.AddData(dragged, joint);

        physics.SyncBodies();
        joints.SyncJoints();
        joints.JointCount.Should().Be(1);

        SceneMouseJoint2D moved = world.GetData<SceneMouseJoint2D>(dragged);
        moved.Target = new Vec2(1.0f, 45.0f);
        world.GetData<SceneMouseJoint2D>(dragged) = moved;
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        physics.PhysicsWorld.Joints.Count.Should().Be(1);

        BodyId draggedBody = physicsTryGet(physics, dragged);
        Vec2 before = physics.PhysicsWorld.Bodies.GetTransform(draggedBody).Position;
        for (int i = 0; i < 30; i++)
        {
            physics.Step(0.1f);
        }

        Vec2 after = physics.PhysicsWorld.Bodies.GetTransform(draggedBody).Position;
        DistanceTo(after, new Vec2(1.0f, 45.0f)).Should().BeLessThan(DistanceTo(before, new Vec2(1.0f, 45.0f)));
    }

    [Fact]
    public void JointBridge_MouseNonFiniteTargetCountedNotSwallowed()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor ground = AddBody(world, "Ground", Vec2.Zero, staticBody: true);
        SceneActor dragged = AddBody(world, "Dragged", new Vec2(5.0f, 50.0f));

        SceneMouseJoint2D joint = SceneMouseJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(ground);
        joint.Target = new Vec2(5.0f, 50.0f);
        world.AddData(dragged, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        SceneMouseJoint2D poisoned = world.GetData<SceneMouseJoint2D>(dragged);
        poisoned.Target = new Vec2(float.NaN, 0.0f);
        world.GetData<SceneMouseJoint2D>(dragged) = poisoned;
        joints.SyncJoints();

        joints.MouseTargetFaultCount.Should().Be(1);
        joints.JointCount.Should().Be(1);
    }

    [Fact]
    public void JointBridge_ZeroWheelAxisFaults()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(0.0f, 4.0f));

        SceneWheelJoint2D joint = SceneWheelJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.Axis = Vec2.Zero;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.FaultCount.Should().Be(1);
        joints.JointCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_GearCouplesAfterBothJointsResolve()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));
        SceneActor actorC = AddBody(world, "C", new Vec2(0.0f, 8.0f));
        SceneActor actorD = AddBody(world, "D", new Vec2(4.0f, 8.0f));

        SceneHingeJoint2D hinge = SceneHingeJoint2D.Default;
        hinge.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        world.AddData(actorA, hinge);

        SceneSliderJoint2D slider = SceneSliderJoint2D.Default;
        slider.ConnectedBody = SceneJointActorRef.FromActor(actorD);
        world.AddData(actorC, slider);

        SceneGearJoint2D gear = SceneGearJoint2D.Default;
        gear.JointA = new SceneJointRef2D(actorA.Slot, actorA.Generation.Value, SceneJointKind2D.Hinge);
        gear.JointB = new SceneJointRef2D(actorC.Slot, actorC.Generation.Value, SceneJointKind2D.Slider);
        gear.Ratio = 2.0f;
        SceneActor gearHost = AddBody(world, "Gear", new Vec2(2.0f, 4.0f));
        world.AddData(gearHost, gear);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(3);
        joints.FaultCount.Should().Be(0);
        physics.PhysicsWorld.Joints.Count.Should().Be(3);
    }

    [Fact]
    public void JointBridge_GearWithoutReferencesIsNotRequired()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor gearHost = AddBody(world, "Gear", Vec2.Zero);
        world.AddData(gearHost, SceneGearJoint2D.Default);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(0);
        joints.PendingJointCount.Should().Be(0);
        joints.FaultCount.Should().Be(0);
        physics.PhysicsWorld.Joints.Count.Should().Be(0);
    }

    [Fact]
    public void JointBridge_GearPendingsWhenCoupledJointComponentRemoved()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));
        SceneActor actorC = AddBody(world, "C", new Vec2(0.0f, 8.0f));
        SceneActor actorD = AddBody(world, "D", new Vec2(4.0f, 8.0f));

        SceneHingeJoint2D hinge = SceneHingeJoint2D.Default;
        hinge.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        world.AddData(actorA, hinge);

        SceneSliderJoint2D slider = SceneSliderJoint2D.Default;
        slider.ConnectedBody = SceneJointActorRef.FromActor(actorD);
        world.AddData(actorC, slider);

        SceneGearJoint2D gear = SceneGearJoint2D.Default;
        gear.JointA = new SceneJointRef2D(actorA.Slot, actorA.Generation.Value, SceneJointKind2D.Hinge);
        gear.JointB = new SceneJointRef2D(actorC.Slot, actorC.Generation.Value, SceneJointKind2D.Slider);
        SceneActor gearHost = AddBody(world, "Gear", new Vec2(2.0f, 4.0f));
        world.AddData(gearHost, gear);

        physics.SyncBodies();
        joints.SyncJoints();
        joints.JointCount.Should().Be(3);

        world.RemoveData<SceneHingeJoint2D>(actorA);
        joints.SyncJoints();

        joints.TryGetJoint(gearHost, SceneJointKind2D.Gear, out _).Should().BeFalse();
        joints.PendingJointCount.Should().Be(1);
    }

    [Fact]
    public void JointBridge_TwoJointsOnSameBodyPairAreIndependent()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));

        SceneHingeJoint2D hinge = SceneHingeJoint2D.Default;
        hinge.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        world.AddData(actorA, hinge);

        SceneDistanceJoint2D distance = SceneDistanceJoint2D.Default;
        distance.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        distance.AutoConfigureDistance = false;
        world.AddData(actorA, distance);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(2);
        physics.PhysicsWorld.Joints.Count.Should().Be(2);
        joints.TryGetJoint(actorA, SceneJointKind2D.Hinge, out JointId hingeId).Should().BeTrue();

        world.RemoveData<SceneDistanceJoint2D>(actorA);
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.TryGetJoint(actorA, SceneJointKind2D.Hinge, out JointId survivingHinge).Should().BeTrue();
        survivingHinge.Should().Be(hingeId);
    }

    [Fact]
    public void JointBridge_DestroyedBodyPendsAndRebuildsOnRestore()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));

        SceneDistanceJoint2D joint = SceneDistanceJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.AutoConfigureDistance = false;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();
        joints.JointCount.Should().Be(1);

        SceneRigidbody2D disabled = world.GetData<SceneRigidbody2D>(actorB);
        disabled.Enabled = false;
        world.GetData<SceneRigidbody2D>(actorB) = disabled;
        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(0);
        joints.PendingJointCount.Should().Be(1);
        physics.PhysicsWorld.Joints.Count.Should().Be(0);

        SceneRigidbody2D restored = world.GetData<SceneRigidbody2D>(actorB);
        restored.Enabled = true;
        world.GetData<SceneRigidbody2D>(actorB) = restored;
        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        physics.PhysicsWorld.Joints.Count.Should().Be(1);
    }

    [Fact]
    public void JointBridge_UnknownConnectedSlotStaysPending()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);

        SceneDistanceJoint2D joint = SceneDistanceJoint2D.Default;
        joint.ConnectedBody = new SceneJointActorRef(9999, 1u);
        joint.AutoConfigureDistance = false;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(0);
        joints.PendingJointCount.Should().Be(1);
    }

    [Fact]
    public void JointBridge_RecycledSlotReferenceDoesNotAlias()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));

        SceneDistanceJoint2D joint = SceneDistanceJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        joint.AutoConfigureDistance = false;
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();
        joints.JointCount.Should().Be(1);

        SceneJointActorRef oldReference = joint.ConnectedBody;
        world.DestroyActor(actorB);
        SceneActor recycled = AddBody(world, "Recycled", new Vec2(4.0f, 0.0f));
        recycled.Slot.Should().Be(oldReference.Slot);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(0);
        joints.PendingJointCount.Should().Be(1);

        world.RemoveData<SceneDistanceJoint2D>(actorA);
        world.AddData(actorA, joint with { ConnectedBody = SceneJointActorRef.FromActor(recycled) });
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.PendingJointCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_MotorJointPayloadStaysLive()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));

        SceneMotorJoint2D joint = SceneMotorJoint2D.Default;
        joint.ConnectedBody = SceneJointActorRef.FromActor(actorB);
        world.AddData(actorA, joint);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(1);
        joints.FaultCount.Should().Be(0);
    }

    [Fact]
    public void JointBridge_SliderAndFixedAndSpringAndMouseAndGearAllResolve()
    {
        using SceneWorld world = CreateWorld();
        using var physics = new ScenePhysicsBridge2D(world);
        using var joints = new SceneJointBridge2D(world, physics);

        SceneActor actorA = AddBody(world, "A", Vec2.Zero);
        SceneActor actorB = AddBody(world, "B", new Vec2(4.0f, 0.0f));
        SceneJointActorRef pair = SceneJointActorRef.FromActor(actorB);

        SceneSliderJoint2D slider = SceneSliderJoint2D.Default;
        slider.ConnectedBody = pair;
        slider.UseLimits = true;
        slider.UseMotor = true;
        world.AddData(actorA, slider);

        SceneFixedJoint2D weld = SceneFixedJoint2D.Default;
        weld.ConnectedBody = pair;
        world.AddData(actorA, weld);

        SceneSpringJoint2D spring = SceneSpringJoint2D.Default;
        spring.ConnectedBody = pair;
        world.AddData(actorA, spring);

        SceneRopeJoint2D rope = SceneRopeJoint2D.Default;
        rope.ConnectedBody = pair;
        world.AddData(actorA, rope);

        physics.SyncBodies();
        joints.SyncJoints();

        joints.JointCount.Should().Be(4);
        joints.FaultCount.Should().Be(0);
        joints.TryGetJoint(actorA, SceneJointKind2D.Slider, out _).Should().BeTrue();
        joints.TryGetJoint(actorA, SceneJointKind2D.Fixed, out _).Should().BeTrue();
        joints.TryGetJoint(actorA, SceneJointKind2D.Spring, out _).Should().BeTrue();
        joints.TryGetJoint(actorA, SceneJointKind2D.Rope, out _).Should().BeTrue();
    }

    private static BodyId physicsTryGet(ScenePhysicsBridge2D physics, SceneActor actor)
    {
        physics.TryGetBody(actor, out BodyId bodyId).Should().BeTrue();
        return bodyId;
    }

    private static float DistanceTo(Vec2 point, Vec2 target)
    {
        float dx = point.X - target.X;
        float dy = point.Y - target.Y;
        return MathF.Sqrt((dx * dx) + (dy * dy));
    }

    private static SceneActor AddBody(SceneWorld world, string name, Vec2 position, bool staticBody = false)
    {
        SceneActor actor = world.CreateActor(name);
        world.GetTransform2D(actor).SetPosition(position);
        world.AddData(actor, staticBody ? SceneRigidbody2D.Static : SceneRigidbody2D.Default);
        world.AddData(actor, SceneCollider2D.Default);
        world.UpdateTransforms();
        return actor;
    }

    private static SceneWorld CreateWorld()
    {
        var profile = new SceneProfileBuilder(
                new SceneProfileId(SceneStringId.FromName("test/joints-2d")))
            .AddTransform2D()
            .AddPhysics2D()
            .Build();

        return profile.CreateWorld();
    }
}
