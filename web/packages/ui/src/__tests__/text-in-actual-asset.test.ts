import { describe, expect, it } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime } from '../index';
import { buttonFeedbackController } from '../controls/button-controller';
import { dropdownController } from '../controls/dropdown-controller';
import { radioGroupController } from '../controls/radio-group-controller';
import { checkboxController } from '../controls/checkbox-controller';
import { createTestFontAsset } from './test-font';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import * as fs from 'fs';
import * as path from 'path';

const prepareRuntime = () => {
    const runtime = new UIRuntime({ width: 1920, height: 1080 });
    runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
    runtime.registry.register(buttonFeedbackController);
    runtime.registry.register(dropdownController);
    runtime.registry.register(radioGroupController);
    if ((checkboxController as any)?.type) {
        runtime.registry.register(checkboxController as any);
    }
    return runtime;
};

describe('text rendering in composite widgets (regression)', () => {
    it('renders text inside BUTTON, dropdown trigger, and radio-item from actual test.ui.json', () => {
        const runtime = prepareRuntime();

        const jsonPath = path.resolve(__dirname, '../../../../../../Assets/test.ui.json');
        let assetJson: string;
        try {
            assetJson = fs.readFileSync(jsonPath, 'utf-8');
        } catch {
            // Skip if file not found (CI environment)
            return;
        }

        const asset = deserializeUIAsset(assetJson);
        runtime.loadFromAsset(asset);

        const frame = runtime.commit();
        const textCommands = frame.commands.filter((c) => c.kind === 'text');

        // btn-6-label ("Button") inside BUTTON must render with glyphs
        const btnText = textCommands.find((c) => c.kind === 'text' && c.layout.text === 'Button');
        expect(btnText, 'btn-6-label "Button" text command must exist').toBeDefined();
        if (btnText && btnText.kind === 'text') {
            expect(btnText.layout.glyphs.length, 'btn-6-label must have glyphs').toBeGreaterThan(0);
            expect(btnText.layout.lines.length, 'btn-6-label must be single line').toBe(1);
        }

        // drp-5-trigger-label ("Option 1") inside CONTAINER trigger must render
        const drpText = textCommands.find((c) => c.kind === 'text' && c.layout.text === 'Option 1');
        expect(drpText, 'drp-5-trigger-label "Option 1" text command must exist').toBeDefined();
        if (drpText && drpText.kind === 'text') {
            expect(drpText.layout.glyphs.length, 'drp-5-trigger-label must have glyphs').toBeGreaterThan(0);
            expect(drpText.layout.lines.length, 'drp-5-trigger-label must be single line').toBe(1);
        }

        // Radio labels ("Radio 1", "Radio 2", "Radio 3") must render on single lines
        const radioTexts = textCommands.filter((c) => c.kind === 'text' && c.layout.text?.startsWith('Radio'));
        expect(radioTexts.length, 'must find 3 radio labels').toBe(3);
        for (const cmd of radioTexts) {
            if (cmd.kind === 'text') {
                expect(cmd.layout.glyphs.length, `"${cmd.layout.text}" must have glyphs`).toBeGreaterThan(0);
                expect(cmd.layout.lines.length, `"${cmd.layout.text}" must be single line (no wrapping artifact)`).toBe(1);
            }
        }

        // chk-9-label ("Checkbox") must render
        const chkText = textCommands.find((c) => c.kind === 'text' && c.layout.text === 'Checkbox');
        expect(chkText, 'chk-9-label "Checkbox" text command must exist').toBeDefined();
        if (chkText && chkText.kind === 'text') {
            expect(chkText.layout.glyphs.length, 'chk-9-label must have glyphs').toBeGreaterThan(0);
        }
    });

    it('BUTTON background quad is emitted before child text command (draw order regression)', () => {
        const runtime = prepareRuntime();

        const jsonPath = path.resolve(__dirname, '../../../../../../Assets/test.ui.json');
        let assetJson: string;
        try {
            assetJson = fs.readFileSync(jsonPath, 'utf-8');
        } catch {
            return;
        }

        const asset = deserializeUIAsset(assetJson);
        runtime.loadFromAsset(asset);

        const frame = runtime.commit();

        // For each BUTTON label text command, verify that its parent button's
        // background quad appears BEFORE it in the sorted command list.
        const buttonLabels = ['Button'];
        for (const label of buttonLabels) {
            const textCmd = frame.commands.find(
                (c) => c.kind === 'text' && c.layout.text === label
            );
            expect(textCmd, `text command for "${label}" must exist`).toBeDefined();
            if (!textCmd || textCmd.kind !== 'text') continue;

            const textIndex = frame.commands.indexOf(textCmd);
            // Find the overlapping background quad (same z, earlier in list)
            const overlappingQuad = frame.commands.find((c) => {
                if (c.kind !== 'quad') return false;
                const quadIndex = frame.commands.indexOf(c);
                return (
                    quadIndex < textIndex &&
                    c.zIndex === textCmd.zIndex &&
                    textCmd.x >= c.x &&
                    textCmd.y >= c.y &&
                    textCmd.x < c.x + c.width &&
                    textCmd.y < c.y + c.height
                );
            });
            expect(
                overlappingQuad,
                `background quad for "${label}" must appear before text command`
            ).toBeDefined();
        }
    });
});
