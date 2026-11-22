import { describe, expect, it } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import { compileWidgetImage } from '../runtime/records';
import {
	CHECKBOX_TOGGLE_CONTROLLER_TYPE,
	checkboxToggleController,
} from '../controls/checkbox-controller';
import type { ImageRenderCommand, WidgetId } from '../types';

/**
 * DIAGNOSTIC TEST — Composite widget image rendering
 * Tests candidates C2, C3, C4, C5 from the bug report.
 *
 * C2: runtime record loses imageInput when controller calls runtime.updateWidget(box,{style|layout})
 * C3: host.isVisible/enabled skip (should only affect unchecked mark, not box)
 * C4: content dimensions <= 0 for the part (runtime-frame.ts L74)
 * C5: sprite-mode stale originalSource clobber (checkbox-controller.ts L136-182)
 */

const createCheckboxAssetJson = (
	props: Record<string, unknown>,
	boxImage?: Record<string, unknown>,
	markImage?: Record<string, unknown>,
): string =>
	JSON.stringify({
		id: 'ui.checkbox-diag',
		name: 'checkbox-diag',
		version: 1,
		canvas: {
			referenceWidth: 400,
			referenceHeight: 200,
			scaleMode: 'fixed',
			matchBias: 0.5,
		},
		bindings: {
			root: 'root',
			checkbox: 'checkbox',
			'checkbox-box': 'checkbox-box',
			'checkbox-mark': 'checkbox-mark',
			'checkbox-label': 'checkbox-label',
		},
		root: {
			role: 'root',
			key: 'root',
			enabled: true,
			interactive: false,
			layout: { display: 'overlay', width: '100%', height: '100%' },
			children: [
				{
					role: 'custom:checkbox',
					key: 'checkbox',
					enabled: true,
					interactive: true,
					controller: CHECKBOX_TOGGLE_CONTROLLER_TYPE,
					props,
					layout: {
						display: 'overlay',
						position: 'absolute',
						inset: { left: 20, top: 20 },
						width: 160,
						height: 24,
					},
					children: [
						{
							role: 'custom:checkbox-box',
							key: 'checkbox-box',
							enabled: true,
							interactive: false,
							image: boxImage ?? null,
							layout: {
								position: 'absolute',
								inset: { left: 0, top: 0 },
								width: 20,
								height: 20,
							},
							style: { background: '#334155ff', radius: 4 },
							children: [
								{
									role: 'custom:checkbox-mark',
									key: 'checkbox-mark',
									enabled: false,
									interactive: false,
									image: markImage ?? null,
									layout: {
										position: 'absolute',
										anchor: { x: 0.5, y: 0.5, pivotX: 0.5, pivotY: 0.5 },
										width: 12,
										height: 12,
									},
									style: { background: '#00000000' },
									children: [],
								},
							],
						},
						{
							role: 'text',
							key: 'checkbox-label',
							enabled: true,
							interactive: false,
							layout: {
								position: 'absolute',
								inset: { left: 28, top: 2 },
								width: 120,
								height: 20,
							},
							text: { value: 'Option', size: 12 },
							children: [],
						},
					],
				},
			],
		},
	});

const createRuntime = (
	props: Record<string, unknown>,
	boxImage?: Record<string, unknown>,
	markImage?: Record<string, unknown>,
): UIRuntime => {
	const runtime = new UIRuntime();
	runtime.registry.register(checkboxToggleController);
	runtime.loadFromAsset(
		deserializeUIAsset(createCheckboxAssetJson(props, boxImage, markImage)),
	);
	runtime.commit();
	return runtime;
};

const boxWidget = (runtime: UIRuntime): WidgetId =>
	runtime.getBoundWidget('checkbox-box')!;
const markWidget = (runtime: UIRuntime): WidgetId =>
	runtime.getBoundWidget('checkbox-mark')!;

const pointer = (phase: 'down' | 'up' | 'move', x: number, y = 30) =>
	({
		type: 'pointer' as const,
		phase,
		x,
		y,
		pointerId: 1,
		button: 0,
		buttons: phase === 'up' ? 0 : 1,
		deltaX: 0,
		deltaY: 0,
		altKey: false,
		ctrlKey: false,
		shiftKey: false,
		metaKey: false,
	});

