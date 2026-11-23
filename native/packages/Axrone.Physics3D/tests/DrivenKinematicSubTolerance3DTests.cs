namespace Axrone.Physics3D.Tests;

using Axrone.Numeric;
using Xunit;

/// <summary>
/// Pins the 3D half of a measured behavioural difference between the dimensions,
/// so the difference is documented instead of silent. A cargo riding a
/// continuously driven kinematic platform at a speed below
/// <see cref="World.LinearSleepTolerance"/> goes quiet and sleeps in both
/// dimensions — the island policy agrees, and F-5's pair gate keeps it agreeing.
/// What differs is what happens next, and the reason is the walk's seed choice,
/// not the thresholds: 3D marks every kinematic frame the integrator advanced as
/// relocated, so the next drain re-scans the volume the platform swept and wakes
/// the cargo again one step after it slept; 2D only queues an immovable body that
/// a caller placed, and its driven-kinematic seed is gated by the sleep tolerance,
/// so below that tolerance nothing ever wakes the rider again. Measured at
/// v = 0.005 m/s over 900 steps: 3D sleeps at 30, re-wakes at 31, cargo travels
/// 0.0746 m while the platform travels 0.0750 m; 2D sleeps at 34, never re-wakes,
/// cargo travels 0.0029 m. Above the tolerance the two dimensions agree.
/// </summary>
public sealed class DrivenKinematicSubTolerance3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const int Horizon = 900;
    private const float BelowTolerance = 0.005f;
    private const float AboveTolerance = 0.05f;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Fact]
    public void SubToleranceDriveStillCarriesTheCargoByRewakingItOneStepAfterSleep()
    {
        Run(BelowTolerance, out int firstSleep, out int firstRewake, out float platformTravel, out float cargoTravel, out bool cargoAsleep);

        Assert.True(
            firstSleep > 0,
            $"precondition: at {BelowTolerance:0.####} m/s the cargo never went quiet within {Horizon} steps, so this is not the sub-tolerance case: platformTravel={platformTravel:0.####}, cargoTravel={cargoTravel:0.####}, asleep={cargoAsleep}.");
        Assert.True(
            firstRewake > firstSleep && firstRewake <= firstSleep + 2,
            $"3D is expected to re-wake a cargo it left asleep on a moving platform within two steps of it sleeping, because every kinematic frame the integrator advanced is marked relocated and the next drain sweeps the volume it moved through; measured firstSleep={firstSleep}, firstRewake={(firstRewake < 0 ? "never" : firstRewake.ToString())}, platformTravel={platformTravel:0.####}, cargoTravel={cargoTravel:0.####}.");
        Assert.True(
            cargoTravel > platformTravel * 0.9f,
            $"the cargo was carried only {(cargoTravel / platformTravel):P1} of the platform's {platformTravel:0.####} m at {BelowTolerance:0.####} m/s; below the sleep tolerance 3D still carries, and if this drops the 3D relocation sweep stopped reaching the cargo — the 2D counterpart gate expects the opposite outcome, so the pair of them is what pins the difference (firstSleep={firstSleep}, firstRewake={firstRewake}, cargoAsleep={cargoAsleep}).");
    }

    [Fact]
    public void AboveToleranceDriveCarriesTheCargoWithoutEverLettingItSleep()
    {
        Run(AboveTolerance, out int firstSleep, out int firstRewake, out float platformTravel, out float cargoTravel, out bool cargoAsleep);

        Assert.True(
            firstSleep < 0,
            $"at {AboveTolerance:0.####} m/s, above LinearSleepTolerance={_world.LinearSleepTolerance:0.####}, the cargo slept at step {firstSleep}: the island pass reads the pair that keeps a carried rider quiet, so a sleep here means the tolerance pair moved; firstRewake={firstRewake}, cargoTravel={cargoTravel:0.####}, platformTravel={platformTravel:0.####}.");
        Assert.True(
            cargoTravel > platformTravel * 0.95f,
            $"above the tolerance the cargo tracked only {(cargoTravel / platformTravel):P1} of the platform's {platformTravel:0.####} m; this is the case both dimensions agree on, and 2D measures {0.7501f:0.####} m against a {0.75f:0.####} m platform at the same speed (firstSleep={firstSleep}, cargoAsleep={cargoAsleep}).");
    }

    private void Run(float speed, out int firstSleep, out int firstRewake, out float platformTravel, out float cargoTravel, out bool cargoAsleep)
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, ground, new Vec3(0.0f, -0.5f, 0.0f), new Vec3(40.0f, 0.5f, 40.0f));

        BodyId platform = _world.Bodies.Create(new BodyDef { Type = BodyType.Kinematic });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, platform, new Vec3(0.0f, 0.5f, 0.0f), new Vec3(4.0f, 0.5f, 4.0f));
        _world.Bodies.SetTransform(platform, new Vec3(0.0f, 0.5f, 0.0f), Quat.Identity);

        BodyId cargo = _world.Bodies.Create(new BodyDef { AllowSleep = true });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, cargo, Vec3.Zero, new Vec3(Half, Half, Half));
        _world.Bodies.SetTransform(cargo, new Vec3(0.0f, 1.5f + Half, 0.0f), Quat.Identity);

        firstSleep = -1;
        firstRewake = -1;
        for (int step = 1; step <= Horizon; step++)
        {
            _world.Bodies.SetLinearVelocity(platform, new Vec3(speed, 0.0f, 0.0f));
            _world.Step(Dt);
            bool awake = _world.Bodies.IsAwake(cargo);
            if (firstSleep < 0 && !awake)
            {
                firstSleep = step;
            }

            if (firstSleep > 0 && firstRewake < 0 && awake)
            {
                firstRewake = step;
            }
        }

        platformTravel = _world.Bodies.GetTransform(platform).Position.X;
        cargoTravel = _world.Bodies.GetTransform(cargo).Position.X;
        cargoAsleep = !_world.Bodies.IsAwake(cargo);
    }
}
