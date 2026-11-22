namespace Axrone.Physics2D.Tests;

using Axrone.Geometry;
using Axrone.Numeric;
using FluentAssertions;
using Xunit;

/// <summary>
/// Gates the position pass: depth is re-measured from the frames the bodies
/// carry now, the two points of a face are solved as one coupled system and
/// applied once, and a sweep resolves the residual instead of paying the
/// narrowphase snapshot a fixed fraction per iteration.
/// </summary>
public sealed class RestStability2DTests : IDisposable
{
    private const float Dt = 1f / 60f;
    private const float BoxHalf = 0.5f;
    private const float LinearSlop = 0.005f;
    private const float AnalyticRestY = BoxHalf - LinearSlop;

    private readonly World _world;

    public RestStability2DTests()
    {
        _world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private static (BodyId Body, ShapeId Shape) AddGround(World world, float halfWidth = 10.0f)
    {
        BodyId ground = world.Bodies.Create(new BodyDef { Type = BodyType.Static, Position = new Vec2(0.0f, -1.0f) });
        ShapeId shape = world.Shapes.AttachPolygon(
            world.Bodies,
            world.Broadphase,
            ground,
            new Vec2[]
            {
                new(-halfWidth, -1.0f),
                new(halfWidth, -1.0f),
                new(halfWidth, 1.0f),
                new(-halfWidth, 1.0f),
            },
            material: new PhysicsMaterial(0.8f, 0.0f));
        return (ground, shape);
    }

    private static (BodyId Body, ShapeId Shape) AddBox(
        World world,
        Vec2 center,
        float half = BoxHalf,
        float friction = 0.7f,
        bool allowSleep = true,
        float initialSpeed = 0.0f)
    {
        BodyId body = world.Bodies.Create(new BodyDef
        {
            Type = BodyType.Dynamic,
            Position = center,
            AllowSleep = allowSleep,
            LinearVelocity = new Vec2(initialSpeed, 0.0f),
        });
        ShapeId shape = world.Shapes.AttachPolygon(
            world.Bodies,
            world.Broadphase,
            body,
            new Vec2[] { new(-half, -half), new(half, -half), new(half, half), new(-half, half) },
            material: new PhysicsMaterial(friction, 0.0f));
        return (body, shape);
    }

    private static float TiltDegrees(World world, BodyId body)
    {
        Transform2D frame = world.Bodies.GetTransform(body);
        return Math.Abs(MathF.Atan2(frame.Sin, frame.Cos)) * 180.0f / MathF.PI;
    }

    /// <summary>
    /// Hand-built symmetric face contact over a static slab: two witnesses at
    /// x = ±0.5, both penetrating by <paramref name="depth"/>, repeated
    /// <paramref name="copies"/> times so a caller can size the contact list.
    /// </summary>
    private static (World World, Contact[] Contacts, BodyId Box) SymmetricPair(float depth, int copies = 1)
    {
        var world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
        (BodyId ground, ShapeId shapeA) = AddGround(world);
        (BodyId box, ShapeId shapeB) = AddBox(world, new Vec2(0.0f, BoxHalf - depth));

        var manifold = new ContactManifold(
            new Vec2(0.0f, 1.0f),
            new ContactPoint(new Vec2(-BoxHalf, 0.0f), new Vec2(-BoxHalf, -depth), -depth, ContactId.Create(0, 0, false)),
            new ContactPoint(new Vec2(BoxHalf, 0.0f), new Vec2(BoxHalf, -depth), -depth, ContactId.Create(0, 1, false)));

        var contacts = new Contact[copies];
        for (int i = 0; i < copies; i++)
        {
            contacts[i] = new Contact(shapeA, shapeB, ground, box, in manifold, default, isSensor: false);
        }

        return (world, contacts, box);
    }

    /// <summary>
    /// The residual a sweep sees must be the residual that exists, so the rest
    /// depth cannot depend on how many sweeps the world was told to run. Base
    /// build measured p=1 at 0.49499986 and p=8 at 0.49857005: the eighth
    /// iteration still paid from the pre-integration figure and over-corrected
    /// by 0.00357 m.
    /// </summary>
    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(8)]
    public void RestDepth_IsIndependentOfPositionIterationCount(int positionIterations)
    {
        using var world = new World(new WorldDef
        {
            Gravity = new Vec2(0.0f, -9.81f),
            PositionIterations = positionIterations,
        });
        AddGround(world);
        (BodyId box, _) = AddBox(world, new Vec2(0.0f, 1.0f), allowSleep: false);

        for (int step = 0; step < 900; step++)
        {
            world.Step(Dt);
        }

        Vec2 rest = world.Bodies.GetTransform(box).Position;
        float error = Math.Abs(rest.Y - AnalyticRestY);
        error.Should().BeLessThan(1e-5f,
            $"a full residual sweep lands the pair on the linear slop {LinearSlop} and later sweeps find nothing to do; p={positionIterations} measured rest y = {rest.Y:R}, error {error:R}");
    }

