// src/lib/themes.ts — source unique de vérité pour les couleurs des modèles PDF/email

export interface Theme {
  primary: string
  accent: string
  accentDark: string
  label: string
}

export const THEMES: Record<number, Theme> = {
  0: { primary: '#1e3a5f', accent: '#e85d04', accentDark: '#c44b00', label: 'Navy · Orange' },
  1: { primary: '#1d4ed8', accent: '#f59e0b', accentDark: '#d97706', label: 'Bleu · Ambre' },
  2: { primary: '#111827', accent: '#6366f1', accentDark: '#4f46e5', label: 'Noir · Violet' },
  3: { primary: '#065f46', accent: '#10b981', accentDark: '#059669', label: 'Vert · Émeraude' },
  4: { primary: '#6d28d9', accent: '#f97316', accentDark: '#ea580c', label: 'Violet · Orange' },
}

export function getTheme(modeleId?: number | null): Theme {
  return THEMES[modeleId ?? 0] ?? THEMES[0]
}
