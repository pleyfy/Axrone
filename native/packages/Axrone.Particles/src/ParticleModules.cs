namespace Axrone.Particles;

// 1. Texture Sheet Module (Priority 1100)
/// <summary>Sprite sheet animation module.</summary>
public struct TextureSheetModule : IParticleModulePolicy<TextureSheetModule>
{
    /// <inheritdoc/>
    public static int Priority => 1100;

    /// <summary>Tiles on X.</summary>
    public int TilesX = 1;

    /// <summary>Tiles on Y.</summary>
    public int TilesY = 1;

    /// <summary>Animation fps.</summary>
    public float AnimationFps = 30.0f;

    /// <summary>Cycle count.</summary>
    public int CycleCount = 1;

    /// <summary>Creates a module.</summary>
    public TextureSheetModule()
    {
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref TextureSheetModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);
        int count = storage.ActiveCount;
        if (count == 0)
        {
            return;
        }

        int totalTiles = Math.Max(1, state.TilesX * state.TilesY);
        float invTilesX = 1.0f / state.TilesX;
        float invTilesY = 1.0f / state.TilesY;

        float* custom3 = storage.Custom3;
        float* age = storage.Age;
        float* lifetime = storage.Lifetime;

        for (int i = 0; i < count; i++)
        {
            float normAge = age[i] / Math.Max(lifetime[i], 1e-5f);
            float frameProgress = (normAge * state.CycleCount) % 1.0f;
            int frame = (int)(frameProgress * totalTiles) % totalTiles;

            int tileX = frame % state.TilesX;
            int tileY = frame / state.TilesX;

            custom3[i] = (tileX * invTilesX) + (tileY * invTilesY * 1000.0f);
        }
    }
}

// 2. Custom Data Module (Priority 1000)
/// <summary>Custom channel module.</summary>
public struct CustomDataModule : IParticleModulePolicy<CustomDataModule>
{
    /// <inheritdoc/>
    public static int Priority => 1000;

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref CustomDataModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);
    }

    /// <summary>Sets a custom channel value.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void SetCustomChannel(NativeSoaParticleStorage storage, ParticleId id, int channel, float value)
    {
        ArgumentNullException.ThrowIfNull(storage);

        if (storage.TryGetDenseIndex(id, out int denseIdx))
        {
            switch (channel)
            {
                case 0: storage.Custom0[denseIdx] = value; break;
                case 1: storage.Custom1[denseIdx] = value; break;
                case 2: storage.Custom2[denseIdx] = value; break;
                case 3: storage.Custom3[denseIdx] = value; break;
                default: break;
            }
        }
    }
}

// 3. Lights Module (Priority 900)
/// <summary>Particle light packing module.</summary>
public struct LightsModule : IParticleModulePolicy<LightsModule>
{
    /// <inheritdoc/>
    public static int Priority => 900;

    /// <summary>Lighting mode.</summary>
    public LightingMode Mode = LightingMode.Simple;

    /// <summary>Attenuation mode.</summary>
    public LightAttenuationMode Attenuation = LightAttenuationMode.InverseSquare;

    /// <summary>Light intensity.</summary>
    public float Intensity = 1.0f;

    /// <summary>Light range.</summary>
    public float Range = 10.0f;

    /// <summary>Creates a module.</summary>
    public LightsModule()
    {
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref LightsModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);
        if (state.Mode == LightingMode.None)
        {
            return;
        }

        int count = storage.ActiveCount;
        float* custom2 = storage.Custom2;
        float packed = state.Intensity * state.Range;

        for (int i = 0; i < count; i++)
        {
            custom2[i] = packed;
        }
    }
}

// 4. Trail Module (Priority 800)
/// <summary>Particle trail history module.</summary>
public unsafe struct TrailModule : IParticleModulePolicy<TrailModule>, IDisposable
{
    /// <inheritdoc/>
    public static int Priority => 800;

    /// <summary>Trail mode.</summary>
    public TrailMode Mode = TrailMode.Ribbon;

    /// <summary>Ribbon width.</summary>
    public float RibbonWidth = 0.5f;

    /// <summary>Trail vertex.</summary>
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct TrailPoint
    {
        /// <summary>Position.</summary>
        public Vec3 Position;

        /// <summary>Color.</summary>
        public Vec4 Color;

        /// <summary>Age.</summary>
        public float Age;
    }

    private TrailPoint* _history;
    private int _historyCapacity;
    private int _pointsPerTrail;

