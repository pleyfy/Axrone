import type { UIRuntime } from '../runtime';
import type { UIScrollViewHandle, UIScrollViewOptions } from './types';
import { clamp } from '@axrone/numeric';
import { attachToParent, disposeWidget } from './internals';
import { resolveTheme } from './theme';

// ─── Scrollbar constants ─────────────────────────────────────────────────────
const SCROLLBAR_TRACK_SIZE = 8;
const SCROLLBAR_THUMB_MIN = 20;
const SCROLLBAR_TRACK_INSET = 4;
const SCROLLBAR_THUMB_DEFAULT = 40;
const SCROLLBAR_RADIUS = 4;
const SCROLLBAR_THUMB_COLOR = '#475569aa';

// ─── Scroll content constants ────────────────────────────────────────────────
const DEFAULT_CONTENT_GAP = 10;
const SCROLL_PAGE_STEP = 64;

// ─── Scrollbar factory ───────────────────────────────────────────────────────
type ScrollbarAxis = 'vertical' | 'horizontal';

interface ScrollbarResult {
    readonly track: number;
    readonly thumb: number;
    readonly setDragging: (dragging: boolean) => void;
    readonly isDragging: () => boolean;
    readonly startDrag: (pointerCoord: number, scrollCoord: number) => void;
    readonly updateDrag: (pointerCoord: number, getTrackSize: () => number, getMaxScroll: () => number, getScroll: () => number, setScroll: (v: number) => void) => void;
}

const createScrollbar = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    axis: ScrollbarAxis,
    state: { scrollX: number; scrollY: number; disabled: boolean },
    cancelMomentum: () => void,
    applyOffsets: () => void,
): ScrollbarResult => {
    const isVertical = axis === 'vertical';
    let dragging = false;
    let dragStartCoord = 0;
    let dragStartScroll = 0;

    const track = runtime.createWidget({
        role: isVertical ? 'custom:scrollbar-track-v' : 'custom:scrollbar-track-h',
        layout: isVertical
            ? {
                position: 'absolute',
                anchor: { x: 1, y: 0, maxX: 1, maxY: 1 },
                inset: { top: SCROLLBAR_TRACK_INSET, right: 2 },
                width: SCROLLBAR_TRACK_SIZE,
            }
            : {
                position: 'absolute',
                anchor: { x: 0, y: 1, maxX: 1, maxY: 1 },
                inset: { left: SCROLLBAR_TRACK_INSET, bottom: 2 },
                height: SCROLLBAR_TRACK_SIZE,
            },
        style: {
            background: '#00000000',
            radius: SCROLLBAR_RADIUS,
        },
        interactive: true,
        handlers: {
            pointerDown: (event) => {
                if (state.disabled) return false;
                cancelMomentum();
                dragging = true;
                dragStartCoord = isVertical ? event.y : event.x;
                dragStartScroll = isVertical ? state.scrollY : state.scrollX;
                return true;
            },
            pointerMove: (event) => {
                if (!dragging) return false;
                const trackBox = runtime.getLayoutBox(track);
                const contentBoxLocal = runtime.getLayoutBox(content);
                const viewportBox = runtime.getLayoutBox(root);
                const maxScroll = isVertical
                    ? Math.max(0, contentBoxLocal.height - viewportBox.contentHeight)
                    : Math.max(0, contentBoxLocal.width - viewportBox.contentWidth);
                const trackSize = (isVertical ? trackBox.height : trackBox.width) - SCROLLBAR_TRACK_SIZE;
                const delta = (isVertical ? event.y : event.x) - dragStartCoord;
                const scrollDelta = (delta / Math.max(1, trackSize)) * maxScroll;
                const newScroll = clamp(dragStartScroll + scrollDelta, 0, maxScroll);
                if (isVertical) {
                    state.scrollY = newScroll;
                } else {
                    state.scrollX = newScroll;
                }
                applyOffsets();
                return true;
            },
            pointerUp: () => {
                dragging = false;
                return true;
            },
        },
    });

    const thumb = runtime.createWidget({
        role: isVertical ? 'custom:scrollbar-thumb-v' : 'custom:scrollbar-thumb-h',
        layout: isVertical
            ? {
                position: 'absolute',
                width: '100%',
                height: SCROLLBAR_THUMB_DEFAULT,
            }
            : {
                position: 'absolute',
                height: '100%',
                width: SCROLLBAR_THUMB_DEFAULT,
            },
        style: {
            background: SCROLLBAR_THUMB_COLOR,
            radius: SCROLLBAR_RADIUS,
        },
    });

    runtime.appendChild(track, thumb);

    return {
        track,
        thumb,
        setDragging: (v: boolean) => { dragging = v; },
        isDragging: () => dragging,
        startDrag: (pointerCoord: number, scrollCoord: number) => {
            dragStartCoord = pointerCoord;
            dragStartScroll = scrollCoord;
        },
        updateDrag: (pointerCoord, getTrackSize, getMaxScroll, getScroll, setScroll) => {
            if (!dragging) return;
            const trackSize = getTrackSize() - SCROLLBAR_TRACK_SIZE;
            const maxScroll = getMaxScroll();
            const delta = pointerCoord - dragStartCoord;
            const scrollDelta = (delta / Math.max(1, trackSize)) * maxScroll;
            setScroll(clamp(dragStartScroll + scrollDelta, 0, maxScroll));
        },
    };
};

