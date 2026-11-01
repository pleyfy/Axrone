namespace Axrone.Scene.Runtime;

/// <summary>
/// Backend-agnostic frame planner. One instance is reused every frame: camera
/// selection, lighting synchronization, pass iteration and render-item queues
/// all write into preallocated state, so a warmed frame allocates nothing.
/// </summary>
public sealed class SceneFramePipeline :
    IDisposable,
    ISceneFrameItemSource,
    ISceneLodFrameItemSource,
    ISceneSkinnedMeshFrameItemSource,
    IScenePrimitiveFrameItemSource
{
    private readonly SceneWorld _world;
    private readonly SceneAssetRegistry _assets;
    private readonly SceneCameraFrameCollector _cameraCollector = new();
    private readonly SceneCamera2DFrameCollector _camera2DCollector = new();
    private readonly SceneLightingCollector _lightingCollector;
    private readonly SceneRenderItemCollector _items;
    private readonly SceneSpriteItemCollector _spriteItems;
    private readonly SceneLodEvaluator _lodEvaluator = new();
    private readonly SceneLodItemCollector _lodItems = new();
    private readonly SceneSkinnedMeshItemCollector _skinnedItems = new();
    private readonly SceneBillboardItemCollector _billboardItems = new();
    private readonly SceneLineItemCollector _lineItems = new();
    private readonly SceneTrailItemCollector _trailItems = new();
    private readonly ScenePolylineRegistry _polylines = new();
    private readonly SceneTrailRegistry _trails = new();
    private readonly SceneRenderPassPlan _passes;
    private readonly SceneRenderFrameState _frameState = new();

    private readonly Vec3 _ambient;
    private readonly Vec3 _sky;
    private readonly Vec3 _ground;
    private readonly bool _hasSpriteComponent;
    private readonly bool _hasLodComponent;
    private readonly bool _hasSkinnedComponent;
    private readonly bool _hasBillboardComponent;
    private readonly bool _hasLineComponent;
    private readonly bool _hasTrailComponent;

    private int _viewportWidth;
    private int _viewportHeight;
    private bool _disposed;

    /// <summary>Creates a frame planner for a world and asset catalog.</summary>
    public SceneFramePipeline(
        SceneWorld world,
        SceneAssetRegistry assets,
        int viewportWidth,
        int viewportHeight,
        in Vec3 ambient,
        in Vec3 sky,
        in Vec3 ground,
        int maxLocalLights = 4)
    {
        ArgumentNullException.ThrowIfNull(world);
        ArgumentNullException.ThrowIfNull(assets);
        ValidateViewport(viewportWidth, viewportHeight);

        if (maxLocalLights < 0)
        {
            throw new SceneConfigurationException(
                $"Local-light capacity must not be negative; received {maxLocalLights}.");
        }

        _world = world;
        _assets = assets;
        _viewportWidth = viewportWidth;
        _viewportHeight = viewportHeight;
        _ambient = ambient;
        _sky = sky;
        _ground = ground;
        _lightingCollector = new SceneLightingCollector(maxLocalLights);
        _items = new SceneRenderItemCollector();
        _spriteItems = new SceneSpriteItemCollector();
        _passes = new SceneRenderPassPlan(assets);
        _hasSpriteComponent = world.Registry.TryGetDataByType(typeof(SceneSpriteRenderer), out _);
        _hasLodComponent = world.Registry.TryGetDataByType(typeof(SceneLodGroup), out _);
        _hasSkinnedComponent = world.Registry.TryGetDataByType(typeof(SceneSkinnedMeshRenderer), out _);
        _hasBillboardComponent = world.Registry.TryGetDataByType(typeof(SceneBillboardRenderer), out _);
        _hasLineComponent = world.Registry.TryGetDataByType(typeof(SceneLineRenderer), out _);
        _hasTrailComponent = world.Registry.TryGetDataByType(typeof(SceneTrailRenderer), out _);
    }

    /// <summary>Render paths active for the last planned frame.</summary>
    public SceneRenderMode Mode { get; private set; }

    /// <summary>Selected camera frame for the current frame, or null before planning.</summary>
    public SceneCameraFrame? Camera { get; private set; }

    /// <summary>Resolved lighting for the current frame, or null when no camera exists.</summary>
    public LightingSelectionState? Lighting { get; private set; }

    /// <summary>Resolved fog settings for the current frame.</summary>
    public SceneFogState Fog { get; private set; } = SceneFogState.Default;

    /// <summary>Enabled render passes in execution order.</summary>
    public SceneRenderPassPlan Passes => _passes;

    /// <summary>Mutable per-frame counters.</summary>
    public SceneRenderFrameState FrameState => _frameState;

    /// <summary>Planned render items for the last collected pass.</summary>
    public ReadOnlySpan<SceneRenderItem> Items => _items.Items;

    /// <summary>Planned sprite items for the last collected pass.</summary>
    public ReadOnlySpan<SceneSpriteRenderItem> SpriteItems => _spriteItems.Items;

    /// <summary>LOD items with resolved level indices for the last collected pass.</summary>
    public ReadOnlySpan<SceneLodRenderItem> LodItems => _lodItems.Items;

    /// <summary>Skinned mesh items for the last collected pass.</summary>
    public ReadOnlySpan<SceneSkinnedMeshRenderItem> SkinnedItems => _skinnedItems.Items;

    /// <summary>Billboard items for the last collected pass.</summary>
    public ReadOnlySpan<SceneBillboardRenderItem> BillboardItems => _billboardItems.Items;

    /// <summary>Line segments for the last collected pass.</summary>
    public ReadOnlySpan<SceneLineRenderItem> LineItems => _lineItems.Items;

    /// <summary>Trail segments for the last collected pass.</summary>
    public ReadOnlySpan<SceneTrailRenderItem> TrailItems => _trailItems.Items;

    /// <summary>Polyline point storage used by line renderers.</summary>
    public ScenePolylineRegistry Polylines => _polylines;

    /// <summary>Trail history storage used by trail renderers.</summary>
    public SceneTrailRegistry Trails => _trails;

    /// <summary>
    /// Frame time in seconds used for trail aging. The runtime render path sets
    /// this from the loop's elapsed time.
    /// </summary>
    public float TimeSeconds { get; set; }

    /// <summary>Viewport width in pixels.</summary>
    public int ViewportWidth
    {
        get => _viewportWidth;
        set
        {
            ValidateViewport(value, _viewportHeight);
            _viewportWidth = value;
        }
    }

    /// <summary>Viewport height in pixels.</summary>
    public int ViewportHeight
    {
        get => _viewportHeight;
        set
        {
            ValidateViewport(_viewportWidth, value);
            _viewportHeight = value;
        }
    }

    /// <summary>Rebuilds the ordered pass list after asset changes.</summary>
    public void RebuildPasses()
    {
        ThrowIfDisposed();
        _passes.Rebuild();
    }

    /// <summary>
    /// Plans camera selection and lighting for one frame.
    /// </summary>
    /// <returns>False when the scene has no enabled camera.</returns>
    public bool Plan(int frameIndex)
    {
        ThrowIfDisposed();

        if (frameIndex < 0)
        {
            throw new SceneConfigurationException(
                $"Frame indices must not be negative; received {frameIndex}.");
        }

        _frameState.Begin(frameIndex);
        _ = SceneFogSelector.TrySelect(_world, out SceneFogState fog);
        Fog = fog;

        Camera = _cameraCollector.Collect(_world, _viewportWidth, _viewportHeight);
        bool hasLighting = Camera is not null;
        Camera ??= _camera2DCollector.Collect(_world, _viewportWidth, _viewportHeight);

        if (Camera is null)
        {
            Lighting = null;
            Mode = SceneRenderMode.None;
            return false;
        }

        Mode = hasLighting
            ? (_hasSpriteComponent ? SceneRenderMode.Mixed : SceneRenderMode.ThreeD)
            : SceneRenderMode.TwoD;

        // 2D frames do not participate in the 3D lighting rig.
        Lighting = hasLighting
            ? _lightingCollector.Collect(
                _world,
                Camera.Position,
                _ambient,
                _sky,
                _ground)
            : null;

        if (_hasLodComponent && _world.HasTransform3D)
        {
            _lodEvaluator.Evaluate(_world, Camera);
        }

        return true;
    }

    /// <summary>Collects, culls and sorts items for one pass.</summary>
    /// <returns>Number of planned items.</returns>
    public int CollectItems(SceneAssetId<RenderPassAssetTag> passId)
    {
        ThrowIfDisposed();

        if (Camera is null)
        {
            throw new SceneLifecycleException(
                "Render items cannot be collected before a camera frame is planned.");
        }

        int count = _items.Collect(_world, Camera, passId, _assets);

        int transparent = 0;
        ReadOnlySpan<SceneRenderItem> items = _items.Items;
        for (int i = 0; i < items.Length; i++)
        {
            if (items[i].Transparent)
            {
                transparent++;
            }
        }

        _frameState.RecordQueues(count - transparent, transparent);
        _frameState.RecordCulled(_items.CulledCount);
        return count;
    }

    /// <summary>Collects, culls and sorts sprite items for one pass.</summary>
    /// <returns>Number of planned sprites.</returns>
    public int CollectSprites(SceneAssetId<RenderPassAssetTag> passId)
    {
        ThrowIfDisposed();

        if (Camera is null)
        {
            throw new SceneLifecycleException(
                "Sprite items cannot be collected before a camera frame is planned.");
        }

        int count = _spriteItems.Collect(_world, Camera, passId);
        _frameState.RecordSprites(count);
        _frameState.RecordCulled(_spriteItems.CulledCount);
        return count;
    }

    ReadOnlySpan<SceneRenderItem> ISceneFrameItemSource.CollectMeshes(
        SceneAssetId<RenderPassAssetTag> passId)
    {
        _ = CollectItems(passId);
        return Items;
    }

    ReadOnlySpan<SceneSpriteRenderItem> ISceneFrameItemSource.CollectSprites(
        SceneAssetId<RenderPassAssetTag> passId)
    {
        _ = CollectSprites(passId);
        return SpriteItems;
    }

    /// <summary>Collects LOD-selected mesh items for one pass.</summary>
    public int CollectLodItems(SceneAssetId<RenderPassAssetTag> passId)
    {
        ThrowIfDisposed();
        if (!_hasLodComponent)
        {
            return 0;
        }

        SceneCameraFrame camera = RequireCamera("LOD items");
        int count = _lodItems.Collect(_world, camera, passId, _lodEvaluator);
        _frameState.RecordCulled(_lodItems.CulledCount);
        return count;
    }

    /// <summary>Collects skinned mesh items for one pass.</summary>
    public int CollectSkinnedMeshes(SceneAssetId<RenderPassAssetTag> passId)
    {
        ThrowIfDisposed();
        if (!_hasSkinnedComponent)
        {
            return 0;
        }

        SceneCameraFrame camera = RequireCamera("Skinned items");
        int count = _skinnedItems.Collect(_world, camera, passId, _assets);
        _frameState.RecordCulled(_skinnedItems.CulledCount);
        return count;
    }

    /// <summary>Collects billboard items for one pass.</summary>
    public int CollectBillboards(SceneAssetId<RenderPassAssetTag> passId)
    {
        ThrowIfDisposed();
        if (!_hasBillboardComponent)
        {
            return 0;
        }

        SceneCameraFrame camera = RequireCamera("Billboard items");
        int count = _billboardItems.Collect(_world, camera, passId);
        _frameState.RecordCulled(_billboardItems.CulledCount);
        return count;
    }

    /// <summary>Collects world-space line segments for one pass.</summary>
    public int CollectLines(SceneAssetId<RenderPassAssetTag> passId)
    {
        ThrowIfDisposed();
        if (!_hasLineComponent)
        {
            return 0;
        }

        SceneCameraFrame camera = RequireCamera("Line items");
        int count = _lineItems.Collect(_world, camera, passId, _polylines);
        _frameState.RecordCulled(_lineItems.CulledCount);
        return count;
    }

    /// <summary>Collects fading trail segments for one pass.</summary>
    public int CollectTrails(SceneAssetId<RenderPassAssetTag> passId)
    {
        ThrowIfDisposed();
        if (!_hasTrailComponent)
        {
            return 0;
        }

        SceneCameraFrame camera = RequireCamera("Trail items");
        int count = _trailItems.Collect(_world, camera, passId, _trails, TimeSeconds);
        _frameState.RecordCulled(_trailItems.CulledCount);
        return count;
    }

    ReadOnlySpan<SceneRenderItem> ISceneLodFrameItemSource.CollectLodMeshItems(
        SceneAssetId<RenderPassAssetTag> passId)
    {
        _ = CollectLodItems(passId);
        return _lodItems.MeshItems;
    }

    ReadOnlySpan<SceneSkinnedMeshRenderItem> ISceneSkinnedMeshFrameItemSource.CollectSkinnedMeshes(
        SceneAssetId<RenderPassAssetTag> passId)
    {
        _ = CollectSkinnedMeshes(passId);
        return _skinnedItems.Items;
    }

    ReadOnlySpan<SceneBillboardRenderItem> IScenePrimitiveFrameItemSource.CollectBillboards(
        SceneAssetId<RenderPassAssetTag> passId)
    {
        _ = CollectBillboards(passId);
        return _billboardItems.Items;
    }

    ReadOnlySpan<SceneLineRenderItem> IScenePrimitiveFrameItemSource.CollectLines(
        SceneAssetId<RenderPassAssetTag> passId)
    {
        _ = CollectLines(passId);
        return _lineItems.Items;
    }

    ReadOnlySpan<SceneTrailRenderItem> IScenePrimitiveFrameItemSource.CollectTrails(
        SceneAssetId<RenderPassAssetTag> passId)
    {
        _ = CollectTrails(passId);
        return _trailItems.Items;
    }

    /// <summary>Takes the immutable counter snapshot for the finished frame.</summary>
    public SceneRenderStats Complete(int passCount) => _frameState.Snapshot(passCount);

    /// <inheritdoc/>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _lightingCollector.Dispose();
        _disposed = true;
    }

    private SceneCameraFrame RequireCamera(string reason)
    {
        return Camera ?? throw new SceneLifecycleException(
            $"{reason} cannot be collected before a camera frame is planned.");
    }

    private static void ValidateViewport(int width, int height)
    {
        if (width <= 0 || height <= 0)
        {
            throw new SceneConfigurationException(
                $"Viewport dimensions must be positive; received {width}x{height}.");
        }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed)
        {
            throw new SceneDisposedException(nameof(SceneFramePipeline));
        }
    }
}
