import './style.css';

const app = document.querySelector('#app');
const ROUND_SECONDS = 25;
const POINTS = [1, 1, 3, 3, 5];
// Empty in local development; set VITE_DATA_BASE_URL to the Cloudflare Worker URL on Vercel.
const DATA_BASE_URL = (import.meta.env.VITE_DATA_BASE_URL || '').replace(/\/$/, '');
const dataUrl = (file) => `${DATA_BASE_URL}/data/${file}`;
const $ = (s) => document.querySelector(s);
let manifest, round = 0, score = 0, seconds = ROUND_SECONDS, timer = null;
let currentCountry = null, currentPlaces = [], aliases = [], found = new Set(), running = false;
let roundResults = [];

app.innerHTML = `
  <main class="shell">
    <header class="topbar"><a class="wordmark" href="#" aria-label="GeoRush home"><span class="mark">G</span> GeoRush</a><span class="daily">DAILY CHALLENGE <i></i></span></header>
    <section class="intro" id="intro"><p class="eyebrow">THE DAILY GEOGRAPHY GAME</p><h1>Five countries.<br><em>125 seconds.</em></h1><p class="subhead">How well do you know the world?</p><button class="primary" id="start">Start today's game <span>→</span></button><p class="fine">Five rounds · 25 seconds each · No hints</p></section>
    <section class="game hidden" id="game">
      <div class="hud"><div><span class="hud-label">ROUND</span><strong id="round-num">1 / 5</strong></div><div class="timer-wrap"><span class="hud-label">TIME</span><strong id="timer">25</strong></div><div class="score-wrap"><span class="hud-label">SCORE</span><strong id="score">0</strong><span id="gain" class="gain"></span></div></div>
      <div class="progress"><span id="progress"></span></div>
      <div class="country-head"><p class="eyebrow" id="difficulty">ROUND 1 · WARM-UP</p><h2 id="country">Loading…</h2><p class="hint">Name as many cities and towns as you can.</p></div>
      <div class="globe-panel"><svg id="globe" viewBox="0 0 600 360" role="img" aria-label="Globe highlighting the current country"></svg><div class="globe-caption">THE WORLD, ONE COUNTRY AT A TIME</div></div>
      <div class="answer-row"><input id="guess" type="text" autocomplete="off" autocapitalize="words" placeholder="Type a city or town…" aria-label="Your locality guess"><button id="submit" class="guess-btn">Guess</button></div>
      <div class="feedback-row"><span id="feedback" aria-live="polite"> </span><span id="found-count">0 found</span></div>
      <div class="round-footer"><span id="round-points">+1 POINT EACH</span><span>ENTER ↵ TO SUBMIT</span></div>
    </section>
    <section class="end hidden" id="end"><p class="eyebrow">TODAY'S RESULT</p><h1>That's a wrap.</h1><div class="final-score"><strong id="final-score">0</strong><span>POINTS</span></div><div id="breakdown" class="breakdown"></div><button class="primary" id="again">Play again tomorrow <span>↗</span></button><p class="fine">Your score is stored only in this browser in v0.1.</p></section>
    <footer><span>GEORUSH · V0.1</span><span>Geographical data © <a href="https://www.geonames.org/" target="_blank" rel="noreferrer">GeoNames</a> · CC BY 4.0</span></footer>
  </main>`;

