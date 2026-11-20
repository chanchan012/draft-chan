import {
  Client,
  StreamableHTTPClientTransport,
} from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

async function run() {
  const url = URL.parse(process.env.DRAFT_MCP_URL ?? "");
  const token = process.env.DRAFT_MCP_TOKEN ?? "";
  const loopback =
    url && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (
    !url ||
    (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/api/mcp" ||
    !/^draft_mcp_[A-Za-z0-9_-]{43}$/.test(token)
  ) {
    console.error(
      "Set DRAFT_MCP_URL to Draft's /api/mcp endpoint and DRAFT_MCP_TOKEN to a token from Studio.",
    );
    process.exitCode = 1;
    return;
  }

  const upstream = new Client({ name: "draft-stdio-bridge", version: "0.1.0" });
  await upstream.connect(
    new StreamableHTTPClientTransport(url, {
      requestInit: {
        redirect: "error",
        headers: { Authorization: "Bearer " + token },
      },
    }),
  );
  const server = new Server(
    { name: "draft-studio", version: "0.1.0" },
    {
      capabilities: { resources: {}, tools: {} },
      instructions:
        "Use floorplan-graph to get the current revision before editing.",
    },
  );
  server.setRequestHandler("tools/list", ({ params }) =>
    upstream.listTools(params),
  );
  server.setRequestHandler("tools/call", ({ params }) =>
    upstream.callTool(params),
  );
  server.setRequestHandler("resources/list", ({ params }) =>
    upstream.listResources(params),
  );
  server.setRequestHandler("resources/templates/list", ({ params }) =>
    upstream.listResourceTemplates(params),
  );
  server.setRequestHandler("resources/read", ({ params }) =>
    upstream.readResource(params),
  );

  const close = () => {
    void upstream.close().catch(() => {});
  };
  server.onclose = close;
  process.once("SIGINT", () => {
    close();
    process.exit(0);
  });
  process.once("SIGTERM", () => {
    close();
    process.exit(0);
  });
  await server.connect(new StdioServerTransport());
}

run().catch(() => {
  console.error(
    "Could not connect to Draft MCP. Check the endpoint and floorplan token.",
  );
  process.exitCode = 1;
});
