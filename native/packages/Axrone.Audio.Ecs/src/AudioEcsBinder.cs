namespace Axrone.Audio.Ecs;

using Axrone.Audio;
using Axrone.Ecs;

/// <summary>
/// One failed command: entity, command kind and the error.
/// The queue keeps draining after failures.
/// </summary>
public readonly record struct AudioBinderFailure(
    Entity Entity,
    AudioSourceCommandType Command,
    Exception Error);

/// <summary>
/// ECS audio binder: tracks linked entities, upserts their definitions every
/// frame so tuning edits propagate, drains per-entity command queues with
/// failure capture, syncs playback state back into components and pushes
/// fresh spatialization into live voices. Mirrors the web binder contract;
/// listener transforms arrive with the Scene round.
/// </summary>
public sealed class AudioEcsBinder : IDisposable
{
    private const int QueueCapacity = 32;

    private readonly struct CommandQueue
    {
        public readonly AudioSourceCommand[] Ring;
        public readonly int Head;
        public readonly int Tail;
        public readonly int Count;

        public CommandQueue(AudioSourceCommand[] ring, int head, int tail, int count)
        {
            Ring = ring;
            Head = head;
            Tail = tail;
            Count = count;
        }
    }

    private readonly AudioSystem _system;
    private readonly World _world;
    private readonly Dictionary<Entity, CommandQueue> _queues = new();
    private readonly Dictionary<Entity, AudioSourceId> _sourceIds = new();
    private readonly Dictionary<Entity, AudioListenerId> _listenerIds = new();
    private readonly HashSet<Entity> _autoplayed = new();
    private readonly Lock _gate = new();
    private int _disposed;

    /// <summary>Creates a binder.</summary>
    public AudioEcsBinder(AudioSystem system, World world)
    {
        ArgumentNullException.ThrowIfNull(system);
        ArgumentNullException.ThrowIfNull(world);
        _system = system;
        _world = world;
    }

    /// <summary>Tracks a source entity; autoplays when its tuning requests it.</summary>
    public void AttachSource(Entity entity)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            if (!_world.HasComponent<AudioSourceRef>(entity))
            {
                return;
            }

