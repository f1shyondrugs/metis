import type {BrowserContext} from "playwright";

/** The protected browser exposes one page. Keep native links, forms and
 * window.open in that already guarded page instead of silently closing them.
 * This changes only the browsing target, never the destination or form body.
 */
export async function installSinglePageNavigation(context: BrowserContext) {
  await context.addInitScript(() => {
    const retarget = (element: HTMLAnchorElement | HTMLAreaElement | HTMLFormElement, submitter?: HTMLButtonElement | HTMLInputElement | null) => {
      const target = submitter?.getAttribute("formtarget") ?? element.getAttribute("target") ?? document.querySelector("base[target]")?.getAttribute("target") ?? "";
      if (target && !["_self", "_top", "_parent"].includes(target.toLowerCase())) {
        if (submitter?.hasAttribute("formtarget")) submitter.setAttribute("formtarget", "_self");
        else element.setAttribute("target", "_self");
      }
    };
    addEventListener("click", event => {
      const link = event.composedPath().find(node => node instanceof HTMLAnchorElement || node instanceof HTMLAreaElement);
      if (link instanceof HTMLAnchorElement || link instanceof HTMLAreaElement) retarget(link);
    }, true);
    addEventListener("submit", event => {
      if (event.target instanceof HTMLFormElement) {
        const submitter = event instanceof SubmitEvent ? event.submitter : null;
        retarget(event.target, submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : null);
      }
    }, true);
    // form.submit() does not dispatch a submit event.
    const nativeSubmit = HTMLFormElement.prototype.submit;
    HTMLFormElement.prototype.submit = function () {
      retarget(this);
      return nativeSubmit.call(this);
    };
    const nativeOpen = window.open;
    window.open = function (url, target, features) {
      if (url == null || String(url) === "") return window;
      const destination = target && ["_self", "_top", "_parent"].includes(target.toLowerCase()) ? target : "_self";
      return nativeOpen.call(window, url, destination, features);
    };
  });
}
