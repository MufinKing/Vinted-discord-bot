// Node 18+ (fetch intégré), aucune dépendance.
// Test : node --env-file=.env discord.mjs

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

export async function notify({ title, url, price, resale, net, note, city, image }) {
  if (!WEBHOOK) throw new Error("DISCORD_WEBHOOK_URL manquante");

  const fields = [
    { name: "Prix", value: `${price} €`, inline: true },
    { name: "Revente estimée", value: `${resale} €`, inline: true },
    { name: "Marge nette estimée", value: `${net} €`, inline: true },
  ];
  if (city) fields.push({ name: "Ville", value: city, inline: true });

  const res = await fetch(WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [{ title: title.slice(0, 256), url, description: note, fields, ...(/^https:\/\//.test(image ?? "") && { image: { url: image } }) }],
    }),
  });

  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
}

// Auto-test quand le fichier est exécuté directement
if (import.meta.url === `file://${process.argv[1]}`) {
  await notify({
    title: "Test : manette PS5 DualSense",
    url: "https://example.com",
    price: 15,
    resale: 40,
    net: 15.1,
    note: "Manette PS5 x1",
    city: "Rodez",
  });
  console.log("Message envoyé.");
}
