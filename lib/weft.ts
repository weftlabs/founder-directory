import "./assert-server";
import type { WeftClient } from "@weft-labs/sdk";
import { durableWeftClient } from "./enrichment/runtime";

export type WeftTransport = Pick<WeftClient, "fetch">;

// Inject the paid boundary in offline tests; application callers use the SDK.
export type WeftDependencies = {
  apiKey: () => string | undefined;
  createClient: (apiKey: string) => WeftTransport;
  sleep?: (ms: number) => Promise<void>;
};

export const defaultWeftDependencies: WeftDependencies = {
  apiKey: () => process.env.WEFT_API_KEY,
  createClient: durableWeftClient,
};
