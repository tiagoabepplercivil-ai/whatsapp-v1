// Carregador do leitor do WhatsApp Web. O código de leitura fica em app/wa-reader.js (atualizável pelo ⟳);
// aqui só pedimos a versão ativa ao processo principal e a executamos neste mundo isolado.
const { ipcRenderer, webFrame } = require('electron');
let src = '';
try { src = ipcRenderer.sendSync('wv1:reader-src') || ''; } catch (e) { console.error('leitor do WhatsApp: sem código', e); }
if (src) {
  try { new Function('ipcRenderer', src)(ipcRenderer); }
  catch (e) { // página com CSP sem 'unsafe-eval': roda pelo mundo isolado (999 = o deste preload)
    globalThis.__wv1ipc = ipcRenderer;
    webFrame.executeJavaScriptInIsolatedWorld(999, [{ code: '(function(ipcRenderer){' + src + '\n})(globalThis.__wv1ipc)' }]).catch(e2 => console.error('leitor do WhatsApp:', e, e2));
  }
}
