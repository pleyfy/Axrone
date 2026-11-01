namespace Axrone.Scene.Rendering;

/// <summary>
/// Synchronizes scene light components into a reusable <see cref="LightingRig"/>
/// and resolves the frame selection. Stable actor-derived ids let the rig
/// update lights in place and remove stale entries without string keys.
/// </summary>
public sealed class SceneLightingCollector : IDisposable
{
    private const int DirectionalKind = 0;
    private const int PointKind = 1;
    private const int SpotKind = 2;
    private const int AreaKind = 3;
    private const float PrimaryDirectionalPriority = 1_000_000.0f;

    private static readonly Vec3 LocalForward = new(0.0f, 0.0f, -1.0f);

    private readonly LightingRig _rig;
    private readonly LightingFrameResolver _resolver;
    private readonly HashSet<LightId> _seen = new();
    private readonly HashSet<LightId> _active = new();
    private readonly List<LightId> _stale = new();
    private SceneAreaLightRenderItem[] _areaLights = new SceneAreaLightRenderItem[8];
    private int _areaLightCount;
    private bool _disposed;

    /// <summary>Creates a collector with a local-light budget.</summary>
    public SceneLightingCollector(int maxLocalLights = 4)
    {
        if (maxLocalLights < 0)
        {
            throw new SceneConfigurationException(
                "Lighting local-light capacity must not be negative.");
        }

        _rig = new LightingRig();
        _resolver = new LightingFrameResolver(new LightingCapacity(
            maxDirectionalLights: 1,
            maxPointLights: maxLocalLights,
            maxSpotLights: maxLocalLights,
            maxLocalLights: maxLocalLights));
    }

    /// <summary>Backing rig, exposed for diagnostics and custom feeding.</summary>
    public LightingRig Rig => _rig;

    /// <summary>World-space area lights collected for the current frame.</summary>
    public ReadOnlySpan<SceneAreaLightRenderItem> AreaLights => _areaLights.AsSpan(0, _areaLightCount);

    /// <summary>Number of area lights collected for the current frame.</summary>
    public int AreaLightCount => _areaLightCount;

    /// <summary>Whether the collector has been disposed.</summary>
    public bool IsDisposed => _disposed;

    /// <summary>Collects and resolves the frame lighting state.</summary>
    public LightingSelectionState Collect(
        SceneWorld world,
        in Vec3 cameraPosition,
        in Vec3 ambient,
        in Vec3 sky,
        in Vec3 ground)
    {
        ArgumentNullException.ThrowIfNull(world);
        ThrowIfDisposed();

        if (!world.HasTransform3D)
        {
            throw new SceneCapabilityException(
                nameof(SceneDirectionalLight),
                "the active profile has no 3D transform for lights.");
        }

        _seen.Clear();
        _areaLightCount = 0;

        foreach (SceneActor actor in world.Actors)
        {
            if (!world.IsActiveInHierarchy(actor))
            {
                continue;
            }

            int slot = actor.Slot;

            if (world.TryGetData(actor, out SceneDirectionalLight directional) && directional.Enabled)
            {
                SyncDirectional(world, actor, slot, in directional);
            }

            if (world.TryGetData(actor, out ScenePointLight point) && point.Enabled)
            {
                SyncPoint(world, actor, slot, in point);
            }

            if (world.TryGetData(actor, out SceneSpotLight spot) && spot.Enabled)
            {
                SyncSpot(world, actor, slot, in spot);
            }

            if (world.TryGetData(actor, out SceneAreaLight area) && area.Enabled)
            {
                SyncArea(world, actor, slot, in area);
            }
        }

        RemoveStale();
        SyncEnvironment(in ambient, in sky, in ground);

        return _resolver.Resolve<InfluenceScoringPolicy>(
            _rig,
            new ResolveOptions(cameraPosition));
    }

    /// <summary>Removes every light from the rig.</summary>
    public void Clear()
    {
        ThrowIfDisposed();
        _rig.Clear();
        _seen.Clear();
        _active.Clear();
        _stale.Clear();
        _areaLightCount = 0;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _rig.Dispose();
        _seen.Clear();
        _active.Clear();
        _stale.Clear();
        _areaLightCount = 0;
        _disposed = true;
    }

    private void SyncDirectional(
        SceneWorld world,
        SceneActor actor,
        int slot,
        in SceneDirectionalLight light)
    {
        LightId id = MakeId(slot, DirectionalKind);
        ulong sequence = MakeSequence(slot, DirectionalKind);
        Quat rotation = Quat.Normalize(world.GetWorldRotation3D(actor));
        Vec3 direction = rotation * LocalForward;
        LightPriority priority = light.Primary
            ? new LightPriority(PrimaryDirectionalPriority)
            : LightPriority.Zero;

        LightData data = LightData.CreateDirectional(
            id,
            sequence,
            in direction,
            in light.Color,
            in light.Ambient,
            new LightIntensity(light.Intensity),
            priority);
        Sync(in id, in data);
    }

