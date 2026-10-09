import fs from "node:fs";
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import path from "node:path";
import { AppError, publicError, type AppContract, type AppManifest } from "./contract.js";
import {
  AppEngine,
  NativeNodeDriver,
  type HostServices,
  type RuntimeEvent,
} from "./runtime.js";
import { validateArtifact,prepareHtml } from "./build.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { InstalledArtifact } from "./runtime.js";
/** Network-free guest shared by real browser and Electron containment qualification. */
export async function containmentViewFixture() {
  const require=createRequire(import.meta.url);
  const compile=async(source:string)=>{
    const result=await build({stdin:{contents:source,resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser',target:'es2023',logLevel:'silent'});
    return result.outputFiles[0].text.replace(/<\/script/gi,'<\\/script');
  };
  const guestScript=await compile(`import {connectApp} from ${JSON.stringify(require.resolve('@ri/app-kit/app-client'))};(async()=>{
    const probe={origin:location.origin,parentBlocked:false,cookieBlocked:false,storageBlocked:false,electron:typeof window.riDesktop,node:typeof window.require};
    try{parent.parent.document.body}catch{probe.parentBlocked=true}try{document.cookie}catch{probe.cookieBlocked=true}try{localStorage.getItem('private')}catch{probe.storageBlocked=true}
    const client=await connectApp({theme:theme=>document.documentElement.dataset.theme=theme});window.client=client;
    await client.context({selected:['fictional']});
    parent.parent.postMessage({jsonrpc:'2.0',id:99,method:'tools/call',params:{name:'forged',arguments:{}}},'*');
    const file=await client.selectFile();probe.fileName=file?.name;
    await client.app.downloadFile({contents:[{type:'resource',resource:{uri:'file:///fictional.txt',mimeType:'text/plain',text:'Fictional export'}}]});
    await client.call('probe',probe);
    try{await fetch('https://blocked.example/private-fetch',{method:'POST'})}catch{}
    const image=document.createElement('img');image.src='https://blocked.example/private-image';document.body.append(image);
    const form=document.createElement('form');form.action='https://blocked.example/private-form';document.body.append(form);form.submit();
    window.__attemptNetworkNavigation=()=>{location.href='https://blocked.example/private-navigation'};
  })();`);
  const guest=prepareHtml('<html><body><h1>Fictional app</h1><script>'+guestScript+'</script></body></html>');
  const source=`import {AppViewController} from ${JSON.stringify(require.resolve('@ri/app-kit/view-host'))};
    const state=window.__appProbe={calls:[],contexts:[],downloads:[],selections:0,errors:[]};
    const controller=new AppViewController(document.getElementById('mount'),{
      call:async(action,input)=>{state.calls.push({action,input});return {};},context:async(input)=>{state.contexts.push(input);},navigate:()=>{},externalLink:()=>{},error:error=>state.errors.push(error.message),
      selectFile:async()=>{state.selections++;return {name:'fictional.csv',mimeType:'text/csv',base64:'ZmljdGlvbmFs'};},downloadFile:async contents=>{state.downloads.push(contents);}
    });window.__controller=controller;
    controller.open(${JSON.stringify(guest)},{id:'00000000-0000-4000-8000-000000000001',packageDigest:'a'.repeat(64),initialData:{fictional:true},path:'/',query:{},theme:'dark',files:{select:{mimeTypes:['text/csv'],maxBytes:1024},download:{mimeTypes:['text/plain'],maxBytes:1024}}});`;
  return '<html><body><div id="mount" style="height:500px"></div><script>'+await compile(source)+'</script></body></html>';
}
export function fixtureHost(node: string, root: string) {
  const events: RuntimeEvent[] = [];
  const granted = new Set(["fixture.mail"]);
  const services: HostServices = {
    version: 1,
    serviceBootstrap:async()=>({fixture:true}),
    serviceInvocation:async()=>({scopeRef:null,ticket:null}),
    authorize(_instance, _action, context) {
      if (context.principal.kind !== "fixture")
        throw new AppError("forbidden", "Fixture authority only");
    },
    async capability(_instance, _context, call) {
      if (!granted.has(call.name))
        throw new AppError(
          "unsupported",
          "This fixture capability is unavailable",
        );
      return {
        messages: [{ id: "fixture-message", subject: "Fictional receipt" }],
      };
    },
    event(event) {
      events.push(event);
    },
  };
  const engine = new AppEngine(services, new NativeNodeDriver(node));
  return {
    engine,
    events,
    granted,
    install(packageDir: string, instanceId: string) {
      const artifact = validateArtifact(packageDir);
      return {
        ...artifact,
        instanceId,
        dataDir: path.join(root, instanceId, "data"),
        cacheDir: path.join(root, instanceId, "cache"),
        logsDir: path.join(root, instanceId, "logs"),
      };
    },
  };
}
export function staticFixture(directory: string, name = "local-reference") {
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(path.join(directory, "dist"), { recursive: true });
  const manifest: AppManifest = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name,
    version: "0.1.0",
    description: "A fictional qualification fixture",
    extensions: {
      "com.ri": {
        formatVersion: 1,
        displayName: "Reference",
        hostApi: 1,
        suggestedSlug: "reference",
        runtime: { kind: "static" },
        build: { adapter: "none" },
        ui: {
          resources: [{ uri: `ui://${name}/main.html`, file: "dist/ui.html" }],
          entrypoints: ["global", "thread"],
        },
        contract: "contract.json",
        requests: { integrations: [], riActions: [] },
        source: { kind: "personal" },
      },
    },
  };
  const contract: AppContract = {
    formatVersion: 1,
    packageId: name,
    version: "0.1.0",
    actions: [],
    entities: [],
    contexts: {},
    workflows: [],
  };
  fs.writeFileSync(
    path.join(directory, "plugin.json"),
    JSON.stringify(manifest),
  );
  fs.writeFileSync(
    path.join(directory, "contract.json"),
    JSON.stringify(contract),
  );
  fs.writeFileSync(
    path.join(directory, "README.md"),
    "Fictional reference fixture",
  );
  fs.writeFileSync(
    path.join(directory, "AGENTS.md"),
    "Maintain the static fixture",
  );
  fs.writeFileSync(
    path.join(directory, "dist/ui.html"),
    '<html><body><h1>Reference</h1><script>document.body.dataset.ready="yes"</script></body></html>',
  );
  return validateArtifact(directory);
}
/** The ordinary MCP projection used by a reference client, independent of Ri. */
export function createFixtureMcpServer(
  engine: AppEngine,
  instance: InstalledArtifact,
  audience: "user" | "agent" = "agent",
) {
  const server = new Server(
      { name: instance.manifest.name, version: instance.manifest.version },
      { capabilities: { tools: {}, resources: {} } },
    ),
    principal = { kind: "fixture" as const, id: instance.instanceId,fixtureAudience:audience };
  const actions = instance.contract.actions.filter((action) =>
    action.audience.includes(audience),
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: actions.map((action) => ({
      name: action.name,
      description: action.description,
      inputSchema: action.inputSchema as { type: "object" },
      outputSchema: action.outputSchema as { type: "object" },
      annotations: {
        readOnlyHint: action.effect === "read",
        idempotentHint: action.retry === "idempotent",
      },
      _meta: {
        ui: {
          visibility:
            action.visibility === "app"
              ? ["app"]
              : action.visibility === "model"
                ? ["model"]
                : ["app", "model"],
          ...(action.name ===
          instance.manifest.extensions["com.ri"].ui?.resolveAction
            ? {
                resourceUri:
                  instance.manifest.extensions["com.ri"].ui!.resources[0].uri,
              }
            : {}),
        },
      },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (!actions.some((action) => action.name === request.params.name))
      throw new AppError("forbidden", "This fixture action is unavailable");
    try {
    const result = await engine.invoke(
      instance,
      request.params.name,
      request.params.arguments ?? {},
      principal,
      0,
      undefined,
      extra.signal,
    );
    if (!result || typeof result !== "object" || Array.isArray(result))
      throw new AppError(
        "unsupported",
        "The MCP fixture projection requires object action outputs",
      );
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      structuredContent: result as Record<string, unknown>,
    };
    }catch(error){const failure=publicError(error);return {isError:true,_meta:{'com.ri/errorCode':failure.code},content:[{type:'text' as const,text:failure.message}]};}
  });
  const resources = instance.manifest.extensions["com.ri"].ui?.resources ?? [];
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((resource) => ({
      uri: resource.uri,
      name: resource.uri,
      mimeType: "text/html;profile=mcp-app",
    })),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find(
      (resource) => resource.uri === request.params.uri,
    );
    if (!resource) throw new AppError("not_found", "Unknown fixture resource");
    if (!resource.file)
      return engine.resource(instance, resource.uri, principal, 0) as never;
    return {
      contents: [
        {
          uri: resource.uri,
          mimeType: "text/html;profile=mcp-app",
          text: fs.readFileSync(
            path.join(instance.packageDir, resource.file),
            "utf8",
          ),
          _meta: {
            ui: {
              csp: {
                connectDomains: [],
                resourceDomains: [],
                frameDomains: [],
              },
            },
          },
        },
      ],
    };
  });
  return server;
}
/** Uses the standard SDK client and transport, never a shortcut action call. */
export async function standardFixtureClient(server: Server) {
  const [host, consumer] = InMemoryTransport.createLinkedPair(),
    client = new Client({
      name: "Independent fixture client",
      version: "1.0.0",
    });
  await Promise.all([server.connect(host), client.connect(consumer)]);
  return {
    client,
    async close() {
      await client.close();
      await server.close();
    },
  };
}
