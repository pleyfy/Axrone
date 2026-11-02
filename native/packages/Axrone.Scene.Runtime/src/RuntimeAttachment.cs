namespace Axrone.Scene.Runtime;

/// <summary>
/// UI-agnostic lifecycle hook invoked once when a <see cref="SceneRuntime"/>
/// begins disposing. Attachments own their resources and must make
/// <see cref="OnRuntimeDisposed"/> idempotent; the runtime already guards
/// duplicate invocation, but a callback can also be reached through an
/// attachment's own Dispose path.
/// </summary>
public interface ISceneRuntimeAttachment
{
    /// <summary>Releases attachment resources before the runtime tears down its world.</summary>
    void OnRuntimeDisposed();
}
