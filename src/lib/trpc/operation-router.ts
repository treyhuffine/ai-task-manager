import { operationContext, unwrapOperation } from '@/lib/server/operation';
import * as operation1 from "@/lib/server/operations/browser";
import * as operation2 from "@/lib/server/operations/calendar";
import * as operation3 from "@/lib/server/operations/claude-auth/login";
import * as operation4 from "@/lib/server/operations/claude-auth/status";
import * as operation5 from "@/lib/server/operations/claude-auth/stuck-sessions";
import * as operation9 from "@/lib/server/operations/connectors/approve";
import * as operation10 from "@/lib/server/operations/connectors/auth-configs";
import * as operation11 from "@/lib/server/operations/connectors/auth-configs/default";
import * as operation0 from "@/lib/server/operations/connectors/connect";
import * as operation6 from "@/lib/server/operations/connectors/connectDirect";
import * as operation12 from "@/lib/server/operations/connectors/connections";
import * as operation7 from "@/lib/server/operations/connectors/disconnect";
import * as operation13 from "@/lib/server/operations/connectors/mcp-servers";
import * as operation8 from "@/lib/server/operations/connectors/mcp-servers/[id]";
import * as operation14 from "@/lib/server/operations/connectors/pending-approvals";
import * as operation15 from "@/lib/server/operations/connectors/request-settings";
import * as operation16 from "@/lib/server/operations/connectors/requests/[eventId]";
import * as operation17 from "@/lib/server/operations/connectors/run";
import * as operation18 from "@/lib/server/operations/connectors/status";
import * as operation19 from "@/lib/server/operations/connectors/tasks";
import * as operation20 from "@/lib/server/operations/connectors/test";
import * as operation21 from "@/lib/server/operations/connectors/toolkits";
import * as operation22 from "@/lib/server/operations/connectors/write-policy";
import * as operation23 from "@/lib/server/operations/deck";
import * as operation24 from "@/lib/server/operations/deck/[id]";
import * as operation25 from "@/lib/server/operations/deck/[id]/revert";
import * as operation26 from "@/lib/server/operations/deck/generate";
import * as operation27 from "@/lib/server/operations/deck/instructions";
import * as operation28 from "@/lib/server/operations/deck/reconcile";
import * as operation29 from "@/lib/server/operations/deck/trigger";
import * as operation30 from "@/lib/server/operations/deck/versions";
import * as operation256 from "@/lib/server/operations/desktop/oauth/cancel";
import * as operation255 from "@/lib/server/operations/dev/sessions/[id]/inject";
import * as operation254 from "@/lib/server/operations/dev/sessions/scratch";
import * as operation31 from "@/lib/server/operations/devices";
import * as operation32 from "@/lib/server/operations/devices/[id]";
import * as operation33 from "@/lib/server/operations/devices/[id]/folders";
import * as operation34 from "@/lib/server/operations/devices/[id]/harnesses";
import * as operation35 from "@/lib/server/operations/devices/[id]/keys";
import * as operation36 from "@/lib/server/operations/devices/[id]/keys/[keyId]";
import * as operation37 from "@/lib/server/operations/devices/associate";
import * as operation38 from "@/lib/server/operations/devices/me/desktop-notifications";
import * as operation39 from "@/lib/server/operations/document-chat";
import * as operation40 from "@/lib/server/operations/entities/[type]/[id]/backlinks";
import * as operation41 from "@/lib/server/operations/entities/sessions";
import * as operation42 from "@/lib/server/operations/entities/titles";
import * as operation43 from "@/lib/server/operations/entity-brief";
import * as operation44 from "@/lib/server/operations/entity-versions";
import * as operation45 from "@/lib/server/operations/entity-versions/[id]/revert";
import * as operation46 from "@/lib/server/operations/executions/[id]/notify-scope-change";
import * as operation52 from "@/lib/server/operations/executions/[id]/preview-urls";
import * as operation47 from "@/lib/server/operations/executions/[id]/preview/logs";
import * as operation48 from "@/lib/server/operations/executions/[id]/preview/pin";
import * as operation49 from "@/lib/server/operations/executions/[id]/preview/start";
import * as operation50 from "@/lib/server/operations/executions/[id]/preview/status";
import * as operation51 from "@/lib/server/operations/executions/[id]/preview/stop";
import * as operation53 from "@/lib/server/operations/executions/[id]/retry-setup-script";
import * as operation54 from "@/lib/server/operations/executions/[id]/review";
import * as operation55 from "@/lib/server/operations/executions/[id]/review-context";
import * as operation56 from "@/lib/server/operations/executions/[id]/stop-agent";
import * as operation57 from "@/lib/server/operations/executions/[id]/tasks";
import * as operation58 from "@/lib/server/operations/fs/browse";
import * as operation59 from "@/lib/server/operations/fs/favicon";
import * as operation60 from "@/lib/server/operations/fs/installed-apps";
import * as operation61 from "@/lib/server/operations/fs/mkdir";
import * as operation62 from "@/lib/server/operations/fs/open";
import * as operation63 from "@/lib/server/operations/fs/pick-folder";
import * as operation64 from "@/lib/server/operations/gh/status";
import * as operation65 from "@/lib/server/operations/harness/auth";
import * as operation66 from "@/lib/server/operations/harness/cursor/key";
import * as operation67 from "@/lib/server/operations/harness/harnesses";
import * as operation68 from "@/lib/server/operations/harness/models";
import * as operation69 from "@/lib/server/operations/harness/models/custom";
import * as operation70 from "@/lib/server/operations/harness/models/enabled";
import * as operation71 from "@/lib/server/operations/harness/opencode/oauth";
import * as operation72 from "@/lib/server/operations/harness/opencode/operations/[id]/retry";
import * as operation73 from "@/lib/server/operations/harness/opencode/providers";
import * as operation74 from "@/lib/server/operations/harness/opencode/providers/[providerId]";
import * as operation75 from "@/lib/server/operations/harness/skills/global";
import * as operation76 from "@/lib/server/operations/harness/verify";
import * as operation77 from "@/lib/server/operations/heartbeat";
import * as operation257 from "@/lib/server/operations/home";
import * as operation258 from "@/lib/server/operations/home/terminals";
import * as operation259 from "@/lib/server/operations/home/terminals/[terminalId]";
import * as operation260 from "@/lib/server/operations/home/terminals/[terminalId]/input";
import * as operation261 from "@/lib/server/operations/home/terminals/[terminalId]/resize";
import * as operation78 from "@/lib/server/operations/imports/agents";
import * as operation79 from "@/lib/server/operations/imports/agents/refresh";
import * as operation80 from "@/lib/server/operations/notifications/channels";
import * as operation81 from "@/lib/server/operations/notifications/channels/[id]";
import * as operation82 from "@/lib/server/operations/notifications/channels/[id]/test";
import * as operation83 from "@/lib/server/operations/notifications/deliveries";
import * as operation84 from "@/lib/server/operations/notifications/digests";
import * as operation85 from "@/lib/server/operations/notifications/digests/[id]";
import * as operation86 from "@/lib/server/operations/notifications/telegram/bot";
import * as operation87 from "@/lib/server/operations/notifications/telegram/chats";
import * as operation88 from "@/lib/server/operations/notifications/telegram/claim";
import * as operation92 from "@/lib/server/operations/notifications/web-push/public-key";
import * as operation91 from "@/lib/server/operations/notifications/web-push/status";
import * as operation89 from "@/lib/server/operations/notifications/web-push/subscribe";
import * as operation90 from "@/lib/server/operations/notifications/web-push/unsubscribe";
import * as operation93 from "@/lib/server/operations/onboarding/about-suggestion";
import * as operation94 from "@/lib/server/operations/onboarding/area-suggestions";
import * as operation95 from "@/lib/server/operations/orchestrator-chat";
import * as operation96 from "@/lib/server/operations/orchestrator-chat/history";
import * as operation97 from "@/lib/server/operations/orchestrator-chat/resume";
import * as operation98 from "@/lib/server/operations/preview/settings";
import * as operation99 from "@/lib/server/operations/preview/settings/test";
import * as operation100 from "@/lib/server/operations/recents";
import * as operation101 from "@/lib/server/operations/reference-folders";
import * as operation102 from "@/lib/server/operations/reference-folders/[id]";
import * as operation103 from "@/lib/server/operations/reference-folders/[id]/archive";
import * as operation104 from "@/lib/server/operations/reference-folders/[id]/tree";
import * as operation105 from "@/lib/server/operations/runs";
import * as operation106 from "@/lib/server/operations/runs/[id]";
import * as operation107 from "@/lib/server/operations/runs/[id]/observe";
import * as operation108 from "@/lib/server/operations/runs/stats";
import * as operation109 from "@/lib/server/operations/search";
import * as operation110 from "@/lib/server/operations/service";
import * as operation111 from "@/lib/server/operations/service/awake";
import * as operation112 from "@/lib/server/operations/service/environment";
import * as operation113 from "@/lib/server/operations/service/speech";
import * as operation114 from "@/lib/server/operations/service/update";
import * as operation115 from "@/lib/server/operations/service/update/policy";
import * as operation116 from "@/lib/server/operations/sessions/[id]";
import * as operation117 from "@/lib/server/operations/sessions/[id]/archive";
import * as operation118 from "@/lib/server/operations/sessions/[id]/auto-merge";
import * as operation119 from "@/lib/server/operations/sessions/[id]/background-tasks";
import * as operation120 from "@/lib/server/operations/sessions/[id]/close-chat";
import * as operation121 from "@/lib/server/operations/sessions/[id]/commit";
import * as operation122 from "@/lib/server/operations/sessions/[id]/continue";
import * as operation123 from "@/lib/server/operations/sessions/[id]/deliveries";
import * as operation124 from "@/lib/server/operations/sessions/[id]/deliveries/[eventId]/cancel";
import * as operation125 from "@/lib/server/operations/sessions/[id]/diff";
import * as operation126 from "@/lib/server/operations/sessions/[id]/diff-stats";
import * as operation127 from "@/lib/server/operations/sessions/[id]/dir";
import * as operation128 from "@/lib/server/operations/sessions/[id]/entities";
import * as operation129 from "@/lib/server/operations/sessions/[id]/events";
import * as operation130 from "@/lib/server/operations/sessions/[id]/file";
import * as operation131 from "@/lib/server/operations/sessions/[id]/file/create";
import * as operation132 from "@/lib/server/operations/sessions/[id]/file/rename";
import * as operation133 from "@/lib/server/operations/sessions/[id]/file/resolve-conflict";
import * as operation134 from "@/lib/server/operations/sessions/[id]/help-with-error";
import * as operation135 from "@/lib/server/operations/sessions/[id]/history";
import * as operation136 from "@/lib/server/operations/sessions/[id]/interrupt";
import * as operation137 from "@/lib/server/operations/sessions/[id]/merge";
import * as operation138 from "@/lib/server/operations/sessions/[id]/messages";
import * as operation139 from "@/lib/server/operations/sessions/[id]/new-chat";
import * as operation251 from "@/lib/server/operations/sessions/[id]/open";
import * as operation140 from "@/lib/server/operations/sessions/[id]/pending-input";
import * as operation141 from "@/lib/server/operations/sessions/[id]/pending-input/[requestId]";
import * as operation142 from "@/lib/server/operations/sessions/[id]/picker";
import * as operation143 from "@/lib/server/operations/sessions/[id]/pin";
import * as operation144 from "@/lib/server/operations/sessions/[id]/pr";
import * as operation145 from "@/lib/server/operations/sessions/[id]/pr-link";
import * as operation146 from "@/lib/server/operations/sessions/[id]/prs";
import * as operation147 from "@/lib/server/operations/sessions/[id]/pull-base";
import * as operation148 from "@/lib/server/operations/sessions/[id]/pull-upstream";
import * as operation149 from "@/lib/server/operations/sessions/[id]/push";
import * as operation150 from "@/lib/server/operations/sessions/[id]/read";
import * as operation151 from "@/lib/server/operations/sessions/[id]/reconcile";
import * as operation152 from "@/lib/server/operations/sessions/[id]/reference-folders";
import * as operation153 from "@/lib/server/operations/sessions/[id]/references";
import * as operation154 from "@/lib/server/operations/sessions/[id]/resolve-conflicts";
import * as operation155 from "@/lib/server/operations/sessions/[id]/restart";
import * as operation156 from "@/lib/server/operations/sessions/[id]/resync";
import * as operation157 from "@/lib/server/operations/sessions/[id]/retry-setup";
import * as operation158 from "@/lib/server/operations/sessions/[id]/retry-setup-script";
import * as operation159 from "@/lib/server/operations/sessions/[id]/review";
import * as operation160 from "@/lib/server/operations/sessions/[id]/review/open";
import * as operation161 from "@/lib/server/operations/sessions/[id]/runtime-status";
import * as operation162 from "@/lib/server/operations/sessions/[id]/scratchpad";
import * as operation163 from "@/lib/server/operations/sessions/[id]/slash-commands";
import * as operation164 from "@/lib/server/operations/sessions/[id]/status";
import * as operation165 from "@/lib/server/operations/sessions/[id]/take-over-import";
import * as operation166 from "@/lib/server/operations/sessions/[id]/tasks/[taskId]/stop";
import * as operation167 from "@/lib/server/operations/sessions/[id]/terminals";
import * as operation249 from "@/lib/server/operations/sessions/[id]/terminals/[terminalId]";
import * as operation168 from "@/lib/server/operations/sessions/[id]/terminals/[terminalId]/input";
import * as operation169 from "@/lib/server/operations/sessions/[id]/terminals/[terminalId]/resize";
import * as operation170 from "@/lib/server/operations/sessions/[id]/transfer";
import * as operation171 from "@/lib/server/operations/sessions/[id]/transfer/deliver";
import * as operation172 from "@/lib/server/operations/sessions/[id]/transfer/finish";
import * as operation173 from "@/lib/server/operations/sessions/[id]/transfer/resume";
import * as operation174 from "@/lib/server/operations/sessions/[id]/transfer/working-state";
import * as operation175 from "@/lib/server/operations/sessions/[id]/tree";
import * as operation176 from "@/lib/server/operations/sessions/[id]/unpin";
import * as operation177 from "@/lib/server/operations/sessions/[id]/unread";
import * as operation178 from "@/lib/server/operations/sessions/[id]/view";
import * as operation179 from "@/lib/server/operations/sessions/[id]/wip";
import * as operation180 from "@/lib/server/operations/sessions/diff-stats";
import * as operation181 from "@/lib/server/operations/sessions/history";
import * as operation182 from "@/lib/server/operations/sessions/needs-review";
import * as operation183 from "@/lib/server/operations/sessions/pending-input";
import * as operation184 from "@/lib/server/operations/sessions/rail";
import * as operation185 from "@/lib/server/operations/sessions/search";
import * as operation186 from "@/lib/server/operations/settings/base-url";
import * as operation187 from "@/lib/server/operations/settings/base-url/auto-tunnel";
import * as operation188 from "@/lib/server/operations/settings/base-url/beamd";
import * as operation189 from "@/lib/server/operations/settings/base-url/tunnel-name";
import * as operation190 from "@/lib/server/operations/skills";
import * as operation191 from "@/lib/server/operations/skills/[ref]";
import * as operation193 from "@/lib/server/operations/skills/[ref]/commit";
import * as operation192 from "@/lib/server/operations/skills/[ref]/move";
import * as operation194 from "@/lib/server/operations/stream";
import * as operation195 from "@/lib/server/operations/stream/[id]";
import * as operation196 from "@/lib/server/operations/stream/[id]/dismiss";
import * as operation197 from "@/lib/server/operations/stream/[id]/reopen";
import * as operation198 from "@/lib/server/operations/stream/[id]/retry";
import * as operation199 from "@/lib/server/operations/stream/autonomy";
import * as operation200 from "@/lib/server/operations/stream/decisions";
import * as operation201 from "@/lib/server/operations/stream/decisions/[id]/accept";
import * as operation202 from "@/lib/server/operations/stream/decisions/[id]/correct";
import * as operation203 from "@/lib/server/operations/stream/decisions/[id]/undo";
import * as operation204 from "@/lib/server/operations/stream/passes";
import * as operation205 from "@/lib/server/operations/stream/passes/[id]/seen";
import * as operation206 from "@/lib/server/operations/stream/triage";
import * as operation207 from "@/lib/server/operations/system/host-info";
import * as operation208 from "@/lib/server/operations/tasks/[id]/continue-targets";
import * as operation253 from "@/lib/server/operations/transcribe";
import * as operation209 from "@/lib/server/operations/triggers";
import * as operation210 from "@/lib/server/operations/triggers/[id]";
import * as operation211 from "@/lib/server/operations/user-state";
import * as operation212 from "@/lib/server/operations/workspaces";
import * as operation224 from "@/lib/server/operations/workspaces/[id]";
import * as operation218 from "@/lib/server/operations/workspaces/[id]/archive";
import * as operation225 from "@/lib/server/operations/workspaces/[id]/base-status";
import * as operation226 from "@/lib/server/operations/workspaces/[id]/branches";
import * as operation227 from "@/lib/server/operations/workspaces/[id]/chat";
import * as operation229 from "@/lib/server/operations/workspaces/[id]/chat/history";
import * as operation228 from "@/lib/server/operations/workspaces/[id]/chat/new";
import * as operation230 from "@/lib/server/operations/workspaces/[id]/chat/resume";
import * as operation231 from "@/lib/server/operations/workspaces/[id]/connector-scopes";
import * as operation221 from "@/lib/server/operations/workspaces/[id]/dir";
import * as operation214 from "@/lib/server/operations/workspaces/[id]/file";
import * as operation219 from "@/lib/server/operations/workspaces/[id]/file/create";
import * as operation220 from "@/lib/server/operations/workspaces/[id]/file/rename";
import * as operation222 from "@/lib/server/operations/workspaces/[id]/file/resolve-conflict";
import * as operation232 from "@/lib/server/operations/workspaces/[id]/folders";
import * as operation233 from "@/lib/server/operations/workspaces/[id]/folders/[deviceId]";
import * as operation234 from "@/lib/server/operations/workspaces/[id]/folders/[deviceId]/linked/[referenceFolderId]";
import * as operation235 from "@/lib/server/operations/workspaces/[id]/github/issues";
import * as operation236 from "@/lib/server/operations/workspaces/[id]/github/issues/[number]";
import * as operation237 from "@/lib/server/operations/workspaces/[id]/github/prs";
import * as operation238 from "@/lib/server/operations/workspaces/[id]/github/prs/[number]";
import * as operation252 from "@/lib/server/operations/workspaces/[id]/open";
import * as operation239 from "@/lib/server/operations/workspaces/[id]/preview/restore-set";
import * as operation223 from "@/lib/server/operations/workspaces/[id]/previews";
import * as operation240 from "@/lib/server/operations/workspaces/[id]/pull-base";
import * as operation241 from "@/lib/server/operations/workspaces/[id]/referenced-by";
import * as operation242 from "@/lib/server/operations/workspaces/[id]/run-on";
import * as operation243 from "@/lib/server/operations/workspaces/[id]/sessions";
import * as operation244 from "@/lib/server/operations/workspaces/[id]/setups";
import * as operation245 from "@/lib/server/operations/workspaces/[id]/tasks";
import * as operation215 from "@/lib/server/operations/workspaces/[id]/terminals";
import * as operation250 from "@/lib/server/operations/workspaces/[id]/terminals/[terminalId]";
import * as operation216 from "@/lib/server/operations/workspaces/[id]/terminals/[terminalId]/input";
import * as operation217 from "@/lib/server/operations/workspaces/[id]/terminals/[terminalId]/resize";
import * as operation213 from "@/lib/server/operations/workspaces/[id]/tree";
import * as operation246 from "@/lib/server/operations/workspaces/detect-stack";
import * as operation247 from "@/lib/server/operations/workspaces/preview-files";
import * as operation248 from "@/lib/server/operations/workspaces/reorder";
import { viewerProcedure as p, router } from './init';

