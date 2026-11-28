'use strict';
// Сторінка /admin/agents: три агенти, що вони роблять зараз, жива стрічка подій, кадри останньої перевірки.
// Дані: /admin/agents.json (оновлення кожні 5 с). Без зовнішніх бібліотек.
function agentsPage() {
  return `<!doctype html><html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#0b1c15"><meta name="robots" content="noindex"><title>Агенти · Čestitam</title>
<style>
:root{--bg:#0b1c15;--ink:#f7f1e6;--mut:#b9b09f;--line:#ffffff14;--glass:#ffffff0a;--gold:#f2c46d;--gold2:#ffdf9e;--ok:#7bd88f;--warn:#ff8a7a;--work:#7ab8ff}
*{box-sizing:border-box}html,body{margin:0}
body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);min-height:100vh;overflow-x:hidden}
.aurora{position:fixed;inset:-20%;z-index:-1;background:
 radial-gradient(40% 35% at 15% 10%,#1f5a43aa,transparent 70%),radial-gradient(35% 30% at 85% 5%,#6b4b1c88,transparent 70%),
 radial-gradient(45% 40% at 70% 95%,#16384f88,transparent 70%),var(--bg);filter:blur(20px);animation:drift 24s ease-in-out infinite alternate}
@keyframes drift{to{transform:translate3d(-3%,2%,0) scale(1.05)}}
main{max-width:1180px;margin:auto;padding:22px 16px 60px}
header{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:22px}
.brand{display:flex;align-items:center;gap:12px}.brand a{color:var(--mut);text-decoration:none;font-size:14px}
h1{font:600 clamp(28px,5vw,44px)/1.05 Georgia,"Times New Roman",serif;margin:0;letter-spacing:-.01em}
h1 em{font-style:normal;background:linear-gradient(90deg,var(--gold),var(--gold2));-webkit-background-clip:text;background-clip:text;color:transparent}
.live{display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;border:1px solid var(--line);background:var(--glass);font-size:13px;color:var(--mut);backdrop-filter:blur(10px)}
.live i{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 0 0 #7bd88f88;animation:ping 2s infinite}
.live.off i{background:var(--warn);animation:none}
@keyframes ping{70%{box-shadow:0 0 0 8px #7bd88f00}100%{box-shadow:0 0 0 0 #7bd88f00}}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
.card{position:relative;border-radius:24px;padding:20px;background:linear-gradient(180deg,#ffffff10,#ffffff05);border:1px solid var(--line);backdrop-filter:blur(14px);box-shadow:0 30px 60px #0007;overflow:hidden}
.card:before{content:"";position:absolute;inset:0;border-radius:inherit;padding:1px;background:linear-gradient(140deg,#f2c46d55,transparent 40%,transparent 70%,#ffffff22);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;pointer-events:none}
.agent .top{display:flex;align-items:center;gap:14px}
.ava{position:relative;width:58px;height:58px;flex:none;border-radius:18px;display:grid;place-items:center;font-size:28px;background:radial-gradient(circle at 30% 25%,#ffffff22,#ffffff06);border:1px solid var(--line)}
.ava:after{content:"";position:absolute;inset:-5px;border-radius:22px;border:2px solid transparent}
.s-idle .ava:after{border-color:#7bd88f55;animation:breath 3.5s ease-in-out infinite}
.s-working .ava:after{border-color:var(--work) transparent var(--work) transparent;animation:spin 1.1s linear infinite}
.s-waiting .ava:after{border-color:#7ab8ff55;animation:breath 2s ease-in-out infinite}
.s-attention .ava:after{border-color:var(--warn);animation:breath 1.2s ease-in-out infinite}
@keyframes spin{to{transform:rotate(360deg)}}@keyframes breath{50%{opacity:.25}}
.name{font:600 19px/1.2 Georgia,serif}.role{color:var(--mut);font-size:13px}
.pill{display:inline-flex;align-items:center;gap:6px;margin-top:14px;padding:6px 11px;border-radius:999px;font-size:13px;font-weight:600;background:#ffffff0d;border:1px solid var(--line)}
.pill b{width:7px;height:7px;border-radius:50%}
.s-idle .pill b{background:var(--ok)}.s-working .pill b{background:var(--work)}.s-waiting .pill b{background:var(--work)}.s-attention .pill b{background:var(--warn)}
.line{margin:10px 0 4px;font-size:16px;min-height:48px}
.s-working .line{color:#cfe4ff}.s-attention .line{color:#ffc8be}
.stats{display:flex;gap:10px;margin-top:12px}.stat{flex:1;border-radius:14px;padding:10px 12px;background:#00000026;border:1px solid var(--line)}
.stat span{display:block;color:var(--mut);font-size:12px}.stat b{font:600 24px/1.1 Georgia,serif;color:var(--gold)}
.last{margin-top:12px;color:var(--mut);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.checks{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}.chk{font-size:12px;padding:4px 9px;border-radius:999px;background:#00000026;border:1px solid var(--line)}
.chk.no{border-color:#ff8a7a88;color:#ffc8be}
.row2{display:grid;grid-template-columns:1.6fr 1fr;gap:14px;margin-top:14px}
@media(max-width:900px){.row2{grid-template-columns:1fr}}
h2{font:600 20px/1.2 Georgia,serif;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin:0 0 14px}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.chip{cursor:pointer;font:600 13px system-ui,sans-serif;padding:7px 12px;border-radius:999px;border:1px solid var(--line);background:transparent;color:var(--mut)}
.chip.on{background:var(--gold);color:#1d1a12;border-color:var(--gold)}
.feed{list-style:none;margin:0;padding:0;max-height:620px;overflow:auto}
.ev{display:grid;grid-template-columns:34px 1fr auto;gap:10px;align-items:start;padding:11px 4px;border-top:1px solid var(--line);animation:in .5s ease both}
.ev:first-child{border-top:0}@keyframes in{from{opacity:0;transform:translateY(-6px)}}
.ev .ic{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:#ffffff0d;font-size:17px;position:relative}
.ev .ic:after{content:"";position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;border:2px solid #10241c;background:var(--ok)}
.ev.bad .ic:after{background:var(--warn)}
.ev .t{font-size:14px}.ev .t a{color:var(--gold);text-decoration:none}.ev .m{color:var(--mut);font-size:12px}
.ev time{color:var(--mut);font-size:12px;white-space:nowrap}
.frames{display:grid;gap:10px}.frames figure{margin:0}.frames img{width:100%;max-height:300px;object-fit:contain;border-radius:14px;background:#0005;display:block}
.frames figcaption{color:var(--mut);font-size:12px;margin-top:4px}
.empty{color:var(--mut);padding:18px 4px}
.foot{margin-top:18px;color:var(--mut);font-size:12px;text-align:center}
@media(prefers-reduced-motion:reduce){*{animation:none!important}}
</style></head><body><div class="aurora"></div><main>
<header><div class="brand"><div><a href="/admin">← CRM</a><h1>Мої <em>агенти</em></h1></div></div>
<span class="live" id="live"><i></i><span id="livet">наживо</span></span></header>
<section class="grid" id="agents"></section>
<section class="row2">
 <div class="card"><h2>Що відбувається</h2><p class="sub">Кожна дія агентів, найновіше зверху</p>
  <div class="chips" id="chips"></div><ul class="feed" id="feed"></ul></div>
 <div class="card"><h2>Останній ролик</h2><p class="sub" id="fsub">Кадри, які перевірив агент</p><div class="frames" id="frames"></div></div>
</section>
<p class="foot" id="foot"></p>
</main>
<script>
const ICON={orders:'🧾',video:'🎬',watchdog:'🛡️'},NAME={orders:'Контроль замовлень',video:'Перевірка відео',watchdog:'Сторож'};
const STATE={idle:'Чергує',working:'Працює',waiting:'Чекає',attention:'Потрібна ваша увага'};
let filter='all',data=null;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function ago(ts){const s=(Date.now()-Date.parse(ts))/1e3;if(s<60)return 'щойно';if(s<3600)return Math.floor(s/60)+' хв тому';if(s<86400)return Math.floor(s/3600)+' год тому';return new Date(ts).toLocaleDateString('uk-UA')}
function hm(ts){return new Date(ts).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}
function render(){
 if(!data)return;
 document.getElementById('agents').innerHTML=data.agents.map(a=>'<article class="card agent s-'+a.state+'"><div class="top"><div class="ava">'+a.icon+'</div><div><div class="name">'+esc(a.name)+'</div><div class="role">'+esc(a.role)+'</div></div></div>'+
  '<span class="pill"><b></b>'+STATE[a.state]+'</span><p class="line">'+esc(a.line)+'</p>'+
  (a.checks&&a.checks.length?'<div class="checks">'+a.checks.map(c=>'<span class="chk'+(c.ok?'':' no')+'" title="'+esc(c.detail)+'">'+(c.ok?'✓ ':'✗ ')+esc(c.label)+'</span>').join('')+'</div>':'')+
  '<div class="stats">'+a.stats.map(s=>'<div class="stat"><span>'+esc(s[0])+'</span><b>'+s[1]+'</b></div>').join('')+'</div>'+
  '<div class="last">'+(a.last?'Остання дія: '+esc(a.last.msg)+' · '+ago(a.last.ts):'Ще нічого не робив')+'</div></article>').join('');
 const ks=['all','orders','video','watchdog'];
 document.getElementById('chips').innerHTML=ks.map(k=>'<button class="chip'+(k===filter?' on':'')+'" data-k="'+k+'">'+(k==='all'?'Усі':ICON[k]+' '+NAME[k])+'</button>').join('');
 document.querySelectorAll('.chip').forEach(b=>b.onclick=()=>{filter=b.dataset.k;render()});
 const f=data.feed.filter(e=>filter==='all'||e.agent===filter);
 document.getElementById('feed').innerHTML=f.length?f.map(e=>'<li class="ev'+(e.ok===false?' bad':'')+'"><div class="ic">'+ICON[e.agent]+'</div><div><div class="t">'+(e.no?'<a href="/admin?q='+encodeURIComponent(e.no)+'">'+esc(e.no)+' · '+esc(e.name)+'</a> — ':'')+esc(e.text)+'</div><div class="m">'+NAME[e.agent]+'</div></div><time title="'+esc(e.ts)+'">'+hm(e.ts)+'<br>'+ago(e.ts)+'</time></li>').join(''):'<li class="empty">Поки що подій немає. Щойно прийде замовлення, агенти почнуть працювати.</li>';
 const fr=data.frames;
 document.getElementById('fsub').textContent=fr?fr.no+' · '+fr.name+' · '+(fr.ok?'перевірка пройдена ✓':'є зауваження')+' · '+ago(fr.ts):'Кадри, які перевірив агент';
 document.getElementById('frames').innerHTML=fr?fr.list.map(k=>'<figure><img src="/admin/f/'+fr.order+'/'+k+'.jpg" alt=""><figcaption>'+(k==='book'?'Ім’я в книзі':'Фото в портреті')+'</figcaption></figure>').join(''):'<p class="empty">Ще не було перевірених роликів.</p>';
 document.getElementById('foot').textContent='Telegram: '+(data.tg?'увімкнено':'не налаштовано')+' · оновлено '+hm(data.now);
}
async function load(){
 try{const r=await fetch('/admin/agents.json',{cache:'no-store'});if(!r.ok)throw 0;data=await r.json();render();
  document.getElementById('live').classList.remove('off');document.getElementById('livet').textContent='наживо';}
 catch(e){document.getElementById('live').classList.add('off');document.getElementById('livet').textContent='немає зв’язку'}
}
load();setInterval(load,5000);
</script></body></html>`;
}
module.exports = { agentsPage };
