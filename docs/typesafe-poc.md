# TypeSafe product experiment

This optional local command tests category classification and source support for
claims. It does not change the directory, database, or publication rules. The
[existing taxonomy](products.md) supplies its eleven category IDs.

## Prepare a private input

Keep saved source text and results in ignored `.local/`. Use only data approved
for submission to the provider. Record reference labels before the live run.
Reference labels and notes are local evaluation data; they never enter a request.
A reference label is a judgment, not independent proof of real-world truth.

The input accepts one to three products, each with one to twelve claims:

```json
{
  "version": 1,
  "products": [
    {
      "id": "example",
      "name": "Example",
      "sourceUrl": "https://example.com",
      "sourceText": "Example provides a scheduling tool. It has no mobile app.",
      "expectedCategory": "productivity",
      "categoryReference": "The source describes scheduling.",
      "claims": [
        {
          "id": "scheduling",
          "text": "Example provides a scheduling tool.",
          "expected": "supported",
          "referenceNote": "Explicit in the first sentence."
        },
        {
          "id": "mobile",
          "text": "Example has a mobile app.",
          "expected": "contradicted",
          "referenceNote": "Explicitly denied in the second sentence."
        },
        {
          "id": "price",
          "text": "Example costs ten dollars per month.",
          "expected": "unsupported",
          "referenceNote": "The source does not state a price."
        }
      ]
    }
  ]
}
```

The command does not fetch `sourceUrl`. The supplied `sourceText` is the complete
evidence boundary. Source content is untrusted data, including any instructions
it contains. The judge asks whether the whole claim follows from that text:
`supported`, `contradicted`, or `unsupported`. A missing fact is unsupported;
it is not automatically false. A source can support a claim that is false in the
world. Category classification uses the primary customer use described by the
source and falls back to `uncategorized` when needed.

## Run

From the repository root, with the documented Node and pnpm versions:

```sh
pnpm exec tsx scripts/typesafe-poc.ts \
  --input .local/typesafe-input.json \
  --output .local/typesafe-dry.json
```

This is a dry run. It validates and saves the exact proposed requests, makes no
network call, and requires no key. Review it before an authorized live run.
Supply `TYPESAFE_AI_API_KEY` through the environment. `TYPESAGE_AI_API_KEY` and
`TYPESAFE_API_KEY` are accepted fallbacks, in that order. The command does not
load environment files.

```sh
pnpm exec tsx scripts/typesafe-poc.ts \
  --input .local/typesafe-input.json \
  --output .local/typesafe-live.json \
  --live
```

Output paths must be inside `.local/`. Both JSON and its sibling HTML report are
created exclusively, with mode `0600`. Existing paths are refused before any
request. Use the HTML for review; it omits the raw source text. JSON contains
private source text, exact request bodies, raw response text, validated responses,
per-call timing, model and token usage. Do not publish these local files.

## Request and cost limits

The adapter makes one sequential request per product, with category and claim
questions in the same request. Shared state contains only the product name,
source text and claim text. Each claim question also includes its claim text:
question IDs are not visible to the model and questions are independent.

The fixed endpoint is `POST https://api.typesafe.ai/v1/systemone`; the model is
`jev-1.13.0`. There are no retries or redirects. Each request has a 30-second
timeout, a 40,000-byte UTF-8 body limit, and a 1 MB response limit. A run makes at
most three calls. It stops on the first failure. Before any call, the conservative
cost estimate counts one input token per request byte, at $42 per billion input
tokens, and rejects totals over $0.01. At these size limits, the largest estimate
is $0.00504. Actual usage cost is estimated separately from returned input tokens.
Neither estimate is a billing receipt.

JSON is checkpointed and synced before each call and after its result, before
another call starts. An interrupted run can have an `in_flight` product. A timeout
or failed request can still be charged. Inspect that record before any new live
run; changing the output name is not permission to repeat a paid call.

The output schema is `typesafe-poc-result-v1`. It contains `mode`, `model`,
timestamps, `status`, `estimatedMaxCostUsd`, per-product requests/results, and a
`summary` with attempt/success counts, category/claim reference agreement, token
usage, estimated usage cost and total call duration. Non-2xx bodies are kept only
in the private JSON; console errors contain no provider content or credentials.

## Evidence and limits