    /// <summary>Creates a module.</summary>
    public TrailModule(int maxTrackedParticles = 512, int pointsPerTrail = 16)
    {
        _pointsPerTrail = pointsPerTrail;
        _historyCapacity = maxTrackedParticles * pointsPerTrail;
        _history = (TrailPoint*)NativeMemory.AlignedAlloc((nuint)(_historyCapacity * sizeof(TrailPoint)), 64);
        NativeMemory.Clear(_history, (nuint)(_historyCapacity * sizeof(TrailPoint)));
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref TrailModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        if (state._history == null)
        {
            return;
        }

        int count = Math.Min(storage.ActiveCount, state._historyCapacity / state._pointsPerTrail);
        float dt = context.DeltaTime.Seconds;

        for (int i = 0; i < count; i++)
        {
            int baseIdx = i * state._pointsPerTrail;

            for (int p = state._pointsPerTrail - 1; p > 0; p--)
            {
                state._history[baseIdx + p] = state._history[baseIdx + p - 1];
                state._history[baseIdx + p].Age += dt;
            }

            state._history[baseIdx] = new TrailPoint
            {
                Position = new Vec3(storage.PosX[i], storage.PosY[i], storage.PosZ[i]),
                Color = new Vec4(storage.ColR[i], storage.ColG[i], storage.ColB[i], storage.ColA[i]),
                Age = 0f,
            };
        }
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_history != null)
        {
            NativeMemory.AlignedFree(_history);
            _history = null;
        }
    }
}

// 5. Collision Module (Priority 700)
/// <summary>Primitive collision module.</summary>
public struct CollisionModule : IParticleModulePolicy<CollisionModule>
{
    private const float Epsilon = 1e-6f;

    /// <inheritdoc/>
    public static int Priority => 700;

    /// <summary>Collision primitive.</summary>
    public CollisionPrimitive Primitive = CollisionPrimitive.Plane;

    /// <summary>Collision mode.</summary>
    public CollisionMode Mode = CollisionMode.Kill;

    /// <summary>Plane collider.</summary>
    public PlaneCollider Plane = new();

    /// <summary>Sphere collider.</summary>
    public SphereCollider Sphere = new();

    /// <summary>Box collider.</summary>
    public BoxCollider Box = new();

    /// <summary>Cylinder collider.</summary>
    public CylinderCollider Cylinder = new();

    /// <summary>Mesh collider.</summary>
    public ParticleMeshCollider? Mesh;

    /// <summary>Speed below which a resolved particle is killed; zero disables the rule.</summary>
    public float MinVelocity;

    /// <summary>Per-particle contact budget; zero disables the rule.</summary>
    public int MaxNumberOfHits;

    /// <summary>Fraction of remaining lifetime removed per contact.</summary>
    public float LifetimeLoss;

    /// <summary>Creates a module.</summary>
    public CollisionModule()
    {
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref CollisionModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        if (state.Mode == CollisionMode.Ignore)
        {
            return;
        }

        if (state.Mode == CollisionMode.Callback && context.Sink is null)
        {
            ParticleThrowHelper.InvalidConfiguration("CollisionMode.Callback requires an event sink on the module context.");
        }

        switch (state.Primitive)
        {
            case CollisionPrimitive.Plane:
                RunPlane(storage, context, ref state);
                break;
            case CollisionPrimitive.Sphere:
                RunSphere(storage, context, ref state);
                break;
            case CollisionPrimitive.Box:
                RunBox(storage, context, ref state);
                break;
            case CollisionPrimitive.Cylinder:
                RunCylinder(storage, context, ref state);
                break;
            case CollisionPrimitive.Mesh:
                RunMesh(storage, context, ref state);
                break;
            default:
                ParticleThrowHelper.InvalidConfiguration($"Unsupported collision primitive {state.Primitive}.");
                break;
        }
    }

    private static unsafe void RunPlane(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref CollisionModule state)
    {
        PlaneCollider collider = state.Plane;
        Vec3 normal = PrepareNormal(collider.Normal, "Plane");
        Vec3 point = collider.Point;

        int i = 0;
        while (i < storage.ActiveCount)
        {
            Vec3 pos = new(storage.PosX[i], storage.PosY[i], storage.PosZ[i]);
            float distance = Vec3.Dot(pos - point, normal);
            if (distance < 0.0f)
            {
                if (state.Mode == CollisionMode.Kill)
                {
                    Kill(storage, context, i);
                    continue;
                }

                if (!Resolve(storage, context, ref state, i, normal, pos - (normal * distance), collider.Surface))
                {
                    i++;
                }

                continue;
            }

            i++;
        }
    }

