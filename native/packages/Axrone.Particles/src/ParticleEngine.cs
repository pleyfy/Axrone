using StandardPipeline = Axrone.Particles.PipelineStage<
    Axrone.Particles.VelocityModule,
    Axrone.Particles.PipelineStage<
        Axrone.Particles.LimitVelocityModule,
        Axrone.Particles.PipelineStage<
            Axrone.Particles.ColorModule,
            Axrone.Particles.PipelineStage<
                Axrone.Particles.SizeModule,
                Axrone.Particles.PipelineStage<
                    Axrone.Particles.RotationModule,
                    Axrone.Particles.PipelineEnd>>>>>;

namespace Axrone.Particles;

/// <summary>Monomorphic particle system engine.</summary>
/// <typeparam name="TPipeline">Pipeline node type.</typeparam>
/// <typeparam name="TSink">Event sink type.</typeparam>
public sealed class ParticleSystemEngine<TPipeline, TSink> : IDisposable
    where TPipeline : struct, IModulePipelineNode
    where TSink : IParticleEventSink
{
    private readonly Lock _gate = new();

    /// <summary>Particle storage.</summary>
    public NativeSoaParticleStorage Storage { get; }

    /// <summary>Spatial grid.</summary>
    public SpatialHashGrid3D SpatialGrid { get; }

    /// <summary>Simulation space.</summary>
    public SimulationSpace SimulationSpace { get; set; }

    /// <summary>Simulation bounds.</summary>
    public ParticleBounds Bounds { get; set; }

    /// <summary>Spatial optimization flag.</summary>
    public bool EnableSpatialOptimization { get; set; } = true;

    /// <summary>Default start lifetime.</summary>
    public float StartLifetime { get; set; }

    /// <summary>Default start speed.</summary>
    public float StartSpeed { get; set; }

    /// <summary>Default start size.</summary>
    public Vec3 StartSize { get; set; }

    /// <summary>Default start color.</summary>
    public Vec4 StartColor { get; set; }

    /// <summary>Whether the system is playing.</summary>
    public bool IsPlaying { get; private set; }

    /// <summary>Whether the system is paused.</summary>
    public bool IsPaused { get; private set; }

    /// <summary>Active particle count.</summary>
    public int ParticleCount => Storage.ActiveCount;

    private TPipeline _pipeline;
    private readonly IParticleEventSink _eventSink;
    private SimulationTime _currentTime;
    private uint _nextEmitterId = 1;
    private readonly List<ParticleEmitter> _emitters = new();
    private bool _disposed;

    internal ParticleSystemEngine(
        ParticleSystemBuilder<ConfiguredPhase> builder,
        TPipeline pipeline,
        TSink eventSink)
    {
        Storage = new NativeSoaParticleStorage(builder.Capacity);
        SpatialGrid = new SpatialHashGrid3D(builder.SpatialCellSize, 4096, (int)builder.Capacity * 2);

        SimulationSpace = builder.SimulationSpace;
        Bounds = builder.Bounds;
        StartLifetime = builder.StartLifetime;
        StartSpeed = builder.StartSpeed;
        StartSize = builder.StartSize;
        StartColor = builder.StartColor;

        _pipeline = pipeline;
        _eventSink = eventSink;
        _currentTime = new SimulationTime(0f);
    }

    /// <summary>Starts simulation.</summary>
    public void Play()
    {
        IsPlaying = true;
        IsPaused = false;
    }

    /// <summary>Pauses simulation.</summary>
    public void Pause() => IsPaused = true;

    /// <summary>Stops and clears simulation.</summary>
    public void Stop()
    {
        IsPlaying = false;
        IsPaused = false;
        Storage.Clear();
        SpatialGrid.Clear();
    }

    /// <summary>Restarts simulation.</summary>
    public void Restart()
    {
        Stop();
        Play();
    }

    /// <summary>Adds an emitter.</summary>
    public uint AddEmitter(ParticleEmitter emitter)
    {
        emitter.EmitterId = _nextEmitterId++;
        _emitters.Add(emitter);
        return emitter.EmitterId;
    }

    /// <summary>Removes an emitter.</summary>
    public bool RemoveEmitter(uint emitterId)
    {
        for (int i = 0; i < _emitters.Count; i++)
        {
            if (_emitters[i].EmitterId == emitterId)
            {
                _emitters[i].Emission.Dispose();
                _emitters[i] = _emitters[_emitters.Count - 1];
                _emitters.RemoveAt(_emitters.Count - 1);
                return true;
            }
        }

        return false;
    }

    /// <summary>Emits one particle.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public ParticleId Emit(in Vec3 position, in Vec3 velocity)
    {
        if (Storage.TryAllocate(position, velocity, StartLifetime, StartSize, StartColor, out ParticleId id))
        {
            _eventSink.OnBirth(new ParticleBirthEvent(id, 0, StartLifetime));
            return id;
        }

        return ParticleId.Invalid;
    }

    /// <summary>Kills a particle.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public unsafe void KillParticle(ParticleId id)
    {
        if (Storage.TryGetDenseIndex(id, out int denseIdx))
        {
            float age = Storage.Age[denseIdx];
            float life = Storage.Lifetime[denseIdx];
            _eventSink.OnDeath(new ParticleDeathEvent(id, ParticleDeathReason.Killed, age, life));
            Storage.RemoveAtDense(denseIdx);
        }
    }

    /// <summary>Advances simulation.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void Update(DeltaTime deltaTime)
    {
        if (!IsPlaying || IsPaused)
        {
            return;
        }

        lock (_gate)
        {
            _currentTime += deltaTime;

            UpdateParticleLifetimes(deltaTime.Seconds);

            ModuleExecutionContext context = new(
                deltaTime,
                _currentTime,
                EnableSpatialOptimization ? SpatialGrid : null,
                _eventSink);
            _pipeline.Execute(Storage, context);

            EmitFromEmitters(context);

            if (EnableSpatialOptimization)
            {
                RebuildSpatialIndex();
            }
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private unsafe void UpdateParticleLifetimes(float dt)
    {
        int i = 0;
        float* ages = Storage.Age;
        float* lifetimes = Storage.Lifetime;
        float* px = Storage.PosX;
        float* py = Storage.PosY;
        float* pz = Storage.PosZ;
        ParticleId* ids = Storage.DenseToId;

        while (i < Storage.ActiveCount)
        {
            float newAge = ages[i] + dt;
            ages[i] = newAge;
            float life = lifetimes[i];
            ParticleId id = ids[i];

            if (newAge >= life)
            {
                _eventSink.OnDeath(new ParticleDeathEvent(id, ParticleDeathReason.Expired, newAge, life));
                Storage.RemoveAtDense(i);
                continue;
            }

            Vec3 pos = new(px[i], py[i], pz[i]);
            if (!Bounds.Contains(pos))
            {
                _eventSink.OnDeath(new ParticleDeathEvent(id, ParticleDeathReason.Bounds, newAge, life));
                Storage.RemoveAtDense(i);
                continue;
            }

            i++;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private void EmitFromEmitters(in ModuleExecutionContext context)
    {
        for (int e = 0; e < _emitters.Count; e++)
        {
            ParticleEmitter emitter = _emitters[e];
            if (!emitter.Enabled)
            {
                continue;
            }

            EmissionModule emission = emitter.Emission;
            EmissionModule.Process(Storage, context, ref emission);
            emitter.Emission = emission;

            ShapeModule shape = emitter.Shape;
            int pending = emission.DrainPendingEmissions();
            for (int n = 0; n < pending; n++)
            {
                shape.ComputeEmission(out Vec3 offset, out Vec3 direction);
                Vec3 pos = emitter.Position + offset;
                Vec3 vel = direction * StartSpeed;
                if (Storage.TryAllocate(pos, vel, StartLifetime, StartSize, StartColor, out ParticleId id))
                {
                    _eventSink.OnBirth(new ParticleBirthEvent(id, emitter.EmitterId, StartLifetime));
                }
            }

            emitter.Shape = shape;
            _emitters[e] = emitter;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    private unsafe void RebuildSpatialIndex()
    {
        SpatialGrid.Clear();
        int count = Storage.ActiveCount;
        float* px = Storage.PosX;
        float* py = Storage.PosY;
        float* pz = Storage.PosZ;
        ParticleId* ids = Storage.DenseToId;

        for (int i = 0; i < count; i++)
        {
            SpatialGrid.Insert(ids[i], new Vec3(px[i], py[i], pz[i]));
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        Dispose(true);
        GC.SuppressFinalize(this);
    }

    private void Dispose(bool disposing)
    {
        lock (_gate)
        {
            if (!_disposed)
            {
                if (disposing)
                {
                    for (int i = 0; i < _emitters.Count; i++)
                    {
                        _emitters[i].Emission.Dispose();
                    }

                    _emitters.Clear();
                    Storage.Dispose();
                    SpatialGrid.Dispose();
                }

                _disposed = true;
            }
        }
    }

    /// <summary>Finalizer.</summary>
    ~ParticleSystemEngine() => Dispose(false);
}

/// <summary>Standard default facade factory.</summary>
public static class ParticleSystemFactory
{
    /// <summary>Creates a default engine.</summary>
    public static ParticleSystemEngine<StandardPipeline, DelegateEventSink> CreateDefault(
        int maxParticles = 10000,
        float spatialCellSize = 10.0f)
    {
        DelegateEventSink sink = new();

        StandardPipeline pipeline = new(
            new VelocityModule(),
            new PipelineStage<LimitVelocityModule, PipelineStage<ColorModule, PipelineStage<SizeModule, PipelineStage<RotationModule, PipelineEnd>>>>(
                new LimitVelocityModule(),
                new PipelineStage<ColorModule, PipelineStage<SizeModule, PipelineStage<RotationModule, PipelineEnd>>>(
                    new ColorModule(),
                    new PipelineStage<SizeModule, PipelineStage<RotationModule, PipelineEnd>>(
                        new SizeModule(),
                        new PipelineStage<RotationModule, PipelineEnd>(
                            new RotationModule(),
                            new PipelineEnd())))));

        return ParticleSystemBuilder<UnconfiguredPhase>.Create()
            .WithCapacity((ParticleCapacity)maxParticles)
            .WithSpatialCellSize(spatialCellSize)
            .Build(pipeline, sink);
    }
}
