const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sbk', {
  screenshot: () => ipcRenderer.invoke('sbk:screenshot'),
  saveRecording: (bytes) => ipcRenderer.invoke('sbk:save-recording', bytes),
  openFolder: (kind) => ipcRenderer.invoke('sbk:open-folder', kind),
  openExternal: (url) => ipcRenderer.invoke('sbk:open-external', url),
  recordingState: (on) => ipcRenderer.invoke('sbk:recording-state', on),
  onScreenshot: (cb) => ipcRenderer.on('sbk:screenshot', (_e, r) => cb(r)),
  onToggleRecord: (cb) => ipcRenderer.on('sbk:toggle-record', () => cb()),
});
