/**
 * Pi Annotate - exact page-navigation replay adapter.
 *
 * Freezes form submissions synchronously and reconstructs Navigation API
 * events after the route guard has obtained a user decision.
 */

(() => {
  const modules = (window["__piAnnotateModules_" + chrome.runtime.id] ??= {});
  if (modules.navigation) return;

  function createNavigationAdapter({
    isDirty,
    retainCanceledRoute,
    navigation = window.navigation,
    eventTarget = document,
    now = () => Date.now(),
  }) {
    let started = false;
    let rememberedFormReplay = null;

    function createFrozenFormReplay(config, entries) {
      return {
        replay: () => {
          const replayForm = document.createElement("form");
          replayForm.style.display = "none";
          replayForm.action = config.action;
          replayForm.method = config.method;
          replayForm.enctype = config.enctype;
          replayForm.target = config.target;
          for (const [name, value] of entries) {
            const isFile = typeof File !== "undefined" && value instanceof File;
            if (isFile && typeof DataTransfer !== "undefined") {
              const input = document.createElement("input");
              input.type = "file";
              input.name = name;
              const transfer = new DataTransfer();
              transfer.items.add(value);
              input.files = transfer.files;
              replayForm.appendChild(input);
            } else {
              const input = document.createElement("input");
              input.type = "hidden";
              input.name = name;
              input.value = isFile ? value.name : value;
              replayForm.appendChild(input);
            }
          }
          document.body.appendChild(replayForm);
          try {
            return HTMLFormElement.prototype.submit.call(replayForm);
          } finally {
            replayForm.remove();
          }
        },
      };
    }

    function freezeFormReplayEntries(form, submitter, entries) {
      const submitterOverride = (attribute, property, fallback) =>
        submitter?.hasAttribute?.(attribute) ? submitter[property] : fallback;
      return createFrozenFormReplay({
        action: submitterOverride("formaction", "formAction", form.action) || window.location.href,
        method: (submitterOverride("formmethod", "formMethod", form.method) || "get").toLowerCase(),
        enctype: submitterOverride("formenctype", "formEnctype", form.enctype) ||
          "application/x-www-form-urlencoded",
        target: submitterOverride("formtarget", "formTarget", form.target) || "_self",
      }, entries);
    }

    function onFormData(event) {
      const form = event.target;
      if (!form || !isDirty()) return;
      const target = (form.target || "").toLowerCase();
      if (target && !["_self", "_top", "_parent"].includes(target)) return;
      const descriptor = freezeFormReplayEntries(
        form,
        null,
        Array.from(event.formData.entries()),
      );
      rememberedFormReplay = { at: now(), replay: descriptor.replay };
    }

    function onFormSubmit(event) {
      const form = event.target;
      if (!form || !isDirty()) return;
      const submitter = event.submitter;
      const target = (
        submitter?.hasAttribute?.("formtarget") ? submitter.formTarget : form.target || ""
      ).toLowerCase();
      if (target && !["_self", "_top", "_parent"].includes(target)) return;
      const entries = Array.from(new FormData(form, submitter).entries());
      const descriptor = freezeFormReplayEntries(form, submitter, entries);
      rememberedFormReplay = { at: now(), replay: descriptor.replay };

      // Some Chromium form submissions never surface as cancelable Navigation
      // events in the isolated world, so retain them at this exact-source seam.
      if (event.cancelable) {
        event.preventDefault();
        const retained = rememberedFormReplay;
        rememberedFormReplay = null;
        retainCanceledRoute(retained);
      }
    }

    function createReplayDescriptor(event) {
      if (event.formData && rememberedFormReplay && now() - rememberedFormReplay.at < 1000) {
        const descriptor = rememberedFormReplay;
        rememberedFormReplay = null;
        return descriptor;
      }
      const destination = event.destination?.url;
      if (!destination) throw new Error("The canceled route has no destination");
      if (event.formData) {
        throw new Error("The canceled POST route could not be reconstructed exactly");
      }
      if (event.navigationType === "reload") {
        return {
          replay: () => navigation?.reload
            ? navigation.reload({ state: event.destination?.getState?.() }).finished
            : window.location.reload(),
        };
      }
      if (event.navigationType === "traverse" && event.destination?.key && navigation?.traverseTo) {
        const key = event.destination.key;
        return { replay: () => navigation.traverseTo(key).finished };
      }
      const history = event.navigationType === "replace" ? "replace" : "push";
      return {
        replay: () => {
          if (navigation?.navigate) {
            return navigation.navigate(destination, {
              history,
              state: event.destination?.getState?.(),
            }).finished;
          }
          window.location.href = destination;
        },
      };
    }

    function start() {
      if (started) return;
      started = true;
      eventTarget.addEventListener("submit", onFormSubmit, true);
      eventTarget.addEventListener("formdata", onFormData, true);
    }

    function stop() {
      if (!started) return;
      started = false;
      rememberedFormReplay = null;
      eventTarget.removeEventListener("submit", onFormSubmit, true);
      eventTarget.removeEventListener("formdata", onFormData, true);
    }

    return Object.freeze({ start, stop, createReplayDescriptor });
  }

  modules.navigation = { createNavigationAdapter };
})();
