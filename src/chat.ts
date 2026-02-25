import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { completeSimple, getModel, type Message } from "@mariozechner/pi-ai";

function extractText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block: any) => block.type === "text")
      .map((block: any) => block.text)
      .join("\n");
  }
  return String(content);
}

function getClaudeToken(): string {
  if (process.platform === "darwin") {
    try {
      const result = execSync(
        'security find-generic-password -s "Claude Code-credentials" -w',
        { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] }
      );
      const data = JSON.parse(result.trim());
      const token = data?.claudeAiOauth?.accessToken;
      if (token) return token;
    } catch {}
  }

  const credPath = path.join(process.env.HOME ?? "~", ".claude", ".credentials.json");
  if (fs.existsSync(credPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
      const token = raw?.claudeAiOauth?.accessToken;
      if (token) return token;
    } catch {}
  }

  throw new Error("No Claude credentials found. Run `claude` CLI to authenticate.");
}

async function main() {
  const token = getClaudeToken();
  const model = getModel("anthropic", "claude-opus-4-5-20251101");
  const messages: Message[] = [];

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log("Claude Max Chat (type 'exit' to quit)\n");

  const askQuestion = () => {
    rl.question("You: ", async (input) => {
      const trimmed = input.trim();
      if (trimmed.toLowerCase() === "exit") {
        rl.close();
        return;
      }

      if (!trimmed) {
        askQuestion();
        return;
      }

      messages.push({
        role: "user",
        content: trimmed,
        timestamp: Date.now(),
      });

      try {
        const response = await completeSimple(
          model,
          { messages },
          { apiKey: token, maxTokens: 2048 }
        );

        const text = extractText(response.content);
        messages.push({
          role: "assistant",
          content: text,
          timestamp: Date.now(),
        });

        console.log(`\nClaude: ${text}\n`);
      } catch (err) {
        console.error("Error:", err instanceof Error ? err.message : err);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main().catch(console.error);