    private static unsafe void RunSphere(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref CollisionModule state)
    {
        SphereCollider collider = state.Sphere;
        if (collider.Radius <= 0.0f)
        {
            ParticleThrowHelper.InvalidConfiguration("Sphere collider radius must be positive.");
        }

        float radiusSq = collider.Radius * collider.Radius;

        int i = 0;
        while (i < storage.ActiveCount)
        {
            Vec3 pos = new(storage.PosX[i], storage.PosY[i], storage.PosZ[i]);
            Vec3 offset = pos - collider.Center;
            float distanceSq = offset.LengthSquared();
            if (distanceSq < radiusSq)
            {
                if (state.Mode == CollisionMode.Kill)
                {
                    Kill(storage, context, i);
                    continue;
                }

                float distance = MathF.Sqrt(distanceSq);
                Vec3 normal = distance > Epsilon
                    ? offset * (1.0f / distance)
                    : OutwardFallback(storage, i);
                float depth = collider.Radius - distance;
                if (!Resolve(storage, context, ref state, i, normal, pos + (normal * depth), collider.Surface))
                {
                    i++;
                }

                continue;
            }

            i++;
        }
    }

    private static unsafe void RunBox(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref CollisionModule state)
    {
        BoxCollider collider = state.Box;
        if (collider.HalfExtents.X <= 0.0f || collider.HalfExtents.Y <= 0.0f || collider.HalfExtents.Z <= 0.0f)
        {
            ParticleThrowHelper.InvalidConfiguration("Box collider half extents must be positive.");
        }

        Quat inverse = collider.Orientation.Inverse();

        int i = 0;
        while (i < storage.ActiveCount)
        {
            Vec3 pos = new(storage.PosX[i], storage.PosY[i], storage.PosZ[i]);
            Vec3 local = Vec3.Transform(pos - collider.Center, inverse);
            Vec3 absolute = new(MathF.Abs(local.X), MathF.Abs(local.Y), MathF.Abs(local.Z));
            if (absolute.X <= collider.HalfExtents.X &&
                absolute.Y <= collider.HalfExtents.Y &&
                absolute.Z <= collider.HalfExtents.Z)
            {
                if (state.Mode == CollisionMode.Kill)
                {
                    Kill(storage, context, i);
                    continue;
                }

                float depthX = collider.HalfExtents.X - absolute.X;
                float depthY = collider.HalfExtents.Y - absolute.Y;
                float depthZ = collider.HalfExtents.Z - absolute.Z;
                Vec3 localNormal;
                float depth;
                if (depthX <= depthY && depthX <= depthZ)
                {
                    depth = depthX;
                    localNormal = new Vec3(Sign(local.X), 0.0f, 0.0f);
                }
                else if (depthY <= depthZ)
                {
                    depth = depthY;
                    localNormal = new Vec3(0.0f, Sign(local.Y), 0.0f);
                }
                else
                {
                    depth = depthZ;
                    localNormal = new Vec3(0.0f, 0.0f, Sign(local.Z));
                }

                Vec3 normal = Vec3.Normalize(Vec3.Transform(localNormal, collider.Orientation));
                if (!Resolve(storage, context, ref state, i, normal, pos + (normal * depth), collider.Surface))
                {
                    i++;
                }

                continue;
            }

            i++;
        }
    }

    private static unsafe void RunCylinder(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref CollisionModule state)
    {
        CylinderCollider collider = state.Cylinder;
        if (collider.Radius <= 0.0f || collider.HalfHeight <= 0.0f)
        {
            ParticleThrowHelper.InvalidConfiguration("Cylinder collider radius and half height must be positive.");
        }

        Vec3 axis = PrepareNormal(collider.Axis, "Cylinder");

        int i = 0;
        while (i < storage.ActiveCount)
        {
            Vec3 pos = new(storage.PosX[i], storage.PosY[i], storage.PosZ[i]);
            Vec3 relative = pos - collider.Center;
            float axial = Vec3.Dot(relative, axis);
            float capDepth = collider.HalfHeight - MathF.Abs(axial);
            if (capDepth > 0.0f)
            {
                Vec3 radial = relative - (axis * axial);
                float radialSq = radial.LengthSquared();
                if (radialSq < collider.Radius * collider.Radius)
                {
                    if (state.Mode == CollisionMode.Kill)
                    {
                        Kill(storage, context, i);
                        continue;
                    }

                    float radialDistance = MathF.Sqrt(radialSq);
                    float radialDepth = collider.Radius - radialDistance;
                    Vec3 normal;
                    float depth;
                    if (radialDepth <= capDepth)
                    {
                        depth = radialDepth;
                        normal = radialDistance > Epsilon
                            ? radial * (1.0f / radialDistance)
                            : OutwardFallback(storage, i);
                    }
                    else
                    {
                        depth = capDepth;
                        normal = axis * Sign(axial);
                    }

                    if (!Resolve(storage, context, ref state, i, normal, pos + (normal * depth), collider.Surface))
                    {
                        i++;
                    }

                    continue;
                }
            }

            i++;
        }
    }

