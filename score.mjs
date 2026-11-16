// Évalue une annonce { title, price, brand } -> null (hors cible) ou { label, qty, resale, high, cost, net, ok }
// Test : node score.mjs
//
// MARGE NETTE = revente x (1 - cotisations - commission de vente)
//             - [prix + protection acheteur + port d'achat]      (ce que vous payez pour avoir l'article)
//             - emballage - port de vente éventuellement à votre charge

const COTISATIONS = 0.123;                                    // micro-entreprise achat-revente, sur le CA
const SELL_FEE = Number(process.env.SELL_FEE ?? 0);           // commission de vente : 0 (particulier), 0.05 si vendeur Vinted Pro
const SELL_SHIP_SHARE = Number(process.env.SELL_SHIP_SHARE ?? 0); // part du port de VENTE à votre charge : 0 = l'acheteur paie (cas par défaut)
const MIN_NET = Number(process.env.MIN_NET ?? 10);            // marge nette minimale pour alerter (seuil d'achat du plan : 15)
const MAX_PER_ITEM = Number(process.env.MAX_PER_ITEM ?? 60);  // plafond par article (20 % du capital de 300 €)
const PACK = 2;                                               // emballage par article vendu (carton, calage, ruban)
const buyFee = (p) => 0.7 + 0.05 * p;                         // Protection acheteur Vinted : 0,70 € + 5 % (Leboncoin : du même ordre)

// Chaussures (multilingue : Vinted mélange français, néerlandais, italien, espagnol, allemand)
const FOOT = /boots?\b|bottes?\b|bottines?\b|santiag|stival|botas?\b|botin|laars|laarz|stiefel|texan|campero|roper/;
const HAT = /chapeau|\bhats?\b|cowboyhat|hoed|\bhut\b|strohut|strohhut|straw|paille|sombrero|cappello|feutre|fedora|panama|trilby/;
const CLOTHES = /shirt|chemise|camisa|camicia|\bjack(?:e|et|ets)?\b|jkt|blazer|veste|manteau|\bcoat\b|laine|\bwool|cardigan|\bpull\b|poncho|couverture|blanket|jupe|skirt|\brobe\b|dress|pantalon|trousers/;
// Accessoires et autres articles qui ne sont PAS le produit visé (ceintures, porte-clés, vêtements, sacs, éperons...)
const ACCESSORY = /ceinture|cintura|riem\b|belt|cinturon|cinto|llavero|porte.?cles|keyring|sleutelhanger|chemise|camisa|camicia|shirt|blouse|vestido|\brobe\b|jeans?\b|pantalon|gorro|\bsacs?\b|\bbag\b|tote|pochette|\bmala\b|portefeuille|wallet|zuecos|clogs?\b|sandale|sandalia|chaussette|sporen|eperons?|spurs?|gilet|veste|manteau|echarpe|\bgants?\b|chaqueta|giacca|\bjack(?:e|et|ets)?\b|abrigo|\bcoat\b|blazer|\bpolo|\bpull\b|sweater|cardigan|camiseta|vaqueros|falda|\bshort\b|bolso|bolsa|traje|mochila|\bjupe\b|skirt|\bbd\b|\btome\b|livre\b|\bboek\b/;
// ponytail: vêtements/bottes/chapeaux enfants et défauts rédhibitoires, communs aux niches mode
const FASHION_NOT = /enfant|junior|kids|kinder|\bgirls?\b|\bboys?\b|ragazz|jongen|meisje|child|baby|toddler|bambin|nino|nina|bebe|fille|garcon|semelle decollee|dechir|troue|mites|a reparer|(?<!non |pas |sans )abime/;
const FOOT_NOT = new RegExp(`${FASHION_NOT.source}|${ACCESSORY.source}`);

