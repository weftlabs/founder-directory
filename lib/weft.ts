import "./assert-server";
import { WeftClient } from "@weft-labs/sdk";

export type WeftTransport = Pick<WeftClient, "fetch">;

// Inject the paid boundary in offline tests; application callers use the SDK.
export type WeftDependencies = {
  apiKey: () => string | undefined;
  createClient: (apiKey: string) => WeftTransport;
  sleep?: (ms: number) => Promise<void>;
};

export const defaultWeftDependencies: WeftDependencies = {
  apiKey: () => process.env.WEFT_API_KEY,
  createClient: (apiKey) => new WeftClient({ apiKey }),
};