function normalize(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}
function editDistance(a, b, limit) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}
function makeAliasIndex(places) {
  const index = new Map();
  for (const p of places) {
    for (const raw of p.n) {
      const n = normalize(raw);
      if (n.length < 2) continue;
      if (!index.has(n)) index.set(n, []);
      index.get(n).push(p.id);
    }
  }
  return index;
}
function matchGuess(raw) {
  const q = normalize(raw);
  if (!q || q.length < 2) return null;
  const exact = aliases.get(q);
  if (exact) return exact.find(id => !found.has(id)) ? exact.find(id => !found.has(id)) : null;
  const limit = q.length >= 10 ? 2 : q.length >= 5 ? 1 : 0;
  if (!limit) return null;
  let best = null, bestDist = limit + 1, tied = false;
  for (const [name, ids] of aliases) {
    if (Math.abs(name.length - q.length) > limit) continue;
    const d = editDistance(q, name, limit);
    if (d < bestDist) {
      const available = ids.find(id => !found.has(id));
      if (available) { best = available; bestDist = d; tied = false; }
    } else if (d === bestDist && ids.some(id => !found.has(id))) tied = true;
  }
  return best && !tied ? best : null;
}
async function loadManifest() {
  const r = await fetch(dataUrl('manifest.json'));
  if (!r.ok) throw new Error('GeoNames data has not been built yet.');
  return r.json();
}
function seededIndex(seed, length) {
  let h = 2166136261;
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0) % length;
}
function chooseCountry(roundIndex) {
  const countries = manifest.countries.filter(c => c.count >= 5).sort((a,b) => b.count-a.count);
  const n = countries.length;
  const ranges = [ [0, .2], [.2, .4], [.4, .6], [.6, .8], [.8, 1] ];
  const [lo, hi] = ranges[roundIndex];
  let start = Math.floor(n * lo), end = Math.max(start + 1, Math.floor(n * hi));
  let pool = countries.slice(start, end);
  if (!pool.length) pool = countries.slice(-Math.min(10, n));
  const day = new Date().toISOString().slice(0,10);
  let idx = seededIndex(`${day}-round-${roundIndex}`, pool.length);
  let chosen = pool[idx];
  for (let tries=0; roundResults.some(x => x.iso === chosen.iso) && tries < pool.length; tries++) chosen = pool[(idx + tries + 1) % pool.length];
  return chosen;
}
function setText(sel, value) { $(sel).textContent = value; }
async function beginRound() {
  if (round >= 5) return finishGame();
  currentCountry = chooseCountry(round);
  const files = currentCountry.files || [currentCountry.file || `${currentCountry.iso}.json`];
  // Files are small enough for Cloudflare's static-assets limit.
  const groups = await Promise.all(files.map(async (file) => {
    const response = await fetch(dataUrl(file));
    if (!response.ok) throw new Error(`Could not load locality data for ${currentCountry.name} (${file}).`);
    return response.json();
  }));
  currentPlaces = groups.flat();
  aliases = makeAliasIndex(currentPlaces);
  found = new Set(); seconds = ROUND_SECONDS; running = true;
  setText('#round-num', `${round + 1} / 5`);
  setText('#timer', seconds);
  setText('#country', currentCountry.name);
  setText('#difficulty', `ROUND ${round + 1} · ${['WARM-UP','GETTING WARM','MIDPOINT','CHALLENGE','FINAL ROUND'][round]}`);
  setText('#round-points', `+${POINTS[round]} POINT${POINTS[round] > 1 ? 'S' : ''} EACH`);
  setText('#found-count', '0 found'); setText('#feedback', ' ');
  $('#guess').value = ''; $('#guess').disabled = false; $('#submit').disabled = false;
  $('#progress').style.width = `${round * 20}%`;
  drawGlobe(currentCountry.numeric);
  $('#guess').focus();
  clearInterval(timer);
  timer = setInterval(() => {
    seconds--; setText('#timer', seconds);
    if (seconds <= 5) $('#timer').classList.add('urgent');
    if (seconds <= 0) endRound();
  }, 1000);
}
function submitGuess() {
  if (!running) return;
  const input = $('#guess'); const value = input.value.trim();
  if (!value) return;
  const id = matchGuess(value);
  if (id) {
    found.add(id); score += POINTS[round];
    setText('#score', score); setText('#found-count', `${found.size} found`);
    setText('#feedback', `✓ ${value}`); $('#feedback').className = 'good';
    setText('#gain', `+${POINTS[round]}`); $('#gain').classList.remove('pop'); void $('#gain').offsetWidth; $('#gain').classList.add('pop');
    input.value = '';
  } else {
    setText('#feedback', 'Not found — try another spelling'); $('#feedback').className = 'neutral';
    input.select();
  }
}
function endRound() {
  if (!running) return;
  running = false; clearInterval(timer); $('#timer').classList.remove('urgent');
  $('#guess').disabled = true; $('#submit').disabled = true;
  roundResults.push({ name: currentCountry.name, iso: currentCountry.iso, found: found.size, count: currentCountry.count, points: found.size * POINTS[round] });
  round++; setText('#feedback', 'Round complete'); $('#feedback').className = 'neutral';
  setTimeout(() => beginRound().catch(showError), 1300);
}
function finishGame() {
  clearInterval(timer); $('#game').classList.add('hidden'); $('#end').classList.remove('hidden');
  setText('#final-score', score);
  $('#breakdown').innerHTML = roundResults.map((r,i) => `<div class="result-line"><span><b>${i+1}</b> ${escapeHtml(r.name)}</span><span>${r.found} found</span><strong>+${r.points}</strong></div>`).join('');
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function showError(error) {
  console.error(error);
  $('#intro').classList.remove('hidden'); $('#game').classList.add('hidden');
  $('#intro').innerHTML = `<p class="eyebrow">SETUP NEEDED</p><h1>Almost ready.</h1><p class="subhead">${escapeHtml(error.message)}<br><br>Build the GeoNames data files first, then reload.</p><p class="fine">See README.md for the setup steps.</p>`;
}
function drawGlobe(numeric) {
  const svg = d3.select('#globe'); svg.selectAll('*').remove();
  const width=600, height=360, projection=d3.geoOrthographic().scale(145).translate([300,175]).clipAngle(90);
  const path=d3.geoPath(projection);
  const g=svg.append('g');
  g.append('circle').attr('cx',300).attr('cy',175).attr('r',145).attr('fill','#152a39').attr('stroke','#3b6575').attr('stroke-width',1.2);
  d3.json('https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json').then(world => {
    const countries=topojson.feature(world, world.objects.countries).features;
    g.selectAll('path.country').data(countries).join('path').attr('class','country').attr('d',path)
      .attr('fill',d => String(d.id).padStart(3,'0') === String(numeric).padStart(3,'0') ? '#a9ef72' : '#294555')
      .attr('stroke','#547080').attr('stroke-width',.55);
    const graticule=d3.geoGraticule10();
    g.append('path').datum(graticule).attr('d',path).attr('fill','none').attr('stroke','#4a6573').attr('stroke-width',.45).attr('opacity',.65);
    const drag=d3.drag().on('drag',event=>{const r=projection.rotate();projection.rotate([r[0]+event.dx*.45,r[1]-event.dy*.45]);g.selectAll('path').attr('d',path);});
    svg.call(drag);
  }).catch(()=>{});
}

$('#start').addEventListener('click', async () => {
  try { manifest = await loadManifest(); $('#intro').classList.add('hidden'); $('#game').classList.remove('hidden'); round=0;score=0;roundResults=[];setText('#score','0');await beginRound(); }
  catch (e) { showError(e); }
});
$('#submit').addEventListener('click', submitGuess);
$('#guess').addEventListener('keydown', e => { if(e.key==='Enter') submitGuess(); });
$('#again').addEventListener('click', () => { $('#end').classList.add('hidden'); $('#intro').classList.remove('hidden'); });
