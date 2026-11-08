// Compare deux instantanés de tests/ui-snapshot.js et liste les différences par vue / jour / élément.
//   node tests/ui-snapshot-diff.js avant.json apres.json [nb_exemples]
const fs = require('fs');
const [a, b, nArg] = process.argv.slice(2);
const A = JSON.parse(fs.readFileSync(a)), B = JSON.parse(fs.readFileSync(b));
const N = Number(nArg || 4);
let total = 0;
const groups = {};
const note = (group, msg) => { total++; (groups[group] ||= []).push(msg); };

for (const view of new Set([...Object.keys(A.views), ...Object.keys(B.views)])) {
    const va = A.views[view], vb = B.views[view];
    if (!va || !vb) { note(view, 'vue absente d un cote'); continue; }
    for (const day of new Set([...Object.keys(va.days), ...Object.keys(vb.days)])) {
        const da = va.days[day], db = vb.days[day];
        if (!da || !db) { note(`${view} ${day}`, 'jour absent d un cote'); continue; }
        if (da.resume !== db.resume) note(`${view} resume`, `${day}: "${da.resume}" -> "${db.resume}"`);
        if (da.sans_donnees !== db.sans_donnees) note(`${view} sans_donnees`, `${day}: ${da.sans_donnees} -> ${db.sans_donnees}`);
        const gk = new Set([...Object.keys(da.cartes), ...Object.keys(db.cartes)]);
        for (const g of gk) {
            const ca = da.cartes[g] || [], cb = db.cartes[g] || [];
            if (ca.length !== cb.length) note(`${view} cartes`, `${day} ${g}: ${ca.length} cartes -> ${cb.length}`);
            for (let i = 0; i < Math.min(ca.length, cb.length); i++) {
                if (ca[i] !== cb[i]) note(`${view} cartes`, `${day} ${g}[${i}]: "${ca[i]}" -> "${cb[i]}"`);
            }
        }
    }
    for (const cid of new Set([...Object.keys(va.charts), ...Object.keys(vb.charts)])) {
        const sa = JSON.stringify(va.charts[cid]), sb = JSON.stringify(vb.charts[cid]);
        if (sa === sb) continue;
        if (!va.charts[cid] || !vb.charts[cid]) { note(`${view} graphiques`, `${cid}: present d un seul cote`); continue; }
        const byName = s => Object.fromEntries((s || []).map(x => [x.nom, JSON.stringify(x.points)]));
        const na = byName(va.charts[cid]), nb = byName(vb.charts[cid]);
        for (const n of new Set([...Object.keys(na), ...Object.keys(nb)])) {
            if (na[n] !== nb[n]) note(`${view} graphiques`, `${cid} serie "${n}": ${na[n] ? (nb[n] ? 'valeurs differentes' : 'disparue') : 'nouvelle'}`);
        }
    }
}
for (const [g, msgs] of Object.entries(groups)) {
    console.log(`\n### ${g} (${msgs.length})`);
    msgs.slice(0, N).forEach(m => console.log('   ' + m));
    if (msgs.length > N) console.log(`   ... ${msgs.length - N} autres`);
}
console.log(`\nerreurs JS : avant ${A.errors.length}, apres ${B.errors.length}`);
console.log(`TOTAL : ${total} differences`);