// Barbour : seule la VESTE vaut la fourchette de revente. Pulls, polos, écharpes, bonnets, sacs, pin's, robes exclus.
const JACKET = /\bjack(?:e|et|ets)?\b|jacke|veste|manteau|\bcoat\b|parka|chaqueta|abrigo|giacca|giubbotto|steppjacke|\bjas\b|waxed|wachs|wax\b|huile|ciree?\b|beaufort|bedale|ashby|liddesdale|beadnell|eskdale|cranwell|puffer|doudoune|trench|blouson|quilt|matelass|trapunt|acolchad/;
const BARBOUR_NOT = new RegExp(`${FASHION_NOT.source}|pullover|\\bpull\\b|sweat|cardigan|maglione|maglia|\\btrui\\b|strick|knit|poloshirt|\\bpolo|shirt|chemise|echarpe|scarf|bonnet|muts|mutze|\\bcap\\b|casquette|\\bhat\\b|\\bhut\\b|\\bpin\\b|\\bfob\\b|tote|\\bbag\\b|\\bsacs?\\b|waistcoat|\\bvest\\b|vestido|\\brobe\\b|dress|jupe|\\bshort\\b|gilet|bodywarmer|sans manche|gants?\\b|gloves|socks|chaussette|bottes|wellington|boots|laarz|chaussures`);

// resale = prix de revente PRUDENT (premier quartile des prix demandés relevés, voir le bilan) ; high = haut de fourchette (affichage seulement).
// buyShip = port payé À L'ACHAT (Vinted : de 2,69 € à 12,85 € selon poids et mode) ; sellShip = port de vente, compté seulement si SELL_SHIP_SHARE > 0.
// maxBuy = achat maximum fixé par vous. models = prix par modèle quand les données le permettent.
// ORDRES DE GRANDEUR : à confirmer par vos propres ventes. Supprimez les lignes des niches que vous ne gardez pas.
export const CATEGORIES = [
  // --- Électronique : marges très faibles (revente d'une paire de Joy-Con ~30-40 €, dock ~20-30 €) ---
  { label: "Manette PS5", match: /dualsense|(manette.*(ps5|playstation ?5))|((ps5|playstation ?5).*manette)/, resale: 35, high: 55, buyShip: 4, sellShip: 5 },
  { label: "Switch Pro Controller", match: /pro controller|manette pro/, needs: /switch/, resale: 40, high: 50, buyShip: 4, sellShip: 5 },
  { label: "Joy-Con (paire)", match: /joy[- ]?con/, needs: /switch|nintendo/, pair: true, resale: 30, high: 40, buyShip: 4, sellShip: 5 },
  { label: "Dock Switch", match: /dock|station d.?accueil/, needs: /switch/, resale: 20, high: 30, buyShip: 5, sellShip: 5,
    models: [{ label: "édition limitée", match: /pokemon|pikachu|evoli|eevee|zelda|mario/, resale: 40, high: 50 }] },

  // --- Bottes western ---
  { label: "Sendra", match: /sendra/, not: FOOT_NOT, brandBypass: true, needs: FOOT, resale: 75, high: 150, maxBuy: 60, buyShip: 6.5, sellShip: 10 },
  { label: "Tony Lama / Justin", match: /tony ?-?lama|justin/, needs: FOOT, not: FOOT_NOT, resale: 80, high: 140, maxBuy: 55, buyShip: 6.5, sellShip: 10 },
  { label: "Durango / Ariat", match: /durango|ariat/, needs: FOOT, not: FOOT_NOT, resale: 55, high: 100, maxBuy: 45, buyShip: 6.5, sellShip: 10 },
  { label: "Lucchese", match: /lucchese/, needs: FOOT, not: FOOT_NOT, brandBypass: true, resale: 180, high: 300, maxBuy: 120, buyShip: 6.5, sellShip: 10 },

  // --- Vêtements et chapeaux de niche ---
  { label: "Pendleton", match: /pendleton/, needs: CLOTHES, not: FASHION_NOT, resale: 40, high: 90, maxBuy: 25, buyShip: 5.5, sellShip: 7 },
  { label: "Barbour (veste)", match: /barbour/, needs: JACKET, not: BARBOUR_NOT, resale: 60, high: 120, maxBuy: 50, buyShip: 7, sellShip: 9,
    models: [
      { label: "cirée (Bedale, Beaufort, Ashby...)", match: /bedale|beaufort|ashby|border\b|solway|northumbria|sylkoil|waxed|wachs|wax\b|ciree?\b|huile/, resale: 90, high: 200 },
      { label: "matelassée", match: /quilt|matelass|steppjacke|steppmantel|trapunt|acolchad|liddesdale|eskdale|puffer|doudoune/, resale: 50, high: 100 },
    ] },
  { label: "Stetson / Resistol", match: /stetson|resistol/, needs: HAT, not: new RegExp(`${FASHION_NOT.source}|casquette|\\bcap\\b|gants?|ceinture|parfum|cologne|eau de`), resale: 35, high: 80, maxBuy: 40, buyShip: 6.5, sellShip: 11,
    models: [
      { label: "feutre / cowboy", match: /feutre|felt|cowboy|western|fedora|trilby|resistol/, resale: 55, high: 120 },
      { label: "paille / été", match: /paille|straw|strohut|strohhut|panama|sommer|summer|\blin\b|linen|leinen/, resale: 30, high: 60 },
    ] },
];

