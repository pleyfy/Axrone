namespace Axrone.Physics3D.Tests;

using Axrone.Numeric;
using Xunit;

/// <summary>
/// Pins the tolerance pair the 3D sleep policy runs on to the constants
/// Axrone.Physics.Core publishes, and reports the values themselves. The 3D world
/// has no driven-kinematic test of its own — a continuously driven 3D platform is
/// carried by the solver, not seeded into a wake walk — so the invariant this
/// dimension can offer is that its quiet thresholds and the 2D dimension's are
/// the same two numbers from the same source. The 2D counterpart gate checks the
/// other side of that identity.
/// </summary>
public sealed class KinematicSleepToleranceSource3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Fact]
    public void BothDimensionsDefaultThePairFromTheSameCoreConstants()
    {
        Assert.True(
            _world.LinearSleepTolerance == PhysicsConstants.LinearSleepTolerance,
            $"the 3D world's linear sleep tolerance is {_world.LinearSleepTolerance:0.####} while Axrone.Physics.Core publishes {PhysicsConstants.LinearSleepTolerance:0.####}: the pair the 2D wake walk and this dimension's island policy each default to has drifted apart at the source, which is how the two dimensions start disagreeing about the same moving platform.");
        Assert.True(
            _world.AngularSleepTolerance == PhysicsConstants.AngularSleepTolerance,
            $"the 3D world's angular sleep tolerance is {_world.AngularSleepTolerance:0.####} while Axrone.Physics.Core publishes {PhysicsConstants.AngularSleepTolerance:0.####}.");
    }

    [Fact]
    public void ARiderCarriedAboveTheToleranceIsNeverQuietEnoughToSleep()
    {
        BodyId platform = _world.Bodies.Create(new BodyDef { Type = BodyType.Kinematic });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, platform, new Vec3(0.0f, -0.5f, 0.0f), new Vec3(8.0f, 0.5f, 8.0f));
        BodyId box = _world.Bodies.Create(new BodyDef { AllowSleep = true });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, box, Vec3.Zero, new Vec3(0.4f, 0.4f, 0.4f));
        _world.Bodies.SetTransform(box, new Vec3(0.0f, 0.4f, 0.0f), Quat.Identity);

        float speed = _world.LinearSleepTolerance * 2.0f;
        bool slept = false;
        for (int step = 1; step <= 240 && !slept; step++)
        {
            _world.Bodies.SetLinearVelocity(platform, new Vec3(speed, 0.0f, 0.0f));
            _world.Step(Dt);
            slept = !_world.Bodies.IsAwake(box);
        }

        Assert.True(
            !slept,
            $"a 3D rider carried at {speed:0.####} m/s, twice the linear sleep tolerance, fell asleep inside 240 steps: the island quiet test is not reading the pair Axrone.Physics.Core publishes, so the two dimensions no longer agree about which platforms are moving; awake={_world.Bodies.IsAwake(box)}, x={_world.Bodies.GetTransform(box).Position.X:0.####}.");
        Assert.True(
            _world.Bodies.GetTransform(box).Position.X > speed * 200.0f * Dt,
            $"the platform drove at {speed:0.####} m/s but the rider travelled only {_world.Bodies.GetTransform(box).Position.X:0.####} m; the carry itself, not just the wake state, is the reason 3D needs no driven-kinematic seed.");
    }
}
