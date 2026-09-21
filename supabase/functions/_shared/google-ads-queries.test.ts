// supabase/functions/_shared/google-ads-queries.test.ts
//
// Requêtes GAQL (formes validées sur l'API v25) et analyse des réponses :
// valeurs Google conservées, agrégation anti-doublon, lignes incomplètes
// ignorées (jamais complétées), aucune injection. Aucun réseau.
// Exécution : deno test --allow-env supabase/functions/_shared/google-ads-queries.test.ts
import { assertEquals, assert, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import {
  hourlyQuery, devicesQuery, ageQuery, genderQuery, geoQuery, zonesQuery, campaignsQuery, geoTargetsQuery,
  parseHourly, parseDevices, parseAge, parseGender, parseGeo, parseZones, parseCampaigns, parseGeoTargets,
  regionFromCanonicalName, readMetrics,
} from './google-ads-queries.ts'

const m = (impressions: string, clicks: string, costMicros: string, conversions = 0, conversionsValue = 0) =>
  ({ impressions, clicks, costMicros, conversions, conversionsValue })

// ── Requêtes ────────────────────────────────────────────────────────────────
Deno.test('requête horaire : campagne + date + heure + les 5 métriques, fenêtre de dates', () => {
  const q = hourlyQuery('2026-09-19', '2026-09-21')
  for (const f of ['campaign.id', 'campaign.name', 'segments.date', 'segments.hour', 'metrics.impressions', 'metrics.clicks', 'metrics.cost_micros', 'metrics.conversions', 'metrics.conversions_value', 'FROM campaign'])
    assert(q.includes(f), `champ manquant : ${f}`)
  assert(q.includes("BETWEEN '2026-09-19' AND '2026-09-21'"))
})

Deno.test('appareils au niveau COMPTE (FROM customer), âge = age_range_view, sexe = gender_view', () => {
  assert(devicesQuery('2026-09-01', '2026-09-21').includes('FROM customer'))
  assert(devicesQuery('2026-09-01', '2026-09-21').includes('segments.device'))
  assert(ageQuery('2026-09-01', '2026-09-21').includes('FROM age_range_view'))
  assert(ageQuery('2026-09-01', '2026-09-21').includes('ad_group_criterion.age_range.type'))
  assert(genderQuery('2026-09-01', '2026-09-21').includes('FROM gender_view'))
  assert(genderQuery('2026-09-01', '2026-09-21').includes('ad_group_criterion.gender.type'))
})

Deno.test('JAMAIS de croisement âge × sexe : aucune requête ne mêle les deux', () => {
  assert(!ageQuery('2026-09-01', '2026-09-21').includes('gender'))
  assert(!genderQuery('2026-09-01', '2026-09-21').includes('age_range'))
})

Deno.test('géographie : ville et code postal = deux requêtes distinctes, SANS campaign.status (HTTP 400 sinon)', () => {
  const city = geoQuery('city', '2026-08-01', '2026-09-21')
  const postal = geoQuery('postal_code', '2026-08-01', '2026-09-21')
  assert(city.includes('segments.geo_target_city') && !city.includes('postal_code'))
  assert(postal.includes('segments.geo_target_postal_code') && !postal.includes('geo_target_city'))
  for (const q of [city, postal]) {
    assert(q.includes('FROM geographic_view') && q.includes('geographic_view.location_type') && q.includes('segments.date'))
    assert(!q.includes('campaign.status'))
  }
})

Deno.test('zones ciblées : rayons et zones nommées POSITIFS, campagnes supprimées exclues', () => {
  const q = zonesQuery()
  for (const f of ['campaign_criterion.criterion_id', 'latitude_in_micro_degrees', 'longitude_in_micro_degrees', 'proximity.radius', 'radius_units', 'location.geo_target_constant', "type IN ('LOCATION','PROXIMITY')", 'negative = false', "campaign.status != 'REMOVED'"])
    assert(q.includes(f), `champ manquant : ${f}`)
})

Deno.test('campagnes : statut réel demandé', () => {
  assert(campaignsQuery().includes('campaign.status'))
})

Deno.test('injection : dates et identifiants de zone strictement validés', () => {
  assertThrows(() => hourlyQuery("2026-09-01' OR 1=1 --", '2026-09-21'))
  assertThrows(() => geoQuery('city', '2026-09-01', "2026-09-21'; DROP"))
  assertThrows(() => geoTargetsQuery(["geoTargetConstants/1' OR '1'='1"]))
  assertThrows(() => geoTargetsQuery(['customers/123']))
  assert(geoTargetsQuery(['geoTargetConstants/1006219', 'geoTargetConstants/9055221']).includes("'geoTargetConstants/1006219', 'geoTargetConstants/9055221'"))
})

// ── Métriques ───────────────────────────────────────────────────────────────
Deno.test('métriques : int64 en chaînes → nombres ; valeurs absentes ou invalides → 0 (jamais NaN)', () => {
  assertEquals(readMetrics(m('1964', '118', '982390000', 2.5, 40)), { impressions: 1964, clicks: 118, cost_micros: 982390000, conversions: 2.5, conversions_value: 40 })
  assertEquals(readMetrics(undefined), { impressions: 0, clicks: 0, cost_micros: 0, conversions: 0, conversions_value: 0 })
  assertEquals(readMetrics({ impressions: 'abc' }).impressions, 0)
})

// ── Horaire ─────────────────────────────────────────────────────────────────
Deno.test('horaire : lignes normalisées, heures 0-23 seulement, doublons additionnés', () => {
  const rows = [
    { campaign: { id: '11', name: 'A' }, segments: { date: '2026-09-21', hour: 8 }, metrics: m('10', '1', '1000000') },
    { campaign: { id: '11', name: 'A' }, segments: { date: '2026-09-21', hour: 8 }, metrics: m('5', '2', '500000') },   // doublon → additionné
    { campaign: { id: '11', name: 'A' }, segments: { date: '2026-09-21', hour: 0 }, metrics: m('1', '0', '0') },
    { campaign: { id: '11', name: 'A' }, segments: { date: '2026-09-21', hour: 24 }, metrics: m('9', '9', '9') },        // ignorée
    { campaign: { id: '11', name: 'A' }, segments: { date: '2026-09-21', hour: -1 }, metrics: m('9', '9', '9') },        // ignorée
    { campaign: { id: '11', name: 'A' }, segments: { date: '2026-09-21', hour: 7.5 }, metrics: m('9', '9', '9') },       // ignorée
    { campaign: { id: '11', name: 'A' }, segments: { date: 'pas-une-date', hour: 3 }, metrics: m('9', '9', '9') },       // ignorée
    { campaign: { name: 'sans id' }, segments: { date: '2026-09-21', hour: 3 }, metrics: m('9', '9', '9') },             // ignorée
  ]
  const out = parseHourly(rows)
  assertEquals(out.length, 2)
  const h8 = out.find((r) => r.hour === 8)!
  assertEquals([h8.impressions, h8.clicks, h8.cost_micros], [15, 3, 1500000])
  assertEquals(h8.campaign_id, '11')
  assert(out.every((r) => r.hour >= 0 && r.hour <= 23))
})

Deno.test('horaire : deux campagnes à la même heure restent séparées', () => {
  const out = parseHourly([
    { campaign: { id: '1', name: 'A' }, segments: { date: '2026-09-21', hour: 8 }, metrics: m('1', '0', '0') },
    { campaign: { id: '2', name: 'B' }, segments: { date: '2026-09-21', hour: 8 }, metrics: m('2', '0', '0') },
  ])
  assertEquals(out.length, 2)
})

// ── Appareils ───────────────────────────────────────────────────────────────
Deno.test('appareils : valeurs Google conservées (MOBILE, DESKTOP, TABLET, CONNECTED_TV…)', () => {
  const out = parseDevices([
    { segments: { date: '2026-09-20', device: 'MOBILE' }, metrics: m('100', '5', '2000000') },
    { segments: { date: '2026-09-20', device: 'DESKTOP' }, metrics: m('10', '1', '500000') },
    { segments: { date: '2026-09-20', device: 'CONNECTED_TV' }, metrics: m('1', '0', '0') },
    { segments: { date: '2026-09-20', device: 'MOBILE' }, metrics: m('50', '1', '100000') },
  ])
  assertEquals(out.map((r) => r.device).sort(), ['CONNECTED_TV', 'DESKTOP', 'MOBILE'])
  assertEquals(out.find((r) => r.device === 'MOBILE')!.impressions, 150)
})

// ── Démographie ─────────────────────────────────────────────────────────────
Deno.test('âge : « non déterminé » CONSERVÉ, additionné entre groupes d\'annonces', () => {
  const out = parseAge([
    { adGroupCriterion: { ageRange: { type: 'AGE_RANGE_UNDETERMINED' } }, segments: { date: '2026-09-20' }, metrics: m('837', '30', '208690000') },
    { adGroupCriterion: { ageRange: { type: 'AGE_RANGE_UNDETERMINED' } }, segments: { date: '2026-09-20' }, metrics: m('3', '0', '0') },
    { adGroupCriterion: { ageRange: { type: 'AGE_RANGE_25_34' } }, segments: { date: '2026-09-20' }, metrics: m('206', '17', '234510000') },
    { adGroupCriterion: { ageRange: { type: 'AGE_RANGE_65_UP' } }, segments: { date: '2026-09-20' }, metrics: m('267', '39', '285210000') },
  ])
  assertEquals(out.length, 3)
  assert(out.every((r) => r.dimension === 'age_range'))
  assertEquals(out.find((r) => r.value === 'AGE_RANGE_UNDETERMINED')!.impressions, 840)
})

Deno.test('sexe : FEMALE / MALE / UNDETERMINED conservés, dimension gender', () => {
  const out = parseGender([
    { adGroupCriterion: { gender: { type: 'UNDETERMINED' } }, segments: { date: '2026-09-20' }, metrics: m('843', '29', '196260000') },
    { adGroupCriterion: { gender: { type: 'FEMALE' } }, segments: { date: '2026-09-20' }, metrics: m('613', '44', '524940000') },
    { adGroupCriterion: { gender: { type: 'MALE' } }, segments: { date: '2026-09-20' }, metrics: m('508', '45', '261190000') },
  ])
  assertEquals(out.map((r) => r.value).sort(), ['FEMALE', 'MALE', 'UNDETERMINED'])
  assert(out.every((r) => r.dimension === 'gender'))
})

Deno.test('âge et sexe restent deux jeux SÉPARÉS : aucune ligne ne porte les deux', () => {
  const age = parseAge([{ adGroupCriterion: { ageRange: { type: 'AGE_RANGE_25_34' }, gender: { type: 'FEMALE' } }, segments: { date: '2026-09-20' }, metrics: m('1', '0', '0') }])
  assertEquals(Object.keys(age[0]).includes('gender'), false)
  assertEquals(age[0].dimension, 'age_range')
})

// ── Géographie ──────────────────────────────────────────────────────────────
Deno.test('géo ville : identifiant extrait, type de présence conservé, doublons additionnés', () => {
  const out = parseGeo('city', [
    { geographicView: { locationType: 'LOCATION_OF_PRESENCE' }, segments: { date: '2026-09-20', geoTargetCity: 'geoTargetConstants/1006219' }, metrics: m('100', '5', '1000000') },
    { geographicView: { locationType: 'LOCATION_OF_PRESENCE' }, segments: { date: '2026-09-20', geoTargetCity: 'geoTargetConstants/1006219' }, metrics: m('20', '1', '100000') },
    { geographicView: { locationType: 'AREA_OF_INTEREST' }, segments: { date: '2026-09-20', geoTargetCity: 'geoTargetConstants/1006219' }, metrics: m('7', '0', '0') },
  ])
  assertEquals(out.length, 2)
  const presence = out.find((r) => r.presence_type === 'LOCATION_OF_PRESENCE')!
  assertEquals([presence.geo_target_id, presence.impressions, presence.geo_level], [1006219, 120, 'city'])
})

Deno.test('géo code postal : niveau distinct ; lignes sans zone reconnue ignorées', () => {
  const out = parseGeo('postal_code', [
    { geographicView: { locationType: 'LOCATION_OF_PRESENCE' }, segments: { date: '2026-09-20', geoTargetPostalCode: 'geoTargetConstants/9055221' }, metrics: m('10', '1', '1') },
    { geographicView: { locationType: 'LOCATION_OF_PRESENCE' }, segments: { date: '2026-09-20' }, metrics: m('99', '9', '9') },
    { geographicView: { locationType: 'LOCATION_OF_PRESENCE' }, segments: { date: '2026-09-20', geoTargetPostalCode: 'n-importe-quoi' }, metrics: m('99', '9', '9') },
    // une ville dans une requête code postal n'est jamais prise pour un code postal
    { geographicView: { locationType: 'LOCATION_OF_PRESENCE' }, segments: { date: '2026-09-20', geoTargetCity: 'geoTargetConstants/1006219' }, metrics: m('99', '9', '9') },
  ])
  assertEquals(out.length, 1)
  assertEquals([out[0].geo_level, out[0].geo_target_id], ['postal_code', 9055221])
})

// ── Zones ciblées ───────────────────────────────────────────────────────────
const zoneRow = (criterion: Record<string, unknown>, campaign = { id: '24053118440', name: 'Baziege', status: 'ENABLED' }) => ({ campaign, campaignCriterion: criterion })

Deno.test('zone RAYON complète : latitude/longitude en degrés, distance et unité fournies par Google', () => {
  const { zones, skipped } = parseZones([zoneRow({
    criterionId: '2491013579702', type: 'PROXIMITY', negative: false,
    proximity: { geoPoint: { latitudeInMicroDegrees: 43579286, longitudeInMicroDegrees: 1439845 }, radius: 20, radiusUnits: 'KILOMETERS' },
  })])
  assertEquals(skipped, 0)
  assertEquals(zones.length, 1)
  assertEquals(zones[0], {
    campaign_id: '24053118440', campaign_name: 'Baziege', campaign_status: 'ENABLED', criterion_id: 2491013579702, zone_type: 'PROXIMITY',
    latitude: 43.579286, longitude: 1.439845, radius: 20, radius_unit: 'KILOMETERS', geo_target_id: null, label: null,
  })
})

Deno.test('AUCUNE coordonnée inventée : rayon sans latitude, longitude, distance ou unité valide → ignoré', () => {
  const bad = [
    { criterionId: '1', type: 'PROXIMITY', proximity: { geoPoint: { longitudeInMicroDegrees: 1439845 }, radius: 20, radiusUnits: 'KILOMETERS' } },
    { criterionId: '2', type: 'PROXIMITY', proximity: { geoPoint: { latitudeInMicroDegrees: 43579286 }, radius: 20, radiusUnits: 'KILOMETERS' } },
    { criterionId: '3', type: 'PROXIMITY', proximity: { geoPoint: { latitudeInMicroDegrees: 43579286, longitudeInMicroDegrees: 1439845 }, radiusUnits: 'KILOMETERS' } },
    { criterionId: '4', type: 'PROXIMITY', proximity: { geoPoint: { latitudeInMicroDegrees: 43579286, longitudeInMicroDegrees: 1439845 }, radius: 20 } },
    { criterionId: '5', type: 'PROXIMITY', proximity: { geoPoint: { latitudeInMicroDegrees: 43579286, longitudeInMicroDegrees: 1439845 }, radius: 20, radiusUnits: 'FURLONGS' } },
    { criterionId: '6', type: 'PROXIMITY', proximity: { geoPoint: { latitudeInMicroDegrees: 143579286, longitudeInMicroDegrees: 1439845 }, radius: 20, radiusUnits: 'KILOMETERS' } },
    { criterionId: '7', type: 'PROXIMITY', proximity: { radius: 20, radiusUnits: 'KILOMETERS' } },
    { criterionId: '8', type: 'PROXIMITY' },
  ]
  const { zones, skipped } = parseZones(bad.map((c) => zoneRow(c)))
  assertEquals(zones.length, 0)
  assertEquals(skipped, bad.length)
})

Deno.test('zone NOMMÉE : identifiant de zone conservé, jamais de coordonnées', () => {
  const { zones } = parseZones([zoneRow({ criterionId: '9', type: 'LOCATION', negative: false, location: { geoTargetConstant: 'geoTargetConstants/1006219' } }, { id: '77', name: 'Local', status: 'ENABLED' })])
  assertEquals(zones[0].zone_type, 'LOCATION')
  assertEquals([zones[0].geo_target_id, zones[0].latitude, zones[0].longitude, zones[0].radius], [1006219, null, null, null])
})

Deno.test('zones exclues (negative), types inconnus et zone nommée sans identifiant valide ignorés', () => {
  const { zones, skipped } = parseZones([
    zoneRow({ criterionId: '1', type: 'LOCATION', negative: true, location: { geoTargetConstant: 'geoTargetConstants/1' } }),
    zoneRow({ criterionId: '2', type: 'LANGUAGE', negative: false }),
    zoneRow({ criterionId: '3', type: 'LOCATION', negative: false, location: {} }),
    zoneRow({ criterionId: 'x', type: 'LOCATION', negative: false, location: { geoTargetConstant: 'geoTargetConstants/1' } }),
  ])
  assertEquals(zones.length, 0)
  assertEquals(skipped, 4)
})

// ── Campagnes / référentiel ─────────────────────────────────────────────────
Deno.test('campagnes : statut RÉEL conservé tel que Google le renvoie', () => {
  const out = parseCampaigns([
    { campaign: { id: '1', name: 'A', status: 'ENABLED', advertisingChannelType: 'SEARCH' } },
    { campaign: { id: '2', name: 'B', status: 'PAUSED' } },
    { campaign: { id: '3', name: 'C', status: 'REMOVED' } },
    { campaign: { id: '4', name: 'sans statut' } },
  ])
  assertEquals(out.map((c) => [c.campaign_id, c.status]), [['1', 'ENABLED'], ['2', 'PAUSED'], ['3', 'REMOVED']])
  assertEquals(out[0].advertising_channel_type, 'SEARCH')
})

Deno.test('région déduite du nom canonique, uniquement avec au moins 3 composantes', () => {
  assertEquals(regionFromCanonicalName('Toulouse,Occitanie,France'), 'Occitanie')
  assertEquals(regionFromCanonicalName('31000,Occitanie,France'), 'Occitanie')
  assertEquals(regionFromCanonicalName('Paris,Paris,Ile-de-France,France'), 'Ile-de-France')
  assertEquals(regionFromCanonicalName('Occitanie,France'), null)
  assertEquals(regionFromCanonicalName('France'), null)
  assertEquals(regionFromCanonicalName(null), null)
})

Deno.test('référentiel : identifiant, parent (région) et statut', () => {
  const out = parseGeoTargets([{ geoTargetConstant: { id: '1006219', name: 'Toulouse', canonicalName: 'Toulouse,Occitanie,France', targetType: 'City', countryCode: 'FR', parentGeoTarget: 'geoTargetConstants/20940', status: 'ENABLED' } }, { geoTargetConstant: { name: 'sans id' } }])
  assertEquals(out.length, 1)
  assertEquals(out[0], { geo_target_id: 1006219, name: 'Toulouse', canonical_name: 'Toulouse,Occitanie,France', target_type: 'City', country_code: 'FR', region_name: 'Occitanie', parent_geo_target_id: 20940, status: 'ENABLED' })
})
