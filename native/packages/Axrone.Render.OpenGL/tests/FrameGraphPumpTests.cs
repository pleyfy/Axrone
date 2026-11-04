using Axrone.Execution;
using Axrone.Render.Core.Abstractions;
using Axrone.Render.OpenGL.Context;
using Axrone.Render.OpenGL.FrameGraph;
using Axrone.Render.OpenGL.FrameGraph.Passes;
using Axrone.Render.OpenGL.Native;
using Axrone.Render.OpenGL.Resources;
using Axrone.Utility.Descriptors;

// Aliases to avoid ambiguity between namespace Axrone.Render.OpenGL.FrameGraph
// and the typestate FrameGraph handles within that namespace: FG is the building
// handle (AddPass/Reset/Compile), FGC the compiled handle returned by Compile()
// that carries Execute and the pump legs.
using FG = global::Axrone.Render.OpenGL.FrameGraph.FrameGraph<global::Axrone.Render.OpenGL.FrameGraph.BuildingPhase, global::Axrone.Render.OpenGL.FrameGraph.DefaultGraphPolicy>;
using FGC = global::Axrone.Render.OpenGL.FrameGraph.FrameGraph<global::Axrone.Render.OpenGL.FrameGraph.CompiledPhase, global::Axrone.Render.OpenGL.FrameGraph.DefaultGraphPolicy>;

using RenderPump = Axrone.Execution.CommandPump<
    Axrone.Render.Core.RenderCommand,
    Axrone.Render.OpenGL.FrameGraph.RenderPumpContext,
    Axrone.Render.OpenGL.FrameGraph.RenderCommandProcessor,
    Axrone.Utility.Backoff.SpinPolicies.AdaptiveSpinBackoff,
    Axrone.Execution.NullExecutorTelemetry>;

namespace Axrone.Render.OpenGL.Tests;

#pragma warning disable CA1062 // Phase parameters are supplied by the frame graph, which null-checks before dispatch.

/// <summary>
/// Tests for the FrameGraph command-pump wiring: pump-capable passes
/// (<see cref="IPumpEnqueue"/>) enqueue library commands into the graph-owned
/// pump while classic passes keep their direct <see cref="IRenderPass.Execute(IRenderContext)"/>
/// path (hybrid graph). The pump legs live on the compiled handle, so every
/// test compiles the building graph first and drives it through that handle.
/// </summary>
/// <remarks>
/// The graph owns its internal <see cref="PassExecutionContext"/> and tests
/// cannot register resources into it, so the pump-capable test pass captures
/// its framebuffers directly and enqueues a real blit command whose handles
/// resolve through the context registry when pumped.
/// </remarks>
public sealed class FrameGraphPumpTests : IDisposable
{
    private readonly MockGLApi _mock;
    private readonly GLContext _context;

    public FrameGraphPumpTests()
    {
        _mock = new MockGLApi();
        _context = new GLContext(_mock);
    }

    [Fact]
    public void EnqueuePumpPasses_WithPumpPass_EnqueuesAndPumpsBlit()
    {
        using var graph = new FG(_context);
        var source = new GLFramebuffer(_context, 64, 64, "src");
        var destination = new GLFramebuffer(_context, 64, 64, "dst");
        graph.AddPass(CreatePumpTestPass("blit", source, destination));

        FGC compiled = graph.Compile();
        compiled.EnqueuePumpPasses().Should().Be(1u);

        compiled.PumpQueuedCommands().Should().Be(1u);

        _mock.CallLog.Should().Contain(c => c.Contains("BlitFramebuffer(0, 0, 64, 64, 0, 0, 64, 64", StringComparison.Ordinal));

        source.Dispose();
        destination.Dispose();
    }

    [Fact]
    public void EnqueuePumpPasses_WithOnlyNonPumpPasses_ReturnsZero_AndExecuteStillWorks()
    {
        using var graph = new FG(_context);
        int executionCount = 0;
        graph.AddPass(CustomPass.Create("classic", FramePassKind.Custom, (gl, ctx) => executionCount++));

        FGC compiled = graph.Compile();
        compiled.EnqueuePumpPasses().Should().Be(0u);

        compiled.Execute();

        executionCount.Should().Be(1);
    }

    [Fact]
    public void EnqueuePumpPasses_SkipsDisabledPumpPass()
    {
        using var graph = new FG(_context);
        var source = new GLFramebuffer(_context, 64, 64, "src");
        var destination = new GLFramebuffer(_context, 64, 64, "dst");
        var pass = CreatePumpTestPass("blit", source, destination);
        pass.IsEnabled = false;
        graph.AddPass(pass);

        graph.Compile().EnqueuePumpPasses().Should().Be(0u);

        source.Dispose();
        destination.Dispose();
    }

    [Fact]
    public void Reset_DoesNotDrainQueuedCommands()
    {
        using var graph = new FG(_context);
        var source = new GLFramebuffer(_context, 64, 64, "src");
        var destination = new GLFramebuffer(_context, 64, 64, "dst");
        graph.AddPass(CreatePumpTestPass("blit", source, destination));

        graph.Compile().EnqueuePumpPasses().Should().Be(1u);

        graph.Reset();
        graph.PassCount.Should().Be(0);

        // Documented semantics: Reset leaves the pump alive and undrained;
        // queued-but-unpumped commands survive and still pump.
        graph.Compile().PumpQueuedCommands().Should().Be(1u);

        source.Dispose();
        destination.Dispose();
    }

