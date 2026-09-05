/// <reference types="vite/client" />
import type { BridgeApi } from '../electron/ipc.js';

declare global {
  interface Window {
    /** Injected by the preload script. The renderer's only door to the host. */
    readonly bombParty: BridgeApi;
  }
}

export {};