    private static unsafe void RunMesh(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref CollisionModule state)
    {
        ParticleMeshCollider? mesh = state.Mesh;
        if (mesh is null)
        {
            ParticleThrowHelper.InvalidConfiguration("Mesh primitive requires an assigned ParticleMeshCollider.");
        }

        CollisionSurface surface = mesh!.Surface;
        float dt = context.DeltaTime.Seconds;

        int i = 0;
        while (i < storage.ActiveCount)
        {
            Vec3 pos = new(storage.PosX[i], storage.PosY[i], storage.PosZ[i]);
            Vec3 velocity = new(storage.VelX[i], storage.VelY[i], storage.VelZ[i]);
            Vec3 from = pos - (velocity * dt);
            if (mesh.TryCast(from, pos, out PrimitiveHit hit))
            {
                if (state.Mode == CollisionMode.Kill)
                {
                    Kill(storage, context, i);
                    continue;
                }

                Vec3 resolved = hit.Point + (hit.Normal * 1e-3f);
                if (!Resolve(storage, context, ref state, i, hit.Normal, resolved, surface))
                {
                    i++;
                }

                continue;
            }

            i++;
        }
    }

    private static Vec3 PrepareNormal(Vec3 value, string label)
    {
        float lengthSq = value.LengthSquared();
        if (lengthSq < Epsilon)
        {
            ParticleThrowHelper.InvalidConfiguration($"{label} collider orientation is degenerate.");
        }

        return value * (1.0f / MathF.Sqrt(lengthSq));
    }

    private static unsafe Vec3 OutwardFallback(NativeSoaParticleStorage storage, int index)
    {
        Vec3 velocity = new(storage.VelX[index], storage.VelY[index], storage.VelZ[index]);
        float speedSq = velocity.LengthSquared();
        if (speedSq > Epsilon)
        {
            return velocity * (-1.0f / MathF.Sqrt(speedSq));
        }

        return Vec3.UnitY;
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float Sign(float value) => value >= 0.0f ? 1.0f : -1.0f;

    private static unsafe bool Resolve(
        NativeSoaParticleStorage storage,
        in ModuleExecutionContext context,
        ref CollisionModule state,
        int index,
        in Vec3 normal,
        in Vec3 resolvedPosition,
        in CollisionSurface surface)
    {
        Vec3 velocity = new(storage.VelX[index], storage.VelY[index], storage.VelZ[index]);
        float approach = MathF.Abs(Vec3.Dot(velocity, normal));
        ParticleId id = storage.DenseToId[index];

        Vec3 normalComponent = normal * Vec3.Dot(velocity, normal);
        Vec3 tangent = velocity - normalComponent;
        Vec3 reflected = (tangent * (1.0f - surface.Dampen)) - (normalComponent * surface.Bounce);

        storage.PosX[index] = resolvedPosition.X;
        storage.PosY[index] = resolvedPosition.Y;
        storage.PosZ[index] = resolvedPosition.Z;

        int hits = ++storage.CollisionHits[index];
        float lifetime = storage.Lifetime[index];
        if (state.LifetimeLoss > 0.0f)
        {
            lifetime *= MathF.Max(0.0f, 1.0f - state.LifetimeLoss);
            storage.Lifetime[index] = lifetime;
        }

        float speed = reflected.Length();
        bool budgetExhausted = state.MaxNumberOfHits > 0 && hits >= state.MaxNumberOfHits;
        bool tooSlow = state.MinVelocity > 0.0f && speed < state.MinVelocity;
        float age = storage.Age[index];
        if (budgetExhausted || tooSlow || lifetime <= age)
        {
            context.Sink?.OnDeath(new ParticleDeathEvent(id, ParticleDeathReason.Collision, age, lifetime));
            storage.RemoveAtDense(index);
            return true;
        }

        storage.VelX[index] = reflected.X;
        storage.VelY[index] = reflected.Y;
        storage.VelZ[index] = reflected.Z;

        context.Sink!.OnCollision(new ParticleCollisionEvent(id, surface.ColliderId, normal, approach));
        return false;
    }

    private static unsafe void Kill(NativeSoaParticleStorage storage, in ModuleExecutionContext context, int index)
    {
        ParticleId id = storage.DenseToId[index];
        context.Sink?.OnDeath(new ParticleDeathEvent(id, ParticleDeathReason.Collision, storage.Age[index], storage.Lifetime[index]));
        storage.RemoveAtDense(index);
    }
}

// 6. Noise Module (Priority 600)
/// <summary>Hash noise turbulence module.</summary>
public struct NoiseModule : IParticleModulePolicy<NoiseModule>
{
    /// <inheritdoc/>
    public static int Priority => 600;

    /// <summary>Noise type.</summary>
    public NoiseType Type = NoiseType.Perlin;

    /// <summary>Frequency.</summary>
    public float Frequency = 0.1f;

    /// <summary>Amplitude.</summary>
    public float Amplitude = 1.0f;