// Exclus partout : autres consoles, Switch 2 (modèles et prix différents), défauts, accessoires, clones, copies
const EXCLUDE = new RegExp(
  [
    "ps4", "dualshock", "xbox", "steam", "switch ?2", "joy[- ]?con ?2",
    "pour pieces", "piece detachee", "\\bhs\\b", "hors service", "casse",
    "(?<!sans |pas de |aucun )drift",
    "coque", "housse", "skin", "grip", "etui", "support", "suporte", "soporte", "\\bstand\\b",
    "compatible", "replique", "generique", "stick seul", "cable seul", "copie", "imitation",
    "attachments?", "batterie", "battery", "gachette", "trigger", "volant", "wheel", "dragonne", "strap", "chargeur", "charger", "charging", "capuchon", "adaptateur", "adapter",
    "ladestation", "ladegerat", "carregador", "cargador", "station de charge", "refrigera", "cooling", "\\bcapas?\\b", "funda", "cover", "silicone", "thumb", "poignee",
    "(pour|for|per|voor|para|fur|fuer)\\s+(les\\s+)?(joy[- ]?cons?|dualsense|manettes?)",
    "(tipo|estilo|stile|style|type|genre|facon|simil\\w*|similar|like|look|inspir\\w*)\\s+(de\\s+)?(barbour|stetson|pendleton|sendra|lucchese|durango|ariat|justin|tony ?-?lama)",
    "(barbour|stetson|pendleton|sendra|lucchese|durango|ariat|justin)[- ]?(style|stil|sti\\b|look|like|inspir\\w*)",
  ].join("|"),
);

const norm = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const SINGLE = /\b(gauche|droit|droite|left|right|links|rechts|sinistro|destro|izquierdo|derecho)\b/;

// ponytail: détection de quantité heuristique ("lot de 3", "3 manettes", "x2"), toujours à vérifier à la main
const qty = (t) => {
  const m = t.match(/lot de (\d+)|(\d+) ?(?:manettes|joy[- ]?cons?|docks?)|\bx ?(\d+)\b/);
  return m ? Number(m[1] ?? m[2] ?? m[3]) : 1;
};

