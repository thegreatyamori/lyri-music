import { render } from 'solid-js/web';
import { Overlay } from './Overlay';
import tokensCss from '../styles/tokens.css?inline';
import panelCss from '../styles/panel.css?inline';

/**
 * Entry point for the content script.
 *
 * The Overlay lives in a shadow root so that YouTube Music's stylesheet cannot
 * reach it and it cannot reach YouTube Music's. Both stylesheets are inlined
 * into that shadow root for the same reason — and because custom properties
 * declared on the document's `:root` do not cross the shadow boundary, so the
 * tokens have to be redeclared on `:host`.
 */
function mount(): void {
  const host = document.createElement('div');
  host.id = 'lyrimusic-host';
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `${tokensCss}\n${panelCss}`;
  shadow.append(style);

  const root = document.createElement('div');
  shadow.append(root);
  document.documentElement.append(host);

  render(() => <Overlay />, root);

  // One line, so that "the panel is not there" can be told apart from "the
  // panel is there and found nothing" without reading the source. If this does
  // not appear in the tab's console, the content script never ran.
  console.info('[LyriMusic] panel mounted');
}

mount();
