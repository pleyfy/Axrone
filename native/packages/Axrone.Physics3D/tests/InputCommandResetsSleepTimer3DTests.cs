namespace Axrone.Physics3D.Tests;

using Axrone.Numeric;
using Xunit;

/// <summary>
/// Pins what a stream of quiet input commands does to the sleep timer. A command
/// below <see cref="World.LinearSleepTolerance"/> leaves the body quiet, so the
/// question is not whether it sleeps but when: the motion path restarts the timer
/// with every command, so the body stays simulated for as long as the caller keeps
/// driving it and sleeps one quiet window after the last command. If the timer is
/// not restarted, the body sleeps mid-stream and every command after that is
/// answered by a sleeping body — the integrator zeroes it and the caller's input
/// stops having any effect at all. Measured at v = 0.005 m/s: asleep at 0 of 8 and
/// 0 of 16 poke steps, asleep 29 steps after the last command, in both dimensions.
/// </summary>
public sealed class InputCommandResetsSleepTimer3DTests : IDisposable
{
    private const float Dt = 1.0f / 60.0f;
    private const float Half = 0.4f;
    private const int TailLimit = 200;
    private const int ExpectedLag = 29;

    private readonly World _world = new();

    public void Dispose() => _world.Dispose();

    [Theory]
    [InlineData(10, 8)]
    [InlineData(5, 16)]
    public void QuietCommandStreamKeepsTheBodySimulatedAndSleepsOneWindowAfterTheLastCommand(int every, int pokes)
    {
        Run(0.005f, every, pokes, out int asleepAtPokes, out int sleptAt, out int lag);

        Assert.True(
            asleepAtPokes == 0,
            $"driving a body at 0.005 m/s, below LinearSleepTolerance={_world.LinearSleepTolerance:0.####}, every {every} steps for {pokes} commands left it asleep at {asleepAtPokes} of those command steps: each command has to restart the sleep timer, or the body sleeps mid-stream and every command after that is written into a sleeping body that the integrator immediately zeroes. A caller cannot drive a body that has quietly stopped being simulated.");
        Assert.True(
            lag == ExpectedLag,
            $"with the command stream ending at step {every * pokes}, the body slept at step {sleptAt} (lag {lag}, expected {ExpectedLag}): the lag is the quiet window the sleep policy asks for and nothing else, and the 2D counterpart measures the same {ExpectedLag} steps (sleptAt={sleptAt}, asleepAtPokes={asleepAtPokes}).");
    }

    private void Run(float speed, int every, int pokes, out int asleepAtPokes, out int sleptAt, out int lag)
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(
            _world.Bodies,
            _world.Broadphase,
            ground,
            new Vec3(0.0f, -0.5f, 0.0f),
            new Vec3(40.0f, 0.5f, 40.0f));
        BodyId box = _world.Bodies.Create(new BodyDef { AllowSleep = true });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, box, Vec3.Zero, new Vec3(Half, Half, Half));
        _world.Bodies.SetTransform(box, new Vec3(0.0f, Half, 0.0f), Quat.Identity);

        int stream = every * pokes;
        asleepAtPokes = 0;
        sleptAt = -1;
        for (int step = 1; step <= stream + TailLimit && (sleptAt < 0 || step <= stream); step++)
        {
            bool poked = step <= stream && step % every == 0;
            if (poked)
            {
                _world.Bodies.SetLinearVelocity(box, new Vec3(speed, 0.0f, 0.0f));
            }

            _world.Step(Dt);
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
