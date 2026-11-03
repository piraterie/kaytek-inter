// supabase/functions/_shared/auth-links.test.ts
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  resolveAppOrigin, buildAppAuthLink, buildActivationLinkForRecovery,
  normalizeEmail, isPlausibleEmail, maskEmail, renderAuthEmail,
} from './auth-links.ts'

const PROD = { APP_URL: 'https://app.kaytekinter.fr', SUPABASE_URL: 'https://dimrukkxehcwzemslwiz.supabase.co' }

Deno.test('resolveAppOrigin — origine de production acceptée', () => {
  assertEquals(resolveAppOrigin('https://app.kaytekinter.fr', PROD), 'https://app.kaytekinter.fr')
})

Deno.test('resolveAppOrigin — origine forgée remplacée par APP_URL (anti-vol de jeton)', () => {
  assertEquals(resolveAppOrigin('https://attaquant.example', PROD), 'https://app.kaytekinter.fr')
  assertEquals(resolveAppOrigin('javascript:alert(1)', PROD), 'https://app.kaytekinter.fr')
  assertEquals(resolveAppOrigin(null, PROD), 'https://app.kaytekinter.fr')
})

Deno.test('resolveAppOrigin — localhost refusé en production, accepté sur pile locale', () => {
  assertEquals(resolveAppOrigin('http://localhost:5173', PROD), 'https://app.kaytekinter.fr')
  assertEquals(resolveAppOrigin('http://localhost:5173', { SUPABASE_URL: 'http://127.0.0.1:54321' }), 'http://localhost:5173')
  assertEquals(resolveAppOrigin('http://kong:8000', { SUPABASE_URL: 'http://kong:8000' }), 'https://app.kaytekinter.fr')
})

Deno.test('resolveAppOrigin — APP_ALLOWED_ORIGINS', () => {
  const env = { ...PROD, APP_ALLOWED_ORIGINS: 'https://kaytek-inter.vercel.app, https://preview.example' }
  assertEquals(resolveAppOrigin('https://kaytek-inter.vercel.app', env), 'https://kaytek-inter.vercel.app')
  assertEquals(resolveAppOrigin('https://autre.example', env), 'https://app.kaytekinter.fr')
})

Deno.test('liens applicatifs — chemin et type corrects, jeton encodé', () => {
  assertEquals(buildAppAuthLink('https://app.kaytekinter.fr', 'invite', 'h a/sh'), 'https://app.kaytekinter.fr/activation?token_hash=h+a%2Fsh&type=invite')
  assertEquals(buildAppAuthLink('https://app.kaytekinter.fr', 'recovery', 'x'), 'https://app.kaytekinter.fr/reset-password?token_hash=x&type=recovery')
  assertEquals(buildActivationLinkForRecovery('https://app.kaytekinter.fr', 'x'), 'https://app.kaytekinter.fr/activation?token_hash=x&type=recovery')
})

Deno.test('adresses e-mail — normalisation, validation, masquage', () => {
  assertEquals(normalizeEmail('  Jean.Dupont@Exemple.FR '), 'jean.dupont@exemple.fr')
  assertEquals(normalizeEmail(42), '')
  assert(isPlausibleEmail('a_b@c.fr'))
  assert(!isPlausibleEmail('pas-une-adresse'))
  assertEquals(maskEmail('jean.dupont@exemple.fr'), 'je***@exemple.fr')
})

Deno.test('renderAuthEmail — nom échappé (pas d\'injection HTML)', () => {
  const html = renderAuthEmail({ greetingName: '<script>x</script>', intro: 'i', ctaLabel: 'Go', ctaUrl: 'https://a/?a=1&b=2', footnote: 'f' })
  assert(!html.includes('<script>'))
  assert(html.includes('&lt;script&gt;'))
  assert(html.includes('href="https://a/?a=1&amp;b=2"'))
})