export const createUIScrollView = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIScrollViewOptions = {}
): UIScrollViewHandle => {
    const theme = resolveTheme(options.theme);
    const state = {
        scrollX: Math.max(0, options.scrollX ?? 0),
        scrollY: Math.max(0, options.scrollY ?? 0),
        disabled: options.disabled ?? false,
    };

    // Drag state for scrollbar interaction is now managed by createScrollbar factory

    // Momentum scrolling state
    let velocityX = 0;
    let velocityY = 0;
    let momentumRafId: number | null = null;
    let wheelTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastWheelTime = 0;
    const MOMENTUM_FRICTION = 0.92;
    const MOMENTUM_THRESHOLD = 0.5;
    const WHEEL_VELOCITY_SMOOTHING = 0.3;
    const WHEEL_END_TIMEOUT = 80;

    const cancelMomentum = (): void => {
        if (momentumRafId !== null) {
            cancelAnimationFrame(momentumRafId);
            momentumRafId = null;
        }
        if (wheelTimeoutId !== null) {
            clearTimeout(wheelTimeoutId);
            wheelTimeoutId = null;
        }
        velocityX = 0;
        velocityY = 0;
    };

    const startMomentum = (): void => {
        if (Math.abs(velocityX) < MOMENTUM_THRESHOLD && Math.abs(velocityY) < MOMENTUM_THRESHOLD) {
            velocityX = 0;
            velocityY = 0;
            return;
        }

        const tick = (): void => {
            velocityX *= MOMENTUM_FRICTION;
            velocityY *= MOMENTUM_FRICTION;

            if (Math.abs(velocityX) > MOMENTUM_THRESHOLD || Math.abs(velocityY) > MOMENTUM_THRESHOLD) {
                state.scrollX = Math.max(0, state.scrollX + velocityX);
                state.scrollY = Math.max(0, state.scrollY + velocityY);
                applyOffsets();
                momentumRafId = requestAnimationFrame(tick);
            } else {
                velocityX = 0;
                velocityY = 0;
                momentumRafId = null;
            }
        };

        momentumRafId = requestAnimationFrame(tick);
    };

    const root = runtime.createWidget({
        role: 'custom:scroll-view',
        key: options.key,
        enabled: !state.disabled,
        interactive: !state.disabled,
        focus: {
            focusable: !state.disabled,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'overlay',
            width: 320,
            height: 200,
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? theme.panelColor,
            borderColor: options.style?.borderColor ?? theme.borderColor,
            borderWidth: options.style?.borderWidth ?? theme.borderWidth,
            radius: options.style?.radius ?? theme.controlRadius,
            clip: true,
            ...(options.style ?? {}),
        },
        handlers: {
            wheel: (event) => {
                if (state.disabled) {
                    return false;
                }
                const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
                const dx = event.deltaX ?? 0;
                const dy = event.deltaY ?? 0;

                // Exponential moving average for velocity
                velocityX = velocityX * (1 - WHEEL_VELOCITY_SMOOTHING) + dx * WHEEL_VELOCITY_SMOOTHING;
                velocityY = velocityY * (1 - WHEEL_VELOCITY_SMOOTHING) + dy * WHEEL_VELOCITY_SMOOTHING;

                // Apply the scroll delta immediately
                state.scrollX = Math.max(0, state.scrollX + dx);
                state.scrollY = Math.max(0, state.scrollY + dy);
                applyOffsets();

                // Cancel any existing momentum animation
                if (momentumRafId !== null) {
                    cancelAnimationFrame(momentumRafId);
                    momentumRafId = null;
                }
                if (wheelTimeoutId !== null) {
                    clearTimeout(wheelTimeoutId);
                    wheelTimeoutId = null;
                }

                // Record time and schedule momentum start after wheel events stop
                lastWheelTime = now;
                wheelTimeoutId = setTimeout(() => {
                    wheelTimeoutId = null;
                    const elapsed = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    if (elapsed - lastWheelTime >= WHEEL_END_TIMEOUT - 10) {
                        startMomentum();
                    }
                }, WHEEL_END_TIMEOUT);

                return true;
            },
            keyDown: (event) => {
                if (state.disabled) {
                    return false;
                }
                switch (event.key) {
                    case 'PageDown':
                        state.scrollY = Math.max(0, state.scrollY + SCROLL_PAGE_STEP);
                        applyOffsets();
                        return true;
                    case 'PageUp':
                        state.scrollY = Math.max(0, state.scrollY - SCROLL_PAGE_STEP);
                        applyOffsets();
                        return true;
                    case 'Home':
                        state.scrollY = 0;
                        state.scrollX = 0;
                        applyOffsets();
                        return true;
                    case 'End':
                        clampToBoundsInternal();
                        applyOffsets();
                        return true;
                    default:
                        return false;
                }
            },
        },
    });
    const content = runtime.createWidget({
        role: 'container:scroll-content',
        layout: {
            position: 'absolute',
            inset: { top: 0, left: 0 },
            width: '100%',
            height: 'content',
            display: 'stack',
            direction: 'column',
            gap: DEFAULT_CONTENT_GAP,
            ...(options.contentLayout ?? {}),
            contentOffsetX: state.scrollX,
            contentOffsetY: state.scrollY,
        },
        style: {
            background: options.contentStyle?.background ?? '#00000000',
            ...(options.contentStyle ?? {}),
        },
    });

    attachToParent(runtime, options.parent, root);
    runtime.appendChild(root, content);

    // Per-frame scroll bookkeeping: remember which structural values were last
    // pushed so scroll ticks only translate boxes instead of re-laying out the
    // whole tree. NaN forces the first pass through the structural path.
    let lastDisabled = state.disabled;
    let lastThumbHeightV = NaN;
    let lastThumbTopV = NaN;
    let lastShowV: boolean | null = null;
    let lastThumbWidthH = NaN;
    let lastThumbLeftH = NaN;
    let lastShowH: boolean | null = null;

    // Scrollbar track/thumb widgets (assigned after factory creation)
    let scrollbarTrackV: number;
    let scrollbarThumbV: number;
    let scrollbarTrackH: number;
    let scrollbarThumbH: number;

    const applyOffsets = (): void => {
        if (state.disabled !== lastDisabled) {
            lastDisabled = state.disabled;
            runtime.updateWidget(root, {
                enabled: !state.disabled,
                interactive: !state.disabled,
                focus: {
                    focusable: !state.disabled,
                    ...(options.focus ?? {}),
                },
            });
        }
        // Scroll is a pure translation — dedicated path, no full relayout.
        runtime.setContentOffset(content, state.scrollX, state.scrollY);

        // Update scrollbar thumb positions and sizes
        const viewport = runtime.getLayoutBox(root);
        const contentBox = runtime.getLayoutBox(content);

        if (viewport.contentHeight > 0 && contentBox.height > 0) {
            const maxScrollY = Math.max(0, contentBox.height - viewport.contentHeight);
            const ratioY = maxScrollY > 0 ? state.scrollY / maxScrollY : 0;
            const thumbHeightRatio = viewport.contentHeight / contentBox.height;
            const thumbHeight = Math.max(20, viewport.contentHeight * thumbHeightRatio);
            const trackHeight = viewport.contentHeight - 8; // account for inset padding
            const thumbTop = ratioY * (trackHeight - thumbHeight) + 4; // +4 for track inset

            if (thumbHeight !== lastThumbHeightV || Number.isNaN(lastThumbTopV)) {
                runtime.updateWidget(scrollbarThumbV, {
                    layout: {
                        position: 'absolute',
                        width: '100%',
                        height: thumbHeight,
                        inset: { top: thumbTop },
                    },
                });
            } else {
                runtime.translateWidgetBox(scrollbarThumbV, 0, thumbTop - lastThumbTopV);
            }
            lastThumbHeightV = thumbHeight;
            lastThumbTopV = thumbTop;

            // Hide vertical scrollbar when content fits within viewport
            const showV = contentBox.height > viewport.contentHeight;
            if (showV !== lastShowV) {
                runtime.updateWidget(scrollbarTrackV, { enabled: showV });
                lastShowV = showV;
            }
        }

        if (viewport.contentWidth > 0 && contentBox.width > 0) {
            const maxScrollX = Math.max(0, contentBox.width - viewport.contentWidth);
            const ratioX = maxScrollX > 0 ? state.scrollX / maxScrollX : 0;
            const thumbWidthRatio = viewport.contentWidth / contentBox.width;
            const thumbWidth = Math.max(20, viewport.contentWidth * thumbWidthRatio);
            const trackWidth = viewport.contentWidth - 8;
            const thumbLeft = ratioX * (trackWidth - thumbWidth) + 4; // +4 for track inset

            if (thumbWidth !== lastThumbWidthH || Number.isNaN(lastThumbLeftH)) {
                runtime.updateWidget(scrollbarThumbH, {
                    layout: {
                        position: 'absolute',
                        height: '100%',
                        width: thumbWidth,
                        inset: { left: thumbLeft },
                    },
                });
            } else {
                runtime.translateWidgetBox(scrollbarThumbH, thumbLeft - lastThumbLeftH, 0);
            }
            lastThumbWidthH = thumbWidth;
            lastThumbLeftH = thumbLeft;

            // Hide horizontal scrollbar when content fits within viewport
            const showH = contentBox.width > viewport.contentWidth;
            if (showH !== lastShowH) {
                runtime.updateWidget(scrollbarTrackH, { enabled: showH });
                lastShowH = showH;
            }
        }
    };

    const clampToBoundsInternal = (): void => {
        const viewport = runtime.getLayoutBox(root);
        const contentBox = runtime.getLayoutBox(content);
        if (viewport.contentWidth <= 0 || viewport.contentHeight <= 0) {
            return;
        }
        state.scrollX = clamp(state.scrollX, 0, Math.max(0, contentBox.width - viewport.contentWidth));
        state.scrollY = clamp(state.scrollY, 0, Math.max(0, contentBox.height - viewport.contentHeight));
    };

    // Create scrollbars using the factory (after applyOffsets is defined)
    const verticalScrollbar = createScrollbar(runtime, 'vertical', state, cancelMomentum, applyOffsets);
    const horizontalScrollbar = createScrollbar(runtime, 'horizontal', state, cancelMomentum, applyOffsets);
    scrollbarTrackV = verticalScrollbar.track;
    scrollbarThumbV = verticalScrollbar.thumb;
    scrollbarTrackH = horizontalScrollbar.track;
    scrollbarThumbH = horizontalScrollbar.thumb;
    runtime.appendChild(root, scrollbarTrackV);
    runtime.appendChild(root, scrollbarTrackH);

    applyOffsets();

    return {
        root,
        content,
        scrollbarTrackV,
        scrollbarThumbV,
        scrollbarTrackH,
        scrollbarThumbH,
        getScroll() {
            return { x: state.scrollX, y: state.scrollY };
        },
        setScroll(x, y) {
            state.scrollX = Math.max(0, x);
            state.scrollY = Math.max(0, y);
            applyOffsets();
        },
        scrollBy(deltaX, deltaY) {
            state.scrollX = Math.max(0, state.scrollX + deltaX);
            state.scrollY = Math.max(0, state.scrollY + deltaY);
            applyOffsets();
        },
        clampToBounds() {
            clampToBoundsInternal();
            applyOffsets();
        },
        dispose() {
            if (momentumRafId !== null) {
                cancelAnimationFrame(momentumRafId);
                momentumRafId = null;
            }
            if (wheelTimeoutId !== null) {
                clearTimeout(wheelTimeoutId);
                wheelTimeoutId = null;
            }
            disposeWidget(runtime, root);
        },
    };
};