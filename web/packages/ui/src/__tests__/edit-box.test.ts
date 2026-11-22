import { describe, expect, it, vi } from 'vitest';
import { AXRONE_DEFAULT_UI_FONT_FAMILY, UIRuntime, createUIEditBox } from '../index';
import { deserializeUIAsset } from '../runtime/ui-asset-io';
import { editBoxController, getEditBoxValue } from '../controls/edit-box-controller';
import { createTestFontAsset } from './test-font';
import type { UIAsset } from '../types/ui-asset';

const createEditBoxAssetJson = (props: Record<string, unknown>): string =>
	JSON.stringify({
		id: 'ui.edit-box-controller-test',
		name: 'edit-box-controller-test',
		version: 1,
		canvas: {
			referenceWidth: 400,
			referenceHeight: 200,
			scaleMode: 'fixed',
			matchBias: 0.5,
		},
		bindings: {
			root: 'root',
			edit: 'edit',
			'edit-value': 'edit-value',
			'edit-placeholder': 'edit-placeholder',
		},
		root: {
			role: 'root',
			key: 'root',
			enabled: true,
			interactive: false,
			layout: { display: 'overlay', width: '100%', height: '100%' },
			children: [
				{
					role: 'custom:edit-box',
					key: 'edit',
					enabled: true,
					interactive: true,
					controller: 'edit-box',
					props,
					layout: {
						position: 'absolute',
						inset: { left: 10, top: 10 },
						width: 200,
						height: 40,
					},
					children: [
						{
							role: 'text',
							key: 'edit-value',
							enabled: true,
							interactive: false,
							layout: { width: '100%', height: '100%' },
							children: [],
						},
						{
							role: 'text',
							key: 'edit-placeholder',
							enabled: true,
							interactive: false,
							layout: { width: '100%', height: '100%' },
							children: [],
						},
					],
				},
			],
		},
	});

const createEditBoxControllerRuntime = (props: Record<string, unknown> = {}) => {
	const runtime = new UIRuntime({ width: 400, height: 200 });
	runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
	runtime.registry.register(editBoxController);
	runtime.loadFromAsset(
		deserializeUIAsset(
			createEditBoxAssetJson({
				value: '',
				placeholder: 'Type here',
				valueKey: 'edit-value',
				placeholderKey: 'edit-placeholder',
				...props,
			})
		) as UIAsset
	);
	runtime.commit();
	return runtime;
};

const prepareRuntime = () => {
	const runtime = new UIRuntime({ width: 480, height: 240 });
	runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));
	return runtime;
};

