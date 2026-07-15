// src/lib/buildInfo.ts
// Source unique pour l'identifiant de build — utilisé à la fois par le badge
// visible (PlanningPage) et par le garde anti-cache (buildGuard) afin que les
// deux restent toujours synchronisés à chaque montée de version.
export const APP_BUILD_VERSION = '1.0.7'
export const APP_BUILD_LABEL = `PLAYSTORE BUILD ${APP_BUILD_VERSION} - PLANNING NEW`
