// Instantané complet de l'affichage de MeteoFoux dans Edge headless, pour comparer avant/après
// une modification du front. Le front n'a pas de tests : c'est son filet de sécurité.
//
//   node tests/ui-snapshot.js <dossier_replay> <sortie.json>     (EDGE=chemin pour un autre Edge)
//   node tests/ui-snapshot-diff.js avant.json apres.json
//
// Usage : un instantané avant la modification, un après, sur le MÊME dossier de replay.
// - Dossier de replay vide ou absent : les réponses du proxy local (docker, port 8123) des
//   4 points y sont d'abord enregistrées. Ensuite elles sont rejouées : données figées.
// - Hors du dépôt (dossier temporaire) : ces réponses font ~300 Ko par point
// - L'horloge du navigateur est figée sur meta.generated_at de la première réponse
// - Pour 4 points × 3 sources × chaque jour : texte du résumé, chaque carte (y compris repliées)
//   avec son icône, et les séries de chaque graphique ApexCharts
// - Profil Edge temporaire, jamais celui de l'utilisateur
const { spawn, execSync } = require('child_process');
const fs = require('fs'), path = require('path');
const os = require('os');
const [replayDir, outFile] = process.argv.slice(2);
const edge = process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
// Les 4 points de CONFIG.points (js/core.js), tels que le front les envoie au proxy
const POINTS = [['44.2902', '6.5689'], ['44.2848', '6.5356'], ['44.2935', '6.5904'], ['44.3122', '6.5743']];
const PORT = 9334;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let proc = null;

