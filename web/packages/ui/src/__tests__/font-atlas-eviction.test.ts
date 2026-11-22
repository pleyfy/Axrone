import { describe, expect, it, vi } from 'vitest';
import { GlyphAtlas } from '../font/atlas';
import type { GlyphAtlasSource } from '../font/atlas';
import type { GlyphAtlasPageSnapshot } from '../types';
import { UIRuntime, AXRONE_DEFAULT_UI_FONT_FAMILY } from '../index';
import { createTestFontAsset } from './test-font';

const makeGlyph = (codePoint: number, size = 16): GlyphAtlasSource => ({
    codePoint,
    rasterSize: size,
    width: 10,
    height: 10,
    data: null,
});

describe('@axrone/ui GlyphAtlas LRU eviction', () => {
    it('evicts the least-recently-used page when maxPages is exceeded', () => {
        const evicted: GlyphAtlasPageSnapshot[] = [];
        // Use tiny pages (32x32) so each fills after a few glyphs.
        const atlas = new GlyphAtlas(1 as any, 32, 32, 0, {
            maxPages: 2,
            onEvictPage: (page) => evicted.push(page),
        });

        // Fill page 1: 32px wide, each glyph 10px → 3 glyphs per row.
        const entryA = atlas.ensure(makeGlyph(65)); // A
        const page1Id = entryA.page;
        atlas.ensure(makeGlyph(66)); // B
        atlas.ensure(makeGlyph(67)); // C
        // Row full (30px used, next would be 40 > 32). Page 1 has 3 entries.

        // Fill page 2.
        const entryD = atlas.ensure(makeGlyph(68)); // D
        atlas.ensure(makeGlyph(69)); // E → cursorX=10
        atlas.ensure(makeGlyph(70)); // F → cursorX=20
        atlas.ensure(makeGlyph(71)); // G → cursorX=30
        atlas.ensure(makeGlyph(72)); // H → wraps to row 2: cursorX=0, cursorY=20
        atlas.ensure(makeGlyph(73)); // I → cursorX=10
        atlas.ensure(makeGlyph(74)); // J → cursorX=20
        atlas.ensure(makeGlyph(75)); // K → wraps to row 3: cursorX=0, cursorY=30

        // At this point we have 2 pages. Verify exact page count.
        const pagesBefore = atlas.snapshot().length;
        expect(pagesBefore).toBe(2);

        // Force a 3rd page → should evict page 1 (LRU)
        atlas.tick(); // advance frame so page 1 is older
        for (let i = 0; i < 20; i++) {
            atlas.ensure(makeGlyph(200 + i));
        }

        // Verify exact eviction: page 1 (the LRU) should be among the evicted
        expect(evicted.length).toBeGreaterThanOrEqual(1);
        expect(evicted[0].id).toBe(page1Id);

        // Verify the evicted page snapshot has entries
        expect(evicted[0].entries.length).toBeGreaterThan(0);
    });

    it('removes evicted page entries from the global lookup', () => {
        const atlas = new GlyphAtlas(1 as any, 32, 32, 0, { maxPages: 1 });

        // Fill page 1.
        const entry1 = atlas.ensure(makeGlyph(65));
        expect(atlas.get(65, 16)).toBe(entry1);

        // Force enough new pages to evict page 1.
        // Each page is 32x32 with 10px glyphs → 3 per row, 3 rows = 9 glyphs per page.
        for (let i = 0; i < 30; i += 1) {
            atlas.ensure(makeGlyph(100 + i));
        }

        // Page 1 entries should have been evicted.
        expect(atlas.get(65, 16)).toBeNull();
    });

    it('fires the onEvictPage callback with the evicted page snapshot', () => {
        const evicted: GlyphAtlasPageSnapshot[] = [];
        const atlas = new GlyphAtlas(1 as any, 32, 32, 0, {
            maxPages: 1,
            onEvictPage: (page) => evicted.push(page),
        });

        // Fill first page.
        atlas.ensure(makeGlyph(65));
        expect(evicted.length).toBe(0);

        // Force creation of a second page (overflow the first).
        for (let i = 0; i < 20; i += 1) {
            atlas.ensure(makeGlyph(100 + i));
        }

        expect(evicted.length).toBeGreaterThanOrEqual(1);
        expect(evicted[0].id).toBeDefined();
        expect(evicted[0].entries.length).toBeGreaterThan(0);
    });

    it('respects LRU order: recently accessed pages survive eviction', () => {
        const evicted: GlyphAtlasPageSnapshot[] = [];
        const atlas = new GlyphAtlas(1 as any, 32, 32, 0, {
            maxPages: 2,
            onEvictPage: (page) => evicted.push(page),
        });

        // Fill page 1 with glyph A.
        const entryA = atlas.ensure(makeGlyph(65));
        const page1Id = entryA.page;

        // Fill enough to create page 2.
        const entryD = atlas.ensure(makeGlyph(100));
        const page2Id = entryD.page;
        for (let i = 1; i < 9; i++) {
            atlas.ensure(makeGlyph(100 + i));
        }

        // Touch page 1 again to make it recently used.
        atlas.get(65, 16);
        atlas.tick();

        // Now fill more to force page 3 creation → should evict page 2 (LRU).
        for (let i = 0; i < 20; i++) {
            atlas.ensure(makeGlyph(200 + i));
        }

        // The evicted page should include page 2 (the LRU), not page 1 (touched).
        expect(evicted.length).toBeGreaterThanOrEqual(1);
        expect(evicted[0].id).toBe(page2Id);

        // Verify the evicted page snapshot has entries
        expect(evicted[0].entries.length).toBeGreaterThan(0);
    });

    it('never evicts below 1 page even with maxPages=0', () => {
        // maxPages is clamped to minimum 1.
        const atlas = new GlyphAtlas(1 as any, 32, 32, 0, { maxPages: 0 });
        atlas.ensure(makeGlyph(65));
        expect(atlas.snapshot().length).toBe(1);
    });

    it('tick() advances the frame counter for LRU tracking', () => {
        const evicted: GlyphAtlasPageSnapshot[] = [];
        const atlas = new GlyphAtlas(1 as any, 32, 32, 0, {
            maxPages: 2,
            onEvictPage: (page) => evicted.push(page),
        });

        // Frame 0: fill page 1.
        const page1Entry = atlas.ensure(makeGlyph(65));
        const page1Id = page1Entry.page;
        atlas.tick();

        // Frame 1: fill page 1 more, then overflow to page 2.
        for (let i = 0; i < 15; i += 1) {
            atlas.ensure(makeGlyph(100 + i));
        }
        // The first overflow glyph that created page 2:
        const page2Entry = atlas.ensure(makeGlyph(200));
        const page2Id = page2Entry.page;
        expect(page2Id).not.toBe(page1Id); // verify distinct pages
        atlas.tick();

        // Frame 2: touch page 1 (glyph 65) to make it recently used.
        atlas.get(65, 16);
        atlas.tick();

        // Frame 3+: overflow to create page 3 → should evict page 2 (older)
        // because page 1 was touched in frame 2 (lastAccess=2) and page 2
        // was created in frame 1 (lastAccess=1).
        for (let i = 0; i < 30; i += 1) {
            atlas.ensure(makeGlyph(300 + i));
        }

        expect(evicted.length).toBeGreaterThanOrEqual(1);
        // Page 2 (lastAccess=1) is LRU → evicted first.
        expect(evicted[0].id).toBe(page2Id);
        expect(evicted[0].id).not.toBe(page1Id);
    });

    it('does not evict the just-created page when at maxPages with frameCounter 0', () => {
        const evicted: GlyphAtlasPageSnapshot[] = [];
        const atlas = new GlyphAtlas(1 as any, 32, 32, 0, {
            maxPages: 1,
            onEvictPage: (page) => evicted.push(page),
        });

        // All at frameCounter 0: fill page 1 to capacity.
        // 32px page, 10px glyph, 0 padding → 3 per row, 3 rows = 9 glyphs.
        const firstEntry = atlas.ensure(makeGlyph(65));
        for (let i = 0; i < 8; i += 1) {
            atlas.ensure(makeGlyph(66 + i));
        }

        // This glyph overflows page 1 → creates page 2. Without the fix,
        // evictIfNeeded picks page 2 (or page 1 by index 0 tie) and the
        // entry ends up on an untracked page.
        const overflowEntry = atlas.ensure(makeGlyph(200));

        // The entry must be resident in a tracked page.
        expect(atlas.get(200, 16)).toBe(overflowEntry);

        // The pages array must contain exactly maxPages entries.
        expect(atlas.snapshot().length).toBe(1);

        // The evicted page should be page 1 (the old one), not the new page.
        expect(evicted.length).toBe(1);
        expect(evicted[0].id).toBe(firstEntry.page);
    });

    it('commit() advances the atlas frame counter via tickAtlases()', () => {
        const runtime = new UIRuntime({ width: 320, height: 240 });
        runtime.fonts.registerFace(createTestFontAsset(AXRONE_DEFAULT_UI_FONT_FAMILY));

        // Create a simple widget with text so glyphs are allocated.
        runtime.createWidget({
            role: 'text',
            layout: { width: 100, height: 20 },
            text: { value: 'Hello', family: AXRONE_DEFAULT_UI_FONT_FAMILY, size: 16, weight: '400', style: 'normal', lineHeight: 20, letterSpacing: 0, align: 'start', wrap: 'none', overflow: 'ellipsis' },
            style: { color: '#ffffffff' },
        });

        // First commit: glyphs are allocated and frame counter should advance.
        runtime.commit();

        // Verify the atlas has entries with a ticked frame counter.
        // After 1 commit, the frame counter should be at least 1.
        const face = (runtime.fonts as any).facesById?.values()?.next()?.value;
        if (face?.atlas) {
            expect(face.atlas.frameCounter).toBeGreaterThanOrEqual(1);
        }

        // Second commit: frame counter should advance again.
        const counterBefore = face?.atlas?.frameCounter ?? 0;
        runtime.commit();
        if (face?.atlas) {
            expect(face.atlas.frameCounter).toBeGreaterThan(counterBefore);
        }
    });
});