    /// <summary>Animation speed.</summary>
    public float AnimationSpeed = 0.5f;

    private float _timeAccum;

    /// <summary>Creates a module.</summary>
    public NoiseModule()
    {
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref NoiseModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        state._timeAccum += context.DeltaTime.Seconds * state.AnimationSpeed;
        float dt = context.DeltaTime.Seconds;
        float amp = state.Amplitude;
        float freq = state.Frequency;
        float time = state._timeAccum;
        int count = storage.ActiveCount;

        float* px = storage.PosX;
        float* py = storage.PosY;
        float* pz = storage.PosZ;
        float* vx = storage.VelX;
        float* vy = storage.VelY;
        float* vz = storage.VelZ;

        for (int i = 0; i < count; i++)
        {
            float x = px[i] * freq;
            float y = py[i] * freq;
            float z = pz[i] * freq;

            float nx = FastHarmonicNoise(x, y, time);
            float ny = FastHarmonicNoise(y, z, time + 13.37f);
            float nz = FastHarmonicNoise(z, x, time + 27.89f);

            vx[i] += nx * amp * dt;
            vy[i] += ny * amp * dt;
            vz[i] += nz * amp * dt;
        }
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private static float FastHarmonicNoise(float x, float y, float z)
    {
        int ix = (int)MathF.Floor(x);
        int iy = (int)MathF.Floor(y);
        int iz = (int)MathF.Floor(z);
        float fx = x - ix;
        float fy = y - iy;
        float fz = z - iz;

        uint h0 = ((uint)ix * 73856093u) ^ ((uint)iy * 19349663u) ^ ((uint)iz * 83492791u);
        uint h1 = ((uint)(ix + 1) * 73856093u) ^ ((uint)iy * 19349663u) ^ ((uint)iz * 83492791u);

        float s0 = ((h0 & 0xFFFF) / 32768.0f) - 1.0f;
        float s1 = ((h1 & 0xFFFF) / 32768.0f) - 1.0f;

        return MathF.Sin(MathF.FusedMultiplyAdd(fx, s1 - s0, s0) + fy + fz);
    }
}

// 7. Rotation Module (Priority 500)
/// <summary>Angular rotation module.</summary>
public struct RotationModule : IParticleModulePolicy<RotationModule>
{
    /// <inheritdoc/>
    public static int Priority => 500;

    /// <summary>Angular drag.</summary>
    public Vec3 AngularDrag = new(0.1f, 0.1f, 0.1f);

    /// <summary>Creates a module.</summary>
    public RotationModule()
    {
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref RotationModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        int count = storage.ActiveCount;
        float dt = context.DeltaTime.Seconds;

        float* rx = storage.RotX;
        float* ry = storage.RotY;
        float* rz = storage.RotZ;

        float* wx = storage.AngVelX;
        float* wy = storage.AngVelY;
        float* wz = storage.AngVelZ;

        float dragX = Math.Clamp(1.0f - (state.AngularDrag.X * dt), 0.0f, 1.0f);
        float dragY = Math.Clamp(1.0f - (state.AngularDrag.Y * dt), 0.0f, 1.0f);
        float dragZ = Math.Clamp(1.0f - (state.AngularDrag.Z * dt), 0.0f, 1.0f);

        for (int i = 0; i < count; i++)
        {
            rx[i] += wx[i] * dt;
            ry[i] += wy[i] * dt;
            rz[i] += wz[i] * dt;

            wx[i] *= dragX;
            wy[i] *= dragY;
            wz[i] *= dragZ;
        }
    }
}

// 8. Size Module (Priority 400)
// CA1001: false positive on generic types. SizeModule does implement
// IDisposable (Dispose below forwards to the curve), but the analyzer
// does not resolve the IDisposable constraint on a generic type
// declaration, so it reports the disposable curve field as undisposed.
#pragma warning disable CA1001

/// <summary>Curve-driven size module.</summary>
public struct SizeModule : IParticleModulePolicy<SizeModule>, IDisposable
{
    /// <inheritdoc/>
    public static int Priority => 400;

    /// <summary>Size curve.</summary>
    public Curve SizeCurve = new(CurveMode.Constant, 1.0f);

    /// <summary>Creates a module.</summary>
    public SizeModule()
    {
    }

    /// <inheritdoc/>
    public void Dispose() => SizeCurve.Dispose();

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref SizeModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        int count = storage.ActiveCount;
        float* sx = storage.ScaleX;
        float* sy = storage.ScaleY;
        float* sz = storage.ScaleZ;
        float* age = storage.Age;
        float* life = storage.Lifetime;

