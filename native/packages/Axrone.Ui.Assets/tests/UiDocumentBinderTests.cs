namespace Axrone.Ui.Assets.Tests;

using FluentAssertions;
using Xunit;

public sealed class UiDocumentBinderTests
{
    [Fact]
    public void SceneBinderForwardsBindAndUnbind()
    {
        var target = new RecordingTarget<SampleScene>();
        IUiSceneDocumentBinder<SampleScene> binder = new UiSceneDocumentBinder<SampleScene>(target);
        var scene = new SampleScene();
        IUiDocument document = UiTestDocuments.CreateSample();

        binder.Bind(document, scene);
        binder.Unbind(document, scene);

        target.BindCount.Should().Be(1);
        target.UnbindCount.Should().Be(1);
        target.LastDocument.Should().BeSameAs(document);
        target.LastTarget.Should().BeSameAs(scene);
    }

    [Fact]
    public void PrefabBinderForwardsBindAndUnbind()
    {
        var target = new RecordingTarget<SamplePrefab>();
        IUiPrefabDocumentBinder<SamplePrefab> binder = new UiPrefabDocumentBinder<SamplePrefab>(target);
        var prefab = new SamplePrefab();
        IUiDocument document = UiTestDocuments.CreateSample();

        binder.Bind(document, prefab);
        binder.Unbind(document, prefab);

        target.BindCount.Should().Be(1);
        target.UnbindCount.Should().Be(1);
        target.LastTarget.Should().BeSameAs(prefab);
    }

    [Fact]
    public void BindersValidateArguments()
    {
        FluentActions.Invoking(static () => new UiSceneDocumentBinder<SampleScene>(null!))
            .Should().Throw<ArgumentNullException>();
        FluentActions.Invoking(static () => new UiPrefabDocumentBinder<SamplePrefab>(null!))
            .Should().Throw<ArgumentNullException>();

        var sceneBinder = new UiSceneDocumentBinder<SampleScene>(new RecordingTarget<SampleScene>());
        FluentActions.Invoking(() => sceneBinder.Bind(null!, new SampleScene())).Should().Throw<ArgumentNullException>();
        FluentActions.Invoking(() => sceneBinder.Bind(UiTestDocuments.CreateSample(), null!))
            .Should().Throw<ArgumentNullException>();

        var prefabBinder = new UiPrefabDocumentBinder<SamplePrefab>(new RecordingTarget<SamplePrefab>());
        FluentActions.Invoking(() => prefabBinder.Unbind(null!, new SamplePrefab()))
            .Should().Throw<ArgumentNullException>();
        FluentActions.Invoking(() => prefabBinder.Unbind(UiTestDocuments.CreateSample(), null!))
            .Should().Throw<ArgumentNullException>();
    }

    private sealed class RecordingTarget<TTarget> : IUiDocumentBindingTarget<TTarget>
        where TTarget : class
    {
        public int BindCount { get; private set; }

        public int UnbindCount { get; private set; }

        public IUiDocument? LastDocument { get; private set; }

        public TTarget? LastTarget { get; private set; }

        public void OnBind(IUiDocument document, TTarget target)
        {
            BindCount++;
            LastDocument = document;
            LastTarget = target;
        }

        public void OnUnbind(IUiDocument document, TTarget target)
        {
            UnbindCount++;
            LastDocument = document;
            LastTarget = target;
        }
    }

    private sealed class SampleScene
    {
    }

    private sealed class SamplePrefab
    {
    }
}
