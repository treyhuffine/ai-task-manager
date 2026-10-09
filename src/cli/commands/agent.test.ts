import {Command} from 'commander';
import {z} from 'zod';
import {afterEach,expect,it,vi} from 'vitest';
const dispatch=vi.hoisted(()=>vi.fn(async()=>({ok:true,result:{}})));
vi.mock('@/lib/orchestrator/registry',()=>({actions:[{name:'call_app_action',description:'Fixture',params:{instance_id:z.string(),action:z.string(),input:z.unknown()}}]}));
vi.mock('../lib/dispatch',()=>({dispatchAction:dispatch}));
import {registerAgentCommand} from './agent';
afterEach(()=>vi.restoreAllMocks());
it('keeps full-request input and a nested action input distinct',async()=>{
 vi.spyOn(process.stdout,'write').mockReturnValue(true);
 const command=registerAgentCommand(new Command());
 await command.parent!.parseAsync(['agent','call_app_action','--instance-id','fixture','--action','add','--action-input','{"amount":1}'],{from:'user'});
 expect(dispatch).toHaveBeenLastCalledWith('call_app_action',{instance_id:'fixture',action:'add',input:{amount:1}});
 await command.parent!.parseAsync(['agent','call_app_action','--input','{"instance_id":"fixture","action":"add","input":{"amount":2}}'],{from:'user'});
 expect(dispatch).toHaveBeenLastCalledWith('call_app_action',{instance_id:'fixture',action:'add',input:{amount:2}});
});
