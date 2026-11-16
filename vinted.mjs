// Source Vinted : interroge les recherches de vinted-searches.json et passe les NOUVEAUX articles à handle().
// Utilise la bibliothèque @googlarz/vinted-client (pas d'API officielle : lecture de la page catalogue).
// ponytail: fréquence basse + pause en cas d'erreur (403/429) ; ni proxy ni navigateur furtif volontairement.

import { readFile } from "node:fs/promises";
import { VintedClient, opGetNewItems } from "@googlarz/vinted-client";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function pollSearch({ client, search, state, handle, dry = false, fetchNew = opGetNewItems }) {
  const country = search.country ?? "fr";
  const key = `${country}:${search.query}`;
  const cursor = state.vinted[key];

  const r = await fetchNew(client, {
    query: search.query,
    country,
    priceMax: search.priceMax,
    afterId: dry ? undefined : cursor,
  });

  // Première passe : on mémorise le plus récent article, sans alerter sur l'existant
  if (!dry && cursor === undefined) {
    if (r.latestId !== undefined) state.vinted[key] = r.latestId;
    console.log(`[vinted] ${key} : initialisé (${r.items.length} articles déjà en ligne ignorés)`);
    return;
  }
  if (r.truncated) console.warn(`[vinted] ${key} : plus d'articles neufs que la page n'en couvre, certains ont pu être manqués`);

  for (const i of r.items) {
    if (i.currency && i.currency !== "EUR") continue;
    const price = Number(String(i.price).replace(",", "."));
    await handle(
      {
        id: `vinted:${i.id}`,
        title: i.title,
        brand: i.brand, // la marque est souvent dans ce champ et non dans le titre
        size: i.size,
        image: i.photoUrl,
        price,
        url: i.url,
        detail: ["Vinted", i.size && `taille ${i.size}`, i.condition].filter(Boolean).join(" · "),
      },
      { from: `vinted ${key}`, date: new Date() },
    );
  }
  if (!dry && r.latestId !== undefined) state.vinted[key] = Math.max(cursor ?? 0, r.latestId);
}

// Charge vinted-searches.json (votre configuration), sinon vinted-searches.example.json (exemple fourni)
export async function loadSearches() {
  for (const file of ["vinted-searches.json", "vinted-searches.example.json"]) {
    try {
      const list = JSON.parse(await readFile(file, "utf8"));
      if (file.includes("example")) console.warn("[vinted] vinted-searches.json absent : fichier d'exemple utilisé (copiez-le pour le personnaliser)");
      return list;
    } catch (e) {
      if (e.code !== "ENOENT") throw new Error(`${file} invalide : ${e.message}`);
    }
  }
  throw new Error("Aucun fichier de recherches : copiez vinted-searches.example.json en vinted-searches.json");
}

export async function runVinted({ state, handle, save, dry = false }) {
  const searches = await loadSearches();
  const every = Math.max(60, Number(process.env.VINTED_POLL_SECONDS ?? 120)) * 1000; // jamais sous 60 s par recherche
  const gap = Math.max(5000, Math.floor(every / searches.length)); // requêtes espacées
  const client = new VintedClient({ rateLimitPerSec: 1 });
  state.vinted ??= {};
  let backoff = 0;

  do {
    for (const search of searches) {
      try {
        await pollSearch({ client, search, state, handle, dry });
        if (!dry) await save();
        backoff = 0;
      } catch (e) {
        backoff = Math.min(backoff ? backoff * 2 : 300_000, 1_800_000); // 5 min, 10, 20, puis 30 max
        console.error(`[vinted] ${search.query} : ${e?.message ?? e} -> pause ${backoff / 60000} min`);
        await sleep(backoff);
      }
      await sleep(gap);
    }
  } while (!dry);
}
