using Axrone.Numeric;
using Axrone.Physics3D;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;

namespace Axrone.Physics3D.Tests;

public sealed class Ccd3DTests : IDisposable
{
    private readonly World _world = new();
    private readonly ITestOutputHelper _output;

    public Ccd3DTests(ITestOutputHelper output) => _output = output;

    public void Dispose() => _world.Dispose();

    [Fact]
    public void Bullet_DoesNot_Tunnel_ThinWall()
    {
        BodyId wall = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, wall,
            Vec3.Zero, new Vec3(0.1f, 5.0f, 5.0f));

        BodyId bullet = _world.Bodies.Create(new BodyDef { Bullet = true });
        _world.Shapes.AttachSphere(_world.Bodies, _world.Broadphase, bullet, Vec3.Zero, 0.5f);
        _world.Bodies.SetTransform(bullet, new Vec3(-5.0f, 0.0f, 0.0f), Quat.Identity);
        _world.Bodies.SetLinearVelocity(bullet, new Vec3(60.0f, 0.0f, 0.0f));

        for (int i = 0; i < 60; i++)
        {
            _world.Step(1.0f / 60.0f);
        }

        float x = _world.Bodies.GetTransform(bullet).Position.X;
        x.Should().BeLessThan(0.6f);
        _world.ContactCount.Should().BeGreaterThan(0);
    }

    [Fact]
    public void NonBullet_AtHighSpeed_MayTunnel()
    {
        var tame = new World(new WorldDef { CcdSweepStep = 1000.0f, MaxCcdSubsteps = 1 });
        try
        {
            BodyId wall = tame.Bodies.Create(new BodyDef { Type = BodyType.Static });
            tame.Shapes.AttachBox(tame.Bodies, tame.Broadphase, wall,
                Vec3.Zero, new Vec3(0.1f, 5.0f, 5.0f));

            BodyId mover = tame.Bodies.Create(new BodyDef());
            tame.Shapes.AttachSphere(tame.Bodies, tame.Broadphase, mover, Vec3.Zero, 0.5f);
            tame.Bodies.SetTransform(mover, new Vec3(-5.0f, 0.0f, 0.0f), Quat.Identity);
            tame.Bodies.SetLinearVelocity(mover, new Vec3(600.0f, 0.0f, 0.0f));

            // 600 m/s is capped to MaxVelocity and each step is then capped to
            // MaxTranslation, so the body crosses the 4.9 m of clear floor in
            // three steps instead of one; it still never resolves against the
            // wall because no step leaves it within a radius of the slab.
            for (int i = 0; i < 3; i++)
            {
                tame.Step(1.0f / 60.0f);
            }

            float x = tame.Bodies.GetTransform(mover).Position.X;
            _output.WriteLine(
                $"600 m/s capped to {PhysicsConstants.MaxVelocity:0} m/s and {PhysicsConstants.MaxTranslation:0.##} m " +
                $"per step: x={x:0.#####} m after 3 steps, past the wall at |x|<=0.1 m.");
            x.Should().BeGreaterThan(0.6f,
                $"three capped steps of {PhysicsConstants.MaxTranslation:0.##} m from x=-5 put the body at " +
                $"{x:0.#####} m, short of the far face of the wall.");
        }
        finally
        {
            tame.Dispose();
        }
    }

    [Fact]
    public void Bullet_Stacks_Stop_OnGround()
    {
        BodyId ground = _world.Bodies.Create(new BodyDef { Type = BodyType.Static });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, ground,
            new Vec3(0.0f, -1.0f, 0.0f), new Vec3(10.0f, 1.0f, 10.0f));

        BodyId bullet = _world.Bodies.Create(new BodyDef { Bullet = true });
        _world.Shapes.AttachBox(_world.Bodies, _world.Broadphase, bullet, Vec3.Zero, new Vec3(0.5f, 0.5f, 0.5f));
        _world.Bodies.SetTransform(bullet, new Vec3(0.0f, 8.0f, 0.0f), Quat.Identity);
        _world.Bodies.SetLinearVelocity(bullet, new Vec3(0.0f, -30.0f, 0.0f));

        for (int i = 0; i < 240; i++)
        {
            _world.Step(1.0f / 60.0f);
        }

        float y = _world.Bodies.GetTransform(bullet).Position.Y;
        y.Should().BeApproximately(0.5f, 0.15f);
    }
}
