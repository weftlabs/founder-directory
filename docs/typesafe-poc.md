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
