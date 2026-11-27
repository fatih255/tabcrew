await (async()=>{const ARGS=__SAVE__;
// Returns generated image ARGS.i of the reply (ARGS.mode 'after_send' or 'last') as base64; the extension hands it to
// the MCP server, which writes the file. Nothing is downloaded and the page does not reload.
// The full-size file comes from Gemini's own download flow: the op clicks the download button, takes the image bytes
// from that flow's fetch and makes the fetch fail for the page, so the page never starts a download (it shows its
// own "Couldn't download image" notice instead). If that fails, it falls back to the copy button (about 1024 px),
// intercepting the clipboard write so the user's clipboard is not touched.
const sl=ms=>new Promise(r=>setTimeout(r,ms));
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
if(dl){const of=window.fetch;window.fetch=async function(x){const url=String(x&&x.url||x);if(/\/rd-gg\//.test(url)){const r=await of.apply(this,arguments);let b=null;try{b=await r.clone().blob()}catch(e){}if(b&&/^image\//.test(b.type)){blob=b;throw new TypeError('tabcrew-chrome: image taken, no download')}return r}return of.apply(this,arguments)};
try{dl.click();for(let k=0;k<40&&!blob;k++)await sl(500)}finally{await sl(300);window.fetch=of}}
if(!blob){const cp=btn('content_copy');if(cp){source='preview';const cb=navigator.clipboard,w=cb.write,wt=cb.writeText;cb.write=async items=>{for(const it of items)for(const t of it.types)if(/^image\//.test(t))blob=await it.getType(t)};cb.writeText=async()=>{};
try{cp.click();for(let k=0;k<20&&!blob;k++)await sl(500)}finally{cb.write=w;cb.writeText=wt}}}
if(!blob)return{ok:false,err:'fetch_failed',note:'no image from the download or copy button'};
if(!/^image\/(png|jpeg|webp)$/.test(blob.type))return{ok:false,err:'not_an_image',type:blob.type};
let w=0,h=0;try{const bm=await createImageBitmap(blob);w=bm.width;h=bm.height}catch(e){}
const bytes=new Uint8Array(await blob.arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=32768)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));
return{ok:true,type:blob.type,bytes:blob.size,w,h,source,data:btoa(bin)}})()
