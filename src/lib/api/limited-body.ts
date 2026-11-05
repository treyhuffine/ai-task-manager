import { readLimitedRequestBody, RequestBodyTooLargeError } from '@/lib/webhooks/read-limited-body';

export { RequestBodyTooLargeError };
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
// Allow multipart headers and text fields without permitting unbounded parsing.
export const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 1024 * 1024;

export async function readLimitedFormData(request: Request): Promise<FormData> {
  // The proxy hands on only the first MAX_MULTIPART_BYTES of a larger body (`proxyClientMaxBodySize`
  // in next.config.ts), which no longer parses as a form. Its stated size says why it won't.
  if (Number(request.headers.get('content-length')) > MAX_MULTIPART_BYTES) throw new RequestBodyTooLargeError(MAX_FILE_BYTES);
  const body = await readLimitedRequestBody(request, MAX_MULTIPART_BYTES);
  const form = await new Response(body, { headers: {
    'content-type': request.headers.get('content-type') ?? '',
  } }).formData();
  for (const value of form.values()) {
    if (value instanceof Blob && value.size > MAX_FILE_BYTES) {
      throw new RequestBodyTooLargeError(MAX_FILE_BYTES);
    }
  }
  return form;
}

export async function readLimitedJson(request: Request, maxBytes = 1024 * 1024): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await readLimitedRequestBody(request, maxBytes)));
}
