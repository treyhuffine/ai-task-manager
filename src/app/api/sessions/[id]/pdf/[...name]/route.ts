/**
 * GET /api/sessions/:id/pdf/<file name>?path=…, the same as `../route.ts`.
 * The name is for the browser's PDF viewer, which titles a document by the
 * last part of its URL. The server reads only `path`.
 */
export { GET } from '../route';
