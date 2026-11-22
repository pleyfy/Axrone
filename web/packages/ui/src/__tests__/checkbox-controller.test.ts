import { describe, expect, it, vi } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import {
	CHECKBOX_TOGGLE_CONTROLLER_TYPE,
	checkboxToggleController,
	getCheckboxChecked,
} from '../controls/checkbox-controller';
import type { StrokeRenderCommand, WidgetId } from '../types';

const createCheckboxAssetJson = (
	props: Record<string, unknown>,
	boxImage?: Record<string, unknown>,
	markImage?: Record<string, unknown>,
): string =>
	JSON.stringify({
		id: 'ui.checkbox-test',
		name: 'checkbox-test',
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

const checkboxWidget = (runtime: UIRuntime): WidgetId =>
	runtime.getBoundWidget('checkbox')!;
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

const leaveCheckbox = (runtime: UIRuntime) => {
	runtime.dispatchInput(pointer('move', 0, 190));
};

describe('checkbox-toggle controller — backward compatibility (color mode)', () => {
	it('applies per-state background on box in color mode (default)', () => {
		const runtime = createRuntime({
			boxKey: 'checkbox-box',
			markKey: 'checkbox-mark',
			labelKey: 'checkbox-label',
			states: {
				normal: '#334155ff',
				hover: '#475569ff',
				checked: '#0a74daff',
			},
		});

		const snapshot = runtime.snapshot();
		const boxNode = snapshot.root.children[0].children[0];
		expect(boxNode.style.background).toBe('#334155ff');

		hoverCheckbox(runtime);
		runtime.commit();
		const hoverSnapshot = runtime.snapshot();
		const hoverBox = hoverSnapshot.root.children[0].children[0];
		expect(hoverBox.style.background).toBe('#475569ff');

		clickCheckbox(runtime);
		runtime.commit();
		const checkedSnapshot = runtime.snapshot();
		const checkedBox = checkedSnapshot.root.children[0].children[0];
		expect(checkedBox.style.background).toBe('#0a74daff');
	});

	it('shows and hides the mark on toggle (color mode)', () => {
		const runtime = createRuntime({
			boxKey: 'checkbox-box',
			markKey: 'checkbox-mark',
			labelKey: 'checkbox-label',
			markColor: '#ffffffff',
		});

		expect(getCheckboxChecked(runtime, checkboxWidget(runtime))).toBe(false);

		const beforeSnapshot = runtime.snapshot();
		const markBefore = beforeSnapshot.root.children[0].children[0].children[0];
		expect(markBefore.enabled).toBe(false);

		clickCheckbox(runtime);
		runtime.commit();
		expect(getCheckboxChecked(runtime, checkboxWidget(runtime))).toBe(true);

		const afterSnapshot = runtime.snapshot();
		const markAfter = afterSnapshot.root.children[0].children[0].children[0];
		expect(markAfter.enabled).toBe(true);
	});
});

describe('checkbox-toggle controller — tint mode', () => {
	it('patches box image.tint per state', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'tint',
				boxTints: {
					normal: '#334155ff',
					hover: '#475569ff',
					checked: '#0a74daff',
				},
			},
			{
				source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 },
				tint: '#334155ff',
			},
		);

		expect(runtime.getWidgetImageInput(boxWidget(runtime))?.tint).toBe('#334155ff');

		hoverCheckbox(runtime);
		runtime.commit();
		expect(runtime.getWidgetImageInput(boxWidget(runtime))?.tint).toBe('#475569ff');

		clickCheckbox(runtime);
		runtime.commit();
		expect(runtime.getWidgetImageInput(boxWidget(runtime))?.tint).toBe('#0a74daff');
	});

	it('patches mark image.tint when checked, hides when unchecked', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'tint',
				markTints: {
					normal: '#ffffffff',
					checked: '#ff0000ff',
				},
			},
			{ source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 } },
			{ source: { kind: 'texture', resourceId: 'mark.png', width: 12, height: 12 }, tint: '#ffffffff' },
		);

		const snapshot = runtime.snapshot();
		const markNode = snapshot.root.children[0].children[0].children[0];
		expect(markNode.enabled).toBe(false);

		clickCheckbox(runtime);
		runtime.commit();

		const checkedSnapshot = runtime.snapshot();
		const checkedMark = checkedSnapshot.root.children[0].children[0].children[0];
		expect(checkedMark.enabled).toBe(true);
		expect(runtime.getWidgetImageInput(markWidget(runtime))?.tint).toBe('#ff0000ff');
	});

	it('preserves existing image properties when patching tint', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'tint',
				boxTints: { hover: '#ff0000ff' },
			},
			{
				source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 },
				fit: 'fill',
				sampling: 'nearest',
				border: 4,
				tint: '#334155ff',
			},
		);

		hoverCheckbox(runtime);
		runtime.commit();

		const image = runtime.getWidgetImageInput(boxWidget(runtime));
		expect(image?.tint).toBe('#ff0000ff');
		expect((image?.source as { resourceId?: string })?.resourceId).toBe('box.png');
		expect(image?.fit).toBe('fill');
		expect(image?.sampling).toBe('nearest');
	});
});

