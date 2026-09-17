/**
 * Minimal ambient types for the Document Picture-in-Picture API.
 *
 * Declared here rather than relied on from `lib.dom`, whose version depends on
 * the TypeScript release. The panel treats the API as optional, so the property
 * is optional too, and the fallback path is exercised on any browser without it.
 */

declare global {
  interface Window {
    documentPictureInPicture?: {
      requestWindow(options?: { width?: number; height?: number }): Promise<Window>;
      readonly window: Window | null;
    };
  }
}

export {};
