import { describe, expect, it } from 'vitest';
import { UIRuntime } from '../runtime';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import {
	BUTTON_FEEDBACK_CONTROLLER_TYPE,
	buttonFeedbackController,
} from '../controls/button-controller';
import type { WidgetId } from '../types';

const createButtonAssetJson = (
	widgetConfig: Record<string, unknown>,
): string =>
	JSON.stringify({
		id: 'ui.button-test',
		name: 'button-test',
		version: 1,
		canvas: {
			referenceWidth: 400,
			referenceHeight: 200,
			scaleMode: 'fixed',
			matchBias: 0.5,
		},
		bindings: { root: 'root', button: 'button' },
		root: {
			role: 'root',
			key: 'root',
			enabled: true,
			interactive: false,
			layout: { display: 'overlay', width: '100%', height: '100%' },
			children: [
				{
					role: 'button',
					key: 'button',
					enabled: true,
					interactive: true,
					...widgetConfig,
					layout: {
						position: 'absolute',
						inset: { left: 50, top: 50 },
						width: 120,
						height: 40,
					},
					children: [],
				},
			],
		},
	});

const createRuntime = (
	widgetConfig: Record<string, unknown>,
): UIRuntime => {
	const runtime = new UIRuntime();
	runtime.registry.register(buttonFeedbackController);
	runtime.loadFromAsset(
		deserializeUIAsset(createButtonAssetJson(widgetConfig)),
	);
	runtime.commit();
	return runtime;
};

const buttonWidget = (runtime: UIRuntime): WidgetId =>
	runtime.getBoundWidget('button')!;

const pointer = (
	phase: 'down' | 'up' | 'move',
	x: number,
	y = 70,
) =>
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

const hoverSequence = (runtime: UIRuntime) => {
	runtime.dispatchInput(pointer('move', 110));
};

const pressSequence = (runtime: UIRuntime) => {
	runtime.dispatchInput(pointer('down', 110));
};

const releaseSequence = (runtime: UIRuntime) => {
	runtime.dispatchInput(pointer('up', 110));
};

const leaveSequence = (runtime: UIRuntime) => {
	runtime.dispatchInput(pointer('move', 0, 200));
};

const getImageInput = (runtime: UIRuntime, widget: WidgetId) =>
	runtime.getWidgetImageInput(widget);

const getStyleInput = (runtime: UIRuntime, widget: WidgetId) => {
	const snapshot = runtime.snapshot();
	const buttonNode = snapshot.root.children[0];
	return buttonNode?.style ?? {};
};

describe('button-feedback controller — backward compatibility', () => {
	it('applies per-state background colour in color mode (default)', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			props: {
				states: {
					normal: '#0a74daff',
					hover: '#1b85ebff',
					pressed: '#0554a0ff',
				},
			},
		});
		const widget = buttonWidget(runtime);

		hoverSequence(runtime);
		runtime.commit();
		expect(getStyleInput(runtime, widget).background).toBe('#1b85ebff');

		pressSequence(runtime);
		runtime.commit();
		expect(getStyleInput(runtime, widget).background).toBe('#0554a0ff');

		releaseSequence(runtime);
		leaveSequence(runtime);
		runtime.commit();
		expect(getStyleInput(runtime, widget).background).toBe('#0a74daff');
	});

	it('applies per-state opacity in opacity mode', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			props: {
				transition: 'opacity',
				states: { normal: '#0a74daff' },
			},
		});
		const widget = buttonWidget(runtime);

		hoverSequence(runtime);
		runtime.commit();
		expect(getStyleInput(runtime, widget).opacity).toBeCloseTo(0.85);

		pressSequence(runtime);
		runtime.commit();
		expect(getStyleInput(runtime, widget).opacity).toBeCloseTo(0.6);

		leaveSequence(runtime);
		runtime.commit();
		expect(getStyleInput(runtime, widget).opacity).toBeCloseTo(1);
	});
});

