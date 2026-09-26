import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ANALYTICS_EVENT_NAMES,
  DIRECTORY_ANALYTICS_EVENT_NAMES,
  prepareAnalyticsEvent,
  safeAnalyticsPageUrl,
  sanitizePostHogEvent,
} from "../lib/analytics-events";

const profile = {
  profile_id: "11111111-1111-4111-8111-111111111111",
  profile_revision: "profile-revision-1",
  release_id: "22222222-2222-4222-8222-222222222222",
};
const posthogToken = "phc_test";

test("Founder DNA analytics exposes only the six versioned events", () => {
  assert.deepEqual(ANALYTICS_EVENT_NAMES, [
    "weft_founder_dna_profile_viewed",
    "weft_founder_dna_share_copied",
    "weft_founder_dna_image_download_started",
    "weft_founder_dna_connections_viewed",
    "weft_founder_dna_connection_previewed",
    "weft_founder_dna_connection_clicked",
  ]);
  assert.deepEqual(
    prepareAnalyticsEvent("weft_founder_dna_profile_viewed", profile),
    {
      event: "weft_founder_dna_profile_viewed",
      properties: { schema_version: 1, ...profile },
    },
  );
});

test("directory presence keeps a separate typed event contract", () => {
  assert.deepEqual(DIRECTORY_ANALYTICS_EVENT_NAMES, [
    "weft_founder_directory_presence_started",
  ]);
  assert.deepEqual(
    prepareAnalyticsEvent("weft_founder_directory_presence_started", {}),
    {
      event: "weft_founder_directory_presence_started",
      properties: { schema_version: 1 },
    },
  );
});

test("the catalog keeps exact property types and drops extra fields", () => {
  const messages: string[] = [];
  assert.deepEqual(
    prepareAnalyticsEvent(
      "weft_founder_dna_connections_viewed",
      {
        ...profile,
        connection_count: 3,
        handle: "private_handle",
        url: "https://example.test/u/private_handle",
        copied_text: "private text",
        schema_version: 99,
      },
      (message) => messages.push(message),
    ),
    {
      event: "weft_founder_dna_connections_viewed",
      properties: {
        schema_version: 1,
        ...profile,
        connection_count: 3,
      },
    },
  );
  assert.equal(messages.length, 4);
});

test("invalid event names and required properties fail closed without throwing", () => {
  const messages: string[] = [];
  const log = (message: string) => messages.push(message);
  assert.equal(
    prepareAnalyticsEvent("founder_dna_profile_viewed", profile, log),
    null,
  );
  assert.equal(
    prepareAnalyticsEvent(
      "weft_founder_dna_profile_viewed",
      { ...profile, profile_id: "https://example.test/person" },
      log,
    ),
    null,
  );
  assert.equal(
    prepareAnalyticsEvent(
      "weft_founder_dna_connections_viewed",
      { ...profile, connection_count: "3" },
      log,
    ),
    null,
  );
  assert.equal(
    prepareAnalyticsEvent(
      "weft_founder_dna_connections_viewed",
      { ...profile, connection_count: 4 },
      log,
    ),
    null,
  );
  assert.equal(
    prepareAnalyticsEvent(
      "weft_founder_dna_connection_clicked",
      {
        ...profile,
        connection_id: "connection-1",
        destination_profile_id: "33333333-3333-4333-8333-333333333333",
        surface: "footer",
      },
      log,
    ),
    null,
  );
  assert.equal(
    prepareAnalyticsEvent("weft_founder_dna_profile_viewed", null, log),
    null,
  );
  assert.equal(messages.length, 6);
});

test("connection events preserve only their declared contract", () => {
  assert.deepEqual(
    prepareAnalyticsEvent("weft_founder_dna_connection_previewed", {
      ...profile,
      connection_id: "connection-1",
    }),
    {
      event: "weft_founder_dna_connection_previewed",
      properties: {
        schema_version: 1,
        ...profile,
        connection_id: "connection-1",
      },
    },
  );
  assert.deepEqual(
    prepareAnalyticsEvent("weft_founder_dna_connection_clicked", {
      ...profile,
      connection_id: "connection-1",
      destination_profile_id: "33333333-3333-4333-8333-333333333333",
      surface: "card",
    }),
    {
      event: "weft_founder_dna_connection_clicked",
      properties: {
        schema_version: 1,
        ...profile,
        connection_id: "connection-1",
        destination_profile_id: "33333333-3333-4333-8333-333333333333",
        surface: "card",
      },
    },
  );
});