describe('checkbox-toggle controller — sprite mode', () => {
	it('swaps box image.source per state and restores on normal', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'sprite',
				boxSprites: {
					normal: { kind: 'texture', resourceId: 'box_normal.png', width: 20, height: 20 },
					hover: { kind: 'texture', resourceId: 'box_hover.png', width: 20, height: 20 },
					checked: { kind: 'texture', resourceId: 'box_checked.png', width: 20, height: 20 },
				},
			},
			{
				source: { kind: 'texture', resourceId: 'box_normal.png', width: 20, height: 20 },
			},
		);

		const sourceId = () =>
			(runtime.getWidgetImageInput(boxWidget(runtime))?.source as { resourceId?: string })?.resourceId;

		expect(sourceId()).toBe('box_normal.png');

		hoverCheckbox(runtime);
		runtime.commit();
		expect(sourceId()).toBe('box_hover.png');

		clickCheckbox(runtime);
		runtime.commit();
		expect(sourceId()).toBe('box_checked.png');
	});

	it('swaps mark image.source when checked, hides when unchecked', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'sprite',
				boxSprites: {
					normal: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 },
					checked: { kind: 'texture', resourceId: 'box_on.png', width: 20, height: 20 },
				},
				markSprites: {
					checked: { kind: 'texture', resourceId: 'check_mark.png', width: 12, height: 12 },
				},
			},
			{ source: { kind: 'texture', resourceId: 'box.png', width: 20, height: 20 } },
			{ source: { kind: 'texture', resourceId: 'check_mark.png', width: 12, height: 12 } },
		);

		const beforeSnapshot = runtime.snapshot();
		const markBefore = beforeSnapshot.root.children[0].children[0].children[0];
		expect(markBefore.enabled).toBe(false);

		clickCheckbox(runtime);
		runtime.commit();

		const afterSnapshot = runtime.snapshot();
		const markAfter = afterSnapshot.root.children[0].children[0].children[0];
		expect(markAfter.enabled).toBe(true);
		expect(
			(runtime.getWidgetImageInput(markWidget(runtime))?.source as { resourceId?: string })?.resourceId,
		).toBe('check_mark.png');
	});

	it('restores original source from mount when state has no sprite entry', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'sprite',
				boxSprites: {
					checked: { kind: 'texture', resourceId: 'box_checked.png', width: 20, height: 20 },
				},
			},
			{ source: { kind: 'texture', resourceId: 'box_default.png', width: 20, height: 20 } },
		);

		const sourceId = () =>
			(runtime.getWidgetImageInput(boxWidget(runtime))?.source as { resourceId?: string })?.resourceId;

		expect(sourceId()).toBe('box_default.png');

		clickCheckbox(runtime);
		runtime.commit();
		expect(sourceId()).toBe('box_checked.png');

		clickCheckbox(runtime);
		runtime.commit();
		expect(sourceId()).toBe('box_default.png');
	});

	it('preserves shared image properties when swapping source', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'sprite',
				boxSprites: {
					hover: { kind: 'texture', resourceId: 'box_hover.png', width: 20, height: 20 },
				},
			},
			{
				source: { kind: 'texture', resourceId: 'box_normal.png', width: 20, height: 20 },
				fit: 'fill',
				sampling: 'nearest',
				border: { left: 4, top: 4, right: 4, bottom: 4 },
			},
		);

		hoverCheckbox(runtime);
		runtime.commit();

		const image = runtime.getWidgetImageInput(boxWidget(runtime));
		expect((image?.source as { resourceId?: string })?.resourceId).toBe('box_hover.png');
		expect(image?.fit).toBe('fill');
		expect(image?.sampling).toBe('nearest');
	});
});

