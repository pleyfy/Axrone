namespace Axrone.Physics2D.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Gates the solver's degenerate-row handling. A sleeping contact over scenery
/// has no movable surface at all, so every effective-mass reciprocal in the
/// velocity and position passes divides by zero, and every impulse write is
/// gated on a flag that statics satisfy. Both halves are asserted here, next to
/// the awake-pair and moving-scenery controls that prove the guards did not
/// simply switch the solver off.
/// </summary>
public sealed class SleepingContact2DTests : IDisposable
{
    private const float Dt = 1f / 60f;
    private const float BoxHalf = 0.5f;
    private const float LinearSlop = 0.005f;

    /// <summary>Analytic resting centre of a box of <see cref="BoxHalf"/> on the ground top (y = 0).</summary>
    private const float AnalyticRestY = BoxHalf - LinearSlop;

    private readonly World _world;

    public SleepingContact2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private BodyId AddBox(
        Vec2 center,
        Vec2 halfExtents,
        BodyType type = BodyType.Dynamic,
        float friction = 0.7f,
        bool allowSleep = true,
        Vec2 velocity = default)
    {
        BodyId body = _world.Bodies.Create(new BodyDef
        {
            Type = type,
            Position = center,
            AllowSleep = allowSleep,
            LinearVelocity = velocity,
        });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            body,
            new Vec2[]
            {
                new(-halfExtents.X, -halfExtents.Y),
                new(halfExtents.X, -halfExtents.Y),
                new(halfExtents.X, halfExtents.Y),
                new(-halfExtents.X, halfExtents.Y),
            },
            material: new PhysicsMaterial(friction, 0.0f));
        return body;
    }

    private BodyId AddGround() => AddBox(new Vec2(0.0f, -1.0f), new Vec2(10.0f, 1.0f), BodyType.Static, friction: 0.8f);

    /// <summary>
    /// The firewall half, isolated from the reciprocal half. Caller-supplied
    /// tuning can put a non-finite coefficient straight into the manifold, so
    /// the solver will see a NaN impulse that no reciprocal guard produced. The
    /// contract under test is the blast radius: garbage may cost the dynamic
    /// side its step, it may never be written through scenery, whose inverse
    /// mass is zero and which therefore satisfies any awake flag.
    /// </summary>
    [Fact]
    public void CallerGarbageInTuning_ReachesThePairButNeverTheScenery()
    {
        BodyId ground = AddGround();
        AddBox(new Vec2(0.0f, 0.4f), new Vec2(BoxHalf, BoxHalf), allowSleep: false);

        Vec2 spawn = _world.Bodies.GetTransform(ground).Position;
        var handler = new TuningPoisoner { State = default };
        for (int step = 0; step < 60; step++)
        {
            _world.Step(Dt, handler, ref handler.State);
        }

        Vec2 velocity = _world.Bodies.GetLinearVelocity(ground);
        float spin = _world.Bodies.GetAngularVelocity(ground);
        Vec2 position = _world.Bodies.GetTransform(ground).Position;

        IsFinite(velocity.X).Should().BeTrue($"a garbage tuning coefficient drove a NaN tangent impulse into this pair on every step; the ground still measured velocity.x {velocity.X:R}");
        IsFinite(velocity.Y).Should().BeTrue($"a garbage tuning coefficient drove a NaN tangent impulse into this pair on every step; the ground still measured velocity.y {velocity.Y:R}");
        IsFinite(spin).Should().BeTrue($"a NaN impulse applied through the ground's zero inverse mass is NaN * 0, which must never be written; measured angular {spin:R}");
        position.Should().Be(spawn, $"scenery was authored at {spawn} and must stay there under a poisoned manifold; measured {position}");
    }

    /// <summary>Rewrites every pair's tangent speed into NaN, on purpose.</summary>
    private struct TuningPoisoner : IContactSolverCallbacks<Contact, ContactManifold, PoisonContext>
    {
        public PoisonContext State;

        public static void OnPreSolve(ref Contact contact, ref ContactManifold manifold, ref ContactTuning tuning, ref PoisonContext context) =>
            tuning.TangentSpeed = float.NaN;

        public static void OnPostSolve(ref readonly Contact contact, in ContactManifold manifold, in ContactImpulses impulses, ref PoisonContext context)
        {
        }
    }

    private static float AngleRadians(World world, BodyId body)
    {
        Transform2D frame = world.Bodies.GetTransform(body);
        return MathF.Atan2(frame.Sin, frame.Cos);
    }

    private static bool IsFinite(float value) => !float.IsNaN(value) && !float.IsInfinity(value);

    private static bool PairFinite(World world, out string detail)
    {
        detail = string.Empty;
        for (int c = 0; c < world.ContactCount; c++)
        {
            ContactManifold manifold = world.GetContact(c).Manifold;
            for (int p = 0; p < manifold.Count; p++)
            {
                ContactPoint point = manifold.GetPointRO(p);
                if (!IsFinite(point.NormalImpulse) || !IsFinite(point.TangentImpulse))
                {
                    detail = $"contact {c} point {p}: Jn {point.NormalImpulse:R}, Jt {point.TangentImpulse:R}";
                    return false;
                }
            }
        }

        return true;
    }

    /// <summary>
    /// The register's UNVERIFIED-3 scenario, run to the letter: one box with
    /// AllowSleep true settling on a static, then the static's linear and
    /// angular velocity read back every step. Base build: the box sleeps at step
    /// 29 and at step 30 the ground carries velocity (NaN,NaN), angular NaN and,
    /// uniquely to 2D, a NaN transform as well; a box dropped afterwards ends at
    /// position (NaN,NaN).
    /// </summary>
    [Fact]
    public void SleepingBox_LeavesStaticSceneryUntouched_AndLaterBodiesStillSettle()
    {
        BodyId ground = AddGround();
        BodyId box = AddBox(new Vec2(0.0f, 0.4f), new Vec2(BoxHalf, BoxHalf));
        Vec2 spawn = _world.Bodies.GetTransform(ground).Position;

        int sleepStep = -1;
        int firstCorruption = -1;
        string corruption = "none";

        for (int step = 0; step < 200; step++)
        {
            _world.Step(Dt);

            Vec2 groundVelocity = _world.Bodies.GetLinearVelocity(ground);
            float groundSpin = _world.Bodies.GetAngularVelocity(ground);
            Vec2 groundPosition = _world.Bodies.GetTransform(ground).Position;
            float groundAngle = AngleRadians(_world, box);

            bool clean = IsFinite(groundVelocity.X) && IsFinite(groundVelocity.Y)
                && IsFinite(groundSpin)
                && IsFinite(groundPosition.X) && IsFinite(groundPosition.Y)
                && IsFinite(groundAngle)
                && PairFinite(_world, out _);
            if (!clean)
            {
                firstCorruption = step;
                corruption = $"ground velocity ({groundVelocity.X:R},{groundVelocity.Y:R}), ground angular {groundSpin:R}, ground transform ({groundPosition.X:R},{groundPosition.Y:R})";
                break;
            }

            if (sleepStep < 0 && !_world.Bodies.IsAwake(box))
            {
                sleepStep = step;
            }
        }

        firstCorruption.Should().Be(-1,
            $"the box went quiet at step {sleepStep}, and from step {sleepStep + 1} the only movable side of that contact is asleep. Measured corruption: {corruption}");

        Vec2 still = _world.Bodies.GetLinearVelocity(ground);
        still.X.Should().Be(0.0f, $"the ground is immovable; measured {still.X:R} after {200} steps with a sleeper on it");
        still.Y.Should().Be(0.0f, $"the ground is immovable; measured {still.Y:R} after 200 steps with a sleeper on it");
        _world.Bodies.GetAngularVelocity(ground).Should().Be(0.0f,
            $"a static body must gain no couple from a degenerate resting pair; measured {_world.Bodies.GetAngularVelocity(ground):R}");
        _world.Bodies.GetTransform(ground).Position.Should().Be(spawn,
            $"the ground transform is authored at ({spawn.X:R},{spawn.Y:R}) and must never be written; measured {_world.Bodies.GetTransform(ground).Position}");

        BodyId later = AddBox(new Vec2(3.0f, 4.0f), new Vec2(BoxHalf, BoxHalf));
        for (int step = 0; step < 120; step++)
        {
            _world.Step(Dt);
        }

        Vec2 latePosition = _world.Bodies.GetTransform(later).Position;
        (IsFinite(latePosition.X) && IsFinite(latePosition.Y)).Should().BeTrue(
            $"a body dropped onto previously-slept-on scenery must settle, not be poisoned by it; measured ({latePosition.X:R},{latePosition.Y:R})");
        latePosition.Y.Should().BeApproximately(AnalyticRestY, 0.02f,
            $"the later box rests at half {BoxHalf} minus the linear slop {LinearSlop} = {AnalyticRestY:R}; measured {latePosition.Y:R}");
        latePosition.X.Should().BeApproximately(3.0f, 0.05f,
            $"the later box was dropped at x = 3 and must stay on its axis; measured {latePosition.X:R}");

        Vec2 sleeperPosition = _world.Bodies.GetTransform(box).Position;
        sleeperPosition.Y.Should().BeApproximately(AnalyticRestY, 0.02f,
            $"the sleeping box was already at rest height {AnalyticRestY:R}; measured {sleeperPosition.Y:R}");
        _world.Bodies.IsAwake(box).Should().BeFalse("nothing moved the scenery, so the sleeper must still be quiet");
    }

    /// <summary>
    /// The same corruption seen from the impulses: on the base build the first
    /// step after sleep carries Jn = NaN and Jt = NaN on both points of the
    /// resting pair.
    /// </summary>
    [Fact]
    public void SleepingPair_KeepsEveryContactImpulseFinite()
    {
        AddGround();
        BodyId box = AddBox(new Vec2(0.0f, 0.4f), new Vec2(BoxHalf, BoxHalf));

        int sleepStep = -1;
        int firstNonFinite = -1;
        string detail = "none";

        for (int step = 0; step < 160; step++)
        {
            _world.Step(Dt);
            if (sleepStep < 0 && !_world.Bodies.IsAwake(box))
            {
                sleepStep = step;
            }

            if (firstNonFinite < 0 && !PairFinite(_world, out string offender))
            {
                firstNonFinite = step;
                detail = offender;
            }
        }

        firstNonFinite.Should().Be(-1,
            $"the pair went quiet at step {sleepStep} and every later step solves it against a sleeping side; measured {detail}");
    }

    /// <summary>
    /// Negative control for the reciprocal guards: a contact whose bodies can
    /// actually move must still get a real effective mass, otherwise a guarded
    /// division is just a silent way of switching friction off.
    /// </summary>
    [Fact]
    public void AwakePair_StillGetsRealFrictionImpulses()
    {
        AddGround();
        BodyId slider = AddBox(
            new Vec2(0.0f, AnalyticRestY),
            new Vec2(BoxHalf, BoxHalf),
            friction: 0.8f,
            allowSleep: false,
            velocity: new Vec2(3.0f, 0.0f));

        float startSpeed = _world.Bodies.GetLinearVelocity(slider).X;
        float peakNormal = 0.0f;
        float peakTangent = 0.0f;
        for (int step = 0; step < 90; step++)
        {
            _world.Step(Dt);
            for (int c = 0; c < _world.ContactCount; c++)
            {
                ContactManifold manifold = _world.GetContact(c).Manifold;
                for (int p = 0; p < manifold.Count; p++)
                {
                    ContactPoint point = manifold.GetPointRO(p);
                    peakNormal = Math.Max(peakNormal, point.NormalImpulse);
                    peakTangent = Math.Max(peakTangent, Math.Abs(point.TangentImpulse));
                }
            }
        }

        float endSpeed = _world.Bodies.GetLinearVelocity(slider).X;
        peakNormal.Should().BeGreaterThan(0.0f,
            $"the support must still carry load through the guarded normal mass; measured peak Jn {peakNormal:R} N.s over 90 steps");
        peakTangent.Should().BeGreaterThan(0.0f,
            $"a sliding box must accumulate a tangential impulse through the guarded tangent mass; measured peak Jt {peakTangent:R} N.s");
        endSpeed.Should().BeLessThan(startSpeed,
            $"friction must brake the slide from {startSpeed:R} m/s; measured {endSpeed:R} m/s after 90 steps");
        Math.Abs(endSpeed).Should().BeLessThan(1.5f,
            $"the brake must be substantial, not nominal; measured {endSpeed:R} m/s remaining of the original {startSpeed:R} m/s");
    }

    /// <summary>
    /// Negative control for the type firewall: it may stop a degenerate row
    /// writing through scenery, it may not stop scenery from carrying load. A
    /// box riding a driven kinematic platform must be supported and dragged while
    /// the platform keeps its authored frame and velocity.
    /// </summary>
    [Fact]
    public void KinematicPlatform_IsNeverWrittenTo_ButStillCarriesTheBox()
    {
        BodyId platform = AddBox(
            new Vec2(0.0f, -0.5f),
            new Vec2(4.0f, 0.5f),
            BodyType.Kinematic,
            friction: 0.9f,
            velocity: new Vec2(1.0f, 0.0f));
        BodyId box = AddBox(new Vec2(0.0f, 0.6f), new Vec2(BoxHalf, BoxHalf), friction: 0.9f, allowSleep: false);

        Vec2 authoredVelocity = _world.Bodies.GetLinearVelocity(platform);
        float authoredY = _world.Bodies.GetTransform(platform).Position.Y;

        for (int step = 0; step < 120; step++)
        {
            _world.Step(Dt);
        }

        Vec2 platformPosition = _world.Bodies.GetTransform(platform).Position;
        platformPosition.X.Should().BeApproximately(authoredVelocity.X * 120 * Dt, 1e-4f,
            $"a kinematic platform integrates exactly its authored {authoredVelocity.X:R} m/s and nothing else; measured x {platformPosition.X:R}");
        platformPosition.Y.Should().BeApproximately(authoredY, 1e-6f,
            $"the platform was authored at y = {authoredY:R} and no contact may push it; measured y {platformPosition.Y:R}");
        _world.Bodies.GetLinearVelocity(platform).Should().Be(authoredVelocity,
            $"a kinematic body keeps its authored velocity exactly; measured {_world.Bodies.GetLinearVelocity(platform)} against {authoredVelocity}");

        Vec2 boxPosition = _world.Bodies.GetTransform(box).Position;
        boxPosition.Y.Should().BeGreaterThan(0.0f,
            $"the box must be supported by the platform top at y = 0, not sink through it; measured box y {boxPosition.Y:R}");
        boxPosition.X.Should().BeGreaterThan(0.5f,
            $"the platform drags the box by friction; measured box x {boxPosition.X:R} after 120 steps at {authoredVelocity.X:R} m/s");
    }

    /// <summary>
    /// The sleeping half of the carry claim the gate above could not make,
    /// because that gate authored its box with <c>allowSleep: false</c>: a box
    /// that has come to rest on a platform the platform is still driving must be
    /// picked up, carried, and put back to sleep on the platform once the drive
    /// stops.
    /// </summary>
    [Fact]
    public void SleepingBox_RidesAContinuouslyDrivenPlatform_AndReSleepsOnceItStops()
    {
        const float Drive = 0.6f;
        BodyId platform = AddBox(
            new Vec2(0.0f, -0.5f),
            new Vec2(4.0f, 0.5f),
            BodyType.Kinematic,
            friction: 0.9f);
        BodyId box = AddBox(new Vec2(0.0f, BoxHalf), new Vec2(BoxHalf, BoxHalf), friction: 0.9f);

        int sleepStep = -1;
        for (int step = 1; step <= 120 && sleepStep < 0; step++)
        {
            _world.Step(Dt);
            if (!_world.Bodies.IsAwake(box))
            {
                sleepStep = step;
            }
        }

        sleepStep.Should().BeGreaterThan(0,
            $"precondition: the box never came to rest on the parked platform; awake={_world.Bodies.IsAwake(box)} y={_world.Bodies.GetTransform(box).Position.Y:R}");
        Vec2 carried = _world.Bodies.GetTransform(box).Position;

        int wakeStep = -1;
        for (int step = 1; step <= 60; step++)
        {
            _world.Bodies.SetLinearVelocity(platform, new Vec2(Drive, 0.0f));
            _world.Step(Dt);
            if (wakeStep < 0 && _world.Bodies.IsAwake(box))
            {
                wakeStep = step;
            }
        }

        Vec2 rideEnd = _world.Bodies.GetTransform(box).Position;
        wakeStep.Should().BeInRange(1, 3,
            $"a sleeper resting on a platform that starts moving must be picked up by it, not left where it was; sleepStep={sleepStep}, box y {carried.Y:R}");
        (rideEnd.X - carried.X).Should().BeGreaterThan(Drive * 60 * Dt * 0.5f,
            $"the platform travelled {Drive * 60 * Dt:R} m while the box had been asleep on it; the box only moved {(rideEnd.X - carried.X):R} m; wakeStep={wakeStep}");
        rideEnd.Y.Should().BeGreaterThan(0.0f,
            $"the carried box must stay on top of the platform, whose surface is y = 0; measured y {rideEnd.Y:R}");
        _world.Bodies.GetLinearVelocity(platform).Should().Be(new Vec2(Drive, 0.0f),
            "the drive is authored, and waking the rider may not spend any of it");

        _world.Bodies.SetLinearVelocity(platform, Vec2.Zero);
        int resleepStep = -1;
        for (int step = 1; step <= 200; step++)
        {
            _world.Step(Dt);
            if (resleepStep < 0 && !_world.Bodies.IsAwake(box))
            {
                resleepStep = step;
            }
        }

        resleepStep.Should().BeGreaterThan(0,
            $"once the platform stops the rider must be allowed back to rest; awake={_world.Bodies.IsAwake(box)} box=({rideEnd.X:R},{rideEnd.Y:R})");
        _world.Bodies.GetTransform(box).Position.Y.Should().BeGreaterThan(0.0f,
            "the re-slept box must still be on the platform");
    }

    /// <summary>
    /// The other direction of the same claim: a sleeping stack whose only support
    /// is a kinematic platform backing away must be woken to fall with it, exactly
    /// like the static case, or it hangs in the air over an empty gap.
    /// </summary>
    [Fact]
    public void SleepingStack_RetractingKinematicSupport_WakesTheWholeStack()
    {
        BodyId platform = AddBox(
            new Vec2(0.0f, -1.0f),
            new Vec2(2.0f, 1.0f),
            BodyType.Kinematic,
            friction: 0.9f);
        BodyId[] boxes =
        [
            AddBox(new Vec2(0.0f, BoxHalf), new Vec2(BoxHalf, BoxHalf), friction: 0.7f),
            AddBox(new Vec2(0.0f, (3.0f * BoxHalf)), new Vec2(BoxHalf, BoxHalf), friction: 0.7f),
            AddBox(new Vec2(0.0f, (5.0f * BoxHalf)), new Vec2(BoxHalf, BoxHalf), friction: 0.7f),
        ];

        int sleepStep = -1;
        for (int step = 1; step <= 200 && sleepStep < 0; step++)
        {
            _world.Step(Dt);
            if (boxes.All(id => !_world.Bodies.IsAwake(id)))
            {
                sleepStep = step;
            }
        }

        sleepStep.Should().BeGreaterThan(0,
            $"precondition: the stack on the platform never slept; awake=[{string.Join(" ", boxes.Select(id => _world.Bodies.IsAwake(id) ? "A" : "S"))}]");

        _world.Bodies.SetLinearVelocity(platform, new Vec2(0.0f, -1.2f));
        int[] wake = [-1, -1, -1];
        for (int step = 1; step <= 60; step++)
        {
            _world.Step(Dt);
            for (int i = 0; i < boxes.Length; i++)
            {
                if (wake[i] < 0 && _world.Bodies.IsAwake(boxes[i]))
                {
                    wake[i] = step;
                }
            }
        }

        float dropped = boxes.Select(id => _world.Bodies.GetTransform(id).Position.Y).Min();
        wake.Should().OnlyContain(step => step >= 1 && step <= 3,
            $"a platform backing out from under a sleeping stack must wake all of it; sleepStep={sleepStep}, lowest y {dropped:R}");
        dropped.Should().BeLessThan(BoxHalf - 0.3f,
            $"the stack had nothing left under it and must have descended; lowest y measured {dropped:R}, sleepStep={sleepStep}");
    }

    /// <summary>
    /// The other side of the same rule: a platform that is awake and simply
    /// waiting is not driving. Reading the drive test off rather than onto the
    /// motion would let every parked kinematic in the level stir the piles
    /// resting on it every single frame, and the island pass already refuses to
    /// block sleep for scenery that is not moving.
    /// </summary>
    [Fact]
    public void ParkedAwakePlatform_DoesNotStirTheBoxSleepingOnIt()
    {
        BodyId platform = AddBox(
            new Vec2(0.0f, -0.5f),
            new Vec2(4.0f, 0.5f),
            BodyType.Kinematic,
            friction: 0.9f);
        BodyId box = AddBox(new Vec2(0.0f, BoxHalf), new Vec2(BoxHalf, BoxHalf), friction: 0.9f);

        int sleepStep = -1;
        for (int step = 1; step <= 120 && sleepStep < 0; step++)
        {
            _world.Step(Dt);
            if (!_world.Bodies.IsAwake(box))
            {
                sleepStep = step;
            }
        }

        sleepStep.Should().BeGreaterThan(0,
            $"precondition: the box must fall asleep on the parked platform; awake={_world.Bodies.IsAwake(box)}");
        _world.Bodies.IsAwake(platform).Should().BeTrue("the platform is awake; only its motion may reach the rider");

        Vec2 rested = _world.Bodies.GetTransform(box).Position;
        for (int step = 1; step <= 240; step++)
        {
            _world.Step(Dt);
            _world.Bodies.IsAwake(box).Should().BeFalse(
                $"a waiting platform woke its rider at step {step}; the drive test is the velocity, not the body type; sleepStep={sleepStep}");
        }

        _world.Bodies.GetTransform(box).Position.Should().Be(rested,
            $"a sleeper that was never woken may not drift either; sleepStep={sleepStep}");
    }

    /// <summary>
    /// The sleep policy must survive the guards: a body that may not sleep stays
    /// awake, its neighbour on the same support still sleeps, and the support
    /// itself stays exactly at zero.
    /// </summary>
    [Fact]
    public void RestlessNeighbour_NeverSleeps_AndTheSharedGroundStaysClean()
    {
        BodyId ground = AddGround();
        BodyId restless = AddBox(new Vec2(0.0f, 0.4f), new Vec2(BoxHalf, BoxHalf), allowSleep: false);
        BodyId sleeper = AddBox(new Vec2(1.6f, 0.4f), new Vec2(BoxHalf, BoxHalf));

        int? sleeperSleepStep = null;
        int corruptStep = -1;
        for (int step = 0; step < 300; step++)
        {
            _world.Step(Dt);
            if (sleeperSleepStep is null && !_world.Bodies.IsAwake(sleeper))
            {
                sleeperSleepStep = step;
            }

            Vec2 velocity = _world.Bodies.GetLinearVelocity(ground);
            if (corruptStep < 0 && (!IsFinite(velocity.X) || !IsFinite(velocity.Y)))
            {
                corruptStep = step;
            }
        }

        corruptStep.Should().Be(-1, $"the ground was poisoned at step {corruptStep} while a restless neighbour and a sleeper shared it");
        _world.Bodies.IsAwake(restless).Should().BeTrue(
            "AllowSleep = false must still pin that body awake; measured awake = " + _world.Bodies.IsAwake(restless) + " after 300 steps");
        sleeperSleepStep.Should().NotBeNull(
            $"the other body shares the same support and must still be allowed to sleep; measured sleep step {sleeperSleepStep?.ToString() ?? "never"}");
        _world.Bodies.GetLinearVelocity(ground).Should().Be(Vec2.Zero,
            $"the restless neighbour pins its own body, not the scenery; measured ground velocity {_world.Bodies.GetLinearVelocity(ground)}");
    }

    /// <summary>
    /// Two sleepers on one support, left alone for 400 steps: the support's
    /// worst measured velocity over the whole run has to be exactly zero, not
    /// merely small.
    /// </summary>
    [Fact]
    public void TwoSleepers_OnOneSupport_LeaveItExactlyAtZeroForever()
    {
        BodyId ground = AddGround();
        BodyId left = AddBox(new Vec2(0.0f, 0.4f), new Vec2(BoxHalf, BoxHalf));
        BodyId right = AddBox(new Vec2(1.6f, 0.4f), new Vec2(BoxHalf, BoxHalf));

        int leftSleep = -1;
        int rightSleep = -1;
        float worstSpeedSq = 0.0f;
        float worstSpin = 0.0f;
        Vec2 worstVelocity = Vec2.Zero;

        for (int step = 0; step < 400; step++)
        {
            _world.Step(Dt);
            if (leftSleep < 0 && !_world.Bodies.IsAwake(left))
            {
                leftSleep = step;
            }

            if (rightSleep < 0 && !_world.Bodies.IsAwake(right))
            {
                rightSleep = step;
            }

            Vec2 velocity = _world.Bodies.GetLinearVelocity(ground);
            float spin = _world.Bodies.GetAngularVelocity(ground);
            if (!IsFinite(velocity.X) || !IsFinite(velocity.Y) || !IsFinite(spin))
            {
                worstVelocity = velocity;
                worstSpeedSq = float.PositiveInfinity;
                worstSpin = spin;
                break;
            }

            float speedSq = (velocity.X * velocity.X) + (velocity.Y * velocity.Y);
            if (speedSq > worstSpeedSq)
            {
                worstSpeedSq = speedSq;
                worstVelocity = velocity;
            }

            worstSpin = Math.Max(worstSpin, Math.Abs(spin));
        }

        leftSleep.Should().BeGreaterThan(0, $"this row only means something if the boxes actually sleep; measured left sleep step {leftSleep}, right {rightSleep}");
        rightSleep.Should().BeGreaterThan(0, $"this row only means something if the boxes actually sleep; measured left sleep step {leftSleep}, right {rightSleep}");
        worstVelocity.X.Should().Be(0.0f,
            $"the ground's worst measured linear velocity over 400 steps with two sleepers on it was ({worstVelocity.X:R},{worstVelocity.Y:R})");
        worstVelocity.Y.Should().Be(0.0f,
            $"the ground's worst measured linear velocity over 400 steps with two sleepers on it was ({worstVelocity.X:R},{worstVelocity.Y:R})");
        worstSpin.Should().Be(0.0f, $"the ground's worst measured angular velocity over 400 steps was {worstSpin:R}");
    }
}

/// <summary>Empty caller state for the tuning poisoner.</summary>
internal struct PoisonContext;