    private void SyncPoint(
        SceneWorld world,
        SceneActor actor,
        int slot,
        in ScenePointLight light)
    {
        LightId id = MakeId(slot, PointKind);
        ulong sequence = MakeSequence(slot, PointKind);
        Vec3 position = world.GetWorldPosition3D(actor);

        LightData data = LightData.CreatePoint(
            id,
            sequence,
            in position,
            in light.Color,
            new LightIntensity(light.Intensity),
            LightPriority.Zero,
            new LightRange(light.Range),
            new AttenuationFactor(light.Attenuation));
        Sync(in id, in data);
    }

    private void SyncSpot(
        SceneWorld world,
        SceneActor actor,
        int slot,
        in SceneSpotLight light)
    {
        if (light.InnerConeAngleRadians < 0.0f ||
            light.OuterConeAngleRadians <= light.InnerConeAngleRadians ||
            light.OuterConeAngleRadians > (MathF.PI * 0.5f))
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Spot cone angles must satisfy 0 <= inner < outer <= PI/2.");
        }

        LightId id = MakeId(slot, SpotKind);
        ulong sequence = MakeSequence(slot, SpotKind);
        Vec3 position = world.GetWorldPosition3D(actor);
        Quat rotation = Quat.Normalize(world.GetWorldRotation3D(actor));
        Vec3 direction = rotation * LocalForward;
        ConeCosine inner = new(MathF.Cos(light.InnerConeAngleRadians));
        ConeCosine outer = new(MathF.Cos(light.OuterConeAngleRadians));

        LightData data = LightData.CreateSpot(
            id,
            sequence,
            in position,
            in direction,
            in light.Color,
            new LightIntensity(light.Intensity),
            LightPriority.Zero,
            new LightRange(light.Range),
            new AttenuationFactor(light.Attenuation),
            inner,
            outer);
        Sync(in id, in data);
    }

    private void SyncArea(
        SceneWorld world,
        SceneActor actor,
        int slot,
        in SceneAreaLight light)
    {
        LightId id = MakeId(slot, AreaKind);
        ulong sequence = MakeSequence(slot, AreaKind);
        Vec3 position = world.GetWorldPosition3D(actor);
        Quat rotation = Quat.Normalize(world.GetWorldRotation3D(actor));
        float footprint = 0.5f * MathF.Max(light.Size.X, light.Size.Y);
        float range = MathF.Max(light.Range, footprint);

        LightData data = LightData.CreatePoint(
            id,
            sequence,
            in position,
            in light.Color,
            new LightIntensity(light.Intensity),
            LightPriority.Zero,
            new LightRange(range),
            new AttenuationFactor(light.Attenuation));
        Sync(in id, in data);

        if (_areaLightCount == _areaLights.Length)
        {
            Array.Resize(ref _areaLights, _areaLights.Length * 2);
        }

        ref SceneAreaLightRenderItem item = ref _areaLights[_areaLightCount];
        item.Actor = actor;
        item.Shape = light.Shape;
        item.Size = light.Size;
        item.Position = position;
        item.Rotation = rotation;
        item.Color = light.Color;
        item.Intensity = light.Intensity;
        item.Range = light.Range;
        item.Attenuation = light.Attenuation;
        item.TwoSided = light.TwoSided;
        _areaLightCount++;
    }

    private void Sync(in LightId id, in LightData data)
    {
        _seen.Add(id);
        if (_active.Contains(id))
        {
            _rig.Update(in data);
            return;
        }

        _rig.Add(in data);
        _active.Add(id);
    }

    private void RemoveStale()
    {
        _stale.Clear();
        foreach (LightId id in _active)
        {
            if (!_seen.Contains(id))
            {
                _stale.Add(id);
            }
        }

        for (int i = 0; i < _stale.Count; i++)
        {
            LightId id = _stale[i];
            _rig.Remove(id);
            _active.Remove(id);
        }
    }

    private void SyncEnvironment(in Vec3 ambient, in Vec3 sky, in Vec3 ground)
    {
        LightingEnvironment current = _rig.Environment;
        if (current.Ambient == ambient && current.Sky == sky && current.Ground == ground)
        {
            return;
        }

        _rig.SetEnvironment(new LightingEnvironment(ambient, sky, ground));
    }

    // LightId zero is the lighting store's empty-slot sentinel, so the packed
    // slot/kind pair is biased by one to keep slot zero addressable.
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static LightId MakeId(int slot, int kind) =>
        new((((ulong)(uint)slot << 8) | (uint)kind) + 1UL);

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static ulong MakeSequence(int slot, int kind) =>
        ((ulong)(uint)slot << 8) | (uint)kind;

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneLightingCollector));
        }
    }
}
