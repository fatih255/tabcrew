await (async()=>{const MODE=__MODE__;
// Generated images in the reply to the message the last send sent ('after_send') or in the newest reply ('last').
// Gemini renders each one as a generated-image element (a blob: preview, about 1024 px); save_image fetches the
// full-size file. Waits up to 30 s for the reply to finish.
const Q='user-query',R='model-response',sl=ms=>new Promise(r=>setTimeout(r,ms)),norm=s=>s.replace(/[^\p{L}\p{N}]+/gu,' ').trim().slice(0,50),qt=u=>{const l=[...u.querySelectorAll('.query-text-line')];if(l.length)return l.map(p=>p.innerText).join('\n');const q=u.querySelector('.query-text');if(!q)return'';const c=q.cloneNode(true);c.querySelectorAll('.cdk-visually-hidden').forEach(x=>x.remove());return c.innerText};
const st=window.__tabpair;if(MODE==='after_send'&&!st)return{status:'error',err:'no_send_in_this_page'};
const gen=()=>{const g=document.querySelector('gem-icon-button.send-button');return !!(g&&g.classList.contains('stop'))};
const reply=()=>{const qs=[...document.querySelectorAll(Q)];let u=null;if(MODE==='last')u=qs[qs.length-1]||null;else for(let i=qs.length-1;i>=0;i--){if(!qs[i].hasAttribute('data-tp-old')&&[st.head,st.head2].some(h=>h&&norm(qt(qs[i])).startsWith(h))){u=qs[i];break}}if(!u)return null;return[...document.querySelectorAll(R)].find(r=>u.compareDocumentPosition(r)&Node.DOCUMENT_POSITION_FOLLOWING)||false};
const t0=Date.now();let last='',stable=0;
while(Date.now()-t0<30000){const r=reply();if(r===null&&MODE==='last')return{status:'error',err:'no_user_message'};
if(r){const ims=[...r.querySelectorAll('generated-image img')].filter(i=>i.naturalWidth>0);const sig=ims.map(i=>i.src+'@'+i.naturalWidth).join('|');stable=sig===last?stable+1:0;last=sig;
const done=!!r.querySelector('.response-footer.complete')&&!gen();
if(done&&stable>=1){const n=r.querySelectorAll('generated-image').length;if(ims.length===n)return{status:'done',count:n,images:ims.map((im,i)=>({i,w:im.naturalWidth,h:im.naturalHeight,size:'preview'})),secs:(Date.now()-t0)/1000}}}
await sl(1000)}
return{status:gen()?'generating':'waiting'}})()
