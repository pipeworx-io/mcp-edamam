# mcp-edamam

Edamam MCP — wraps three Edamam APIs in one pack:

Part of [Pipeworx](https://pipeworx.io) — an MCP gateway connecting AI agents to 1394+ live data sources.

## Tools

| Tool | Description |
|------|-------------|
| `nutrition_analysis` | Analyze the nutrition of a food ingredient or recipe line and return calories, weight, diet/health labels, and a macro breakdown. Example: nutrition_analysis({ ingredient: "1 cup rice and 10 oz chickpeas" }) |
| `search_recipes` | Search Edamam's recipe database by keyword with optional diet, health, and cuisine filters. Returns recipes with calories, time, servings, and ingredient lists. Example: search_recipes({ query: "chicken curry", health: "gluten-free", limit: 5 }) |
| `search_food` | Search Edamam's food database for foods matching a query and return per-100g macros (calories, protein, fat, carbs). Example: search_food({ query: "cheddar cheese", limit: 10 }) |

## Quick Start

Add to your MCP client (Claude Desktop, Cursor, Windsurf, etc.):

```json
{
  "mcpServers": {
    "edamam": {
      "url": "https://gateway.pipeworx.io/edamam/mcp"
    }
  }
}
```

Or connect to the full Pipeworx gateway for access to all 1394+ data sources:

```json
{
  "mcpServers": {
    "pipeworx": {
      "url": "https://gateway.pipeworx.io/mcp"
    }
  }
}
```

## Using with ask_pipeworx

Instead of calling tools directly, you can ask questions in plain English:

```
ask_pipeworx({ question: "your question about Edamam data" })
```

The gateway picks the right tool and fills the arguments automatically.

## More

- [Docs and guides](https://pipeworx.io/docs)
- [pipeworx.io](https://pipeworx.io)

## License

MIT
