import { classifyMessage, PROVIDER } from "./classify.js";

// Usage: npm run classify -- "I was charged twice this month!"
const message = process.argv.slice(2).join(" ").trim();

if (!message) {
  console.error('Usage: npm run classify -- "message text"');
  process.exit(1);
}

console.log(`Calling ${PROVIDER}...`);
const started = Date.now();
try {
  const result = await classifyMessage(message);
  console.log(`Answered in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  console.log(JSON.stringify(result.classification, null, 2));
  if (result.inputTokens !== undefined) {
    console.log(`tokens: ${result.inputTokens} in / ${result.outputTokens} out`);
  }
} catch (error) {
  console.error(`Error: ${(error as Error).message}`);
  process.exitCode = 1;
}
