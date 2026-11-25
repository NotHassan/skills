// A deliberately small synthetic app used to test the evidence recorder.
// The smoke harness commits a real source change between the two captures.
import http from 'node:http';
const liveRefresh = false;
const duplicateEnabled = false;
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Proof test fixture</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#f6f7fa;color:#182234;font:18px system-ui}
header{height:76px;border-bottom:1px solid #d9dfe8;padding:22px 30px;background:white;font-weight:650}
.layout{display:flex;min-height:580px}aside{width:295px;padding:32px 24px;background:#edf0f6}
small{display:block;font-size:13px;letter-spacing:1px;margin-bottom:20px;color:#627088}
#sidebar{background:white;padding:16px;border-radius:8px;font-size:17px}
main{padding:54px;width:720px}h1{font-size:30px;margin:0 0 32px}label{display:block;margin-bottom:12px}
input{display:block;width:440px;font:inherit;padding:13px;border:1px solid #97a3b7;border-radius:7px}
button{font:inherit;margin-top:22px;padding:11px 22px;border-radius:7px;border:0;background:#215bce;color:white;cursor:pointer}
#status{margin-top:18px;min-height:30px}#copy{padding:20px;background:white;margin-top:20px}
</style></head><body><header>Implement and Prove — synthetic test application</header>
<div class="layout"><aside><small>WORKFLOWS</small><div id="sidebar" data-testid="sidebar-workflow-name"></div></aside>
<main><h1>Workflow settings</h1><label for="name">Name</label><input id="name">
<button id="save">Save</button><div id="status" role="status"></div>
${duplicateEnabled ? '<button id="duplicate">Duplicate</button><div id="copy" hidden></div>' : ''}
</main></div><script>
const sidebar = document.querySelector('#sidebar');
const input = document.querySelector('#name');
sidebar.textContent = input.value = localStorage.getItem('workflow-name') || 'Test Workflow';
document.querySelector('#save').onclick = () => {
  localStorage.setItem('workflow-name', input.value);
  ${liveRefresh ? 'sidebar.textContent = input.value;' : '// BUG: sidebar is not updated after saving.'}
  document.querySelector('#status').textContent = 'Saved';
};
${duplicateEnabled ? `document.querySelector('#duplicate').onclick = () => { const copy = document.querySelector('#copy'); copy.hidden = false; copy.textContent = input.value + ' (copy)'; };` : ''}
</script></body></html>`;
const server = http.createServer((req, res) => {
  if (req.url === '/favicon.ico') { res.writeHead(204); res.end(); return; }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html);
});
server.listen(Number(process.env.PORT || 4173), '127.0.0.1', () => console.log(`LISTENING ${server.address().port}`));
