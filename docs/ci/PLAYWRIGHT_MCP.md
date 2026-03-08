# Playwright MCP (Local Agent Browser Control)

This project already uses Playwright E2E tests (`tests/e2e/*.spec.js`) for deterministic UI testing in CI.

If you want an AI agent (Claude Desktop / Cursor / Cline / VS Code agents) to *drive a real browser* using natural language, you can add a **Playwright MCP server** locally.

## What this is (and isn’t)

- ✅ Useful for **interactive exploration**: “open the app, click around, take screenshots, inspect console errors, generate test ideas”.
- ✅ Useful to help **author** Playwright tests faster.
- ❌ Not a replacement for CI: Jenkins should still run **normal Playwright tests** (`npm run test:e2e`) for reproducibility.
- ❌ Jenkins cannot “use MCP” by itself: an MCP server needs an MCP client (and usually an LLM) to drive it.

## Local install / run

Run the MCP server via NPX:
```bash
npm run mcp:playwright
```

Make sure Playwright browsers are installed at least once:
```bash
npx playwright install chromium
```

## Example MCP client configuration

### Claude Desktop
Add this to your Claude Desktop MCP configuration:
```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"]
    }
  }
}
```

### Cursor / VS Code agents
Use the equivalent “add MCP server” UI and point it at:
- command: `npx`
- args: `-y @executeautomation/playwright-mcp-server`

## Suggested workflow for this repo

1. Start the dev server: `npm run dev`
2. Use the MCP client to drive `http://localhost:3000`
3. Convert stable flows into Playwright specs under `tests/e2e/`
4. Let Jenkins run the Playwright suite and keep the reports as build artifacts

