// Comprueba con internet de verdad que encuentra bien los sitios: npx tsx scripts/geo-check.ts
import { geocode } from '../src/brain/net';

const cases: [string, RegExp][] = [
  ['Ronda', /^Ronda \(Málaga\)$/],
  ['Ronda, Málaga', /^Ronda \(Málaga\)$/],
  ['Ronda Málaga', /^Ronda \(Málaga\)$/],
  ['Ronda (Málaga)', /^Ronda \(Málaga\)$/],
  ['ronda', /^Ronda \(Málaga\)$/],
  ['Sevilla', /^Sevilla/],
  ['Alcalá de Guadaíra', /^Alcalá de Guadaíra/],
  ['Madrid', /^Madrid/],
];

(async () => {
  let fails = 0;
  for (const [q, want] of cases) {
    const p = await geocode(q);
    const ok = !!p && want.test(p.name);
    if (!ok) fails++;
    console.log(`${ok ? 'OK ' : 'MAL'}  «${q}» → ${p ? `${p.name} (${p.lat.toFixed(2)}, ${p.lon.toFixed(2)})` : 'nada'}`);
  }
  console.log(fails ? `\n${fails} han fallado.` : '\nTodo bien.');
  process.exit(fails ? 1 : 0);
})();
