export const ANALYTICS_EVENT_NAMES = [
  "weft_founder_dna_profile_viewed",
  "weft_founder_dna_share_copied",
  "weft_founder_dna_image_download_started",
  "weft_founder_dna_connections_viewed",
  "weft_founder_dna_connection_previewed",
  "weft_founder_dna_connection_clicked",
] as const;

export const DIRECTORY_ANALYTICS_EVENT_NAMES = [
  "weft_founder_directory_presence_started",
] as const;

const CUSTOM_ANALYTICS_EVENT_NAMES = [
  ...DIRECTORY_ANALYTICS_EVENT_NAMES,
  ...ANALYTICS_EVENT_NAMES,
] as const;

export type AnalyticsEventName = (typeof CUSTOM_ANALYTICS_EVENT_NAMES)[number];

type ProfileProperties = {
  profile_id: string;
  profile_revision: string;
  release_id: string;
};

export type AnalyticsEventProperties = {
  weft_founder_directory_presence_started: Record<string, never>;
  weft_founder_dna_profile_viewed: ProfileProperties;
  weft_founder_dna_share_copied: ProfileProperties;
  weft_founder_dna_image_download_started: ProfileProperties;
  weft_founder_dna_connections_viewed: ProfileProperties & {
    connection_count: number;
  };
  weft_founder_dna_connection_previewed: ProfileProperties & {
    connection_id: string;
  };
  weft_founder_dna_connection_clicked: ProfileProperties & {
    connection_id: string;
    destination_profile_id: string;
    surface: "graph" | "card";
  };
};

export type AnalyticsInput<E extends AnalyticsEventName> =
  AnalyticsEventProperties[E];

export type PreparedAnalyticsEvent = {
  event: AnalyticsEventName;
  properties: Record<string, string | number> & { schema_version: 1 };
};

type Log = (message: string) => void;

const commonFields = ["profile_id", "profile_revision", "release_id"] as const;

const eventFields: Record<AnalyticsEventName, readonly string[]> = {
  weft_founder_directory_presence_started: [],
  weft_founder_dna_profile_viewed: commonFields,
  weft_founder_dna_share_copied: commonFields,
  weft_founder_dna_image_download_started: commonFields,
  weft_founder_dna_connections_viewed: [...commonFields, "connection_count"],
  weft_founder_dna_connection_previewed: [...commonFields, "connection_id"],
  weft_founder_dna_connection_clicked: [
    ...commonFields,
    "connection_id",
    "destination_profile_id",
    "surface",
  ],
};

const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;

function validProperty(key: string, value: unknown) {
  if (key === "connection_count")
    return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 3;
  if (key === "surface") return value === "graph" || value === "card";
  return typeof value === "string" && identifier.test(value);
}

function defaultLog(message: string) {
  console.warn(message);
}

export function prepareAnalyticsEvent(
  event: string,
  input: unknown,
  log: Log = defaultLog,
): PreparedAnalyticsEvent | null {
  if (!(CUSTOM_ANALYTICS_EVENT_NAMES as readonly string[]).includes(event)) {
    log(`Analytics dropped unknown event: ${event}`);
    return null;
  }
  const name = event as AnalyticsEventName;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    log(`Analytics dropped malformed ${name}: properties`);
    return null;
  }
  const source = input as Record<string, unknown>;
  const fields = eventFields[name];
  const allowed = new Set(fields);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key))
      log(`Analytics dropped property ${key} from ${name}`);
  }
  const properties: PreparedAnalyticsEvent["properties"] = {
    schema_version: 1,
  };
  for (const key of fields) {
    const value = source[key];
    if (!validProperty(key, value)) {
      log(`Analytics dropped malformed ${name}: ${key}`);
      return null;
    }
    properties[key] = value as string | number;
  }
  return { event: name, properties };
}

export type PostHogEvent = {
  event?: string;
  properties?: Record<string, unknown>;
  [key: string]: unknown;
};

function transportProperties(
  properties: Record<string, unknown>,
  expectedToken: string,
) {
  const distinctId = properties.distinct_id;
  if (
    !expectedToken.startsWith("phc_") ||
    expectedToken.length > 200 ||
    properties.token !== expectedToken ||
    typeof distinctId !== "string" ||
    distinctId.length === 0 ||
    distinctId.length > 200
  )
    return null;
  return { token: expectedToken, distinct_id: distinctId };
}

export function safeAnalyticsPageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
      return null;
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    if (/^\/u\/[^/]+$/.test(parsed.pathname)) parsed.pathname = "/u/:handle";
    return parsed.toString();
  } catch {
    return null;
  }
}

export function sanitizePostHogEvent(
  event: PostHogEvent,
  expectedToken: string,
): PostHogEvent | null {
  if (!event.event || !event.properties) return null;
  const transport = transportProperties(event.properties, expectedToken);
  if (!transport) return null;
  if (event.event === "$pageview" || event.event === "$pageleave") {
    const currentUrl = safeAnalyticsPageUrl(event.properties.$current_url);
    if (!currentUrl) return null;
    return {
      event: event.event,
      properties: {
        ...transport,
        $current_url: currentUrl,
      },
    };
  }
  if (
    !(CUSTOM_ANALYTICS_EVENT_NAMES as readonly string[]).includes(event.event)
  )
    return null;
  const prepared = prepareAnalyticsEvent(
    event.event,
    event.properties,
    () => undefined,
  );
  if (!prepared) return null;
  return {
    event: prepared.event,
    properties: {
      ...prepared.properties,
      ...transport,
    },
  };
}
