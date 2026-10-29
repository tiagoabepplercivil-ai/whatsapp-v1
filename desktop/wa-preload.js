// Carregador do leitor do WhatsApp Web. O código de leitura fica em app/wa-reader.js (atualizável pelo ⟳);
// aqui só pedimos a versão ativa ao processo principal e a executamos neste mundo isolado.
// webFrame vai junto para o leitor instalar na página o captador de áudio (o WhatsApp toca os áudios no mundo da página).
const { ipcRenderer, webFrame } = require('electron');
let src = '';
try { src = ipcRenderer.sendSync('wv1:reader-src') || ''; } catch (e) { console.error('leitor do WhatsApp: sem código', e); }
if (src) {
  try { new Function('ipcRenderer', 'webFrame', src)(ipcRenderer, webFrame); }
  catch (e) { // página com CSP sem 'unsafe-eval': roda pelo mundo isolado (999 = o deste preload)
    globalThis.__wv1ipc = ipcRenderer; globalThis.__wv1wf = webFrame;
    webFrame.executeJavaScriptInIsolatedWorld(999, [{ code: '(function(ipcRenderer, webFrame){' + src + '\n})(globalThis.__wv1ipc, globalThis.__wv1wf)' }]).catch(e2 => console.error('leitor do WhatsApp:', e, e2));
  }
}
