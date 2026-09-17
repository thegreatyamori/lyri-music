// @vitest-environment happy-dom

/**
 * The PiP window's shell.
 *
 * Small, and worth a test anyway: the thing it decides is where the render lands,
 * and getting that wrong is invisible. A wrapper element between the body and the
 * lyric list costs the list its height, and losing its height costs the scroll —
 * the lyrics simply stop at the bottom of the window with nothing to drag.
 *
 * That bug shipped. It passed the type checker, the test suite and a preview
 * harness, because the harness wrote the correct structure by hand while the app
 * wrapped it. This test is the thing that was missing.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PIP_BODY_CLASS, PIP_HEIGHT, PIP_WIDTH, openPipShell } from '../src/content/pip-window';

/** Stands in for the browser API, handing back the document under test. */
function stubPipApi(available = true): ReturnType<typeof vi.fn> {
  const requestWindow = vi.fn(async (options: { width: number; height: number }) => {
    void options;
    return window;
  });

  Object.defineProperty(window, 'documentPictureInPicture', {
    value: available ? { requestWindow, window: null } : undefined,
    configurable: true,
  });

  return requestWindow;
}

afterEach(() => {
  document.body.className = '';
  document.head.innerHTML = '';
  vi.restoreAllMocks();
});

describe('openPipShell', () => {
  it('returns the body as the render target, not a wrapper', () => {
    stubPipApi();

    return openPipShell('/* css */').then((shell) => {
      // The whole point. `body.lyrimusic-pip` is the flex column that gives the
      // lyric list its height; a wrapper between them would leave the list with
      // no height, and a list with no height cannot scroll.
      expect(shell?.target).toBe(document.body);
    });
  });

  it('marks the body with the class the stylesheet keys off', async () => {
    stubPipApi();

    await openPipShell('/* css */');

    expect(document.body.classList.contains(PIP_BODY_CLASS)).toBe(true);
  });

  it('puts the stylesheet in the window, since a PiP document inherits nothing', async () => {
    stubPipApi();

    await openPipShell('/* invented css */');

    const styles = [...document.head.querySelectorAll('style')];
    expect(styles.some((style) => style.textContent === '/* invented css */')).toBe(true);
  });

  it('opens at the documented size', async () => {
    const requestWindow = stubPipApi();

    await openPipShell('/* css */');

    expect(requestWindow).toHaveBeenCalledWith({ width: PIP_WIDTH, height: PIP_HEIGHT });
  });

  it('reports no shell on a browser without the API, rather than throwing', async () => {
    stubPipApi(false);

    await expect(openPipShell('/* css */')).resolves.toBeNull();
  });

  it('leaves the render target empty for the caller to fill', async () => {
    stubPipApi();

    await openPipShell('/* css */');

    // It prepares the document and stops there; what goes inside is the caller's
    // business, and the caller renders into `.target` directly.
    expect(document.body.children).toHaveLength(0);
  });
});
