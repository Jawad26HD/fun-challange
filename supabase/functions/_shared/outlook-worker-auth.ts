import { OutlookError } from './outlook-security.ts';

export async function requireWorkerRequest(request: Request, secret: string): Promise<void> {
  if (request.method !== 'POST') throw new OutlookError('method_not_allowed', 405);
  if (request.headers.has('origin')) throw new OutlookError('origin_not_allowed', 403);
  if (secret.length < 32 || secret.length > 256 || /\s/u.test(secret)) throw new OutlookError('worker_not_configured', 503);
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ') || authorization.length > 300) throw new OutlookError('unauthorized', 401);
  const encoder = new TextEncoder();
  const [expected, actual] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
    crypto.subtle.digest('SHA-256', encoder.encode(authorization.slice(7))),
  ]);
  const left = new Uint8Array(expected);
  const right = new Uint8Array(actual);
  let mismatch = 0;
  for (let index = 0; index < left.length; index++) mismatch |= left[index]! ^ right[index]!;
  if (mismatch !== 0) throw new OutlookError('unauthorized', 401);
}
