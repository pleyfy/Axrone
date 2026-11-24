using Axrone.Physics3D;
using FluentAssertions;
using Xunit;

namespace Axrone.Physics3D.Tests;

public sealed class PositionManifoldContract3DTests
{
    [Fact]
    public void PositionWindow_UsesTheSameTwoPointContractAsTheManifold()
    {
        PositionGeometryWindow.PointsPerContact.Should().Be(2,
            "the coupled position solve reads exactly two witnesses per contact.");
        PositionGeometryWindow.PointsPerContact.Should().Be(Manifold3D.MaxPoints,
            "widening the public manifold cap without widening the solver must fail this contract.");
    }
}