    [Fact]
    public void Execute_ThrowingPass_FaultsGraphPump_AndRefusesLaterEnqueues()
    {
        using var graph = new FG(_context);
        var source = new GLFramebuffer(_context, 64, 64, "src");
        var destination = new GLFramebuffer(_context, 64, 64, "dst");

        // The throwing pass declares no dependencies and is added first, so the walk
        // reaches it first. The blit pass is only the observable: with a healthy pump
        // the same graph enqueues it (see EnqueuePumpPasses_WithPumpPass_...).
        graph.AddPass(CustomPass.Create(
            "throwing",
            FramePassKind.Custom,
            static (_, _) => throw new InvalidOperationException("walk fault")));
        graph.AddPass(CreatePumpTestPass("blit", source, destination));

        var action = () => graph.Compile().Execute();

        // (a) The original failure surfaces: pass identity wrapped, original type,
        //     message and stack preserved through the walk's fault isolation.
        RenderException thrown = action.Should().Throw<RenderException>().Which;
        thrown.Code.Should().Be(RenderErrorCode.PassExecutionFailed);
        thrown.Message.Should().Contain("walk fault");
        thrown.InnerException.Should().BeOfType<InvalidOperationException>()
            .Which.Message.Should().Be("walk fault");
        thrown.StackTrace.Should().Contain(nameof(Execute_ThrowingPass_FaultsGraphPump_AndRefusesLaterEnqueues));

        // (b) Fail-closed: the graph-owned pump is Faulted, so it refuses every
        //     later enqueue with EnqueueStatus.Closed instead of accepting work
        //     whose GL state is unknown.
        graph.Pump.State.Should().Be(PumpState.Faulted);
        graph.Compile().EnqueuePumpPasses().Should().Be(0u);

        source.Dispose();
        destination.Dispose();
    }

    [Fact]
    public void PumpQueuedCommands_OnDisposedGraph_ThrowsObjectDisposed()
    {
        var graph = new FG(_context);
        FGC compiled = graph.Compile();
        graph.Dispose();

        var action = () => compiled.PumpQueuedCommands();

        action.Should().Throw<ObjectDisposedException>();
    }

    [Fact]
    public void Constructor_NonPowerOfTwoPumpCapacity_Throws()
    {
        // The pump capacity is not a public constructor parameter, so the
        // validation it used to be reached through is reached here through the
        // internal storage seam the test assembly is a friend of.
        var action = () => new FG(new FrameGraphStorage(_context, 100));

        action.Should().Throw<ArgumentOutOfRangeException>();
    }

    // ========================================================================
    // Helper pass implementations
    // ========================================================================

    /// <summary>
    /// Payload of the pump-capable test pass: the two captured framebuffers.
    /// The static phase bodies read the payload fields, so the enqueue leg resolves
    /// the same handles the setup phase would have.
    /// </summary>
    private struct PumpTestPassData
        : IPassSetup<PumpTestPassData>, IPassValidate<PumpTestPassData>, IPassExecute<PumpTestPassData>, IPassEnqueue<PumpTestPassData>
    {
        public GLFramebuffer Source;
        public GLFramebuffer Destination;

        public static void Declare(IRenderPassBuilder builder, ref PumpTestPassData data)
        {
        }

        public static void Validate(in PumpTestPassData data)
        {
        }

        public static void Execute(in PumpTestPassData data, IRenderContext context, PassExecutionContext ctx)
        {
            // Pump-capable pass: the direct leg has nothing to do.
        }

        public static EnqueueResult EnqueueCommands(in PumpTestPassData data, RenderPump pump, PassExecutionContext ctx)
        {
            DescriptorHandle<GLResourceNode> sourceHandle = data.Source.RegistryHandle;
            DescriptorHandle<GLResourceNode> destinationHandle = data.Destination.RegistryHandle;

            RenderCommand command = RenderCommand.CreateBlit(
                in sourceHandle, in destinationHandle,
                0, 0, data.Source.Width, data.Source.Height,
                0, 0, data.Destination.Width, data.Destination.Height,
                GLConst.ColorBufferBit, GLConst.NearestFilter);
            return pump.TryEnqueue(in command);
        }
    }

    /// <summary>
    /// Creates a pump-capable test pass: enqueues a real blit command for two
    /// captured framebuffers, mirroring <see cref="BlitPass"/> but resolving
    /// resources from its payload (the graph's internal execution context
    /// is unreachable from tests).
    /// </summary>
    private static PumpRenderPass<PumpTestPassData> CreatePumpTestPass(
        string name,
        GLFramebuffer source,
        GLFramebuffer destination)
    {
        return new PumpRenderPass<PumpTestPassData>(
            name,
            FramePassKind.Blit,
            new PumpTestPassData
            {
                Source = source,
                Destination = destination
            });
    }

    public void Dispose()
    {
        _context.Dispose();
    }
}
