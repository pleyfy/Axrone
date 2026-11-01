namespace Axrone.Scene.Runtime;

/// <summary>
/// Owns waypoint paths and advances <see cref="ScenePathAgent"/> components.
/// Motion is straight-line steering with yaw-limited rotation and lateral
/// avoidance against registered <see cref="Aabb3D"/> obstacles; waypoint
/// progress is stored per agent so prefab payloads stay free of runtime state.
/// </summary>
/// <remarks>
/// Agents advance in creation order with a caller-supplied delta, which keeps
/// repeated runs bit-identical. Steady-state stepping performs no allocation.
/// </remarks>
public sealed class ScenePathAgentBridge : IDisposable
{
    private const int InitialPaths = 8;

    private readonly SceneWorld _world;
    private readonly Dictionary<SceneActor, int> _agentIndex = new();
    private readonly List<PathAgent> _agents = new();
    private readonly List<Aabb3D> _obstacles = new();
    private PathEntry?[] _paths = new PathEntry?[InitialPaths];
    private uint[] _pathGenerations = new uint[InitialPaths];
    private int[] _freePaths = new int[InitialPaths];
    private int _freePathCount;
    private int _pathCount;
    private bool _disposed;

    /// <summary>Creates a path agent bridge over a scene world.</summary>
    public ScenePathAgentBridge(SceneWorld world)
    {
        ArgumentNullException.ThrowIfNull(world);
        _world = world;
    }

    /// <summary>Gets the number of tracked agents.</summary>
    public int AgentCount => _agents.Count;

    /// <summary>Gets the number of registered paths.</summary>
    public int PathCount => _pathCount - _freePathCount;

    /// <summary>Gets the number of registered obstacles.</summary>
    public int ObstacleCount => _obstacles.Count;

    /// <summary>Registers a waypoint path and returns its generation-safe handle.</summary>
    public ScenePathHandle RegisterPath(ReadOnlySpan<Vec3> waypoints)
    {
        ThrowIfDisposed();
        if (waypoints.IsEmpty)
        {
            return ScenePathHandle.Invalid;
        }

        int index = AllocatePath();
        _paths[index] = new PathEntry(waypoints);
        return new ScenePathHandle(index, _pathGenerations[index]);
    }

    /// <summary>Releases a registered path; agents referencing it become idle.</summary>
    public bool ReleasePath(ScenePathHandle handle)
    {
        ThrowIfDisposed();
        if (!TryGetPath(handle, out int index, out _))
        {
            return false;
        }

        uint generation = _pathGenerations[index] + 1;
        _pathGenerations[index] = generation == 0 ? 1 : generation;
        _paths[index] = null;

        if (_freePathCount == _freePaths.Length)
        {
            Array.Resize(ref _freePaths, _freePaths.Length * 2);
        }

        _freePaths[_freePathCount++] = index;

        for (int i = 0; i < _agents.Count; i++)
        {
            PathAgent agent = _agents[i];
            if (agent.Path == handle)
            {
                agent.Path = ScenePathHandle.Invalid;
                agent.WaypointIndex = 0;
                agent.Status = ScenePathAgentStatus.Idle;
            }
        }

        return true;
    }

    /// <summary>
    /// Registers (or replaces) the actor's path and resets progress to the
    /// component's start waypoint.
    /// </summary>
    public bool SetPath(SceneActor actor, ReadOnlySpan<Vec3> waypoints)
    {
        ThrowIfDisposed();
        if (!_world.TryGetData(actor, out ScenePathAgent component) || waypoints.IsEmpty)
        {
            return false;
        }

        ScenePathHandle path = component.Path;
        if (!TryGetPath(path, out _, out PathEntry? entry))
        {
            path = RegisterPath(waypoints);
            if (!path.IsValid)
            {
                return false;
            }

            TryGetPath(path, out _, out entry);
        }
        else
        {
            entry!.SetPoints(waypoints);
        }

        ref ScenePathAgent live = ref _world.GetData<ScenePathAgent>(actor);
        live.Path = path;

        PathAgent agent = GetOrCreateAgent(actor);
        agent.Path = path;
        agent.WaypointIndex = component.StartWaypoint < 0 ? 0 : component.StartWaypoint;
        if (agent.WaypointIndex >= entry!.Count)
        {
            agent.WaypointIndex = 0;
        }

        agent.Status = ScenePathAgentStatus.Moving;
        return true;
    }

    /// <summary>Assigns an already registered path to an actor.</summary>
    public bool TrySetPath(SceneActor actor, ScenePathHandle path, int startWaypoint = 0)
    {
        ThrowIfDisposed();
        if (startWaypoint < 0 ||
            !_world.HasData<ScenePathAgent>(actor) ||
            !TryGetPath(path, out _, out PathEntry? entry))
        {
            return false;
        }

        ref ScenePathAgent component = ref _world.GetData<ScenePathAgent>(actor);
        component.Path = path;

        PathAgent agent = GetOrCreateAgent(actor);
        agent.Path = path;
        agent.WaypointIndex = startWaypoint < entry!.Count ? startWaypoint : 0;
        agent.Status = ScenePathAgentStatus.Moving;
        return true;
    }