export function evaluate({ title, price, brand = "" }) {
  const t = norm(title), b = norm(brand), tb = `${t} ${b}`;
  if (EXCLUDE.test(t) || !(price > 0)) return null;

  const cat = CATEGORIES.find((c) => {
    const titleHit = c.match.test(t), brandHit = b.length > 0 && b.length <= 30 && c.match.test(b); // marque = nom court (pas un titre recopié)
    if (!titleHit && !brandHit) return false;
    if (c.needs && !c.needs.test(tb) && !(brandHit && c.brandBypass)) return false; // la marque saisie par le vendeur suffit pour les bottes
    return !c.not?.test(t);
  });
  if (!cat) return null;

  let n = qty(t);
  if (cat.pair && !/paire|pair\b/.test(t)) n = n > 1 ? Math.max(1, Math.floor(n / 2)) : SINGLE.test(t) ? 0.5 : n; // un seul Joy-Con = une demi-paire

  const model = cat.models?.find((m) => m.match.test(t));
  const eff = model ?? cat;
  const resale = n * eff.resale;
  const cost = price + buyFee(price) + cat.buyShip; // ce que vous payez réellement pour l'avoir
  const net = resale * (1 - COTISATIONS - SELL_FEE) - cost - n * (PACK + cat.sellShip * SELL_SHIP_SHARE);
  const cap = n * Math.min(cat.maxBuy ?? Infinity, MAX_PER_ITEM);
  return {
    label: model ? `${cat.label} · ${model.label}` : cat.label,
    qty: n,
    resale,
    high: eff.high ? n * eff.high : undefined,
    cost: Math.round(cost * 10) / 10,
    net: Math.round(net * 10) / 10,
    ok: net >= MIN_NET && price <= cap,
  };
}

