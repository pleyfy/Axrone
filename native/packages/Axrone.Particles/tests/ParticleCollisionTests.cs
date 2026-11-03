namespace Axrone.Particles.Tests;

using Axrone.Geometry;

public sealed class ParticleCollisionTests
{
    private const float Skin = 1e-3f;

    [Fact]
    public void PlaneKillModeStillRemovesParticlesBelowSurface()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, -1f, 0f), Vec3.Zero, 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();
        storage.TryAllocate(new Vec3(0f, 5f, 0f), Vec3.Zero, 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = new();
        unsafe
        {
            CollisionModule.Process(storage, Context(), ref module);
            storage.ActiveCount.Should().Be(1);
            storage.PosY[0].Should().Be(5f);
        }
    }

    [Fact]
    public void PlaneCallbackBouncesAndRaisesTypedCollisionEvent()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, -1f, 0f), new Vec3(1f, -2f, 0f), 5f, Vec3.One, Vec4.One, out ParticleId id).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = new()
        {
            Primitive = CollisionPrimitive.Plane,
            Mode = CollisionMode.Callback,
            Plane = new PlaneCollider
            {
                Point = Vec3.Zero,
                Normal = Vec3.UnitY,
                Surface = new CollisionSurface(7u, 0.5f, 0.1f),
            },
        };

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref module);

            storage.ActiveCount.Should().Be(1);
            storage.CollisionHits[0].Should().Be(1);
            storage.PosY[0].Should().Be(0f);
            storage.VelX[0].Should().BeApproximately(0.9f, 1e-5f);
            storage.VelY[0].Should().BeApproximately(1f, 1e-5f);

            sink.Collisions.Should().ContainSingle();
            sink.Collisions[0].ParticleId.Should().Be(id);
            sink.Collisions[0].ColliderId.Should().Be(7u);
            sink.Collisions[0].Normal.Y.Should().Be(1f);
            sink.Collisions[0].Impulse.Should().BeApproximately(2f, 1e-5f);
            sink.Deaths.Should().BeEmpty();
        }
    }

    [Fact]
    public void PlaneCallbackWithoutSinkFailsClosed()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, -1f, 0f), Vec3.Zero, 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = new() { Mode = CollisionMode.Callback };

        unsafe
        {
            Action process = () => CollisionModule.Process(storage, Context(), ref module);
            process.Should().Throw<ParticleSystemException>()
                .Which.ErrorCode.Should().Be(ParticleSystemErrorCode.InvalidConfiguration);
        }
    }

    [Fact]
    public void SpherePushesParticleOutAlongContactNormal()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(1f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = CallbackSphere();

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref module);

            storage.PosX[0].Should().BeApproximately(1f, 1e-5f);
            storage.VelX[0].Should().BeApproximately(-0.5f, 1e-5f);
            storage.CollisionHits[0].Should().Be(1);
            sink.Collisions.Should().ContainSingle();
            sink.Collisions[0].Normal.X.Should().BeApproximately(1f, 1e-5f);
        }
    }

    [Fact]
    public void SphereLeavesExteriorAndGrazingParticlesUntouched()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(2f, 0f, 0f), new Vec3(-1f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();
        storage.TryAllocate(new Vec3(1f, 0.5f, 0f), new Vec3(0f, -1f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = CallbackSphere();

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref module);

            storage.ActiveCount.Should().Be(2);
            storage.CollisionHits[0].Should().Be(0);
            storage.CollisionHits[1].Should().Be(0);
            sink.Collisions.Should().BeEmpty();
        }
    }

    [Fact]
    public void SphereMinVelocityKillsSlowParticleAndRaisesCollisionDeath()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(0.05f, 0f, 0f), 5f, Vec3.One, Vec4.One, out ParticleId id).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = CallbackSphere();
        module.MinVelocity = 0.5f;

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref module);

            storage.ActiveCount.Should().Be(0);
            sink.Collisions.Should().BeEmpty();
            sink.Deaths.Should().ContainSingle();
            sink.Deaths[0].ParticleId.Should().Be(id);
            sink.Deaths[0].Reason.Should().Be(ParticleDeathReason.Collision);
        }
    }

    [Fact]
    public void SphereHitBudgetAllowsContactsUntilExhausted()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(0.2f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = CallbackSphere();
        module.MaxNumberOfHits = 2;

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref module);
            storage.ActiveCount.Should().Be(1);
            storage.CollisionHits[0].Should().Be(1);

            storage.PosX[0] = 0.5f;
            storage.VelX[0] = 0.2f;
            CollisionModule.Process(storage, Context(sink: sink), ref module);
            storage.ActiveCount.Should().Be(0);
            sink.Collisions.Should().ContainSingle();
            sink.Deaths.Should().ContainSingle();
            sink.Deaths[0].Reason.Should().Be(ParticleDeathReason.Collision);
        }
    }

    [Fact]
    public void SphereLifetimeLossShortensRemainingLifetime()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(0.2f, 0f, 0f), 4f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = CallbackSphere();
        module.LifetimeLoss = 0.5f;

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: new NullEventSink()), ref module);
            storage.Lifetime[0].Should().BeApproximately(2f, 1e-5f);
            storage.ActiveCount.Should().Be(1);
        }
    }

    [Fact]
    public void BoxPushesAlongLeastPenetrationAxis()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.9f, 0.2f, 0.1f), new Vec3(1f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = new()
        {
            Mode = CollisionMode.Callback,
            Primitive = CollisionPrimitive.Box,
            Box = new BoxCollider
            {
                Center = Vec3.Zero,
                HalfExtents = Vec3.One,
                Orientation = Quat.Identity,
                Surface = new CollisionSurface(3u, 0.5f, 0.1f),
            },
        };

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref module);

            storage.PosX[0].Should().BeApproximately(1f, 1e-5f);
            storage.PosY[0].Should().BeApproximately(0.2f, 1e-5f);
            storage.VelX[0].Should().BeApproximately(-0.5f, 1e-5f);
            sink.Collisions.Should().ContainSingle();
            sink.Collisions[0].ColliderId.Should().Be(3u);
            sink.Collisions[0].Normal.X.Should().BeApproximately(1f, 1e-5f);
        }
    }

    [Fact]
    public void BoxOrientationRotatesContactNormalToWorldSpace()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, 0.9f, 0f), new Vec3(0f, 1f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = new()
        {
            Mode = CollisionMode.Callback,
            Primitive = CollisionPrimitive.Box,
            Box = new BoxCollider
            {
                Center = Vec3.Zero,
                HalfExtents = Vec3.One,
                Orientation = Quat.CreateFromAxisAngle(Vec3.UnitZ, MathF.PI * 0.5f),
                Surface = new CollisionSurface(4u, 0.5f, 0.1f),
            },
        };

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref module);

            storage.PosY[0].Should().BeApproximately(1f, 1e-4f);
            storage.PosX[0].Should().BeApproximately(0f, 1e-4f);
            sink.Collisions.Should().ContainSingle();
            sink.Collisions[0].Normal.Y.Should().BeApproximately(1f, 1e-4f);
            sink.Collisions[0].Normal.X.Should().BeApproximately(0f, 1e-4f);
        }
    }

    [Fact]
    public void BoxExteriorParticleIsNotColliding()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(1.5f, 0f, 0f), new Vec3(1f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = new()
        {
            Mode = CollisionMode.Callback,
            Primitive = CollisionPrimitive.Box,
            Box = new BoxCollider { HalfExtents = Vec3.One, Orientation = Quat.Identity },
        };

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: new NullEventSink()), ref module);
            storage.CollisionHits[0].Should().Be(0);
            storage.PosX[0].Should().Be(1.5f);
        }
    }

    [Fact]
    public void CylinderRadialContactPushesOutward()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(1f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = CallbackCylinder();

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref module);
            storage.PosX[0].Should().BeApproximately(1f, 1e-5f);
            storage.VelX[0].Should().BeApproximately(-0.5f, 1e-5f);
            sink.Collisions[0].Normal.X.Should().BeApproximately(1f, 1e-5f);
        }
    }

    [Fact]
    public void CylinderCapContactWinsWhenAxialDepthIsSmaller()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.2f, 1.9f, 0f), new Vec3(0f, 1f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = CallbackCylinder();

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref module);
            storage.PosY[0].Should().BeApproximately(2f, 1e-5f);
            storage.VelY[0].Should().BeApproximately(-0.5f, 1e-5f);
            sink.Collisions[0].Normal.Y.Should().BeApproximately(1f, 1e-5f);
        }
    }

    [Fact]
    public void CylinderBeyondHalfHeightDoesNotCollide()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, 3f, 0f), new Vec3(0f, -1f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = CallbackCylinder();

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: new NullEventSink()), ref module);
            storage.CollisionHits[0].Should().Be(0);
            storage.PosY[0].Should().Be(3f);
        }
    }

    [Fact]
    public void MeshSweptSegmentBouncesOffTriangle()
    {
        using ParticleMeshCollider mesh = FloorCollider(1u);
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, -0.05f, 0f), new Vec3(0f, -5f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = new()
        {
            Primitive = CollisionPrimitive.Mesh,
            Mode = CollisionMode.Callback,
            Mesh = mesh,
        };

        unsafe
        {
            CollisionModule.Process(storage, Context(0.2f, sink), ref module);

            storage.PosY[0].Should().BeApproximately(Skin, 1e-5f);
            storage.VelY[0].Should().BeApproximately(2.5f, 1e-4f);
            storage.CollisionHits[0].Should().Be(1);
            sink.Collisions.Should().ContainSingle();
            sink.Collisions[0].ColliderId.Should().Be(1u);
            sink.Collisions[0].Normal.Y.Should().BeApproximately(1f, 1e-5f);
            sink.Collisions[0].Impulse.Should().BeApproximately(5f, 1e-4f);
        }
    }

    [Fact]
    public void MeshLeavesFarAndGrazingParticlesUntouched()
    {
        using ParticleMeshCollider mesh = FloorCollider(2u);
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, 0.5f, 0f), new Vec3(0f, -0.1f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();
        storage.TryAllocate(new Vec3(0f, Skin * 0.5f, 0f), new Vec3(1f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = new()
        {
            Primitive = CollisionPrimitive.Mesh,
            Mode = CollisionMode.Callback,
            Mesh = mesh,
        };

        unsafe
        {
            CollisionModule.Process(storage, Context(0.2f, sink), ref module);
            storage.ActiveCount.Should().Be(2);
            storage.CollisionHits[0].Should().Be(0);
            sink.Collisions.Should().BeEmpty();
        }
    }

    [Fact]
    public void MeshKeepsClosestHitAcrossCells()
    {
        Triangle3[] triangles =
        [
            new Triangle3(new Vec3(-1f, 1f, -1f), new Vec3(1f, 1f, -1f), new Vec3(1f, 1f, 1f)),
            new Triangle3(new Vec3(-1f, 0f, -1f), new Vec3(1f, 0f, -1f), new Vec3(1f, 0f, 1f)),
        ];

        using ParticleMeshCollider mesh = ParticleMeshCollider.Create(triangles, new CollisionSurface(9u, 0.5f, 0.1f));
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, -0.1f, 0f), new Vec3(0f, -5f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = new()
        {
            Primitive = CollisionPrimitive.Mesh,
            Mode = CollisionMode.Callback,
            Mesh = mesh,
        };

        unsafe
        {
            CollisionModule.Process(storage, Context(0.2f, sink), ref module);
            sink.Collisions.Should().ContainSingle();
            storage.PosY[0].Should().BeApproximately(Skin, 1e-4f);
        }
    }

    [Fact]
    public void MeshRejectsEmptyTriangleSet()
    {
        Action create = () => ParticleMeshCollider.Create([], new CollisionSurface()).Dispose();
        create.Should().Throw<ParticleSystemException>()
            .Which.ErrorCode.Should().Be(ParticleSystemErrorCode.InvalidConfiguration);
    }

    [Fact]
    public void MeshRejectsTriangleCountAboveBudget()
    {
        Triangle3[] triangles = new Triangle3[ParticleMeshCollider.MaxTriangles + 1];
        for (int i = 0; i < triangles.Length; i++)
        {
            float offset = i * 1e-4f;
            triangles[i] = new Triangle3(
                new Vec3(-1f + offset, 0f, -1f),
                new Vec3(1f + offset, 0f, -1f),
                new Vec3(0f + offset, 0f, 1f));
        }

        Action create = () => ParticleMeshCollider.Create(triangles, new CollisionSurface()).Dispose();
        create.Should().Throw<ParticleSystemException>()
            .Which.ErrorCode.Should().Be(ParticleSystemErrorCode.CapacityExceeded);
    }

    [Fact]
    public void MeshRejectsCellOverload()
    {
        Triangle3[] triangles = new Triangle3[ParticleMeshCollider.MaxTrianglesPerCell + 1];
        for (int i = 0; i < triangles.Length; i++)
        {
            triangles[i] = new Triangle3(new Vec3(-0.1f, 0f, -0.1f), new Vec3(0.1f, 0f, -0.1f), new Vec3(0f, 0f, 0.1f));
        }

        Action create = () => ParticleMeshCollider.Create(triangles, new CollisionSurface()).Dispose();
        create.Should().Throw<ParticleSystemException>()
            .Which.ErrorCode.Should().Be(ParticleSystemErrorCode.CapacityExceeded);
    }

    [Fact]
    public void MeshRejectsSweepSpanningTooManyCells()
    {
        Triangle3[] triangles =
        [
            new Triangle3(new Vec3(-10f, -10f, -10f), new Vec3(10f, 10f, -10f), new Vec3(10f, -10f, 10f)),
        ];

        using ParticleMeshCollider mesh = ParticleMeshCollider.Create(triangles, new CollisionSurface());
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(9f, 9f, 9f), new Vec3(90f, 90f, 90f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = new()
        {
            Primitive = CollisionPrimitive.Mesh,
            Mode = CollisionMode.Callback,
            Mesh = mesh,
        };

        unsafe
        {
            Action process = () => CollisionModule.Process(storage, Context(0.2f, new NullEventSink()), ref module);
            process.Should().Throw<ParticleSystemException>()
                .Which.ErrorCode.Should().Be(ParticleSystemErrorCode.CapacityExceeded);
        }
    }

    [Fact]
    public void MeshColliderQueriesAfterDisposeFailClosed()
    {
        ParticleMeshCollider mesh = FloorCollider(3u);
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, -0.05f, 0f), new Vec3(0f, -5f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = new()
        {
            Primitive = CollisionPrimitive.Mesh,
            Mode = CollisionMode.Callback,
            Mesh = mesh,
        };

        mesh.Dispose();

        unsafe
        {
            Action process = () => CollisionModule.Process(storage, Context(0.2f, new NullEventSink()), ref module);
            process.Should().Throw<ObjectDisposedException>();
        }
    }

    [Fact]
    public void MeshColliderExposesBroadphaseBoundsAndDirectCastResults()
    {
        using ParticleMeshCollider mesh = FloorCollider(4u);
        mesh.Bounds.Min.X.Should().BeLessThan(mesh.Bounds.Max.X);
        mesh.Surface.ColliderId.Should().Be(4u);

        mesh.TryCast(new Vec3(0f, 0.5f, 0f), new Vec3(0f, -0.5f, 0f), out PrimitiveHit hit).Should().BeTrue();
        hit.Normal.Y.Should().BeApproximately(1f, 1e-5f);
        hit.Point.Y.Should().BeApproximately(0f, 1e-5f);

        mesh.TryCast(new Vec3(5f, 5f, 5f), new Vec3(5.5f, 5f, 5f), out _).Should().BeFalse();
    }

    [Fact]
    public void HitColumnFollowsSwapWhenAnotherParticleIsKilled()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(0.2f, 0f, 0f), 5f, Vec3.One, Vec4.One, out ParticleId toucher).Should().BeTrue();
        storage.TryAllocate(new Vec3(2f, 0f, 0f), new Vec3(0.2f, 0f, 0f), 5f, Vec3.One, Vec4.One, out ParticleId outsider).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule first = CallbackSphere();
        first.MaxNumberOfHits = 1;

        unsafe
        {
            CollisionModule.Process(storage, Context(sink: sink), ref first);

            storage.ActiveCount.Should().Be(1);
            storage.DenseToId[0].Should().Be(outsider);
            storage.CollisionHits[0].Should().Be(0);

            sink.Deaths.Should().ContainSingle();
            sink.Deaths[0].ParticleId.Should().Be(toucher);
        }
    }

    [Fact]
    public void CollisionResultsAreBitIdenticalAcrossRuns()
    {
        Snapshot[] first = RunDeterministicScenario(PrimitiveKind.Sphere);
        Snapshot[] second = RunDeterministicScenario(PrimitiveKind.Sphere);
        first.Should().Equal(second);

        Snapshot[] meshFirst = RunDeterministicScenario(PrimitiveKind.Mesh);
        Snapshot[] meshSecond = RunDeterministicScenario(PrimitiveKind.Mesh);
        meshFirst.Should().Equal(meshSecond);
    }

    [Fact]
    public async Task SharedMeshColliderYieldsSameResultInParallelAsAlone()
    {
        using ParticleMeshCollider mesh = FloorCollider(11u);
        using NativeSoaParticleStorage solo = ScenarioStorage();
        Snapshot[] expected = RunFrames(solo, mesh, 4);

        using NativeSoaParticleStorage left = ScenarioStorage();
        using NativeSoaParticleStorage right = ScenarioStorage();

        Task<Snapshot[]> runLeft = Task.Run(() => RunFrames(left, mesh, 4));
        Task<Snapshot[]> runRight = Task.Run(() => RunFrames(right, mesh, 4));
        await Task.WhenAll(runLeft, runRight).WaitAsync(TimeSpan.FromSeconds(15));
        Snapshot[] leftResult = await runLeft;
        Snapshot[] rightResult = await runRight;

        rightResult.Should().Equal(expected);
        leftResult.Should().Equal(expected);
    }

    private static unsafe Snapshot[] RunFrames(NativeSoaParticleStorage storage, ParticleMeshCollider mesh, int frames)
    {
        CollisionModule module = MeshModule(mesh);
        IParticleEventSink sink = new NullEventSink();
        for (int frame = 0; frame < frames; frame++)
        {
            CollisionModule.Process(storage, Context(0.1f, sink), ref module);
        }

        return SnapshotOf(storage);
    }

    [Theory]
    [InlineData("plane")]
    [InlineData("sphere")]
    [InlineData("box")]
    [InlineData("cylinder")]
    [InlineData("mesh")]
    public void ContactResolvingPathAllocatesNothingWhenWarm(string kind)
    {
        using ParticleMeshCollider mesh = FloorCollider(1u);
        using NativeSoaParticleStorage storage = ScenarioStorage();
        CollisionModule module = Module(ParseKind(kind), mesh);
        IParticleEventSink sink = new NullEventSink();

        unsafe
        {
            for (int warm = 0; warm < 200; warm++)
            {
                Reseed(storage);
                CollisionModule.Process(storage, Context(0.1f, sink), ref module);
            }

            long before = GC.GetAllocatedBytesForCurrentThread();
            for (int frame = 0; frame < 1000; frame++)
            {
                Reseed(storage);
                CollisionModule.Process(storage, Context(0.1f, sink), ref module);
            }

            long allocated = GC.GetAllocatedBytesForCurrentThread() - before;
            allocated.Should().Be(0);
            AnyContactRecorded(storage).Should().BeTrue();
        }
    }

    [Fact]
    public unsafe void CollisionProcessAllocatesNothingForMeshPrimitive()
    {
        using ParticleMeshCollider mesh = FloorCollider(1u);
        using NativeSoaParticleStorage storage = ScenarioStorage();
        CollisionModule module = MeshModule(mesh);
        IParticleEventSink sink = new NullEventSink();

        for (int warm = 0; warm < 50; warm++)
        {
            Reseed(storage);
            CollisionModule.Process(storage, Context(0.1f, sink), ref module);
        }

        long before = GC.GetAllocatedBytesForCurrentThread();
        for (int frame = 0; frame < 500; frame++)
        {
            Reseed(storage);
            CollisionModule.Process(storage, Context(0.1f, sink), ref module);
        }

        (GC.GetAllocatedBytesForCurrentThread() - before).Should().Be(0);
        storage.CollisionHits[0].Should().BeGreaterThan(0);
    }

    [Fact]
    public unsafe void CollisionAllocationGuardDetectsAKnownAllocation()
    {
        using ParticleMeshCollider mesh = FloorCollider(1u);
        using NativeSoaParticleStorage storage = ScenarioStorage();
        CollisionModule module = MeshModule(mesh);
        IParticleEventSink sink = new NullEventSink();

        long before = GC.GetAllocatedBytesForCurrentThread();
        CollisionModule.Process(storage, Context(0.1f, sink), ref module);
        _ = new int[64];
        (GC.GetAllocatedBytesForCurrentThread() - before).Should().BeGreaterThan(0);
    }

    [Fact]
    public void HitColumnSurvivesStorageResize()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(0.2f, 0f, 0f), 5f, Vec3.One, Vec4.One, out ParticleId id).Should().BeTrue();

        CollisionModule module = CallbackSphere();
        unsafe
        {
            CollisionModule.Process(storage, Context(sink: new NullEventSink()), ref module);
            storage.CollisionHits[0].Should().Be(1);

            storage.TryResize(64).Should().BeTrue();

            storage.TryGetDenseIndex(id, out int dense).Should().BeTrue();
            storage.CollisionHits[dense].Should().Be(1);
            storage.Capacity.Should().Be(64);
        }
    }

    [Fact]
    public void SphereLifetimeLossAppliesToRemainingLifetimeWhenAged()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(0.2f, 0f, 0f), 10f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = CallbackSphere();
        module.LifetimeLoss = 0.5f;

        unsafe
        {
            storage.Age[0] = 3f;

            CollisionModule.Process(storage, Context(sink: new NullEventSink()), ref module);

            storage.Age[0].Should().Be(3f);
            storage.Lifetime[0].Should().BeApproximately(6.5f, 1e-5f);
            storage.Lifetime[0].Should().NotBe(5f);
            storage.ActiveCount.Should().Be(1);
        }
    }

    [Fact]
    public void SphereLifetimeLossOfOneEndsParticleLifetime()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(0.2f, 0f, 0f), 10f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        RecordingSink sink = new();
        CollisionModule module = CallbackSphere();
        module.LifetimeLoss = 2f;

        unsafe
        {
            storage.Age[0] = 4f;

            CollisionModule.Process(storage, Context(sink: sink), ref module);

            storage.Lifetime[0].Should().Be(4f);
            storage.ActiveCount.Should().Be(0);
            sink.Deaths.Should().ContainSingle();
            sink.Deaths[0].Reason.Should().Be(ParticleDeathReason.Collision);
        }
    }

    [Fact]
    public void DegeneratePlaneNormalFailsClosed()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(new Vec3(0f, -1f, 0f), Vec3.Zero, 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = new()
        {
            Plane = new PlaneCollider { Normal = Vec3.Zero },
        };

        unsafe
        {
            Action process = () => CollisionModule.Process(storage, Context(), ref module);
            process.Should().Throw<ParticleSystemException>()
                .Which.ErrorCode.Should().Be(ParticleSystemErrorCode.InvalidConfiguration);
        }
    }

    [Fact]
    public void MeshPrimitiveWithoutColliderFailsClosed()
    {
        using NativeSoaParticleStorage storage = new((ParticleCapacity)16);
        storage.TryAllocate(Vec3.Zero, Vec3.Zero, 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();

        CollisionModule module = new() { Primitive = CollisionPrimitive.Mesh };

        unsafe
        {
            Action process = () => CollisionModule.Process(storage, Context(), ref module);
            process.Should().Throw<ParticleSystemException>()
                .Which.ErrorCode.Should().Be(ParticleSystemErrorCode.InvalidConfiguration);
        }
    }

    private enum PrimitiveKind
    {
        Plane,
        Sphere,
        Box,
        Cylinder,
        Mesh,
    }

    private static PrimitiveKind ParseKind(string kind) => kind switch
    {
        "plane" => PrimitiveKind.Plane,
        "sphere" => PrimitiveKind.Sphere,
        "box" => PrimitiveKind.Box,
        "cylinder" => PrimitiveKind.Cylinder,
        _ => PrimitiveKind.Mesh,
    };

    [StructLayout(LayoutKind.Sequential, Pack = 4)]
    private readonly record struct Snapshot(ParticleId Id, float X, float Y, float Z, float VX, float VY, float VZ, float Lifetime, int Hits);

    private static ModuleExecutionContext Context(float dt = 0.1f, IParticleEventSink? sink = null) =>
        new(DeltaTime.FromSingle(dt), new SimulationTime(0f), null, sink);

    private static CollisionModule CallbackSphere() => new()
    {
        Primitive = CollisionPrimitive.Sphere,
        Mode = CollisionMode.Callback,
        Sphere = new SphereCollider
        {
            Center = Vec3.Zero,
            Radius = 1f,
            Surface = new CollisionSurface(5u, 0.5f, 0.1f),
        },
    };

    private static CollisionModule CallbackCylinder() => new()
    {
        Primitive = CollisionPrimitive.Cylinder,
        Mode = CollisionMode.Callback,
        Cylinder = new CylinderCollider
        {
            Center = Vec3.Zero,
            Radius = 1f,
            HalfHeight = 2f,
            Axis = Vec3.UnitY,
            Surface = new CollisionSurface(6u, 0.5f, 0.1f),
        },
    };

    private static ParticleMeshCollider FloorCollider(uint colliderId)
    {
        Triangle3[] triangles =
        [
            new Triangle3(new Vec3(-1f, 0f, -1f), new Vec3(1f, 0f, -1f), new Vec3(1f, 0f, 1f)),
            new Triangle3(new Vec3(-1f, 0f, -1f), new Vec3(1f, 0f, 1f), new Vec3(-1f, 0f, 1f)),
        ];

        return ParticleMeshCollider.Create(triangles, new CollisionSurface(colliderId, 0.5f, 0.1f));
    }

    private static CollisionModule MeshModule(ParticleMeshCollider mesh) => new()
    {
        Primitive = CollisionPrimitive.Mesh,
        Mode = CollisionMode.Callback,
        Mesh = mesh,
    };

    private static unsafe NativeSoaParticleStorage ScenarioStorage()
    {
        NativeSoaParticleStorage storage = new((ParticleCapacity)32);
        storage.TryAllocate(new Vec3(0f, -0.05f, 0f), new Vec3(0f, -5f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();
        storage.TryAllocate(new Vec3(0.5f, 0f, 0f), new Vec3(1f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();
        storage.TryAllocate(new Vec3(0.9f, 0.2f, 0.1f), new Vec3(1f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();
        storage.TryAllocate(new Vec3(0.2f, 1.9f, 0f), new Vec3(0f, 1f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();
        storage.TryAllocate(new Vec3(3f, 3f, 3f), new Vec3(0.1f, 0f, 0f), 5f, Vec3.One, Vec4.One, out _).Should().BeTrue();
        return storage;
    }

    private static CollisionModule Module(PrimitiveKind kind, ParticleMeshCollider? mesh)
    {
        CollisionModule module = kind switch
        {
            PrimitiveKind.Plane => new CollisionModule { Mode = CollisionMode.Callback },
            PrimitiveKind.Sphere => CallbackSphere(),
            PrimitiveKind.Box => new CollisionModule
            {
                Mode = CollisionMode.Callback,
                Primitive = CollisionPrimitive.Box,
                Box = new BoxCollider { HalfExtents = Vec3.One, Orientation = Quat.Identity },
            },
            PrimitiveKind.Cylinder => CallbackCylinder(),
            _ => new CollisionModule
            {
                Primitive = CollisionPrimitive.Mesh,
                Mode = CollisionMode.Callback,
                Mesh = mesh!,
            },
        };

        return module;
    }

    private static unsafe bool AnyContactRecorded(NativeSoaParticleStorage storage)
    {
        for (int i = 0; i < storage.ActiveCount; i++)
        {
            if (storage.CollisionHits[i] > 0)
            {
                return true;
            }
        }

        return false;
    }

    private static unsafe Snapshot[] SnapshotOf(NativeSoaParticleStorage storage)
    {
        Snapshot[] snapshots = new Snapshot[storage.ActiveCount];
        for (int i = 0; i < storage.ActiveCount; i++)
        {
            snapshots[i] = new Snapshot(
                storage.DenseToId[i],
                storage.PosX[i],
                storage.PosY[i],
                storage.PosZ[i],
                storage.VelX[i],
                storage.VelY[i],
                storage.VelZ[i],
                storage.Lifetime[i],
                storage.CollisionHits[i]);
        }

        Array.Sort(snapshots, static (a, b) => a.Id.CompareTo(b.Id));
        return snapshots;
    }

    private static unsafe Snapshot[] RunDeterministicScenario(PrimitiveKind kind)
    {
        using ParticleMeshCollider mesh = FloorCollider(8u);
        using NativeSoaParticleStorage storage = ScenarioStorage();
        CollisionModule module = Module(kind, mesh);
        IParticleEventSink sink = new NullEventSink();

        for (int frame = 0; frame < 8; frame++)
        {
            CollisionModule.Process(storage, Context(0.1f, sink), ref module);
        }

        return SnapshotOf(storage);
    }

    private static unsafe void Reseed(NativeSoaParticleStorage storage)
    {
        storage.PosX[0] = 0f;
        storage.PosY[0] = -0.05f;
        storage.PosZ[0] = 0f;
        storage.VelX[0] = 0f;
        storage.VelY[0] = -5f;
        storage.VelZ[0] = 0f;

        storage.PosX[1] = 0.5f;
        storage.PosY[1] = 0f;
        storage.PosZ[1] = 0f;
        storage.VelX[1] = 1f;
        storage.VelY[1] = 0f;
        storage.VelZ[1] = 0f;

        storage.PosX[2] = 0.9f;
        storage.PosY[2] = 0.2f;
        storage.PosZ[2] = 0.1f;
        storage.VelX[2] = 1f;
        storage.VelY[2] = 0f;
        storage.VelZ[2] = 0f;

        storage.PosX[3] = 0.2f;
        storage.PosY[3] = 1.9f;
        storage.PosZ[3] = 0f;
        storage.VelX[3] = 0f;
        storage.VelY[3] = 1f;
        storage.VelZ[3] = 0f;
    }

    private sealed class RecordingSink : IParticleEventSink
    {
        public List<ParticleCollisionEvent> Collisions { get; } = new();

        public List<ParticleDeathEvent> Deaths { get; } = new();

        public void OnBirth(in ParticleBirthEvent evt)
        {
        }

        public void OnDeath(in ParticleDeathEvent evt) => Deaths.Add(evt);

        public void OnCollision(in ParticleCollisionEvent evt) => Collisions.Add(evt);
    }
}
