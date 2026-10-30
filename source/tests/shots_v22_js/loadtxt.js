() => { const m = [...document.querySelectorAll('.modal.show, .show')].pop(); return m ? m.innerText.split('\n').filter(l => /Rifle|7%|pool/.test(l)).slice(0, 5) : null; }
