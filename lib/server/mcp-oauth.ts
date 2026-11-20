import { createClerkClient } from "@clerk/backend";
import { parsePublishableKey } from "@clerk/shared/keys";
import type { AgentScope } from "./agent-tokens";
import { resolveFloorplanOAuth } from "./oauth-grants";

const productionResource = "https://draft-chan.vercel.app/api/mcp";
const metadataPath = "/.well-known/oauth-protected-resource/api/mcp";

export function getMcpOAuthConfig(requestUrl: string) {
  const resource = URL.parse(
    process.env.DRAFT_MCP_OAUTH_RESOURCE_URL ?? productionResource,
  );
  const publishableKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  const clerk = parsePublishableKey(publishableKey);
  const loopback =
    resource && ["localhost", "127.0.0.1", "[::1]"].includes(resource.hostname);
  if (
    !resource ||
    !clerk ||
    !process.env.CLERK_SECRET_KEY ||
    (resource.protocol !== "https:" &&
      !(loopback && resource.protocol === "http:")) ||
    resource.pathname !== "/api/mcp" ||
    resource.search ||
    resource.hash ||
    resource.username ||
    resource.password ||
    new URL(requestUrl).origin !== resource.origin
  )
    return null;
  return {
    resource: resource.href,
    issuer: `https://${clerk.frontendApi}`,
    metadata: new URL(metadataPath, resource).href,
  };
}

type OAuthConfig = NonNullable<ReturnType<typeof getMcpOAuthConfig>>;
export type McpOAuth = {
  config: typeof getMcpOAuthConfig;
  authorize(
    request: Request,
    config: OAuthConfig,
  ): Promise<AgentScope | "plan_not_enabled" | null>;
};

export const clerkMcpOAuth: McpOAuth = {
  config: getMcpOAuthConfig,
  async authorize(request, config) {
    const clerk = createClerkClient({
      secretKey: process.env.CLERK_SECRET_KEY,
      publishableKey: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
      telemetry: { disabled: true },
    });
    const state = await clerk.authenticateRequest(request, {
      acceptsToken: "oauth_token",
      audience: config.resource,
    });
    const identity = state.toAuth();
    if (
      !identity.isAuthenticated ||
      identity.tokenType !== "oauth_token" ||
      !identity.userId ||
      !identity.clientId
    )
      return null;
    return (
      (await resolveFloorplanOAuth(identity.userId, identity.clientId)) ??
      "plan_not_enabled"
    );
  },
};

export function mcpProtectedResourceMetadata(request: Request) {
  const config = getMcpOAuthConfig(request.url);
  if (!config)
    return Response.json(
      { error: "MCP OAuth is unavailable at this address." },
      { status: 404 },
    );
  return Response.json(
    {
      resource: config.resource,
      resource_name: "Draft floorplan studio",
      authorization_servers: [config.issuer],
      bearer_methods_supported: ["header"],
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
      },
    },
  );
}
