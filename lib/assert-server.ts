// Runtime guard also works in the standalone ingestion scripts and node:test.
// Keep credential-bearing modules out of browser execution.
if (typeof window !== "undefined") {
  throw new Error("This module is server-only");
}

export {};
