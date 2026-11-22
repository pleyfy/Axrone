import { describe, expect, it } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime } from '../index';
import { buttonFeedbackController, BUTTON_FEEDBACK_CONTROLLER_TYPE } from '../controls/button-controller';
import { dropdownController, DROPDOWN_SELECT_CONTROLLER_TYPE } from '../controls/dropdown-controller';
import { radioGroupController, RADIO_GROUP_CONTROLLER_TYPE } from '../controls/radio-group-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset } from '../types';

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 1920, height: 1080 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(buttonFeedbackController);
    runtime.registry.register(dropdownController);
    runtime.registry.register(radioGroupController);
    return runtime;
};

// Minimal asset: button with text child
const BUTTON_ASSET: UIAsset = {
    id: 'test-btn',
    name: 'test-btn',
    version: 1,
    canvas: { referenceWidth: 1920, referenceHeight: 1080, scaleMode: 'match-width-or-height', matchBias: 0.5 },
    bindings: {
        root: 'root',
        'btn-1': 'btn-1',
        'btn-1-label': 'btn-1-label',
    },
    root: {
        role: 'root',
        key: 'root',
        enabled: true,
        interactive: false,
        layout: { display: 'overlay', width: '100%', height: '100%' },
        children: [
            {
                role: 'button',
                key: 'btn-1',
                enabled: true,
                interactive: true,
                controller: 'button-feedback',
                props: {
                    states: { normal: '#0a74daff', hover: '#1b85ebff', pressed: '#085bb5ff', disabled: '#3a3a3aff' },
                    transition: 'color',
                },
                layout: { width: 'content', height: 'content', padding: 12, direction: 'column', alignItems: 'center', justifyContent: 'center' },
                style: { background: '#0a74daff', radius: 8 },
                children: [
                    {
                        role: 'text',
                        key: 'btn-1-label',
                        enabled: true,
                        interactive: false,
                        layout: { width: 'content', height: 'content' },
                        style: { color: '#ffffffff' },
                        text: {
                            value: 'Button',
                            family: 'TestSans',
                            size: 16,
                            weight: '600',
                            style: 'normal',
                            lineHeight: 20.8,
                            letterSpacing: 0,
                            align: 'center',
                            wrap: 'none',
                            overflow: 'ellipsis',
                        },
                        children: [],
                    },
                ],
            },
        ],
    },
} as unknown as UIAsset;

// Minimal asset: dropdown with trigger and trigger label
const DROPDOWN_ASSET: UIAsset = {
    id: 'test-drp',
    name: 'test-drp',
    version: 1,
    canvas: { referenceWidth: 1920, referenceHeight: 1080, scaleMode: 'match-width-or-height', matchBias: 0.5 },
    bindings: {
        root: 'root',
        'drp-1': 'drp-1',
        'drp-1-trigger': 'drp-1-trigger',
        'drp-1-trigger-label': 'drp-1-trigger-label',
    },
    root: {
        role: 'root',
        key: 'root',
        enabled: true,
        interactive: false,
        layout: { display: 'overlay', width: '100%', height: '100%' },
        children: [
            {
                role: 'custom:dropdown',
                key: 'drp-1',
                enabled: true,
                interactive: true,
                controller: 'dropdown-select',
                props: {
                    selectedIndex: 0,
                    options: ['Option 1', 'Option 2'],
                    triggerKey: 'drp-1-trigger-label',
                    popupKey: 'drp-1-popup',
                    itemContainerKey: 'drp-1-items',
                    chevronKey: 'drp-1-chevron',
                    placeholder: 'Select...',
                },
                layout: { width: 200, height: 'content', display: 'overlay' },
                children: [
                    {
                        role: 'container',
                        key: 'drp-1-trigger',
                        enabled: true,
                        interactive: false,
                        layout: {
                            width: '100%',
                            height: 36,
                            padding: 10,
                            direction: 'row',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                        },
                        style: { background: '#1e293bff', radius: 6 },
                        children: [
                            {
                                role: 'text',
                                key: 'drp-1-trigger-label',
                                enabled: true,
                                interactive: false,
                                layout: { width: 'content', height: 'content' },
                                style: { color: '#e2e8f0ff' },
                                text: {
                                    value: 'Option 1',
                                    family: 'TestSans',
                                    size: 14,
                                    weight: '400',
                                    style: 'normal',
                                    lineHeight: 18.2,
                                    letterSpacing: 0,
                                    align: 'start',
                                    wrap: 'word',
                                    overflow: 'ellipsis',
                                },
                                children: [],
                            },
                        ],
                    },
                ],
            },
        ],
    },
} as unknown as UIAsset;

describe('loadFromAsset text rendering', () => {
    it('renders text inside button loaded from asset', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(BUTTON_ASSET);

        const frame = runtime.commit();
        const textCommands = frame.commands.filter((c) => c.kind === 'text');
        console.log('[btn-asset] text commands:', textCommands.length);
        for (const cmd of textCommands) {
            if (cmd.kind === 'text') {
                console.log('  text:', cmd.layout.text, 'glyphs:', cmd.layout.glyphs.length, 'x:', cmd.x, 'y:', cmd.y);
            }
        }

        const btnText = textCommands.find((c) => c.kind === 'text' && c.layout.text === 'Button');
        expect(btnText).toBeDefined();
        if (btnText && btnText.kind === 'text') {
            expect(btnText.layout.glyphs.length).toBeGreaterThan(0);
        }
    });

    it('renders text inside dropdown trigger loaded from asset', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(DROPDOWN_ASSET);

        const frame = runtime.commit();
        const textCommands = frame.commands.filter((c) => c.kind === 'text');
        console.log('[drp-asset] text commands:', textCommands.length);
        for (const cmd of textCommands) {
            if (cmd.kind === 'text') {
                console.log('  text:', cmd.layout.text, 'glyphs:', cmd.layout.glyphs.length, 'x:', cmd.x, 'y:', cmd.y);
            }
        }

        const drpText = textCommands.find((c) => c.kind === 'text' && c.layout.text === 'Option 1');
        expect(drpText).toBeDefined();
        if (drpText && drpText.kind === 'text') {
            expect(drpText.layout.glyphs.length).toBeGreaterThan(0);
        }
    });

    it('renders text via commitToViewport after loadFromAsset', () => {
        const runtime = prepareRuntime();
        runtime.loadFromAsset(BUTTON_ASSET);

        const frame = runtime.commitToViewport(1920, 1080);
        const textCommands = frame.commands.filter((c) => c.kind === 'text');
        console.log('[viewport] text commands:', textCommands.length);
        for (const cmd of textCommands) {
            if (cmd.kind === 'text') {
                console.log('  text:', cmd.layout.text, 'glyphs:', cmd.layout.glyphs.length);
            }
        }

        const btnText = textCommands.find((c) => c.kind === 'text' && c.layout.text === 'Button');
        expect(btnText).toBeDefined();
        if (btnText && btnText.kind === 'text') {
            expect(btnText.layout.glyphs.length).toBeGreaterThan(0);
        }
    });
});
