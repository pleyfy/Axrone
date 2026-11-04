namespace Axrone.Physics.Core.Tests;

public sealed class PhysicsCoreContractTests
{
    [Fact]
    public void SolverFlags_Match_Web_Contract()
    {
        ((byte)SolverFlags.None).Should().Be(0);
        ((byte)SolverFlags.WarmStarting).Should().Be(1 << 0);
        ((byte)SolverFlags.ContinuousDetection).Should().Be(1 << 1);
        ((byte)SolverFlags.SubStepping).Should().Be(1 << 2);
        ((byte)SolverFlags.SleepingBodies).Should().Be(1 << 3);
        ((byte)SolverFlags.PositionCorrection).Should().Be(1 << 4);
        ((byte)SolverFlags.VelocityConstraints).Should().Be(1 << 5);
        SolverFlags.Default.Should().Be(
            SolverFlags.WarmStarting | SolverFlags.SleepingBodies | SolverFlags.PositionCorrection | SolverFlags.VelocityConstraints);
    }

    [Fact]
    public void BodyFlags_Match_Web_Contract()
    {
        ((byte)BodyFlags.None).Should().Be(0);
        ((byte)BodyFlags.FixedRotation).Should().Be(1 << 0);
        ((byte)BodyFlags.Bullet).Should().Be(1 << 1);
        ((byte)BodyFlags.Sensor).Should().Be(1 << 2);
        ((byte)BodyFlags.Sleeping).Should().Be(1 << 3);
        ((byte)BodyFlags.AutoSleep).Should().Be(1 << 4);
        ((byte)BodyFlags.Awake).Should().Be(1 << 5);
        ((byte)BodyFlags.Active).Should().Be(1 << 6);
        ((byte)BodyFlags.Island).Should().Be(1 << 7);
    }

    [Fact]
    public void CollisionCategories_Are_Valid_Bitmasks()
    {
        ((uint)CollisionCategory.None).Should().Be(0);
        ((uint)CollisionCategory.Default).Should().Be(1);
        ((uint)CollisionCategory.Static).Should().Be(2);
        ((uint)CollisionCategory.Dynamic).Should().Be(4);
        ((uint)CollisionCategory.Kinematic).Should().Be(8);
        ((uint)CollisionCategory.Trigger).Should().Be(16);
        ((uint)CollisionCategory.All).Should().Be(0xFFFF);
        ((uint)(CollisionCategory.Static | CollisionCategory.Dynamic | CollisionCategory.Kinematic | CollisionCategory.Trigger)).Should().Be(30);
    }

    [Fact]
    public void Constants_Match_Web_Reference()
    {
        PhysicsConstants.DefaultGravity2D.X.Should().Be(0.0f);
        PhysicsConstants.DefaultGravity2D.Y.Should().BeApproximately(-9.81f, 1e-6f);
        PhysicsConstants.DefaultGravity3D.Z.Should().Be(0.0f);
        PhysicsConstants.MaxVelocity.Should().Be(200.0f);
        PhysicsConstants.MaxAngularVelocity.Should().Be(250.0f);
        PhysicsConstants.LinearSlop.Should().Be(0.005f);
        PhysicsConstants.AngularSlop.Should().BeApproximately((2.0f / 180.0f) * MathF.PI, 1e-9f);
        PhysicsConstants.BaumgarteFactor.Should().Be(0.2f);
        PhysicsConstants.ToiBaumgarte.Should().Be(0.75f);
        PhysicsConstants.Epsilon.Should().Be(1e-6f);
        PhysicsConstants.MaxSubSteps.Should().Be(8);
        PhysicsConstants.MaxToiContacts.Should().Be(32);
        PhysicsConstants.VelocityThreshold.Should().Be(1.0f);
        PhysicsConstants.MaxLinearCorrection.Should().Be(0.2f);
        PhysicsConstants.MaxAngularCorrection.Should().BeApproximately((8.0f / 180.0f) * MathF.PI, 1e-9f);
        PhysicsConstants.SleepTime.Should().Be(0.5f);
        PhysicsConstants.LinearSleepTolerance.Should().Be(0.01f);
        PhysicsConstants.AngularSleepTolerance.Should().BeApproximately((2.0f / 180.0f) * MathF.PI, 1e-9f);
    }

