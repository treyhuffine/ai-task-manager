import fs from "node:fs/promises";
import path from "node:path";
import { appKitToolchain } from './build.js';
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runtimeEnvironment } from "./runtime.js";
const exec = promisify(execFile);
/** Pin the kit as a portable tarball, never a dependency on Ri source paths. */
export async function createAppTemplate(
  dir: string,
  profile: "react" | "html" | "static",
  id: string,
) {
  const {packageDir: kit, pnpm} = appKitToolchain();
  await fs.mkdir(path.join(dir, "vendor"), { recursive: true });
  await fs.mkdir(path.join(dir, "src"));
  await exec(
    process.execPath,
    [pnpm, "pack", "--pack-destination", path.join(dir, "vendor")],
    {
      cwd: kit,
      env: runtimeEnvironment(process.execPath, dir),
      maxBuffer: 1024 * 1024,
    },
  );
  const packageId = `local-app-${id.slice(-8)}`,
    uri = `ui://${packageId}/main.html`;
  const manifest = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    name: packageId,
    version: "0.1.0",
    description: "A personal tracker built in Ri",
    license: "UNLICENSED",
    extensions: {
      "com.ri": {
        formatVersion: 1,
        displayName: "New app",
        hostApi: 1,
        suggestedSlug: `app-${id.slice(-8)}`,
        runtime:
          profile === "static"
            ? { kind: "static" }
            : {
                kind: "node",
                protocol: "ri-ipc-v1",
                entry: "dist/server.mjs",
                start: "on-demand",
                executionProfile: "trusted-native",
              },
        build: {
          adapter: "ri-esbuild-v1",
          lockfile: "pnpm-lock.yaml",
          executionProfile: "trusted-native",
        },
        ui: {
          resources: [{ uri, file: "dist/ui.html" }],
          entrypoints: ["global", "thread"],
          ...(profile === "static"
            ? {}
            : {
                resolveAction: "open_view",
                contextAction: "describe_view_context",
              }),
        },
        contract: "contract.json",
        requests: { integrations: [], riActions: [] },
        source: { kind: "personal" },
      },
    },
  };
  const tarball = (await fs.readdir(path.join(dir, "vendor"))).find((file) =>
    file.endsWith(".tgz"),
  )!;
  await fs.writeFile(
    path.join(dir, "plugin.json"),
    JSON.stringify(manifest, null, 2),
  );
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name: packageId,
        version: "0.1.0",
        private: true,
        type: "module",
        packageManager: "pnpm@10.33.0",
        dependencies: {
          "@ri/app-kit": `file:vendor/${tarball}`,
          zod: "3.25.76",
          react: "19.2.3",
          "react-dom": "19.2.3",
        },
      },
      null,
      2,
    ),
  );
  await fs.writeFile(
    path.join(dir, "README.md"),
    "# Personal app\n\nBuild a self-contained HTML view with the pinned app kit. App records stay in the host-provided data directory.\n",
  );
  await fs.writeFile(
    path.join(dir, "AGENTS.md"),
    "# App maintenance\n\nThis is owner-trusted native code. Edit this package only. Never read Home credentials or personal records. Use the pinned SDK for actions and SQLite. Definitions generate contract.json. Keep fixtures synthetic. Use the builder actions to build, preview, author bundled skills and request activation. Do not edit built output or Ri source. Never claim a preview has live account access.\n",
  );
  await fs.writeFile(
    path.join(dir, "src/ui.html"),
    '<!doctype html><html><head><meta charset="UTF-8"><style>body{font:16px system-ui;padding:24px;color:#202020;background:#fafafa}html[data-theme=dark] body{color:#eee;background:#151515}button,input{font:inherit;padding:8px}li{padding:8px}</style></head><body><main id="root"></main><!-- RI_APP_SCRIPT --></body></html>',
  );
  if (profile === "static") {
    await fs.writeFile(path.join(dir, "src/context.json"), JSON.stringify({[uri]:{type:"object",properties:{amount:{type:"number"}},required:["amount"],additionalProperties:false}}));
    await fs.writeFile(
      path.join(dir, "src/ui.tsx"),
      `import {connectApp} from '@ri/app-kit/app-client';(async()=>{const app=await connectApp();document.getElementById('root')!.innerHTML='<h1>Personal calculator</h1><input id="a" type="number" aria-label="Amount"><p id="result"></p>';document.getElementById('a')!.addEventListener('input',e=>{document.getElementById('result')!.textContent=String(Number((e.target as HTMLInputElement).value)*1.1);void app.context({amount:Number((e.target as HTMLInputElement).value)});});void app.context({amount:0});})();`,
    );
  } else {
    const actions = `import {z} from 'zod/v4';import {defineAction,type AppDefinition,openAppDatabase} from '@ri/app-kit/sdk';import path from 'node:path';import {createHash} from 'node:crypto';\nlet db:Awaited<ReturnType<typeof openAppDatabase>>;let instanceId='';export async function initialize(dataDir:string,id:string){instanceId=id;db=await openAppDatabase(path.join(dataDir,'records.db'));db.db.exec('CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)');}export function shutdown(){db.db.close();}\nconst record=z.object({id:z.string(),title:z.string(),createdAt:z.string(),updatedAt:z.string()}).strict();const rows=()=>db.db.prepare('SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM records ORDER BY created_at DESC LIMIT 100').all();const location=z.object({path:z.string(),query:z.record(z.string(),z.string())}).strict();\nconst cursorSchema=z.string().max(512).optional();const cursorRow=(cursor?:string)=>cursor?z.object({createdAt:z.string(),id:z.string().uuid()}).strict().parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'))):null;\nconst list=defineAction({name:'list_records',description:'List recent records',input:z.object({limit:z.number().int().min(1).max(100),cursor:cursorSchema}).strict(),output:z.object({records:z.array(record),nextCursor:z.string().nullable()}).strict(),audience:['user','agent','schedule'],effect:'read',retry:'read_safe',examples:[{input:{limit:20},output:{records:[],nextCursor:null}}],handler:({limit,cursor})=>{const after=cursorRow(cursor);const found=db.db.prepare('SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM records WHERE (? IS NULL OR (created_at,id)<(?,?)) ORDER BY created_at DESC,id DESC LIMIT ?').all(after?.createdAt??null,after?.createdAt??null,after?.id??null,limit+1) as {id:string;createdAt:string}[];const records=found.slice(0,limit),last=records.at(-1);return {records,nextCursor:found.length>limit&&last?Buffer.from(JSON.stringify({createdAt:last.createdAt,id:last.id})).toString('base64url'):null};}});\nconst add=defineAction({name:'add_record',description:'Add a record',input:z.object({id:z.string().uuid(),title:z.string().min(1).max(200)}).strict(),output:record,audience:['user','agent'],effect:'app_write',retry:'idempotent',examples:[{input:{id:'00000000-0000-4000-8000-000000000000',title:'Sample'},output:{id:'00000000-0000-4000-8000-000000000000',title:'Sample',createdAt:'2026-01-01',updatedAt:'2026-01-01'}}],handler:(input,ctx)=>db.mutate(ctx,'add_record',input,()=>{const time=new Date().toISOString();db.db.prepare('INSERT INTO records(id,title,created_at,updated_at) VALUES (?,?,?,?)').run(input.id,input.title,time,time);return {...input,createdAt:time,updatedAt:time};})});\nconst open=defineAction({name:'open_view',description:'Open the tracker',input:location,output:z.object({resource:z.literal(${JSON.stringify(uri)}),data:z.object({records:z.array(record)}).strict(),scope:z.object({actions:z.array(z.string())}).strict()}).strict(),audience:['user','agent'],effect:'read',retry:'read_safe',examples:[{input:{path:'/',query:{}},output:{resource:${JSON.stringify(uri)},data:{records:[]},scope:{actions:['list_records','add_record']}}}],handler:({path})=>{const id=path.startsWith('/records/')?path.slice(9):null;if(path!=='/'&&!id)throw new Error('Tracker view not found');const records=id?rows().filter((r:any)=>r.id===id):rows();if(id&&!records.length)throw new Error('Record not found');return {resource:${JSON.stringify(uri)},data:{records},scope:{actions:['list_records','add_record']}};}});\nconst context=defineAction({name:'describe_view_context',description:'Resolve the visible record selection',input:location.extend({state:z.object({selected:z.array(z.string()).max(50)}).strict()}),output:z.object({modelContent:z.string(),recordRefs:z.array(z.object({instanceId:z.string().uuid(),entityType:z.literal('record'),recordId:z.string()}).strict()),dataRevision:z.string()}).strict(),audience:['user','agent'],effect:'read',retry:'read_safe',examples:[{input:{path:'/',query:{},state:{selected:[]}},output:{modelContent:'No records selected',recordRefs:[],dataRevision:'0'}}],handler:({state})=>{const records=state.selected.map(id=>db.db.prepare('SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM records WHERE id=?').get(id));if(records.some(r=>!r))throw new Error('Selected record not found');return {modelContent:JSON.stringify(records),recordRefs:records.map((r:any)=>({instanceId,entityType:'record',recordId:r.id})),dataRevision:createHash('sha256').update(JSON.stringify(db.db.prepare('SELECT COUNT(*) AS count,MAX(updated_at) AS updatedAt FROM records').get())).digest('hex')};}});\nexport const definition:AppDefinition={packageId:${JSON.stringify(packageId)},version:'0.1.0',actions:[list,add,open,context],contexts:{${JSON.stringify(uri)}:z.object({selected:z.array(z.string()).max(50)}).strict()},entities:[{type:'record',idField:'id',titleField:'title',recordSchema:z.toJSONSchema(record),listAction:'list_records',openPath:'/records/{id}'}]};\n`;
    await fs.writeFile(path.join(dir, "src/actions.ts"), actions);
    await fs.writeFile(
      path.join(dir, "src/server.ts"),
      `import {serveApp} from '@ri/app-kit/sdk';import {definition,initialize,shutdown} from './actions';serveApp(definition,{initialize:boot=>initialize(boot.dataDir,boot.instanceId),shutdown});`,
    );
    const facade = `import {connectApp} from '@ri/app-kit/app-client';`;
    const html = `${facade}\nlet records:any[]=[],selected:string[]=[],draftTitle='';const app=await connectApp({result:data=>{records=(data as any).records??[];render();}});function render(){const root=document.getElementById('root')!;root.replaceChildren();const heading=document.createElement('h1');heading.textContent='Personal tracker';root.append(heading);const input=document.createElement('input');input.placeholder='Add a record';input.value=draftTitle;input.oninput=()=>{draftTitle=input.value};input.setAttribute('aria-label','Record title');const button=document.createElement('button');button.textContent='Add';button.onclick=async()=>{await app.call('add_record',{id:crypto.randomUUID(),title:input.value});draftTitle='';const result=await app.call('list_records',{limit:100});records=(result as any).records;render()};root.append(input,button);for(const r of records){const row=document.createElement('button');row.textContent=r.title;row.onclick=()=>{selected=selected.includes(r.id)?selected.filter(id=>id!==r.id):[...selected,r.id].slice(-50);void app.context({selected});};root.append(row);}void app.context({selected});}render();`;
    const react = `${facade}\nimport React from 'react';import {createRoot} from 'react-dom/client';let refresh:(data:any)=>void=()=>{};const app=await connectApp({result:data=>refresh(data)});function Tracker(){const [records,setRecords]=React.useState<any[]>([]);const [title,setTitle]=React.useState('');const [selected,setSelected]=React.useState<string[]>([]);refresh=data=>setRecords(data.records??[]);React.useEffect(()=>{void app.call('list_records',{limit:100}).then((data:any)=>setRecords(data.records));},[]);React.useEffect(()=>{void app.context({selected});},[selected,records]);return <><h1>Personal tracker</h1><input aria-label="Record title" value={title} onChange={e=>setTitle(e.target.value)}/><button onClick={async()=>{await app.call('add_record',{id:crypto.randomUUID(),title});setTitle('');const data:any=await app.call('list_records',{limit:100});setRecords(data.records)}}>Add</button><ul>{records.map(record=><li key={record.id}><button aria-pressed={selected.includes(record.id)} onClick={()=>setSelected(selected.includes(record.id)?selected.filter(id=>id!==record.id):[...selected,record.id].slice(-50))}>{record.title}</button></li>)}</ul></>}createRoot(document.getElementById('root')!).render(<Tracker/>);`;
    await fs.writeFile(
      path.join(dir, "src/ui.tsx"),
      profile === "react"
        ? react
            .replace("const app=await", "const app=await")
            .replace(
              "import {createRoot} from 'react-dom/client';",
              "import {createRoot} from 'react-dom/client';\n(async()=>{",
            ) + "\n})().catch(console.error);"
        : html.replace("let records:any[]=", "(async()=>{let records:any[]=") +
            "\n})().catch(console.error);",
    );
  }
  await exec(
    process.execPath,
    [pnpm, "install", "--lockfile-only", "--ignore-scripts"],
    {
      cwd: dir,
      env: runtimeEnvironment(process.execPath, dir),
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    },
  );
}
