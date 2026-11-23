await (async()=>{const MODE=__MODE__;
// Generated images in the reply to the message the last send sent ('after_send') or in the newest reply ('last').
// An image counts when it is at least 256 px wide, is not inside a user message (attachments), and sits after
// the user message and before the next one. Waits up to 30 s for the reply to finish and the images to settle.
const U='[data-content-search-unit-key]',T='[data-talvt-turn-state]',sl=ms=>new Promise(r=>setTimeout(r,ms)),norm=s=>s.replace(/[^\p{L}\p{N}]+/gu,' ').trim().slice(0,50),role=u=>(u.getAttribute('data-content-search-unit-key')||'').split(':').pop();
const st=window.__tabpair;if(MODE==='after_send'&&!st)return{status:'error',err:'no_send_in_this_page'};
const busy=()=>[...document.querySelectorAll(T)].some(t=>t.getAttribute('data-talvt-turn-state')!=='complete')||!!document.querySelector('[data-testid=stop-button]');
const anchor=()=>{const users=[...document.querySelectorAll(U)].filter(u=>role(u)==='user');if(MODE==='last')return users.length?users[users.length-1]:null;for(let i=users.length-1;i>=0;i--){const u=users[i];if(!u.hasAttribute('data-tp-old')&&[st.head,st.head2].some(h=>h&&norm(u.innerText).startsWith(h)))return u}return null};
const find=()=>{const a=anchor();if(!a)return null;const users=[...document.querySelectorAll(U)].filter(u=>role(u)==='user');const next=users[users.indexOf(a)+1]||null;const F=Node.DOCUMENT_POSITION_FOLLOWING;const seen=new Set();return[...document.querySelectorAll('main img')].filter(im=>{if(im.naturalWidth<256||!im.src||seen.has(im.src))return false;if(im.closest(U)&&role(im.closest(U))==='user')return false;if(!(a.compareDocumentPosition(im)&F))return false;if(next&&!(im.compareDocumentPosition(next)&F))return false;seen.add(im.src);return true})};
window.__tcImages=find;
const t0=Date.now();let last='',stable=0;
while(Date.now()-t0<30000){const ims=find();if(ims===null){if(MODE==='last')return{status:'error',err:'no_user_message'};await sl(1000);continue}
const sig=ims.map(i=>i.src+'@'+i.naturalWidth+'x'+i.naturalHeight).join('|');stable=sig===last?stable+1:0;last=sig;
if(!busy()&&ims.length&&stable>=2)return{status:'done',count:ims.length,images:ims.map((im,i)=>({i,w:im.naturalWidth,h:im.naturalHeight})),secs:(Date.now()-t0)/1000};
// a text-only reply: done with no images once an assistant message follows the user message and has settled
// (right after a send the chat is briefly neither busy nor answered, so time alone is not enough)
if(!busy()&&!ims.length&&stable>=3){const a=anchor(),F=Node.DOCUMENT_POSITION_FOLLOWING;if(a&&[...document.querySelectorAll(U)].some(u=>role(u)==='assistant'&&(a.compareDocumentPosition(u)&F)&&u.innerText.trim()))return{status:'done',count:0,images:[],secs:(Date.now()-t0)/1000}}
await sl(1000)}
return{status:busy()?'generating':'waiting'}})()
