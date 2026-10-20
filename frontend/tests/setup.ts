import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

window.scrollTo = vi.fn();
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
});
