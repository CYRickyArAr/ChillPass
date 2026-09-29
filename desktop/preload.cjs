'use strict';
const { contextBridge, ipcRenderer } = require('electron');
// Deliberately expose named operations, never ipcRenderer, fs, exec or arbitrary channels.
const subscribe = (channel, callback) => {
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
contextBridge.exposeInMainWorld('chillpassDesktop', {
  platform: 'desktop',
  windowMinimize: () => ipcRenderer.invoke('desktop:minimize'),
  windowMaximize: () => ipcRenderer.invoke('desktop:maximize'),
  windowClose: () => ipcRenderer.invoke('desktop:close'),
  windowIsMaximized: () => ipcRenderer.invoke('desktop:is-maximized'),
  onWindowMaximizeChange: callback => subscribe('desktop:maximized', callback),
  enterFocusMode: () => ipcRenderer.invoke('desktop:fullscreen', true),
  exitFocusMode: () => ipcRenderer.invoke('desktop:fullscreen', false),
  isFullScreen: () => ipcRenderer.invoke('desktop:is-fullscreen'),
  onFocusExited: callback => subscribe('desktop:focus-exited', callback),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  openExternalUrl: url => ipcRenderer.invoke('desktop:open-external', url),
  onPrepareClose: callback => subscribe('desktop:prepare-close', async id => {
    try {
      await callback();
      await ipcRenderer.invoke('desktop:close-result', id, null);
    } catch (error) {
      await ipcRenderer.invoke('desktop:close-result', id, String(error?.message || error));
    }
  }),
});
