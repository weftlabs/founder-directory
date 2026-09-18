// Development-only display snapshots. Never fall back to a live database.
import "./assert-server";
import { readFile } from "node:fs/promises";
import { safeHttpUrl } from "./model";
import { productCard, type ProductInput } from "./products";
type Env = Record<string, string | undefined>;
export async function readProductSnapshot(env: Env) {
  if (
    !env.PRODUCTS_LOCAL_SNAPSHOT ||
    env.NODE_ENV !== "development" ||
    env.VERCEL
  )
    throw new Error("preview_disabled");
  const data = await readFile(env.PRODUCTS_LOCAL_SNAPSHOT, "utf8");
  if (Buffer.byteLength(data) > 1_000_000)
    throw new Error("snapshot_too_large");
  const parsed = JSON.parse(data);
  if (
    parsed?.version !== 1 ||
    !Array.isArray(parsed.products) ||
    parsed.products.length > 200 ||
    parsed.products.some(
      (p: unknown) => !p || typeof p !== "object" || Array.isArray(p),
    )
  )
    throw new Error("invalid_snapshot");
  return parsed as { products: ProductInput[]; profiles?: unknown[] };
}
export async function loadLocalProductFounder(
  handle: string,
  env: Env = process.env,
) {
  if (!/^[a-zA-Z0-9_]{1,15}$/.test(handle)) return null;
  try {
    const snapshot = await readProductSnapshot(env);
    const products = snapshot.products
      .map(productCard)
      .filter((p) =>
        p.founders.some((h) => h.toLowerCase() === handle.toLowerCase()),
      );
    if (!products.length) return null;
    const record = Array.isArray(snapshot.profiles)
      ? (snapshot.profiles.find(
          (p) =>
            p &&
            typeof p === "object" &&
            "handle" in p &&
            typeof p.handle === "string" &&
            p.handle.toLowerCase() === handle.toLowerCase(),
        ) as Record<string, unknown> | undefined)
      : undefined;
    const field = (key: string) =>
      typeof record?.[key] === "string"
        ? (record[key] as string).slice(0, 2400)
        : null;
    return {
      handle: handle.toLowerCase(),
      name: field("name"),
      bio: field("bio"),
      location: field("location"),
      website: safeHttpUrl(field("website")),
      avatarUrl: safeHttpUrl(field("avatarUrl")),
      products,
    };
  } catch {
    return null;
  }
}
