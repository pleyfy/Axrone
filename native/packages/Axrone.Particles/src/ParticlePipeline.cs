namespace Axrone.Particles;

/// <summary>Module execution context.</summary>
public readonly ref struct ModuleExecutionContext
{
    /// <summary>Frame delta.</summary>
    public readonly DeltaTime DeltaTime;

    /// <summary>Simulation time.</summary>
    public readonly SimulationTime Time;

    /// <summary>Spatial grid (when enabled).</summary>
    public readonly SpatialHashGrid3D? SpatialGrid;

    /// <summary>Event sink modules raise contact and death notifications into.</summary>
    public readonly IParticleEventSink? Sink;

    /// <summary>Creates a context.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public ModuleExecutionContext(
        DeltaTime deltaTime,
        SimulationTime time,
        SpatialHashGrid3D? spatialGrid,
        IParticleEventSink? sink = null)
    {
        DeltaTime = deltaTime;
        Time = time;
        SpatialGrid = spatialGrid;
        Sink = sink;
    }
}

/// <summary>Monomorphic module policy contract.</summary>
/// <typeparam name="TSelf">Module type.</typeparam>
public interface IParticleModulePolicy<TSelf>
    where TSelf : struct, IParticleModulePolicy<TSelf>
{
    /// <summary>Module priority.</summary>
    static abstract int Priority { get; }

    /// <summary>Processes all particles.</summary>
    static abstract void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref TSelf state);
}

/// <summary>Pipeline node contract.</summary>
public interface IModulePipelineNode
{
    /// <summary>Executes this stage and the next.</summary>
    void Execute(NativeSoaParticleStorage storage, in ModuleExecutionContext context);
}

/// <summary>Terminal pipeline node.</summary>
public struct PipelineEnd : IModulePipelineNode
{
    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public void Execute(NativeSoaParticleStorage storage, in ModuleExecutionContext context)
    {
    }
}

/// <summary>Chained pipeline stage.</summary>
/// <typeparam name="TModule">Module policy.</typeparam>
/// <typeparam name="TNext">Next node.</typeparam>
public struct PipelineStage<TModule, TNext> : IModulePipelineNode
    where TModule : struct, IParticleModulePolicy<TModule>
    where TNext : struct, IModulePipelineNode
{
    /// <summary>Module state.</summary>
    public TModule ModuleState;

    /// <summary>Next stage.</summary>
    public TNext NextStage;

    /// <summary>Creates a stage.</summary>
    public PipelineStage(TModule moduleState, TNext nextStage)
    {
        ModuleState = moduleState;
        NextStage = nextStage;
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void Execute(NativeSoaParticleStorage storage, in ModuleExecutionContext context)
    {
        TModule.Process(storage, context, ref ModuleState);
        NextStage.Execute(storage, context);
    }
}
