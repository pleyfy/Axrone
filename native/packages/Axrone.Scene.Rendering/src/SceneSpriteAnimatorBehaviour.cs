namespace Axrone.Scene.Rendering;

/// <summary>
/// Managed behaviour that plays a <see cref="SceneSpriteAnimationClip"/> on the
/// sibling <see cref="SceneSpriteRenderer"/>. The animator owns playback state
/// only: every frame writes the atlas window and any per-frame overrides back
/// into the renderer component, so batching and culling see the animated values
/// during the same frame.
/// </summary>
public sealed class SceneSpriteAnimatorBehaviour : ISceneBehaviour
{
    private const float MinimumFrameDuration = 1e-4f;

    private SceneSpriteAnimationClip? _clip;
    private float _speed = 1.0f;
    private float _elapsedSeconds;
    private int _frameIndex;
    private bool _complete;
    private SceneWorld? _world;
    private SceneActor _actor = SceneActor.Null;

    /// <summary>Creates a stopped-at-frame-zero animator.</summary>
    public SceneSpriteAnimatorBehaviour()
    {
    }

    /// <summary>Clip currently assigned, or null.</summary>
    public SceneSpriteAnimationClip? Clip
    {
        get => _clip;
        set
        {
            _clip = value;
            Rewind();
        }
    }

    /// <summary>Whether playback advances; paused animators keep their frame.</summary>
    public bool Playing { get; set; } = true;

    /// <summary>Per-instance loop override; null uses the clip policy.</summary>
    public bool? Loop { get; set; }

    /// <summary>Playback speed multiplier; negative values are clamped to zero.</summary>
    public float Speed
    {
        get => _speed;
        set => _speed = value > 0.0f ? value : 0.0f;
    }

    /// <summary>Index of the frame currently displayed.</summary>
    public int FrameIndex => _frameIndex;

    /// <summary>Seconds spent inside the current frame.</summary>
    public float ElapsedSeconds => _elapsedSeconds;

    /// <summary>Whether a non-looping clip reached its last frame.</summary>
    public bool IsComplete => _complete;

    /// <summary>Assigns a clip and restarts from its first frame.</summary>
    public void Play(SceneSpriteAnimationClip clip)
    {
        ArgumentNullException.ThrowIfNull(clip);
        Clip = clip;
    }

    /// <summary>Restarts playback at frame zero and applies that frame.</summary>
    public void Rewind()
    {
        _frameIndex = 0;
        _elapsedSeconds = 0.0f;
        _complete = false;
        ApplyCurrentFrame();
    }

    /// <inheritdoc/>
    public void OnAttach(SceneBehaviourContext context)
    {
        ArgumentNullException.ThrowIfNull(context);
        _world = context.World;
        _actor = context.Actor;
        context.OnEnable(ApplyCurrentFrame);
        context.OnUpdate(Advance);
        context.OnDetach(ClearAttachment);
    }

    private void ClearAttachment()
    {
        _world = null;
        _actor = SceneActor.Null;
    }

    /// <summary>Advances playback by <paramref name="deltaSeconds"/> outside the normal update phase.</summary>
    public void Advance(float deltaSeconds)
    {
        if (!Playing || _complete || _clip is null)
        {
            return;
        }

        IReadOnlyList<SceneSpriteAnimationFrame> frames = _clip.Frames;
        int count = frames.Count;
        if (count == 0)
        {
            return;
        }

        _elapsedSeconds += deltaSeconds * _speed;
        bool changed = false;

        while (true)
        {
            float duration = MathF.Max(frames[_frameIndex].DurationSeconds, MinimumFrameDuration);
            if (_elapsedSeconds < duration)
            {
                break;
            }

            _elapsedSeconds -= duration;
            changed = true;

            if (_frameIndex + 1 < count)
            {
                _frameIndex++;
                continue;
            }

            if (Loop ?? _clip.Loop)
            {
                _frameIndex = 0;
                continue;
            }

            _frameIndex = count - 1;
            _elapsedSeconds = 0.0f;
            _complete = true;
            break;
        }

        if (changed)
        {
            ApplyCurrentFrame();
        }
    }

    private void ApplyCurrentFrame()
    {
        SceneWorld? world = _world;
        if (world is null || _clip is null || _clip.Frames.Count == 0)
        {
            return;
        }

        SceneActor actor = _actor;
        if (!world.TryGetData(actor, out SceneSpriteRenderer renderer))
        {
            return;
        }

        SceneSpriteAnimationFrame frame = _clip.Frames[_frameIndex];
        renderer.UvRect = frame.UvRect;

        if (frame.Size is { } size)
        {
            renderer.Size = size;
        }

        if (frame.SourceSize is { } sourceSize)
        {
            renderer.SourceSize = sourceSize;
        }

        if (frame.Anchor is { } anchor)
        {
            renderer.Anchor = anchor;
        }

        world.GetData<SceneSpriteRenderer>(actor) = renderer;
    }
}
