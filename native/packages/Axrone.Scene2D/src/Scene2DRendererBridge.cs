namespace Axrone.Scene2D;

/// <summary>Payload ownership mode of a Scene2D world.</summary>
public enum Scene2DComponentMode : byte
{
    /// <summary>Lean staging payloads owned by this package.</summary>
    LeanStaging = 0,

    /// <summary>Renderer components owned by Scene.Rendering.</summary>
    Renderer = 1
}

/// <summary>
/// Single conversion surface between Scene2D staging payloads and the real
/// renderer components. The facade selects exactly one payload owner at
/// creation and routes every attachment through this bridge when the profile
/// registers renderer components.
/// </summary>
/// <remarks>
/// Conversions are value copies and allocate nothing. Attaching an animator
/// adds a managed <see cref="SceneSpriteAnimatorBehaviour"/>; every other
/// attachment writes an unmanaged data component.
/// </remarks>
public static class Scene2DRendererBridge
{
    private const float MinimumFrameDuration = 1e-4f;

    /// <summary>
    /// Resolves the payload mode of a runtime profile. Profiles mixing staging
    /// and renderer payloads are rejected, as are profiles that register only
    /// a partial set of either ownership family.
    /// </summary>
    /// <exception cref="SceneConfigurationException">
    /// The profile registers both staging and renderer payloads.
    /// </exception>
    /// <exception cref="SceneCapabilityException">
    /// The profile registers neither family or only a partial family.
    /// </exception>
    public static Scene2DComponentMode ResolveMode(SceneProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);
        SceneComponentRegistry registry = profile.Registry;

        bool anyStaging = HasAnyStaging(registry);
        bool anyRenderer = HasAnyRenderer(registry);
        if (anyStaging && anyRenderer)
        {
            throw new SceneConfigurationException(
                "Scene2D profiles must have exactly one payload owner; staging and renderer payloads are both registered.");
        }

        if (anyStaging)
        {
            if (AllStagingRegistered(registry))
            {
                return Scene2DComponentMode.LeanStaging;
            }

            throw new SceneCapabilityException(
                "Scene2D",
                "the lean profile registers only a partial Scene2D staging payload set.");
        }

        if (anyRenderer)
        {
            if (AllRendererRegistered(registry))
            {
                return Scene2DComponentMode.Renderer;
            }

            throw new SceneCapabilityException(
                "Scene2D",
                "the renderer profile registers only a partial Scene2D renderer component set.");
        }