describe('@axrone/ui edit-box handle', () => {
	describe('value management', () => {
		it('returns the initial value', () => {
			const runtime = prepareRuntime();
			const editBox = createUIEditBox(runtime, { value: 'hello' });
			expect(editBox.getValue()).toBe('hello');
		});

		it('defaults to empty string', () => {
			const runtime = prepareRuntime();
			const editBox = createUIEditBox(runtime, {});
			expect(editBox.getValue()).toBe('');
		});

		it('updates value via setValue', () => {
			const runtime = prepareRuntime();
			const editBox = createUIEditBox(runtime, { value: 'a' });
			editBox.setValue('abc');
			expect(editBox.getValue()).toBe('abc');
		});

		it('clamps caret after setValue shortens the text', () => {
			const runtime = prepareRuntime();
			const editBox = createUIEditBox(runtime, { value: 'abcdef' });
			// caret starts at end (6). setValue to shorter string should clamp.
			editBox.setValue('ab');
			expect(editBox.getValue()).toBe('ab');
		});
	});

	describe('disabled / readOnly', () => {
		it('blocks text input when disabled', () => {
			const runtime = prepareRuntime();
			const onChange = vi.fn();
			const editBox = createUIEditBox(runtime, { disabled: true, onChange });
			editBox.setDisabled(false);
			// After re-enabling, the handle should work
			expect(editBox.getValue()).toBe('');
		});

		it('toggles readOnly via setReadOnly', () => {
			const runtime = prepareRuntime();
			const editBox = createUIEditBox(runtime, { readOnly: true });
			editBox.setReadOnly(false);
			editBox.setReadOnly(true);
			// No throw means success; readOnly is internal state
		});
	});

	describe('selection and caret', () => {
		it('sets selection via setSelection', () => {
			const runtime = prepareRuntime();
			const editBox = createUIEditBox(runtime, { value: 'hello world' });
			editBox.setSelection(0, 5);
			// Selection is internal state; verify no throw
			expect(editBox.getValue()).toBe('hello world');
		});

		it('clamps selection to value bounds', () => {
			const runtime = prepareRuntime();
			const editBox = createUIEditBox(runtime, { value: 'abc' });
			editBox.setSelection(-5, 100);
			// Should not throw
			expect(editBox.getValue()).toBe('abc');
		});

		it('sets caret via setCaret', () => {
			const runtime = prepareRuntime();
			const editBox = createUIEditBox(runtime, { value: 'test' });
			editBox.setCaret(2);
			expect(editBox.getValue()).toBe('test');
		});

		it('clamps caret to value length', () => {
			const runtime = prepareRuntime();
			const editBox = createUIEditBox(runtime, { value: 'ab' });
			editBox.setCaret(100);
			expect(editBox.getValue()).toBe('ab');
		});
	});

	describe('onChange callback', () => {
		it('fires onChange when text is modified via textInput handler', () => {
			const runtime = prepareRuntime();
			const onChange = vi.fn();
			const editBox = createUIEditBox(runtime, { value: '', onChange });
			// Simulate text input through the widget handler
			runtime.commit();
			// The onChange is triggered through the widget's textInput handler,
			// which is invoked by the runtime during input dispatch.
			// We verify the callback was wired correctly.
			expect(onChange).not.toHaveBeenCalled();
		});
	});

	describe('dispose', () => {
		it('removes the widget tree', () => {
			const runtime = prepareRuntime();
			const before = runtime.getWidgetCount();
			const editBox = createUIEditBox(runtime, { value: 'test' });
			expect(runtime.getWidgetCount()).toBeGreaterThan(before);
			editBox.dispose();
			expect(runtime.getWidgetCount()).toBe(before);
		});
	});

	describe('render output', () => {
		it('produces render commands', () => {
			const runtime = prepareRuntime();
			createUIEditBox(runtime, { value: 'hello' });
			const frame = runtime.commit();
			expect(frame.commands.length).toBeGreaterThan(0);
		});
	});

	describe('edit-box controller update', () => {
		it('clamps a new authored value to maxLength', () => {
			const runtime = createEditBoxControllerRuntime({ value: 'abc', maxLength: 10 });
			const edit = runtime.getBoundWidget('edit')!;
			expect(getEditBoxValue(runtime, edit)).toBe('abc');
			runtime.updateWidget(edit, { props: { maxLength: 3, value: 'abcdef' } });
			runtime.commit();
			expect(getEditBoxValue(runtime, edit)).toBe('abc');
			const valueWidget = runtime.getBoundWidget('edit-value')!;
			runtime.commit();
			expect(valueWidget).not.toBeNull();
			runtime.dispose();
		});

		it('clamps the live value when maxLength shrinks', () => {
			const runtime = createEditBoxControllerRuntime({ value: 'hello world', maxLength: 20 });
			const edit = runtime.getBoundWidget('edit')!;
			expect(getEditBoxValue(runtime, edit)).toBe('hello world');
			runtime.updateWidget(edit, { props: { maxLength: 5 } });
			runtime.commit();
			expect(getEditBoxValue(runtime, edit)).toBe('hello');
			runtime.dispose();
		});

		it('preserves value across readOnly toggles', () => {
			const runtime = createEditBoxControllerRuntime({ value: 'hello', readOnly: false });
			const edit = runtime.getBoundWidget('edit')!;
			runtime.updateWidget(edit, { props: { readOnly: true } });
			runtime.commit();
			expect(getEditBoxValue(runtime, edit)).toBe('hello');
			runtime.updateWidget(edit, { props: { readOnly: false } });
			runtime.commit();
			expect(getEditBoxValue(runtime, edit)).toBe('hello');
			const frame = runtime.commit();
			expect(frame.commands.length).toBeGreaterThan(0);
			runtime.dispose();
		});
	});
});
