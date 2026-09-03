const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flowMindDesktop', Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    chrome: process.versions.chrome,
    electron: process.versions.electron
  }),
  getAppInfo: () => ipcRenderer.invoke('desktop:get-app-info'),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', String(url)),
  chooseMarkdownRoot: () => ipcRenderer.invoke('desktop:choose-markdown-root'),
  scanMarkdownRoot: (rootId) => ipcRenderer.invoke('desktop:scan-markdown-root', String(rootId)),
  confirmMarkdownWrite: (request) => ipcRenderer.invoke('desktop:confirm-markdown-write', request),
  confirmMarkdownRename: (request) => ipcRenderer.invoke('desktop:confirm-markdown-rename', request)
}));
