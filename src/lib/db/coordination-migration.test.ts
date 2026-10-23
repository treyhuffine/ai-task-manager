import { expect, it } from 'vitest';
import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import path from 'node:path';
import { migrationTags, migrationsFolderUpTo } from '@/test/fixtures/migrations';
import { initDatabase } from './index';
import { runMigrations } from './migrate';

it('upgrades current main while retaining applied migration history, provider speed and usage preferences',()=>{
  const previous=migrationsFolderUpTo('0021_polite_spyke');
  const db=new Database(':memory:');
  try {
    sqliteVec.load(db);
    initDatabase(db,previous.folder);
    db.exec(`
      UPDATE user_state SET default_service_tier='fast',usage_warnings=0 WHERE id=1;
      INSERT INTO chat_sessions(rowid,id,harness,type,status,permission_mode,service_tier) VALUES (41,'main-chat','claude','content','active','ask','fast');
      INSERT INTO chat_events(rowid,id,session_id,source,role,content) VALUES (83,'main-event','main-chat','agent','assistant','Preserve model speed and quartz results');
      INSERT INTO agent_requests(id,source_session_id,source_address,target_address,target_session_id,request_key,kind,content,options,status,message_event_id) VALUES ('existing','main-chat','session:main-chat','agent:destination',NULL,'existing-key','delegation','Existing assignment','{"workspaceId":"destination","serviceTier":"fast"}','queued','future-event');
    `);
    const history=db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all();
    expect(runMigrations(db,path.resolve(__dirname,'../../../drizzle')).applied).toBe(migrationTags().length-history.length);
    expect(db.prepare('SELECT * FROM __drizzle_migrations ORDER BY id').all().slice(0,history.length)).toEqual(history);
    expect(db.prepare('SELECT default_service_tier,usage_warnings FROM user_state WHERE id=1').get()).toEqual({default_service_tier:'fast',usage_warnings:0});
    expect(db.prepare("SELECT rowid,service_tier FROM chat_sessions WHERE id='main-chat'").get()).toEqual({rowid:41,service_tier:'fast'});
    expect(db.prepare("SELECT rowid,content FROM chat_events WHERE id='main-event'").get()).toEqual({rowid:83,content:'Preserve model speed and quartz results'});
    expect(db.prepare("SELECT rowid FROM chat_events_fts WHERE chat_events_fts MATCH 'quartz'").pluck().all()).toEqual([83]);
    expect(JSON.parse((db.prepare("SELECT options FROM agent_coordination_requests WHERE id='existing'").get() as {options:string}).options)).toEqual({workspaceId:'destination',serviceTier:'fast'});
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check',{simple:true})).toBe('ok');
  } finally {db.close();previous.cleanup();}
});

