await (async()=>{const NAME=__NAME__,ON=__ON__;
const t=[...document.querySelectorAll('.ds-toggle-button')].find(x=>NAME.test(x.innerText));if(!t)return{ok:false,err:'toggle_not_found'};if(t.classList.contains('ds-toggle-button--selected')!==ON){t.click();await new Promise(r=>setTimeout(r,300))}return{ok:true,name:t.innerText.trim(),on:t.classList.contains('ds-toggle-button--selected')}})()
