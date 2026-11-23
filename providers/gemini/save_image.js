await (async()=>{const ARGS=__SAVE__;
// Saves generated image ARGS.i of the reply (ARGS.mode 'after_send' or 'last') into the folder of tools/save_server.py
// with no download dialog. Gemini's CSP blocks fetch to localhost and has a form-action list, so the image goes out as
// a top-level GET navigation with the data in the URL (Chrome allows about 2 MB), in parts when it is larger. The
// server answers 303 back to the chat after each part, so the page reloads; the parts wait in this site's IndexedDB.
// Call again while the result says more:true (use mode 'last' after the first reload).
// The full-size file comes from Gemini's own download flow: the op clicks the download button, takes the image bytes
// from that flow's fetch and makes the fetch fail for the page, so the page never starts a download (it shows its
// own "Couldn't download image" notice instead). If that fails, it falls back to the copy button (about 1024 px).
const PART=1400000,sl=ms=>new Promise(r=>setTimeout(r,ms));
if(!ARGS||typeof ARGS.url!=='string'||!/^http:\/\/127\.0\.0\.1:\d{2,5}\/save\/[A-Za-z0-9_-]{16,64}$/.test(ARGS.url))return{ok:false,err:'bad_url'};
if(typeof ARGS.file!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(ARGS.file))return{ok:false,err:'bad_file'};
const db=await new Promise((res,rej)=>{const q=indexedDB.open('tabcrew_save',1);q.onupgradeneeded=()=>q.result.createObjectStore('jobs');q.onsuccess=()=>res(q.result);q.onerror=()=>rej(q.error)});
const tx=(m,f)=>new Promise((res,rej)=>{const t=db.transaction('jobs',m);const r=f(t.objectStore('jobs'));t.oncomplete=()=>res(r&&r.result);t.onerror=()=>rej(t.error)});
const go=async job=>{const k=job.next,n=Math.ceil(job.b64.length/PART)||1,chunk=job.b64.slice(k*PART,(k+1)*PART);
if(k+1<n){job.next=k+1;await tx('readwrite',s=>s.put(job,job.key))}else await tx('readwrite',s=>s.delete(job.key));
const u=ARGS.url+'?f='+encodeURIComponent(job.file)+'&i='+k+'&n='+n+'&back='+encodeURIComponent(location.href)+'&d='+chunk;
setTimeout(()=>location.assign(u),50);
return{ok:true,file:job.file,part:k+1,parts:n,more:k+1<n,source:job.source,bytes:job.bytes,type:job.type,w:job.w,h:job.h,note:'the page reloads once'}};
const key=ARGS.url+'|'+ARGS.file;const pending=await tx('readonly',s=>s.get(key));if(pending)return await go(pending);
const Q='user-query',R='model-response',norm=s=>s.replace(/[^\p{L}\p{N}]+/gu,' ').trim().slice(0,50),qt=u=>{const l=[...u.querySelectorAll('.query-text-line')];if(l.length)return l.map(p=>p.innerText).join('\n');const q=u.querySelector('.query-text');if(!q)return'';const c=q.cloneNode(true);c.querySelectorAll('.cdk-visually-hidden').forEach(x=>x.remove());return c.innerText};
const g0=document.querySelector('gem-icon-button.send-button');if(g0&&g0.classList.contains('stop'))return{ok:false,err:'still_generating'};
const MODE=ARGS.mode==='after_send'?'after_send':'last',st=window.__tabpair;if(MODE==='after_send'&&!st)return{ok:false,err:'no_send_in_this_page'};
const qs=[...document.querySelectorAll(Q)];let u=null;if(MODE==='last')u=qs[qs.length-1]||null;else for(let i=qs.length-1;i>=0;i--){if(!qs[i].hasAttribute('data-tp-old')&&[st.head,st.head2].some(h=>h&&norm(qt(qs[i])).startsWith(h))){u=qs[i];break}}
if(!u)return{ok:false,err:'no_user_message'};
const rep=[...document.querySelectorAll(R)].find(r=>u.compareDocumentPosition(r)&Node.DOCUMENT_POSITION_FOLLOWING);
const gis=rep?[...rep.querySelectorAll('generated-image')]:[];const gi=gis[ARGS.i|0];if(!gi)return{ok:false,err:'no_image',count:gis.length};
const btn=name=>{const g=[...gi.querySelectorAll('gem-icon-button')].find(g=>{const m=g.querySelector('mat-icon');return m&&(m.getAttribute('fonticon')||m.textContent.trim())===name});return g&&g.querySelector('button')};
let blob=null,source='full';
const dl=btn('download');
if(dl){const of=window.fetch;window.fetch=async function(x){const url=String(x&&x.url||x);if(/\/rd-gg\//.test(url)){const r=await of.apply(this,arguments);let b=null;try{b=await r.clone().blob()}catch(e){}if(b&&/^image\//.test(b.type)){blob=b;throw new TypeError('tabcrew: image taken, no download')}return r}return of.apply(this,arguments)};
try{dl.click();for(let k=0;k<40&&!blob;k++)await sl(500)}finally{await sl(300);window.fetch=of}}
if(!blob){const cp=btn('content_copy');if(cp){source='preview';const cb=navigator.clipboard,w=cb.write,wt=cb.writeText;cb.write=async items=>{for(const it of items)for(const t of it.types)if(/^image\//.test(t))blob=await it.getType(t)};cb.writeText=async()=>{};
try{cp.click();for(let k=0;k<20&&!blob;k++)await sl(500)}finally{cb.write=w;cb.writeText=wt}}}
if(!blob)return{ok:false,err:'fetch_failed',note:'no image from the download or copy button'};
const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[blob.type];if(!ext)return{ok:false,err:'not_an_image',type:blob.type};
let w=0,h=0;try{const bm=await createImageBitmap(blob);w=bm.width;h=bm.height}catch(e){}
const bytes=new Uint8Array(await blob.arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=32768)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));
const b64=btoa(bin).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const file=ARGS.file.replace(/\.(png|jpe?g|webp)$/i,'')+'.'+ext;
return await go({key,file,b64,next:0,source,bytes:blob.size,type:blob.type,w,h})})()
