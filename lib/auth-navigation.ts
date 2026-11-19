export type AuthMode = "sign-in" | "sign-up";

export function privatePath(path: string) {
  return /^\/(dashboard|studio)(\/|$)/.test(path);
}

export function returnPath(input: unknown): string | undefined {
  if (
    typeof input !== "string" ||
    !input.startsWith("/") ||
    input.startsWith("//")
  )
    return;
  if (/[\\\u0000-\u0020\u007f]/.test(input)) return;
  const base = "https://draft.local";
  const url = new URL(input, base);
  if (url.origin === base && privatePath(url.pathname)) {
    return url.pathname + url.search + url.hash;
  }
}

export function authModalHref(mode: AuthMode, returnTo?: string) {
  const query = new URLSearchParams({ auth: mode });
  const target = returnPath(returnTo);
  if (target) query.set("returnTo", target);
  return "/?" + query.toString();
}
