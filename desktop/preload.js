// ponte mínima entre o processo principal e a interface do app
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('wv1desk', {
  onToAssistant: cb => ipcRenderer.on('wv1:to-assistant', (_, d) => cb(d)),
  onWaUnread: cb => ipcRenderer.on('wv1:wa-unread', (_, n) => cb(n)),
  checkUpdate: () => ipcRenderer.invoke('wv1:update-check'),
  applyUpdate: () => ipcRenderer.invoke('wv1:update-apply'),
  driveSet: dir => ipcRenderer.invoke('wv1:drive-set', dir),
  drivePick: () => ipcRenderer.invoke('wv1:drive-pick'),
  driveOpen: () => ipcRenderer.invoke('wv1:drive-open'),
  saveFile: d => ipcRenderer.invoke('wv1:save-file', d),
  onSaved: cb => ipcRenderer.on('wv1:saved', (_, d) => cb(d)),
  logAppend: d => ipcRenderer.invoke('wv1:log-append', d),
  summaryAppend: d => ipcRenderer.invoke('wv1:summary-append', d),
  logSearch: d => ipcRenderer.invoke('wv1:log-search', d),
  logRead: d => ipcRenderer.invoke('wv1:log-read', d),
  summaryRecent: d => ipcRenderer.invoke('wv1:summary-recent', d),
  notesSave: d => ipcRenderer.invoke('wv1:notes-save', d)
});
