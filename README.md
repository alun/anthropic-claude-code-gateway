# Anthropic Claude Code Gateway

An Anthropic-compatible API proxy that forwards requests through [pi-ai](https://www.npmjs.com/package/@mariozechner/pi-ai), with model alias mapping and SSE streaming support.

## Setup

```bash
npm install
```

## Usage

```bash
npm run server
```

The API will be available at `http://localhost:3000/v1/messages`.

Set `CLAUDE_TOKEN` environment variable or have Claude CLI credentials at `~/.claude/.credentials.json`.

## Connecting tools

For any tool that supports the Anthropic API, set these environment variables to point it at the gateway:

```bash
ANTHROPIC_API_KEY=dummy
ANTHROPIC_BASE_URL=http://localhost:3000/v1
```

The API key can be any value — authentication is handled by the gateway using your Claude credentials.