    /// <summary>Removes the actor's path reference and idles its agent.</summary>
    public bool ClearPath(SceneActor actor)
    {
        ThrowIfDisposed();
        if (!_world.HasData<ScenePathAgent>(actor))
        {
            return false;
        }

        ref ScenePathAgent component = ref _world.GetData<ScenePathAgent>(actor);
        component.Path = ScenePathHandle.Invalid;

        if (_agentIndex.TryGetValue(actor, out int index))
        {
            PathAgent agent = _agents[index];
            agent.Path = ScenePathHandle.Invalid;
            agent.WaypointIndex = 0;
            agent.Status = ScenePathAgentStatus.Idle;
        }

        return true;
    }

    /// <summary>Adds one axis-aligned obstacle to the avoidance set.</summary>
    public void AddObstacle(in Aabb3D obstacle)
    {
        ThrowIfDisposed();
        _obstacles.Add(obstacle);
    }

    /// <summary>Removes every avoidance obstacle.</summary>
    public void ClearObstacles()
    {
        ThrowIfDisposed();
        _obstacles.Clear();
    }

    /// <summary>Drops agents whose actor or component disappeared.</summary>
    public void Sync()
    {
        ThrowIfDisposed();

        for (int i = _agents.Count - 1; i >= 0; i--)
        {
            PathAgent agent = _agents[i];
            if (_world.TryGetData(agent.Actor, out ScenePathAgent component))
            {
                if (component.Path != agent.Path)
                {
                    agent.Path = component.Path;
                    agent.WaypointIndex = 0;
                }

                continue;
            }

            _agentIndex.Remove(agent.Actor);
            _agents.RemoveAt(i);
        }

        for (int i = 0; i < _agents.Count; i++)
        {
            _agentIndex[_agents[i].Actor] = i;
        }
    }

    /// <summary>Advances every agent by one deterministic delta.</summary>
    public void Step(float deltaSeconds)
    {
        ThrowIfDisposed();
        if (!(deltaSeconds > 0.0f))
        {
            return;
        }

        Sync();

        for (int i = 0; i < _agents.Count; i++)
        {
            PathAgent agent = _agents[i];
            if (agent.Status == ScenePathAgentStatus.Completed)
            {
                continue;
            }

            if (!_world.TryGetData(agent.Actor, out ScenePathAgent component) ||
                !component.Enabled ||
                !TryGetPath(agent.Path, out _, out PathEntry? entry) ||
                entry!.Count == 0 ||
                !_world.HasData<SceneTransform3D>(agent.Actor))
            {
                agent.Status = ScenePathAgentStatus.Idle;
                continue;
            }

            StepAgent(agent, in component, entry, deltaSeconds);
        }
    }

    /// <summary>Reads one agent's progress.</summary>
    public bool TryGetState(SceneActor actor, out ScenePathAgentState state)
    {
        state = default;
        if (!_agentIndex.TryGetValue(actor, out int index))
        {
            return false;
        }

        PathAgent agent = _agents[index];
        int count = TryGetPath(agent.Path, out _, out PathEntry? entry) ? entry!.Count : 0;
        state = new ScenePathAgentState(agent.Status, agent.WaypointIndex, count);
        return true;
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _agents.Clear();
        _agentIndex.Clear();
        _obstacles.Clear();
        _paths = new PathEntry?[InitialPaths];
        _pathGenerations = new uint[InitialPaths];
        _freePaths = new int[InitialPaths];
        _freePathCount = 0;
        _pathCount = 0;
        _disposed = true;
    }

