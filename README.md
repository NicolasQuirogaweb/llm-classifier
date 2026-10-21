# llm-classifier

Classifies messages from students of an online English school (**complaint, question, cancellation, other**) with an LLM API, using **structured JSON output**, and measures how well it does with an **eval set**.

Built to learn how to integrate an LLM into a product properly: not just calling the API, but defining a contract, validating every answer, measuring quality and handling the API's failure modes.

```json
$ npm run classify -- "I was charged twice this month!"
{
  "category": "complaint",
  "urgency": "high",
  "language": "en",
  "reason": "The student is complaining about being incorrectly billed twice."
}
```

## What it shows

- **Direct LLM API integration** in TypeScript with the official SDKs: Google Gemini (`@google/genai`) and Anthropic Claude (`@anthropic-ai/sdk`), behind one function.
- **Structured outputs:** a JSON Schema forces the model to answer with an exact shape, like an API contract.
- **Validation anyway:** every answer is parsed and validated with Zod before it's used.
- **Prompt as specification:** category definitions and edge cases (a complaint that also asks to cancel is a cancellation; pausing a plan counts as cancellation).
- **An eval set:** 12 labeled messages in English, Spanish, Italian and German, including ambiguous cases. The eval reports accuracy and lists every failure with the model's reason.
- **Real-world API failure handling:**
  - a timeout so a call never hangs silently;
  - API errors (503 high demand, 429 rate limit) are separated from model mistakes and don't count toward accuracy;
  - the eval stops on 429 and throttles itself to stay under the free tier's 5 requests per minute.
- **Safety handling (Claude):** checks `stop_reason` before reading content and opts into server-side fallbacks if a request is declined.

## Run it

Requires Node.js 20+.

```bash
npm install
```

**With Gemini (free tier, no card needed):** get a key at https://aistudio.google.com, then:

```powershell
$env:GEMINI_API_KEY = "your-key"     # PowerShell; use `export` on macOS/Linux
npm run classify -- "Can I move Thursday's class to Friday?"
npm run eval                         # all 12 cases
npm run eval -- 2,3,5                # only some cases, to save quota
```

**With Claude:**

```powershell
$env:ANTHROPIC_API_KEY = "your-key"
$env:LLM_PROVIDER = "claude"
npm run eval
```

Optional: `GEMINI_MODEL` picks a different Gemini model (each one has its own free-tier quota).

Keys are read from environment variables only and never stored in the repo.

## Files

| File | What it does |
|---|---|
| `src/classify.ts` | Prompt, schema, the call to each provider, validation and timeout |
| `src/eval.ts` | Runs the labeled cases and reports accuracy, failures and API errors |
| `src/cli.ts` | Classifies a single message from the command line |
| `data/eval.json` | The labeled eval cases |

## What I learned

- The free tier of an LLM API is tiny (5 requests/minute, 20/day for the model I used), and SDK retries can burn quota silently. I read the quota dashboard, throttled the eval and made it stop on 429.
- A 503 says nothing about your prompt: an eval has to separate "the model was wrong" from "the API failed", or the accuracy number lies.
- The prompt is where the product decisions live. Is "can I pause my plan?" a question or a cancellation? The eval forces you to decide and write it down.

## Next steps

- Finish running the full eval on the free tier and record the results.
- Add harder cases: irony, two intents in one message, mixed languages.
- Compare providers and effort levels on the same eval (accuracy vs. cost).
- Add a `suggested_reply` field reviewed by a human before sending.
