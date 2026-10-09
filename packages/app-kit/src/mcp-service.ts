import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createServer } from "node:net";
import { AppError, errorCodeSchema, LIMITS, type InvocationContext } from "./contract.js";
import type { InstalledArtifact, OwnedTransport } from "./runtime.js";
export async function allocateLoopbackPort(): Promise<number> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}
function sameSchema(a: unknown, b: unknown): boolean {
  const normalize = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.entries(value)
              .filter(
                ([key]) => !["$schema", "description", "title"].includes(key),
              )
              .map(
                ([key, v]) =>
                  [key === "definitions" ? "$defs" : key, v] as const,
              )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([key, v]) => [key, normalize(v)]),
          )
        : typeof value === "string" && value.startsWith("#/definitions/")
          ? value.replace("#/definitions/", "#/$defs/")
          : value;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
export class McpServiceTransport implements OwnedTransport {
  readonly generation: string;
  readonly pid: number;
  constructor(
    private readonly control: OwnedTransport,
    private readonly artifact: InstalledArtifact,
    private readonly endpoint: string,
    private readonly scope: (
      context: InvocationContext,
    ) => Promise<{ scopeRef: string | null; ticket: string | null; scopeActorId?: string }>,
  ) {
    this.generation = control.generation;
    this.pid = control.pid;
  }
  private async client(
    context: InvocationContext | null,
    signal?: AbortSignal,
  ) {
    const role =
      context?.principal.kind === "owner-ui"
        ? "owner-ui"
        : context &&
            ["chat", "workspace", "fixture"].includes(context.principal.kind)
          ? "agent"
          : "background";
    const scope = context
      ? await this.scope(context)
      : { scopeRef: null, ticket: null };
    const lease = (await this.control.request(
      "authorizePrincipal",
      {
        actorId: context
          ? `${context.principal.kind}:${context.principal.id}`
          : "metadata",
        role,
        ...scope,
        expiresAt:
          Date.now() +
          (context
            ? Math.min(
                LIMITS.maxActionMs,
                Math.max(1000, context.deadline - Date.now()),
              )
            : LIMITS.readinessMs),
      },
      signal,
    )) as { credential: string };
    if (
      typeof lease.credential !== "string" ||
      lease.credential.length < 16 ||
      lease.credential.length > 4000
    )
      throw new AppError(
        "app_failed",
        "The service returned an invalid principal lease",
      );
    const client = new Client({ name: "Ri app host", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(
      new URL(this.endpoint),
      {
        requestInit: {
          headers: {
            Authorization: `Bearer ${lease.credential}`,
            ...(scope.ticket
              ? { "x-app-invocation-ticket": scope.ticket }
              : {}),
          },
        },
        fetch: async (url, init) => {
          if (String(url) !== this.endpoint)
            throw new AppError(
              "forbidden",
              "The service requested an unrecorded endpoint",
            );
          const response = await fetch(url, {
            ...init,
            signal: signal
              ? AbortSignal.any([
                  signal,
                  ...(init?.signal ? [init.signal] : []),
                ])
              : init?.signal,
            redirect: "error",
          });
          const reader = response.body?.getReader(),
            chunks: Uint8Array[] = [];
          let length = 0;
          try {
            if (reader)
              while (true) {
                const part = await reader.read();
                if (part.done) break;
                length += part.value.byteLength;
                if (length > LIMITS.outputBytes)
                  throw new AppError(
                    "invalid_input",
                    "The service response is too large",
                  );
                chunks.push(part.value);
              }
          } catch (error) {
            await reader?.cancel();
            throw error;
          }
          const bytes = new Uint8Array(length);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.byteLength;
          }
          return new Response(bytes, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          });
        },
      },
    );
    try {
      await client.connect(transport);
    } catch (error) {
      await this.control
        .request("revokePrincipal", { credential: lease.credential })
        .catch(() => {});
      throw error;
    }
    return {
      client,
      close: async () => {
        try { await client.close(); } finally { await this.control
          .request("revokePrincipal", { credential: lease.credential })
          .catch(() => {}); }
      },
    };
  }
  async qualify(signal?: AbortSignal) {
    const connection = await this.client(null, signal);
    try {
      const tools = (await connection.client.listTools(undefined, { signal }))
          .tools,
        resources = (
          await (this.artifact.manifest.extensions['com.ri'].ui ? connection.client.listResources(undefined, { signal }) : Promise.resolve({ resources: [] }))
        ).resources;
      if (tools.length !== this.artifact.contract.actions.length)
        throw new AppError(
          "conflict",
          "The running service tool count differs from the installed contract",
        );
      for (const tool of tools) {
        const action = this.artifact.contract.actions.find(
          (item) => item.name === tool.name,
        );
        if (!action)
          throw new AppError(
            "conflict",
            "The service advertised an undeclared action",
          );
        if (!sameSchema(tool.inputSchema, action.inputSchema))
          throw new AppError(
            "conflict",
            `The running ${action.name} input schema differs from the installed contract`,
          );
        if (
          !tool.outputSchema ||
          !sameSchema(tool.outputSchema, action.outputSchema)
        )
          throw new AppError(
            "conflict",
            `The running ${action.name} output schema differs from the installed contract`,
          );
      }
      const declared = this.artifact.manifest.extensions["com.ri"].ui?.resources ?? [];
      if (
        resources.length !== declared.length ||
        resources.some(
          (resource) => !declared.some((item) => item.uri === resource.uri),
        )
      )
        throw new AppError(
          "conflict",
          "The running service resources differ from the installed package",
        );
    } finally {
      await connection.close();
    }
  }
  async request(
    method: string,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (method !== "invoke" && method !== "resource")
      return this.control.request(method, raw, signal);
    const params = raw as {
      action: string;
      input: Record<string, unknown>;
      context: InvocationContext;
      uri?: string;
    };
    const connection = await this.client(params.context, signal);
    try {
      if (method === "resource")
        return await connection.client.readResource(
          { uri: params.uri! },
          { signal },
        );
      const result = await connection.client.callTool(
        { name: params.action, arguments: params.input },
        undefined,
        { signal },
      );
      if (result.isError) {
        const message =
          (result.content as { type: string; text?: string }[]).find(
            (item) => item.type === "text",
          )?.text ?? "The service action failed";
        const code = errorCodeSchema.safeParse(result._meta?.['com.ri/errorCode']).data;
        throw new AppError(code ?? 'app_failed', code ? message.slice(0, 1000) : 'The service could not complete this operation. Check its activity and retry');
      }
      return result.structuredContent;
    } finally {
      await connection.close();
    }
  }
  onCapability(handler: Parameters<OwnedTransport["onCapability"]>[0]) {
    this.control.onCapability(handler);
  }
  onExit(handler: () => void) {
    this.control.onExit(handler);
  }
  stop() {
    return this.control.stop();
  }
}
