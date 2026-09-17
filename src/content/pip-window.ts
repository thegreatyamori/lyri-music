/**
 * Opening the picture-in-picture window, and the one structural decision it
 * makes.
 *
 * It lives in its own module so that decision can be tested. The window's
 * stylesheet is written against `body.lyrimusic-pip` being a flex column, which
 * makes the lyric list a flex item of the BODY and gives it the height it needs
 * in order to scroll. Put anything between the two and the list loses its
 * height: `flex: 1` does nothing against a non-flex parent, the list grows past
 * the window, and the body's `overflow: hidden` turns the rest of the lyrics
 * into text that simply stops.
 *
 * That was a real bug. It survived a build, a test suite and a preview harness,
 * because the harness wrote the correct structure by hand and the app did not.
 * Hence a function that owns the structure, and a test that pins it.
 */

/** The size the window is opened at. */
export const PIP_WIDTH = 360;
export const PIP_HEIGHT = 520;

/** The class the PiP stylesheet keys off. */
export const PIP_BODY_CLASS = 'lyrimusic-pip';

export interface PipShell {
  /** The window itself, for listening to its close. */
  readonly window: Window;
  /**
   * Where to render — the body, deliberately and not a wrapper element.
   * See the note at the top of this module.
   */
  readonly target: HTMLElement;
}

/**
 * Opens the window and prepares its document, or returns null on a browser that
 * has no Document Picture-in-Picture support.
 */
export async function openPipShell(css: string): Promise<PipShell | null> {
  const api = window.documentPictureInPicture;
  if (api === undefined) return null;

  const pip = await api.requestWindow({ width: PIP_WIDTH, height: PIP_HEIGHT });

  // Both stylesheets, inlined: the window is a separate document and inherits
  // nothing from the page, not even the custom properties on `:root`.
  const style = pip.document.createElement('style');
  style.textContent = css;
  pip.document.head.append(style);

  pip.document.body.classList.add(PIP_BODY_CLASS);

  return { window: pip, target: pip.document.body };
}
