namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Pins the 2D half of the same measured difference the 3D counterpart gate
/// pins: a cargo on a platform driven below <see cref="World.LinearSleepTolerance"/>
/// goes quiet, sleeps and is then never woken again, so the platform slides out
/// from under it. This is not the island policy disagreeing with the walk — F-5's
/// pair gate proves both 2D consumers read the same tolerance pair and reach the
/// same verdict at this speed. It is the seed choice: 2D queues an immovable body
/// only when a caller places it, and its driven-kinematic seed is tolerance-gated,
/// so nothing sweeps the platform's path for a sleeper. Measured over 900 steps at
/// v = 0.005 m/s: firstSleep=34, no re-wake, cargo travels 0.0029 m against a
/// 0.0750 m platform. At v = 0.05 m/s, above the tolerance, 2D and 3D agree.
/// </summary>
public sealed class DrivenKinematicSubTolerance2DTests : IDisposable
{
    private const float Dt = 1f / 60f;
    private const float Half = 0.4f;
    private const int Horizon = 900;
    private const float BelowTolerance = 0.005f;
    private const float AboveTolerance = 0.05f;

    private readonly World _world;

    public DrivenKinematicSubTolerance2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Fact]
    public void SubToleranceDriveLetsTheCargoSleepAndLeavesItBehind()
    {
        Run(BelowTolerance, out int firstSleep, out int firstRewake, out float platformTravel, out float cargoTravel, out bool cargoAsleep);

        firstSleep.Should().BeGreaterThan(
            0,
            $"precondition: at {BelowTolerance:0.####} m/s the cargo never went quiet within {Horizon} steps, so this is not the sub-tolerance case; platformTravel={platformTravel:0.####}, cargoTravel={cargoTravel:0.####}");
        firstRewake.Should().Be(
            -1,
            $"2D is expected NOT to re-wake a cargo it left asleep on a platform still moving at {BelowTolerance:0.####} m/s: below the linear sleep tolerance the walk refuses to call the platform a driver, and 2D never queues an integrated kinematic as relocated, so nothing sweeps the platform's path for a sleeper. firstSleep={firstSleep}, cargoTravel={cargoTravel:0.####} of platformTravel={platformTravel:0.####}, cargoAsleep={cargoAsleep}. If a 2D path starts re-waking it, this gate and the 3D counterpart have to be re-decided together — the pair is the documentation.");
        cargoTravel.Should().BeLessThan(
            platformTravel * 0.1f,
            $"the platform travelled {platformTravel:0.####} m while its sleeping cargo moved {cargoTravel:0.####} m; below the tolerance 2D abandons the load, which is the behaviour the 3D gate expects the opposite of (firstSleep={firstSleep}, firstRewake={firstRewake}, cargoAsleep={cargoAsleep})");
    }

    [Fact]
    public void AboveToleranceDriveCarriesTheCargoWithoutEverLettingItSleep()
    {
        Run(AboveTolerance, out int firstSleep, out int firstRewake, out float platformTravel, out float cargoTravel, out bool cargoAsleep);

        firstSleep.Should().BeNegative(
            $"at {AboveTolerance:0.####} m/s, above LinearSleepTolerance={_world.LinearSleepTolerance:0.####}, the cargo slept at step {firstSleep}: above the tolerance both dimensions carry without a sleep, and this is the case the two dimensions agree on; firstRewake={firstRewake}, cargoTravel={cargoTravel:0.####}, platformTravel={platformTravel:0.####}");
        cargoTravel.Should().BeGreaterThan(
            platformTravel * 0.95f,
            $"above the tolerance the cargo tracked only {(cargoTravel / platformTravel):P1} of the platform's {platformTravel:0.####} m; 3D measures 0.7484 m against the same 0.75 m platform, so a shortfall here is a 2D-only regression (firstSleep={firstSleep}, cargoAsleep={cargoAsleep})");
    }

    private void Run(float speed, out int firstSleep, out int firstRewake, out float platformTravel, out float cargoTravel, out bool cargoAsleep)
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0.0f, -1.0f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec2[] { new(-40.0f, -1.0f), new(40.0f, -1.0f), new(40.0f, 1.0f), new(-40.0f, 1.0f) },
            material: new PhysicsMaterial(0.8f, 0.0f));

        BodyId platform = _world.Bodies.Create(new BodyDef { Type = BodyType.Kinematic, Position = new Vec2(0.0f, 0.5f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            platform,
            new Vec2[] { new(-4.0f, -0.5f), new(4.0f, -0.5f), new(4.0f, 0.5f), new(-4.0f, 0.5f) },
            material: new PhysicsMaterial(0.9f, 0.0f));

        BodyId cargo = _world.Bodies.Create(new BodyDef { Type = BodyType.Dynamic, Position = new Vec2(0.0f, 1.0f + Half), AllowSleep = true });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            cargo,
            new Vec2[] { new(-Half, -Half), new(Half, -Half), new(Half, Half), new(-Half, Half) },
            material: new PhysicsMaterial(0.9f, 0.0f));

        firstSleep = -1;
        firstRewake = -1;
        for (int step = 1; step <= Horizon; step++)
        {
            _world.Bodies.SetLinearVelocity(platform, new Vec2(speed, 0.0f));
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