    /// <summary>
    /// Negative control for the row above: with the position pass switched off
    /// the same scene must stay sunk, otherwise the equality above would be
    /// measuring a solver that never runs.
    /// </summary>
    [Fact]
    public void PositionPassOff_LeavesTheBoxSunk()
    {
        using var world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f), PositionIterations = 0 });
        AddGround(world);
        (BodyId box, _) = AddBox(world, new Vec2(0.0f, 1.0f), allowSleep: false);

        for (int step = 0; step < 900; step++)
        {
            world.Step(Dt);
        }

        Vec2 rest = world.Bodies.GetTransform(box).Position;
        float sink = AnalyticRestY - rest.Y;
        sink.Should().BeGreaterThan(0.005f,
            $"with no position pass the penetration taken at the velocity step is never recovered; measured rest y = {rest.Y:R}, sink {sink:R}");
    }

    /// <summary>
    /// The same property at the level of one pass: eight sweeps of a hand-built
    /// 0.05 m penetration must move the box exactly as far as one sweep, because
    /// the first sweep already resolved the residual. The base build charged
    /// 0.009 m per sweep against a figure it never re-read, so one and eight
    /// sweeps differed.
    /// </summary>
    [Fact]
    public void OneSweepAndEightSweep_AreTheSameCorrection()
    {
        (World worldOne, Contact[] contactsOne, BodyId boxOne) = SymmetricPair(0.05f);
        (World worldEight, Contact[] contactsEight, BodyId boxEight) = SymmetricPair(0.05f);

        ContactSolver.SolvePositions(worldOne.Bodies, worldOne.Shapes, contactsOne, 1);
        ContactSolver.SolvePositions(worldEight.Bodies, worldEight.Shapes, contactsEight, 8);

        Vec2 positionOne = worldOne.Bodies.GetTransform(boxOne).Position;
        Vec2 positionEight = worldEight.Bodies.GetTransform(boxEight).Position;

        float difference = Math.Abs(positionOne.X - positionEight.X) + Math.Abs(positionOne.Y - positionEight.Y);
        difference.Should().BeLessThan(1e-9f,
            $"one full sweep already removes the residual, so eight must not remove eight of them; measured one sweep ({positionOne.X:R},{positionOne.Y:R}), eight sweeps ({positionEight.X:R},{positionEight.Y:R})");

        float residual = AnalyticRestY - positionEight.Y;
        Math.Abs(residual).Should().BeLessThan(1e-5f,
            $"a full pass over a 0.05 m penetration must land the box on the slop (expected y {AnalyticRestY:R}); measured {positionEight.Y:R}");

        worldOne.Dispose();
        worldEight.Dispose();
    }

    /// <summary>
    /// A pair whose two witnesses disagree must still have its observable
    /// differential closed: the bundle may equalise, it may not average the
    /// wedge away. An untilted box over a deeper left witness has to gain the
    /// twist that lifts that side, and still recover the mean depth.
    /// </summary>
    [Fact]
    public void WedgeDifferential_IsStillClosed()
    {
        const float DeepSide = 0.05f;
        const float ShallowSide = 0.02f;
        using var world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
        (BodyId ground, ShapeId shapeA) = AddGround(world);
        (BodyId box, ShapeId shapeB) = AddBox(world, new Vec2(0.0f, BoxHalf - DeepSide));

        var manifold = new ContactManifold(
            new Vec2(0.0f, 1.0f),
            new ContactPoint(new Vec2(-BoxHalf, 0.0f), new Vec2(-BoxHalf, -DeepSide), -DeepSide, ContactId.Create(0, 0, false)),
            new ContactPoint(new Vec2(BoxHalf, 0.0f), new Vec2(BoxHalf, -ShallowSide), -ShallowSide, ContactId.Create(0, 1, false)));
        var contacts = new[] { new Contact(shapeA, shapeB, ground, box, in manifold, default, isSensor: false) };

        Vec2 beforeCenter = world.Bodies.GetTransform(box).Position;
        ContactSolver.SolvePositions(world.Bodies, world.Shapes, contacts, 4);
        Transform2D after = world.Bodies.GetTransform(box);
        float afterAngle = MathF.Atan2(after.Sin, after.Cos);
        float afterDegrees = afterAngle * 180.0f / MathF.PI;

        afterAngle.Should().BeLessThan(-1e-3f,
            $"the left witness was {DeepSide - ShallowSide:R} m deeper, so flattening the wedge means turning the deeper side up (a clockwise turn); measured {afterDegrees:R} deg");
        Math.Abs(afterDegrees).Should().BeLessThan(5.0f,
            $"closing a 0.03 m wedge over a 1 m span must not whip the box; measured {afterDegrees:R} deg");

        float rise = after.Position.Y - beforeCenter.Y;
        rise.Should().BeGreaterThan(0.01f,
            $"the mean depth of the pair is {(DeepSide + ShallowSide) / 2.0f:R} m and must be recovered toward the slop; measured rise {rise:R} m to y {after.Position.Y:R}");
    }

    /// <summary>
    /// A symmetric pair must gain no couple: both witnesses carry the same
    /// residual with opposite levers, so the bundle's moment cancels exactly.
    /// This is the invariant the sequential form of the same re-projection
    /// destroys — it toppled an offset stack to 90.246574 deg at p=8.
    /// </summary>
    [Fact]
    public void SymmetricPair_GainsNoCouple()
    {
        (World world, Contact[] contacts, BodyId box) = SymmetricPair(0.05f);

        float beforeAngle = MathF.Atan2(world.Bodies.GetTransform(box).Sin, world.Bodies.GetTransform(box).Cos);
        ContactSolver.SolvePositions(world.Bodies, world.Shapes, contacts, 8);
        float afterAngle = MathF.Atan2(world.Bodies.GetTransform(box).Sin, world.Bodies.GetTransform(box).Cos);

        float spinDegrees = Math.Abs(afterAngle - beforeAngle) * 180.0f / MathF.PI;
        spinDegrees.Should().BeLessThan(1e-6f,
            $"a pair whose witnesses share a line through the centre cannot report a twist; measured {spinDegrees:R} deg after eight sweeps");

        world.Dispose();
    }

    /// <summary>
    /// The scene-level consequence of the row above: an offset stack run at an
    /// unusually high iteration count must stay an offset stack. Sequential
    /// re-projection toppled it to 90.246574 deg with 1.474 m of drift; the base
    /// build sat at 0.67856866 deg and the shipped bundle measures 0.6165 deg.
    /// </summary>
    [Fact]
    public void OffsetStack_AtEightPositionIterations_KeepsItsShape()
    {
        using var world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f), PositionIterations = 8 });
        AddGround(world);
        (BodyId lower, _) = AddBox(world, new Vec2(0.0f, AnalyticRestY), allowSleep: false);
        (BodyId upper, _) = AddBox(world, new Vec2(0.25f, AnalyticRestY + 1.0f), allowSleep: false);

        float maxTilt = 0.0f;
        float maxDrift = 0.0f;
        for (int step = 0; step < 600; step++)
        {
            world.Step(Dt);
            Vec2 frame = world.Bodies.GetTransform(upper).Position;
            maxTilt = Math.Max(maxTilt, TiltDegrees(world, upper));
            maxDrift = Math.Max(maxDrift, Math.Abs(frame.X - 0.25f));
        }

        Vec2 upperRest = world.Bodies.GetTransform(upper).Position;
        maxTilt.Should().BeLessThan(5.0f,
            $"eight sweeps must not invent a topple on a stack that rests calmly at three; measured peak tilt {maxTilt:R} deg");
        maxDrift.Should().BeLessThan(0.2f,
            $"the offset box may slide a little; measured peak lateral drift {maxDrift:R} m");
        upperRest.Y.Should().BeGreaterThan(1.0f,
            $"the upper box must stay on top of the lower one; measured y {upperRest.Y:R}");
        Math.Abs(upperRest.X - 0.25f).Should().BeLessThan(0.2f,
            $"the upper box must stay near its authored offset; measured x {upperRest.X:R}");
        TiltDegrees(world, lower).Should().BeLessThan(5.0f,
            $"the supporting box must not be spun either; measured {TiltDegrees(world, lower):R} deg");
    }

    /// <summary>
    /// The pass must stay allocation-free at the window boundary and past it: a
    /// 600-contact list resolves as consecutive windows of the same stack buffer,
    /// so 1000 passes may not touch the heap.
    /// </summary>
    [Fact]
    public void PositionPass_SweepsLongContactLists_WithoutAllocating()
    {
        const int Copies = 600;
        (World world, Contact[] contacts, BodyId box) = SymmetricPair(0.05f, Copies);

        ContactSolver.SolvePositions(world.Bodies, world.Shapes, contacts, 3);
        long baseline = GC.GetTotalAllocatedBytes(true);
        for (int i = 0; i < 1000; i++)
        {
            ContactSolver.SolvePositions(world.Bodies, world.Shapes, contacts, 3);
        }

        long allocated = GC.GetTotalAllocatedBytes(true) - baseline;
        Vec2 frame = world.Bodies.GetTransform(box).Position;
        allocated.Should().Be(0,
            $"1000 passes over {Copies} contacts must resolve through stack windows only; measured {allocated} B allocated, box at ({frame.X:R},{frame.Y:R})");

        world.Dispose();
    }

    /// <summary>
    /// The world's own position pass reads a window it owns; a scene larger than
    /// the solver's stack window has to rest exactly like a small one.
    /// </summary>
    [Fact]
    public void WideScene_BeyondOneWindow_RestsWithoutCorruption()
    {
        const int Count = 150;
        using var world = new World(new WorldDef { Gravity = new Vec2(0.0f, -9.81f) });
        AddGround(world, halfWidth: 80.0f);
        BodyId[] boxes = new BodyId[Count];
        for (int i = 0; i < Count; i++)
        {
            (boxes[i], _) = AddBox(world, new Vec2((i * 1.0f) - (Count / 2.0f), 0.6f), allowSleep: false);
        }

        for (int step = 0; step < 300; step++)
        {
            world.Step(Dt);
        }

        int contactCount = world.ContactCount;
        float worstError = 0.0f;
        int nonFinite = 0;
        foreach (BodyId body in boxes)
        {
            Vec2 position = world.Bodies.GetTransform(body).Position;
            if (float.IsNaN(position.X + position.Y))
            {
                nonFinite++;
                continue;
            }

            worstError = Math.Max(worstError, Math.Abs(position.Y - AnalyticRestY));
        }

        contactCount.Should().BeGreaterThan(128,
            $"this row only means something if the scene really exceeds the stack window; measured {contactCount} contacts");
        nonFinite.Should().Be(0, $"no body may leave the finite plane in a 150-box row; measured {nonFinite} NaN bodies over {contactCount} contacts");
        worstError.Should().BeLessThan(0.02f,
            $"every box in the row rests at {AnalyticRestY:R} plus or minus the slop; worst measured error {worstError:R} m");
    }
}
