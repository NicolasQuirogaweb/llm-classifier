import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenAI } from "@google/genai";
import { z } from "zod";

// 1. The contract: the exact shape every answer must have.
//    Zod validates it at runtime and gives us the TypeScript type.
export const CATEGORIES = ["complaint", "question", "cancellation", "other"] as const;

export const ClassificationSchema = z.object({
  category: z.enum(CATEGORIES),
  urgency: z.enum(["low", "medium", "high"]),
  language: z.string(), // ISO 639-1 code: "en", "es", "it", "de"...
  reason: z.string(), // one sentence explaining the category
});
export type Classification = z.infer<typeof ClassificationSchema>;

// 2. The same contract as JSON Schema: the API uses it to force the model to answer
//    with exactly this shape (structured outputs). Shared by both providers.
const JSON_SCHEMA = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    urgency: { type: "string", enum: ["low", "medium", "high"] },
    language: { type: "string" },
    reason: { type: "string" },
  },
  required: ["category", "urgency", "language", "reason"],
  additionalProperties: false,
};

// 3. The instructions. This is where the judgment lives: clear definitions and edge cases.
const SYSTEM_PROMPT = `You classify messages that students send to an online English school.

Categories:
- complaint: the student is unhappy with something (a teacher, a class, a charge, the platform) and is NOT asking to leave.
- question: the student wants information or help (schedules, prices, how something works, rescheduling a class).
- cancellation: the student wants to stop, pause, cancel their plan or get a refund, even if they also complain.
- other: greetings, thanks, spam, or anything that fits none of the above.

Urgency:
- high: money problems (double charges, refunds), a class starting soon, or the student is about to leave.
- medium: something that needs an answer today.
- low: everything else.

Messages can be in any language. "language" is the ISO 639-1 code of the message.
"reason" is one short sentence in English explaining the category.`;

export type Provider = "gemini" | "claude";

// Pick the provider with LLM_PROVIDER. Default: Gemini (it has a free tier).
export const PROVIDER: Provider = process.env.LLM_PROVIDER === "claude" ? "claude" : "gemini";

export interface ClassifyResult {
  classification: Classification;
  inputTokens?: number;
  outputTokens?: number;
}

// Shared last step: validate whatever the model returned. Never trust it blindly.
function parseClassification(text: string): Classification {
  return ClassificationSchema.parse(JSON.parse(text));
}

// ---------- Gemini (Google) ----------
// The client reads GEMINI_API_KEY from the environment. Never put keys in code.
let gemini: GoogleGenAI | undefined;

async function classifyWithGemini(message: string): Promise<ClassifyResult> {
  gemini ??= new GoogleGenAI({});
  const interaction = await gemini.interactions.create({
    // Each model has its own daily free-tier quota: override it with GEMINI_MODEL.
    model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
    system_instruction: SYSTEM_PROMPT,
    input: message,
    generation_config: { thinking_level: "low" }, // simple task: little reasoning needed
    response_format: { type: "text", mime_type: "application/json", schema: JSON_SCHEMA },
  }, {
    // No silent SDK retries: they hide the real error (429, 500...) behind our timeout
    // and each retry spends free-tier quota.
    maxRetries: 0,
    // Abort the HTTP request itself on timeout; otherwise it stays open and the process never exits.
    timeout: TIMEOUT_MS,
  });

  if (!interaction.output_text) throw new Error("Gemini returned no text.");
  return { classification: parseClassification(interaction.output_text) };
}

// ---------- Claude (Anthropic) ----------
// The client reads ANTHROPIC_API_KEY from the environment.
let anthropic: Anthropic | undefined;

async function classifyWithClaude(message: string): Promise<ClassifyResult> {
  anthropic ??= new Anthropic();
  const response = await anthropic.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: message }],
    output_config: {
      effort: "low", // classification is simple: less reasoning = faster and cheaper
      format: { type: "json_schema", schema: JSON_SCHEMA },
    },
    // If a safety filter declines the request, the API retries it on another model.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });

  // Always check why generation stopped BEFORE reading the content.
  if (response.stop_reason === "refusal") {
    throw new Error(`The model declined the message: ${response.stop_details?.explanation ?? "no details"}`);
  }
  if (response.stop_reason === "max_tokens") {
    throw new Error("The answer was cut off by max_tokens.");
  }

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("The answer contained no text.");
  }

  return {
    classification: parseClassification(textBlock.text),
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

// If the API takes too long (for example, silent retries after hitting a quota), fail with a clear error.
// Override with LLM_TIMEOUT_MS to check whether a slow case answers eventually.
const TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS) || 60_000;

export async function classifyMessage(message: string): Promise<ClassifyResult> {
  const call = PROVIDER === "claude" ? classifyWithClaude(message) : classifyWithGemini(message);
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${PROVIDER} did not answer within ${TIMEOUT_MS / 1000} s (free-tier quota?).`)),
      TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([call, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
