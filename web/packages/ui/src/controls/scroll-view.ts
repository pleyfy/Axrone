import type { UIRuntime } from '../runtime';
import type { UIScrollViewHandle, UIScrollViewOptions } from './types';
import { attachToParent, clamp, disposeWidget } from './internals';
import { resolveTheme } from './theme';

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
                state.scrollX = Math.max(0, state.scrollX + (event.deltaX ?? 0));
                state.scrollY = Math.max(0, state.scrollY + (event.deltaY ?? 0));
                applyOffsets();
                return true;
            },
            keyDown: (event) => {
                if (state.disabled) {
                    return false;
                }
                switch (event.key) {
                    case 'PageDown':
                        state.scrollY = Math.max(0, state.scrollY + 64);
                        applyOffsets();
                        return true;
                    case 'PageUp':
                        state.scrollY = Math.max(0, state.scrollY - 64);
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
            gap: 10,
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

    const applyOffsets = (): void => {
        runtime.updateWidget(root, {
            enabled: !state.disabled,
            interactive: !state.disabled,
            focus: {
                focusable: !state.disabled,
                ...(options.focus ?? {}),
            },
        });
        runtime.updateWidget(content, {
            layout: {
                ...(options.contentLayout ?? {}),
                position: 'absolute',
                inset: { top: 0, left: 0 },
                width: options.contentLayout?.width ?? '100%',
                height: options.contentLayout?.height ?? 'content',
                display: options.contentLayout?.display ?? 'stack',
                direction: options.contentLayout?.direction ?? 'column',
                gap: options.contentLayout?.gap ?? 10,
                contentOffsetX: state.scrollX,
                contentOffsetY: state.scrollY,
            },
        });
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

    applyOffsets();

    return {
        root,
        content,
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
            disposeWidget(runtime, root);
        },
    };
};