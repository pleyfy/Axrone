import type { WebGL2UIRendererStatistics } from './types';

export interface RendererStatisticsState {
    drawCalls: number;
    quadCount: number;
    imageCount: number;
    materialImageCount: number;
    glyphCount: number;
    customCommandCount: number;
    uploadedGlyphCount: number;
}

export const createRendererStatisticsState = (): RendererStatisticsState => ({
    drawCalls: 0,
    quadCount: 0,
    imageCount: 0,
    materialImageCount: 0,
    glyphCount: 0,
    customCommandCount: 0,
    uploadedGlyphCount: 0,
});

export const resetRendererStatisticsState = (state: RendererStatisticsState): void => {
    state.drawCalls = 0;
    state.quadCount = 0;
    state.imageCount = 0;
    state.materialImageCount = 0;
    state.glyphCount = 0;
    state.customCommandCount = 0;
    state.uploadedGlyphCount = 0;
};

export const getRendererStatistics = (
    state: RendererStatisticsState,
    atlasPageCount: number
): WebGL2UIRendererStatistics => ({
    drawCalls: state.drawCalls,
    quadCount: state.quadCount,
    imageCount: state.imageCount,
    materialImageCount: state.materialImageCount,
    glyphCount: state.glyphCount,
    customCommandCount: state.customCommandCount,
    uploadedGlyphCount: state.uploadedGlyphCount,
    atlasPageCount,
});
