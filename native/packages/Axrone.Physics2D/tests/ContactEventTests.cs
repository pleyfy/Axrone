namespace Axrone.Physics2D.Tests;

using Axrone.Numeric;
using FluentAssertions;
using Xunit;

public sealed class ContactEventTests : IDisposable
{
    private readonly World _world;

    public ContactEventTests()
    {
        _world = new World();
    }

    public void Dispose()
    {
        _world.Dispose();
        GC.SuppressFinalize(this);
    }

    private BodyId AddBox(Vec2 center, Vec2 halfExtents, BodyType type = BodyType.Dynamic)
    {
        BodyId body = _world.Bodies.Create(new BodyDef { Type = type, Position = center });
        _world.Shapes.AttachPolygon(
            _world.Bodies, _world.Broadphase, body,
            new Vec2[]
            {
                new(-halfExtents.X, -halfExtents.Y),
                new(halfExtents.X, -halfExtents.Y),
                new(halfExtents.X, halfExtents.Y),
                new(-halfExtents.X, halfExtents.Y),
            });
        return body;
    }

    [Fact]
    public void FirstOverlap_RaisesBegin()
    {
        AddBox(new Vec2(0, 0), new Vec2(1, 1), BodyType.Static);
        AddBox(new Vec2(0.5f, 0), new Vec2(1, 1));

        _world.Step(1f / 60f);

        _world.ContactCount.Should().Be(1);
        _world.ContactEventCount.Should().Be(1);
        ContactEvent evt = _world.GetContactEvent(0);
        evt.Type.Should().Be(CollisionEventType.Begin);
        Contact contact = _world.GetContact(0);
        evt.ShapeA.Should().Be(contact.ShapeA);
        evt.ShapeB.Should().Be(contact.ShapeB);
        evt.BodyA.Should().Be(contact.BodyA);
        evt.BodyB.Should().Be(contact.BodyB);
    }

    [Fact]
    public void PersistingContact_RaisesStay()
    {
        // Behavior update with the enum event surface: a persisting overlap
        // now reports Stay (shared physics-core contract) instead of staying
        // silent as the old bool-Began surface did.
        AddBox(new Vec2(0, 0), new Vec2(1, 1), BodyType.Static);
        AddBox(new Vec2(0.5f, 0), new Vec2(1, 1));

        _world.Step(1f / 60f);
        _world.ContactEventCount.Should().Be(1);
        _world.GetContactEvent(0).Type.Should().Be(CollisionEventType.Begin);

        _world.Step(1f / 60f);

        _world.ContactCount.Should().Be(1);
        _world.ContactEventCount.Should().Be(1);
        _world.GetContactEvent(0).Type.Should().Be(CollisionEventType.Stay);
    }

    [Fact]
    public void Separation_RaisesEnd()
    {
        AddBox(new Vec2(0, 0), new Vec2(1, 1), BodyType.Static);
        BodyId mover = AddBox(new Vec2(0.5f, 0), new Vec2(1, 1));

        _world.Step(1f / 60f);
        _world.ContactEventCount.Should().Be(1);
        ContactEvent began = _world.GetContactEvent(0);
        began.Type.Should().Be(CollisionEventType.Begin);

        _world.Bodies.SetTransform(mover, new Vec2(50, 50), 0f);
        _world.Step(1f / 60f);

        _world.ContactCount.Should().Be(0);
        _world.ContactEventCount.Should().Be(1);
        ContactEvent ended = _world.GetContactEvent(0);
        ended.Type.Should().Be(CollisionEventType.End);
        ended.ShapeA.Should().Be(began.ShapeA);
        ended.ShapeB.Should().Be(began.ShapeB);
    }

    [Fact]
    public void DestroyBody_RaisesEndOnNextStep()
    {
        AddBox(new Vec2(0, 0), new Vec2(1, 1), BodyType.Static);
        BodyId doomed = AddBox(new Vec2(0.5f, 0), new Vec2(1, 1));

        _world.Step(1f / 60f);
        _world.ContactEventCount.Should().Be(1);
        ContactEvent began = _world.GetContactEvent(0);
        began.Type.Should().Be(CollisionEventType.Begin);

        _world.DestroyBody(doomed);
        _world.Step(1f / 60f);

        _world.ContactCount.Should().Be(0);
        _world.ContactEventCount.Should().Be(1);
        ContactEvent ended = _world.GetContactEvent(0);
        ended.Type.Should().Be(CollisionEventType.End);
        ended.ShapeA.Should().Be(began.ShapeA);
        ended.ShapeB.Should().Be(began.ShapeB);
    }
}