        for (int i = 0; i < count; i++)
        {
            float normAge = age[i] / Math.Max(life[i], 1e-5f);
            float s = state.SizeCurve.Evaluate(normAge);
            sx[i] = s;
            sy[i] = s;
            sz[i] = s;
        }
    }
}
#pragma warning restore CA1001

// CA1001: false positive on generic types. ColorModule does implement
// IDisposable (Dispose below forwards to the gradient), but the analyzer
// does not resolve the IDisposable constraint on a generic type
// declaration, so it reports the disposable gradient field as undisposed.
#pragma warning disable CA1001

// 9. Color Module (Priority 300)
/// <summary>Gradient-driven color module.</summary>
public struct ColorModule : IParticleModulePolicy<ColorModule>, IDisposable
{
    /// <inheritdoc/>
    public static int Priority => 300;

    /// <summary>Color gradient.</summary>
    public Gradient ColorGradient = new(GradientMode.Color);

    /// <summary>Creates a module.</summary>
    public ColorModule()
    {
    }

    /// <inheritdoc/>
    public void Dispose() => ColorGradient.Dispose();

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref ColorModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        int count = storage.ActiveCount;
        float* cr = storage.ColR;
        float* cg = storage.ColG;
        float* cb = storage.ColB;
        float* ca = storage.ColA;
        float* age = storage.Age;
        float* life = storage.Lifetime;

        for (int i = 0; i < count; i++)
        {
            float normAge = age[i] / Math.Max(life[i], 1e-5f);
            Vec4 col = state.ColorGradient.Evaluate(normAge);
            cr[i] = col.X;
            cg[i] = col.Y;
            cb[i] = col.Z;
            ca[i] = col.W;
        }
    }
}
#pragma warning restore CA1001

// 10. Limit Velocity Module (Priority 300)
/// <summary>Speed limit module.</summary>
public struct LimitVelocityModule : IParticleModulePolicy<LimitVelocityModule>
{
    /// <inheritdoc/>
    public static int Priority => 300;

    /// <summary>Maximum speed.</summary>
    public float MaxSpeed = 100.0f;

    /// <summary>Dampen ratio.</summary>
    public float Dampen = 0.5f;

    /// <summary>Creates a module.</summary>
    public LimitVelocityModule()
    {
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref LimitVelocityModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        int count = storage.ActiveCount;
        float maxSpdSq = state.MaxSpeed * state.MaxSpeed;
        float dt = context.DeltaTime.Seconds;

        float* vx = storage.VelX;
        float* vy = storage.VelY;
        float* vz = storage.VelZ;

        for (int i = 0; i < count; i++)
        {
            float sq = MathF.FusedMultiplyAdd(vx[i], vx[i], MathF.FusedMultiplyAdd(vy[i], vy[i], vz[i] * vz[i]));
            if (sq > maxSpdSq)
            {
                float speed = MathF.Sqrt(sq);
                float newSpeed = speed - ((speed - state.MaxSpeed) * state.Dampen * dt);
                float scale = newSpeed / speed;
                vx[i] *= scale;
                vy[i] *= scale;
                vz[i] *= scale;
            }
        }
    }
}

// 11. Velocity Module (Priority 200)
/// <summary>Euler integration module with gravity and damping.</summary>
public struct VelocityModule : IParticleModulePolicy<VelocityModule>
{
    /// <inheritdoc/>
    public static int Priority => 200;

    /// <summary>Gravity.</summary>
    public Vec3 Gravity = new(0f, -9.81f, 0f);

    /// <summary>Damping.</summary>
    public float Damping = 0.0f;

