// Comprueba de verdad los servicios de internet de Bip (Wikipedia, tiempo, titulares).
// Uso:  npx tsx scripts/net-check.ts
import { cleanQuery, search, headlines, geocode, weather, sayWeather } from '../src/brain/net';
async function main() {
  for (const q of ['Bip, quién fue Cervantes', '¿Qué es la torre Eiffel?', 'busca el río Ebro', 'dime quién es Rosalía']) console.log(JSON.stringify(q), '→', JSON.stringify(cleanQuery(q)));
  const f = await search('Bip, quién fue Cervantes');
  console.log('BUSCA:', f?.source, '|', f?.title, '|', f?.text.slice(0, 160));
  const p = await geocode('Sevilla');
  console.log('LUGAR:', p);
  if (p) console.log('TIEMPO:', sayWeather(await weather(p)).join(' / '));
  const h = await headlines(3);
  console.log('NOTICIAS:', h.source, h.titles);
}
main();
