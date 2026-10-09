import { expect, it } from "vitest";
import { ContractValidator } from "@ri/app-kit/contract";
import { financeAppContract } from "./definition";
import { HOME_RESOURCE, VIEW_RESOURCE } from "./actions";
it("generates schema-validated static tools and workflows without initializing a data root", () => {
  const validator = new ContractValidator();
  const manifest = validator.manifest({
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: "ri-finance",
    version: "0.1.0",
    description: "Finance fixture",
    extensions: {
      "com.ri": {
        formatVersion: 1,
        displayName: "Finance",
        hostApi: 1,
        suggestedSlug: "finance",
        runtime: {
          kind: "node",
          protocol: "mcp-http-v1",
          entry: "dist/service.mjs",
          start: "on-demand",
          executionProfile: "trusted-native",
          mcpPath: "/mcp",
          target: {
            platform: "darwin",
            arch: "arm64",
            nodeVersion: "26.5.0",
            nodeAbi: "147",
          },
        },
        build: {
          adapter: "next-standalone-v1",
          recipe: "scripts/package-local-app.ts",
          output: "release/local-app",
          lockfile: "pnpm-lock.yaml",
          executionProfile: "trusted-native",
        },
        ui: {
          resources: [{ uri: HOME_RESOURCE }, { uri: VIEW_RESOURCE }],
          entrypoints: ["global", "thread"],
          resolveAction: "finance_open_app",
          contextAction: "finance_describe_view_context",
          access: {path:"/access",action:"finance_create_scope"},
        },
        contract: "contract.json",
        requests: { integrations: [], riActions: [] },
        source: { kind: "starter" },
      },
    },
  });
  const contract = validator.contract(financeAppContract(), manifest);
  expect(contract.actions.length).toBeGreaterThan(30);
  expect(contract.workflows).toHaveLength(2);
});
