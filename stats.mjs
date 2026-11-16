// Résumé de log.csv : volume, bruit par recherche, alertes par catégorie.   Usage : node stats.mjs [log.csv]
import { readFileSync } from "node:fs";

const text = readFileSync(process.argv[2] ?? "log.csv", "utf8");
const rows = []; let f = "", row = [], q = false; // lecteur CSV minimal (champs entre guillemets)
for (let i = 0; i < text.length; i++) {
  const c = text[i];
  if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
  else if (c === '"') q = true;
  else if (c === ",") { row.push(f); f = ""; }
  else if (c === "\n") { row.push(f); rows.push(row); row = []; f = ""; }
  else f += c;
}
const [head, ...data] = rows;
const ads = data.filter((r) => r.length >= head.length - 1).map((r) => Object.fromEntries(head.map((k, i) => [k, r[i]])));
if (!ads.length) throw new Error("log.csv vide");

const med = (a, p = 0.5) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
const hours = Math.max(0.01, (new Date(ads.at(-1).traite_le) - new Date(ads[0].traite_le)) / 36e5);
const sent = ads.filter((a) => a.notifie === "true");
console.log(`Période : ${hours.toFixed(1)} h | lignes : ${ads.length} | articles uniques : ${new Set(ads.map((a) => a.lien)).size}`);
console.log(`Alertes Discord : ${sent.length} (${(sent.length / hours).toFixed(1)} par heure)\n`);

const group = (key) => Object.entries(ads.reduce((m, a) => ((m[key(a)] ??= []).push(a), m), {}));
console.log("Par recherche / source (part de bruit = lignes hors cible)");
for (const [k, g] of group((a) => a.source).sort((a, b) => b[1].length - a[1].length))
  console.log(`  ${k.padEnd(34)} ${String(g.length).padStart(4)} lignes | hors cible ${Math.round((100 * g.filter((a) => !a.categorie).length) / g.length)} % | alertes ${g.filter((a) => a.notifie === "true").length}`);

console.log("\nPar catégorie (articles dans la cible)");
for (const [k, g] of group((a) => a.categorie).filter(([k]) => k)) {
  const p = g.map((a) => Number(a.prix)), n = g.map((a) => Number(a.marge_nette));
  console.log(`  ${k.padEnd(22)} ${String(g.length).padStart(4)} | alertes ${String(g.filter((a) => a.notifie === "true").length).padStart(3)} | prix Q1/méd/Q3 ${med(p, 0.25)}/${med(p)}/${med(p, 0.75)} € | marge nette médiane ${med(n).toFixed(1)} €`);
}

console.log("\n10 meilleures alertes par marge nette");
for (const a of [...sent].sort((x, y) => y.marge_nette - x.marge_nette).slice(0, 10)) console.log(`  ${a.marge_nette.padStart(5)} € | ${a.prix} € | ${a.titre.slice(0, 60)} | ${a.categorie}`);
