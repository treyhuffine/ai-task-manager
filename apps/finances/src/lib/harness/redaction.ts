import {processState} from '@/lib/process-state';
const secrets=processState<Set<string>>('redaction',()=>new Set());
export function registerHarnessRuntimeSecret(value:string,_source:string){void _source;if(value.length>8)secrets.add(value);}
export function redact(value:string){let text=value;for(const secret of secrets)text=text.replaceAll(secret,'[redacted]');return text;}
