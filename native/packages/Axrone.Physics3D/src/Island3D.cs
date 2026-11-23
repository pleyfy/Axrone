namespace Axrone.Physics3D;

/// <summary>Contact edge of the island graph: two bodies sharing a solved pair.</summary>
/// <param name="BodyA">First body.</param>
/// <param name="BodyB">Second body.</param>
internal readonly record struct ContactPair3D(BodyId BodyA, BodyId BodyB);

/// <summary>Joint edge of the island graph: two bodies sharing a constraint.</summary>
/// <param name="BodyA">First body.</param>
/// <param name="BodyB">Second body.</param>
internal readonly record struct JointPair3D(BodyId BodyA, BodyId BodyB);

/// <summary>Sleep tuning of one island pass.</summary>
/// <param name="DeltaTime">Step length in seconds.</param>
/// <param name="TimeToSleep">Quiet seconds before an island sleeps.</param>
/// <param name="LinearSleepTolerance">Linear speed below which a body counts as quiet.</param>
/// <param name="AngularSleepTolerance">Angular speed below which a body counts as quiet.</param>
internal readonly record struct SimulationParameters3D(
    float DeltaTime, float TimeToSleep, float LinearSleepTolerance, float AngularSleepTolerance);

/// <summary>Statically dispatched sleep policy: how long quiet lasts before rest.</summary>
internal interface ISleepPolicy3D
{
    /// <summary>Whether an island quiet for <paramref name="quietTime"/> may sleep.</summary>
    static abstract bool ShouldSleep(float quietTime, float timeToSleep);
}

/// <summary>Default policy: sleep once the quiet time reaches the threshold.</summary>
internal readonly struct DefaultSleepPolicy3D : ISleepPolicy3D
{
    /// <inheritdoc/>
    [MethodImpl(MethodImplOptions.AggressiveInlining)]
    public static bool ShouldSleep(float quietTime, float timeToSleep) => quietTime >= timeToSleep;
}

/// <summary>Island pass diagnostics.</summary>
/// <param name="Islands">Disjoint islands found in the last pass.</param>
/// <param name="SleptBodies">Bodies put to sleep so far.</param>
public readonly record struct IslandMetrics3D(int Islands, int SleptBodies);

