// src/pages/googleAds/styles.ts
// Styles LOCAUX à la page Google Ads (préfixe .gads-, jamais de règle globale).
// Ils ne s'appuient que sur les tokens et classes existants de globals.css
// (card, pill, btn-*, --s0/--s1, --b0/--b1, --bl, --gn, --am, --rd, --rpill…)
// pour rester cohérents avec le thème clair/sombre de Kaytek Inter.
//
// Les points de rupture suivent la LARGEUR UTILE (requêtes de conteneur), pas
// celle de l'écran : le menu latéral occupe 280 px dès 768 px.
export const PAGE_CSS = `
.gads .card:hover{transform:none;box-shadow:var(--sh0);border-color:var(--b1)}

/* ── En-tête ── */
.gads-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.gads-account{font-size:12.5px;color:var(--t2);margin-top:2px}
.gads-status{display:flex;flex-wrap:wrap;gap:2px 12px;align-items:center;font-size:12px;color:var(--t2);margin:2px 0 16px}
.gads-status-main{display:flex;gap:8px;align-items:flex-start;min-width:0}
.gads-dot{flex:none;width:8px;height:8px;margin-top:5px;border-radius:50%;background:var(--gn);box-shadow:0 0 0 3px var(--gnBg)}
.gads-dot.stale{background:var(--am);box-shadow:0 0 0 3px var(--amBg)}
.gads-dot.none{background:var(--t3);box-shadow:0 0 0 3px var(--s1)}

/* ── Période ── */
.gads-period{padding:14px 16px;margin-bottom:26px;container-type:inline-size}
.gads-seg{display:flex;gap:2px;padding:4px;background:var(--s1);border-radius:var(--rpill)}
.gads-period .gads-seg{max-width:460px}
.gads-seg button{flex:1 1 auto;min-height:36px;min-width:0;padding:0 8px;border:0;border-radius:var(--rpill);background:transparent;font:inherit;font-size:13px;font-weight:600;color:var(--t2);cursor:pointer;white-space:nowrap;transition:background .15s,color .15s}
.gads-seg button:hover{color:var(--t0)}
.gads-seg button[aria-pressed="true"]{background:var(--bl);color:#fff;box-shadow:var(--sh0)}
.gads-seg button:focus-visible,.gads-chip:focus-visible,.gads-th-btn:focus-visible{outline:2px solid var(--bl);outline-offset:2px}
.gads-seg.compact{width:100%}
.gads-seg.compact button{min-height:32px;font-size:12.5px}
@media(min-width:641px){.gads-seg.compact{display:inline-flex;width:auto}.gads-seg.compact button{flex:0 0 auto;padding:0 12px}}
.gads-period-label{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:2px 14px;margin-top:12px}
.gads-period-main{font-size:15px;font-weight:800;letter-spacing:-.02em;color:var(--t0)}
.gads-period-cmp{font-size:12px;color:var(--t3)}
.gads-range{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
.gads-range label{display:flex;flex-direction:column;gap:4px;min-width:0;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--t3)}
.gads-range input{width:100%;min-width:0}

/* ── Alertes / infos ── */
.gads-alert{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;margin-bottom:16px;border-radius:var(--r1);font-size:12.5px;background:var(--rdBg);border:1px solid var(--rdBd);color:var(--rdTx)}
.gads-alert.warn{background:var(--amBg);border-color:var(--amBd);color:var(--amTx)}
.gads-alert.info{background:var(--blBg);border-color:var(--blBd);color:var(--blTx)}
.gads-alert svg{flex:none;margin-top:1px}
.gads-alert-title{font-weight:700}
.gads-alert-sub{margin-top:2px;opacity:.85}
.gads-alert details{margin-top:6px;font-size:11.5px;opacity:.85}
.gads-alert summary{cursor:pointer}

/* ── Sections ── */
.gads-section{margin-bottom:28px}
.gads-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 10px}
.gads-h2{font-size:15px;font-weight:800;letter-spacing:-.02em;color:var(--t0)}
.gads-aside{font-size:12px;color:var(--t3)}

/* ── Vue d'ensemble : KPI ── */
.gads-kpis-wrap{container-type:inline-size}
.gads-kpis{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.gads-kpi{padding:14px 14px 12px;display:flex;flex-direction:column;gap:6px;min-width:0}
.gads-kpi-label{display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--t2)}
.gads-kpi-value{font-size:22px;font-weight:800;letter-spacing:-.03em;line-height:1.1;color:var(--t0);font-variant-numeric:tabular-nums}
.gads-kpi-foot{min-height:22px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.gads-hero{grid-column:1/-1;padding:16px;display:grid;grid-template-columns:minmax(0,1fr);gap:6px}
.gads-hero .gads-kpi-value{font-size:30px}
.gads-hero-cap{font-size:12px;color:var(--t3)}
.gads-spark{height:56px;margin:4px -6px -8px;min-width:0}
.tone-blue{color:var(--bl)}.tone-green{color:var(--gn)}.tone-amber{color:var(--am)}
@container (min-width:560px){
  .gads-kpis{grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
  .gads-hero{grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);align-items:center;gap:16px}
  .gads-spark{height:72px;margin:0}
}
@container (min-width:880px){
  .gads-kpis{grid-template-columns:repeat(4,minmax(0,1fr))}
  .gads-hero{grid-column:span 2}
}
@media(max-width:640px){.gads-kpi-value{font-size:20px!important}.gads-hero .gads-kpi-value{font-size:28px!important}}

.gads-delta{display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:var(--rpill);font-size:11px;font-weight:700;white-space:nowrap;background:var(--s1);color:var(--t2)}
.gads-delta.up{background:var(--gnBg);color:var(--gnTx)}
.gads-delta.down{background:var(--rdBg);color:var(--rdTx)}

.gads-skel{display:inline-block;height:.9em;width:62%;border-radius:6px;background:linear-gradient(90deg,var(--s1),var(--s2),var(--s1));background-size:200% 100%;animation:gadsShimmer 1.3s ease-in-out infinite}
@keyframes gadsShimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@media(prefers-reduced-motion:reduce){.gads-skel{animation:none}}

/* ── Performances ── */
.gads-chart{padding:16px}
.gads-chart-top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}
.gads-headline{display:flex;align-items:baseline;flex-wrap:wrap;gap:4px 10px}
.gads-headline-value{font-size:26px;font-weight:800;letter-spacing:-.03em;line-height:1.1;color:var(--t0);font-variant-numeric:tabular-nums}
.gads-headline-label{font-size:12px;color:var(--t2)}
.gads-legend{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--t2);margin-top:8px}
.gads-legend i{display:inline-block;width:10px;height:10px;margin-right:6px;border-radius:3px;vertical-align:-1px}
.gads-chart-body{height:240px;margin:0 -6px}
.gads-empty{display:flex;flex-direction:column;align-items:center;gap:8px;padding:28px 12px;text-align:center;font-size:13px;color:var(--t2)}
.gads-tip{padding:8px 10px;border-radius:10px;background:var(--s0);border:1px solid var(--b1);box-shadow:var(--sh1);font-size:12px;color:var(--t0)}
.gads-tip-date{font-weight:700;margin-bottom:4px}
.gads-tip-row{display:flex;align-items:center;justify-content:space-between;gap:14px}
.gads-tip-row span:first-child{display:inline-flex;align-items:center;gap:6px;color:var(--t2)}
.gads-tip-row i{width:8px;height:8px;border-radius:50%;display:inline-block}

/* ── Campagnes ── */
.gads-camp{container-type:inline-size}
.gads-toolbar{display:flex;flex-direction:column;gap:10px;padding:14px 16px 4px}
.gads-toolbar-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.gads-search{position:relative;flex:1 1 220px;min-width:0}
.gads-search input{width:100%;padding-left:36px;border-radius:var(--rpill)}
.gads-search svg{position:absolute;left:13px;top:50%;transform:translateY(-50%);color:var(--t3);pointer-events:none}
.gads-chips{display:flex;flex-wrap:wrap;gap:6px}
.gads-chip{display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 13px;border:1px solid var(--b1);border-radius:var(--rpill);background:var(--s0);font:inherit;font-size:12.5px;font-weight:600;color:var(--t1);cursor:pointer;transition:background .15s,border-color .15s}
.gads-chip[aria-pressed="true"]{background:var(--blBg);border-color:var(--blBd);color:var(--blTx)}
.gads-chip .n{font-size:11px;font-weight:700;opacity:.7}
.gads-sortsel{display:none;width:auto;min-width:150px;flex:0 1 auto}
.gads-count{font-size:12px;color:var(--t3);padding:2px 2px 0}

.gads-table{display:block;overflow-x:auto;padding:6px 10px 4px}
.gads-table table{width:100%;border-collapse:collapse;font-size:13px}
.gads-table th{padding:10px 8px;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--t3);border-bottom:1px solid var(--b1)}
.gads-table td{padding:13px 8px;border-bottom:1px solid var(--b0)}
.gads-table td,.gads-table th{font-variant-numeric:tabular-nums}
.gads-table tbody tr:hover{background:var(--s1)}
.gads-table tfoot td{padding:13px 8px;font-weight:800;border-top:1px solid var(--b1);border-bottom:0}
.gads-th-btn{all:unset;display:inline-flex;align-items:center;gap:3px;padding:6px 2px;cursor:pointer;white-space:nowrap;font-weight:700;letter-spacing:inherit;text-transform:inherit}
.gads-th-btn:hover{color:var(--t1)}
.gads-num{text-align:right;white-space:nowrap}
.gads-strong{font-weight:800;color:var(--t0)}

.gads-cards{display:none;flex-direction:column;gap:10px;padding:12px}
.gads-card{padding:14px;border:1px solid var(--b1);border-radius:var(--r1);background:var(--s1)}
.gads-card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:10px}
.gads-card-name{font-size:14px;font-weight:700;line-height:1.3;color:var(--t0);word-break:break-word}
.gads-card-main,.gads-card-sub{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px 10px}
.gads-card-main{margin-top:12px;grid-template-columns:minmax(0,1.5fr) minmax(0,1fr) minmax(0,1fr)}
.gads-card-main .v{font-size:17px;font-weight:800;letter-spacing:-.02em;color:var(--t0);font-variant-numeric:tabular-nums}
.gads-card-sub{margin-top:12px;padding-top:12px;border-top:1px solid var(--b0)}
.gads-card-sub .v{font-size:13px;font-weight:700;color:var(--t1);font-variant-numeric:tabular-nums}
.gads-card .l{font-size:11px;font-weight:600;color:var(--t3);margin-bottom:1px}
.gads-bar{height:6px;margin-top:12px;border-radius:99px;background:var(--s2);overflow:hidden}
.gads-bar>i{display:block;height:100%;border-radius:99px;background:var(--bl)}
.gads-bar-cap{margin-top:5px;font-size:11px;color:var(--t3)}
.gads-foot-note{padding:4px 16px 14px;font-size:11px;color:var(--t3)}
@container (max-width:799px){
  .gads-table{display:none}
  .gads-cards{display:flex}
  .gads-sortsel{display:block}
}
@container (max-width:519px){
  .gads-search{flex-basis:100%}
  .gads-sortsel{flex:1 1 100%}
}

/* ── Tendances ── */
.gads-trends{container-type:inline-size}
.gads-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;padding:16px}
.gads-stat{min-width:0}
.gads-stat .l{font-size:12px;font-weight:600;color:var(--t2)}
.gads-stat .v{margin-top:3px;font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--t0);font-variant-numeric:tabular-nums}
.gads-stat .h{margin-top:1px;font-size:11.5px;color:var(--t3)}
@container (min-width:720px){.gads-stats{grid-template-columns:repeat(4,minmax(0,1fr))}}
.gads-vars{padding:4px 16px 8px;border-top:1px solid var(--b0)}
.gads-vars-title{padding:12px 0 2px;font-size:12px;font-weight:700;color:var(--t2)}
.gads-var{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--b0)}
.gads-var:first-of-type{border-top:0}
.gads-var-name{min-width:0;font-size:13px;font-weight:600;color:var(--t0);word-break:break-word}
.gads-var-sub{font-size:11.5px;color:var(--t3);font-weight:500}
.gads-var-end{display:flex;flex-direction:column;align-items:flex-end;gap:3px;flex:none}

/* ── Compte connecté ── */
.gads-kv{padding:4px 16px}
.gads-kv-row{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-top:1px solid var(--b0);font-size:13px}
.gads-kv-row:first-child{border-top:0}
.gads-kv-row .k{color:var(--t2);flex:none}
.gads-kv-row .val{font-weight:600;color:var(--t0);text-align:right;min-width:0;word-break:break-word}
.gads-account-foot{padding:4px 16px 16px}

@media(pointer:coarse){
  .gads .btn-sm,.gads-seg button,.gads-seg.compact button,.gads-chip{min-height:40px}
}

/* ── Période : libellés courts sur petites largeurs ── */
.gads-seg button .long{display:none}
@container (min-width:470px){.gads-period .gads-seg button .long{display:inline}.gads-period .gads-seg button .short{display:none}}
.gads-fresh{display:inline-flex;align-items:center;gap:5px}

/* ── Panneaux (Appareils, Démographie, Zones) ── */
.gads-panel{padding:14px 16px 16px;display:flex;flex-direction:column;gap:14px;container-type:inline-size}
.gads-panel .gads-seg.compact{max-width:100%}
.gads-panel-note{font-size:11.5px;line-height:1.45;color:var(--t3)}
.gads-subtitle{margin:2px 0 8px;font-size:12px;font-weight:700;color:var(--t2)}
.gads-subtitle-n{font-weight:500;color:var(--t3)}
.gads-bars{display:flex;flex-direction:column;gap:12px}
.gads-brow{min-width:0}
.gads-brow-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.gads-brow-label{min-width:0;font-size:13px;font-weight:600;color:var(--t0);word-break:break-word}
.gads-brow-hint{font-weight:500;color:var(--t3);font-size:11.5px}
.gads-brow-val{display:inline-flex;align-items:baseline;gap:8px;flex:none;font-size:13px;color:var(--t0);font-variant-numeric:tabular-nums}
.gads-brow-share{min-width:38px;text-align:right;font-size:11.5px;color:var(--t3)}
.gads-brow .gads-bar{margin-top:6px}
.gads-brow-extra{margin-top:4px;font-size:11px;color:var(--t3);font-variant-numeric:tabular-nums;word-break:break-word}

/* ── Carte SVG ── */
.gads-map{width:100%;max-width:720px;margin:0 auto;min-width:0;border:1px solid var(--b1);border-radius:var(--r1);overflow:hidden;background:var(--s1)}
.gads-map svg{max-width:100%;font-family:inherit}
.gads-map .gm-bg{fill:var(--s1)}
.gads-map .gm-france polygon{fill:var(--s2);stroke:var(--b1);stroke-width:1}
.gads-map .gm-grid line{stroke:var(--b1);stroke-width:.6;stroke-dasharray:2 4;opacity:.8}
.gads-map .gm-grid text{font-size:9.5px;fill:var(--t3)}
.gads-map .gm-zone circle:first-child{fill:rgba(59,130,246,.14);stroke:#3b82f6;stroke-width:1.8}
.gads-map .gm-zone.paused circle:first-child{fill:rgba(245,158,11,.10);stroke:#f59e0b;stroke-dasharray:5 4}
.gads-map .gm-center{fill:#3b82f6}
.gads-map .gm-zone.paused .gm-center{fill:#f59e0b}
.gads-map .gm-badge{fill:var(--s0);stroke:var(--b1);stroke-width:1}
.gads-map .gm-zone text{font-size:11px;font-weight:700;fill:var(--t0)}
.gads-map .gm-bubble{fill:rgba(59,130,246,.35);stroke:#3b82f6;stroke-width:1}
.gads-map .gm-scale line{stroke:var(--t1);stroke-width:1.5}
.gads-map .gm-scale text,.gads-map .gm-north text{font-size:10.5px;font-weight:600;fill:var(--t1)}
.gads-map .gm-north path{fill:var(--t1)}
.gads-map .gm-inset rect{fill:var(--s0);stroke:var(--b1)}
.gads-map .gm-inset polygon{fill:var(--s2);stroke:var(--t3);stroke-width:.6}
.gads-map .gm-inset circle{fill:#ef4444}
.gads-map-cap{padding:6px 10px;font-size:11px;color:var(--t3);border-top:1px solid var(--b1)}
.gads-zlist{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
.gads-zitem{display:flex;gap:10px;align-items:flex-start;padding:10px 12px;border:1px solid var(--b1);border-radius:var(--r1);background:var(--s1)}
.gads-zbadge{flex:none;display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:var(--s0);border:1px solid var(--b1);font-size:11px;font-weight:700;color:var(--t0)}
.gads-zbody{min-width:0;flex:1}
.gads-zhead{font-size:13px;color:var(--t0)}
.gads-zmuted{font-size:11.5px;color:var(--t3);font-variant-numeric:tabular-nums}
.gads-zcamps{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.gads-zcamp{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:12px;color:var(--t1)}
.gads-zcamp-name{min-width:0;word-break:break-word}

/* ── Compte connecté (repliable) ── */
.gads-acc-sum{list-style:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 16px;cursor:pointer;font-size:13px;color:var(--t0);min-height:44px}
.gads-acc-sum::-webkit-details-marker{display:none}
.gads-acc-sum:focus-visible{outline:2px solid var(--bl);outline-offset:-2px;border-radius:var(--r1)}
.gads-acc-line{min-width:0;font-weight:600;word-break:break-word}
.gads-acc-chev{flex:none;color:var(--t3);transition:transform .15s}
details[open]>.gads-acc-sum .gads-acc-chev{transform:rotate(180deg)}

/* ── Revue visuelle : lisibilité et compacité ── */
.gads-chart{container-type:inline-size}
.gads-chips.metric{display:flex}
@container (max-width:439px){
  .gads-chips.metric{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}
  .gads-chips.metric .gads-chip{justify-content:center}
}
.gads-chart-notes{display:flex;flex-direction:column;gap:3px;padding:8px 2px 0}
.gads-explain{padding:8px 12px;border-radius:var(--r1);background:var(--s1);border:1px solid var(--b0);color:var(--t2)}
.gads-explain strong{color:var(--t0)}
.gads-note-top{color:var(--t2)}
.gads-note-top strong{color:var(--t0)}
.gads-bars{max-width:760px}
.gads-brow-label{display:inline-flex;align-items:center;gap:8px}
.gads-brow-ico{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:var(--s1);flex:none}
.gads-stack{display:flex;height:12px;border-radius:99px;overflow:hidden;gap:2px;background:var(--s2);max-width:760px}
.gads-stack i{display:block;height:100%;min-width:4px}
.gads-split{display:flex;flex-direction:column;gap:12px}
@container (min-width:720px){.gads-split{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px;align-items:start}}
.gads-subcard{padding:12px 14px 14px;border:1px solid var(--b1);border-radius:var(--r1);background:var(--s1)}
.gads-subcard.alt{border-color:var(--puBd, var(--b1))}
.gads-subcard-title{margin-bottom:10px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--t2)}
.gads-subcard.alt .gads-subcard-title{color:var(--puTx, var(--t2))}
.gads-subcard .gads-bar{background:var(--s2)}
.gads-fold{border:1px solid var(--b1);border-radius:var(--r1);background:var(--s1)}
.gads-fold>summary{display:flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;cursor:pointer;font-size:13px;font-weight:700;color:var(--t1);list-style:none}
.gads-fold>summary::-webkit-details-marker{display:none}
.gads-fold>summary::after{content:"+";margin-left:auto;font-size:18px;font-weight:600;color:var(--t3)}
.gads-fold[open]>summary::after{content:"−"}
.gads-fold>*:not(summary){margin:0 14px 14px}
.gads-zlist{max-width:720px}
.gads-zchips{display:flex;flex-wrap:wrap;gap:6px;margin:0;padding:0;list-style:none}
.gads-zchips li{padding:5px 12px;border:1px solid var(--b1);border-radius:var(--rpill);background:var(--s1);font-size:12.5px;font-weight:600;color:var(--t1)}
.gads-zcamps+.gads-panel-note,.gads-zchips+.gads-panel-note{margin-top:10px}
.gads-card.idle{padding:12px 14px}
.gads-idle-cap{margin-top:4px;font-size:11.5px;color:var(--t3)}

/* Cibles tactiles : 40 px minimum sur mobile / tablette / écran tactile */
@media(pointer:coarse),(max-width:1024px){
  .gads .btn-sm,.gads .btn-primary,.gads .btn-secondary,.gads-seg button,.gads-seg.compact button,.gads-chip,.gads-th-btn,.gads-fold>summary,.gads-acc-sum{min-height:40px}
  .gads-search input,.gads-sortsel,.gads select,.gads input[type="date"]{min-height:40px}
}
`
