import { describe, expect, it } from 'vitest';
import {
    UIRuntime,
    createUIButton,
    createUICanvas,
    createUIEditBox,
    createUILayout,
    createUIPageView,
    createUIProgressBar,
    createUIRichText,
    createUIScrollView,
    createUISlider,
    createUIToggle,
    createUIWidget,
    createFallbackUIFontAsset,
} from '../index';

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 480, height: 240 });
    runtime.fonts.registerFace(createFallbackUIFontAsset());
    return runtime;
};

describe('@axrone/ui controls', () => {
    it('builds a professional widget hierarchy on top of canvas and layout helpers', () => {
        const runtime = prepareRuntime();
        const canvas = createUICanvas(runtime, { style: { background: '#0b1323ff' } });
        const layout = createUILayout(runtime, {
            parent: canvas,
            layout: {
                position: 'absolute',
                anchor: 'center',
                width: 320,
                height: 'content',
                padding: 18,
                gap: 12,
            },
            style: {
                background: '#111827ee',
                borderColor: '#67e8f9aa',
                borderWidth: 1,
                radius: 18,
            },
        });

        createUIRichText(runtime, {
            parent: layout,
            value: 'Axrone UI Studio',
            text: {
                size: 18,
                underline: true,
                underlineColor: '#67e8f9ff',
            },
        });
        createUIButton(runtime, {
            parent: layout,
            label: 'Launch',
            variant: 'primary',
        });
        createUIProgressBar(runtime, {
            parent: layout,
            label: 'Loading',
            value: 0.72,
            min: 0,
            max: 1,
        });

        const frame = runtime.commit();

        expect(runtime.getWidgetCount()).toBeGreaterThanOrEqual(8);
        expect(frame.commands.filter((command) => command.kind === 'text').length).toBeGreaterThan(1);
        expect(frame.commands.filter((command) => command.kind === 'quad').length).toBeGreaterThan(4);
    });

    it('handles button presses and toggle state changes through the retained runtime', () => {
        const runtime = prepareRuntime();
        let pressed = 0;
        const button = createUIButton(runtime, {
            label: 'Play',
            variant: 'primary',
            onPress: () => {
                pressed += 1;
            },
        });
        const toggle = createUIToggle(runtime, {
            parent: button.root,
            label: 'Enabled',
            checked: false,
        });

        runtime.commit();

        const buttonBox = runtime.getLayoutBox(button.root);
        runtime.dispatchInput({
            type: 'pointer',
            phase: 'move',
            x: buttonBox.x + 4,
            y: buttonBox.y + 4,
        });
        runtime.dispatchInput({
            type: 'pointer',
            phase: 'down',
            x: buttonBox.x + 8,
            y: buttonBox.y + 8,
        });
        runtime.dispatchInput({
            type: 'pointer',
            phase: 'up',
            x: buttonBox.x + 8,
            y: buttonBox.y + 8,
        });

        const toggleBox = runtime.getLayoutBox(toggle.root);
        runtime.dispatchInput({
            type: 'pointer',
            phase: 'down',
            x: toggleBox.x + 8,
            y: toggleBox.y + 8,
        });
        runtime.dispatchInput({
            type: 'pointer',
            phase: 'up',
            x: toggleBox.x + 8,
            y: toggleBox.y + 8,
        });

        expect(pressed).toBe(1);
        expect(toggle.isChecked()).toBe(true);
    });

    it('supports edit-box text entry, caret movement, slider keyboard input and content scrolling', () => {
        const runtime = prepareRuntime();
        const layout = createUILayout(runtime, {
            layout: {
                width: 340,
                padding: 12,
                gap: 14,
            },
        });
        const input = createUIEditBox(runtime, {
            parent: layout,
            value: '',
            placeholder: 'Search',
        });
        const slider = createUISlider(runtime, {
            parent: layout,
            label: 'Opacity',
            min: 0,
            max: 100,
            step: 5,
            value: 25,
        });
        const scroll = createUIScrollView(runtime, {
            parent: layout,
            layout: {
                width: 180,
                height: 72,
            },
        });
        const item = createUIWidget(runtime, {
            parent: scroll,
            layout: {
                width: '100%',
                height: 48,
            },
            style: {
                background: '#1f2937ff',
            },
        });
        createUIWidget(runtime, {
            parent: scroll,
            layout: {
                width: '100%',
                height: 48,
            },
            style: {
                background: '#273449ff',
            },
        });

        runtime.commit();
        runtime.setFocus(input.root);
        runtime.dispatchInput({ type: 'text', text: 'abc' });
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowLeft' });
        runtime.dispatchInput({ type: 'text', text: 'Z' });
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'Backspace' });

        const editingFrame = runtime.commit();
        const caretQuad = editingFrame.commands.find(
            (command) => command.kind === 'quad' && command.width === 2,
        );
        expect(caretQuad).toBeDefined();

        runtime.setFocus(slider.root);
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'ArrowRight' });
        runtime.dispatchInput({ type: 'key', phase: 'down', key: 'PageUp' });

        const beforeScroll = runtime.getLayoutBox(item.root);
        scroll.setScroll(0, 18);
        runtime.commit();
        const afterScroll = runtime.getLayoutBox(item.root);

        expect(input.getValue()).toBe('abc');
        expect(slider.getValue()).toBe(80);
        expect(afterScroll.y).toBeLessThan(beforeScroll.y);
    });

    it('switches page visibility cleanly in the page-view container', () => {
        const runtime = prepareRuntime();
        const pageView = createUIPageView(runtime, {
            layout: {
                width: 220,
                height: 96,
            },
        });
        const firstPage = createUIWidget(runtime, {
            layout: {
                width: '100%',
                height: '100%',
            },
            style: {
                background: '#0f766eff',
            },
        });
        const secondPage = createUIWidget(runtime, {
            layout: {
                width: '100%',
                height: '100%',
            },
            style: {
                background: '#7c3aedff',
            },
        });

        pageView.addPage(firstPage.root);
        pageView.addPage(secondPage.root);
        runtime.commit();

        pageView.setPage(1);
        const frame = runtime.commit();

        expect(pageView.getPage()).toBe(1);
        expect(frame.commands.some((command) => command.widget === secondPage.root)).toBe(true);
        expect(frame.commands.some((command) => command.widget === firstPage.root)).toBe(false);
    });
});