describe('checkbox-toggle controller — sentinel previousBoxColor', () => {
	it('applies initial color directly without animation on first mount', () => {
		// Even with a non-zero transitionDuration the first applyVisuals must
		// skip animation (previousBoxColor starts as '' sentinel).
		const runtime = createRuntime({
			boxKey: 'checkbox-box',
			markKey: 'checkbox-mark',
			labelKey: 'checkbox-label',
			states: { normal: '#334155ff', hover: '#475569ff', checked: '#0a74daff' },
			transitionDuration: 0.5,
		});

		const snapshot = runtime.snapshot();
		const boxNode = snapshot.root.children[0].children[0];
		// Color applied immediately — no animation flash.
		expect(boxNode.style.background).toBe('#334155ff');
	});

	it('reads widget actual current color for animation from after cancellation', () => {
		const runtime = createRuntime({
			boxKey: 'checkbox-box',
			markKey: 'checkbox-mark',
			labelKey: 'checkbox-label',
			states: { normal: '#334155ff', hover: '#475569ff', checked: '#0a74daff' },
			transitionDuration: 1,
		});

		// Spy on getWidgetStyleInput to confirm it is consulted when starting
		// a color animation (the fix for rapid-toggle jump).
		const spy = vi.spyOn(runtime, 'getWidgetStyleInput');

		// Trigger a state change that enters the animation path.
		hoverCheckbox(runtime);
		runtime.commit();

		expect(spy).toHaveBeenCalledWith(boxWidget(runtime));
		spy.mockRestore();
	});
});

/**
 * Integration test using the real asset structure from Assets/UI-test.ui.json.
 * The mark child has corrupted absolute insets (left:375, top:188) that must be
 * zeroed by the controller. This proves S1+S2 fixes together resolve S3 (dead
 * clicks appear to produce no feedback because the mark is displaced and has no
 * tick shape).
 */
