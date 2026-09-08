const STORAGE_KEY = 'kiln:source'
const STORAGE_EXAMPLE_KEY = 'kiln:example'
const HASH_PREFIX = '#code='

export function saveSource(source: string, exampleId: string | null): void {
  try {
    localStorage.setItem(STORAGE_KEY, source)
    if (exampleId) localStorage.setItem(STORAGE_EXAMPLE_KEY, exampleId)
    else localStorage.removeItem(STORAGE_EXAMPLE_KEY)
  } catch {
    // storage may be unavailable (private mode, quota) — autosave is best effort
  }
}

export function loadSaved(): { source: string; exampleId: string | null } | null {
  try {
    const source = localStorage.getItem(STORAGE_KEY)
    if (source === null) return null
    return { source, exampleId: localStorage.getItem(STORAGE_EXAMPLE_KEY) }
  } catch {
    return null
  }
}

/** base64url without padding, UTF-8 safe. */
export function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeBase64Url(encoded: string): string | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (encoded.length % 4)) % 4)
    const bin = atob(b64)
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  } catch {
    return null
  }
}

export function readHashSource(hash: string = typeof location !== 'undefined' ? location.hash : ''): string | null {
  if (!hash.startsWith(HASH_PREFIX)) return null
  return decodeBase64Url(hash.slice(HASH_PREFIX.length))
}

export function buildShareUrl(source: string): string {
  const base = `${location.origin}${location.pathname}`
  return `${base}${HASH_PREFIX}${encodeBase64Url(source)}`
}

export function clearHash(): void {
  if (location.hash) history.replaceState(null, '', location.pathname + location.search)
}
