export class OperationError extends Error{
 constructor(readonly status:number,readonly body:{error?:string;message:string}){super(body.message);}
}
export function isOperationError(e:unknown):e is OperationError{return e instanceof OperationError;}