const clickCheckbox = (runtime: UIRuntime) => {
	runtime.dispatchInput(pointer('down', 30));
	runtime.dispatchInput(pointer('up', 30));
};

const hoverCheckbox = (runtime: UIRuntime) => {
	runtime.dispatchInput(pointer('move', 30));
};

describe('[DIAG] Composite image rendering — C2: updateWidget preserves imageInput', () => {
	it('box image command persists after controller applies style.background (color mode)', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				states: {
					normal: '#334155ff',
					hover: '#475569ff',
					checked: '#0a74daff',
				},
			},
			{
				source: { kind: 'texture', resourceId: 'box_texture.png', width: 20, height: 20 },
				fit: 'fill',
			},
		);

		// Initial frame should have image command for box
		const initialFrame = runtime.commit();
		const initialImageCommands = initialFrame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);
		
		console.log('[DIAG-C2] Initial image commands:', initialImageCommands.length);
		for (const cmd of initialImageCommands) {
			const source = cmd.source as { kind: string; resourceId?: string };
			console.log(`[DIAG-C2]   - widget=${cmd.widget}, kind=${source.kind}, resourceId=${source.resourceId}`);
		}

		expect(initialImageCommands.length).toBeGreaterThan(0);
		const boxImageCmd = initialImageCommands.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box_texture.png'
		);
		expect(boxImageCmd).toBeDefined();

		// Simulate controller behavior: updateWidget with style only
		runtime.updateWidget(boxWidget(runtime), { style: { background: '#ff0000ff' } });
		const afterStyleFrame = runtime.commit();
		const afterStyleImages = afterStyleFrame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);
		
		console.log('[DIAG-C2] After style update image commands:', afterStyleImages.length);
		const boxImageAfterStyle = afterStyleImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box_texture.png'
		);
		expect(boxImageAfterStyle).toBeDefined();

		// Simulate controller behavior: updateWidget with layout only
		runtime.updateWidget(boxWidget(runtime), { layout: { width: 24, height: 24 } });
		const afterLayoutFrame = runtime.commit();
		const afterLayoutImages = afterLayoutFrame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);
		
		console.log('[DIAG-C2] After layout update image commands:', afterLayoutImages.length);
		const boxImageAfterLayout = afterLayoutImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box_texture.png'
		);
		expect(boxImageAfterLayout).toBeDefined();

		// Verify imageInput is preserved in the record
		const imageInput = runtime.getWidgetImageInput(boxWidget(runtime));
		console.log('[DIAG-C2] Final imageInput:', JSON.stringify(imageInput, null, 2));
		expect(imageInput?.source).toBeDefined();
		expect((imageInput?.source as { resourceId?: string })?.resourceId).toBe('box_texture.png');
	});
});

