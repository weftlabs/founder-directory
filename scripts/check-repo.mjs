import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";

const root = process.cwd();
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean)
  .filter((file) => existsSync(file));
const errors = [];
const sources = new Map();
for (const file of new Set(files)) {
  if (/\.(ts|tsx)$/.test(file) && !file.endsWith(".d.ts")) {
    sources.set(
      resolve(file),
      ts.createSourceFile(
        file,
        readFileSync(file, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      ),
    );
  }
  if (/^\.env/.test(file) && file !== ".env.example")
    errors.push(`${file}: environment file must not be committed`);
  if (file.startsWith(".vercel/"))
    errors.push(`${file}: local deployment metadata must not be committed`);
  if (file.endsWith(".md")) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const path = decodeURIComponent(target.split("#")[0]);
      if (!existsSync(resolve(dirname(file), path)))
        errors.push(`${file}: broken local link ${target}`);
    }
    if (/\/Users\/|\.\.\/cto-os|weft-hermes/.test(text))
      errors.push(
        `${file}: private workspace reference in public documentation`,
      );
  }
  if (/\.(md|tsx|json)$/.test(file) && !file.endsWith("lock.json")) {
    if (/Solo Founders|solo-founders/.test(readFileSync(file, "utf8")))
      errors.push(`${file}: stale product branding`);
  }
}

// Follow the actual TS import graph, ignoring type-only imports. This catches
// an innocent helper that would otherwise pull database/Weft code into a client.
function inspectClient(file, chain = []) {
  if (chain.includes(file)) return;
  const source = sources.get(file);
  if (!source) return;
  const next = [...chain, file];
  const trail = next.map((p) => relative(root, p)).join(" -> ");
  if (
    /process\.env\.(?:WEFT_API_KEY|DATABASE_URL|CRON_SECRET)/.test(source.text)
  )
    errors.push(`${trail}: server credentials reachable from client`);
  const inspectImport = (specifier) => {
    if (
      ["@weft-labs/sdk", "@neondatabase/serverless", "server-only"].includes(
        specifier,
      )
    )
      errors.push(`${trail}: server dependency ${specifier}`);
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) return;
    const base = specifier.startsWith("@/")
      ? resolve(root, specifier.slice(2))
      : resolve(dirname(file), specifier);
    const target = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      resolve(base, "index.ts"),
      resolve(base, "index.tsx"),
    ].find((p) => sources.has(p));
    if (target) inspectClient(target, next);
  };
  function visit(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) {
      const bindings = node.importClause?.namedBindings;
      const typesOnly =
        !node.importClause?.name &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.length > 0 &&
        bindings.elements.every((item) => item.isTypeOnly);
      if (!typesOnly && ts.isStringLiteral(node.moduleSpecifier))
        inspectImport(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      inspectImport(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      inspectImport(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source);
}
for (const [file, source] of sources) {
  if (
    source.statements.some(
      (node) =>
        ts.isExpressionStatement(node) &&
        ts.isStringLiteral(node.expression) &&
        node.expression.text === "use client",
    )
  )
    inspectClient(file);
}
if (errors.length) {
  console.error([...new Set(errors)].join("\n"));
  process.exitCode = 1;
} else {
  console.log(
    "Repository checks passed: local doc links, public-file hygiene, branding, client/server imports.",
  );
}