describe('checkbox-toggle controller — real asset integration', () => {
	const createRealWorldCheckboxAssetJson = (): string =>
		JSON.stringify({
			id: 'ui.UI/test',
			name: 'UI/test',
			version: 1,
			canvas: {
				referenceWidth: 1920,
				referenceHeight: 1080,
				scaleMode: 'match-width-or-height',
				matchBias: 0.45,
			},
			bindings: {
				root: 'root',
				'widget-13': 'widget-13',
				'widget-13-box': 'widget-13-box',
				'widget-13-mark': 'widget-13-mark',
				'widget-13-label': 'widget-13-label',
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
						key: 'widget-13',
						enabled: true,
						interactive: true,
						controller: 'checkbox-toggle',
						props: {
							isOn: false,
							indeterminate: false,
							markStyle: 'check',
							boxSize: 20,
							markSize: 14,
							markWeight: 2,
							markColor: '#ffffffff',
							boxKey: 'widget-13-box',
							markKey: 'widget-13-mark',
							labelKey: 'widget-13-label',
							states: {
								normal: '#334155ff',
								hover: '#475569ff',
								checked: '#0a74daff',
								disabled: '#1e293bff',
							},
							transition: 'animation',
							transitionDuration: 0.15,
							zoomScale: 0.9,
							labelPosition: 'right',
							labelGap: 8,
						},
						layout: {
							width: 120,
							height: 24,
							direction: 'row',
							alignItems: 'center',
							gap: 8,
							position: 'absolute',
							inset: { left: 372, top: 185 },
						},
						children: [
							{
								role: 'custom:checkbox-box',
								key: 'widget-13-box',
								enabled: true,
								interactive: false,
								layout: {
									width: 20,
									height: 20,
									display: 'overlay',
									shrink: 0,
									position: 'absolute',
									inset: { left: 0, top: 0 },
								},
								style: {
									background: '#334155ff',
									borderColor: '#475569ff',
									borderWidth: 1,
									radius: 4,
								},
								children: [
									{
										role: 'custom:checkbox-mark',
										key: 'widget-13-mark',
										enabled: true,
										interactive: false,
										layout: {
											position: 'absolute',
											width: 14,
											height: 14,
											anchor: {
												x: 0.5,
												y: 0.5,
												maxX: 0.5,
												maxY: 0.5,
												pivotX: 0.5,
												pivotY: 0.5,
											},
											// CORRUPTED: absolute canvas coordinates
											// from editor manipulation.
											inset: { left: 375, top: 188 },
										},
										style: { background: '#00000000', radius: 2 },
										children: [],
									},
								],
							},
							{
								role: 'text',
								key: 'widget-13-label',
								enabled: true,
								interactive: false,
								layout: {
									width: 'content',
									height: 'content',
									position: 'absolute',
									inset: { left: 28, top: 2 },
								},
								style: { color: '#e2e8f0ff' },
								text: { value: 'Checkbox', size: 16 },
								children: [],
							},
						],
					},
				],
			},
		});

	const createRealWorldRuntime = (): UIRuntime => {
		const runtime = new UIRuntime();
		runtime.registry.register(checkboxToggleController);
		runtime.loadFromAsset(
			deserializeUIAsset(createRealWorldCheckboxAssetJson()),
		);
		runtime.commit();
		return runtime;
	};

	const realWorldPointer = (phase: 'down' | 'up', x: number, y: number) =>
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

	const clickRealWorldCheckbox = (runtime: UIRuntime) => {
		runtime.dispatchInput(realWorldPointer('down', 382, 195));
		runtime.dispatchInput(realWorldPointer('up', 382, 195));
	};

	it('toggles checked state on pointer down+up despite corrupted asset insets', () => {
		const runtime = createRealWorldRuntime();
		const checkbox = runtime.getBoundWidget('widget-13')!;

		// Initially unchecked.
		expect(getCheckboxChecked(runtime, checkbox)).toBe(false);

		// Dispatch pointer down+up at the checkbox area.
		clickRealWorldCheckbox(runtime);
		runtime.commit();

		// State toggled to checked.
		expect(getCheckboxChecked(runtime, checkbox)).toBe(true);
	});

	it('zeros mark insets (overrides corrupted asset) so mark centers inside box', () => {
		const runtime = createRealWorldRuntime();

		// After mount, the controller should have zeroed the mark insets.
		const snapshot = runtime.snapshot();
		const checkboxNode = snapshot.root.children[0];
		const boxNode = checkboxNode.children[0];
		const markNode = boxNode.children[0];

		// The mark's layout inset must be zeroed by the controller.
		const markInset = markNode.layout?.inset as Record<string, number> | undefined;
		expect(markInset?.left ?? 0).toBe(0);
		expect(markInset?.top ?? 0).toBe(0);
	});

	it('emits stroke render commands for markStyle=check after toggle', () => {
		const runtime = createRealWorldRuntime();

		// Click to check.
		clickRealWorldCheckbox(runtime);

		// Commit and inspect frame commands.
		const frame = runtime.commit();
		const strokeCommands = frame.commands.filter(
			(cmd): cmd is StrokeRenderCommand => cmd.kind === 'stroke',
		);

		// At least one stroke command should be emitted (for the mark widget).
		expect(strokeCommands.length).toBeGreaterThanOrEqual(1);

		// The stroke command should carry check-mark stroke data.
		const markStroke = strokeCommands.find((cmd) => cmd.strokes.length > 0);
		expect(markStroke).toBeDefined();
		expect(markStroke!.strokes[0].points.length).toBe(3); // check = 3 points
	});

	it('emits the stroke command in widget pixel space and scales it with the canvas', () => {
		const runtime = createRealWorldRuntime();
		clickRealWorldCheckbox(runtime);

		const mark = runtime.getBoundWidget('widget-13-mark');
		expect(mark).not.toBeNull();

		// Reference-space geometry: the command rect is the mark's pixel box, so the
		// renderer maps normalized points through it instead of re-scaling twice.
		// commit() first so the layout pass runs after the mark transitions from
		// invisible→visible; reading getLayoutBox before commit would return stale
		// data from the previous layout pass (when the mark was still hidden).
		const reference = runtime.commit();
		const markRect = runtime.getLayoutBox(mark!);
		const referenceStroke = reference.commands.find(
			(cmd): cmd is StrokeRenderCommand => cmd.kind === 'stroke',
		);
		expect(referenceStroke, 'stroke command in reference frame').toBeDefined();
		expect(referenceStroke!.x).toBeCloseTo(markRect.x, 3);
		expect(referenceStroke!.y).toBeCloseTo(markRect.y, 3);
		expect(referenceStroke!.width).toBeCloseTo(markRect.width, 3);
		expect(referenceStroke!.height).toBeCloseTo(markRect.height, 3);

		// Viewport-space geometry: the canvas scale rides on `transform`, exactly as
		// it does for quads, so ticks land where the scaled layout says they should.
		const scaled = runtime.commitToViewport(3840, 2160);
		const scaledStroke = scaled.commands.find(
			(cmd): cmd is StrokeRenderCommand => cmd.kind === 'stroke',
		);
		const scaledQuad = scaled.commands.find((cmd) => cmd.kind === 'quad');
		expect(scaledStroke?.transform, 'stroke command carries the canvas transform').toBeDefined();
		expect(scaledStroke?.transform, 'stroke shares the quad canvas transform').toEqual(
			scaledQuad?.kind === 'quad' ? scaledQuad.transform : undefined,
		);
	});

	it('emits no stroke commands when unchecked (mark hidden)', () => {
		const runtime = createRealWorldRuntime();

		// Don't click — leave unchecked.
		const frame = runtime.commit();
		const strokeCommands = frame.commands.filter(
			(cmd): cmd is StrokeRenderCommand => cmd.kind === 'stroke',
		);

		// No stroke commands should be emitted for the unchecked mark.
		const markStrokes = strokeCommands.filter((cmd) => cmd.strokes.length > 0);
		expect(markStrokes.length).toBe(0);
	});
});

