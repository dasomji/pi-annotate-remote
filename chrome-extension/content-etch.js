/**
 * Pi Annotate - Etch (edit capture) module
 *
 * Records page DOM/CSS edits made while recording is on, diffs them against
 * the initial state, and captures before/after screenshots at submit time.
 * Owns all etch state; content.js drives it through start/stop/reset/collect.
 * Registered on the shared module namespace; injected before content.js.
 */

(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.etch) return;

  const { isPiElement, generateSelector } = modules.inspect;

  let etchObserver = null;
  let etchStartTime = null;
  let etchInitialRules = null;           // serialized stylesheet snapshot (ownerNode + ruleTexts[])
  let etchStyleInitials = new Map();     // Element → initial style attribute value
  let etchClassInitials = new Map();     // Element → initial class attribute value
  let etchAttrInitials = new Map();      // Element → Map<attrName, oldValue> (non-style/class)
  let etchTextInitials = new Map();      // Text node → initial text value
  let etchChildListMutations = [];       // raw MutationRecords for structural changes
  let etchChangeCount = 0;

  function processEtchMutations(mutations) {
    for (const m of mutations) {
      if (isPiElement(m.target) || isPiElement(m.target.parentElement)) continue;

      if (m.type === "attributes") {
        if (m.attributeName === "data-pi-changed") continue;

        if (m.attributeName === "style") {
          if (!etchStyleInitials.has(m.target)) {
            etchStyleInitials.set(m.target, m.oldValue);
            etchChangeCount++;
          }
        } else if (m.attributeName === "class") {
          if (!etchClassInitials.has(m.target)) {
            etchClassInitials.set(m.target, m.oldValue);
            etchChangeCount++;
          }
        } else {
          if (!etchAttrInitials.has(m.target)) {
            etchAttrInitials.set(m.target, new Map());
          }
          const attrs = etchAttrInitials.get(m.target);
          if (!attrs.has(m.attributeName)) {
            attrs.set(m.attributeName, m.oldValue);
            etchChangeCount++;
          }
        }
        if (!m.target.hasAttribute("data-pi-changed")) {
          m.target.setAttribute("data-pi-changed", "");
        }
      } else if (m.type === "characterData") {
        if (!etchTextInitials.has(m.target)) {
          etchTextInitials.set(m.target, m.oldValue);
          etchChangeCount++;
        }
        const parent = m.target.parentElement;
        if (parent && !isPiElement(parent) && !parent.hasAttribute("data-pi-changed")) {
          parent.setAttribute("data-pi-changed", "");
        }
      } else if (m.type === "childList") {
        const hasNonPiNodes = [...m.addedNodes, ...m.removedNodes].some(n =>
          n.nodeType !== Node.ELEMENT_NODE || !isPiElement(n)
        );
        if (hasNonPiNodes) {
          etchChildListMutations.push(m);
          etchChangeCount++;
          if (m.target.nodeType === Node.ELEMENT_NODE && !m.target.hasAttribute("data-pi-changed")) {
            m.target.setAttribute("data-pi-changed", "");
          }
        }
      }
    }
  }

  function clearMarkers() {
    document.querySelectorAll("[data-pi-changed]").forEach(el => el.removeAttribute("data-pi-changed"));
  }

  function start() {
    clearMarkers();
    etchStartTime = Date.now();
    etchInitialRules = serializeAllStylesheets();
    etchStyleInitials.clear();
    etchClassInitials.clear();
    etchAttrInitials.clear();
    etchTextInitials.clear();
    etchChildListMutations = [];
    etchChangeCount = 0;
    updateCounter();

    etchObserver = new MutationObserver((mutations) => {
      processEtchMutations(mutations);
      updateCounter();
    });

    etchObserver.observe(document.documentElement, {
      attributes: true,
      attributeOldValue: true,
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true,
    });
  }

  function stop() {
    if (etchObserver) {
      const pending = etchObserver.takeRecords();
      etchObserver.disconnect();
      if (pending.length) processEtchMutations(pending);
      etchObserver = null;
    }
    updateCounter();
  }

  function reset() {
    if (etchObserver) { etchObserver.disconnect(); etchObserver = null; }
    etchStartTime = null;
    etchInitialRules = null;
    etchStyleInitials = new Map();
    etchClassInitials = new Map();
    etchAttrInitials = new Map();
    etchTextInitials = new Map();
    etchChildListMutations = [];
    etchChangeCount = 0;
    updateCounter();
    clearMarkers();
  }

  function updateCounter() {
    const counter = document.getElementById("pi-etch-count");
    if (!counter) return;
    const text = etchChangeCount > 0 ? `${etchChangeCount}` : "";
    const display = etchChangeCount > 0 ? "inline-flex" : "none";
    if (counter.textContent !== text) counter.textContent = text;
    if (counter.style.display !== display) counter.style.display = display;
  }

  function serializeAllStylesheets() {
    const sheets = [];
    let crossOriginCount = 0;

    for (let si = 0; si < document.styleSheets.length; si++) {
      const sheet = document.styleSheets[si];
      // Skip pi-annotate's own injected styles
      if (sheet.ownerNode?.id === "pi-styles") continue;

      try {
        const rules = sheet.cssRules;
        const sheetLabel = sheet.href || `inline stylesheet`;

        // Individual top-level rule strings for undo/redo (each passed directly to insertRule)
        const ruleTexts = [];
        for (let i = 0; i < rules.length; i++) {
          ruleTexts.push(rules[i].cssText);
        }

        // Per-rule breakdown for diffing (recurses into @media, @supports, etc.)
        const ruleData = [];
        serializeRulesRecursive(rules, ruleData);

        sheets.push({
          ownerNode: sheet.ownerNode,   // stable reference for matching
          label: sheetLabel,            // display label for diff output
          ruleTexts,                    // for undo/redo restoration
          rules: ruleData,              // for property-level diffing
        });
      } catch (e) {
        crossOriginCount++;
      }
    }

    return { sheets, crossOriginCount };
  }

  function serializeRulesRecursive(rules, output) {
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.style && rule.selectorText) {
        // CSSStyleRule (or similar with a selector and style declaration)
        output.push({
          selectorText: rule.selectorText,
          properties: serializeRuleProperties(rule.style),
          // Walk up the full parentRule chain for nested context
          // e.g., "@layer base > @media (max-width: 768px)" for doubly-nested rules
          parentRule: getParentRuleContext(rule),
        });
      }
      // Recurse into grouping rules (@media, @supports, @layer, etc.)
      if (rule.cssRules) {
        serializeRulesRecursive(rule.cssRules, output);
      }
    }
  }

  function getParentRuleContext(rule) {
    const parts = [];
    let parent = rule.parentRule;
    while (parent) {
      // Extract the at-rule prefix (everything before the first "{")
      if (parent.cssText) {
        parts.unshift(parent.cssText.split("{")[0].trim());
      }
      parent = parent.parentRule;
    }
    return parts.length > 0 ? parts.join(" > ") : null;
  }

  function serializeRuleProperties(style) {
    const props = {};
    for (let i = 0; i < style.length; i++) {
      const prop = style[i];
      props[prop] = style.getPropertyValue(prop);
    }
    return props;
  }

  function diffStylesheetRules(initial, current) {
    const changes = [];

    // Build lookup: ownerNode → sheet data
    const currentByNode = new Map();
    for (const sheet of current.sheets) {
      currentByNode.set(sheet.ownerNode, sheet);
    }

    for (const iniSheet of initial.sheets) {
      const curSheet = currentByNode.get(iniSheet.ownerNode);
      if (!curSheet) continue; // Sheet removed from DOM — skip

      // Group rules by selector (handles duplicate selectors within a sheet)
      const iniGroups = groupRulesByKey(iniSheet.rules);
      const curGroups = groupRulesByKey(curSheet.rules);

      // Find changed and added rules
      for (const [key, curRules] of curGroups) {
        const iniRules = iniGroups.get(key) || [];

        // Compare corresponding rules by position in the group
        const maxLen = Math.max(curRules.length, iniRules.length);
        for (let i = 0; i < maxLen; i++) {
          const ini = iniRules[i];
          const cur = curRules[i];

          if (!ini && cur) {
            // New rule
            changes.push({
              ruleSelector: formatRuleSelector(cur),
              sheet: curSheet.label,
              added: { ...cur.properties },
              changed: [],
              removed: [],
            });
          } else if (ini && !cur) {
            // Removed rule
            changes.push({
              ruleSelector: formatRuleSelector(ini),
              sheet: iniSheet.label,
              added: {},
              changed: [],
              removed: Object.keys(ini.properties),
            });
          } else if (ini && cur) {
            // Compare properties
            const added = {};
            const changed = [];
            const removed = [];

            for (const [prop, value] of Object.entries(cur.properties)) {
              if (!(prop in ini.properties)) {
                added[prop] = value;
              } else if (ini.properties[prop] !== value) {
                changed.push({ property: prop, from: ini.properties[prop], to: value });
              }
            }
            for (const prop of Object.keys(ini.properties)) {
              if (!(prop in cur.properties)) {
                removed.push(prop);
              }
            }

            if (Object.keys(added).length || changed.length || removed.length) {
              changes.push({
                ruleSelector: formatRuleSelector(cur),
                sheet: curSheet.label,
                added,
                changed,
                removed,
              });
            }
          }
        }
      }

      // Find selectors that existed initially but are completely gone now
      for (const [key, iniRules] of iniGroups) {
        if (!curGroups.has(key)) {
          for (const ini of iniRules) {
            changes.push({
              ruleSelector: formatRuleSelector(ini),
              sheet: iniSheet.label,
              added: {},
              changed: [],
              removed: Object.keys(ini.properties),
            });
          }
        }
      }
    }

    return changes;
  }

  function groupRulesByKey(rules) {
    const groups = new Map();
    for (const rule of rules) {
      // Include parentRule context in key so rules with the same selector but
      // different nesting (e.g., .card at top level vs .card inside @media) are
      // diffed independently rather than compared by position
      const key = (rule.parentRule || "") + "|||" + rule.selectorText;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(rule);
    }
    return groups;
  }

  function formatRuleSelector(rule) {
    return rule.parentRule
      ? `${rule.parentRule} { ${rule.selectorText} }`
      : rule.selectorText;
  }

  function parseStyleAttribute(str) {
    if (!str) return {};
    const props = {};
    // Use a temporary element to parse reliably
    const tmp = document.createElement("div");
    tmp.style.cssText = str;
    for (let i = 0; i < tmp.style.length; i++) {
      const prop = tmp.style[i];
      props[prop] = tmp.style.getPropertyValue(prop);
    }
    return props;
  }

  function diffInlineStyles() {
    const changes = [];

    for (const [el, initialValue] of etchStyleInitials) {
      if (!document.contains(el)) continue;
      const currentValue = el.getAttribute("style");
      if (initialValue === currentValue) continue;

      const initial = parseStyleAttribute(initialValue);
      const current = parseStyleAttribute(currentValue);

      const added = {};
      const changed = [];
      const removed = [];

      for (const [prop, value] of Object.entries(current)) {
        if (!(prop in initial)) {
          added[prop] = value;
        } else if (initial[prop] !== value) {
          changed.push({ property: prop, from: initial[prop], to: value });
        }
      }
      for (const prop of Object.keys(initial)) {
        if (!(prop in current)) {
          removed.push(prop);
        }
      }

      if (Object.keys(added).length || changed.length || removed.length) {
        changes.push({
          selector: generateSelector(el),
          tag: el.tagName.toLowerCase(),
          added,
          changed,
          removed,
        });
      }
    }

    return changes;
  }

  function compileDOMChanges() {
    const changes = [];

    // Class changes
    for (const [el, initialValue] of etchClassInitials) {
      if (!document.contains(el)) continue;
      const currentValue = el.getAttribute("class");
      if (initialValue === currentValue) continue;

      const initialClasses = (initialValue || "").split(/\s+/).filter(Boolean);
      const currentClasses = (currentValue || "").split(/\s+/).filter(Boolean);
      const added = currentClasses.filter(c => !initialClasses.includes(c));
      const removed = initialClasses.filter(c => !currentClasses.includes(c));

      if (added.length || removed.length) {
        const parts = [];
        if (added.length) parts.push(`added: ${added.join(", ")}`);
        if (removed.length) parts.push(`removed: ${removed.join(", ")}`);
        changes.push({
          type: "attribute",
          selector: generateSelector(el),
          detail: `class ${parts.join("; ")}`,
        });
      }
    }

    // Other attribute changes (non-style, non-class: data-*, aria-*, href, src, etc.)
    for (const [el, attrs] of etchAttrInitials) {
      if (!document.contains(el)) continue;
      for (const [attrName, initialValue] of attrs) {
        const currentValue = el.getAttribute(attrName);
        if (initialValue === currentValue) continue;
        const truncate = (s) => s && s.length > 80 ? s.slice(0, 80) + "..." : (s || "");
        if (currentValue === null) {
          changes.push({
            type: "attribute",
            selector: generateSelector(el),
            detail: `${attrName} removed (was "${truncate(initialValue)}")`,
          });
        } else if (initialValue === null) {
          changes.push({
            type: "attribute",
            selector: generateSelector(el),
            detail: `${attrName} added: "${truncate(currentValue)}"`,
          });
        } else {
          changes.push({
            type: "attribute",
            selector: generateSelector(el),
            detail: `${attrName}: "${truncate(initialValue)}" → "${truncate(currentValue)}"`,
          });
        }
      }
    }

    // Text changes
    for (const [node, initialValue] of etchTextInitials) {
      if (!document.contains(node)) continue;
      const currentValue = node.data || node.textContent;
      if (initialValue === currentValue) continue;

      const parent = node.parentElement;
      if (!parent || isPiElement(parent)) continue;

      const truncate = (s) => s && s.length > 80 ? s.slice(0, 80) + "..." : s;
      changes.push({
        type: "text",
        selector: generateSelector(parent),
        detail: `"${truncate(initialValue)}" → "${truncate(currentValue)}"`,
      });
    }

    // Structural changes (deduplicated by parent)
    const structuralParents = new Set();
    for (const m of etchChildListMutations) {
      if (isPiElement(m.target)) continue;
      if (!document.contains(m.target)) continue;
      structuralParents.add(m.target);
    }
    for (const parent of structuralParents) {
      changes.push({
        type: "structural",
        selector: generateSelector(parent),
        detail: "DOM structure modified (children added/removed)",
      });
    }

    return changes;
  }

  async function captureBeforeAfterScreenshots() {
    clearMarkers();

    const afterResp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
    const afterScreenshot = afterResp?.dataUrl || null;

    // Record final values for redo
    const finalStyles = new Map();
    const finalClasses = new Map();
    for (const [el] of etchStyleInitials) {
      finalStyles.set(el, el.getAttribute("style"));
    }
    for (const [el] of etchClassInitials) {
      finalClasses.set(el, el.getAttribute("class"));
    }
    const currentRulesSnapshot = serializeAllStylesheets();

    // Inject transition/animation killer to prevent visual artifacts
    const transitionKiller = document.createElement("style");
    transitionKiller.id = "pi-etch-transition-killer";
    transitionKiller.textContent = "*, *::before, *::after { transition: none !important; animation: none !important; }";
    (document.head || document.documentElement).appendChild(transitionKiller);

    let beforeScreenshot = null;

    try {
      // UNDO: restore initial visual state
      for (const [el, initial] of etchStyleInitials) {
        if (!document.contains(el)) continue;
        if (initial === null) el.removeAttribute("style");
        else el.setAttribute("style", initial);
      }
      for (const [el, initial] of etchClassInitials) {
        if (!document.contains(el)) continue;
        if (initial === null) el.removeAttribute("class");
        else el.setAttribute("class", initial);
      }
      restoreStylesheetRules(etchInitialRules);

      // Force repaint: double-rAF guarantees at least one paint
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));

      // Capture "before" screenshot (page in original visual state)
      const beforeResp = await chrome.runtime.sendMessage({ type: "CAPTURE_SCREENSHOT" });
      beforeScreenshot = beforeResp?.dataUrl || null;
    } finally {
      // REDO: always restore modified visual state, even if before screenshot failed.
      // Prevents leaving the page in the undone state with user's edits lost.
      for (const [el, final] of finalStyles) {
        if (!document.contains(el)) continue;
        if (final === null) el.removeAttribute("style");
        else el.setAttribute("style", final);
      }
      for (const [el, final] of finalClasses) {
        if (!document.contains(el)) continue;
        if (final === null) el.removeAttribute("class");
        else el.setAttribute("class", final);
      }
      restoreStylesheetRules(currentRulesSnapshot);

      // Always clean up transition killer
      transitionKiller.remove();

      // Force repaint to restore visual state
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    }

    return { beforeScreenshot, afterScreenshot };
  }

  function restoreStylesheetRules(snapshot) {
    if (!snapshot?.sheets) return;

    // Build lookup from ownerNode → rule texts array
    const rulesByNode = new Map();
    for (const entry of snapshot.sheets) {
      rulesByNode.set(entry.ownerNode, entry.ruleTexts);
    }

    for (let si = 0; si < document.styleSheets.length; si++) {
      const sheet = document.styleSheets[si];
      // Skip sheets not in the snapshot (added by JS after recording started, or pi-annotate's own)
      if (!rulesByNode.has(sheet.ownerNode)) continue;

      try {
        const ruleTexts = rulesByNode.get(sheet.ownerNode);

        // Clear current rules
        while (sheet.cssRules.length > 0) {
          sheet.deleteRule(0);
        }
        // Re-insert each original rule directly (no parsing needed)
        for (const ruleStr of ruleTexts) {
          try {
            sheet.insertRule(ruleStr, sheet.cssRules.length);
          } catch (e) {
            // Rule might be invalid in current context, skip
          }
        }
      } catch (e) {
        // Cross-origin, skip
      }
    }
  }

  /**
   * Compile everything recorded since start() into an editCapture payload.
   * Returns null when recording never started or compilation fails. Recording
   * state is kept so a failed delivery can collect again on retry.
   */
  async function collect() {
    if (!etchStartTime) return null;

    // Disconnect observer first — must happen regardless of errors below
    stop();

    try {
      const inlineStyles = diffInlineStyles();
      const currentRulesSnapshot = serializeAllStylesheets();
      const rules = etchInitialRules ? diffStylesheetRules(etchInitialRules, currentRulesSnapshot) : [];
      const dom = compileDOMChanges();
      const changeCount = inlineStyles.length + rules.length + dom.length;
      const warnings = [];

      if (etchInitialRules?.crossOriginCount > 0) {
        warnings.push(`${etchInitialRules.crossOriginCount} cross-origin stylesheet(s) could not be tracked`);
      }

      let beforeScreenshot = null;
      let afterScreenshot = null;

      if (changeCount > 0) {
        // The caller has already hidden the annotation UI for capture
        const shots = await captureBeforeAfterScreenshots();
        beforeScreenshot = shots.beforeScreenshot;
        afterScreenshot = shots.afterScreenshot;
      }

      return {
        inlineStyles,
        rules,
        dom,
        beforeScreenshot,
        afterScreenshot,
        duration: Date.now() - etchStartTime,
        changeCount,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (err) {
      console.error("[pi-annotate] Edit capture failed:", err);
      return null;
    }
  }

  modules.etch = { start, stop, reset, clearMarkers, collect };
})();
