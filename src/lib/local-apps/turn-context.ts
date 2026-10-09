import { z } from "zod/v4";
import { AppError, LIMITS } from "@ri/app-kit/contract";
import { localApps } from "./service";
const frozenSchema = z
  .object({
    label: z.string().max(200),
    instanceId: z.uuid(),
    packageDigest: z.string().regex(/^[a-f0-9]{64}$/),
    grantRevision: z.number().int(),
    grantId: z.uuid(),
    viewRevision: z.number().int(),
    dataRevision: z.union([z.string(), z.number()]).nullable(),
    modelContent: z.string().max(LIMITS.modelContextBytes),
    source:z.object({path:z.string().max(1024),query:z.record(z.string().max(128),z.string().max(1024)),state:z.unknown()}).strict(),
    recordRefs: z.array(z.unknown()).max(LIMITS.selections),
  })
  .strict();
export async function authorizedTurnContext(chatId: string, value: unknown) {
  const frozen = frozenSchema.parse(value),
    apps = localApps(),
    instance = apps.instance(frozen.instanceId);
  const grant = apps.grant(instance.id, {kind: 'chat', id: chatId});
  if (
    grant.id !== frozen.grantId ||
    grant.revision !== frozen.grantRevision ||
    instance.digest !== frozen.packageDigest
  )
    throw new AppError(
      "revoked",
      "The app context is no longer allowed for this chat",
    );
  if(Buffer.byteLength(JSON.stringify(frozen.source.state))>LIMITS.contextBytes)throw new AppError('invalid_input','The frozen context state exceeds its limit');
  const artifact=await apps.artifact(instance.id),action=artifact.manifest.extensions['com.ri'].ui?.contextAction;
  if(action){
    const live=await apps.call(instance.id,action,frozen.source,{kind:'chat',id:chatId}) as {modelContent:string;dataRevision:string|number;recordRefs:unknown[]};
    if(live.modelContent!==frozen.modelContent||live.dataRevision!==frozen.dataRevision||JSON.stringify(live.recordRefs)!==JSON.stringify(frozen.recordRefs))throw new AppError('conflict','The app data changed before this turn started. Refresh and send again');
  }
  return frozen;
}
