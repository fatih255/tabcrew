await (async()=>{const ARGS=__SAVE__;
// Saves generated image ARGS.i of the reply (same selection as images.js, ARGS.mode 'after_send' or 'last') into the
// local folder served by tools/save_server.py, without a browser download dialog: the page's CSP blocks fetch to
// localhost (connect-src) but sets no form-action, so a top-level multipart form post to ARGS.url is allowed. The
// server saves the file and redirects back to this chat, so the page reloads once; window.__tc comes back from the
// localStorage cache on the next call, but window.__tabpair does not: use mode 'last' after a save.
const U='[data-content-search-unit-key]',norm=s=>s.replace(/[^\p{L}\p{N}]+/gu,' ').trim().slice(0,50),role=u=>(u.getAttribute('data-content-search-unit-key')||'').split(':').pop();
if(!ARGS||typeof ARGS.url!=='string'||!/^http:\/\/127\.0\.0\.1:\d{2,5}\/save\/[A-Za-z0-9_-]{16,64}$/.test(ARGS.url))return{ok:false,err:'bad_url'};
if(typeof ARGS.file!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(ARGS.file))return{ok:false,err:'bad_file'};
if([...document.querySelectorAll('[data-talvt-turn-state]')].some(t=>t.getAttribute('data-talvt-turn-state')!=='complete'))return{ok:false,err:'still_generating'};
const MODE=ARGS.mode==='after_send'?'after_send':'last',st=window.__tabpair;if(MODE==='after_send'&&!st)return{ok:false,err:'no_send_in_this_page'};
const users=[...document.querySelectorAll(U)].filter(u=>role(u)==='user');let a=null;
if(MODE==='last')a=users[users.length-1]||null;else for(let i=users.length-1;i>=0;i--){const u=users[i];if(!u.hasAttribute('data-tp-old')&&[st.head,st.head2].some(h=>h&&norm(u.innerText).startsWith(h))){a=u;break}}
if(!a)return{ok:false,err:'no_user_message'};
const next=users[users.indexOf(a)+1]||null,F=Node.DOCUMENT_POSITION_FOLLOWING,seen=new Set();
const ims=[...document.querySelectorAll('main img')].filter(im=>{if(im.naturalWidth<256||!im.src||seen.has(im.src))return false;if(im.closest(U)&&role(im.closest(U))==='user')return false;if(!(a.compareDocumentPosition(im)&F))return false;if(next&&!(im.compareDocumentPosition(next)&F))return false;seen.add(im.src);return true});
const im=ims[ARGS.i|0];if(!im)return{ok:false,err:'no_image',count:ims.length};
let b;try{b=await(await fetch(im.src)).blob()}catch(e){return{ok:false,err:'fetch_failed',note:String(e).slice(0,200)}}
const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[b.type];if(!ext)return{ok:false,err:'not_an_image',type:b.type};
const file=ARGS.file.replace(/\.(png|jpe?g|webp)$/i,'')+'.'+ext;
const f=document.createElement('form');f.method='POST';f.action=ARGS.url;f.enctype='multipart/form-data';f.style.display='none';
const inp=document.createElement('input');inp.type='file';inp.name='file';const dt=new DataTransfer();dt.items.add(new File([b],file,{type:b.type}));inp.files=dt.files;
const back=document.createElement('input');back.type='hidden';back.name='back';back.value=location.href;
f.append(inp,back);document.body.append(f);setTimeout(()=>f.submit(),50);
return{ok:true,file,bytes:b.size,type:b.type,w:im.naturalWidth,h:im.naturalHeight,note:'the page reloads once'}})()
