import { readFileSync } from "node:fs";
import { classifyMessage, PROVIDER, type Classification } from "./classify.js";

// An eval is a set of cases with known correct answers.
// It tells you whether the classifier works, and whether a prompt change helped or broke it.
interface EvalCase {
  id: number;
  message: string;
  expected: Classification["category"];
}

const allCases: EvalCase[] = JSON.parse(readFileSync("./data/eval.json", "utf-8"));

// To save quota: `npm run eval -- 2,3,5` runs only those cases.
const only = process.argv[2]?.split(",").map(Number);
const cases = only ? allCases.filter((c) => only.includes(c.id)) : allCases;

let correct = 0;
let answered = 0;
let inputTokens = 0;
let outputTokens = 0;
const failures: string[] = [];
const errors: string[] = [];

// Gemini's free tier allows 5 requests per minute (RPM): wait 13 s between cases
// to stay at ~4.6 per minute, under the limit.
const DELAY_MS = PROVIDER === "gemini" ? 13_000 : 0;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

for (const [index, testCase] of cases.entries()) {
  if (index > 0 && DELAY_MS) await sleep(DELAY_MS);
  try {
    const result = await classifyMessage(testCase.message);
    answered++;
    inputTokens += result.inputTokens ?? 0;
    outputTokens += result.outputTokens ?? 0;

    const got = result.classification.category;
    const ok = got === testCase.expected;
    if (ok) correct++;
    else failures.push(`#${testCase.id} expected "${testCase.expected}", got "${got}": ${result.classification.reason}`);

    console.log(`${ok ? "OK  " : "FAIL"} #${testCase.id} ${got.padEnd(12)} ${testCase.message.slice(0, 60)}`);
  } catch (error) {
    const message = (error as Error).message;
    errors.push(`#${testCase.id} ${message}`);
    console.log(`ERR  #${testCase.id} ${message}`);

    // 429 = the quota ran out. Continuing only wastes time (and maybe more quota): stop here.
    if (message.includes("429")) {
      console.log("\nDaily quota exhausted: stopping the eval here.");
      break;
    }
  }
}

// An API error (503, 429) says nothing about the classifier's quality:
// accuracy is computed only over the cases the model actually answered.
console.log(`\nProvider: ${PROVIDER}`);
console.log(`Answered: ${answered}/${cases.length}`);
if (answered) {
  console.log(`Accuracy: ${correct}/${answered} (${Math.round((correct / answered) * 100)}%)`);
}
if (PROVIDER === "claude") {
  // Claude Opus 5.5 pricing: USD 4 per million input tokens, USD 20 per million output tokens.
  const costUsd = (inputTokens * 4 + outputTokens * 20) / 1_000_000;
  console.log(`Tokens: ${inputTokens} in / ${outputTokens} out  ->  ~USD ${costUsd.toFixed(4)}`);
}
if (failures.length) {
  console.log("\nFailures to review (is the prompt wrong, or is the expected label debatable?):");
  for (const failure of failures) console.log(`- ${failure}`);
}
if (errors.length) {
  console.log(`\nAPI errors (not counted toward accuracy): ${errors.length}`);
}
