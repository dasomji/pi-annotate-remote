/** Element bounding rectangle in page coordinates */
export interface ElementRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Box model breakdown (content, padding, border, margin) */
export interface BoxModel {
  content: { width: number; height: number };
  padding: { top: number; right: number; bottom: number; left: number };
  border: { top: number; right: number; bottom: number; left: number };
  margin: { top: number; right: number; bottom: number; left: number };
}

/** Accessibility information for an element */
export interface AccessibilityInfo {
  /** ARIA role (explicit or implicit) */
  role: string | null;
  /** Computed accessible name */
  name: string | null;
  /** aria-describedby content */
  description: string | null;
  /** Whether element can receive focus */
  focusable: boolean;
  /** Whether element is disabled */
  disabled: boolean;
  /** aria-expanded state */
  expanded?: boolean;
  /** aria-pressed state */
  pressed?: boolean;
  /** Checked state (native or aria-checked) */
  checked?: boolean;
  /** Selected state (native or aria-selected) */
  selected?: boolean;
}

/** Parent element context for debugging layout issues */
export interface ParentContext {
  /** Parent tag name */
  tag: string;
  /** Parent ID if present */
  id?: string;
  /** Parent CSS classes */
  classes: string[];
  /** Layout-relevant computed styles */
  styles: Record<string, string>;
}

/** Information about a selected DOM element */
export interface ElementSelection {
  /** CSS selector that uniquely identifies this element */
  selector: string;
  /** HTML tag name (lowercase) */
  tag: string;
  /** Element ID if present */
  id: string | null;
  /** Array of CSS class names */
  classes: string[];
  /** Truncated text content */
  text: string;
  /** Bounding rectangle */
  rect: ElementRect;
  /** Selected HTML attributes */
  attributes: Record<string, string>;
  /** Per-element annotation comment */
  comment?: string;
  /** Box model breakdown (always captured) */
  boxModel?: BoxModel;
  /** Accessibility info (always captured) */
  accessibility?: AccessibilityInfo;
  /** Key CSS properties (always captured) */
  keyStyles?: Record<string, string>;
  /** Computed styles (debug mode only) */
  computedStyles?: Record<string, string>;
  /** Parent context (debug mode only) */
  parentContext?: ParentContext;
  /** CSS custom properties (debug mode only) */
  cssVariables?: Record<string, string>;
}

/** Screenshot cropped to a specific element */
export interface ElementScreenshot {
  /** 1-based index matching the element number */
  index: number;
  /** Base64 data URL of the cropped screenshot */
  dataUrl: string;
}

/** Viewport dimensions */
export interface Viewport {
  width: number;
  height: number;
}

/** Individual CSS property change */
export interface StylePropertyChange {
  property: string;
  from: string;
  to: string;
}

/** Inline style changes on a specific element */
export interface InlineStyleChange {
  selector: string;
  tag: string;
  added: Record<string, string>;
  changed: StylePropertyChange[];
  removed: string[];
}

/** CSS rule change in a stylesheet */
export interface RuleChange {
  ruleSelector: string;
  sheet: string;
  added: Record<string, string>;
  changed: StylePropertyChange[];
  removed: string[];
}

/** DOM mutation (text, attribute, structural) */
export interface DOMChange {
  type: "text" | "attribute" | "added" | "removed" | "structural";
  selector: string;
  detail: string;
}

/** Complete edit capture result */
export interface EditCapture {
  inlineStyles: InlineStyleChange[];
  rules: RuleChange[];
  dom: DOMChange[];
  beforeScreenshot?: string;
  afterScreenshot?: string;
  duration: number;
  changeCount: number;
  warnings?: string[];
}

/** Legacy result returned from annotation sessions using schema v1 */
export interface AnnotationResultV1 {
  /** Legacy payloads may omit the version discriminator */
  schemaVersion?: 1;
  /** Whether the annotation completed successfully */
  success: boolean;
  /** Selected elements with their metadata */
  elements?: ElementSelection[];
  /** Full page screenshot (when fullPage mode is enabled) */
  screenshot?: string;
  /** Individual element screenshots (default mode) */
  screenshots?: ElementScreenshot[];
  /** User's description of what should change */
  prompt?: string;
  /** URL of the annotated page */
  url?: string;
  /** Viewport dimensions at time of capture */
  viewport?: Viewport;
  /** Failure reason when success is false */
  reason?: string;
  editCapture?: EditCapture;
}

/** Element metadata frozen at the instant a v2 capture attempt begins */
export interface FrozenElementMetadata
  extends Omit<ElementSelection, "comment" | "boxModel" | "accessibility" | "keyStyles"> {
  boxModel: BoxModel;
  accessibility: AccessibilityInfo;
  keyStyles: Record<string, string>;
}

export type MissingImageReason =
  | "screenshot_failure"
  | "crop_failure"
  | "source_disconnected";

/** Explicit result of a mandatory viewport or element image capture */
export type ImageCaptureResult =
  | {
      status: "captured";
      mediaType: "image/png";
      dataUrl: string;
    }
  | {
      status: "missing";
      reason: MissingImageReason;
      attempts: 1 | 2 | 3;
      message?: string;
    };

/** One selected element and its point-in-time evidence */
export interface ElementAnnotation {
  id: string;
  historical: boolean;
  comment: string;
  metadata: FrozenElementMetadata;
  cropImage: ImageCaptureResult;
}

/** One uninterrupted Annotation-mode period containing accepted selections */
export interface InteractionStep {
  id: string;
  url: string;
  viewport: Viewport;
  viewportImage: ImageCaptureResult;
  elements: ElementAnnotation[];
}

/** Ordered same-page workflow annotation delivered using schema v2 */
export interface AnnotationResultV2 {
  schemaVersion: 2;
  success: true;
  url: string;
  context?: string;
  steps: InteractionStep[];
  etchCaptures?: EditCapture[];
  /** Etch periods that could not be finalized and were omitted */
  etchWarnings?: string[];
}

/** Versioned delivery union; legacy v1 and nested v2 remain separate paths. */
export type AnnotationResult = AnnotationResultV1 | AnnotationResultV2;
