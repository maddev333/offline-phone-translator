export async function initializeAuth() {
  return null;
}

export function getSignedInAccount() {
  return null;
}

export async function signIn() {
  throw new Error("Authentication has been removed from this offline translator project.");
}

export async function signOut() {
  return null;
}

export async function getAccessToken() {
  throw new Error("Authentication has been removed from this offline translator project.");
}