// Auto-vérification
if (import.meta.url === `file://${process.argv[1]}`) {
  const assert = (await import("node:assert")).strict;
  const ok = (title, price, brand) => evaluate({ title, price, brand })?.ok;
  const none = (title, price = 10, brand) => assert.equal(evaluate({ title, price, brand }), null, title);

  // Calcul de marge (Sendra à 35 € : 75 x 0,877 - (35 + 2,45 + 6,5) - 2 = 19,8)
  assert.equal(evaluate({ title: "Bottes Sendra", price: 35 }).net, 19.8);
  assert.equal(ok("Bottes Sendra", 35), true);
  assert.equal(ok("Bottes Sendra", 45), false); // net 9,3 < 10 : le seuil d'alerte tombe vers 44 €

  // Électronique
  assert.equal(ok("Manette PS5 DualSense blanche", 8), true);
  assert.equal(ok("Manette PS5 DualSense blanche", 30), false);
  none("Manette PS4 dualshock"); none("Coque pour manette PS5", 5); none("Dock Nintendo Switch 2");
  none("Joy-Con switch avec drift"); none("Dock pour iPhone", 5);
  assert.equal(ok("Paire Joy-Con switch sans drift", 8), true);
  assert.equal(ok("Paire Joy-Con switch sans drift", 10), false); // 9,1 € nets : sous le seuil de 10 €
  assert.equal(ok("Joy con nintendo switch wireless Giallo Fluo Originali", 22), false); // marge trop faible
  assert.equal(evaluate({ title: "Joycon rouge droit nintendo switch", price: 10 }).qty, 0.5); // un seul Joy-Con
  assert.equal(evaluate({ title: "Lot de 3 manettes PS5", price: 60 }).qty, 3);
  assert.equal(evaluate({ title: "2 joy-con switch", price: 20 }).qty, 1);
  assert.equal(evaluate({ title: "Dock Nintendo Switch Pokemon Evoli", price: 20 }).resale, 40); // modèle
  none("Switch 1 joycon attachments", 7); none("Batterie neuf switch pour joycon", 3.5); none("Kinder joy con carta", 2);
  none("Manette pour joycon", 15);
  none("Suporte para Comando PS5 DualSense em Forma de Galinha", 13); none("SONY DualSense-Ladestation, PS5 Zubehör", 15);
  none("Capas joysticks Dualsense", 2); none("Coppia Cover in Silicone per Joy-Con Nintendo Switch", 12.9);

  // Bottes : la marque saisie par le vendeur suffit, sinon un mot "bottes" est exigé
  assert.equal(ok("Leren sendra laarzen", 30), true);
  assert.equal(ok("Sendra boots", 59), false);
  assert.equal(ok("Scarpe Cowboy", 30, "Sendra"), true);        // titre sans marque, marque dans le champ Vinted
  none("Sendra 117/165 (MEW) Reverse Holo", 1, "Pokémon");       // carte Pokémon, pas une botte
  none("Sendra Beige Leren Riem Maat 85", 30, "Sendra");
  none("Vestido Sendra", 4); none("Zuecos clásicos. Sendra", 10); none("Gorro cowboy unisex negro talla 58 Sendra", 29);
  none("Sendra- Llavero.", 20, "Sendra"); none("Chaqueta de cuero color negro talla M", 30, "Sendra");
  none("Bottes Sendra semelle décollée", 20); none("Bottes western Sendra enfant", 20);
  none("Cintura country western Tony Lama", 30); none("Ceinture Justin western vintage", 25, "Justin");
  none("Justin Bieber CD", 5); none("Ariat jean slim", 10);
  none("Jupe droite très chic", 5, "Justin"); none("Durango Tome 18 l'otage BD", 7, "Durango");
  none("Boek, het geheime leven van E. Robert Pendleton", 1.5, "Boek, het geheime leven van E. Robert Pendleton");
  assert.equal(ok("Justin Boots", 20), true);
  assert.equal(ok("Stivali pelle", 30, "Justin"), true);
  assert.equal(ok("Cowboystiefel Justin", 38), true);
  assert.equal(ok("Bottes Lucchese cuir exotique", 70), false);   // dépasse le plafond par article

  // Barbour : veste seulement, prix par modèle, imitations exclues
  assert.equal(evaluate({ title: "Barbour Wachsjacke Gr.44", price: 25 }).resale, 90);   // cirée
  assert.equal(evaluate({ title: "Barbour Steppjacke beige", price: 25 }).resale, 50);   // matelassée
  assert.equal(ok("Barbour Wachsjacke Gr.44", 25), true);
  assert.equal(ok("Barbour Steppjacke beige", 25), false);       // matelassée : marge insuffisante
  assert.equal(ok("Veste Barbour Beaufort", 40), true);
  for (const [t, p] of [["Poloshirt Barbour", 4.5], ["Pin Barbour Beacon Fob", 9], ["Barbour Wintermütze dunkelgrün", 13], ["Chaqueta tipo barbour", 15],
    ["Echarpe Barbour laine tartan", 25], ["Vestido Barbour", 27], ["Abrigo precioso estilo Barbour", 30], ["Pull Barbour pull sweater", 34.9],
    ["Giacca Bostonian Made USA Stile Barbour", 40], ["Veste imitation barbour", 25], ["Sac tote bag Barbour kaki", 44.99], ["Barbour Tweed Flat Cap Hat", 44],
    ["Doudoune sans manche Barbour", 50], ["Girls Barbour jacket", 13.5], ["Barbour-style jacket", 35], ["Giacca Simil Barbour", 30],
    ["Maglione Barbour originale taglia XL", 23], ["Ladies quilted Waistcoat Vest Barbour", 26],
    ["Vero Moda Steppjacke Braun L Kord Landhaus Cottage Barbour Stil", 39]]) none(t, p);

  // Chapeaux : le modèle change le prix de revente
  assert.equal(evaluate({ title: "Chapeau Stetson feutre", price: 20 }).resale, 55);
  assert.equal(ok("Chapeau Stetson feutre", 20), true);
  assert.equal(ok("Sombrero Stetson paille", 20), false);       // paille : revente trop faible
  assert.equal(ok("Wollen hoed Stetson", 25), false);           // chapeau générique 35 € : pas rentable à 25 €
  none("Kappe Stetson", 25); none("Stetson eau de toilette", 10); none("Casquette Stetson", 10); none("Stetson Western shirt", 15);

  // Pendleton : vêtement exigé (un livre n'est pas un vêtement)
  assert.equal(ok("Blazer Pendleton pure virgin wool", 8), true);
  none("Boek, het geheime leven van E. Robert Pendleton", 1.5);
  console.log("score.mjs : OK");
}
