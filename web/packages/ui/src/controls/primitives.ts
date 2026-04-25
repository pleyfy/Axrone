import type { UIRuntime } from '../runtime';
import type { TextBlockInput } from '../types';
import type {
    UICanvasHandle,
    UICanvasOptions,
    UIBaseOptions,
    UILayoutHandle,
    UILayoutOptions,
    UIRichTextHandle,
    UIRichTextOptions,
    UIWidgetHandle,
} from './types';
import { attachToParent, createTextBlock, disposeWidget } from './internals';
import { resolveTheme } from './theme';

export const createUIWidget = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIBaseOptions = {}
): UIWidgetHandle => {
    const root = runtime.createWidget({
        role: options.role ?? 'container:widget',
        key: options.key,
        layout: options.layout,
        style: options.style,
        enabled: options.enabled,
        interactive: options.interactive,
        focus: options.focus,
    });

    attachToParent(runtime, options.parent, root);

    return {
        root,
        content: root,
        update(patch) {
            runtime.updateWidget(root, patch);
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };
};

export const createUILayout = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UILayoutOptions = {}
): UILayoutHandle => {
    const widget = createUIWidget(runtime, {
        ...options,
        role: options.role ?? 'container:layout',
        layout: {
            display: 'stack',
            direction: 'column',
            gap: 12,
            ...(options.layout ?? {}),
        },
    });

    return widget;
};

export const createUICanvas = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UICanvasOptions = {}
): UICanvasHandle => {
    const theme = resolveTheme(options.theme);
    const widget = createUIWidget(runtime, {
        ...options,
        role: options.role ?? 'container:canvas',
        focus: {
            scope: true,
            cycle: true,
            ...(options.focus ?? {}),
        },
        layout: {
            display: 'overlay',
            width: '100%',
            height: '100%',
            ...(options.layout ?? {}),
        },
        style: {
            background: options.style?.background ?? theme.canvasColor,
            ...(options.style ?? {}),
        },
    });

    return widget;
};

export const createUIRichText = <TRuntime>(
    runtime: UIRuntime<TRuntime>,
    options: UIRichTextOptions = {}
): UIRichTextHandle => {
    const theme = resolveTheme(undefined);
    let textStyle: Partial<Omit<TextBlockInput, 'value'>> = { ...(options.text ?? {}) };
    let value = options.value ?? '';

    const root = runtime.createWidget({
        role: options.role ?? 'text:rich',
        key: options.key,
        layout: {
            width: 'content',
            height: 'content',
            ...(options.layout ?? {}),
        },
        style: {
            color: options.style?.color ?? theme.textColor,
            ...(options.style ?? {}),
        },
        text: createTextBlock(
            runtime,
            value,
            theme,
            textStyle,
            options.style?.color ?? theme.textColor
        ),
        enabled: options.enabled,
        interactive: options.interactive,
        focus: options.focus,
    });

    attachToParent(runtime, options.parent, root);

    const apply = (): void => {
        runtime.updateWidget(root, {
            text: createTextBlock(runtime, value, theme, textStyle, options.style?.color ?? theme.textColor),
            style: {
                ...(options.style ?? {}),
                color: options.style?.color ?? theme.textColor,
            },
        });
    };

    return {
        root,
        getText() {
            return value;
        },
        setText(nextValue) {
            value = nextValue;
            apply();
        },
        updateText(patch) {
            textStyle = { ...textStyle, ...patch };
            apply();
        },
        dispose() {
            disposeWidget(runtime, root);
        },
    };
};