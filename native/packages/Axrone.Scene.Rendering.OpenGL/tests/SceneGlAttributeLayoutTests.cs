namespace Axrone.Scene.Rendering.OpenGL.Tests;

using System;
using System.Collections.Generic;
using Axrone.Scene.Assets;
using Axrone.Scene.Rendering.OpenGL;
using FluentAssertions;
using Xunit;

/// <summary>
/// Covers the attribute location pass that binds generated vertex inputs to the locations the
/// scene mesh layout uploads.
/// </summary>
public sealed class SceneGlAttributeLayoutTests
{
    private static readonly Dictionary<SceneMeshSemantic, string> DefaultBindings =
        new()
        {
            [SceneMeshSemantic.Position] = "a_Position",
            [SceneMeshSemantic.Normal] = "a_Normal",
            [SceneMeshSemantic.Uv0] = "a_UV0",
            [SceneMeshSemantic.Uv1] = "a_UV1",
            [SceneMeshSemantic.Tangent] = "a_Tangent"
        };

    [Fact]
    public void EnsureLocations_QualifiesEveryUnqualifiedInput()
    {
        string source = """
            #version 330 core
            in vec3 a_Position;
            in vec3 a_Normal;
            in vec2 a_UV0;
            in vec2 a_UV1;
            in vec4 a_Tangent;
            void main() { gl_Position = vec4(a_Position, 1.0); }
            """;

        string prepared = SceneGlAttributeLayout.EnsureLocations(source, DefaultBindings);

        prepared.Should().Contain("layout(location = 0) in vec3 a_Position;")
            .And.Contain("layout(location = 1) in vec3 a_Normal;")
            .And.Contain("layout(location = 2) in vec2 a_UV0;")
            .And.Contain("layout(location = 3) in vec2 a_UV1;")
            .And.Contain("layout(location = 4) in vec4 a_Tangent;");
    }

    [Fact]
    public void EnsureLocations_KeepsAlreadyQualifiedLinesByteIdentical()
    {
        string source = """
            #version 330 core
            layout(location = 0) in vec3 a_Position;
            layout(location = 4) in vec4 a_Tangent;
            void main() { gl_Position = vec4(a_Position, 1.0); }
            """;

        string prepared = SceneGlAttributeLayout.EnsureLocations(source, DefaultBindings);

        prepared.Should().Be(source);
    }

    [Fact]
    public void EnsureLocations_LeavesLinesThatOnlyUseAnAttributeAlone()
    {
        string source = """
            #version 330 core
            in vec3 a_Position;
            void main() { gl_Position = vec4(a_Normal, 1.0); }
            """;

        string prepared = SceneGlAttributeLayout.EnsureLocations(source, DefaultBindings);

        prepared.Should().Contain("layout(location = 0) in vec3 a_Position;");
        prepared.Should().NotContain("layout(location = 1) in vec3 a_Normal;");
    }

    [Fact]
    public void EnsureLocations_SkipsCommentedOutDeclarations()
    {
        string source = """
            #version 330 core
            // in vec3 a_Position;
            void main() { gl_Position = vec4(0.0); }
            """;

        string prepared = SceneGlAttributeLayout.EnsureLocations(source, DefaultBindings);

        prepared.Should().Be(source);
    }

    [Fact]
    public void EnsureLocations_ReportsMultiNameDeclarationsItCannotQualify()
    {
        string source = """
            #version 330 core
            in vec3 a_Position, a_Normal;
            void main() { gl_Position = vec4(a_Position, 1.0); }
            """;
        var notes = new List<string>();

        string prepared = SceneGlAttributeLayout.EnsureLocations(source, DefaultBindings, notes);

        notes.Should().NotBeEmpty();
        notes[0].Should().Contain("a_Position");
        prepared.Should().Be(source);
    }

    [Fact]
    public void EnsureLocations_PreservesIndentationAndVersionLine()
    {
        string source = "#version 330 core\n    in vec3 a_Position;\n";

        string prepared = SceneGlAttributeLayout.EnsureLocations(source, DefaultBindings);

        prepared.Should().Be("#version 330 core\n    layout(location = 0) in vec3 a_Position;\n");
        prepared.Should().StartWith("#version 330 core");
    }

    [Fact]
    public void EnsureLocations_ReturnsSourceUnchangedWhenTheBindingTableIsEmpty()
    {
        string source = "in vec3 a_Position;\n";

        SceneGlAttributeLayout.EnsureLocations(source, new Dictionary<SceneMeshSemantic, string>())
            .Should().Be(source);
    }

    [Theory]
    [InlineData("in vec3 a_Position;", "a_Position", SceneGlAttributeDeclaration.Unqualified)]
    [InlineData("layout(location = 0) in vec3 a_Position;", "a_Position", SceneGlAttributeDeclaration.Qualified)]
    [InlineData("in vec3 a_Normal;", "a_Position", SceneGlAttributeDeclaration.None)]
    [InlineData("// in vec3 a_Position;", "a_Position", SceneGlAttributeDeclaration.None)]
    [InlineData("vec3 value = a_Position;", "a_Position", SceneGlAttributeDeclaration.None)]
    [InlineData("in vec3 a_Position, a_Normal;", "a_Position", SceneGlAttributeDeclaration.Ambiguous)]
    public void ClassifyLine_ReportsTheDeclarationState(
        string line,
        string name,
        SceneGlAttributeDeclaration expected) =>
        SceneGlAttributeLayout.ClassifyLine(line.AsSpan(), name).Should().Be(expected);

    [Fact]
    public void HasUnqualifiedInput_DetectsOnlyTheUnqualifiedForm()
    {
        SceneGlAttributeLayout.HasUnqualifiedInput("in vec3 a_Position;\n", "a_Position").Should().BeTrue();
        SceneGlAttributeLayout.HasUnqualifiedInput(
            "layout(location = 0) in vec3 a_Position;\n",
            "a_Position").Should().BeFalse();
    }
}
