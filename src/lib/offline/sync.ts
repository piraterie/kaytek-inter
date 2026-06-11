// src/lib/offline/sync.ts
// Synchronise la file d'attente dès que la connexion est rétablie

import { supabase } from '@/lib/supabase/client'
import { getQueue, removeFromQueue, incrementRetry, type QueuedOp } from './queue'

const MAX_RETRIES = 3

async function processOp(op: QueuedOp): Promise<boolean> {
  try {
    switch (op.type) {

      case 'update_intervention_status':
      case 'update_intervention': {
        const { id, ...updates } = op.payload as { id: string; [key: string]: unknown }
        const table = op.table || 'interventions'
        const { error } = await supabase.from(table).update(updates).eq('id', id)
        if (error) throw error
        return true
      }

      case 'generic': {
        const { table, id, updates } = op.payload as {
          table: string
          id: string
          updates: Record<string, unknown>
        }
        const { error } = await supabase.from(table).update(updates).eq('id', id)
        if (error) throw error
        return true
      }

      default:
        // Opération inconnue — supprimer pour ne pas bloquer la file
        return true
    }
  } catch (e) {
    console.warn('[offline-sync] échec op', op.id, op.type, e)
    return false
  }
}

export interface SyncResult {
  synced: number
  failed: number
  skipped: number
}

export async function syncQueue(): Promise<SyncResult> {
  const queue = getQueue()
  let synced = 0
  let failed = 0
  let skipped = 0

  for (const op of queue) {
    if (op.retries >= MAX_RETRIES) {
      // Trop de tentatives — supprimer pour éviter un blocage permanent
      removeFromQueue(op.id)
      skipped++
      continue
    }

    const ok = await processOp(op)
    if (ok) {
      removeFromQueue(op.id)
      synced++
    } else {
      incrementRetry(op.id)
      failed++
    }
  }

  return { synced, failed, skipped }
}
