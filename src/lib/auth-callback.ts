export function callbackCode(url: string, redirectTo: string): string | null {
  let callback: URL;
  let expected: URL;
  try { callback = new URL(url); expected = new URL(redirectTo); } catch { return null; }
  if (callback.protocol !== expected.protocol || callback.host !== expected.host || callback.pathname !== expected.pathname || callback.username || callback.password) return null;
  if (callback.searchParams.has('error')) throw new Error('Microsoft sign-in was not completed. Please try again.');
  const codes = callback.searchParams.getAll('code');
  if (callback.hash || codes.length !== 1 || !codes[0] || codes[0].length > 2048 || /\s/u.test(codes[0])) return null;
  return codes[0];
}

export function createAuthCallbackHandler(exchange: (code: string) => Promise<void>) {
  const exchanges = new Map<string, Promise<void>>();
  return async (url: string, redirectTo: string): Promise<boolean> => {
    const code = callbackCode(url, redirectTo);
    if (!code) return false;
    let pending = exchanges.get(code);
    if (!pending) {
      // The browser result and Linking event can deliver the same single-use PKCE code.
      pending = Promise.resolve().then(() => exchange(code));
      exchanges.set(code, pending);
      if (exchanges.size > 16) exchanges.delete(exchanges.keys().next().value!);
    }
    await pending;
    return true;
  };
}
