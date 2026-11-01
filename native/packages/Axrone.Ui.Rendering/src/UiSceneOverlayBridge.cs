namespace Axrone.Ui.Rendering;

using Axrone.Scene;

/// <summary>Space a UI document is composited in.</summary>
public enum UiOverlaySpace
{
    /// <summary>Composited in screen space over the scene.</summary>
    Screen,

    /// <summary>Composited in world space on the host actor.</summary>
    World,
}

/// <summary>
/// Mounting record of one UI document on a scene actor. The actor handle is a
/// generational scene identity, so a recycled slot resolves as stale instead
/// of aliasing the new occupant.
/// </summary>
[StructLayout(LayoutKind.Sequential, Pack = 4)]
public readonly record struct UiOverlayAttachment(
    UiDocumentId Document,
    SceneActor Host,
    UiOverlaySpace Space,
    int ZOrder,
    float PixelsPerUnit);

/// <summary>
/// Scene.Rendering integration contract: owns which UI documents are mounted on
/// which scene actors and routes their frames into the render host.
/// </summary>
public interface IUiSceneOverlayBridge
{
    /// <summary>Gets the number of mounted documents.</summary>
    int AttachmentCount { get; }

    /// <summary>Mounts a document on a scene actor.</summary>
    bool TryAttach(in UiOverlayAttachment attachment);

    /// <summary>Unmounts a document.</summary>
    bool TryDetach(UiDocumentId document);

    /// <summary>Looks up the attachment of one document.</summary>
    bool TryGetAttachment(UiDocumentId document, out UiOverlayAttachment attachment);

    /// <summary>Submits one document's frame for composition this tick.</summary>
    bool TrySubmitFrame(UiDocumentId document, IUiFrame frame);
}
