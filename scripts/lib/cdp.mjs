/**
 * A headless Chrome, driven over CDP, for the styling harnesses.
 *
 * Written after `--screenshot` turned out to be untrustworthy for this: with
 * `--window-size=360,520` it produces a 720px-wide file, which reads as a 360 CSS
 * viewport at 2x, while the layout viewport it actually used was 500 — headless
 * Chrome enforces a minimum window width and says nothing about it. The page then
 * laid itself out for 500 and the image showed the left 360 of it, so text that
 * wrapped perfectly well appeared to run off the edge.
 *
 * That is worth recording: it cost an afternoon of measuring a layout that was
 * never wrong. The fix is to stop letting the window size mean anything.
 * `Emulation.setDeviceMetricsOverride` sets the viewport explicitly, and the
 * screenshot and any measurement are taken in the same session, so they cannot
 * describe two different pages.
 */

import { spawn } from 'node:child_process';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launch(port) {
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      `--user-data-dir=${process.env.TMPDIR ?? '/tmp'}/lyri-cdp`,
      `--remote-debugging-port=${port}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  const target = await waitForPage(port);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve) => socket.addEventListener('open', resolve));

  let nextId = 1;
  const pending = new Map();

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    const resolve = pending.get(message.id);
    if (resolve !== undefined) {
      pending.delete(message.id);
      resolve(message.result);
    }
  });

  return {
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve) => {
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
      chrome.kill();
    },
  };
}

async function waitForPage(port) {
  for (let waited = 0; waited < 20_000; waited += 250) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const found = (await response.json()).find((entry) => entry.type === 'page');
        if (found !== undefined) return found;
      }
    } catch {
      // Not up yet, or not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('chrome never offered a page to drive');
}