describe('[DIAG] Composite image rendering — C3: isVisible/enabled behavior', () => {
	it('mark with image + UNCHECKED → NO image command (visible:false contract)', () => {
		// After the fix, the checkbox controller hides the mark via style.visible:false
		// (not just enabled:false), so the engine's isVisible() check correctly
		// prevents the mark image from rendering when unchecked.
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'tint',
				markTints: { normal: '#ffffffff', checked: '#ff0000ff' },
			},
			{ source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 } },
			{ source: { kind: 'texture', resourceId: 'mark.png', width: 12, height: 12 }, tint: '#ffffffff' },
		);

		// Unchecked state: mark should be hidden via style.visible:false
		const uncheckedFrame = runtime.commit();
		const uncheckedImages = uncheckedFrame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);

		// Box image should be present
		const boxImageCmd = uncheckedImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box.png'
		);
		expect(boxImageCmd).toBeDefined();

		// Mark image should NOT be present (style.visible:false hides it)
		const markImageCmd = uncheckedImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'mark.png'
		);
		expect(markImageCmd).toBeUndefined();
	});

	it('mark with image + CHECKED → image command present', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'tint',
				markTints: { normal: '#ffffffff', checked: '#ff0000ff' },
			},
			{ source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 } },
			{ source: { kind: 'texture', resourceId: 'mark.png', width: 12, height: 12 }, tint: '#ffffffff' },
		);

		// Click to check
		clickCheckbox(runtime);
		const checkedFrame = runtime.commit();
		const checkedImages = checkedFrame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);

		// Mark image should be present when checked
		const markImageCmd = checkedImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'mark.png'
		);
		expect(markImageCmd).toBeDefined();
	});

	it('mark without image + checked → procedural strokes present, no image command', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				markStyle: 'check',
				markColor: '#ffffffff',
			},
			{ source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 } },
			// No mark image — procedural strokes only
		);

		// Click to check
		clickCheckbox(runtime);
		const checkedFrame = runtime.commit();
		const checkedImages = checkedFrame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);

		// Box image should be present
		const boxImageCmd = checkedImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box.png'
		);
		expect(boxImageCmd).toBeDefined();

		// No mark image command (procedural strokes, not texture)
		const markImageCmd = checkedImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'mark.png'
		);
		expect(markImageCmd).toBeUndefined();

		// Verify the mark widget has strokes set (procedural rendering)
		const markStyle = runtime.getWidgetStyleInput(markWidget(runtime));
		expect(markStyle?.strokes).toBeDefined();
		expect(markStyle!.strokes!.length).toBeGreaterThan(0);
	});

	it('style.visible:false prevents image rendering (correct way to hide)', () => {
		// This test verifies that style.visible:false correctly hides a widget
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
			},
			{ source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 } },
			{ source: { kind: 'texture', resourceId: 'mark.png', width: 12, height: 12 } },
		);

		// Hide the mark using style.visible
		runtime.updateWidget(markWidget(runtime), { style: { visible: false } });
		const frame = runtime.commit();
		const images = frame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);

		// Box image should be present
		const boxImageCmd = images.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box.png'
		);
		expect(boxImageCmd).toBeDefined();

		// Mark image should NOT be present (style.visible:false works)
		const markImageCmd = images.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'mark.png'
		);
		expect(markImageCmd).toBeUndefined();
	});
});

describe('[DIAG] Composite image rendering — C4: content dimensions', () => {
	it('box child has positive contentWidth/contentHeight for image rendering', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				boxSize: 20,
			},
			{
				source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 },
				fit: 'fill',
			},
		);

		const frame = runtime.commit();
		const box = runtime.getLayoutBox(boxWidget(runtime));
		
		console.log('[DIAG-C4] Box layout:', JSON.stringify(box, null, 2));
		console.log('[DIAG-C4] Box contentWidth:', box.contentWidth, 'contentHeight:', box.contentHeight);

		// Content dimensions must be > 0 for image to render
		expect(box.contentWidth).toBeGreaterThan(0);
		expect(box.contentHeight).toBeGreaterThan(0);

		// Image command should exist
		const imageCommands = frame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);
		const boxImageCmd = imageCommands.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box.png'
		);
		expect(boxImageCmd).toBeDefined();
	});
});

