using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Shading;

namespace Axrone.Render.OpenGL.Tests;

/// <summary>
/// Tests for <see cref="ShaderInstance.SetVec4"/>: the four-component cache entry,
/// the negative-location no-op, and the rebuild-epoch freshness path.
/// </summary>
public sealed class ShaderVec4Tests
{
    private static int CountVec4(MockGLApi mock) =>
        mock.CallLog.Count(c => c.StartsWith("Uniform4(", StringComparison.Ordinal));

    [Fact]
    public void SetVec4_UploadsOnceThenDedupsIdenticalQuad()
    {
        using var context = new GLContext(new MockGLApi());
        var mock = (MockGLApi)context.GL;
        var program = new GLProgram(context, "void main() { }", "void main() { }");
        var instance = new ShaderInstance(context, program, new UniformCache());

        instance.SetVec4(7, 1.0f, 2.0f, 3.0f, 4.0f);
        CountVec4(mock).Should().Be(1);
        mock.CallLog.Should().Contain("Uniform4(7, 1, 2, 3, 4)");

        instance.SetVec4(7, 1.0f, 2.0f, 3.0f, 4.0f);
        CountVec4(mock).Should().Be(1, "a bit-identical quad must dedup");

        program.Dispose();
    }

    [Fact]
    public void SetVec4_ReuploadsWhenAnyLaneChanges()
    {
        using var context = new GLContext(new MockGLApi());
        var mock = (MockGLApi)context.GL;
        var program = new GLProgram(context, "void main() { }", "void main() { }");
        var instance = new ShaderInstance(context, program, new UniformCache());

        instance.SetVec4(7, 1.0f, 2.0f, 3.0f, 4.0f);
        CountVec4(mock).Should().Be(1);

        // Each lane participates in the hash, so changing any one of them re-uploads.
        instance.SetVec4(7, 1.0f, 2.0f, 3.0f, 4.5f);
        CountVec4(mock).Should().Be(2, "a changed fourth lane must re-upload");
        mock.CallLog.Should().Contain("Uniform4(7, 1, 2, 3, 4.5)");

        instance.SetVec4(7, 1.5f, 2.0f, 3.0f, 4.5f);
        CountVec4(mock).Should().Be(3, "a changed first lane must re-upload");

        program.Dispose();
    }

    [Fact]
    public void SetVec4_TracksLanesSeparatelyPerLocation()
    {
        using var context = new GLContext(new MockGLApi());
        var mock = (MockGLApi)context.GL;
        var program = new GLProgram(context, "void main() { }", "void main() { }");
        var instance = new ShaderInstance(context, program, new UniformCache());

        // Distinct locations must not share one cache entry even for an equal quad.
        instance.SetVec4(1, 1.0f, 2.0f, 3.0f, 4.0f);
        instance.SetVec4(2, 1.0f, 2.0f, 3.0f, 4.0f);
        CountVec4(mock).Should().Be(2, "two locations are two cache entries");

        program.Dispose();
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(-2)]
    [InlineData(int.MinValue)]
    public void SetVec4_NegativeLocationIsNoOp(int location)
    {
        using var context = new GLContext(new MockGLApi());
        var mock = (MockGLApi)context.GL;
        var program = new GLProgram(context, "void main() { }", "void main() { }");
        var instance = new ShaderInstance(context, program, new UniformCache());

        instance.SetVec4(location, 1.0f, 2.0f, 3.0f, 4.0f);
        CountVec4(mock).Should().Be(0, "an omitted uniform reflects as a negative location");
        mock.CallLog.Should().NotContain(c => c.StartsWith("Uniform4(", StringComparison.Ordinal));

        program.Dispose();
    }

    [Fact]
    public void SetVec4_ReuploadsSameQuadAfterRebuild()
    {
        using var context = new GLContext(new MockGLApi());
        var mock = (MockGLApi)context.GL;
        var program = new GLProgram(context, "void main() { }", "void main() { }");
        var instance = new ShaderInstance(context, program, new UniformCache());

        instance.SetVec4(7, 1.0f, 2.0f, 3.0f, 4.0f);
        instance.SetVec4(7, 1.0f, 2.0f, 3.0f, 4.0f);
        CountVec4(mock).Should().Be(1, "identical value must dedup");

        program.Rebuild();
        program.RebuildCount.Should().Be(2);

        instance.SetVec4(7, 1.0f, 2.0f, 3.0f, 4.0f);
        CountVec4(mock).Should().Be(2, "rebuild epoch must force re-upload");
        mock.CallLog.Should().Contain("Uniform4(7, 1, 2, 3, 4)");

        program.Dispose();
    }
}