(async () => {
    if (!fs.existsSync(replayDir) || !fs.readdirSync(replayDir).some(f => f.endsWith('.json'))) {
        fs.mkdirSync(replayDir, { recursive: true });
        for (const [lat, lon] of POINTS) {
            const r = await fetch(`http://localhost:8123/meteo-proxy.php?lat=${lat}&lon=${lon}`);
            if (!r.ok) throw new Error(`proxy local : HTTP ${r.status} pour ${lat},${lon}`);
            fs.writeFileSync(path.join(replayDir, `${lat}_${lon}.json`), Buffer.from(await r.arrayBuffer()));
        }
        console.log(`réponses du proxy enregistrées dans ${replayDir}`);
    }
    const replay = {};
    for (const f of fs.readdirSync(replayDir).filter(f => f.endsWith('.json'))) {
        replay[f.replace('.json', '')] = fs.readFileSync(path.join(replayDir, f));
    }
    const FROZEN = Date.parse(JSON.parse(Object.values(replay)[0].toString()).meta.generated_at);

    // Profil neuf à chaque exécution : Edge garde le précédent verrouillé un moment après sa fermeture
    const profile = path.join(os.tmpdir(), 'meteofoux-edge-' + Date.now());
    proc = spawn(edge, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
        '--no-first-run', '--no-default-browser-check', '--window-size=1280,2400', 'about:blank'], { stdio: 'ignore' });

    let targets;
    for (let i = 0; i < 50; i++) {
        try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.some(t => t.type === 'page')) break; } catch (e) {}
        await sleep(200);
    }
    const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r));
    let id = 0; const pending = {}; const errors = []; const unmatched = [];
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending[i] = r; ws.send(JSON.stringify({ id: i, method, params })); });
    ws.addEventListener('message', ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending[m.id]) { pending[m.id](m); delete pending[m.id]; }
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map(a => a.value ?? a.description).join(' '));
        if (m.method === 'Fetch.requestPaused') {
            const u = new URL(m.params.request.url);
            const key = `${u.searchParams.get('lat')}_${u.searchParams.get('lon')}`;
            if (replay[key]) {
                send('Fetch.fulfillRequest', { requestId: m.params.requestId, responseCode: 200,
                    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }], body: replay[key].toString('base64') });
            } else {
                unmatched.push(key);
                send('Fetch.continueRequest', { requestId: m.params.requestId });
            }
        }
    });
    const evaluate = async expr => {
        const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
        if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate');
        return r.result?.result?.value;
    };
    const waitFor = async (expr, ms = 30000) => { for (let t = 0; t < ms; t += 250) { if (await evaluate(expr)) return true; await sleep(250); } return false; };

    await send('Runtime.enable'); await send('Page.enable');
    // Taille d'affichage imposée : sans ça, Edge headless tombe parfois en mise en page mobile
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 2400, deviceScaleFactor: 1, mobile: false });
    await send('Fetch.enable', { patterns: [{ urlPattern: '*meteo-proxy.php*' }] });
    // Horloge figée : new Date() sans argument et Date.now() renvoient FROZEN
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => {
        const RealDate = Date, FROZEN = ${FROZEN};
        class FrozenDate extends RealDate { constructor(...a) { super(...(a.length ? a : [FROZEN])); } static now() { return FROZEN; } }
        globalThis.Date = FrozenDate;
    })();` });
    await send('Page.navigate', { url: 'http://localhost:8123/' });
    if (!await waitFor(`typeof App !== 'undefined' && document.querySelectorAll('.summary-bar').length > 0`)) throw new Error('page non chargée');
    await waitFor(`Object.keys(DataService.state.data).length >= 4`);

    const snapshot = { frozen: new Date(FROZEN).toISOString(), views: {} };
    for (const point of ['station', 'observatoire', 'marin-pascal', 'vescal']) {
        await evaluate(`App.selectPoint('${point}')`);
        await waitFor(`App.state.currentPoint === '${point}'`);
        for (const source of ['openmeteo', 'arome', 'metno']) {
            for (let k = 0; k < 3 && (await evaluate('App.state.globalSource')) !== source; k++) await evaluate('App.toggleGlobalSource()');
            await sleep(1200);
            snapshot.views[`${point}/${source}`] = await evaluate(`(() => {
                const norm = s => (s || '').replace(/\\s+/g, ' ').trim();
                const days = {};
                document.querySelectorAll('.day-section[data-day]').forEach(sec => {
                    const grids = {};
                    sec.querySelectorAll('.cards-grid, .grid-periods, .grid-hourly').forEach((g, gi) => {
                        const kind = g.classList.contains('grid-periods') ? 'periodes' : g.classList.contains('grid-hourly') ? 'heures' : 'cartes';
                        if (g.querySelector('.grid-periods, .grid-hourly')) return;  // conteneur parent
                        grids[kind + '#' + gi] = [...g.querySelectorAll('.card')].map(c =>
                            norm(c.textContent) + ' [' + (c.querySelector('img.icon')?.getAttribute('src') || '').replace('weather/svg/', '') + ']');
                    });
                    days[sec.dataset.day] = {
                        resume: norm(sec.querySelector('.summary-bar')?.textContent),
                        sans_donnees: norm(sec.querySelector('.no-data-message')?.textContent) || null,
                        cartes: grids,
                    };
                });
                const charts = {};
                for (const [cid, c] of Object.entries(Charts.instances)) {
                    charts[cid] = (c.w?.config?.series || []).map(s => ({ nom: s.name, points: s.data }));
                }
                return { days, charts };
            })()`);
        }
    }
    snapshot.errors = errors;
    snapshot.unmatched = unmatched;
    fs.writeFileSync(outFile, JSON.stringify(snapshot, null, 1));
    console.log(`instantané : ${Object.keys(snapshot.views).length} vues, horloge figée ${snapshot.frozen}, erreurs JS : ${errors.length}, requêtes non rejouées : ${unmatched.length}`);
    ws.close();
})().catch(e => console.error('ECHEC', e)).finally(() => {
    if (proc) try { execSync(`taskkill /PID ${proc.pid} /T /F`, { stdio: 'ignore' }); } catch (e) {}
    process.exit(0);
});