/// <summary>
/// Island sleep solver: unions dynamic bodies linked by contacts and joints
/// into disjoint islands, tracks per-island quiet time, and sleeps islands
/// that stay quiet past the threshold. Static and kinematic bodies carry no
/// island of their own and are never unioned through, so scenery shared by
/// many bodies cannot keep them awake. A single restless body keeps its own
/// island awake, so jointed assemblies and stacks fall asleep together and
/// wake together. Union-find lives in rented buffers; nothing allocates.
/// </summary>
/// <typeparam name="TPolicy">Statically dispatched sleep policy.</typeparam>
internal sealed class IslandSolver3D<TPolicy>
    where TPolicy : struct, ISleepPolicy3D
{
    private int[] _parent = [];
    private int[] _rank = [];
    private float[] _quiet = [];
    private int _capacity;
    private int _totalSlept;

    /// <summary>Diagnostics of the last pass.</summary>
    public IslandMetrics3D Metrics { get; private set; }

    /// <summary>Runs one sleep pass over the contact and joint graph.</summary>
    [MethodImpl(MethodImplOptions.AggressiveOptimization)]
    public void UpdateSleep(
        BodyStore bodies,
        ReadOnlySpan<ContactPair3D> contacts,
        ReadOnlySpan<JointPair3D> joints,
        in SimulationParameters3D parameters)
    {
        int capacity = bodies.SlotCapacity;
        EnsureCapacity(capacity);

        for (int slot = 0; slot < capacity; slot++)
        {
            _parent[slot] = slot;
            _rank[slot] = 0;
        }

        for (int i = 0; i < contacts.Length; i++)
        {
            Union(bodies, contacts[i].BodyA, contacts[i].BodyB);
        }

        for (int i = 0; i < joints.Length; i++)
        {
            Union(bodies, joints[i].BodyA, joints[i].BodyB);
        }

        for (int slot = 0; slot < capacity; slot++)
        {
            _quiet[slot] = 0.0f;
        }

        int islands = 0;
        int slept = 0;
        for (int slot = 0; slot < capacity; slot++)
        {
            if (!bodies.IsSlotLive(slot))
            {
                continue;
            }

            BodyId bodyId = BodyId.FromIndex(slot);
            ref BodyState body = ref bodies.Slot(bodyId);
            if (body.Type != BodyType.Dynamic)
            {
                continue;
            }

            int root = Find(slot);
            if (root == slot)
            {
                islands++;
            }

            if ((body.Flags & BodyFlags.Awake) == 0)
            {
                continue;
            }

            if ((body.Flags & BodyFlags.AutoSleep) == 0)
            {
                _quiet[root] = -1.0f;
                continue;
            }

            float linear = body.LinearVelocity.LengthSquared();
            float angular = body.AngularVelocity.LengthSquared();
            if (!(linear < parameters.LinearSleepTolerance * parameters.LinearSleepTolerance &&
                angular < parameters.AngularSleepTolerance * parameters.AngularSleepTolerance))
            {
                _quiet[root] = -1.0f;
            }
        }

        for (int slot = 0; slot < capacity; slot++)
        {
            if (!bodies.IsSlotLive(slot))
            {
                continue;
            }

            BodyId bodyId = BodyId.FromIndex(slot);
            ref BodyState body = ref bodies.Slot(bodyId);
            if (body.Type != BodyType.Dynamic || (body.Flags & BodyFlags.Awake) == 0)
            {
                continue;
            }

            int root = Find(slot);
            if (_quiet[root] < 0.0f)
            {
                body.SleepTime = 0.0f;
                continue;
            }

            body.SleepTime += parameters.DeltaTime;
            if (TPolicy.ShouldSleep(body.SleepTime, parameters.TimeToSleep))
            {
                bodies.SetAwake(bodyId, false);
                slept++;
            }
        }

        Metrics = new IslandMetrics3D(islands, _totalSlept += slept);
    }

    /// <summary>Unions the islands of two dynamic bodies; dead slots and immovable supports never join.</summary>
    private void Union(BodyStore bodies, BodyId a, BodyId b)
    {
        int slotA = a.ToIndex();
        int slotB = b.ToIndex();
        if (!bodies.IsSlotLive(slotA) || !bodies.IsSlotLive(slotB))
        {
            return;
        }

        // A shared support is not a coupling: unioning through it would let one restless body pin every body on the same scenery.
        if (bodies.SlotType(slotA) != BodyType.Dynamic || bodies.SlotType(slotB) != BodyType.Dynamic)
        {
            return;
        }

        int rootA = Find(slotA);
        int rootB = Find(slotB);
        if (rootA == rootB)
        {
            return;
        }

        if (_rank[rootA] < _rank[rootB])
        {
            _parent[rootA] = rootB;
        }
        else if (_rank[rootA] > _rank[rootB])
        {
            _parent[rootB] = rootA;
        }
        else
        {
            _parent[rootB] = rootA;
            _rank[rootA]++;
        }
    }

    /// <summary>Finds the island root with path compression.</summary>
    private int Find(int slot)
    {
        int root = slot;
        while (_parent[root] != root)
        {
            root = _parent[root];
        }

        while (_parent[slot] != root)
        {
            int next = _parent[slot];
            _parent[slot] = root;
            slot = next;
        }

        return root;
    }

    /// <summary>Grows the union-find buffers to the body capacity.</summary>
    private void EnsureCapacity(int capacity)
    {
        if (capacity <= _capacity)
        {
            return;
        }

        Array.Resize(ref _parent, capacity);
        Array.Resize(ref _rank, capacity);
        Array.Resize(ref _quiet, capacity);
        _capacity = capacity;
    }
}
