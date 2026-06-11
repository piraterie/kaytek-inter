// src/lib/offline/queue.ts
// File d'attente localStorage pour les opérations hors ligne

const QUEUE_KEY = 'kaytek_offline_queue'

export interface QueuedOp {
  id: string
  type: 'update_intervention_status' | 'upload_signature' | 'update_intervention' | 'generic'
  table?: string
  payload: Record<string, unknown>
  created_at: string
  retries: number
  label?: string   // description lisible pour l'UI
}

export function getQueue(): QueuedOp[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]')
  } catch { return [] }
}

export function addToQueue(op: Omit<QueuedOp, 'id' | 'created_at' | 'retries'>): QueuedOp {
  const queue = getQueue()
  const newOp: QueuedOp = {
    ...op,
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    retries: 0,
  }
  queue.push(newOp)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  window.dispatchEvent(new Event('kaytek-queue-change'))
  return newOp
}

export function removeFromQueue(id: string) {
  const queue = getQueue().filter(op => op.id !== id)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
  window.dispatchEvent(new Event('kaytek-queue-change'))
}

export function incrementRetry(id: string) {
  const queue = getQueue().map(op => op.id === id ? { ...op, retries: op.retries + 1 } : op)
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue))
}

export function clearQueue() {
  localStorage.removeItem(QUEUE_KEY)
  window.dispatchEvent(new Event('kaytek-queue-change'))
}

export function getPendingCount(): number {
  return getQueue().length
}
