import { describe, expect, it } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime } from '../index';
import { createTestFontAsset } from './test-font';

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 1920, height: 1080 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    return runtime;
};

describe('text-in-composite-widget rendering', () => {
    it('renders text inside a button with width:content and padding', () => {
        const runtime = prepareRuntime();

        // Mimics cnt-2 > btn-6 > btn-6-label from test.ui.json
        const container = runtime.createWidget({
            layout: { width: 240, height: 'content', direction: 'column', gap: 8, padding: 8 },
        });
        const button = runtime.createWidget({
            role: 'button',
            layout: {
                width: 'content',
                height: 'content',
                padding: 12,
                direction: 'column',
                alignItems: 'center',
                justifyContent: 'center',
            },
            style: { background: '#0a74daff', radius: 8 },
        });
        const label = runtime.createWidget({
            layout: { width: 'content', height: 'content' },
            style: { color: '#ffffffff' },
            text: {
                value: 'Button',
                family: AXRONE_DEFAULT_UI_FONT_FAMILY,
                size: 16,
                weight: '600',
                lineHeight: 20.8,
                align: 'center',
                wrap: 'none',
                overflow: 'ellipsis',
            },
        });

        runtime.appendChild(runtime.root, container);
        runtime.appendChild(container, button);
        runtime.appendChild(button, label);

        const frame = runtime.commit();

        // Check layout boxes
        const buttonBox = runtime.getLayoutBox(button);
        const labelBox = runtime.getLayoutBox(label);

        console.log('button box:', JSON.stringify(buttonBox));
        console.log('label box:', JSON.stringify(labelBox));

        expect(buttonBox.width).toBeGreaterThan(0);
        expect(buttonBox.height).toBeGreaterThan(0);
        expect(labelBox.contentWidth).toBeGreaterThan(0);
        expect(labelBox.contentHeight).toBeGreaterThan(0);

        // Check text commands
        const textCommands = frame.commands.filter((c) => c.kind === 'text');
        console.log('text command count:', textCommands.length);
        for (const cmd of textCommands) {
            if (cmd.kind === 'text') {
                console.log('text cmd:', { x: cmd.x, y: cmd.y, glyphs: cmd.layout.glyphs.length, text: cmd.layout.text });
            }
        }

        expect(textCommands.length).toBeGreaterThan(0);
        const btnTextCmd = textCommands.find(
            (c) => c.kind === 'text' && c.layout.text === 'Button'
        );
        expect(btnTextCmd).toBeDefined();
        if (btnTextCmd && btnTextCmd.kind === 'text') {
            expect(btnTextCmd.layout.glyphs.length).toBeGreaterThan(0);
        }
    });

    it('renders text inside a container trigger (dropdown-like)', () => {
        const runtime = prepareRuntime();

        // Mimics drp-5 > drp-5-trigger > drp-5-trigger-label
        const dropdown = runtime.createWidget({
            layout: { width: 200, height: 'content', display: 'overlay' },
        });
        const trigger = runtime.createWidget({
            layout: {
                width: '100%',
                height: 36,
                padding: 10,
                direction: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
            },
            style: { background: '#1e293bff', radius: 6 },
        });
        const triggerLabel = runtime.createWidget({
            layout: { width: 'content', height: 'content' },
            style: { color: '#e2e8f0ff' },
            text: {
                value: 'Option 1',
                family: AXRONE_DEFAULT_UI_FONT_FAMILY,
                size: 14,
                lineHeight: 18.2,
                align: 'start',
                wrap: 'word',
                overflow: 'ellipsis',
            },
        });
        const chevron = runtime.createWidget({
            layout: { width: 'content', height: 'content' },
            style: { color: '#94a3b8ff' },
            text: {
                value: 'V',
                family: AXRONE_DEFAULT_UI_FONT_FAMILY,
                size: 12,
                lineHeight: 15.6,
            },
        });

        runtime.appendChild(runtime.root, dropdown);
        runtime.appendChild(dropdown, trigger);
        runtime.appendChild(trigger, triggerLabel);
        runtime.appendChild(trigger, chevron);

        const frame = runtime.commit();

        const triggerBox = runtime.getLayoutBox(trigger);
        const labelBox = runtime.getLayoutBox(triggerLabel);

        console.log('trigger box:', JSON.stringify(triggerBox));
        console.log('triggerLabel box:', JSON.stringify(labelBox));

        expect(triggerBox.contentWidth).toBeGreaterThan(0);
        expect(labelBox.contentWidth).toBeGreaterThan(0);

        const textCommands = frame.commands.filter((c) => c.kind === 'text');
        console.log('text command count:', textCommands.length);
        for (const cmd of textCommands) {
            if (cmd.kind === 'text') {
                console.log('text cmd:', { x: cmd.x, y: cmd.y, glyphs: cmd.layout.glyphs.length, text: cmd.layout.text });
            }
        }

        const optionCmd = textCommands.find(
            (c) => c.kind === 'text' && c.layout.text === 'Option 1'
        );
        expect(optionCmd).toBeDefined();
        if (optionCmd && optionCmd.kind === 'text') {
            expect(optionCmd.layout.glyphs.length).toBeGreaterThan(0);
        }
    });

    it('renders text inside a radio-item (row direction)', () => {
        const runtime = prepareRuntime();

        // Mimics rad-7-radio-0 with circle + label
        const radioItem = runtime.createWidget({
            layout: {
                display: 'stack',
                width: 'content',
                height: 'content',
                direction: 'row',
                alignItems: 'center',
                gap: 8,
            },
        });
        const circle = runtime.createWidget({
            layout: { width: 18, height: 18 },
        });
        const radioLabel = runtime.createWidget({
            layout: { width: 'content', height: 'content' },
            style: { color: '#e2e8f0ff' },
            text: {
                value: 'Radio 1',
                family: AXRONE_DEFAULT_UI_FONT_FAMILY,
                size: 14,
                lineHeight: 18.2,
                align: 'start',
                wrap: 'word',
                overflow: 'ellipsis',
            },
        });

        runtime.appendChild(runtime.root, radioItem);
        runtime.appendChild(radioItem, circle);
        runtime.appendChild(radioItem, radioLabel);

        const frame = runtime.commit();

        const labelBox = runtime.getLayoutBox(radioLabel);
        console.log('radioLabel box:', JSON.stringify(labelBox));

        expect(labelBox.contentWidth).toBeGreaterThan(0);

        const textCommands = frame.commands.filter((c) => c.kind === 'text');
        const radioTextCmd = textCommands.find(
            (c) => c.kind === 'text' && c.layout.text === 'Radio 1'
        );
        expect(radioTextCmd).toBeDefined();
        if (radioTextCmd && radioTextCmd.kind === 'text') {
            expect(radioTextCmd.layout.glyphs.length).toBeGreaterThan(0);
            // Check that "Radio 1" is on ONE line (no wrapping artifact)
            expect(radioTextCmd.layout.lines.length).toBe(1);
        }
    });

    it('REGRESSION: wrap:word + width:content + space-containing text stays single line', () => {
        const runtime = prepareRuntime();

        // Radio-item row: circle (18px) + gap(8) + label (width:content, wrap:word)
        const radioItem = runtime.createWidget({
            layout: {
                display: 'stack',
                width: 'content',
                height: 'content',
                direction: 'row',
                alignItems: 'center',
                gap: 8,
            },
        });
        const circle = runtime.createWidget({
            layout: { width: 18, height: 18 },
        });
        const radioLabel = runtime.createWidget({
            layout: { width: 'content', height: 'content' },
            text: {
                value: 'Radio 1',
                family: AXRONE_DEFAULT_UI_FONT_FAMILY,
                size: 14,
                lineHeight: 18.2,
                align: 'start',
                wrap: 'word',
                overflow: 'ellipsis',
            },
        });

        runtime.appendChild(runtime.root, radioItem);
        runtime.appendChild(radioItem, circle);
        runtime.appendChild(radioItem, radioLabel);

        const frame = runtime.commit();

        // (a) Layout phase: single line
        const labelBox = runtime.getLayoutBox(radioLabel);
        expect(labelBox.contentHeight, 'label contentHeight must be single-line').toBeLessThanOrEqual(18.2 * 1.5);

        // (a) Render phase: single line
        const textCmd = frame.commands.find(
            (c) => c.kind === 'text' && c.layout.text === 'Radio 1'
        );
        expect(textCmd, '"Radio 1" text command must exist').toBeDefined();
        if (textCmd && textCmd.kind === 'text') {
            expect(textCmd.layout.lines.length, '"Radio 1" must be 1 line in render phase').toBe(1);
        }

        // (c) Row stack height equals single-line label height (no overlap)
        const radioItemBox = runtime.getLayoutBox(radioItem);
        expect(radioItemBox.height, 'radio item height must accommodate single line only').toBeLessThanOrEqual(18.2 * 1.5);
    });

    it('REGRESSION: genuinely narrow fixed-width box still wraps text correctly', () => {
        const runtime = prepareRuntime();

        // A fixed-width box too narrow for "Radio 1" on one line → must wrap
        const narrowBox = runtime.createWidget({
            layout: { width: 40, height: 'content' },
        });
        const label = runtime.createWidget({
            layout: { width: '100%', height: 'content' },
            text: {
                value: 'Radio 1',
                family: AXRONE_DEFAULT_UI_FONT_FAMILY,
                size: 14,
                lineHeight: 18.2,
                align: 'start',
                wrap: 'word',
            },
        });

        runtime.appendChild(runtime.root, narrowBox);
        runtime.appendChild(narrowBox, label);

        const frame = runtime.commit();

        const textCmd = frame.commands.find(
            (c) => c.kind === 'text' && c.layout.text === 'Radio 1'
        );
        expect(textCmd, '"Radio 1" text command must exist').toBeDefined();
        if (textCmd && textCmd.kind === 'text') {
            // (b) Negative control: wrap still works in genuinely narrow box
            expect(textCmd.layout.lines.length, '"Radio 1" must wrap to 2 lines in 40px box').toBe(2);
        }
    });
});
