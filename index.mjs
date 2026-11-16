// Programme unique : alertes e-mail (Leboncoin, Facebook) + Vinted -> scoring -> Discord -> log.csv
//   node --env-file=.env index.mjs --dump   -> écrit sample.html (dernier mail non transactionnel), n'envoie rien
//   node --env-file=.env index.mjs --dry    -> affiche ce qui est lu et scoré, n'envoie rien
//   node --env-file=.env index.mjs          -> boucle réelle (Ctrl+C pour arrêter)
//   SOURCES=mail ou SOURCES=vinted dans le .env pour n'activer qu'une source (défaut : les deux)

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { notify } from "./discord.mjs";
import { evaluate } from "./score.mjs";

const { GMAIL_USER, GMAIL_APP_PASSWORD, ALERT_FROM = "leboncoin", POLL_SECONDS = "120" } = process.env;
const SOURCES = (process.env.SOURCES ?? "mail,vinted").split(",").map((s) => s.trim());
const DRY = process.argv.includes("--dry");
const DUMP = process.argv.includes("--dump");
const STATE_FILE = "state.json";
const LOG_FILE = "log.csv"; // une ligne par annonce lue : sert à mesurer l'efficacité du bot (ouvrable dans Sheets)
const LOG_HEADER = "traite_le,mail_du,source,titre,prix,categorie,qte,marge_nette,ok,notifie,lien,marque,taille,ville,livraison\n";
const csv = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
// Mails transactionnels (reçus, codes, messages, offres) : jamais traités comme des alertes
const SKIP = new RegExp(
  process.env.SKIP_SUBJECT ?? "reçu|code|confirmation|message|offre|welcome|bienvenue|commande|vérification|verification",
  "i",
);

const decode = (s) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));

// Parseur des cartes d'annonces des mails (Leboncoin). Chaque carte est un lien <a> dont le texte est lu BLOC PAR BLOC :
// titre, prix ("170 €" seul dans son bloc), ville + code postal, "Livraison possible". Lire par blocs évite de confondre
// une taille ("41 1/2") avec un prix, ou un code postal avec un prix. Si le prix n'est pas isolé, repli sur le texte à plat.
const PRICE_NODE = /^(\d{1,3}(?:[\s\u202f]\d{3})*|\d+)(?:[.,](\d{1,2}))?\s?€$/;
const PRICE_FLAT = /(?<![\w,.\/])(\d{1,3}(?:[\s\u202f]\d{3})*|\d+)(?:[.,](\d{1,2}))?\s?€/;
const toNumber = (m) => Number(m[1].replace(/[\s\u202f]/g, "") + (m[2] ? "." + m[2] : ""));
const clean = (t) => t.replace(/\s*(\.{3}|…)$/, "").trim();
const sizeOf = (t) => t?.match(/\b(?:taille|pointure|size|maat|talla|gr\.?|mt\.?|t\.?)\s?(\d{2}(?:[.,]5)?)\b/i)?.[1];

