/** Release-time staging only. Opening the catalog never runs package code. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {NativeNodeDriver} from '@ri/app-kit/runtime';
import {createAppTemplate,buildPackage,exportPackage,importPackage} from '@ri/app-kit/build';
import {catalogEntrySchema,archiveDigest} from '@/lib/local-apps/catalog';
import {getBundledLocalAppsCatalogDir} from '@/lib/config/paths';

async function main(){
const root=getBundledLocalAppsCatalogDir();await fs.mkdir(root,{recursive:true});
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'ri-app-catalog-'));
try{
  if(process.argv[2]==='--tracker'){
    const id=randomUUID(),dir=path.join(temporary,'package');await createAppTemplate(dir,'react',id);
    const original='local-app-'+id.slice(-8);
    for(const file of ['plugin.json','package.json','src/actions.ts','src/ui.tsx']){
      const full=path.join(dir,file);await fs.writeFile(full,(await fs.readFile(full,'utf8')).replaceAll(original,'ri-tracker'));
    }
    const manifest=JSON.parse(await fs.readFile(path.join(dir,'plugin.json'),'utf8'));
    manifest.extensions['com.ri'].displayName='Personal tracker';manifest.extensions['com.ri'].suggestedSlug='tracker';manifest.extensions['com.ri'].source={kind:'starter',version:'0.1.0'};
    await fs.writeFile(path.join(dir,'plugin.json'),JSON.stringify(manifest));
    const artifact=await buildPackage({packageDir:dir,driver:new NativeNodeDriver(process.execPath),workflows:[]});
    const file=path.join(root,'ri-tracker.tar.gz');await exportPackage(artifact,file);
    const entry=catalogEntrySchema.parse({formatVersion:1,packageId:'ri-tracker',version:'0.1.0',name:'Personal tracker',description:'A small editable tracker with its own persistent records.',source:'Ri maintained starter',license:'UNLICENSED',hostApi:1,runtime:'ri-ipc-v1',target:null,artifactDigest:artifact.digest,archiveDigest:await archiveDigest(file),capabilities:[],demo:{heading:'Fictional tracker',caption:'Example records only. No app runs when you open this demo.',columns:['Record'],rows:[['Read the local app guide'],['Plan a weekend walk'],['Try a new recipe']]}});
    await fs.writeFile(path.join(root,'ri-tracker.json'),JSON.stringify(entry,null,2));
  }else{
    const archive=process.argv[2],metadata=process.argv[3];if(!archive||!metadata)throw new Error('Supply an artifact archive and its catalog metadata, or --tracker');
    const entry=catalogEntrySchema.parse(JSON.parse(await fs.readFile(metadata,'utf8'))),artifact=await importPackage(archive,path.join(temporary,'package'));
    if(artifact.manifest.name!==entry.packageId||artifact.manifest.version!==entry.version||artifact.digest!==entry.artifactDigest||await archiveDigest(archive)!==entry.archiveDigest)throw new Error('Catalog artifact identity or digest differs');
    await fs.copyFile(archive,path.join(root,entry.packageId+'.tar.gz'));await fs.writeFile(path.join(root,entry.packageId+'.json'),JSON.stringify(entry,null,2));
  }
  process.stdout.write('Qualified catalog staged in '+root+'\n');
}finally{await fs.rm(temporary,{recursive:true,force:true});}
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