describe('[DIAG] Composite image rendering — C5: sprite-mode originalSource', () => {
	it('base image assigned AFTER mount is not clobbered when state changes', () => {
		// Create checkbox with NO initial box image
		const runtime = createRuntime({
			boxKey: 'checkbox-box',
			markKey: 'checkbox-mark',
			labelKey: 'checkbox-label',
			transition: 'sprite',
			boxSprites: {
				checked: { kind: 'texture', resourceId: 'box_checked.png', width: 20, height: 20 },
			},
			// No initial box image - will be assigned after mount
		});

		// Mount happened with originalBoxSource = null
		const stateBefore = runtime.getWidgetState(
			runtime.getBoundWidget('checkbox')!
		) as { originalBoxSource: unknown };
		expect(stateBefore.originalBoxSource).toBeNull();

		// Now assign an image to the box (simulating editor assignment after mount)
		runtime.updateWidget(boxWidget(runtime), {
			image: {
				source: { kind: 'texture', resourceId: 'box_assigned.png', width: 20, height: 20 },
				fit: 'fill',
			},
		});

		const frameBefore = runtime.commit();
		const imagesBefore = frameBefore.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);
		const assignedImageBefore = imagesBefore.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box_assigned.png'
		);
		expect(assignedImageBefore).toBeDefined();

		// Trigger a state change (hover) — should NOT clobber the assigned image
		hoverCheckbox(runtime);
		const frameAfter = runtime.commit();
		const imagesAfter = frameAfter.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);

		// HARD ASSERTION: After hover (no hover sprite defined), the assigned image
		// source resourceId must still equal the assigned base source.
		const assignedImageAfter = imagesAfter.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box_assigned.png'
		);
		expect(assignedImageAfter).toBeDefined();

		// Verify the widget's imageInput source is preserved
		const finalImageInput = runtime.getWidgetImageInput(boxWidget(runtime));
		expect(finalImageInput?.source).toBeDefined();
		expect((finalImageInput?.source as { resourceId?: string })?.resourceId).toBe('box_assigned.png');
	});

	it('sprite mode with empty sprites map preserves originalSource from mount', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'sprite',
				boxSprites: {}, // Empty sprites map
			},
			{
				source: { kind: 'texture', resourceId: 'box_original.png', width: 20, height: 20 },
			},
		);

		// originalBoxSource should be captured at mount
		const state = runtime.getWidgetState(
			runtime.getBoundWidget('checkbox')!
		) as { originalBoxSource: { kind: string; resourceId?: string } | null };
		expect(state.originalBoxSource).not.toBeNull();
		expect((state.originalBoxSource as { resourceId?: string })?.resourceId).toBe('box_original.png');

		// Trigger state change — should fall back to originalSource
		hoverCheckbox(runtime);
		const frame = runtime.commit();
		const images = frame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);
		
		const originalImage = images.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box_original.png'
		);
		expect(originalImage).toBeDefined();
	});

	it('with a state sprite present for hover, source equals the sprite source (not base)', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'sprite',
				boxSprites: {
					normal: { kind: 'texture', resourceId: 'box_normal_sprite.png', width: 20, height: 20 },
					hover: { kind: 'texture', resourceId: 'box_hover_sprite.png', width: 20, height: 20 },
				},
			},
			{
				source: { kind: 'texture', resourceId: 'box_base.png', width: 20, height: 20 },
			},
		);

		// Before hover: normal state sprite should be active
		const normalFrame = runtime.commit();
		const normalImages = normalFrame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);
		const normalSprite = normalImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box_normal_sprite.png'
		);
		expect(normalSprite).toBeDefined();

		// After hover: hover state sprite should replace normal
		hoverCheckbox(runtime);
		const hoverFrame = runtime.commit();
		const hoverImages = hoverFrame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);
		const hoverSprite = hoverImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box_hover_sprite.png'
		);
		expect(hoverSprite).toBeDefined();

		// The base image should NOT be the active source when a state sprite is present
		const baseImage = hoverImages.find(
			(cmd) => (cmd.source as { resourceId?: string }).resourceId === 'box_base.png'
		);
		expect(baseImage).toBeUndefined();
	});
});

describe('[DIAG] Composite image rendering — records guard: empty texture resourceId', () => {
	it('compileWidgetImage returns null for texture source with empty resourceId', () => {
		const result = compileWidgetImage({
			source: { kind: 'texture', resourceId: '', width: 20, height: 20 },
			fit: 'fill',
		});
		expect(result).toBeNull();
	});

	it('compileWidgetImage returns null for texture source with whitespace-only resourceId', () => {
		const result = compileWidgetImage({
			source: { kind: 'texture', resourceId: '   ', width: 20, height: 20 },
			fit: 'fill',
		});
		expect(result).toBeNull();
	});

	it('compileWidgetImage returns resolved image for non-empty texture resourceId', () => {
		const result = compileWidgetImage({
			source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 },
			fit: 'fill',
		});
		expect(result).not.toBeNull();
		expect(result!.source.kind).toBe('texture');
		expect((result!.source as { resourceId: string }).resourceId).toBe('box.png');
	});

	it('compileWidgetImage is unaffected for material-kind sources', () => {
		const result = compileWidgetImage({
			source: { kind: 'material', materialId: 'mat1', textureBinding: {}, width: 32, height: 32 },
			fit: 'fill',
		});
		expect(result).not.toBeNull();
		expect(result!.source.kind).toBe('material');
	});

	it('widget with empty texture resourceId produces no image command in frame', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
			},
			// Box with empty resourceId texture — should produce no image command
			{ source: { kind: 'texture', resourceId: '', width: 20, height: 20 } },
		);

		const frame = runtime.commit();
		const images = frame.commands.filter(
			(cmd): cmd is ImageRenderCommand => cmd.kind === 'image'
		);

		// No image command for the box with empty resourceId
		const boxImageCmd = images.find(
			(cmd) => (cmd.source as { kind: string }).kind === 'texture'
		);
		expect(boxImageCmd).toBeUndefined();
	});
});
