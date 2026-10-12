'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const id = value => { if (typeof value !== 'string' || !value || value.length > 200) throw new Error('资料标识无效'); return value; };
contextBridge.exposeInMainWorld('galaxy', Object.freeze({
  snapshot: () => ipcRenderer.invoke('galaxy:snapshot'),
  chooseLibrary: () => ipcRenderer.invoke('galaxy:choose-library'),
  importFiles: () => ipcRenderer.invoke('galaxy:import-files'),
  command: command => {
    const text = JSON.stringify(command);
    if (!text || text.length > 12 * 1024 * 1024) throw new Error('操作数据无效或过大');
    return ipcRenderer.invoke('galaxy:command', JSON.parse(text));
  },
  readDocument: key => ipcRenderer.invoke('galaxy:read-document', id(key)),
  openDocument: key => ipcRenderer.invoke('galaxy:open-document', id(key)),
  backup: () => ipcRenderer.invoke('galaxy:backup'),
  restoreBackup: () => ipcRenderer.invoke('galaxy:restore-backup'),
}));