it('preserves transcript rowids, historical payload bytes, message identities and owed work through the forward migration', () => {
  const previous = migrationsFolderUpTo('0019_groovy_may_parker');
  const db = new Database(':memory:');
  try {
    sqliteVec.load(db);
    initDatabase(db, previous.folder);
    db.exec(`
      INSERT INTO chat_sessions(rowid,id,harness,type,status,permission_mode) VALUES
      (13,'source','claude','orchestration','active','auto_all'),(29,'target','claude','orchestration','active','ask');
      INSERT INTO chat_events(rowid,id,session_id,role,source,content) VALUES
      (73,'original','source','user','user','Preserve quartz context'),
      (74,'fyi-event','target','user','user','Exact old FYI bytes'),
      (75,'answer-event','source','user','user','Exact old returned bytes');
      INSERT INTO runs(id,chat_session_id,harness,trigger_kind,status) VALUES ('run','target','claude','manual','completed');
      INSERT INTO agent_requests(id,source_session_id,source_address,target_address,target_session_id,request_key,kind,content,status,message_event_id,run_id) VALUES
      ('fyi','source','orchestrator','session:target','target','fyi-key','message','FYI','completed','fyi-event','run'),
      ('question','source','orchestrator','session:target','target','question-key','question','Question','completed','question-event','run'),
      ('historical-failed-request','source','orchestrator','session:target','target','historical-failed-key','question','Historical assignment','failed','historical-failed-input',NULL),
      ('pending','source','orchestrator','session:target',NULL,'pending-key','question','Still waiting','queued','pending-event',NULL);
      INSERT INTO agent_deliveries(id,request_id,dedupe_key,kind,content,event_id,status,delivered_to_session_id) VALUES
      ('outcome','question','outcome','response','Answer','answer-event','sent','source'),
      ('historical-failure','historical-failed-request','failure','failed','A historical Ri failure','historical-error-event','sent','source');
      INSERT INTO chat_events(id,session_id,role,source,content,sender_session_id) VALUES ('historical-error-event','source','user','user','Exact historical failure bytes','target');
    `);
    db.exec(`
      INSERT INTO devices(id,name,kind,status) VALUES ('laptop','Laptop','computer','active');
      INSERT INTO chat_events(id,session_id,role,source,content) VALUES ('remote-input','target','user','user','Frozen remote request');
      INSERT INTO runs(id,chat_session_id,harness,trigger_kind,status,source_event_id) VALUES ('remote-run','target','claude','manual','running','remote-input');
      INSERT INTO agent_requests(id,source_session_id,source_address,target_address,target_session_id,request_key,kind,content,status,message_event_id,run_id) VALUES
      ('remote','source','orchestrator','session:target','target','remote-key','question','Remote work','sent','remote-input','remote-run');
      INSERT INTO worker_commands(id,device_id,chat_session_id,kind,payload,actor,state,source_event_id) VALUES
      ('queued-command','laptop','target','send','{"runId":"remote-run","turnId":"device-turn"}','{"source":"ai","sessionId":"source"}','queued','remote-input');
      INSERT INTO agent_deliveries(id,request_id,dedupe_key,kind,content,event_id,status,delivered_to_session_id) VALUES
      ('ghost-update','question','blocked:old','blocked','Old update','ghost-event','pending','deleted-soft-destination');
      UPDATE agent_requests SET parent_request_id='fyi' WHERE id='pending';
      UPDATE chat_events SET attachments='[{"file_name":"kept.txt","original_name":"Kept.txt","mime_type":"text/plain","size":12,"uploaded_at":"2026-10-22T00:00:00Z"}]' WHERE id='fyi-event';
      INSERT INTO runs(id,chat_session_id,harness,trigger_kind,status,source_event_id) VALUES ('unaccepted-run','target','claude','manual','failed','failed-input'),('unaccepted-return-run','source','claude','manual','failed','failed-return');
      INSERT INTO agent_requests(id,source_session_id,source_address,target_address,target_session_id,request_key,kind,content,status,message_event_id,run_id) VALUES
      ('failed-request','source','orchestrator','session:target','target','failed-key','question','Failed before acceptance','failed','failed-input','unaccepted-run');
      INSERT INTO agent_deliveries(id,request_id,dedupe_key,kind,content,event_id,status,delivered_to_session_id) VALUES
      ('failed-return','question','blocked:failed-send','blocked','Not accepted by device','failed-return','sent','source');
      INSERT INTO worker_commands(id,device_id,chat_session_id,kind,payload,actor,state,source_event_id) VALUES
      ('failed-return-command','laptop','source','send','{"runId":"unaccepted-return-run","turnId":"failed-turn"}','{"source":"system"}','failed','failed-return');
      INSERT INTO chat_events(id,session_id,role,source,content) VALUES ('native-refused-input','target','user','user','Saved but never accepted');
      INSERT INTO runs(id,chat_session_id,harness,trigger_kind,status,source_event_id) VALUES ('native-refused-run','target','claude','manual','failed','native-refused-input');
      INSERT INTO agent_requests(id,source_session_id,source_address,target_address,target_session_id,request_key,kind,content,status,message_event_id,run_id) VALUES
      ('native-refused','source','orchestrator','session:target','target','native-refused-key','question','Native startup refused','sent','native-refused-input','native-refused-run');
      INSERT INTO worker_commands(id,device_id,chat_session_id,kind,payload,actor,state,source_event_id) VALUES
      ('native-refused-command','laptop','target','send','{"runId":"native-refused-run","turnId":"native-refused-turn"}','{"source":"system"}','failed','native-refused-input');
    `);
    const events = db.prepare('SELECT rowid,id,content FROM chat_events ORDER BY rowid').all();
    const chats = db.prepare('SELECT rowid,id FROM chat_sessions ORDER BY rowid').all();
    runMigrations(db, path.resolve(__dirname, '../../../drizzle'));
    expect(db.prepare('SELECT rowid,id,content FROM chat_events ORDER BY rowid').all()).toEqual(events);
    expect(db.prepare('SELECT rowid,id FROM chat_sessions ORDER BY rowid').all()).toEqual(chats);
    expect(db.prepare("SELECT rowid FROM chat_events_fts WHERE chat_events_fts MATCH 'quartz'").pluck().all()).toEqual([73]);
    const delivery = db.prepare('SELECT * FROM agent_coordination_deliveries WHERE id=?');
    const fyi = delivery.get('fyi') as { request_id: string | null; event_id: string; status: string; payload: string };
    expect(fyi).toMatchObject({ request_id: null, event_id: 'fyi-event', status: 'accepted' });
    expect(JSON.parse(fyi.payload)).toMatchObject({ version: 1, prompt: 'Exact old FYI bytes', content: 'FYI', requestKey: 'fyi-key' });
    expect(delivery.get('historical-failure')).toMatchObject({ kind: 'failed', sender_kind: 'system' });
    expect(db.prepare("SELECT role,source,sender_session_id,content,raw FROM chat_events WHERE id='historical-error-event'").get()).toMatchObject({ role: 'system', source: 'error', sender_session_id: null, content: 'Exact historical failure bytes', raw: expect.stringContaining('Ri failure') });
    const answer = delivery.get('outcome') as { payload: string };
    expect(answer).toMatchObject({ request_id: 'question', kind: 'answer', event_id: 'answer-event', status: 'accepted' });
    expect(JSON.parse(answer.payload).prompt).toBe('Exact old returned bytes');
    expect(delivery.get('pending')).toMatchObject({ status: 'queued', event_id: 'pending-event' });
    expect(db.prepare('SELECT id FROM agent_coordination_requests ORDER BY id').pluck().all()).toEqual(['failed-request', 'historical-failed-request', 'native-refused', 'pending', 'question', 'remote']);
    expect(db.prepare("SELECT status,run_id FROM agent_coordination_requests WHERE id='remote'").get()).toEqual({status:'queued',run_id:'remote-run'});
    expect(delivery.get('remote')).toMatchObject({status:'delivered',accepted_by_run_id:null});
    expect(delivery.get('failed-request')).toMatchObject({status:'failed',accepted_by_run_id:null});
    expect(delivery.get('failed-return')).toMatchObject({status:'failed',accepted_by_run_id:null});
    expect(delivery.get('native-refused')).toMatchObject({status:'delivered',accepted_by_run_id:null});
    expect(delivery.get('ghost-update')).toMatchObject({status:'failed',target_session_id:null,attempts:1});
    expect(db.prepare("SELECT parent_request_id FROM agent_coordination_requests WHERE id='pending'").pluck().get()).toBeNull();
    expect(JSON.parse(fyi.payload).attachments).toEqual([{fileName:'kept.txt',originalName:'Kept.txt',mimeType:'text/plain',size:12,uploadedAt:'2026-10-22T00:00:00Z'}]);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('agent_requests','agent_deliveries')").all()).toEqual([]);
    for (const table of ['user_state','workspaces','executions','chat_sessions']) {
      const columns = db.pragma(`table_info(${table})`) as Array<{name: string; dflt_value: unknown}>;
      expect(columns.find(column => column.name === 'agent_coordination_policy')?.dflt_value).toBe(null);
    }
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('integrity_check', { simple: true })).toBe('ok');
  } finally { db.close(); previous.cleanup(); }
});
