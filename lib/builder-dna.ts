export type BuilderEvidence = {
  id: string;
  title: string;
  excerpt: string;
  url: string;
  sourceLabel: string;
  kind: "self-reported" | "product-site";
  observedAt: string;
};

export type BuilderDnaExample = {
  handle: string;
  name: string;
  initials: string;
  location: string;
  product: string;
  website: string;
  avatarUrl?: string;
  oldCategory: string;
  signature: string;
  summary: string;
  craft: string[];
  productTags: string[];
  domains: string[];
  workingStyle: string[];
  evidence: BuilderEvidence[];
  classificationReason: string;
  unknowns: string[];
};

/** Conservative preview rules. Labels are interpretations, never verified skill ratings. */
export function classifyBuilder(evidence: BuilderEvidence[]) {
  const text = evidence
    .map((entry) => entry.excerpt)
    .join(" ")
    .toLowerCase();
  const craft: string[] = [];
  const productTags: string[] = [];
  const domains: string[] = [];
  const workingStyle: string[] = [];
  const reasons: string[] = [];
  let signature = "Still taking shape";
  if (/full.stack|engineer|developer|\bdev\b/.test(text))
    craft.push("Engineering");
  if (/designer|brand archaeologist/.test(text)) craft.push("Product & Design");
  const hasAiApplication = /\bai\b|digital workforce/.test(text);
  if (/logistics|shippers|carriers|3pls/.test(text)) {
    domains.push("Logistics");
    if (hasAiApplication) productTags.push("AI applications");
    craft.push("Operations");
    signature = "Workflow builder";
    reasons.push(
      "The product describes logistics workflows and serves shippers, carriers and 3PLs. AI workers describe the application, not an infrastructure business. Operations is a product-focus inference, not a verified founder skill.",
    );
  }
  if (/medication|médicament|nurses|infirmier|midwives/.test(text)) {
    domains.push("Healthcare");
    productTags.push("Professional apps");
    signature = "Practitioner turned builder";
    reasons.push(
      "The founder names a clinical background and the product targets nurses and midwives. This is a professional healthcare application, rather than a generic consumer app. Clinical effectiveness has not been assessed.",
    );
  }
  if (/personal brand|brand kernel|brandkernel/.test(text)) {
    domains.push("Branding & marketing");
    if (hasAiApplication) productTags.push("AI applications");
    signature = "Brand systems builder";
    reasons.push(
      "The product turns personal-brand inputs into structured context for AI. Its customer use case is branding; API/MCP integration alone does not make it infrastructure.",
    );
  }
  if (
    /documenting the journey in public|build.in.public|building in public/.test(
      text,
    )
  )
    workingStyle.push("Build-in-public");
  if (/solo founder/.test(text)) workingStyle.push("Solo founder");
  return {
    craft: [...new Set(craft)],
    productTags: [...new Set(productTags)],
    domains,
    workingStyle,
    signature,
    classificationReason:
      reasons.join(" ") ||
      "The available evidence is not specific enough to assign a craft or product category. Generic founder language is not evidence of infrastructure.",
  };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected snapshot object");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error("Missing snapshot text");
  return value;
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Expected snapshot list");
  return value.map(text);
}
function publicUrl(value: unknown): string {
  const raw = text(value);
  const parsed = new URL(raw);
  if (
    !["https:", "http:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error("Invalid source URL");
  return raw;
}

/** Local snapshots cross an untrusted JSON boundary; allow no executable links. */
export function parseBuilderDnaExamples(value: unknown): BuilderDnaExample[] {
  if (!Array.isArray(value)) throw new Error("Expected example list");
  const handles = new Set<string>();
  return value.map((input) => {
    const row = record(input);
    const handle = text(row.handle);
    if (
      !/^[A-Za-z0-9_]{1,15}$/.test(handle) ||
      handles.has(handle.toLowerCase())
    )
      throw new Error("Invalid or duplicate founder handle");
    handles.add(handle.toLowerCase());
    if (!Array.isArray(row.evidence) || !row.evidence.length)
      throw new Error("Examples require evidence");
    const ids = new Set<string>();
    const evidence = row.evidence.map((item): BuilderEvidence => {
      const entry = record(item);
      const id = text(entry.id);
      if (ids.has(id)) throw new Error("Duplicate evidence id");
      ids.add(id);
      if (entry.kind !== "self-reported" && entry.kind !== "product-site")
        throw new Error("Invalid source kind");
      const observedAt = text(entry.observedAt);
      const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(
        observedAt,
      );
      const normalized = observedAt.includes(".")
        ? observedAt
        : observedAt.replace(/Z$/, ".000Z");
      if (
        !utc ||
        !Number.isFinite(Date.parse(observedAt)) ||
        new Date(observedAt).toISOString() !== normalized
      )
        throw new Error("Invalid observation date");
      return {
        id,
        title: text(entry.title),
        excerpt: text(entry.excerpt),
        url: publicUrl(entry.url),
        sourceLabel: text(entry.sourceLabel),
        kind: entry.kind,
        observedAt,
      };
    });
    return {
      handle,
      name: text(row.name),
      initials: text(row.initials),
      location: text(row.location),
      product: text(row.product),
      website: publicUrl(row.website),
      ...(row.avatarUrl ? { avatarUrl: publicUrl(row.avatarUrl) } : {}),
      oldCategory: text(row.oldCategory),
      summary: text(row.summary),
      evidence,
      unknowns: strings(row.unknowns),
      ...classifyBuilder(evidence),
    };
  });
}