    private void StepAgent(PathAgent agent, in ScenePathAgent component, PathEntry entry, float deltaSeconds)
    {
        ref SceneTransform3D transform = ref _world.GetData<SceneTransform3D>(agent.Actor);
        Vec3 position = transform.Position;

        ReadOnlySpan<Vec3> points = entry.Points;
        int index = agent.WaypointIndex;
        if ((uint)index >= (uint)entry.Count)
        {
            index = 0;
        }

        Vec3 target = points[index];
        Vec3 toTarget = target - position;
        float threshold = MathF.Max(0.0f, component.ArrivalThreshold);
        if (Vec3.DistanceSquared(position, target) <= threshold * threshold)
        {
            index = NextWaypoint(agent, component.Loop, entry.Count);
            if (agent.Status == ScenePathAgentStatus.Completed)
            {
                return;
            }

            target = points[index];
            toTarget = target - position;
        }

        float distance = toTarget.Length();
        if (distance <= 1e-6f)
        {
            return;
        }

        Vec3 desired = toTarget / distance;
        float speed = MathF.Max(0.0f, component.Speed);
        float lookAhead = MathF.Max(component.AvoidanceRadius, speed * deltaSeconds * 2.0f);
        Vec3 avoidance = ComputeAvoidance(position, desired, component.AvoidanceRadius, lookAhead);
        Vec3 direction = desired + avoidance;
        if (!Vec3.TryNormalize(direction, out Vec3 steered))
        {
            steered = desired;
        }

        float travel = MathF.Min(speed * deltaSeconds, distance);
        transform.SetPosition(position + (steered * travel));

        if (component.TurnRateRadians > 0.0f)
        {
            float yaw = MathF.Atan2(steered.X, steered.Z);
            Quat targetRotation = Quat.CreateFromYawPitchRoll(yaw, 0.0f, 0.0f);
            float blend = MathF.Min(1.0f, component.TurnRateRadians * deltaSeconds);
            transform.SetRotation(Quat.Normalize(Quat.Slerp(transform.Rotation, targetRotation, blend)));
        }

        agent.Status = ScenePathAgentStatus.Moving;
        agent.WaypointIndex = index;
    }

    private static int NextWaypoint(PathAgent agent, bool loop, int count)
    {
        int next = agent.WaypointIndex + 1;
        if (next < count)
        {
            agent.WaypointIndex = next;
            return next;
        }

        if (loop)
        {
            agent.WaypointIndex = 0;
            return 0;
        }

        agent.WaypointIndex = count;
        agent.Status = ScenePathAgentStatus.Completed;
        return count - 1;
    }

    private Vec3 ComputeAvoidance(in Vec3 position, in Vec3 direction, float radius, float lookAhead)
    {
        if (!(radius > 0.0f) || _obstacles.Count == 0)
        {
            return Vec3.Zero;
        }

        Vec3 push = Vec3.Zero;
        for (int i = 0; i < _obstacles.Count; i++)
        {
            Aabb3D obstacle = _obstacles[i];
            Vec3 toCenter = obstacle.Center - position;
            float forward = Vec3.Dot(toCenter, direction);
            if (forward <= 0.0f || forward > lookAhead + radius)
            {
                continue;
            }

            Vec3 lateral = toCenter - (direction * forward);
            float lateralDistance = lateral.Length();
            if (lateralDistance >= radius)
            {
                continue;
            }

            Vec3 side;
            if (lateralDistance > 1e-5f)
            {
                side = -(lateral / lateralDistance);
            }
            else
            {
                Vec3 fallback = Vec3.Cross(direction, Vec3.UnitY);
                side = Vec3.TryNormalize(fallback, out Vec3 normalized) ? normalized : Vec3.UnitX;
            }

            push += side * (1.0f - (lateralDistance / radius));
        }

        return push;
    }

    private PathAgent GetOrCreateAgent(SceneActor actor)
    {
        if (_agentIndex.TryGetValue(actor, out int index))
        {
            return _agents[index];
        }

        PathAgent agent = new(actor);
        _agentIndex[actor] = _agents.Count;
        _agents.Add(agent);
        return agent;
    }

    private bool TryGetPath(ScenePathHandle handle, out int index, [NotNullWhen(true)] out PathEntry? entry)
    {
        index = -1;
        entry = null;
        if (!handle.IsValid || handle.Slot >= _pathCount)
        {
            return false;
        }

        PathEntry? candidate = _paths[handle.Slot];
        if (candidate is null || _pathGenerations[handle.Slot] != handle.Generation)
        {
            return false;
        }

        index = handle.Slot;
        entry = candidate;
        return true;
    }

    private int AllocatePath()
    {
        if (_freePathCount > 0)
        {
            return _freePaths[--_freePathCount];
        }

        if (_pathCount == _paths.Length)
        {
            int capacity = _paths.Length * 2;
            Array.Resize(ref _paths, capacity);
            Array.Resize(ref _pathGenerations, capacity);
            Array.Resize(ref _freePaths, capacity);
        }

        int index = _pathCount++;
        _pathGenerations[index] = 1;
        return index;
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(ScenePathAgentBridge));
        }
    }

    private sealed class PathEntry
    {
        public PathEntry(ReadOnlySpan<Vec3> points)
        {
            Points = points.ToArray();
            Count = Points.Length;
        }

        public Vec3[] Points { get; private set; }

        public int Count { get; private set; }

        public void SetPoints(ReadOnlySpan<Vec3> points)
        {
            if (Points.Length < points.Length)
            {
                Points = points.ToArray();
            }
            else
            {
                points.CopyTo(Points);
            }

            Count = points.Length;
        }
    }

    private sealed class PathAgent
    {
        public PathAgent(SceneActor actor) => Actor = actor;

        public SceneActor Actor { get; }

        public ScenePathHandle Path { get; set; }

        public int WaypointIndex { get; set; }

        public ScenePathAgentStatus Status { get; set; }
    }
}