    [Fact]
    public void Shape_And_Constraint_Types_Match_Web_Contract()
    {
        ((byte)ShapeType.Circle).Should().Be(0);
        ((byte)ShapeType.Capsule).Should().Be(1);
        ((byte)ShapeType.Polygon).Should().Be(2);
        ((byte)ShapeType.Box).Should().Be(3);
        ((byte)ShapeType.Segment).Should().Be(4);
        ((byte)ShapeType.Sphere).Should().Be(5);
        ((byte)ShapeType.Cylinder).Should().Be(6);
        ((byte)ShapeType.Cone).Should().Be(7);
        ((byte)ShapeType.ConvexHull).Should().Be(8);
        ((byte)ShapeType.TriangleMesh).Should().Be(9);
        ((byte)ShapeType.HeightField).Should().Be(10);

        ((byte)ConstraintType.Distance).Should().Be(0);
        ((byte)ConstraintType.Revolute).Should().Be(1);
        ((byte)ConstraintType.Prismatic).Should().Be(2);
        ((byte)ConstraintType.Weld).Should().Be(3);
        ((byte)ConstraintType.Wheel).Should().Be(4);
        ((byte)ConstraintType.Motor).Should().Be(5);
        ((byte)ConstraintType.Mouse).Should().Be(6);
        ((byte)ConstraintType.Gear).Should().Be(7);
        ((byte)ConstraintType.Rope).Should().Be(8);

        ((byte)ShapeType3D.Sphere).Should().Be(5);
        ((byte)ShapeType3D.Box).Should().Be(3);
        ((byte)ShapeType3D.Capsule).Should().Be(1);
        ((byte)ShapeType3D.Cylinder).Should().Be(6);
        ((byte)ShapeType3D.Cone).Should().Be(7);
        ((byte)ShapeType3D.ConvexHull).Should().Be(8);
        ((byte)ShapeType3D.TriangleMesh).Should().Be(9);
        ((byte)ShapeType3D.HeightField).Should().Be(10);

        ((byte)ConstraintType3D.Fixed).Should().Be(0);
        ((byte)ConstraintType3D.Spherical).Should().Be(1);
        ((byte)ConstraintType3D.Hinge).Should().Be(2);
        ((byte)ConstraintType3D.Slider).Should().Be(3);
        ((byte)ConstraintType3D.ConeTwist).Should().Be(4);
        ((byte)ConstraintType3D.Generic).Should().Be(5);
        ((byte)ConstraintType3D.Spring).Should().Be(6);
    }

    [Fact]
    public void Collision_And_Sensor_Events_Match_Web_Contract()
    {
        ((byte)CollisionEventType.Begin).Should().Be(0);
        ((byte)CollisionEventType.Stay).Should().Be(1);
        ((byte)CollisionEventType.End).Should().Be(2);
        ((byte)CollisionEventType.PreSolve).Should().Be(3);
        ((byte)CollisionEventType.PostSolve).Should().Be(4);

        ((byte)SensorEventType.Enter).Should().Be(0);
        ((byte)SensorEventType.Stay).Should().Be(1);
        ((byte)SensorEventType.Exit).Should().Be(2);

        ((byte)ToiState.Unknown).Should().Be(0);
        ((byte)ToiState.Failed).Should().Be(1);
        ((byte)ToiState.Overlapped).Should().Be(2);
        ((byte)ToiState.Touching).Should().Be(3);
        ((byte)ToiState.Separated).Should().Be(4);
    }

    [Fact]
    public void QueryFilter_MatchesCategoryMaskAndSharedGroup()
    {
        var shape = new CollisionFilter(4, 8, 0);

        QueryFilter.Matches(in shape, QueryFilter.None).Should().BeTrue();
        QueryFilter.Matches(in shape, new QueryFilter(8, 4, 0)).Should().BeTrue();
        QueryFilter.Matches(in shape, new QueryFilter(1, 4, 0)).Should().BeFalse();
        QueryFilter.Matches(in shape, new QueryFilter(1, 2, 0)).Should().BeFalse();
        QueryFilter.Matches(in shape, new QueryFilter(16, 16, 0)).Should().BeFalse();

        var grouped = new CollisionFilter(4, 8, 5);
        QueryFilter.Matches(in grouped, new QueryFilter(1, 8, 5)).Should().BeTrue();
        QueryFilter.Matches(in grouped, new QueryFilter(1, 8, 6)).Should().BeFalse();
        QueryFilter.Matches(in grouped, new QueryFilter(1, 4, 6)).Should().BeFalse();

        var negative = new CollisionFilter(4, 8, -5);
        QueryFilter.Matches(in negative, new QueryFilter(1, 8, -5)).Should().BeFalse();
        QueryFilter.Matches(in negative, new QueryFilter(1, 8, -6)).Should().BeFalse();
        QueryFilter.Matches(in negative, new QueryFilter(8, 4, 0)).Should().BeTrue();
    }

    [Fact]
    public void MaterialCombiner_PicksTheStricterSideRule()
    {
        // Friction takes the mode of the lower-friction side, restitution the
        // mode of the higher-restitution side.
        MaterialCombiner.CombineFriction(0.1f, 0.5f, CombineMode.Max, CombineMode.Min).Should().Be(0.5f);
        MaterialCombiner.CombineFriction(0.1f, 0.5f, CombineMode.Min, CombineMode.Max).Should().Be(0.1f);
        MaterialCombiner.CombineFriction(0.5f, 0.1f, CombineMode.Max, CombineMode.Min).Should().Be(0.1f);
        MaterialCombiner.CombineFriction(0.1f, 0.5f, CombineMode.Average, CombineMode.Average).Should().Be(0.3f);
        MaterialCombiner.CombineFriction(0.1f, 0.5f, CombineMode.Multiply, CombineMode.Multiply).Should().BeApproximately(0.05f, 1e-6f);

        MaterialCombiner.CombineRestitution(0.8f, 0.2f, CombineMode.Min, CombineMode.Max).Should().Be(0.2f);
        MaterialCombiner.CombineRestitution(0.2f, 0.8f, CombineMode.Max, CombineMode.Min).Should().Be(0.2f);
        MaterialCombiner.CombineRestitution(0.8f, 0.2f, CombineMode.Max, CombineMode.Max).Should().Be(0.8f);
        MaterialCombiner.CombineRestitution(0.8f, 0.2f, CombineMode.Multiply, CombineMode.Multiply).Should().BeApproximately(0.16f, 1e-6f);
    }
}
