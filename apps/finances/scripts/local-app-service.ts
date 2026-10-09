import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import {ContractValidator, AppError, publicError} from "@ri/app-kit/contract";
import { financeAppContract } from "@/lib/local-app/definition";
import { contractDigest } from "@ri/app-kit/sdk";
import {
  initializeManaged,
  authorizeManagedPrincipal,
  revokeManagedPrincipal,
  shutdownManaged,
  withInvocationTicket,
} from "@/lib/local-app/managed";
import { initializeDatabase, resetDb } from "@/lib/db";
import { startFinanceWorker, stopFinanceWorker, financeWorkerHealth } from "@/lib/finance/worker";
import { getFinanceSettings, financeJobSummary } from "@/lib/db/queries";
import { POST } from "@/app/mcp/route";
let server: http.Server | null = null,
  endpoint: string | null = null,
  ready = false;
async function shutdown() {
  stopFinanceWorker();
  shutdownManaged();
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  resetDb();
  ready = false;
}
process.on("disconnect", () => {
  void shutdown().finally(() => process.exit(0));
});
process.on("message", (value) => {
  void (async () => {
    const message = value as {
      version: number;
      id: string;
      method: string;
      params: Record<string, unknown>;
    };
    if (message.version !== 1 || typeof message.id !== "string") return;
    try {
      let result: unknown;
      if (message.method === "initialize") {
        if (ready) throw new AppError("conflict","Already initialized");
        const p = message.params;
        if (
          p.version !== 1 ||
          typeof p.dataDir !== "string" ||
          !Number.isInteger(p.port) ||
          Number(p.port) < 1024
        )
          throw new AppError("invalid_input","Invalid private bootstrap");
        const contract = new ContractValidator().contract(JSON.parse(fs.readFileSync(path.join(process.cwd(),'contract.json'),'utf8')), new ContractValidator().manifest(JSON.parse(fs.readFileSync(path.join(process.cwd(),'plugin.json'),'utf8'))));
        const generated = financeAppContract();
        // The skill manager owns the packaged workflow index. Runtime action,
        // entity and context definitions must still exactly match this build.
        if (contractDigest({...contract,workflows:[]}) !== contractDigest({...generated,workflows:[]}))
          throw new AppError('conflict','The packaged Finance actions changed');
        if (contractDigest(contract) !== p.contractDigest)
          throw new AppError("conflict","The packaged Finance contract changed");
        process.env.FINANCE_ROOT = String(p.dataDir);
        initializeManaged(
          String(p.instanceId),
          p.broker as { url: string; credential: string },
          p.fixture === true,
        );
        initializeDatabase();
        server = http.createServer((req, res) => {
          void (async () => {
            if (req.url !== "/mcp" || req.method !== "POST") {
              res.writeHead(404);
              res.end();
              return;
            }
            const chunks: Buffer[] = [];
            let length = 0;
            for await (const chunk of req) {
              length += chunk.length;
              if (length > 1024 * 1024) {
                res.writeHead(413);
                res.end();
                req.destroy();
                return;
              }
              chunks.push(chunk);
            }
            const headers = new Headers();
            for (const [key, value] of Object.entries(req.headers))
              if (value)
                headers.set(
                  key,
                  Array.isArray(value) ? value.join(",") : value,
                );
            const request = new Request(endpoint!, {
              method: "POST",
              headers,
              body: new Uint8Array(Buffer.concat(chunks)),
            });
            const response = await withInvocationTicket(
              headers.get("x-app-invocation-ticket"),
              () => POST(request),
            );
            res.writeHead(
              response.status,
              Object.fromEntries(response.headers),
            );
            res.end(Buffer.from(await response.arrayBuffer()));
          })().catch(() => {
            if (!res.headersSent) res.writeHead(500);
            res.end();
          });
        });
        await new Promise<void>((resolve, reject) => {
          server!.once("error", reject);
          server!.listen(Number(p.port), "127.0.0.1", resolve);
        });
        endpoint = `http://127.0.0.1:${p.port}/mcp`;
        ready = true;
        startFinanceWorker();
        result = {
          version: 1,
          contractDigest: contractDigest(contract),
          endpoint,
        };
      } else if (!ready) throw new AppError("busy","Service not initialized");
      else if (message.method === "authorizePrincipal")
        result = authorizeManagedPrincipal(message.params as never);
      else if (message.method === "revokePrincipal")
        result = revokeManagedPrincipal(message.params);
      else if (message.method === "status")
        result = {
          ready: true,
          worker: financeWorkerHealth(),
          pendingSetup: !getFinanceSettings()?.enabled || !getFinanceSettings()?.restoreReviewed,
          jobs: financeJobSummary(),
        };
      else if (message.method === "shutdown") {
        await shutdown();
        result = { stopped: true };
      } else throw new AppError("unsupported","Unsupported service operation");
      process.send?.({ version: 1, id: message.id, result });
    } catch (error) {
      process.send?.({
        version: 1,
        id: message.id,
        error: publicError(error),
      });
    }
  })();
});
