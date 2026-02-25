import { completeSimple, getModel } from "@mariozechner/pi-ai";

function getZaiToken(): string {
  const token = process.env.ZAI_API_KEY?.trim() || process.env.Z_AI_API_KEY?.trim();
  if (token) {
    return token;
  }
  throw new Error("No Z.AI API key found. Set ZAI_API_KEY environment variable.");
}

async function main() {
  const prompt = process.argv[2] ?? "Hello! What's 2 + 2?";

  console.log(`Prompt: ${prompt}\n`);

  const token = getZaiToken();
  const model = getModel("zai", "glm-4-plus");

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
