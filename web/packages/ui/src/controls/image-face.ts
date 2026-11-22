import type { UIRuntime } from '../runtime';
import type { ColorInput, WidgetId } from '../types';

const TRANSPARENT = '#00000000' as const;

/**
 * Authored surface captured before a sprite-backed control takes over a
 * widget's fill, so the primitive appearance can be restored verbatim when the
 * control leaves sprite mode.
 */
export interface ImageFaceSnapshot {
    readonly background: ColorInput | undefined;
    readonly borderColor: ColorInput | undefined;
    readonly borderWidth: number | undefined;
    readonly bleed: boolean;
}

export interface ImageFaceState {
    readonly active: boolean;
    readonly fill: ImageFaceSnapshot | null;
}

export const IDLE_IMAGE_FACE: ImageFaceState = Object.freeze({ active: false, fill: null });

const captureImageFace = (runtime: UIRuntime, widget: WidgetId): ImageFaceSnapshot => {
    const style = runtime.getWidgetStyleInput(widget);
    const image = runtime.getWidgetImageInput(widget);
    return {
        background: style?.background,
        borderColor: style?.borderColor,
        borderWidth: style?.borderWidth,
        bleed: image?.bleed === true,
    };
};

const enterImageFace = (runtime: UIRuntime, widget: WidgetId): void => {
    runtime.updateWidget(widget, {
        style: {
            background: TRANSPARENT,
            borderColor: TRANSPARENT,
            borderWidth: 0,
        },
        image: { bleed: true },
    });
};

const restoreImageFace = (
    runtime: UIRuntime,
    widget: WidgetId,
    snapshot: ImageFaceSnapshot
): void => {
    const hasImage = runtime.getWidgetImageInput(widget) !== null;
    runtime.updateWidget(widget, {
        style: {
            background: snapshot.background ?? TRANSPARENT,
            borderColor: snapshot.borderColor ?? TRANSPARENT,
            borderWidth: snapshot.borderWidth ?? 0,
        },
        ...(hasImage ? { image: { bleed: snapshot.bleed } } : {}),
    });
};

/**
 * Captures the authored surface before any control mode can mutate it. Mount
 * calls this once so a later sprite activation restores the authored fill
 * rather than a transient hover/press color written by color mode.
 */
export const primeImageFace = (
    runtime: UIRuntime,
    widget: WidgetId,
    current: ImageFaceState
): ImageFaceState => {
    if (current.fill) {
        return current;
    }
    return { active: current.active, fill: captureImageFace(runtime, widget) };
};

/**
 * Drives the sprite-as-surface lifecycle for a widget whose image swaps per
 * state. When `shouldBeFace` is true the fill quad (background + border) is
 * suppressed and the image is bled across the full border box; when false the
 * authored surface captured on first activation is restored.
 *
 * Idempotent: repeated calls in the same mode return the current state without
 * touching the widget, so hover/press feedback stays allocation-free.
 */
export const syncImageFace = (
    runtime: UIRuntime,
    widget: WidgetId,
    current: ImageFaceState,
    shouldBeFace: boolean
): ImageFaceState => {
    if (shouldBeFace) {
        if (current.active) {
            return current;
        }
        const fill = current.fill ?? captureImageFace(runtime, widget);
        enterImageFace(runtime, widget);
        return { active: true, fill };
    }
    if (!current.active) {
        return current;
    }
    if (current.fill) {
        restoreImageFace(runtime, widget, current.fill);
    }
    return { active: false, fill: current.fill };
};
