() => { const t = document.getElementById('t-map') || [...document.querySelectorAll('#mtabs button')].find(b => /MAP/.test(b.textContent)); if (t) t.click(); }
