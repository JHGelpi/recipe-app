/**
 * Issue #72: auth-js sends email-code requests to GoTrue's /otp and /verify.
 * They go to the API's relay instead, which counts wrong codes per email;
 * every other auth call is left alone.
 */
export function codeRelayUrl(url: string, authUrl: string, apiUrl: string): string {
  for (const path of ['/otp', '/verify']) {
    const target = `${authUrl}${path}`;
    if (url === target || url.startsWith(`${target}?`)) {
      return `${apiUrl}/auth${path}${url.slice(target.length)}`;
    }
  }
  return url;
}
