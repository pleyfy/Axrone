const TEST_FONT_CODE_POINTS = [
    ...Array.from({ length: 95 }, (_, index) => 32 + index),
    8230,
];

export const createTestFontAsset = (family = 'TestSans') => ({
    family,
    face: 'Regular',
    style: 'normal' as const,
    weight: 400 as const,
    ascent: 800,
    descent: 200,
    lineGap: 0,
    unitsPerEm: 1000,
    defaultAdvance: 500,
    fallbackCodePoint: 63,
    glyphs: TEST_FONT_CODE_POINTS.map((codePoint) => ({
        codePoint,
        advance: codePoint === 32 ? 250 : 500,
        width: codePoint === 32 ? 1 : 480,
        height: codePoint === 32 ? 1 : 720,
    })),
});