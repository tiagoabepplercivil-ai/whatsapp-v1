// ponte mínima entre o processo principal e a interface do app
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wv1desk', {
  onToAssistant: cb => ipcRenderer.on('wv1:to-assistant', (_, d) => cb(d)),
  onWaUnread: cb => ipcRenderer.on('wv1:wa-unread', (_, n) => cb(n)),
  checkUpdate: () => ipcRenderer.invoke('wv1:update-check'),
  applyUpdate: () => ipcRenderer.invoke('wv1:update-apply')
});