export const taskProcedures = {
  continueTargetsGet: p.input(operation208.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation208.GET(input, operationContext(ctx.request, input, "/tasks/[id]/continue-targets")))),
};

export const internalRouters = {
  connectors: router({
    connectPost: p.input(operation0.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation0.POST(input, operationContext(ctx.request, input, "/connectors/connect")))),
    connectDirectPost: p.input(operation6.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation6.POST(input, operationContext(ctx.request, input, "/connectors/connectDirect")))),
    disconnectPost: p.input(operation7.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation7.POST(input, operationContext(ctx.request, input, "/connectors/disconnect")))),
    mcpServersPatch: p.input(operation8.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation8.PATCH(input, operationContext(ctx.request, input, "/connectors/mcp-servers/[id]")))),
    mcpServerPost: p.input(operation8.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation8.POST(input, operationContext(ctx.request, input, "/connectors/mcp-servers/[id]")))),
    mcpServersDelete: p.input(operation8.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation8.DELETE(input, operationContext(ctx.request, input, "/connectors/mcp-servers/[id]")))),
    approvePost: p.input(operation9.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation9.POST(input, operationContext(ctx.request, input, "/connectors/approve")))),
    authConfigsGet: p.input(operation10.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation10.GET(input, operationContext(ctx.request, input, "/connectors/auth-configs")))),
    authConfigsPost: p.input(operation10.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation10.POST(input, operationContext(ctx.request, input, "/connectors/auth-configs")))),
    authConfigsDelete: p.input(operation10.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation10.DELETE(input, operationContext(ctx.request, input, "/connectors/auth-configs")))),
    authConfigsDefaultPost: p.input(operation11.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation11.POST(input, operationContext(ctx.request, input, "/connectors/auth-configs/default")))),
    connectionsGet: p.input(operation12.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation12.GET(input, operationContext(ctx.request, input, "/connectors/connections")))),
    mcpServersGet: p.input(operation13.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation13.GET(input, operationContext(ctx.request, input, "/connectors/mcp-servers")))),
    mcpServersPost: p.input(operation13.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation13.POST(input, operationContext(ctx.request, input, "/connectors/mcp-servers")))),
    pendingApprovalsGet: p.input(operation14.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation14.GET(input, operationContext(ctx.request, input, "/connectors/pending-approvals")))),
    requestSettingsGet: p.input(operation15.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation15.GET(input, operationContext(ctx.request, input, "/connectors/request-settings")))),
    requestSettingsPatch: p.input(operation15.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation15.PATCH(input, operationContext(ctx.request, input, "/connectors/request-settings")))),
    requestsEventIdPost: p.input(operation16.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation16.POST(input, operationContext(ctx.request, input, "/connectors/requests/[eventId]")))),
    runPost: p.input(operation17.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation17.POST(input, operationContext(ctx.request, input, "/connectors/run")))),
    statusGet: p.input(operation18.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation18.GET(input, operationContext(ctx.request, input, "/connectors/status")))),
    tasksGet: p.input(operation19.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation19.GET(input, operationContext(ctx.request, input, "/connectors/tasks")))),
    testPost: p.input(operation20.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation20.POST(input, operationContext(ctx.request, input, "/connectors/test")))),
    toolkitsGet: p.input(operation21.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation21.GET(input, operationContext(ctx.request, input, "/connectors/toolkits")))),
    writePolicyGet: p.input(operation22.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation22.GET(input, operationContext(ctx.request, input, "/connectors/write-policy")))),
    writePolicyPost: p.input(operation22.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation22.POST(input, operationContext(ctx.request, input, "/connectors/write-policy")))),
  }),
  browser: router({
    list: p.input(operation1.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation1.GET(input, operationContext(ctx.request, input, "/browser")))),
    update: p.input(operation1.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation1.PATCH(input, operationContext(ctx.request, input, "/browser")))),
    create: p.input(operation1.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation1.POST(input, operationContext(ctx.request, input, "/browser")))),
  }),
  calendar: router({
    list: p.input(operation2.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation2.GET(input, operationContext(ctx.request, input, "/calendar")))),
  }),
  claudeAuth: router({
    loginPost: p.input(operation3.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation3.POST(input, operationContext(ctx.request, input, "/claude-auth/login")))),
    statusGet: p.input(operation4.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation4.GET(input, operationContext(ctx.request, input, "/claude-auth/status")))),
    stuckSessionsGet: p.input(operation5.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation5.GET(input, operationContext(ctx.request, input, "/claude-auth/stuck-sessions")))),
  }),
  deck: router({
    list: p.input(operation23.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation23.GET(input, operationContext(ctx.request, input, "/deck")))),
    get: p.input(operation24.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation24.GET(input, operationContext(ctx.request, input, "/deck/[id]")))),
    update: p.input(operation24.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation24.PATCH(input, operationContext(ctx.request, input, "/deck/[id]")))),
    revertPost: p.input(operation25.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation25.POST(input, operationContext(ctx.request, input, "/deck/[id]/revert")))),
    generatePost: p.input(operation26.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation26.POST(input, operationContext(ctx.request, input, "/deck/generate")))),
    instructionsGet: p.input(operation27.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation27.GET(input, operationContext(ctx.request, input, "/deck/instructions")))),
    instructionsPut: p.input(operation27.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation27.PUT(input, operationContext(ctx.request, input, "/deck/instructions")))),
    reconcilePost: p.input(operation28.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation28.POST(input, operationContext(ctx.request, input, "/deck/reconcile")))),
    triggerGet: p.input(operation29.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation29.GET(input, operationContext(ctx.request, input, "/deck/trigger")))),
    triggerPut: p.input(operation29.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation29.PUT(input, operationContext(ctx.request, input, "/deck/trigger")))),
    versionsGet: p.input(operation30.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation30.GET(input, operationContext(ctx.request, input, "/deck/versions")))),
    current: p.input(operation23.CURRENTInput).query(async ({ input, ctx }) => unwrapOperation(await operation23.CURRENT(input, operationContext(ctx.request, input, "/deck")))),
  }),
  devices: router({
    list: p.input(operation31.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation31.GET(input, operationContext(ctx.request, input, "/devices")))),
    create: p.input(operation31.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation31.POST(input, operationContext(ctx.request, input, "/devices")))),
    update: p.input(operation32.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation32.PATCH(input, operationContext(ctx.request, input, "/devices/[id]")))),
    delete: p.input(operation32.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation32.DELETE(input, operationContext(ctx.request, input, "/devices/[id]")))),
    foldersGet: p.input(operation33.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation33.GET(input, operationContext(ctx.request, input, "/devices/[id]/folders")))),
    harnessesGet: p.input(operation34.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation34.GET(input, operationContext(ctx.request, input, "/devices/[id]/harnesses")))),
    keysPost: p.input(operation35.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation35.POST(input, operationContext(ctx.request, input, "/devices/[id]/keys")))),
    keysKeyIdDelete: p.input(operation36.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation36.DELETE(input, operationContext(ctx.request, input, "/devices/[id]/keys/[keyId]")))),
    associatePost: p.input(operation37.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation37.POST(input, operationContext(ctx.request, input, "/devices/associate")))),
    meDesktopNotificationsGet: p.input(operation38.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation38.GET(input, operationContext(ctx.request, input, "/devices/me/desktop-notifications")))),
    meDesktopNotificationsPost: p.input(operation38.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation38.POST(input, operationContext(ctx.request, input, "/devices/me/desktop-notifications")))),
  }),
  documentChat: router({
    list: p.input(operation39.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation39.GET(input, operationContext(ctx.request, input, "/document-chat")))),
    create: p.input(operation39.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation39.POST(input, operationContext(ctx.request, input, "/document-chat")))),
  }),
  entities: router({
    backlinksTypeGet: p.input(operation40.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation40.GET(input, operationContext(ctx.request, input, "/entities/[type]/[id]/backlinks")))),
    sessionsGet: p.input(operation41.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation41.GET(input, operationContext(ctx.request, input, "/entities/sessions")))),
    titlesGet: p.input(operation42.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation42.GET(input, operationContext(ctx.request, input, "/entities/titles")))),
  }),
  entityBrief: router({
    list: p.input(operation43.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation43.GET(input, operationContext(ctx.request, input, "/entity-brief")))),
    create: p.input(operation43.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation43.POST(input, operationContext(ctx.request, input, "/entity-brief")))),
  }),
  entityVersions: router({
    list: p.input(operation44.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation44.GET(input, operationContext(ctx.request, input, "/entity-versions")))),
    revertPost: p.input(operation45.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation45.POST(input, operationContext(ctx.request, input, "/entity-versions/[id]/revert")))),
  }),
  executions: router({
    notifyScopeChangePost: p.input(operation46.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation46.POST(input, operationContext(ctx.request, input, "/executions/[id]/notify-scope-change")))),
    previewLogsGet: p.input(operation47.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation47.GET(input, operationContext(ctx.request, input, "/executions/[id]/preview/logs")))),
    previewPinPost: p.input(operation48.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation48.POST(input, operationContext(ctx.request, input, "/executions/[id]/preview/pin")))),
    previewStartPost: p.input(operation49.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation49.POST(input, operationContext(ctx.request, input, "/executions/[id]/preview/start")))),
    previewStatusGet: p.input(operation50.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation50.GET(input, operationContext(ctx.request, input, "/executions/[id]/preview/status")))),
    previewStopPost: p.input(operation51.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation51.POST(input, operationContext(ctx.request, input, "/executions/[id]/preview/stop")))),
    previewUrlsPut: p.input(operation52.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation52.PUT(input, operationContext(ctx.request, input, "/executions/[id]/preview-urls")))),
    retrySetupScriptPost: p.input(operation53.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation53.POST(input, operationContext(ctx.request, input, "/executions/[id]/retry-setup-script")))),
    reviewPost: p.input(operation54.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation54.POST(input, operationContext(ctx.request, input, "/executions/[id]/review")))),
    reviewContextGet: p.input(operation55.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation55.GET(input, operationContext(ctx.request, input, "/executions/[id]/review-context")))),
    stopAgentPost: p.input(operation56.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation56.POST(input, operationContext(ctx.request, input, "/executions/[id]/stop-agent")))),
    tasksGet: p.input(operation57.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation57.GET(input, operationContext(ctx.request, input, "/executions/[id]/tasks")))),
  }),
  fs: router({
    browseGet: p.input(operation58.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation58.GET(input, operationContext(ctx.request, input, "/fs/browse")))),
    faviconPost: p.input(operation59.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation59.POST(input, operationContext(ctx.request, input, "/fs/favicon")))),
    installedAppsGet: p.input(operation60.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation60.GET(input, operationContext(ctx.request, input, "/fs/installed-apps")))),
    mkdirPost: p.input(operation61.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation61.POST(input, operationContext(ctx.request, input, "/fs/mkdir")))),
    openPost: p.input(operation62.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation62.POST(input, operationContext(ctx.request, input, "/fs/open")))),
    pickFolderPost: p.input(operation63.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation63.POST(input, operationContext(ctx.request, input, "/fs/pick-folder")))),
  }),
  gh: router({
    statusGet: p.input(operation64.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation64.GET(input, operationContext(ctx.request, input, "/gh/status")))),
  }),
  harness: router({
    authPost: p.input(operation65.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation65.POST(input, operationContext(ctx.request, input, "/harness/auth")))),
    cursorKeyGet: p.input(operation66.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation66.GET(input, operationContext(ctx.request, input, "/harness/cursor/key")))),
    cursorKeyPut: p.input(operation66.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation66.PUT(input, operationContext(ctx.request, input, "/harness/cursor/key")))),
    cursorKeyDelete: p.input(operation66.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation66.DELETE(input, operationContext(ctx.request, input, "/harness/cursor/key")))),
    harnessesGet: p.input(operation67.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation67.GET(input, operationContext(ctx.request, input, "/harness/harnesses")))),
    modelsGet: p.input(operation68.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation68.GET(input, operationContext(ctx.request, input, "/harness/models")))),
    modelsCustomPost: p.input(operation69.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation69.POST(input, operationContext(ctx.request, input, "/harness/models/custom")))),
    modelsCustomDelete: p.input(operation69.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation69.DELETE(input, operationContext(ctx.request, input, "/harness/models/custom")))),
    modelsEnabledGet: p.input(operation70.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation70.GET(input, operationContext(ctx.request, input, "/harness/models/enabled")))),
    modelsEnabledPut: p.input(operation70.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation70.PUT(input, operationContext(ctx.request, input, "/harness/models/enabled")))),
    opencodeOauthPost: p.input(operation71.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation71.POST(input, operationContext(ctx.request, input, "/harness/opencode/oauth")))),
    opencodeOperationsRetryPost: p.input(operation72.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation72.POST(input, operationContext(ctx.request, input, "/harness/opencode/operations/[id]/retry")))),
    opencodeProvidersGet: p.input(operation73.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation73.GET(input, operationContext(ctx.request, input, "/harness/opencode/providers")))),
    opencodeProvidersProviderIdGet: p.input(operation74.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation74.GET(input, operationContext(ctx.request, input, "/harness/opencode/providers/[providerId]")))),
    opencodeProvidersProviderIdPut: p.input(operation74.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation74.PUT(input, operationContext(ctx.request, input, "/harness/opencode/providers/[providerId]")))),
    opencodeProvidersProviderIdDelete: p.input(operation74.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation74.DELETE(input, operationContext(ctx.request, input, "/harness/opencode/providers/[providerId]")))),
    skillsGlobalGet: p.input(operation75.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation75.GET(input, operationContext(ctx.request, input, "/harness/skills/global")))),
    skillsGlobalPut: p.input(operation75.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation75.PUT(input, operationContext(ctx.request, input, "/harness/skills/global")))),
    verifyPost: p.input(operation76.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation76.POST(input, operationContext(ctx.request, input, "/harness/verify")))),
  }),
  heartbeat: router({
    list: p.input(operation77.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation77.GET(input, operationContext(ctx.request, input, "/heartbeat")))),
    replace: p.input(operation77.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation77.PUT(input, operationContext(ctx.request, input, "/heartbeat")))),
  }),
  imports: router({
    agentsGet: p.input(operation78.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation78.GET(input, operationContext(ctx.request, input, "/imports/agents")))),
    agentsPost: p.input(operation78.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation78.POST(input, operationContext(ctx.request, input, "/imports/agents")))),
    agentsRefreshPost: p.input(operation79.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation79.POST(input, operationContext(ctx.request, input, "/imports/agents/refresh")))),
  }),
  notifications: router({
    channelsGet: p.input(operation80.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation80.GET(input, operationContext(ctx.request, input, "/notifications/channels")))),
    channelsPost: p.input(operation80.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation80.POST(input, operationContext(ctx.request, input, "/notifications/channels")))),
    channelsPatch: p.input(operation81.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation81.PATCH(input, operationContext(ctx.request, input, "/notifications/channels/[id]")))),
    channelsDelete: p.input(operation81.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation81.DELETE(input, operationContext(ctx.request, input, "/notifications/channels/[id]")))),
    channelsTestPost: p.input(operation82.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation82.POST(input, operationContext(ctx.request, input, "/notifications/channels/[id]/test")))),
    deliveriesGet: p.input(operation83.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation83.GET(input, operationContext(ctx.request, input, "/notifications/deliveries")))),
    digestsGet: p.input(operation84.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation84.GET(input, operationContext(ctx.request, input, "/notifications/digests")))),
    digestsPatch: p.input(operation85.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation85.PATCH(input, operationContext(ctx.request, input, "/notifications/digests/[id]")))),
    telegramBotGet: p.input(operation86.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation86.GET(input, operationContext(ctx.request, input, "/notifications/telegram/bot")))),
    telegramChatsGet: p.input(operation87.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation87.GET(input, operationContext(ctx.request, input, "/notifications/telegram/chats")))),
    telegramClaimPost: p.input(operation88.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation88.POST(input, operationContext(ctx.request, input, "/notifications/telegram/claim")))),
    webPushSubscribePost: p.input(operation89.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation89.POST(input, operationContext(ctx.request, input, "/notifications/web-push/subscribe")))),
    webPushUnsubscribePost: p.input(operation90.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation90.POST(input, operationContext(ctx.request, input, "/notifications/web-push/unsubscribe")))),
    webPushStatusPost: p.input(operation91.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation91.POST(input, operationContext(ctx.request, input, "/notifications/web-push/status")))),
    webPushPublicKeyGet: p.input(operation92.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation92.GET(input, operationContext(ctx.request, input, "/notifications/web-push/public-key")))),
  }),
  onboarding: router({
    aboutSuggestionPost: p.input(operation93.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation93.POST(input, operationContext(ctx.request, input, "/onboarding/about-suggestion")))),
    areaSuggestionsPost: p.input(operation94.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation94.POST(input, operationContext(ctx.request, input, "/onboarding/area-suggestions")))),
  }),
  orchestratorChat: router({
    list: p.input(operation95.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation95.GET(input, operationContext(ctx.request, input, "/orchestrator-chat")))),
    create: p.input(operation95.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation95.POST(input, operationContext(ctx.request, input, "/orchestrator-chat")))),
    historyGet: p.input(operation96.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation96.GET(input, operationContext(ctx.request, input, "/orchestrator-chat/history")))),
    resumePost: p.input(operation97.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation97.POST(input, operationContext(ctx.request, input, "/orchestrator-chat/resume")))),
  }),
  preview: router({
    settingsGet: p.input(operation98.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation98.GET(input, operationContext(ctx.request, input, "/preview/settings")))),
    settingsPut: p.input(operation98.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation98.PUT(input, operationContext(ctx.request, input, "/preview/settings")))),
    settingsTestPost: p.input(operation99.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation99.POST(input, operationContext(ctx.request, input, "/preview/settings/test")))),
  }),
  recents: router({
    list: p.input(operation100.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation100.GET(input, operationContext(ctx.request, input, "/recents")))),
  }),
  referenceFolders: router({
    list: p.input(operation101.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation101.GET(input, operationContext(ctx.request, input, "/reference-folders")))),
    create: p.input(operation101.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation101.POST(input, operationContext(ctx.request, input, "/reference-folders")))),
    get: p.input(operation102.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation102.GET(input, operationContext(ctx.request, input, "/reference-folders/[id]")))),
    update: p.input(operation102.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation102.PATCH(input, operationContext(ctx.request, input, "/reference-folders/[id]")))),
    archivePost: p.input(operation103.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation103.POST(input, operationContext(ctx.request, input, "/reference-folders/[id]/archive")))),
    treeGet: p.input(operation104.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation104.GET(input, operationContext(ctx.request, input, "/reference-folders/[id]/tree")))),
  }),
  runs: router({
    list: p.input(operation105.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation105.GET(input, operationContext(ctx.request, input, "/runs")))),
    get: p.input(operation106.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation106.GET(input, operationContext(ctx.request, input, "/runs/[id]")))),
    create: p.input(operation106.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation106.POST(input, operationContext(ctx.request, input, "/runs/[id]")))),
    observeGet: p.input(operation107.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation107.GET(input, operationContext(ctx.request, input, "/runs/[id]/observe")))),
    statsGet: p.input(operation108.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation108.GET(input, operationContext(ctx.request, input, "/runs/stats")))),
  }),
  search: router({
    list: p.input(operation109.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation109.GET(input, operationContext(ctx.request, input, "/search")))),
  }),
  service: router({
    list: p.input(operation110.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation110.GET(input, operationContext(ctx.request, input, "/service")))),
    awakeGet: p.input(operation111.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation111.GET(input, operationContext(ctx.request, input, "/service/awake")))),
    awakePatch: p.input(operation111.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation111.PATCH(input, operationContext(ctx.request, input, "/service/awake")))),
    environmentGet: p.input(operation112.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation112.GET(input, operationContext(ctx.request, input, "/service/environment")))),
    environmentPatch: p.input(operation112.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation112.PATCH(input, operationContext(ctx.request, input, "/service/environment")))),
    speechGet: p.input(operation113.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation113.GET(input, operationContext(ctx.request, input, "/service/speech")))),
    speechPost: p.input(operation113.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation113.POST(input, operationContext(ctx.request, input, "/service/speech")))),
    updatePost: p.input(operation114.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation114.POST(input, operationContext(ctx.request, input, "/service/update")))),
    updatePolicyPatch: p.input(operation115.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation115.PATCH(input, operationContext(ctx.request, input, "/service/update/policy")))),
  }),
  sessions: router({
    get: p.input(operation116.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation116.GET(input, operationContext(ctx.request, input, "/sessions/[id]")))),
    update: p.input(operation116.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation116.PATCH(input, operationContext(ctx.request, input, "/sessions/[id]")))),
    archivePost: p.input(operation117.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation117.POST(input, operationContext(ctx.request, input, "/sessions/[id]/archive")))),
    autoMergePost: p.input(operation118.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation118.POST(input, operationContext(ctx.request, input, "/sessions/[id]/auto-merge")))),
    backgroundTasksGet: p.input(operation119.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation119.GET(input, operationContext(ctx.request, input, "/sessions/[id]/background-tasks")))),
    closeChatPost: p.input(operation120.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation120.POST(input, operationContext(ctx.request, input, "/sessions/[id]/close-chat")))),
    commitPost: p.input(operation121.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation121.POST(input, operationContext(ctx.request, input, "/sessions/[id]/commit")))),
    continuePost: p.input(operation122.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation122.POST(input, operationContext(ctx.request, input, "/sessions/[id]/continue")))),
    deliveriesGet: p.input(operation123.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation123.GET(input, operationContext(ctx.request, input, "/sessions/[id]/deliveries")))),
    deliveriesCancelEventIdPost: p.input(operation124.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation124.POST(input, operationContext(ctx.request, input, "/sessions/[id]/deliveries/[eventId]/cancel")))),
    diffGet: p.input(operation125.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation125.GET(input, operationContext(ctx.request, input, "/sessions/[id]/diff")))),
    diffStatsGet: p.input(operation126.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation126.GET(input, operationContext(ctx.request, input, "/sessions/[id]/diff-stats")))),
    dirPost: p.input(operation127.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation127.POST(input, operationContext(ctx.request, input, "/sessions/[id]/dir")))),
    dirDelete: p.input(operation127.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation127.DELETE(input, operationContext(ctx.request, input, "/sessions/[id]/dir")))),
    entitiesGet: p.input(operation128.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation128.GET(input, operationContext(ctx.request, input, "/sessions/[id]/entities")))),
    eventsGet: p.input(operation129.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation129.GET(input, operationContext(ctx.request, input, "/sessions/[id]/events")))),
    fileGet: p.input(operation130.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation130.GET(input, operationContext(ctx.request, input, "/sessions/[id]/file")))),
    filePut: p.input(operation130.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation130.PUT(input, operationContext(ctx.request, input, "/sessions/[id]/file")))),
    fileDelete: p.input(operation130.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation130.DELETE(input, operationContext(ctx.request, input, "/sessions/[id]/file")))),
    fileCreatePost: p.input(operation131.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation131.POST(input, operationContext(ctx.request, input, "/sessions/[id]/file/create")))),
    fileRenamePost: p.input(operation132.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation132.POST(input, operationContext(ctx.request, input, "/sessions/[id]/file/rename")))),
    fileResolveConflictPost: p.input(operation133.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation133.POST(input, operationContext(ctx.request, input, "/sessions/[id]/file/resolve-conflict")))),
    helpWithErrorPost: p.input(operation134.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation134.POST(input, operationContext(ctx.request, input, "/sessions/[id]/help-with-error")))),
    historyGet: p.input(operation135.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation135.GET(input, operationContext(ctx.request, input, "/sessions/[id]/history")))),
    interruptPost: p.input(operation136.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation136.POST(input, operationContext(ctx.request, input, "/sessions/[id]/interrupt")))),
    mergePost: p.input(operation137.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation137.POST(input, operationContext(ctx.request, input, "/sessions/[id]/merge")))),
    messagesPost: p.input(operation138.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation138.POST(input, operationContext(ctx.request, input, "/sessions/[id]/messages")))),
    newChatPost: p.input(operation139.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation139.POST(input, operationContext(ctx.request, input, "/sessions/[id]/new-chat")))),
    pendingInputGet: p.input(operation140.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation140.GET(input, operationContext(ctx.request, input, "/sessions/[id]/pending-input")))),
    pendingInputRequestIdPost: p.input(operation141.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation141.POST(input, operationContext(ctx.request, input, "/sessions/[id]/pending-input/[requestId]")))),
    pickerGet: p.input(operation142.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation142.GET(input, operationContext(ctx.request, input, "/sessions/[id]/picker")))),
    pinPost: p.input(operation143.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation143.POST(input, operationContext(ctx.request, input, "/sessions/[id]/pin")))),
    prGet: p.input(operation144.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation144.GET(input, operationContext(ctx.request, input, "/sessions/[id]/pr")))),
    prPost: p.input(operation144.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation144.POST(input, operationContext(ctx.request, input, "/sessions/[id]/pr")))),
    prLinkGet: p.input(operation145.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation145.GET(input, operationContext(ctx.request, input, "/sessions/[id]/pr-link")))),
    prsGet: p.input(operation146.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation146.GET(input, operationContext(ctx.request, input, "/sessions/[id]/prs")))),
    pullBasePost: p.input(operation147.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation147.POST(input, operationContext(ctx.request, input, "/sessions/[id]/pull-base")))),
    pullUpstreamPost: p.input(operation148.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation148.POST(input, operationContext(ctx.request, input, "/sessions/[id]/pull-upstream")))),
    pushPost: p.input(operation149.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation149.POST(input, operationContext(ctx.request, input, "/sessions/[id]/push")))),
    readPost: p.input(operation150.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation150.POST(input, operationContext(ctx.request, input, "/sessions/[id]/read")))),
    reconcilePost: p.input(operation151.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation151.POST(input, operationContext(ctx.request, input, "/sessions/[id]/reconcile")))),
    referenceFoldersGet: p.input(operation152.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation152.GET(input, operationContext(ctx.request, input, "/sessions/[id]/reference-folders")))),
    referencesGet: p.input(operation153.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation153.GET(input, operationContext(ctx.request, input, "/sessions/[id]/references")))),
    referencesPost: p.input(operation153.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation153.POST(input, operationContext(ctx.request, input, "/sessions/[id]/references")))),
    referencesDelete: p.input(operation153.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation153.DELETE(input, operationContext(ctx.request, input, "/sessions/[id]/references")))),
    resolveConflictsPost: p.input(operation154.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation154.POST(input, operationContext(ctx.request, input, "/sessions/[id]/resolve-conflicts")))),
    restartPost: p.input(operation155.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation155.POST(input, operationContext(ctx.request, input, "/sessions/[id]/restart")))),
    resyncPost: p.input(operation156.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation156.POST(input, operationContext(ctx.request, input, "/sessions/[id]/resync")))),
    retrySetupPost: p.input(operation157.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation157.POST(input, operationContext(ctx.request, input, "/sessions/[id]/retry-setup")))),
    retrySetupScriptPost: p.input(operation158.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation158.POST(input, operationContext(ctx.request, input, "/sessions/[id]/retry-setup-script")))),
    reviewGet: p.input(operation159.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation159.GET(input, operationContext(ctx.request, input, "/sessions/[id]/review")))),
    reviewPost: p.input(operation159.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation159.POST(input, operationContext(ctx.request, input, "/sessions/[id]/review")))),
    reviewOpenPost: p.input(operation160.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation160.POST(input, operationContext(ctx.request, input, "/sessions/[id]/review/open")))),
    runtimeStatusGet: p.input(operation161.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation161.GET(input, operationContext(ctx.request, input, "/sessions/[id]/runtime-status")))),
    scratchpadGet: p.input(operation162.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation162.GET(input, operationContext(ctx.request, input, "/sessions/[id]/scratchpad")))),
    scratchpadPut: p.input(operation162.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation162.PUT(input, operationContext(ctx.request, input, "/sessions/[id]/scratchpad")))),
    slashCommandsGet: p.input(operation163.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation163.GET(input, operationContext(ctx.request, input, "/sessions/[id]/slash-commands")))),
    statusGet: p.input(operation164.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation164.GET(input, operationContext(ctx.request, input, "/sessions/[id]/status")))),
    takeOverImportPost: p.input(operation165.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation165.POST(input, operationContext(ctx.request, input, "/sessions/[id]/take-over-import")))),
    tasksStopTaskIdPost: p.input(operation166.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation166.POST(input, operationContext(ctx.request, input, "/sessions/[id]/tasks/[taskId]/stop")))),
    terminalsGet: p.input(operation167.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation167.GET(input, operationContext(ctx.request, input, "/sessions/[id]/terminals")))),
    terminalsPost: p.input(operation167.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation167.POST(input, operationContext(ctx.request, input, "/sessions/[id]/terminals")))),
    terminalsInputTerminalIdPost: p.input(operation168.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation168.POST(input, operationContext(ctx.request, input, "/sessions/[id]/terminals/[terminalId]/input")))),
    terminalsResizeTerminalIdPost: p.input(operation169.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation169.POST(input, operationContext(ctx.request, input, "/sessions/[id]/terminals/[terminalId]/resize")))),
    transferGet: p.input(operation170.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation170.GET(input, operationContext(ctx.request, input, "/sessions/[id]/transfer")))),
    transferPost: p.input(operation170.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation170.POST(input, operationContext(ctx.request, input, "/sessions/[id]/transfer")))),
    transferDeliverPost: p.input(operation171.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation171.POST(input, operationContext(ctx.request, input, "/sessions/[id]/transfer/deliver")))),
    transferFinishPost: p.input(operation172.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation172.POST(input, operationContext(ctx.request, input, "/sessions/[id]/transfer/finish")))),
    transferResumePost: p.input(operation173.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation173.POST(input, operationContext(ctx.request, input, "/sessions/[id]/transfer/resume")))),
    transferWorkingStateGet: p.input(operation174.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation174.GET(input, operationContext(ctx.request, input, "/sessions/[id]/transfer/working-state")))),
    treeGet: p.input(operation175.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation175.GET(input, operationContext(ctx.request, input, "/sessions/[id]/tree")))),
    unpinPost: p.input(operation176.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation176.POST(input, operationContext(ctx.request, input, "/sessions/[id]/unpin")))),
    unreadPost: p.input(operation177.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation177.POST(input, operationContext(ctx.request, input, "/sessions/[id]/unread")))),
    viewPost: p.input(operation178.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation178.POST(input, operationContext(ctx.request, input, "/sessions/[id]/view")))),
    wipGet: p.input(operation179.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation179.GET(input, operationContext(ctx.request, input, "/sessions/[id]/wip")))),
    wipPost: p.input(operation179.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation179.POST(input, operationContext(ctx.request, input, "/sessions/[id]/wip")))),
    diffStatsPost: p.input(operation180.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation180.POST(input, operationContext(ctx.request, input, "/sessions/diff-stats")))),
    historyList: p.input(operation181.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation181.GET(input, operationContext(ctx.request, input, "/sessions/history")))),
    needsReviewGet: p.input(operation182.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation182.GET(input, operationContext(ctx.request, input, "/sessions/needs-review")))),
    pendingInputList: p.input(operation183.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation183.GET(input, operationContext(ctx.request, input, "/sessions/pending-input")))),
    railGet: p.input(operation184.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation184.GET(input, operationContext(ctx.request, input, "/sessions/rail")))),
    searchGet: p.input(operation185.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation185.GET(input, operationContext(ctx.request, input, "/sessions/search")))),
    terminalsTerminalIdGet: p.input(operation249.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation249.GET(input, operationContext(ctx.request, input, "/sessions/[id]/terminals/[terminalId]")))),
    terminalsTerminalIdDelete: p.input(operation249.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation249.DELETE(input, operationContext(ctx.request, input, "/sessions/[id]/terminals/[terminalId]")))),
    openGet: p.input(operation251.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation251.GET(input, operationContext(ctx.request, input, "/sessions/[id]/open")))),
    openPost: p.input(operation251.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation251.POST(input, operationContext(ctx.request, input, "/sessions/[id]/open")))),
  }),
  settings: router({
    baseUrlGet: p.input(operation186.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation186.GET(input, operationContext(ctx.request, input, "/settings/base-url")))),
    baseUrlPatch: p.input(operation186.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation186.PATCH(input, operationContext(ctx.request, input, "/settings/base-url")))),
    baseUrlDelete: p.input(operation186.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation186.DELETE(input, operationContext(ctx.request, input, "/settings/base-url")))),
    baseUrlAutoTunnelPost: p.input(operation187.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation187.POST(input, operationContext(ctx.request, input, "/settings/base-url/auto-tunnel")))),
    baseUrlBeamdPost: p.input(operation188.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation188.POST(input, operationContext(ctx.request, input, "/settings/base-url/beamd")))),
    baseUrlTunnelNamePost: p.input(operation189.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation189.POST(input, operationContext(ctx.request, input, "/settings/base-url/tunnel-name")))),
  }),
  skills: router({
    list: p.input(operation190.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation190.GET(input, operationContext(ctx.request, input, "/skills")))),
    create: p.input(operation190.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation190.POST(input, operationContext(ctx.request, input, "/skills")))),
    RefGet: p.input(operation191.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation191.GET(input, operationContext(ctx.request, input, "/skills/[ref]")))),
    RefPut: p.input(operation191.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation191.PUT(input, operationContext(ctx.request, input, "/skills/[ref]")))),
    RefDelete: p.input(operation191.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation191.DELETE(input, operationContext(ctx.request, input, "/skills/[ref]")))),
    moveRefPost: p.input(operation192.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation192.POST(input, operationContext(ctx.request, input, "/skills/[ref]/move")))),
    commitRefPost: p.input(operation193.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation193.POST(input, operationContext(ctx.request, input, "/skills/[ref]/commit")))),
  }),
  stream: router({
    list: p.input(operation194.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation194.GET(input, operationContext(ctx.request, input, "/stream")))),
    create: p.input(operation194.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation194.POST(input, operationContext(ctx.request, input, "/stream")))),
    update: p.input(operation195.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation195.PATCH(input, operationContext(ctx.request, input, "/stream/[id]")))),
    dismissPost: p.input(operation196.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation196.POST(input, operationContext(ctx.request, input, "/stream/[id]/dismiss")))),
    reopenPost: p.input(operation197.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation197.POST(input, operationContext(ctx.request, input, "/stream/[id]/reopen")))),
    retryPost: p.input(operation198.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation198.POST(input, operationContext(ctx.request, input, "/stream/[id]/retry")))),
    autonomyGet: p.input(operation199.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation199.GET(input, operationContext(ctx.request, input, "/stream/autonomy")))),
    autonomyPut: p.input(operation199.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation199.PUT(input, operationContext(ctx.request, input, "/stream/autonomy")))),
    decisionsGet: p.input(operation200.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation200.GET(input, operationContext(ctx.request, input, "/stream/decisions")))),
    decisionsPost: p.input(operation200.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation200.POST(input, operationContext(ctx.request, input, "/stream/decisions")))),
    decisionsAcceptPost: p.input(operation201.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation201.POST(input, operationContext(ctx.request, input, "/stream/decisions/[id]/accept")))),
    decisionsCorrectPost: p.input(operation202.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation202.POST(input, operationContext(ctx.request, input, "/stream/decisions/[id]/correct")))),
    decisionsUndoPost: p.input(operation203.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation203.POST(input, operationContext(ctx.request, input, "/stream/decisions/[id]/undo")))),
    passesGet: p.input(operation204.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation204.GET(input, operationContext(ctx.request, input, "/stream/passes")))),
    passesSeenPost: p.input(operation205.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation205.POST(input, operationContext(ctx.request, input, "/stream/passes/[id]/seen")))),
    triagePost: p.input(operation206.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation206.POST(input, operationContext(ctx.request, input, "/stream/triage")))),
  }),
  system: router({
    hostInfoGet: p.input(operation207.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation207.GET(input, operationContext(ctx.request, input, "/system/host-info")))),
  }),
  triggers: router({
    list: p.input(operation209.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation209.GET(input, operationContext(ctx.request, input, "/triggers")))),
    create: p.input(operation209.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation209.POST(input, operationContext(ctx.request, input, "/triggers")))),
    get: p.input(operation210.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation210.GET(input, operationContext(ctx.request, input, "/triggers/[id]")))),
    update: p.input(operation210.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation210.PATCH(input, operationContext(ctx.request, input, "/triggers/[id]")))),
    delete: p.input(operation210.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation210.DELETE(input, operationContext(ctx.request, input, "/triggers/[id]")))),
    action: p.input(operation210.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation210.POST(input, operationContext(ctx.request, input, "/triggers/[id]")))),
  }),
  userState: router({
    list: p.input(operation211.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation211.GET(input, operationContext(ctx.request, input, "/user-state")))),
    update: p.input(operation211.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation211.PATCH(input, operationContext(ctx.request, input, "/user-state")))),
  }),
  workspaces: router({
    list: p.input(operation212.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation212.GET(input, operationContext(ctx.request, input, "/workspaces")))),
    create: p.input(operation212.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation212.POST(input, operationContext(ctx.request, input, "/workspaces")))),
    treeGet: p.input(operation213.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation213.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/tree")))),
    fileGet: p.input(operation214.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation214.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/file")))),
    filePut: p.input(operation214.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation214.PUT(input, operationContext(ctx.request, input, "/workspaces/[id]/file")))),
    fileDelete: p.input(operation214.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation214.DELETE(input, operationContext(ctx.request, input, "/workspaces/[id]/file")))),
    terminalsGet: p.input(operation215.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation215.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/terminals")))),
    terminalsPost: p.input(operation215.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation215.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/terminals")))),
    terminalsInputTerminalIdPost: p.input(operation216.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation216.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/terminals/[terminalId]/input")))),
    terminalsResizeTerminalIdPost: p.input(operation217.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation217.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/terminals/[terminalId]/resize")))),
    archivePost: p.input(operation218.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation218.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/archive")))),
    fileCreatePost: p.input(operation219.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation219.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/file/create")))),
    fileRenamePost: p.input(operation220.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation220.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/file/rename")))),
    dirPost: p.input(operation221.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation221.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/dir")))),
    dirDelete: p.input(operation221.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation221.DELETE(input, operationContext(ctx.request, input, "/workspaces/[id]/dir")))),
    fileResolveConflictPost: p.input(operation222.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation222.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/file/resolve-conflict")))),
    previewsGet: p.input(operation223.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation223.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/previews")))),
    get: p.input(operation224.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation224.GET(input, operationContext(ctx.request, input, "/workspaces/[id]")))),
    update: p.input(operation224.PATCHInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation224.PATCH(input, operationContext(ctx.request, input, "/workspaces/[id]")))),
    baseStatusGet: p.input(operation225.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation225.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/base-status")))),
    branchesGet: p.input(operation226.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation226.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/branches")))),
    chatGet: p.input(operation227.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation227.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/chat")))),
    chatNewPost: p.input(operation228.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation228.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/chat/new")))),
    chatHistoryGet: p.input(operation229.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation229.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/chat/history")))),
    chatResumePost: p.input(operation230.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation230.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/chat/resume")))),
    connectorScopesPut: p.input(operation231.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation231.PUT(input, operationContext(ctx.request, input, "/workspaces/[id]/connector-scopes")))),
    foldersGet: p.input(operation232.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation232.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/folders")))),
    foldersPost: p.input(operation232.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation232.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/folders")))),
    foldersDeviceIdPut: p.input(operation233.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation233.PUT(input, operationContext(ctx.request, input, "/workspaces/[id]/folders/[deviceId]")))),
    foldersDeviceIdDelete: p.input(operation233.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation233.DELETE(input, operationContext(ctx.request, input, "/workspaces/[id]/folders/[deviceId]")))),
    foldersLinkedDeviceIdReferenceFolderIdPut: p.input(operation234.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation234.PUT(input, operationContext(ctx.request, input, "/workspaces/[id]/folders/[deviceId]/linked/[referenceFolderId]")))),
    githubIssuesGet: p.input(operation235.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation235.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/github/issues")))),
    githubIssuesNumberGet: p.input(operation236.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation236.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/github/issues/[number]")))),
    githubPrsGet: p.input(operation237.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation237.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/github/prs")))),
    githubPrsNumberGet: p.input(operation238.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation238.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/github/prs/[number]")))),
    previewRestoreSetPost: p.input(operation239.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation239.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/preview/restore-set")))),
    pullBasePost: p.input(operation240.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation240.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/pull-base")))),
    referencedByGet: p.input(operation241.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation241.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/referenced-by")))),
    runOnGet: p.input(operation242.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation242.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/run-on")))),
    runOnPut: p.input(operation242.PUTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation242.PUT(input, operationContext(ctx.request, input, "/workspaces/[id]/run-on")))),
    sessionsGet: p.input(operation243.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation243.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/sessions")))),
    sessionsPost: p.input(operation243.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation243.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/sessions")))),
    setupsGet: p.input(operation244.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation244.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/setups")))),
    setupsPost: p.input(operation244.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation244.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/setups")))),
    tasksGet: p.input(operation245.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation245.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/tasks")))),
    detectStackPost: p.input(operation246.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation246.POST(input, operationContext(ctx.request, input, "/workspaces/detect-stack")))),
    previewFilesPost: p.input(operation247.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation247.POST(input, operationContext(ctx.request, input, "/workspaces/preview-files")))),
    reorderPost: p.input(operation248.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation248.POST(input, operationContext(ctx.request, input, "/workspaces/reorder")))),
    terminalsTerminalIdGet: p.input(operation250.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation250.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/terminals/[terminalId]")))),
    terminalsTerminalIdDelete: p.input(operation250.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation250.DELETE(input, operationContext(ctx.request, input, "/workspaces/[id]/terminals/[terminalId]")))),
    openGet: p.input(operation252.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation252.GET(input, operationContext(ctx.request, input, "/workspaces/[id]/open")))),
    openPost: p.input(operation252.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation252.POST(input, operationContext(ctx.request, input, "/workspaces/[id]/open")))),
  }),
  transcribe: router({
    status: p.input(operation253.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation253.GET(input, operationContext(ctx.request, input, "/transcribe")))),
  }),
  dev: router({
    scratch: p.input(operation254.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation254.GET(input, operationContext(ctx.request, input, "/dev/sessions/scratch")))),
    inject: p.input(operation255.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation255.POST(input, operationContext(ctx.request, input, "/dev/sessions/[id]/inject")))),
  }),
  desktop: router({
    cancelOAuth: p.input(operation256.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation256.POST(input, operationContext(ctx.request, input, "/desktop/oauth/cancel")))),
  }),
  home: router({
    info: p.input(operation257.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation257.GET(input, operationContext(ctx.request, input, "/home")))),
    terminalsGet: p.input(operation258.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation258.GET(input, operationContext(ctx.request, input, "/home/terminals")))),
    terminalsPost: p.input(operation258.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation258.POST(input, operationContext(ctx.request, input, "/home/terminals")))),
    terminalsTerminalIdGet: p.input(operation259.GETInput).query(async ({ input, ctx }) => unwrapOperation(await operation259.GET(input, operationContext(ctx.request, input, "/home/terminals/[terminalId]")))),
    terminalsTerminalIdDelete: p.input(operation259.DELETEInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation259.DELETE(input, operationContext(ctx.request, input, "/home/terminals/[terminalId]")))),
    terminalsInputTerminalIdPost: p.input(operation260.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation260.POST(input, operationContext(ctx.request, input, "/home/terminals/[terminalId]/input")))),
    terminalsResizeTerminalIdPost: p.input(operation261.POSTInput).mutation(async ({ input, ctx }) => unwrapOperation(await operation261.POST(input, operationContext(ctx.request, input, "/home/terminals/[terminalId]/resize")))),
  }),
};
