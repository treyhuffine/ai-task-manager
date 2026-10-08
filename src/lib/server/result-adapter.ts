import type { ZodType } from 'zod/v4';
import { serveOperation, type OperationContext, type OperationSuccess, type OperationFailure } from './operation';

/** Preserve the external result API's validation envelope across shared transports. */
export function serveResultOperation<Input, Result extends OperationSuccess<unknown> | OperationFailure>(
  schema: ZodType<Input>,
  operation: (input: Input, context: OperationContext) => Promise<Result>,
) {
  return serveOperation(schema, operation, { validationStatus: 422, validationCode: 'invalid_params' });
}