This is a smoke experiment with at most three selected products. Its agreement
counts do not establish accuracy, production suitability, prompt-injection
resistance, or calibration. Expected labels are not sent to the model. Model
confidence and selected-label probability are shown separately. Neither is proof
of truth. No confidence threshold or automatic publication is added.

Response validation requires all questions, the exact probability-label sets,
finite numeric probabilities in `[0,1]`, a sum within `0.0001` of one, a selected
label with maximum probability, the requested model, and nonnegative integer
usage. Confidence is independently checked in `[0,1]`; it need not equal the
selected probability. No missing answer or number encoded as a string is accepted.

Offline contracts:

```sh
pnpm exec tsx --import ./tests/no-network.mjs --test tests/typesafe-poc.test.ts
```

Provider sources: [API](https://docs.typesafe.ai/api),
[models and pricing](https://docs.typesafe.ai/models),
[choice primitive](https://docs.typesafe.ai/primitives/choice),
[confidence](https://docs.typesafe.ai/confidence), and
[source citation checks](https://docs.typesafe.ai/cookbooks/citation_check).
Pricing and the pinned model were checked on 2026-09-18; verify them before a later
paid experiment.

## Founder categories and DNA claims

The same CLI accepts a separate founder input with `kind: "founder"`. Product
inputs and reports retain their original contract. Founder mode uses one grouped
request per founder, with the same limits, private outputs and opt-in live flag.
It produces typed decisions, not a generated biography or personality profile.

```json
{
  "version": 1,
  "kind": "founder",
  "founders": [
    {
      "id": "example-founder",
      "name": "Example Founder",
      "evidence": [
        {
          "id": "saved-bio",
          "ownerId": "example-founder",
          "sourceKind": "self-reported",
          "sourceUrl": "https://example.com/profile",
          "text": "I am a software engineer and co-founder of a scheduling tool."
        }
      ],
      "expectedFacets": {
        "venture_domain": {
          "expected": "productivity",
          "referenceNote": "The founder states a scheduling venture."
        },
        "craft": {
          "expected": "technical",
          "referenceNote": "Explicit current software engineer."
        },
        "building_style": {
          "expected": "unknown",
          "referenceNote": "No personal working practice stated."
        },
        "founding_role": {
          "expected": "cofounder",
          "referenceNote": "Explicit co-founder role."
        }
      },
      "claims": [
        {
          "id": "interest",
          "text": "The founder says that scheduling is a personal interest.",
          "expected": "unsupported",
          "referenceNote": "A venture domain is not a stated personal interest."
        }
      ]
    }
  ]
}
```

Accepts one to three founders, each with one to six evidence records and one to
twelve candidate claims. Every record must have `sourceKind: "self-reported"`
and an `ownerId` exactly equal to its founder's `id`. Product-site records and
records for another owner are rejected before any call. The command trusts this
explicit metadata; it cannot independently prove authorship or identity. Check
the owner against the saved data before preparing the input. URLs are attribution
only and are never fetched. Reference labels and notes never enter a request.

| Facet            | Choices and limits                                                                                                                                                                                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `venture_domain` | The eleven product taxonomy IDs plus `unknown`. Classifies the stated current venture, not the person's craft. `unknown` means insufficient evidence; `uncategorized` means an explicit venture outside the listed domains. A company name alone is insufficient. |
| `craft`          | `technical`, `creative_branding`, `research`, `operations`, `mixed`, `unknown`. Explicit current personal craft only. Former work does not establish current craft. CEO or founder alone is unknown.                                                              |
| `building_style` | `publicly_documenting`, `explicitly_private`, `unknown`. How the person says they work, not product capabilities. Silence does not imply private building.                                                                                                        |
| `founding_role`  | `solo`, `cofounder`, `unknown`. Requires an explicit founding role. Working alone does not establish solo-founder status.                                                                                                                                         |

The candidate-claim judge preserves tense, former/current qualifiers, and the
separation between craft, working style and interests used by the existing
[Founder DNA recipe](../lib/enrichment/recipes.ts). A profession is not a stated
personal interest. An inference cannot be accepted as an explicit self-report.
There is no ability ranking, personality assessment, free-text summary generation,
publication step, or database write.

```sh
pnpm exec tsx scripts/typesafe-poc.ts \
  --input .local/typesafe-founder-input.json \
  --output .local/typesafe-founder-dry.json
```

After reviewing the proposed requests and authorizing spending, use `--live` with
a new output path. Founder results use `schema: "typesafe-founder-poc-result-v1"`,
a `founders` array, and `facetMatches`/`facetTotal` in place of the product category
counters. Each founder retains its source ownership metadata, reference labels,
exact request, provider response, and timing. The private HTML shows facets,
claim agreement, confidence, selected probability, and expandable evidence with
source attribution. This lists all evidence considered; it does not invent exact
per-answer citations. Do not publish the report or input.

Run the founder and product contracts together:

```sh
pnpm exec tsx --import ./tests/no-network.mjs --test \
  tests/typesafe-founder-poc.test.ts tests/typesafe-poc.test.ts
```

## Local founder profile preview

A prepared `PRODUCTS_LOCAL_SNAPSHOT` can include a `dna` display projection on
its `profiles` records. Open `/u/<handle>` to see the saved bio, Founder DNA,
source evidence and linked products together. This uses the same development-only,
non-Vercel guard as the [Products preview](products.md#no-key-previews). It makes
no classifier or database calls. Production profile behavior is unchanged.

The optional `profiles[].dna` contract is:

- `model`: nonempty string, at most 80 characters.
- `completedAt`: parseable ISO date-time string, at most 40 characters.
- `facets`: exactly one entry for each of the four founder facets above, shaped
  as `{ "key": "craft", "value": "technical", "confidence": 0.9 }`. Only the
  defined choices and finite confidence values between zero and one are accepted.
- `sources`: one to six `{ "id", "url", "text" }` records from the founder's saved
  self-report. IDs are unique and at most 120 characters, text is at most 4,000,
  and URLs are safe HTTP(S) URLs without credentials, at most 2,000 characters.
- `facts`: zero to twelve `{ "text", "state": "supported", "sourceIds": ["id"] }`
  records. Text is at most 1,200 characters. Each fact must cite one to six IDs
  present in `sources`. Unsupported, contradicted or uncited facts are omitted.

Prepare this small projection explicitly from a completed saved run. Preserve
actual returned choices, including `unknown`; do not replace them with evaluation
reference labels. Include only supported professional facts checked against the
saved founder bio. Do not copy the full result object, evaluation fixtures,
reference answers or deliberately false candidate claims. The reader strips
unrecognized fields and omits malformed DNA while retaining the basic profile.
The input's support and source ownership metadata are trusted local preparation
claims, not proof supplied by this display sanitizer.

The page labels categories as model inferences, unknown choices as “Not yet
known”, and facts as supported by a saved self-report rather than independently
verified. Evidence details show all considered source text, the model and saved
date. Confidence appears only in those details and is never an ability score.
The preview does not add personality assessment or synthesize a new summary.

### Editorial portrait lab

The development-only `/dna-lab` route compares three editorial prototypes:
Archetype, Friendly roast and Plot twist. It reads prepared local display data,
not a provider, and never posts to X. The selected founder and concept are URL
parameters (`founder` and `concept`), so links preserve the comparison. A local
profile links to the lab only when its portrait passes validation. Missing or
prohibited snapshots return 404. The route is excluded from indexing.

A `profiles[].portrait` projection contains:

- `archetype`: `title` and `kicker` (120 characters each), `hook` (240), `summary`
  (600), and one to five `tags` (80 each).
- `roast`: `title` (120) and one to five `lines`, each with `text` (400) and
  `receipt` equal to a receipt label.
- `story`: `title` (120), `before` and `after` (240 each), `connection` (600).
- `receipts`: one to six records with unique `label` (80), `quote` (2,400),
  `source` exactly `bio` or `product`, and a safe HTTP(S) `url` (2,000).
- `shareText`: a prepared archetype draft, at most 1,200 characters.

Strings must be nonempty. Invalid portraits are omitted. The lab lists at most
12 linked profiles. Source labels distinguish saved bio excerpts from saved
product summaries; summaries are not presented as verbatim website quotations.
The local preparer checks each excerpt against its saved source and owns the
editorial interpretation. The sanitizer validates the display shape and receipt
references; it does not prove that a joke follows from its source.

The three cards contain editorial copy, clearly separate from saved model
classifications. They do not claim that the classifier wrote the copy, invent
personality scores or rank founders. Each share action previews an editable text
draft, copies only on a click, and selects the draft for manual copying if the
clipboard is unavailable. Roast drafts use the title and first line; story drafts
use the title and connection. No social posting or image upload occurs.
