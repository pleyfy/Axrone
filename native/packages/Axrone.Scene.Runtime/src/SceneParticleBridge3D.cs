namespace Axrone.Scene.Runtime;

using Axrone.Particles;
using ParticlePipeline = Axrone.Particles.PipelineStage<
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

/// <summary>
/// Bridges <see cref="SceneParticleSystem"/> components into standalone
/// particle engines. The bridge owns one engine per entity, emits particles
/// from the entity's world position and exposes the dense storage streams for
/// the renderer.
/// </summary>
public sealed class SceneParticleBridge3D : IDisposable, ISceneParticleSource
{
    private readonly SceneWorld _world;
    private readonly Dictionary<SceneEntity, ParticleInstance> _byEntity = new();
    private readonly List<ParticleInstance> _instances = new();
    private bool _disposed;

    /// <summary>Creates a particle bridge over a scene world.</summary>
    public SceneParticleBridge3D(SceneWorld world)
    {
        ArgumentNullException.ThrowIfNull(world);
        _world = world;
    }

    /// <summary>Number of live particle systems.</summary>
    public int SystemCount => _instances.Count;

    /// <summary>Creates, updates and removes engines to match scene components.</summary>
    public void SyncSystems()
    {
        ThrowIfDisposed();

        var seen = new HashSet<SceneEntity>();

        foreach (SceneEntity entity in _world.Entities)
        {
            if (!_world.IsActiveInHierarchy(entity) ||
                !_world.TryGetData(entity, out SceneParticleSystem system) ||
                !system.Enabled)
            {
                continue;
            }

            seen.Add(entity);

            if (_byEntity.TryGetValue(entity, out ParticleInstance? instance))
            {
                if (instance.Engine.Storage.Capacity < system.MaxParticles)
                {
                    Remove(entity);
                    Add(entity, in system);
                }
                else
                {
                    ApplyConfig(instance, in system);
                }

                continue;
            }

            Add(entity, in system);
        }

        List<SceneEntity>? stale = null;
        foreach (SceneEntity entity in _byEntity.Keys)
        {
            if (!seen.Contains(entity))
            {
                (stale ??= []).Add(entity);
            }
        }

        if (stale is not null)
        {
            for (int i = stale.Count - 1; i >= 0; i--)
            {
                Remove(stale[i]);
            }
        }
    }

    /// <summary>Emits and advances every particle system.</summary>
    public void Step(float deltaSeconds)
    {
        ThrowIfDisposed();

        if (deltaSeconds <= 0.0f)
        {
            return;
        }

        for (int i = 0; i < _instances.Count; i++)
        {
            ParticleInstance instance = _instances[i];
            if (!_world.TryGetData(instance.Entity, out SceneParticleSystem config) || !config.Enabled)
            {
                continue;
            }

            if (config.Playing && _world.HasTransform3D)
            {
                Vec3 origin = _world.GetWorldPosition3D(instance.Entity);
                instance.EmissionAccumulator += config.EmissionRate * deltaSeconds;

                while (instance.EmissionAccumulator >= 1.0f)
                {
                    instance.EmissionAccumulator -= 1.0f;
                    EmitOne(instance, in config, in origin);
                }
            }

            instance.Engine.Update(new DeltaTime(deltaSeconds));
        }
    }

    /// <summary>Returns a render view over one system's dense storage.</summary>
    public unsafe SceneParticleSnapshot GetSnapshot(int index)
    {
        ThrowIfDisposed();

        ParticleInstance instance = _instances[index];
        NativeSoaParticleStorage storage = instance.Engine.Storage;
        int count = storage.ActiveCount;

        if (count == 0)
        {
            return new SceneParticleSnapshot(
                instance.Entity,
                0,
                [],
                [],
                [],
                [],
                [],
                [],
                [],
                []);
        }

        return new SceneParticleSnapshot(
            instance.Entity,
            count,
            new ReadOnlySpan<float>(storage.PosX, count),
            new ReadOnlySpan<float>(storage.PosY, count),
            new ReadOnlySpan<float>(storage.PosZ, count),
            new ReadOnlySpan<float>(storage.ColR, count),
            new ReadOnlySpan<float>(storage.ColG, count),
            new ReadOnlySpan<float>(storage.ColB, count),
            new ReadOnlySpan<float>(storage.ColA, count),
            new ReadOnlySpan<float>(storage.ScaleX, count));
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        for (int i = 0; i < _instances.Count; i++)
        {
            _instances[i].Engine.Dispose();
        }

        _instances.Clear();
        _byEntity.Clear();
        _disposed = true;
    }

    private void Add(SceneEntity entity, in SceneParticleSystem config)
    {
        ParticleSystemEngine<ParticlePipeline, DelegateEventSink> engine =
            ParticleSystemFactory.CreateDefault(Math.Max(1, config.MaxParticles));
        var instance = new ParticleInstance(entity, engine);
        ApplyConfig(instance, in config);
        engine.Play();

        _byEntity.Add(entity, instance);
        _instances.Add(instance);
    }

    private void Remove(SceneEntity entity)
    {
        if (!_byEntity.Remove(entity, out ParticleInstance? instance))
        {
            return;
        }

        _instances.Remove(instance);
        instance.Engine.Dispose();
    }

    private static void ApplyConfig(ParticleInstance instance, in SceneParticleSystem config)
    {
        instance.Engine.StartLifetime = MathF.Max(0.01f, config.StartLifetime);
        instance.Engine.StartSpeed = MathF.Max(0.0f, config.StartSpeed);
        instance.Engine.StartSize = new Vec3(MathF.Max(0.0f, config.StartSize));
        instance.Engine.StartColor = config.StartColor;
    }

    private static void EmitOne(
        ParticleInstance instance,
        in SceneParticleSystem config,
        in Vec3 origin)
    {
        float spread = Math.Clamp(config.Spread, 0.0f, 1.0f);
        float angle = instance.Sequence++ * 0.61803398875f * MathF.PI * 2.0f;
        var direction = new Vec3(
            MathF.Cos(angle) * spread,
            1.0f,
            MathF.Sin(angle) * spread);
        Vec3 velocity = Vec3.Normalize(direction) * config.StartSpeed;
        instance.Engine.Emit(in origin, in velocity);
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneParticleBridge3D));
        }
    }

    private sealed class ParticleInstance
    {
        public ParticleInstance(
            SceneEntity entity,
            ParticleSystemEngine<ParticlePipeline, DelegateEventSink> engine)
        {
            Entity = entity;
            Engine = engine;
        }

        public SceneEntity Entity { get; }

        public ParticleSystemEngine<ParticlePipeline, DelegateEventSink> Engine { get; }

        public float EmissionAccumulator { get; set; }

        public uint Sequence { get; set; }
    }
}
