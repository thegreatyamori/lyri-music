import { render } from 'solid-js/web';
import { Popup } from './Popup';

const root = document.getElementById('app');
if (root !== null) render(() => <Popup />, root);
