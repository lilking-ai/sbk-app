// SBK desktop app: main process
const { app, BrowserWindow, ipcMain, globalShortcut, desktopCapturer, screen, session, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');

let win;

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function folder(kind) {
  const base = app.getPath(kind === 'video' ? 'videos' : 'pictures');
  const dir = path.join(base, 'SBK');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function notify(title, body) {
  if (Notification.isSupported()) new Notification({ title, body, icon: path.join(__dirname, 'renderer/assets/logo.png') }).show();
}

async function takeScreenshot() {
  const d = screen.getPrimaryDisplay();
  const sz = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: sz });
  if (!sources.length) throw new Error('No screen found');
  const img = sources[0].thumbnail;
  const file = path.join(folder('picture'), `SBK_${stamp()}.png`);
  fs.writeFileSync(file, img.toPNG());
  // small JPEG preview the user can share in chat
  const preview = img.resize({ width: Math.min(1280, sz.width) }).toJPEG(70).toString('base64');
  notify('📸 Screenshot saved', file);
  return { file, preview: `data:image/jpeg;base64,${preview}` };
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: '#080A18',
    title: 'SBK',
    icon: path.join(__dirname, 'renderer/assets/logo.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer/index.html'));

  // links open in the real browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) { e.preventDefault(); if (/^https:\/\//.test(url)) shell.openExternal(url); }
  });
}

app.whenReady().then(() => {
  // screen recording: hand the primary screen (+ system audio on Windows) to getDisplayMedia
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      callback({ video: sources[0], audio: process.platform === 'win32' ? 'loopback' : undefined });
    });
  });

  createWindow();

  globalShortcut.register('F8', async () => {
    try {
      const r = await takeScreenshot();
      win?.webContents.send('sbk:screenshot', r);
    } catch (e) { notify('Screenshot failed', String(e.message || e)); }
  });
  globalShortcut.register('F9', () => win?.webContents.send('sbk:toggle-record'));
});

ipcMain.handle('sbk:screenshot', () => takeScreenshot());

ipcMain.handle('sbk:save-recording', (_e, bytes) => {
  const file = path.join(folder('video'), `SBK_${stamp()}.webm`);
  fs.writeFileSync(file, Buffer.from(bytes));
  notify('🎥 Recording saved', file);
  return file;
});

ipcMain.handle('sbk:open-folder', (_e, kind) => shell.openPath(folder(kind)));
ipcMain.handle('sbk:open-external', (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle('sbk:recording-state', (_e, on) => {
  win?.setTitle(on ? '🔴 SBK (recording)' : 'SBK');
  if (on) notify('🔴 Recording started', 'Press F9 again to stop');
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
