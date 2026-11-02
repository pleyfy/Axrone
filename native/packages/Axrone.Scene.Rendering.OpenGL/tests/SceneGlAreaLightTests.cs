namespace Axrone.Scene.Rendering.OpenGL.Tests;

using Axrone.Numeric;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.Mock;
using Axrone.Scene.Rendering;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

public sealed class SceneGlAreaLightTests
{
    private const string VertexShader = """
        #version 330 core
        void main()
        {
            gl_Position = vec4(0.0);
        }
        """;

    [Fact]
    public void BinderClampsToSupportedLightCount()
    {
        var api = new MockGLApi { EnableCallLogging = false };
        using var context = new GLContext(api);
        using var shader = new SceneGlShader(
            context,
            "area-lights",
            VertexShader,
            "#version 330 core\nout vec4 c;\nvoid main(){c=vec4(1);}\n" + SceneGlShaderSnippets.AreaLights);

        SceneAreaLightRenderItem[] lights = new SceneAreaLightRenderItem[6];
        for (int i = 0; i < lights.Length; i++)
        {
            lights[i] = new SceneAreaLightRenderItem
            {
                Shape = i % 2 == 0 ? SceneAreaLightShape.Rect : SceneAreaLightShape.Disk,
                Size = new Vec2(2, 1),
                Position = new Vec3(i, 1, 0),
                Rotation = Quat.Identity,
                Color = Vec3.One,
                Intensity = 1.0f,
                Range = 5.0f,
                Attenuation = 2.0f,
                TwoSided = true
            };
        }

        SceneGlAreaLightBinder.Bind(shader, lights).Should().Be(SceneGlAreaLightBinder.MaxAreaLights);
        SceneGlAreaLightBinder.Bind(shader, []).Should().Be(0);
    }

    [Fact]
    public void SnippetDeclaresTheBindingContract()
    {
        SceneGlShaderSnippets.AreaLights.Should().Contain("u_AreaLightCount");
        SceneGlShaderSnippets.AreaLights.Should().Contain("u_AreaLightPosition");
        SceneGlShaderSnippets.AreaLights.Should().Contain("EvaluateAreaLights");
        SceneGlShaderSnippets.ReflectionProbe.Should().Contain("u_ReflectionProbe");
        SceneGlShaderSnippets.ReflectionProbe.Should().Contain("SampleReflectionProbe");
    }
}