    /// <summary>Creates a module.</summary>
    public VelocityModule()
    {
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref VelocityModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        int count = storage.ActiveCount;
        if (count == 0)
        {
            return;
        }

        float dt = context.DeltaTime.Seconds;
        float halfDtSq = 0.5f * dt * dt;
        float dampFactor = Math.Clamp(1.0f - (state.Damping * dt), 0.0f, 1.0f);

        float* px = storage.PosX;
        float* py = storage.PosY;
        float* pz = storage.PosZ;

        float* vx = storage.VelX;
        float* vy = storage.VelY;
        float* vz = storage.VelZ;

        float* ax = storage.AccX;
        float* ay = storage.AccY;
        float* az = storage.AccZ;

        Vec3 g = state.Gravity;
        int vectorSpan = Vector<float>.Count;
        int i = 0;

        if (Vector.IsHardwareAccelerated && count >= vectorSpan)
        {
            Vector<float> vDt = new(dt);
            Vector<float> vHalfDtSq = new(halfDtSq);
            Vector<float> vGx = new(g.X);
            Vector<float> vGy = new(g.Y);
            Vector<float> vGz = new(g.Z);
            Vector<float> vDamp = new(dampFactor);

            int limit = count - vectorSpan;
            for (; i <= limit; i += vectorSpan)
            {
                Vector<float> totalAx = Vector.Load(ax + i) + vGx;
                Vector<float> totalAy = Vector.Load(ay + i) + vGy;
                Vector<float> totalAz = Vector.Load(az + i) + vGz;

                Vector<float> curVx = Vector.Load(vx + i);
                Vector<float> curVy = Vector.Load(vy + i);
                Vector<float> curVz = Vector.Load(vz + i);

                Vector<float> curPx = Vector.Load(px + i) + (curVx * vDt) + (totalAx * vHalfDtSq);
                Vector<float> curPy = Vector.Load(py + i) + (curVy * vDt) + (totalAy * vHalfDtSq);
                Vector<float> curPz = Vector.Load(pz + i) + (curVz * vDt) + (totalAz * vHalfDtSq);

                curPx.Store(px + i);
                curPy.Store(py + i);
                curPz.Store(pz + i);

                curVx = (curVx + (totalAx * vDt)) * vDamp;
                curVy = (curVy + (totalAy * vDt)) * vDamp;
                curVz = (curVz + (totalAz * vDt)) * vDamp;

                curVx.Store(vx + i);
                curVy.Store(vy + i);
                curVz.Store(vz + i);
            }
        }

        for (; i < count; i++)
        {
            float totalAx = ax[i] + g.X;
            float totalAy = ay[i] + g.Y;
            float totalAz = az[i] + g.Z;

            px[i] += (vx[i] * dt) + (totalAx * halfDtSq);
            py[i] += (vy[i] * dt) + (totalAy * halfDtSq);
            pz[i] += (vz[i] * dt) + (totalAz * halfDtSq);

            vx[i] = (vx[i] + (totalAx * dt)) * dampFactor;
            vy[i] = (vy[i] + (totalAy * dt)) * dampFactor;
            vz[i] = (vz[i] + (totalAz * dt)) * dampFactor;
        }
    }
}

// 12. Force Module (Priority 150)
/// <summary>Force field module.</summary>
public struct ForceModule : IParticleModulePolicy<ForceModule>
{
    /// <inheritdoc/>
    public static int Priority => 150;

    /// <summary>Force definition.</summary>
    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    public struct ParticleForce
    {
        /// <summary>Force type.</summary>
        public ForceType Type;

        /// <summary>Falloff mode.</summary>
        public FalloffMode Falloff;

        /// <summary>Force position.</summary>
        public Vec3 Position;

        /// <summary>Force direction.</summary>
        public Vec3 Direction;

        /// <summary>Strength.</summary>
        public float Strength;

        /// <summary>Enabled flag.</summary>
        public bool Enabled;
    }

    private readonly ParticleForce[] _forces = new ParticleForce[8];
    private int _forceCount;

    /// <summary>Creates a module.</summary>
    public ForceModule()
    {
    }

    /// <summary>Adds a force.</summary>
    public void AddForce(in ParticleForce force)
    {
        if (_forceCount < _forces.Length)
        {
            _forces[_forceCount++] = force;
        }
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static unsafe void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref ForceModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        if (state._forceCount == 0)
        {
            return;
        }

        int count = storage.ActiveCount;
        float dt = context.DeltaTime.Seconds;

        float* px = storage.PosX;
        float* py = storage.PosY;
        float* pz = storage.PosZ;

        float* vx = storage.VelX;
        float* vy = storage.VelY;
        float* vz = storage.VelZ;

        for (int i = 0; i < count; i++)
        {
            Vec3 pPos = new(px[i], py[i], pz[i]);
            Vec3 totalAcc = Vec3.Zero;

            for (int f = 0; f < state._forceCount; f++)
            {
                ref readonly ParticleForce force = ref state._forces[f];
                if (!force.Enabled)
                {
                    continue;
                }

                Vec3 dir = force.Type == ForceType.Directional ? force.Direction : force.Position - pPos;
                float dist = dir.LengthSquared();
                if (dist > 1e-8f)
                {
                    dist = MathF.Sqrt(dist);
                    float att = force.Falloff switch
                    {
                        FalloffMode.Linear => Math.Max(0f, 1.0f - (dist / 50.0f)),
                        FalloffMode.Quadratic => 1.0f / (1.0f + (dist * dist)),
                        _ => 1.0f,
                    };
                    totalAcc += (dir / dist) * (force.Strength * att);
                }
            }

            vx[i] += totalAcc.X * dt;
            vy[i] += totalAcc.Y * dt;
            vz[i] += totalAcc.Z * dt;
        }
    }
}

// 13. Emission Module (Priority 100)
// CA1001: false positive on generic types (see size/color modules above).
#pragma warning disable CA1001

/// <summary>Emission rate module.</summary>
public struct EmissionModule : IParticleModulePolicy<EmissionModule>, IDisposable
{
    /// <inheritdoc/>
    public static int Priority => 100;