describe('button-feedback controller — tint mode', () => {
	it('patches image.tint per state when widget has an image', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			image: {
				source: { kind: 'texture', resourceId: 'btn.png', width: 120, height: 40 },
				fit: 'fill',
				tint: '#ffffffff',
			},
			props: {
				transition: 'tint',
				tints: {
					normal: '#ffffffff',
					hover: '#cccccccc',
					pressed: '#888888ff',
				},
			},
		});
		const widget = buttonWidget(runtime);

		expect(getImageInput(runtime, widget)?.tint).toBe('#ffffffff');

		hoverSequence(runtime);
		runtime.commit();
		expect(getImageInput(runtime, widget)?.tint).toBe('#cccccccc');

		pressSequence(runtime);
		runtime.commit();
		expect(getImageInput(runtime, widget)?.tint).toBe('#888888ff');

		releaseSequence(runtime);
		leaveSequence(runtime);
		runtime.commit();
		expect(getImageInput(runtime, widget)?.tint).toBe('#ffffffff');
	});

	it('preserves existing image properties when patching tint', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			image: {
				source: { kind: 'texture', resourceId: 'btn.png', width: 120, height: 40 },
				fit: 'contain',
				sampling: 'nearest',
				tint: '#ffffffff',
				border: 8,
			},
			props: {
				transition: 'tint',
				tints: { hover: '#ff0000ff' },
			},
		});
		const widget = buttonWidget(runtime);

		hoverSequence(runtime);
		runtime.commit();

		const image = getImageInput(runtime, widget);
		expect(image?.tint).toBe('#ff0000ff');
		expect((image?.source as { resourceId?: string })?.resourceId).toBe('btn.png');
		expect(image?.fit).toBe('contain');
		expect(image?.sampling).toBe('nearest');
	});

	it('falls back to white tint when state has no entry', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			image: {
				source: { kind: 'texture', resourceId: 'btn.png', width: 120, height: 40 },
				tint: '#ffffffff',
			},
			props: {
				transition: 'tint',
				tints: { hover: '#ff0000ff' },
			},
		});
		const widget = buttonWidget(runtime);

		pressSequence(runtime);
		runtime.commit();
		expect(getImageInput(runtime, widget)?.tint).toBe('#ffffffff');
	});
});

