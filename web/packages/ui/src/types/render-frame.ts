import type {
    AffineTransform2D,
    CornerRadii,
    LayoutBox,
    ReadonlyColor,
    WidgetLayoutInput,
} from './layout';
import type {
    FocusMoveDirection,
    FontFaceId,
    ResolvedTextDirection,
    RectLike,
    UIImageSamplingMode,
    UVRect,
    WidgetId,
    WidgetRole,
    WidgetSerializableKey,
} from './foundation';
import type { GlyphAtlasEntry } from './font';
import type {
    TextBlockInput,
    UIImageSource,
    WidgetFocusPolicyInput,
    WidgetImageInput,
    WidgetStyleInput,
} from './widget';

export interface TextLayoutConstraint {
    readonly width?: number;
    readonly height?: number;
}

export interface TextGlyphPlacement {
    readonly codePoint: number;
    readonly clusterIndex: number;
    readonly x: number;
    readonly y: number;
    readonly advance: number;
    readonly width: number;
    readonly height: number;
    readonly line: number;
    readonly text: string;
    readonly atlasEntry: GlyphAtlasEntry | null;
}

export interface TextLineLayout {
    readonly index: number;
    readonly start: number;
    readonly end: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly ascent: number;
    readonly descent: number;
    readonly gapCount: number;
}

export interface TextClusterLayout {
    readonly index: number;
    readonly line: number;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly text: string;
    readonly whitespace: boolean;
    readonly newline: boolean;
}

export interface TextCaretPlacement {
    readonly index: number;
    readonly line: number;
    readonly x: number;
    readonly y: number;
    readonly height: number;
}

export interface TextLayoutResult {
    readonly faceId: FontFaceId | null;
    readonly width: number;
    readonly height: number;
    readonly lineHeight: number;
    readonly baseline: number;
    readonly lines: readonly TextLineLayout[];
    readonly clusters: readonly TextClusterLayout[];
    readonly carets: readonly TextCaretPlacement[];
    readonly glyphs: readonly TextGlyphPlacement[];
    readonly truncated: boolean;
    readonly direction: ResolvedTextDirection;
    readonly text: string;
}

export interface QuadRenderCommand {
    readonly kind: 'quad';
    readonly widget: WidgetId;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly zIndex: number;
    readonly color: ReadonlyColor;
    readonly borderColor: ReadonlyColor;
    readonly borderWidth: number;
    readonly radius: CornerRadii;
    readonly opacity: number;
    readonly clip: RectLike | null;
    readonly transform?: AffineTransform2D;
}

export interface TextRenderCommand {
    readonly kind: 'text';
    readonly widget: WidgetId;
    readonly x: number;
    readonly y: number;
    readonly zIndex: number;
    readonly color: ReadonlyColor;
    readonly outlineColor: ReadonlyColor;
    readonly outlineWidth: number;
    readonly edgeSoftness: number;
    readonly opacity: number;
    readonly clip: RectLike | null;
    readonly layout: TextLayoutResult;
    readonly transform?: AffineTransform2D;
}

export interface ImageRenderCommand {
    readonly kind: 'image';
    readonly widget: WidgetId;
    readonly source: UIImageSource;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
    readonly zIndex: number;
    readonly tint: ReadonlyColor;
    readonly opacity: number;
    readonly sampling: UIImageSamplingMode;
    readonly radius: CornerRadii;
    readonly clip: RectLike | null;
    readonly uvRect: UVRect;
    readonly transform?: AffineTransform2D;
}

export interface CustomRenderCommand<TPayload = unknown> {
    readonly kind: 'custom';
    readonly widget: WidgetId;
    readonly zIndex: number;
    readonly clip: RectLike | null;
    readonly payload: TPayload;
}

export type RenderCommand<TPayload = unknown> =
    | QuadRenderCommand
    | ImageRenderCommand
    | TextRenderCommand
    | CustomRenderCommand<TPayload>;

export interface UIFrameMetrics {
    readonly widgetCount: number;
    readonly visibleWidgetCount: number;
    readonly renderCount: number;
    readonly customCommandCount: number;
    readonly imageCommandCount: number;
    readonly textCommandCount: number;
    readonly glyphCount: number;
    readonly layoutPasses: number;
}

export interface UIFrame<TPayload = unknown> {
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly commands: readonly RenderCommand<TPayload>[];
    readonly metrics: UIFrameMetrics;
}

export interface WidgetSnapshot {
    readonly role: WidgetRole;
    readonly controller?: string;
    readonly key?: WidgetSerializableKey;
    readonly props?: Readonly<Record<string, unknown>> | null;
    readonly enabled?: boolean;
    readonly interactive?: boolean;
    readonly layout?: WidgetLayoutInput;
    readonly style?: WidgetStyleInput;
    readonly text?: TextBlockInput | null;
    readonly image?: WidgetImageInput | null;
    readonly focus?: WidgetFocusPolicyInput;
    readonly children: readonly WidgetSnapshot[];
}

export interface UIRuntimeSnapshot {
    readonly viewportWidth: number;
    readonly viewportHeight: number;
    readonly locale: string;
    readonly root: WidgetSnapshot;
}
