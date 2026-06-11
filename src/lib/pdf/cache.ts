// Module-level cache — survit à la navigation React, reset au refresh de page
const _cache = new Map<string, Blob>()

export const pdfCache = {
  get: (docId: string): Blob | undefined => _cache.get(docId),
  set: (docId: string, blob: Blob): void => { _cache.set(docId, blob) },
  del: (docId: string): void => { _cache.delete(docId) },
}