describe('checkbox-toggle controller — sprite mode surface', () => {
	const snapshotStyle = (runtime: UIRuntime, childIndex: number): Record<string, unknown> => {
		const box = runtime.snapshot().root.children[0]?.children[childIndex];
		return (box?.style ?? {}) as Record<string, unknown>;
	};
	const boxImage = {
		source: { kind: 'texture', resourceId: 'box_normal.png', width: 20, height: 20 },
	};
	const markImage = {
		source: { kind: 'texture', resourceId: 'mark_normal.png', width: 12, height: 12 },
	};

	it('suppresses the box fill and bleeds the box sprite', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'sprite',
				boxSprites: {
					normal: { kind: 'texture', resourceId: 'box_normal.png', width: 20, height: 20 },
				},
			},
			boxImage,
		);

		expect(snapshotStyle(runtime, 0).background).toBe('#00000000');
		expect(runtime.getWidgetImageInput(boxWidget(runtime))?.bleed).toBe(true);
	});

	it('restores the authored box fill when leaving sprite mode', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'sprite',
				boxSprites: {
					normal: { kind: 'texture', resourceId: 'box_normal.png', width: 20, height: 20 },
				},
			},
			boxImage,
		);

		runtime.updateWidget(checkboxWidget(runtime), { props: { transition: 'tint' } });
		runtime.commit();

		expect(snapshotStyle(runtime, 0).background).toBe('#334155ff');
		expect(runtime.getWidgetImageInput(boxWidget(runtime))?.bleed).toBe(false);
	});

	it('keeps the authored box fill when no box sprite is available', () => {
		const runtime = createRuntime({
			boxKey: 'checkbox-box',
			markKey: 'checkbox-mark',
			labelKey: 'checkbox-label',
			transition: 'sprite',
		});

		expect(snapshotStyle(runtime, 0).background).toBe('#334155ff');
		expect(runtime.getWidgetImageInput(boxWidget(runtime))).toBeNull();
	});

	it('bleeds the mark sprite when checked without touching the box fill', () => {
		const runtime = createRuntime(
			{
				boxKey: 'checkbox-box',
				markKey: 'checkbox-mark',
				labelKey: 'checkbox-label',
				transition: 'sprite',
				markSprites: {
					checked: { kind: 'texture', resourceId: 'mark_checked.png', width: 12, height: 12 },
				},
			},
			undefined,
			markImage,
		);

		clickCheckbox(runtime);
		runtime.commit();

		expect(runtime.getWidgetImageInput(markWidget(runtime))?.bleed).toBe(true);
		expect(
			(runtime.getWidgetImageInput(markWidget(runtime))?.source as { resourceId?: string })
				?.resourceId,
		).toBe('mark_checked.png');
		expect(snapshotStyle(runtime, 0).background).toBe('#334155ff');
	});
});