    /// <summary>Rate over time.</summary>
    public Curve RateOverTime = new(CurveMode.Constant, 10.0f);

    /// <summary>Emission duration.</summary>
    public float Duration = 5.0f;

    /// <summary>Looping flag.</summary>
    public bool Looping = true;

    private float _emissionTimer;
    private float _emittedFraction;

    /// <summary>Creates a module.</summary>
    public EmissionModule()
    {
    }

    /// <inheritdoc/>
    public void Dispose() => RateOverTime.Dispose();

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public static void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref EmissionModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);

        state._emissionTimer += context.DeltaTime.Seconds;
        if (state._emissionTimer > state.Duration && !state.Looping)
        {
            return;
        }

        float normTime = (state._emissionTimer % Math.Max(state.Duration, 1e-4f)) / state.Duration;
        float rate = state.RateOverTime.Evaluate(normTime);

        // Accumulate only; the coordination facade drains via DrainPendingEmissions.
        state._emittedFraction += rate * context.DeltaTime.Seconds;
    }

    /// <summary>Drains pending emissions.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public int DrainPendingEmissions()
    {
        int emit = (int)_emittedFraction;
        _emittedFraction -= emit;
        return emit;
    }
}
#pragma warning restore CA1001

// 14. Shape Module (Priority 50)
/// <summary>Emitter shape module.</summary>
public struct ShapeModule : IParticleModulePolicy<ShapeModule>
{
    /// <inheritdoc/>
    public static int Priority => 50;

    /// <summary>Emitter shape.</summary>
    public EmitterShape Shape = EmitterShape.Sphere;

    /// <summary>Shape radius.</summary>
    public float Radius = 1.0f;

    /// <summary>Box extents.</summary>
    public Vec3 BoxExtents = Vec3.One;

    /// <summary>Cone angle.</summary>
    public float ConeAngle = 0.5f;

    private uint _rngState = 1337;

    /// <summary>Creates a module.</summary>
    public ShapeModule()
    {
    }

    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    private float NextFloat()
    {
        _rngState = (_rngState * 1664525u) + 1013904223u;
        return (_rngState & 0x00FFFFFF) / 16777216.0f;
    }

    /// <summary>Computes an emission position and direction.</summary>
    [MethodImpl(MethodImplOptions.AggressiveInlining | MethodImplOptions.AggressiveOptimization)]
    public void ComputeEmission(out Vec3 position, out Vec3 direction)
    {
        switch (Shape)
        {
            case EmitterShape.Sphere:
                {
                    float u = NextFloat();
                    float v = NextFloat();
                    float theta = u * 2.0f * MathF.PI;
                    float phi = MathF.Acos((2.0f * v) - 1.0f);
                    float r = MathF.Cbrt(NextFloat()) * Radius;
                    float sinPhi = MathF.Sin(phi);

                    direction = new Vec3(sinPhi * MathF.Cos(theta), sinPhi * MathF.Sin(theta), MathF.Cos(phi));
                    position = direction * r;
                    break;
                }

            case EmitterShape.Hemisphere:
                {
                    float u = NextFloat();
                    float v = NextFloat();
                    float theta = u * 2.0f * MathF.PI;
                    float phi = MathF.Acos(v);
                    float r = MathF.Cbrt(NextFloat()) * Radius;
                    float sinPhi = MathF.Sin(phi);

                    direction = new Vec3(sinPhi * MathF.Cos(theta), MathF.Abs(MathF.Cos(phi)), sinPhi * MathF.Sin(theta));
                    position = direction * r;
                    break;
                }

            case EmitterShape.Cone:
                {
                    float theta = NextFloat() * 2.0f * MathF.PI;
                    float r = NextFloat() * Radius;
                    position = new Vec3(r * MathF.Cos(theta), 0.0f, r * MathF.Sin(theta));
                    direction = new Vec3(MathF.Sin(ConeAngle) * MathF.Cos(theta), MathF.Cos(ConeAngle), MathF.Sin(ConeAngle) * MathF.Sin(theta));
                    direction = Vec3.Normalize(direction);
                    break;
                }

            case EmitterShape.Box:
                {
                    position = new Vec3(
                        (NextFloat() - 0.5f) * BoxExtents.X * 2.0f,
                        (NextFloat() - 0.5f) * BoxExtents.Y * 2.0f,
                        (NextFloat() - 0.5f) * BoxExtents.Z * 2.0f);
                    direction = Vec3.UnitY;
                    break;
                }

            default:
                {
                    position = Vec3.Zero;
                    direction = Vec3.UnitY;
                    break;
                }
        }
    }

    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static void Process(NativeSoaParticleStorage storage, in ModuleExecutionContext context, ref ShapeModule state)
    {
        ArgumentNullException.ThrowIfNull(storage);
    }
}
