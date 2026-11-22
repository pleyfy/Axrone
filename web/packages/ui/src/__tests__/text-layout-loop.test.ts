import { describe, expect, it } from 'vitest';
import { TextLayoutEngine } from '../text';
import { FontRegistry } from '../font';
import { createTestFontAsset } from './test-font';
import type { ResolvedTextBlock } from '../types';

const makeBlock = (overrides: Partial<ResolvedTextBlock> = {}): ResolvedTextBlock => ({
	value: 'Hello',
	family: 'TestSans',
	size: 16,
	weight: 'normal',
	style: 'normal',
	color: { r: 1, g: 1, b: 1, a: 1 },
	align: 'start',
	wrap: 'word',
	overflow: 'ellipsis',
	maxLines: Number.MAX_SAFE_INTEGER,
	direction: 'auto',
	locale: '',
	letterSpacing: 0,
	lineHeight: 0,
	underline: false,
	underlineColor: { r: 0, g: 0, b: 0, a: 0 },
	underlineThickness: 1,
	underlineOffset: 0,
	strikeThrough: false,
	strikeThroughColor: { r: 0, g: 0, b: 0, a: 0 },
	strikeThroughThickness: 1,
	selectionStart: null,
	selectionEnd: null,
	selectionColor: { r: 0.3, g: 0.5, b: 1, a: 0.5 },
	caretIndex: null,
	caretColor: { r: 0, g: 0, b: 0, a: 0 },
	caretWidth: 2,
	caretInset: 0,
	spans: [],
	...overrides,
});

const createEngine = () => {
	const fonts = new FontRegistry();
	fonts.registerFace(createTestFontAsset('LayoutLoopTest'));
	return new TextLayoutEngine(fonts, { locale: 'en' });
};

describe('@axrone/ui text layout infinite-loop regression', () => {
	it('terminates when text ends with a single trailing space', () => {
		const engine = createEngine();
		const block = makeBlock({ value: 'Hello ' });
		const result = engine.measure(block);
		// Must produce at least one line and finish without OOM.
		expect(result.lines.length).toBeGreaterThanOrEqual(1);
		// The visible content "Hello" should be on the first line.
		expect(result.lines[0]!.start).toBe(0);
		// "Hello" = indices 0..4, trailing space at 5 is stripped from the line.
		expect(result.lines[0]!.end).toBe(5);
	});

	it('terminates when text ends with multiple trailing spaces', () => {
		const engine = createEngine();
		const block = makeBlock({ value: 'Hi   ' });
		const result = engine.measure(block);
		expect(result.lines.length).toBeGreaterThanOrEqual(1);
		// "Hi" = indices 0..1; trailing spaces at 2,3,4 are stripped.
		expect(result.lines[0]!.end).toBe(2);
	});

	it('terminates when text is only whitespace', () => {
		const engine = createEngine();
		const block = makeBlock({ value: '   ' });
		const result = engine.measure(block);
		// Must terminate and produce at least one (empty) line.
		expect(result.lines.length).toBeGreaterThanOrEqual(1);
		// All whitespace stripped → first line is empty (start === end).
		expect(result.lines[0]!.width).toBe(0);
	});

	it('handles whitespace followed by newline', () => {
		const engine = createEngine();
		const block = makeBlock({ value: ' \n' });
		const result = engine.measure(block);
		expect(result.lines.length).toBeGreaterThanOrEqual(1);
		// Must terminate; the newline cluster should be consumed.
		// The first line covers the space (stripped to empty), then newline advances cursor.
		expect(result.truncated).toBe(false);
	});

	it('produces correct line content for normal text without trailing space', () => {
		const engine = createEngine();
		const block = makeBlock({ value: 'Hello World' });
		const result = engine.measure(block);
		// Single line, no wrapping (unconstrained width).
		expect(result.lines.length).toBe(1);
		expect(result.lines[0]!.start).toBe(0);
		// "Hello World" = 11 grapheme clusters, all included.
		expect(result.lines[0]!.end).toBe(11);
		expect(result.lines[0]!.width).toBeGreaterThan(0);
	});

	it('handles text that is a single space', () => {
		const engine = createEngine();
		const block = makeBlock({ value: ' ' });
		const result = engine.measure(block);
		expect(result.lines.length).toBeGreaterThanOrEqual(1);
		// Single space → stripped → empty line, must terminate.
		expect(result.lines[0]!.width).toBe(0);
	});

	it('handles empty string', () => {
		const engine = createEngine();
		const block = makeBlock({ value: '' });
		const result = engine.measure(block);
		// Empty text → one vacuous line.
		expect(result.lines.length).toBe(1);
		expect(result.lines[0]!.width).toBe(0);
	});
});
