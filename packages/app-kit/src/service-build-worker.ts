/** Qualified service rebuilds run as owned, deadline-bound children in the draft. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {ContractValidator,AppError,type AppContract} from './contract.js';
import {packagePath,validateArtifact} from './build.js';
const packageDir=process.argv[2],workflows=JSON.parse(process.argv[3]??'[]') as AppContract['workflows'];
const manifest=new ContractValidator().manifest(JSON.parse(await fs.readFile(path.join(packageDir,'plugin.json'),'utf8'))),extension=manifest.extensions['com.ri'];
const rootRequire=createRequire(path.join(packageDir,'package.json'));
// Lifecycle scripts stay disabled. Reuse only the native addon already reviewed
// in this exact-target artifact, into copied draft dependencies, never Ri's graph.
const sourcePackage=path.join(packageDir,'dist/node_modules/better-sqlite3/package.json');
if(await fs.stat(sourcePackage).catch(()=>null)){
  const targetPackage=rootRequire.resolve('better-sqlite3/package.json'),source=JSON.parse(await fs.readFile(sourcePackage,'utf8')),target=JSON.parse(await fs.readFile(targetPackage,'utf8'));
  if(source.name!==target.name||source.version!==target.version)throw new AppError('unsupported','This native dependency changed. Supply a newly qualified service artifact');
  const from=path.join(path.dirname(sourcePackage),'build/Release/better_sqlite3.node'),to=path.join(path.dirname(targetPackage),'build/Release/better_sqlite3.node');
  await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(from,to);
  const Database=rootRequire('better-sqlite3');const probe=new Database(':memory:');probe.close();
}
const recipe=packagePath(packageDir,extension.build.recipe!),output=path.join(packageDir,extension.build.output!),compiled=path.join(packageDir,'.ri-build/recipe.mjs');
// The manifest reserves release/ for regenerable recipe output. Reject any
// existing symbolic-link ancestor before the recipe can write there.
await fs.mkdir(output,{recursive:true});packagePath(packageDir,extension.build.output!);
await fs.mkdir(path.dirname(compiled),{recursive:true});
const ownPackage=JSON.parse(await fs.readFile(path.join(packageDir,'package.json'),'utf8'));
await build({entryPoints:[recipe],outfile:compiled,bundle:true,format:'esm',platform:'node',target:'node26',external:Object.keys({...ownPackage.dependencies,...ownPackage.devDependencies}),banner:{js:'import {createRequire as __riRequire} from "node:module";const require=__riRequire(import.meta.url);'},logLevel:'warning'});
const code=await new Promise<number|null>((resolve,reject)=>{const child=spawn(process.execPath,[compiled],{cwd:packageDir,env:{...process.env,RI_APP_BUILD:'1'},stdio:['ignore','inherit','inherit'],shell:false});child.once('exit',resolve);child.once('error',reject);});
if(code!==0)throw new AppError('app_failed','The service build failed. Review its output and retry');
const artifact=validateArtifact(output);
if(artifact.manifest.name!==manifest.name||artifact.manifest.version!==manifest.version||JSON.stringify(artifact.manifest.extensions['com.ri'].runtime.target)!==JSON.stringify(extension.runtime.target))throw new AppError('conflict','The service recipe changed its identity or runtime target');
// Keep authored package workflows, including supporting resources, in the output.
if(workflows.length){
  await fs.rm(path.join(output,'skills'),{recursive:true,force:true});await fs.cp(path.join(packageDir,'skills'),path.join(output,'skills'),{recursive:true});
  const contract=JSON.parse(await fs.readFile(path.join(output,extension.contract),'utf8'));contract.workflows=workflows;await fs.writeFile(path.join(output,extension.contract),JSON.stringify(contract));
}
validateArtifact(output);
for(const name of ['dist','public','drizzle','skills',extension.contract,'plugin.json']){
  const source=packagePath(output,name),target=packagePath(packageDir,name);if(!await fs.stat(source).catch(()=>null))continue;
  await fs.rm(target,{recursive:true,force:true});await fs.cp(source,target,{recursive:true});
}
await fs.rm(path.join(packageDir,'.ri-build'),{recursive:true,force:true});await fs.rm(path.join(packageDir,'release'),{recursive:true,force:true});
