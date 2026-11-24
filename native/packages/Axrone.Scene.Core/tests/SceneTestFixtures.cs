namespace Axrone.Scene.Core.Tests;

using Axrone.Scene;

internal struct Health : ISceneDataComponent
{
    public int Value;
}

internal sealed class CounterBehaviour : ISceneBehaviour
{
    public int LoadCount;
    public int StartCount;
    public int EnableCount;
    public int DisableCount;
    public int DestroyCount;
    public int Updates;

    public SceneBehaviourContext? Context { get; private set; }

    public void OnAttach(SceneBehaviourContext context)
    {
        Context = context;
        LoadCount++;
        context.OnStart(() => StartCount++);
        context.OnEnable(() => EnableCount++);
        context.OnUpdate(_ => Updates++);
        context.OnDisable(() => DisableCount++);
        context.OnDetach(() => DestroyCount++);
    }
}

internal sealed class HighOrderBehaviour : ISceneBehaviour
{
    private readonly List<string> _log;

    public HighOrderBehaviour(List<string> log) => _log = log;

    public void OnAttach(SceneBehaviourContext context) =>
        context.OnUpdate(_ => _log.Add("high"));
}

internal sealed class LowOrderBehaviour : ISceneBehaviour
{
    private readonly List<string> _log;

    public LowOrderBehaviour(List<string> log) => _log = log;

    public void OnAttach(SceneBehaviourContext context) =>
        context.OnUpdate(_ => _log.Add("low"));
}

internal sealed class ThrowingBehaviour : ISceneBehaviour
{
    public void OnAttach(SceneBehaviourContext context) =>
        context.OnUpdate(_ => throw new InvalidOperationException("behaviour fault"));
}

internal sealed class RecordingDiagnosticsSink : ISceneDiagnosticsSink
{
    public List<SceneDiagnostic> Diagnostics { get; } = new();

    public void Report(in SceneDiagnostic diagnostic) => Diagnostics.Add(diagnostic);
}

internal static class SceneWorldFixture
{
    public static SceneWorld Create3DWorld(
        out SceneComponentRegistry registry,
        ISceneDiagnosticsSink? diagnostics = null,
        SceneWorldErrorPolicy policy = SceneWorldErrorPolicy.IsolateBehaviours)
    {
        registry = new SceneComponentRegistry();
        registry.RegisterData<SceneTransform3D>(
            "Transform3D",
            SceneComponentTraits.Required | SceneComponentTraits.Singleton,
            priority: 1000);
        registry.RegisterData<Health>("Health", SceneComponentTraits.Serializable);
        registry.RegisterBehaviour<CounterBehaviour>("Counter", priority: 0);

        return new SceneWorld(
            registry,
            diagnostics,
            new SceneWorldOptions(initialCapacity: 4, errorPolicy: policy));
    }

    public static SceneWorld Create2DWorld(out SceneComponentRegistry registry)
    {
        registry = new SceneComponentRegistry();
        registry.RegisterData<SceneTransform2D>(
            "Transform2D",
            SceneComponentTraits.Required | SceneComponentTraits.Singleton,
            priority: 1000);

        return new SceneWorld(
            registry,
            diagnostics: null,
            new SceneWorldOptions(initialCapacity: 4));
    }
}