export function parseAlert(html) {
  const imgByHref = new Map(); // l'image peut être dans un autre lien que le texte, avec la même adresse
  const anchors = [...html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(([, href, inner]) => ({ href: decode(href), inner }));
  for (const { href, inner } of anchors) {
    const img = inner.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
    if (img && !imgByHref.has(href)) imgByHref.set(href, decode(img));
  }

  const ads = [];
  for (const { href, inner } of anchors) {
    const nodes = decode(inner.replace(/<[^>]+>/g, "\n")).split("\n").map((n) => n.replace(/\s+/g, " ").trim()).filter(Boolean);
    let title, price, city;
    const i = nodes.findIndex((n) => PRICE_NODE.test(n));
    if (i > 0) {
      price = toNumber(nodes[i].match(PRICE_NODE));
      title = clean(nodes.slice(0, i).join(" "));
      city = nodes.slice(i + 1).find((n) => /\d{5}\s*$/.test(n));
    } else {
      const text = nodes.join(" ");
      const m = text.match(PRICE_FLAT);
      if (!m || text.length < 8) continue;
      price = toNumber(m);
      title = clean(text.slice(0, m.index));
      city = text.slice(m.index + m[0].length).match(/([^\d]*\d{5})/)?.[1]?.trim();
    }
    if (!title || title.length < 3 || !(price >= 0)) continue;
    ads.push({ url: href, title, price, city, image: imgByHref.get(href), size: sizeOf(title), delivery: nodes.some((n) => /livraison possible/i.test(n)) });
  }
  // Sans voiture, une annonce sans "Livraison possible" est inaccessible (si le mail indique la livraison pour au moins une carte)
  const knowsDelivery = ads.some((a) => a.delivery);
  for (const a of ads) if (!knowsDelivery) a.delivery = undefined;
  return ads;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const saveState = (state) => writeFile(STATE_FILE, JSON.stringify(state));

async function loadState() {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return { lastUid: 0, seen: [], vinted: {} };
  }
}

// Traitement commun à toutes les sources : scoring, notification Discord, journal
// ad = { title, price, url, id?, brand?, city?, size?, delivery?, image?, detail? } ; meta = { from, date }
export async function handleAd(ad, meta, state) {
  const r = evaluate({ title: ad.title, price: ad.price, brand: ad.brand });
  const noDelivery = ad.delivery === false && process.env.REQUIRE_DELIVERY !== "0"; // sans voiture : livraison obligatoire
  const key = ad.id ?? `${ad.title}|${ad.price}`.toLowerCase();
  console.log(`  ${ad.price} € | ${ad.title.slice(0, 60)} -> ${r ? `${r.label}, net ${r.net} € ${r.ok ? (noDelivery ? "sans livraison" : "ALERTE") : "ignorée"}` : "hors cible"}${ad.city ? ` | ${ad.city}` : ""}`);
  if (DRY) return;

  let notified = false;
  if (r?.ok && !noDelivery && !state.seen.includes(key)) {
    const note = [`${r.label}${r.qty !== 1 ? ` x${r.qty}` : ""}`, r.high ? `revente ${r.resale}–${r.high} €` : `revente ${r.resale} €`, `coût d'achat tout compris ≈ ${r.cost} €`, ad.detail].filter(Boolean).join(" | ");
    await notify({ title: ad.title, url: ad.url, price: ad.price, resale: r.resale, net: r.net, note, image: ad.image, city: ad.city });
    state.seen = [...state.seen, key].slice(-2000);
    notified = true;
    await sleep(1000);
  }
  const row = [new Date().toISOString(), meta.date?.toISOString(), meta.from, ad.title, ad.price, r?.label, r?.qty, r?.net, r?.ok ?? false, notified, ad.url, ad.brand, ad.size, ad.city, ad.delivery];
  await appendFile(LOG_FILE, row.map(csv).join(",") + "\n");
}

async function pollMail(state) {
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
    logger: false,
  });
  await client.connect();
  const lock = await client.getMailboxLock("INBOX");
  try {
    const senders = ALERT_FROM.split(",").map((s) => s.trim()).filter(Boolean);
    const who = senders.length > 1 ? { or: senders.map((from) => ({ from })) } : { from: senders[0] };
    const found = await client.search({ since: new Date(Date.now() - 864e5), ...who }, { uid: true });

    // Normal : seulement les mails plus récents que le dernier traité. --dry/--dump : tout (24 h).
    const uids = (DRY || DUMP ? found : found.filter((u) => u > state.lastUid)).sort((a, b) => a - b);

    for (const uid of uids) {
      const { source } = await client.fetchOne(uid, { source: true }, { uid: true });
      const mail = await simpleParser(source);

      if (SKIP.test(mail.subject ?? "")) {
        console.log(`[${mail.from?.text}] "${mail.subject}" -> ignoré (mail transactionnel)`);
        continue;
      }

      if (DUMP) {
        await writeFile("sample.html", mail.html || mail.text || "");
        console.log(`sample.html écrit (de : ${mail.from?.text} | objet : ${mail.subject})`);
        continue;
      }

      const ads = parseAlert(mail.html || "");
      console.log(`[${mail.from?.text}] "${mail.subject}" -> ${ads.length} annonce(s) lue(s)`);
      for (const ad of ads) await handleAd(ad, { from: mail.from?.text, date: mail.date }, state);
    }

    if (!DRY && !DUMP && uids.length) {
      state.lastUid = Math.max(state.lastUid, ...uids);
      await saveState(state);
    }
  } finally {
    lock.release();
    await client.logout();
  }
}

async function mailLoop(state) {
  for (;;) {
    try {
      await pollMail(state);
    } catch (e) {
      console.error("[mail] Erreur :", e.message);
    }
    if (DRY || DUMP) return;
    await sleep(Number(POLL_SECONDS) * 1000);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const useMail = SOURCES.includes("mail");
  const useVinted = SOURCES.includes("vinted") && !DUMP;
  const required = [...(DRY || DUMP ? [] : ["DISCORD_WEBHOOK_URL"]), ...(useMail ? ["GMAIL_USER", "GMAIL_APP_PASSWORD"] : [])];
  for (const k of required) if (!process.env[k]) throw new Error(`${k} manquante (.env)`);

  const state = await loadState();
  state.vinted ??= {};
  if (!DRY && !DUMP) await writeFile(LOG_FILE, LOG_HEADER, { flag: "wx" }).catch(() => {});

  const tasks = [];
  if (useMail) tasks.push(mailLoop(state).catch((e) => console.error("[mail] arrêt :", e.message)));
  if (useVinted) {
    const { runVinted } = await import("./vinted.mjs");
    tasks.push(
      runVinted({
        state,
        dry: DRY,
        save: () => saveState(state),
        handle: (ad, meta) => handleAd(ad, meta, state),
      }).catch((e) => console.error("[vinted] arrêt :", e.message)),
    );
  }
  await Promise.all(tasks);
}