            _sourceIds[entity] = _world.GetComponent<AudioSourceRef>(entity).SourceId;
            if (_autoplayed.Add(entity) && _world.GetComponent<AudioSourceRef>(entity).Autoplay)
            {
                EnqueueLocked(entity, new AudioSourceCommand(AudioSourceCommandType.Play, default));
            }
        }
    }

    /// <summary>
    /// Untracks a source entity and removes its registry entry, so a detached
    /// entity cannot leave a registered source or a live voice behind.
    /// </summary>
    public void DetachSource(Entity entity)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            if (_sourceIds.Remove(entity, out AudioSourceId id))
            {
                _system.Sources.RemoveSource(id);
            }

            _queues.Remove(entity);
            _autoplayed.Remove(entity);
        }
    }

    /// <summary>Queues a play command for an entity.</summary>
    public void Play(Entity entity, in AudioSourcePlayRequest request = default) =>
        Enqueue(entity, new AudioSourceCommand(AudioSourceCommandType.Play, request));

    /// <summary>Queues a pause command for an entity.</summary>
    public void Pause(Entity entity) =>
        Enqueue(entity, new AudioSourceCommand(AudioSourceCommandType.Pause, default));

    /// <summary>Queues a resume command for an entity.</summary>
    public void Resume(Entity entity) =>
        Enqueue(entity, new AudioSourceCommand(AudioSourceCommandType.Resume, default));

    /// <summary>Queues a stop command for an entity.</summary>
    public void Stop(Entity entity) =>
        Enqueue(entity, new AudioSourceCommand(AudioSourceCommandType.Stop, default));

    /// <summary>Tracks a listener entity and ensures its registry entry.</summary>
    public void AttachListener(Entity entity)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            if (!_world.HasComponent<AudioListenerRef>(entity))
            {
                return;
            }

            AudioListenerRef link = _world.GetComponent<AudioListenerRef>(entity);
            if (_listenerIds.TryGetValue(entity, out AudioListenerId known) && known == link.ListenerId)
            {
                return;
            }

            _listenerIds[entity] = link.ListenerId;
            _system.Listeners.Upsert(link.ListenerId, link.ToDescriptor());
            if (link.Active)
            {
                _system.Listeners.SetActive(link.ListenerId);
            }
        }
    }

    /// <summary>Untracks a listener entity and removes its registry entry.</summary>
    public void DetachListener(Entity entity)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            if (_listenerIds.Remove(entity, out AudioListenerId id))
            {
                _system.Listeners.RemoveListener(id);
            }
        }
    }

    /// <summary>
    /// Runs one frame: upserts tracked sources so tuning edits propagate,
    /// drains command queues with failure capture, syncs playback state back
    /// into components and pushes spatialization into live voices.
    /// </summary>
    public IReadOnlyList<AudioBinderFailure> Update()
    {
        ThrowIfDisposed();
        List<AudioBinderFailure>? failures = null;
        Span<AudioSourceCommand> drain = stackalloc AudioSourceCommand[QueueCapacity];

        lock (_gate)
        {
            SweepDeadLocked();

            List<(Entity Entity, AudioListenerRef Link)> listeners = new(_listenerIds.Count);
            foreach (Entity entity in _listenerIds.Keys)
            {
                if (_world.HasComponent<AudioListenerRef>(entity))
                {
                    listeners.Add((entity, _world.GetComponent<AudioListenerRef>(entity)));
                }
            }

            foreach ((Entity _, AudioListenerRef link) in listeners)
            {
                _system.Listeners.Upsert(link.ListenerId, link.ToDescriptor());
                if (link.Active)
                {
                    _system.Listeners.SetActive(link.ListenerId);
                }
            }

            foreach (Entity entity in new List<Entity>(_queues.Keys))
            {
                if (!_world.HasComponent<AudioSourceRef>(entity))
                {
                    _queues.Remove(entity);
                    continue;
                }

                ref AudioSourceRef link = ref _world.GetComponent<AudioSourceRef>(entity);
                _system.Sources.Upsert(link.SourceId, link.ToDefinition());
                _sourceIds[entity] = link.SourceId;

                CommandQueue queue = _queues[entity];
                int head = queue.Head;
                int remaining = queue.Count;
                int written = 0;
                while (remaining > 0 && written < drain.Length)
                {
                    drain[written++] = queue.Ring[head];
                    head = (head + 1) % queue.Ring.Length;
                    remaining--;
                }

                _queues[entity] = new CommandQueue(queue.Ring, head, queue.Tail, remaining);

                for (int i = 0; i < written; i++)
                {
                    try
                    {
                        Execute(link.SourceId, drain[i]);
                    }
                    catch (Exception ex)
                    {
                        failures ??= new List<AudioBinderFailure>();
                        failures.Add(new AudioBinderFailure(entity, drain[i].Type, ex));
                    }
                }

                if (_system.Sources.TryGetPlaybackState(link.SourceId, out AudioPlaybackState state))
                {
                    link.PlaybackState = state;
                }
                else
                {
                    link.PlaybackState = AudioPlaybackState.Stopped;
                }

                if (link.PlaybackState == AudioPlaybackState.Playing)
                {
                    _system.Playback.TryUpdateSpatial(link.SourceId, link.Spatial);
                }
            }
        }

        return failures ?? (IReadOnlyList<AudioBinderFailure>)Array.Empty<AudioBinderFailure>();
    }

    /// <inheritdoc/>
    public void Dispose()
    {
        if (Interlocked.Exchange(ref _disposed, 1) != 0)
        {
            return;
        }

        lock (_gate)
        {
            _queues.Clear();
            _autoplayed.Clear();
            _sourceIds.Clear();
            _listenerIds.Clear();
        }

        GC.SuppressFinalize(this);
    }

    private void Enqueue(Entity entity, in AudioSourceCommand command)
    {
        ThrowIfDisposed();
        lock (_gate)
        {
            EnqueueLocked(entity, command);
        }
    }

    private void EnqueueLocked(Entity entity, in AudioSourceCommand command)
    {
        if (!_queues.TryGetValue(entity, out CommandQueue queue))
        {
            queue = new CommandQueue(new AudioSourceCommand[QueueCapacity], 0, 0, 0);
        }

        AudioSourceCommand[] ring = queue.Ring;
        int head = queue.Head;
        int tail = queue.Tail;
        int count = queue.Count;

        if (count >= ring.Length)
        {
            head = (head + 1) % ring.Length;
            count--;
        }

        ring[tail] = command;
        tail = (tail + 1) % ring.Length;
        count++;

        _queues[entity] = new CommandQueue(ring, head, tail, count);
    }

    private void Execute(AudioSourceId sourceId, in AudioSourceCommand command)
    {
        switch (command.Type)
        {
            case AudioSourceCommandType.Play:
                _system.Sources.Play(sourceId, command.Request);
                break;
            case AudioSourceCommandType.Pause:
                _system.Sources.Pause(sourceId);
                break;
            case AudioSourceCommandType.Resume:
                _system.Sources.Resume(sourceId);
                break;
            case AudioSourceCommandType.Stop:
                _system.Sources.Stop(sourceId);
                break;
            default:
                break;
        }
    }

    private void SweepDeadLocked()
    {
        List<Entity>? dead = null;
        foreach (Entity entity in _sourceIds.Keys)
        {
            if (!_world.HasComponent<AudioSourceRef>(entity))
            {
                dead ??= new List<Entity>();
                dead.Add(entity);
            }
        }

        if (dead is not null)
        {
            foreach (Entity entity in dead)
            {
                if (_sourceIds.Remove(entity, out AudioSourceId id))
                {
                    _system.Sources.RemoveSource(id);
                }

                _queues.Remove(entity);
                _autoplayed.Remove(entity);
            }
        }

        List<Entity>? gone = null;
        foreach (Entity entity in _listenerIds.Keys)
        {
            if (!_world.HasComponent<AudioListenerRef>(entity))
            {
                gone ??= new List<Entity>();
                gone.Add(entity);
            }
        }

        if (gone is not null)
        {
            foreach (Entity entity in gone)
            {
                if (_listenerIds.Remove(entity, out AudioListenerId id) && _system.Listeners.RegisteredCount > 1)
                {
                    _system.Listeners.RemoveListener(id);
                }
            }
        }
    }

    private void ThrowIfDisposed()
    {
        if (Volatile.Read(ref _disposed) != 0)
        {
            throw new AudioDisposedException(nameof(AudioEcsBinder));
        }
    }
}
