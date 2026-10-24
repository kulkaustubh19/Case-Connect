const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const headers = { apikey: key, "Content-Type": "application/json" };

async function rememberFromHash() {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const accessToken = hash.get("access_token"), refreshToken = hash.get("refresh_token");
  if (!accessToken || !refreshToken || !url || !key) return;
  const response = await fetch(`${url}/auth/v1/user`, { headers: { ...headers, Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) return;
  const user = await response.json();
  localStorage.setItem("caseconnect_refresh_session", JSON.stringify({ refreshToken }));
  localStorage.setItem("caseconnect_session", JSON.stringify({ accessToken, user }));
}

async function restore() {
  if (!url || !key) return;
  await rememberFromHash();
  const currentRaw = localStorage.getItem("caseconnect_session");
  try {
    const current = currentRaw ? JSON.parse(currentRaw) : null;
    if (current?.accessToken) {
      const active = await fetch(`${url}/auth/v1/user`, { headers: { ...headers, Authorization: `Bearer ${current.accessToken}` } });
      if (active.ok) return;
    }
  } catch { /* Continue to the refresh-token path. */ }
  const raw = localStorage.getItem("caseconnect_refresh_session");
  if (!raw) return;
  try {
    const { refreshToken } = JSON.parse(raw);
    if (!refreshToken) return;
    const response = await fetch(`${url}/auth/v1/token?grant_type=refresh_token`, { method: "POST", headers, body: JSON.stringify({ refresh_token: refreshToken }) });
    if (!response.ok) throw new Error("Refresh token expired");
    const session = await response.json();
    localStorage.setItem("caseconnect_refresh_session", JSON.stringify({ refreshToken: session.refresh_token }));
    localStorage.setItem("caseconnect_session", JSON.stringify({ accessToken: session.access_token, user: session.user }));
  } catch {
    localStorage.removeItem("caseconnect_refresh_session");
    localStorage.removeItem("caseconnect_session");
  }
}

export const restoreSession = restore;
