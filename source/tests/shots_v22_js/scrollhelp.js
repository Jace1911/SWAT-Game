(pat) => { const re = new RegExp(pat); const el = [...document.querySelectorAll('#m-help *')].find(e => re.test(e.textContent.trim()) && e.children.length < 3); if (el) el.scrollIntoView(); }
