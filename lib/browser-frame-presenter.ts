import { replaceBrowserFrameUrl } from "./browser-frame-url";

type Frame = Blob | string;
type PendingFrame = { value: Frame; onSettled?: () => void };
type FrameImage = Pick<HTMLImageElement, "src" | "onload" | "onerror" | "addEventListener" | "removeEventListener" | "removeAttribute">;

/** One image decode in flight and one latest frame waiting; never queue a session's frames. */
export function createBrowserFramePresenter(image: FrameImage, onFrame: () => void, schedule = requestAnimationFrame, cancel = cancelAnimationFrame) {
  let pending: PendingFrame | null = null;
  let loadingSettled: (() => void) | undefined;
  let frameId: number | null = null;
  let loading = false;
  let disposed = false;
  let objectUrl: string | null = null;

  const scheduleNext = () => {
    if (!disposed && !loading && pending !== null && frameId === null) {
      frameId = schedule(present);
    }
  };
  const settled = (event: Event) => {
    if (disposed || !loading) return;
    loading = false;
    const done = loadingSettled;
    loadingSettled = undefined;
    try {
      if (event.type === "load") onFrame();
    } finally {
      done?.();
      scheduleNext();
    }
  };
  function present() {
    frameId = null;
    if (disposed || loading || pending === null) return;
    const next = pending;
    pending = null;
    loading = true;
    loadingSettled = next.onSettled;
    try {
      if (typeof next.value === "string") {
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = null;
        image.src = next.value;
      } else {
        const previous = objectUrl;
        objectUrl = null;
        objectUrl = replaceBrowserFrameUrl(previous, next.value, image);
      }
    } catch {
      // An invalid/superseded image must release stream backpressure too.
      settled(new Event("error"));
    }
  }
  image.addEventListener("load", settled);
  image.addEventListener("error", settled);
  return {
    push(frame: Frame, onSettled?: () => void) {
      if (disposed) return;
      const superseded = pending;
      pending = { value: frame, onSettled };
      // A pending frame can be replaced by a newer action screenshot. It still
      // needs its acknowledgement, without retaining a history of callbacks.
      superseded?.onSettled?.();
      scheduleNext();
    },
    dispose() {
      disposed = true;
      pending = null;
      loadingSettled = undefined;
      if (frameId !== null) cancel(frameId);
      frameId = null;
      image.removeEventListener("load", settled);
      image.removeEventListener("error", settled);
      image.removeAttribute("src");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    },
  };
}

export type BrowserFramePresenter = ReturnType<typeof createBrowserFramePresenter>;
