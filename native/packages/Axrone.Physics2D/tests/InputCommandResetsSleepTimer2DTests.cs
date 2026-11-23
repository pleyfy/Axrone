namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Pins the 2D half of the input-versus-sleep-timer behaviour the 3D counterpart
/// gate pins, which is the case F-10 was about. 2D's input path raised the awake
/// flag but never restarted the sleep timer, while 2D's own
/// <c>SetAwake</c> did and 3D's motion path does; a body driven by a stream of
/// commands below <see cref="World.LinearSleepTolerance"/> therefore slept
/// mid-stream, and every command after that was written into a sleeping body the
/// integrator zeroes on the spot — measured as 1 of 8 command steps finding the
/// body awake and the position frozen at -0.000951 m forever. The motion path now
/// resets the timer, matching 3D, and the measured answer in both dimensions is:
/// asleep at 0 of 8 and 0 of 16 command steps, one quiet window (29 steps) after
/// the last command.
/// </summary>
public sealed class InputCommandResetsSleepTimer2DTests : IDisposable
{
    private const float Dt = 1f / 60f;
    private const float Half = 0.4f;
    private const int TailLimit = 200;
    private const int ExpectedLag = 29;

    private readonly World _world;

    public InputCommandResetsSleepTimer2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    [Theory]
    [InlineData(10, 8)]
    [InlineData(5, 16)]
    public void QuietCommandStreamKeepsTheBodySimulatedAndSleepsOneWindowAfterTheLastCommand(int every, int pokes)
    {
        Run(0.005f, every, pokes, out int asleepAtPokes, out int sleptAt, out int lag, out float travel);

        asleepAtPokes.Should().Be(
            0,
            $"driving a body at 0.005 m/s, below LinearSleepTolerance={_world.LinearSleepTolerance:0.####}, every {every} steps for {pokes} commands left it asleep at {asleepAtPokes} of those command steps (net travel {travel:0.######} m). Input that arrives after the body slept is zeroed by the sleep transition, so without the timer reset the caller stops being able to drive the body at all; 3D measures the same 0/{pokes}.");
        lag.Should().Be(
            ExpectedLag,
            $"the command stream ended at step {every * pokes} and the body slept at step {sleptAt}, a lag of {lag}; the expected lag is the quiet window alone ({ExpectedLag} steps), and the 3D counterpart gate measures the same {ExpectedLag} — that the two dimensions now agree is the whole point of this pair (asleepAtPokes={asleepAtPokes}, travel={travel:0.######})");
    }

    private void Run(float speed, int every, int pokes, out int asleepAtPokes, out int sleptAt, out int lag, out float travel)
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0.0f, -1.0f) });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec2[] { new(-40.0f, -1.0f), new(40.0f, -1.0f), new(40.0f, 1.0f), new(-40.0f, 1.0f) },
            material: new PhysicsMaterial(0.8f, 0.0f));
        BodyId box = _world.Bodies.Create(new BodyDef { Type = BodyType.Dynamic, Position = new Vec2(0.0f, Half), AllowSleep = true });
        _world.Shapes.AttachPolygon(
            _world.Bodies,
            _world.Broadphase,
            box,
            new Vec2[] { new(-Half, -Half), new(Half, -Half), new(Half, Half), new(-Half, Half) },
            material: new PhysicsMaterial(0.7f, 0.0f));

        int stream = every * pokes;
        asleepAtPokes = 0;
        sleptAt = -1;
        travel = 0.0f;
        for (int step = 1; step <= stream + TailLimit && (sleptAt < 0 || step <= stream); step++)
        {
            bool poked = step <= stream && step % every == 0;
            if (poked)
            {
                _world.Bodies.SetLinearVelocity(box, new Vec2(speed, 0.0f));
            }

            float before = _world.Bodies.GetTransform(box).Position.X;
            _world.Step(Dt);
            travel += _world.Bodies.GetTransform(box).Position.X - before;
            bool awake = _world.Bodies.IsAwake(box);
            if (poked && !awake)
            {
                asleepAtPokes++;
            }

            if (step > stream && sleptAt < 0 && !awake)
            {
                sleptAt = step;
            }
        }

        lag = sleptAt - stream;
    }
}
