// src/server.ts
import fs from "node:fs";
import path from "node:path";
import { completeSimple, getModel, type Tool, type Message } from "@mariozechner/pi-ai";

const PORT = Number(process.env.PORT) || 3000;

const MODEL_ALIASES: Record<string, string> = {
  "claude-sonnet-4-5": "claude-sonnet-4-5-20250929",
  "claude-opus-4-5": "claude-opus-4-5-20251101",
  "claude-sonnet-4": "claude-sonnet-4-20250514",
  "claude-sonnet-4-5-20250514": "claude-sonnet-4-5-20250929",
  "claude-3-7-sonnet-20250219": "claude-sonnet-4-20250514",
  "claude-3-5-sonnet-20241022": "claude-sonnet-4-20250514",
};

function getClaudeToken(): string {
  // Check environment variable first
  if (process.env.CLAUDE_TOKEN) {
    return process.env.CLAUDE_TOKEN;
  }

  // Check ~/.claude/.credentials.json
  const credPath = path.join(process.env.HOME ?? "~", ".claude", ".credentials.json");
  if (fs.existsSync(credPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(credPath, "utf8"));
      const token = raw?.claudeAiOauth?.accessToken;
      if (token) return token;
    } catch {}
  }

  throw new Error("No Claude credentials found. Set CLAUDE_TOKEN env var or run `claude setup-token`.");
}

// Convert Anthropic tools format to pi-ai format
function convertTools(tools: any[]): Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    parameters: t.input_schema ?? { type: "object", properties: {} },
  }));
}

// Convert Anthropic message to pi-ai message
function convertMessage(m: any): Message {
  if (m.role === "user") {
    // Check for tool_result content
    if (Array.isArray(m.content)) {
      const toolResult = m.content.find((c: any) => c.type === "tool_result");
      if (toolResult) {
        return {
          role: "toolResult",
          toolCallId: toolResult.tool_use_id,
          toolName: "", // Not provided in Anthropic format
          content: [{ type: "text", text: typeof toolResult.content === "string" ? toolResult.content : JSON.stringify(toolResult.content) }],
          isError: toolResult.is_error ?? false,
          timestamp: Date.now(),
        };
      }
    }
    return {
      role: "user",
      content: typeof m.content === "string"
        ? m.content
        : m.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n") ?? "",
      timestamp: Date.now(),
    };
  }

  if (m.role === "assistant") {
    const content: any[] = [];
    if (Array.isArray(m.content)) {
      for (const block of m.content) {
        if (block.type === "text") {
          content.push({ type: "text", text: block.text });
        } else if (block.type === "tool_use") {
          content.push({
            type: "toolCall",
            id: block.id,
            name: block.name,
            arguments: block.input ?? {},
          });
        }
      }
    }
    return {
      role: "assistant",
      content,
      api: "anthropic-messages",
      provider: "anthropic",
      model: "",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop",
      timestamp: Date.now(),
    };
  }

  // Fallback
  return {
    role: "user",
    content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
    timestamp: Date.now(),
  };
}

// Convert pi-ai response content to Anthropic format
function convertResponseContent(content: any[]): any[] {
  return content.map((block) => {
    if (block.type === "text") {
      return { type: "text", text: block.text };
    }
    if (block.type === "toolCall") {
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.arguments,
      };
    }
    return block;
  });
}

const token = getClaudeToken();
console.log("Claude token loaded");

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/v1/messages") {
      try {
        const body = await req.json();
        const streaming = body.stream === true;
        console.log(`[${new Date().toISOString()}] POST /v1/messages model=${body.model} messages=${body.messages?.length ?? 0} stream=${streaming}`);
        const modelId = MODEL_ALIASES[body.model] ?? body.model ?? "claude-sonnet-4-20250514";
        const maxTokens = body.max_tokens ?? 1024;
        const messages = body.messages ?? [];
        const tools = body.tools ?? [];

        // Convert to pi-ai format
        const piMessages = messages.map(convertMessage);
        const piTools = tools.length > 0 ? convertTools(tools) : undefined;

        const model = getModel("anthropic", modelId);
        if (!model) {
          console.error(`Unknown model: ${body.model} (resolved to ${modelId})`);
          return Response.json(
            { error: { type: "invalid_request_error", message: `Unknown model: ${body.model}` } },
            { status: 400 }
          );
        }

        const response = await completeSimple(
          model,
          { messages: piMessages, tools: piTools },
          { apiKey: token, maxTokens }
        );

        // Convert response content to Anthropic format
        const content = Array.isArray(response.content)
          ? convertResponseContent(response.content)
          : [{ type: "text", text: String(response.content) }];

        // Map stop reason
        const stopReasonMap: Record<string, string> = {
          stop: "end_turn",
          toolUse: "tool_use",
          length: "max_tokens",
        };

        const msgId = `msg_${Date.now()}`;
        const usedModel = response.model ?? modelId;
        const stopReason = stopReasonMap[response.stopReason] ?? "end_turn";
        const usage = {
          input_tokens: response.usage?.input ?? 0,
          output_tokens: response.usage?.output ?? 0,
        };

        if (!streaming) {
          return Response.json({
            id: msgId,
            type: "message",
            role: "assistant",
            content,
            model: usedModel,
            stop_reason: stopReason,
            usage,
          });
        }

        // SSE streaming response
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            function send(event: string, data: any) {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            }

            // message_start
            send("message_start", {
              type: "message_start",
              message: {
                id: msgId,
                type: "message",
                role: "assistant",
                content: [],
                model: usedModel,
                stop_reason: null,
                stop_sequence: null,
                usage: { input_tokens: usage.input_tokens, output_tokens: 0 },
              },
            });

            // Emit each content block
            for (let i = 0; i < content.length; i++) {
              const block = content[i];

              if (block.type === "text") {
                send("content_block_start", {
                  type: "content_block_start",
                  index: i,
                  content_block: { type: "text", text: "" },
                });
                send("content_block_delta", {
                  type: "content_block_delta",
                  index: i,
                  delta: { type: "text_delta", text: block.text },
                });
                send("content_block_stop", { type: "content_block_stop", index: i });
              } else if (block.type === "tool_use") {
                send("content_block_start", {
                  type: "content_block_start",
                  index: i,
                  content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
                });
                send("content_block_delta", {
                  type: "content_block_delta",
                  index: i,
                  delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input) },
                });
                send("content_block_stop", { type: "content_block_stop", index: i });
              }
            }

            // message_delta
            send("message_delta", {
              type: "message_delta",
              delta: { stop_reason: stopReason, stop_sequence: null },
              usage: { output_tokens: usage.output_tokens },
            });

            // message_stop
            send("message_stop", { type: "message_stop" });

            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      } catch (err: any) {
        console.error(err);
        return Response.json(
          { error: { type: "api_error", message: err.message } },
          { status: 500 }
        );
      }
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`Anthropic-compatible API running on http://localhost:${PORT}`);
