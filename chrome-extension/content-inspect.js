/**
 * Pi Annotate - Element inspection module
 *
 * Read-only helpers that describe a page element: selectors, attributes,
 * box model, accessibility, and the debug-mode style/CSS-variable capture.
 * Registered on the shared module namespace; injected before content.js.
 */

(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.inspect) return;

  // HTML escape to prevent XSS when inserting user-controlled content
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  // Check if element is part of pi-annotate UI (by id or class)
  function isPiElement(el) {
    if (!el) return false;
    if (el.id?.startsWith("pi-")) return true;
    const cls = el.className;
    if (!cls) return false;
    // Handle both string className and SVGAnimatedString
    const clsStr = typeof cls === "string" ? cls : cls.baseVal || "";
    return clsStr.split(/\s+/).some(c => c.startsWith("pi-"));
  }

  function generateSelector(el) {
    if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id)) return `#${el.id}`;

    if (el.classList.length) {
      const classes = Array.from(el.classList).filter(c => /^[a-zA-Z][\w-]*$/.test(c));
      if (classes.length) {
        const sel = el.tagName.toLowerCase() + "." + classes.join(".");
        try { if (document.querySelectorAll(sel).length === 1) return sel; } catch {}
      }
    }

    const path = [];
    let cur = el;
    while (cur && cur !== document.body) {
      let part = cur.tagName.toLowerCase();
      if (cur.id && /^[a-zA-Z][\w-]*$/.test(cur.id)) {
        path.unshift(`#${cur.id}`);
        break;
      }
      const parent = cur.parentElement;
      if (parent) {
        const sibs = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
        if (sibs.length > 1) part += `:nth-of-type(${sibs.indexOf(cur) + 1})`;
      }
      path.unshift(part);
      cur = parent;
    }
    return path.join(" > ");
  }

  /**
   * Get all HTML attributes for an element (except class/id which are captured separately)
   * @param {Element} el - Target element
   * @returns {Record<string, string>} Attribute name → value map
   */
  function getAttrs(el) {
    const attrs = {};
    for (const attr of el.attributes) {
      // Skip class and id (captured separately)
      if (attr.name === "class" || attr.name === "id") continue;
      // Skip style attribute (too verbose, use computedStyles instead)
      if (attr.name === "style") continue;
      // Truncate long values
      attrs[attr.name] = attr.value.length > 200 ? attr.value.slice(0, 200) + "…" : attr.value;
    }
    return attrs;
  }

  function getRectData(el) {
    const rect = el.getBoundingClientRect();
    return {
      x: Math.round(rect.x + window.scrollX),
      y: Math.round(rect.y + window.scrollY),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    };
  }

  /**
   * Get box model breakdown (content, padding, border, margin)
   * @param {Element} el - Target element
   * @returns {{ content: {width: number, height: number}, padding: {...}, border: {...}, margin: {...} }}
   */
  function getBoxModel(el) {
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();

    const paddingH = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const paddingV = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    const borderH = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    const borderV = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);

    return {
      content: {
        width: Math.max(0, Math.round(rect.width - paddingH - borderH)),
        height: Math.max(0, Math.round(rect.height - paddingV - borderV))
      },
      padding: {
        top: Math.round(parseFloat(style.paddingTop)),
        right: Math.round(parseFloat(style.paddingRight)),
        bottom: Math.round(parseFloat(style.paddingBottom)),
        left: Math.round(parseFloat(style.paddingLeft))
      },
      border: {
        top: Math.round(parseFloat(style.borderTopWidth)),
        right: Math.round(parseFloat(style.borderRightWidth)),
        bottom: Math.round(parseFloat(style.borderBottomWidth)),
        left: Math.round(parseFloat(style.borderLeftWidth))
      },
      margin: {
        top: Math.round(parseFloat(style.marginTop)),
        right: Math.round(parseFloat(style.marginRight)),
        bottom: Math.round(parseFloat(style.marginBottom)),
        left: Math.round(parseFloat(style.marginLeft))
      }
    };
  }

  // ARIA role mappings for getImplicitRole (defined once, not per-call)
  const INPUT_TYPE_ROLES = {
    button: "button",
    submit: "button",
    reset: "button",
    image: "button",
    checkbox: "checkbox",
    radio: "radio",
    range: "slider",
    number: "spinbutton",
    search: "searchbox",
    email: "textbox",
    tel: "textbox",
    url: "textbox",
    text: "textbox",
    password: "textbox",
  };

  const TAG_ROLES = {
    article: "article",
    aside: "complementary",
    button: "button",
    datalist: "listbox",
    details: "group",
    dialog: "dialog",
    fieldset: "group",
    figure: "figure",
    footer: "contentinfo",
    form: "form",
    h1: "heading", h2: "heading", h3: "heading",
    h4: "heading", h5: "heading", h6: "heading",
    header: "banner",
    hr: "separator",
    li: "listitem",
    main: "main",
    math: "math",
    menu: "list",
    nav: "navigation",
    ol: "list",
    optgroup: "group",
    option: "option",
    output: "status",
    progress: "progressbar",
    section: "region",
    select: "combobox",
    summary: "button",
    table: "table",
    tbody: "rowgroup",
    td: "cell",
    textarea: "textbox",
    tfoot: "rowgroup",
    th: "columnheader",
    thead: "rowgroup",
    tr: "row",
    ul: "list",
  };

  /**
   * Get implicit ARIA role for an element based on tag and attributes
   * @param {Element} el - Target element
   * @returns {string|null} Implicit role or null
   */
  function getImplicitRole(el) {
    const tag = el.tagName.toLowerCase();
    const type = el.getAttribute("type")?.toLowerCase();

    // Special cases
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "area") return el.hasAttribute("href") ? "link" : null;
    if (tag === "input") return type ? (INPUT_TYPE_ROLES[type] || "textbox") : "textbox";
    if (tag === "img") {
      const alt = el.getAttribute("alt");
      if (alt === null) return "img";
      if (alt === "") return "presentation";
      return "img";
    }

    return TAG_ROLES[tag] || null;
  }

  /**
   * Check if element can receive keyboard focus
   * @param {Element} el - Target element
   * @returns {boolean}
   */
  function isFocusable(el) {
    if (el.hasAttribute("tabindex")) {
      return el.tabIndex >= 0;
    }
    if (el.disabled) return false;

    const tag = el.tagName.toLowerCase();
    if (tag === "a" || tag === "area") {
      return el.hasAttribute("href");
    }

    return ["button", "input", "select", "textarea"].includes(tag);
  }

  /**
   * Get computed accessible name for an element
   * @param {Element} el - Target element
   * @returns {string|null}
   */
  function getAccessibleName(el) {
    // Priority: aria-labelledby > aria-label > label[for] > title > text content
    const labelledBy = el.getAttribute("aria-labelledby");
    if (labelledBy) {
      const name = labelledBy.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean).join(" ");
      if (name) return name;
    }

    const ariaLabel = el.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;

    // For labelable elements, check associated label
    const tag = el.tagName.toLowerCase();
    const labelable = ["input", "select", "textarea", "button", "meter", "progress", "output"];
    if (el.id && labelable.includes(tag)) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent?.trim() || null;
    }

    const title = el.getAttribute("title");
    if (title) return title;

    // Fallback to text content for interactive elements
    if (["button", "a", "label", "legend", "caption"].includes(tag)) {
      const text = el.textContent?.trim();
      return text ? text.slice(0, 100) : null;
    }

    // For img, use alt
    if (tag === "img") {
      return el.getAttribute("alt") || null;
    }

    return null;
  }

  /**
   * Get aria-describedby content
   * @param {Element} el - Target element
   * @returns {string|null}
   */
  function getAccessibleDescription(el) {
    const describedBy = el.getAttribute("aria-describedby");
    if (describedBy) {
      return describedBy.split(/\s+/)
        .map(id => document.getElementById(id)?.textContent?.trim())
        .filter(Boolean).join(" ") || null;
    }
    return null;
  }

  /**
   * Get accessibility information for an element
   * @param {Element} el - Target element
   * @returns {AccessibilityInfo}
   */
  function getAccessibilityInfo(el) {
    const role = el.getAttribute("role") || getImplicitRole(el);
    const ariaExpanded = el.getAttribute("aria-expanded");
    const ariaPressed = el.getAttribute("aria-pressed");
    const ariaChecked = el.getAttribute("aria-checked");
    const ariaSelected = el.getAttribute("aria-selected");

    const parseAriaBoolean = (val) => val === "true" ? true : val === "false" ? false : undefined;

    return {
      role,
      name: getAccessibleName(el),
      description: getAccessibleDescription(el),
      focusable: isFocusable(el),
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      expanded: parseAriaBoolean(ariaExpanded),
      pressed: parseAriaBoolean(ariaPressed),
      checked: typeof el.checked === "boolean" ? el.checked : parseAriaBoolean(ariaChecked),
      selected: typeof el.selected === "boolean" ? el.selected : parseAriaBoolean(ariaSelected)
    };
  }

  // ── Key styles (always captured) ──

  const KEY_STYLE_DEFAULTS = {
    position: new Set(["static"]),
    overflow: new Set(["visible"]),
    zIndex: new Set(["auto"]),
    opacity: new Set(["1"]),
    color: new Set(["rgb(0, 0, 0)"]),
    backgroundColor: new Set(["rgba(0, 0, 0, 0)", "transparent"]),
    fontSize: new Set(["16px"]),
    fontWeight: new Set(["400", "normal"]),
  };

  /**
   * Get a small set of layout-critical CSS properties (always captured)
   * @param {Element} el - Target element
   * @returns {Record<string, string>}
   */
  function getKeyStyles(el) {
    const computed = window.getComputedStyle(el);
    const styles = {};
    const display = computed.display;
    if (display) styles.display = display;
    for (const key of Object.keys(KEY_STYLE_DEFAULTS)) {
      const value = computed[key];
      if (value && !KEY_STYLE_DEFAULTS[key].has(value)) {
        styles[key] = value;
      }
    }
    return styles;
  }

  // ── Debug mode helpers ──

  const COMPUTED_STYLE_KEYS = [
    // Layout
    "display", "position", "top", "right", "bottom", "left",
    "width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight",
    // Flexbox
    "flexDirection", "flexWrap", "justifyContent", "alignItems", "alignSelf", "flex", "gap",
    // Grid
    "gridTemplateColumns", "gridTemplateRows", "gridColumn", "gridRow",
    // Visual
    "overflow", "overflowX", "overflowY", "zIndex", "opacity", "visibility",
    // Typography
    "color", "fontSize", "fontWeight", "fontFamily", "lineHeight", "textAlign",
    // Background & Border
    "backgroundColor", "backgroundImage", "borderRadius", "boxShadow",
    // Transform
    "transform", "transformOrigin",
    // Interaction
    "cursor", "pointerEvents", "userSelect"
  ];

  const DEFAULT_STYLE_VALUES = new Set([
    "none", "auto", "normal", "visible", "static", "baseline",
    "0px", "0", "1", "start", "stretch", "row", "nowrap",
    "rgba(0, 0, 0, 0)", "rgb(0, 0, 0)", "transparent"
  ]);

  /**
   * Get computed styles (debug mode only)
   * @param {Element} el - Target element
   * @returns {Record<string, string>}
   */
  function getComputedStyles(el) {
    const computed = window.getComputedStyle(el);
    const styles = {};

    for (const key of COMPUTED_STYLE_KEYS) {
      const value = computed[key];
      if (value && !DEFAULT_STYLE_VALUES.has(value)) {
        styles[key] = value.length > 150 ? value.slice(0, 150) + "…" : value;
      }
    }

    return styles;
  }

  /**
   * Get parent element context (debug mode only)
   * @param {Element} el - Target element
   * @returns {ParentContext|null}
   */
  function getParentContext(el) {
    let parent = el.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) {
      return null;
    }

    // Skip pi-annotate UI elements
    while (parent && isPiElement(parent)) {
      parent = parent.parentElement;
    }
    if (!parent || parent === document.body || parent === document.documentElement) {
      return null;
    }

    const computed = window.getComputedStyle(parent);
    const styles = {};

    styles.display = computed.display;
    styles.position = computed.position;

    if (computed.display.includes("flex")) {
      styles.flexDirection = computed.flexDirection;
      styles.flexWrap = computed.flexWrap;
      styles.justifyContent = computed.justifyContent;
      styles.alignItems = computed.alignItems;
      if (computed.gap && computed.gap !== "normal") {
        styles.gap = computed.gap;
      }
    }

    if (computed.display.includes("grid")) {
      styles.gridTemplateColumns = computed.gridTemplateColumns;
      styles.gridTemplateRows = computed.gridTemplateRows;
      if (computed.gap && computed.gap !== "normal") {
        styles.gap = computed.gap;
      }
    }

    if (computed.overflow !== "visible") {
      styles.overflow = computed.overflow;
    }

    return {
      tag: parent.tagName.toLowerCase(),
      id: parent.id || undefined,
      classes: Array.from(parent.classList),
      styles
    };
  }

  // Cache for CSS variable discovery; reset when the annotator resets
  let cachedCSSVarNames = null;

  /**
   * Discover all CSS variable names from stylesheets
   * @returns {Set<string>}
   */
  function discoverCSSVariables() {
    if (cachedCSSVarNames) return cachedCSSVarNames;

    const varNames = new Set();

    function extractFromRules(rules) {
      if (!rules) return;
      for (const rule of rules) {
        if (rule.style) {
          for (const prop of rule.style) {
            if (prop.startsWith("--")) {
              varNames.add(prop);
            }
          }
        }
        if (rule.cssRules) {
          extractFromRules(rule.cssRules);
        }
      }
    }

    for (const sheet of document.styleSheets) {
      try {
        extractFromRules(sheet.cssRules);
      } catch (e) {
        // CORS blocks access - skip this sheet
      }
    }

    cachedCSSVarNames = varNames;
    return varNames;
  }

  /**
   * Get CSS variables used by element (debug mode only)
   * @param {Element} el - Target element
   * @returns {Record<string, string>}
   */
  function getCSSVariables(el) {
    const style = window.getComputedStyle(el);
    const varNames = discoverCSSVariables();
    const variables = {};

    let count = 0;
    for (const name of varNames) {
      if (count >= 50) break;
      const value = style.getPropertyValue(name).trim();
      if (value) {
        variables[name] = value.length > 100 ? value.slice(0, 100) + "…" : value;
        count++;
      }
    }

    return variables;
  }

  /**
   * Reset CSS variable cache (call on deactivate)
   */
  function resetCSSVarCache() {
    cachedCSSVarNames = null;
  }

  modules.inspect = {
    escapeHtml,
    isPiElement,
    generateSelector,
    getAttrs,
    getRectData,
    getBoxModel,
    getAccessibilityInfo,
    getKeyStyles,
    getComputedStyles,
    getParentContext,
    getCSSVariables,
    resetCSSVarCache,
  };
})();