describe('button-feedback controller — sprite mode', () => {
	it('swaps image.source per state and restores original on normal', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			image: {
				source: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
				fit: 'fill',
			},
			props: {
				transition: 'sprite',
				sprites: {
					normal: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
					hover: { kind: 'texture', resourceId: 'btn_hover.png', width: 120, height: 40 },
					pressed: { kind: 'texture', resourceId: 'btn_pressed.png', width: 120, height: 40 },
				},
			},
		});
		const widget = buttonWidget(runtime);

		const sourceId = (w: WidgetId) =>
			(getImageInput(runtime, w)?.source as { resourceId?: string })?.resourceId;

		expect(sourceId(widget)).toBe('btn_normal.png');

		hoverSequence(runtime);
		runtime.commit();
		expect(sourceId(widget)).toBe('btn_hover.png');

		pressSequence(runtime);
		runtime.commit();
		expect(sourceId(widget)).toBe('btn_pressed.png');

		releaseSequence(runtime);
		leaveSequence(runtime);
		runtime.commit();
		expect(sourceId(widget)).toBe('btn_normal.png');
	});

	it('preserves shared image properties (fit, sampling, border) when swapping source', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			image: {
				source: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
				fit: 'fill',
				sampling: 'nearest',
				border: { left: 8, top: 8, right: 8, bottom: 8 },
			},
			props: {
				transition: 'sprite',
				sprites: {
					hover: { kind: 'texture', resourceId: 'btn_hover.png', width: 120, height: 40 },
				},
			},
		});
		const widget = buttonWidget(runtime);

		hoverSequence(runtime);
		runtime.commit();

		const image = getImageInput(runtime, widget);
		expect((image?.source as { resourceId?: string })?.resourceId).toBe('btn_hover.png');
		expect(image?.fit).toBe('fill');
		expect(image?.sampling).toBe('nearest');
	});

	it('restores original source from mount when state has no sprite entry', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			image: {
				source: { kind: 'texture', resourceId: 'btn_default.png', width: 120, height: 40 },
			},
			props: {
				transition: 'sprite',
				sprites: {
					hover: { kind: 'texture', resourceId: 'btn_hover.png', width: 120, height: 40 },
				},
			},
		});
		const widget = buttonWidget(runtime);

		const sourceId = (w: WidgetId) =>
			(getImageInput(runtime, w)?.source as { resourceId?: string })?.resourceId;

		expect(sourceId(widget)).toBe('btn_default.png');

		hoverSequence(runtime);
		runtime.commit();
		expect(sourceId(widget)).toBe('btn_hover.png');

		leaveSequence(runtime);
		runtime.commit();
		expect(sourceId(widget)).toBe('btn_default.png');
	});

	it('draws the sprite as the button surface (fill suppressed, image bled)', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			style: { background: '#0a74daff', borderColor: '#ffffffff', borderWidth: 2 },
			image: {
				source: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
			},
			props: {
				transition: 'sprite',
				sprites: {
					normal: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
				},
			},
		});
		const widget = buttonWidget(runtime);

		const style = getStyleInput(runtime, widget);
		expect(style.background).toBe('#00000000');
		expect(style.borderColor).toBe('#00000000');
		expect(style.borderWidth).toBe(0);
		expect(getImageInput(runtime, widget)?.bleed).toBe(true);
	});

	it('restores the authored fill when leaving sprite mode', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			style: { background: '#0a74daff', borderColor: '#ffffffff', borderWidth: 2 },
			image: {
				source: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
			},
			props: {
				transition: 'sprite',
				sprites: {
					normal: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
				},
			},
		});
		const widget = buttonWidget(runtime);

		runtime.updateWidget(widget, { props: { transition: 'none' } });
		runtime.commit();

		const style = getStyleInput(runtime, widget);
		expect(style.background).toBe('#0a74daff');
		expect(style.borderColor).toBe('#ffffffff');
		expect(style.borderWidth).toBe(2);
		expect(getImageInput(runtime, widget)?.bleed).toBe(false);
	});

	it('ends the sprite surface when the authored image is removed', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			style: { background: '#0a74daff' },
			image: {
				source: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
			},
			props: {
				transition: 'sprite',
				sprites: {
					normal: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
				},
			},
		});
		const widget = buttonWidget(runtime);
		expect(getStyleInput(runtime, widget).background).toBe('#00000000');

		runtime.updateWidget(widget, { image: null });
		runtime.commit();

		expect(getStyleInput(runtime, widget).background).toBe('#0a74daff');

		// A later pointer interaction must not resurrect the deleted image.
		hoverSequence(runtime);
		runtime.commit();
		expect(getImageInput(runtime, widget)).toBeNull();
	});

	it('keeps the authored fill when sprite mode has no usable source', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			style: { background: '#0a74daff' },
			props: { transition: 'sprite' },
		});
		const widget = buttonWidget(runtime);

		expect(getStyleInput(runtime, widget).background).toBe('#0a74daff');
		expect(getImageInput(runtime, widget)).toBeNull();
	});

	it('restores the authored fill, not a transient state color, after sprite mode', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			style: { background: '#0a74daff' },
			image: {
				source: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
			},
			props: {
				states: { normal: '#0a74daff', hover: '#1b85ebff' },
				sprites: {
					normal: { kind: 'texture', resourceId: 'btn_normal.png', width: 120, height: 40 },
				},
			},
		});
		const widget = buttonWidget(runtime);

		// Color mode writes the hover color into the widget style.
		hoverSequence(runtime);
		runtime.commit();
		expect(getStyleInput(runtime, widget).background).toBe('#1b85ebff');

		runtime.updateWidget(widget, { props: { transition: 'sprite' } });
		runtime.commit();
		runtime.updateWidget(widget, { props: { transition: 'none' } });
		runtime.commit();

		expect(getStyleInput(runtime, widget).background).toBe('#0a74daff');
	});

	it('supports material sources in sprite entries', () => {		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			image: {
				source: { kind: 'texture', resourceId: 'btn.png', width: 120, height: 40 },
			},
			props: {
				transition: 'sprite',
				sprites: {
					hover: {
						kind: 'material',
						materialId: 'ui_button_hover.mat',
						textureBinding: 'albedo',
						width: 120,
						height: 40,
					},
				},
			},
		});
		const widget = buttonWidget(runtime);

		hoverSequence(runtime);
		runtime.commit();

		const source = getImageInput(runtime, widget)?.source as {
			kind?: string;
			materialId?: string;
			textureBinding?: string;
		};
		expect(source?.kind).toBe('material');
		expect(source?.materialId).toBe('ui_button_hover.mat');
		expect(source?.textureBinding).toBe('albedo');
	});
});

describe('button-feedback controller — getWidgetImageInput', () => {
	it('returns null for widgets without an image', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			style: { background: '#0a74daff' },
		});
		const widget = buttonWidget(runtime);
		expect(runtime.getWidgetImageInput(widget)).toBeNull();
	});

	it('returns a clone of the image input (not a reference)', () => {
		const runtime = createRuntime({
			controller: BUTTON_FEEDBACK_CONTROLLER_TYPE,
			image: {
				source: { kind: 'texture', resourceId: 'btn.png', width: 120, height: 40 },
			},
		});
		const widget = buttonWidget(runtime);
		const first = runtime.getWidgetImageInput(widget);
		const second = runtime.getWidgetImageInput(widget);
		expect(first).toEqual(second);
		expect(first).not.toBe(second);
	});
});