test("PostHog sanitization rebuilds custom events from their exact contract", () => {
  assert.deepEqual(
    sanitizePostHogEvent(
      {
        event: "weft_founder_dna_profile_viewed",
        private_context: "must-not-survive",
        properties: {
          schema_version: 1,
          ...profile,
          token: posthogToken,
          distinct_id: "anonymous-device",
          $current_url: "https://example.test/u/private_handle?q=private",
          $pathname: "/u/private_handle",
          $referrer: "https://search.test/?q=private",
          $initial_referrer: "https://search.test/?q=private",
          $initial_current_url: "https://example.test/u/private_handle",
          $prev_pageview_pathname: "/u/private_handle",
          $set: { email: "person@example.test" },
          $set_once: { name: "Person" },
          handle: "private_handle",
          copied_text: "private text",
        },
      },
      posthogToken,
    ),
    {
      event: "weft_founder_dna_profile_viewed",
      properties: {
        schema_version: 1,
        ...profile,
        token: posthogToken,
        distinct_id: "anonymous-device",
      },
    },
  );
});

test("PostHog sanitization keeps page, presence and Founder DNA contracts separate", () => {
  const unsafeProperties = {
    token: posthogToken,
    distinct_id: "anonymous-device",
    $current_url:
      "https://user:password@example.test/u/private_handle?query=private#secret",
    $pathname: "/u/private_handle",
    $referrer: "https://search.test/?q=private",
    $initial_referrer: "https://search.test/?q=private",
    $initial_current_url: "https://example.test/u/private_handle",
    $prev_pageview_pathname: "/u/private_handle",
    $set: { email: "person@example.test" },
    $set_once: { name: "Person" },
    handle: "private_handle",
  };

  assert.equal(
    safeAnalyticsPageUrl(unsafeProperties.$current_url),
    "https://example.test/u/:handle",
  );
  assert.deepEqual(
    sanitizePostHogEvent(
      {
        event: "$pageview",
        private_context: "must-not-survive",
        properties: unsafeProperties,
      },
      posthogToken,
    ),
    {
      event: "$pageview",
      properties: {
        token: posthogToken,
        distinct_id: "anonymous-device",
        $current_url: "https://example.test/u/:handle",
      },
    },
  );
  assert.deepEqual(
    sanitizePostHogEvent(
      { event: "$pageleave", properties: unsafeProperties },
      posthogToken,
    ),
    {
      event: "$pageleave",
      properties: {
        token: posthogToken,
        distinct_id: "anonymous-device",
        $current_url: "https://example.test/u/:handle",
      },
    },
  );
  assert.deepEqual(
    sanitizePostHogEvent(
      {
        event: "weft_founder_directory_presence_started",
        properties: unsafeProperties,
      },
      posthogToken,
    ),
    {
      event: "weft_founder_directory_presence_started",
      properties: {
        schema_version: 1,
        token: posthogToken,
        distinct_id: "anonymous-device",
      },
    },
  );
  assert.deepEqual(
    sanitizePostHogEvent(
      {
        event: "weft_founder_dna_profile_viewed",
        properties: { ...unsafeProperties, ...profile },
      },
      posthogToken,
    ),
    {
      event: "weft_founder_dna_profile_viewed",
      properties: {
        schema_version: 1,
        ...profile,
        token: posthogToken,
        distinct_id: "anonymous-device",
      },
    },
  );
});

test("PostHog sanitization drops unknown or malformed vendor events", () => {
  assert.equal(
    sanitizePostHogEvent({ event: "$pageview", properties: {} }, posthogToken),
    null,
  );
  assert.equal(
    sanitizePostHogEvent(
      {
        event: "$pageview",
        properties: {
          token: posthogToken,
          distinct_id: "anonymous-device",
          $current_url: "javascript:alert(1)",
        },
      },
      posthogToken,
    ),
    null,
  );
  assert.equal(
    sanitizePostHogEvent(
      {
        event: "unknown",
        properties: { token: posthogToken, distinct_id: "anonymous-device" },
      },
      posthogToken,
    ),
    null,
  );
  assert.equal(
    sanitizePostHogEvent({ event: "$pageview" }, posthogToken),
    null,
  );
  assert.equal(
    sanitizePostHogEvent(
      {
        event: "$pageview",
        properties: {
          token: "phc_other",
          distinct_id: "anonymous-device",
          $current_url: "https://example.test/",
        },
      },
      posthogToken,
    ),
    null,
  );
});
