/// <reference types="vite/client" />

import type { LearningApi, WindowApi } from "../shared/types";

declare global {
  interface Window {
    learningApi: LearningApi;
    windowApi: WindowApi;
  }
}
