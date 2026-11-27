await (async()=>{const ARGS=__SAVE__;
// Returns generated image ARGS.i of the reply (same selection as images.js, ARGS.mode 'after_send' or 'last') as
// base64. The bytes come from the page's own fetch of the image (same origin, with the user's session); the
// extension hands them to the MCP server, which writes the file. Nothing is downloaded and the page does not reload.
const U='[data-content-search-unit-key]',norm=s=>s.replace(/[^\p{L}\p{N}]+/gu,' ').trim().slice(0,50),role=u=>(u.getAttribute('data-content-search-unit-key')||'').split(':').pop();
if([...document.querySelectorAll('[data-talvt-turn-state]')].some(t=>t.getAttribute('data-talvt-turn-state')!=='complete'))return{ok:false,err:'still_generating'};
const MODE=ARGS.mode==='after_send'?'after_send':'last',st=window.__tabpair;if(MODE==='after_send'&&!st)return{ok:false,err:'no_send_in_this_page'};
const users=[...document.querySelectorAll(U)].filter(u=>role(u)==='user');let a=null;
if(MODE==='last')a=users[users.length-1]||null;else for(let i=users.length-1;i>=0;i--){const u=users[i];if(!u.hasAttribute('data-tp-old')&&[st.head,st.head2].some(h=>h&&norm(u.innerText).startsWith(h))){a=u;break}}
if(!a)return{ok:false,err:'no_user_message'};
const next=users[users.indexOf(a)+1]||null,F=Node.DOCUMENT_POSITION_FOLLOWING,seen=new Set();
const ims=[...document.querySelectorAll('main img')].filter(im=>{if(im.naturalWidth<256||!im.src||seen.has(im.src))return false;if(im.closest(U)&&role(im.closest(U))==='user')return false;if(!(a.compareDocumentPosition(im)&F))return false;if(next&&!(im.compareDocumentPosition(next)&F))return false;seen.add(im.src);return true});
const im=ims[ARGS.i|0];if(!im)return{ok:false,err:'no_image',count:ims.length};
let b;try{b=await(await fetch(im.src)).blob()}catch(e){return{ok:false,err:'fetch_failed',note:String(e).slice(0,200)}}
if(!/^image\/(png|jpeg|webp)$/.test(b.type))return{ok:false,err:'not_an_image',type:b.type};
const bytes=new Uint8Array(await b.arrayBuffer());let bin='';for(let i=0;i<bytes.length;i+=32768)bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+32768));
return{ok:true,type:b.type,bytes:b.size,w:im.naturalWidth,h:im.naturalHeight,source:'full',data:btoa(bin)}})()
