import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { completeSimple, getModel } from "@mariozechner/pi-ai";

/**
 * Read Claude CLI credentials from macOS keychain or ~/.claude/.credentials.json
 */
function getClaudeToken(): string {
  // Try macOS keychain first
  if (process.platform === "darwin") {
    try {
      const result = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w',
        { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
      );
      const data = JSON.parse(result.trim());
      const token = data?.claudeAiOauth?.accessToken;
      if (token) {
        console.log("Using credentials from macOS keychain");
        return token;
      }
    } catch {
      // Fall through to file-based credentials
    }
  }

  // Try ~/.claude/.credentials.json
  const credPath = path.join(process.env.HOME ?? "~", ".claude", ".credentials.json");
  if (fs.existsSync(credPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
      const token = raw?.claudeAiOauth?.accessToken;
      if (token) {
        console.log("Using credentials from ~/.claude/.credentials.json");
        return token;
      }
    } catch {
      // Fall through to error
    }
  }

  throw new Error(
    "No Claude credentials found. Run `claude` CLI to authenticate first."
  );
}

async function main() {
  const prompt = process.argv[2] ?? "Hello! What's 2 + 2?";

  console.log(`Prompt: ${prompt}\n`);

  const token = getClaudeToken();
  const model = getModel("anthropic", "claude-opus-4-5-20251101");

  console.log(`Model: ${model.provider}/${model.id}`);
  console.log(`API: ${model.api}`);
  console.log("");

  const response = await completeSimple(
    model,
    {
      messages: [
        {
          role: "user",
          content: prompt,
          timestamp: Date.now(),
        },
      ],
    },
    { apiKey: token, maxTokens: 1024 }
  );

  // Extract text from content blocks
  const text = Array.isArray(response.content)
    ? response.content
        .filter((block: any) => block.type === "text")
        .map((block: any) => block.text)
        .join("\n")
    : String(response.content);

  console.log("Response:", text);

  console.log("\n--- Stats ---");
  if ((response as any).model) {
    console.log(`Model used: ${(response as any).model}`);
  }
  if (response.usage) {
    console.log(`Tokens: ${response.usage.input} in / ${response.usage.output} out`);
  }
}

main().catch(console.error);