        throw new SceneCapabilityException(
            "Scene2D",
            "the profile registers neither Scene2D staging payloads nor renderer components.");
    }

    /// <summary>
    /// Whether a registry registers the renderer component matching a manifest
    /// identity, under the manifest name.
    /// </summary>
    public static bool IsRegistered(SceneComponentRegistry registry, Scene2DBuiltInComponent component)
    {
        ArgumentNullException.ThrowIfNull(registry);

        Type expected = GetRendererType(component);
        if (!registry.TryGetByName(Scene2DComponentIds.ToName(component), out SceneComponentDescriptor? descriptor) ||
            descriptor.ComponentType != expected)
        {
            return false;
        }

        return component == Scene2DBuiltInComponent.SpriteAnimator
            ? registry.TryGetBehaviourByType(expected, out _)
            : registry.TryGetDataByType(expected, out _);
    }

    /// <summary>Copies a staging camera payload into the renderer camera.</summary>
    public static SceneCamera ToSceneCamera(in Scene2DCamera source)
    {
        SceneCamera camera = SceneCamera.Default;
        camera.Primary = source.Primary;
        camera.Enabled = source.Enabled;
        camera.Orthographic = source.Orthographic;
        camera.FieldOfViewAxis = source.FieldOfViewAxis == Scene2DCameraFovAxis.Horizontal
            ? SceneCameraFovAxis.Horizontal
            : SceneCameraFovAxis.Vertical;
        camera.FieldOfViewDegrees = source.FieldOfViewDegrees;
        camera.OrthographicSize = source.OrthographicSize;
        camera.Near = source.Near;
        camera.Far = source.Far;
        camera.ClearMask = ToClearMask(source.ClearMask);
        camera.ClearColor = source.ClearColor;
        camera.ClearDepth = source.ClearDepth;
        return camera;
    }

    /// <summary>Copies a staging 2D camera payload into the renderer marker.</summary>
    public static SceneCamera2D ToSceneCamera2D(in Scene2DCamera2D source)
    {
        SceneCamera2D camera2D = SceneCamera2DDefaults.CreateCamera2D();
        camera2D.Depth = source.Depth;
        return camera2D;
    }

    /// <summary>Copies a staging sprite payload into the renderer component.</summary>
    public static SceneSpriteRenderer ToSceneSpriteRenderer(in Scene2DSpriteRenderer source)
    {
        SceneSpriteRenderer renderer = SceneSpriteRenderer.Default;
        renderer.TextureId = SceneAssetId<TextureAssetTag>.FromSymbol(source.TextureId);
        renderer.MaterialId = SceneAssetId<MaterialAssetTag>.FromSymbol(source.MaterialId);
        renderer.PassId = SceneAssetId<RenderPassAssetTag>.FromSymbol(source.PassId);
        renderer.Enabled = source.Enabled;
        renderer.Visible = source.Visible;
        renderer.FlipX = source.FlipX;
        renderer.FlipY = source.FlipY;
        renderer.SortingLayer = source.SortingLayer;
        renderer.RenderOrder = source.RenderOrder;
        renderer.Size = source.Size;
        renderer.SourceSize = source.SourceSize;
        renderer.Anchor = source.Anchor;
        renderer.Color = source.Color;
        renderer.UvRect = source.UvRect;
        renderer.Depth = source.Depth;
        return renderer;
    }

    /// <summary>Copies a staging mask payload into the renderer component.</summary>
    public static SceneSpriteMask ToSceneSpriteMask(in Scene2DSpriteMask source)
    {
        SceneSpriteMask mask = SceneSpriteMask.Default;
        mask.Kind = source.Kind switch
        {
            Scene2DSpriteMaskKind.Ellipse => SceneSpriteMaskKind.Ellipse,
            Scene2DSpriteMaskKind.RoundedRect => SceneSpriteMaskKind.RoundedRect,
            _ => SceneSpriteMaskKind.Rect
        };
        mask.Rect = source.Rect;
        mask.Invert = source.Invert;
        mask.Feather = source.Feather;
        mask.CornerRadius = source.CornerRadius;
        mask.Enabled = source.Enabled;
        return mask;
    }

    /// <summary>Attaches renderer camera components to an actor.</summary>
    public static void AttachCamera(
        SceneWorld world,
        SceneActor actor,
        in Scene2DCamera camera,
        in Scene2DCamera2D camera2D)
    {
        ArgumentNullException.ThrowIfNull(world);

        SceneCamera rendererCamera = ToSceneCamera(in camera);
        world.AddData(actor, in rendererCamera);
        SceneCamera2D rendererCamera2D = ToSceneCamera2D(in camera2D);
        world.AddData(actor, in rendererCamera2D);
    }

    /// <summary>Attaches the renderer sprite component to an actor.</summary>
    public static void AttachSprite(
        SceneWorld world,
        SceneActor actor,
        in Scene2DSpriteRenderer renderer)
    {
        ArgumentNullException.ThrowIfNull(world);

        SceneSpriteRenderer target = ToSceneSpriteRenderer(in renderer);
        world.AddData(actor, in target);
    }

    /// <summary>Attaches the renderer sprite mask to an actor.</summary>
    public static void AttachMask(
        SceneWorld world,
        SceneActor actor,
        in Scene2DSpriteMask mask)
    {
        ArgumentNullException.ThrowIfNull(world);

        SceneSpriteMask target = ToSceneSpriteMask(in mask);
        world.AddData(actor, in target);
    }

    /// <summary>
    /// Attaches and configures the renderer animator. A clip is required when
    /// the staging payload carries frame progress; clip playback is advanced
    /// deterministically to the staged frame and elapsed time.
    /// </summary>
    /// <exception cref="SceneValidationException">
    /// Progress is staged without a clip, the frame index exceeds the clip, or
    /// an empty clip carries progress.
    /// </exception>
    public static void AttachAnimator(
        SceneWorld world,
        SceneActor actor,
        in Scene2DSpriteAnimator animator,
        SceneSpriteAnimationClip? clip)
    {
        ArgumentNullException.ThrowIfNull(world);

        if (clip is null)
        {
            if (animator.FrameIndex != 0 || animator.ElapsedSeconds > 0.0f)
            {
                throw new SceneValidationException(
                    SceneErrorCodes.ValidationInvalid,
                    "Renderer animator frame progress requires an animation clip.");
            }

            if (animator.ClipId.IsValid)
            {
                throw new SceneValidationException(
                    SceneErrorCodes.ValidationInvalid,
                    "Renderer animator requires an animation clip instance; a clip id cannot be resolved by the bridge.");
            }
        }
        else
        {
            ValidateClipProgress(in animator, clip);
        }

        SceneSpriteAnimatorBehaviour behaviour = world.AddBehaviour<SceneSpriteAnimatorBehaviour>(actor);
        behaviour.Playing = true;
        behaviour.Speed = 1.0f;
        behaviour.Loop = animator.Loop;

        if (clip is not null)
        {
            behaviour.Clip = clip;
            float advance = ComputeAdvance(in animator, clip);
            if (advance > 0.0f)
            {
                behaviour.Advance(advance);
            }
        }

        behaviour.Speed = animator.Speed;
        behaviour.Playing = animator.Playing;
    }

    private static bool HasAnyStaging(SceneComponentRegistry registry) =>
        registry.TryGetDataByType(typeof(Scene2DCamera), out _) ||
        registry.TryGetDataByType(typeof(Scene2DCamera2D), out _) ||
        registry.TryGetDataByType(typeof(Scene2DSpriteRenderer), out _) ||
        registry.TryGetDataByType(typeof(Scene2DSpriteAnimator), out _) ||
        registry.TryGetDataByType(typeof(Scene2DSpriteMask), out _);

    private static bool HasAnyRenderer(SceneComponentRegistry registry) =>
        registry.TryGetDataByType(typeof(SceneCamera), out _) ||
        registry.TryGetDataByType(typeof(SceneCamera2D), out _) ||
        registry.TryGetDataByType(typeof(SceneSpriteRenderer), out _) ||
        registry.TryGetBehaviourByType(typeof(SceneSpriteAnimatorBehaviour), out _) ||
        registry.TryGetDataByType(typeof(SceneSpriteMask), out _);

    private static bool AllStagingRegistered(SceneComponentRegistry registry)
    {
        ReadOnlySpan<Scene2DBuiltInComponent> components = Scene2DBuiltInManifest.Components;
        for (int i = 0; i < components.Length; i++)
        {
            if (!Scene2DBuiltInManifest.IsRegistered(registry, components[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static bool AllRendererRegistered(SceneComponentRegistry registry)
    {
        ReadOnlySpan<Scene2DBuiltInComponent> components = Scene2DBuiltInManifest.Components;
        for (int i = 0; i < components.Length; i++)
        {
            if (!IsRegistered(registry, components[i]))
            {
                return false;
            }
        }

        return true;
    }

    private static Type GetRendererType(Scene2DBuiltInComponent component) => component switch
    {
        Scene2DBuiltInComponent.Camera => typeof(SceneCamera),
        Scene2DBuiltInComponent.Camera2D => typeof(SceneCamera2D),
        Scene2DBuiltInComponent.SpriteRenderer => typeof(SceneSpriteRenderer),
        Scene2DBuiltInComponent.SpriteAnimator => typeof(SceneSpriteAnimatorBehaviour),
        Scene2DBuiltInComponent.SpriteMask => typeof(SceneSpriteMask),
        _ => throw new SceneValidationException(
            SceneErrorCodes.ValidationInvalid,
            $"Unknown Scene2D built-in component '{component}'.")
    };

    private static SceneClearMask ToClearMask(Scene2DClearMask mask)
    {
        SceneClearMask result = SceneClearMask.None;
        if ((mask & Scene2DClearMask.Color) != 0)
        {
            result |= SceneClearMask.Color;
        }

        if ((mask & Scene2DClearMask.Depth) != 0)
        {
            result |= SceneClearMask.Depth;
        }

        return result;
    }

    private static void ValidateClipProgress(in Scene2DSpriteAnimator animator, SceneSpriteAnimationClip clip)
    {
        int count = clip.Frames.Count;
        if (count == 0)
        {
            if (animator.FrameIndex != 0 || animator.ElapsedSeconds > 0.0f)
            {
                throw new SceneValidationException(
                    SceneErrorCodes.ValidationInvalid,
                    "An empty animation clip cannot carry frame progress.");
            }

            return;
        }

        if ((uint)animator.FrameIndex >= (uint)count)
        {
            throw new SceneValidationException(
                SceneErrorCodes.ValidationInvalid,
                "Animator frame index exceeds the animation clip frame count.");
        }
    }

    private static float ComputeAdvance(in Scene2DSpriteAnimator animator, SceneSpriteAnimationClip clip)
    {
        IReadOnlyList<SceneSpriteAnimationFrame> frames = clip.Frames;
        if (frames.Count == 0)
        {
            return 0.0f;
        }

        float advance = 0.0f;
        for (int i = 0; i < animator.FrameIndex; i++)
        {
            advance += MathF.Max(frames[i].DurationSeconds, MinimumFrameDuration);
        }

        float targetDuration = MathF.Max(frames[animator.FrameIndex].DurationSeconds, MinimumFrameDuration);
        advance += MathF.Min(animator.ElapsedSeconds, targetDuration * 0.5f);
        return advance;
    }
}
