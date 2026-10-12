'use strict';

const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { Repository, createExample, EXTENSIONS } = require('./repository.cjs');

const projectRoot = path.resolve(__dirname, '..');
const testDataHome = !app.isPackaged && process.env.GALAXY_DATA_HOME;
if (testDataHome && !path.isAbsolute(testDataHome)) throw new Error('GALAXY_DATA_HOME must be an absolute path');
if (!app.isPackaged) app.setPath('userData', testDataHome || path.join(projectRoot, '.runtime', 'appdata'));
const hiddenTest = !app.isPackaged && process.env.GALAXY_TEST_HIDDEN === '1';
const devUrl = !app.isPackaged && process.env.GALAXY_DEV_URL;
if (devUrl && !/^http:\/\/127\.0\.0\.1:\d+\/?$/.test(devUrl)) throw new Error('Invalid development URL');
const indexUrl = pathToFileURL(path.join(projectRoot, 'dist', 'index.html')).href;
let window, repository, operation = Promise.resolve();
const acquired = app.requestSingleInstanceLock();
if (!acquired) app.quit();

function settingPath() { return path.join(app.getPath('userData'), 'library.json'); }
function rememberLibrary() { fs.mkdirSync(app.getPath('userData'), { recursive: true }); const target = settingPath(); const temp = target + '.tmp'; fs.writeFileSync(temp, JSON.stringify({ path: repository.root })); fs.renameSync(temp, target); }
function validSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return false;
  const url = event.senderFrame.url.split('#')[0].split('?')[0];
  return devUrl ? url === `${devUrl.replace(/\/$/, '')}/` : url === indexUrl;
}
function boundedId(value) { if (typeof value !== 'string' || !value || value.length > 200) throw new Error('资料标识无效'); return value; }
async function useRepository(next) { const previous = repository; repository = next; rememberLibrary(); previous?.close(); return repository.snapshot(); }
function register(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!validSender(event)) throw new Error('拒绝未授权页面请求');
    const result = operation.then(() => handler(...args)); operation = result.catch(() => {}); return result;
  });
}

function registerIpc() {
  register('galaxy:snapshot', () => repository.snapshot());
  register('galaxy:choose-library', async () => {
    const result = await dialog.showOpenDialog(window, { title: '选择本地资料库文件夹', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return null;
    if (path.resolve(result.filePaths[0]) === repository.root) { repository.scan(); repository.persist(); return repository.snapshot(); }
    return useRepository(await Repository.open(result.filePaths[0]));
  });
  register('galaxy:import-files', async () => {
    const result = await dialog.showOpenDialog(window, { title: '导入教学资料（重复内容自动跳过）', properties: ['openFile', 'multiSelections'], filters: [{ name: '教学资料', extensions: [...EXTENSIONS].map(ext => ext.slice(1)) }] });
    if (result.canceled) return null;
    return repository.importFiles(result.filePaths);
  });
  register('galaxy:command', command => {
    if (!command || typeof command !== 'object' || Buffer.byteLength(JSON.stringify(command)) > 12 * 1024 * 1024) throw new Error('操作数据无效或过大');
    return repository.command(command);
  });
  register('galaxy:read-document', key => repository.readDocument(boundedId(key)));
  register('galaxy:open-document', async key => { const error = await shell.openPath(repository.openPath(boundedId(key))); if (error) throw new Error('无法打开该文件，请检查本机是否安装对应应用'); });
  register('galaxy:backup', async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(window, { title: '保存完整资料库备份', defaultPath: path.join(app.getPath('documents'), `知识星系备份-${stamp}.zip`), filters: [{ name: '知识星系备份', extensions: ['zip'] }] });
    if (result.canceled || !result.filePath) return null;
    return repository.backup(result.filePath);
  });
  register('galaxy:restore-backup', async () => {
    const archive = await dialog.showOpenDialog(window, { title: '选择知识星系备份', properties: ['openFile'], filters: [{ name: '知识星系备份', extensions: ['zip'] }] });
    if (archive.canceled || !archive.filePaths[0]) return null;
    const parent = await dialog.showOpenDialog(window, { title: '选择恢复位置（会创建新的资料库文件夹）', properties: ['openDirectory', 'createDirectory'] });
    if (parent.canceled || !parent.filePaths[0]) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const destination = path.join(parent.filePaths[0], `知识星系恢复-${stamp}`);
    return useRepository(await Repository.restoreBackup(archive.filePaths[0], destination));
  });
}

async function initializeRepository() {
  try { const saved = JSON.parse(fs.readFileSync(settingPath(), 'utf8')); if (typeof saved.path === 'string' && fs.existsSync(saved.path)) { repository = await Repository.open(saved.path); return; } } catch (error) { console.warn('Library could not be reopened:', error.message); }
  const exampleRoot = app.isPackaged || testDataHome ? path.join(app.getPath('userData'), '示例资料库') : path.join(projectRoot, '.runtime', '示例资料库');
  repository = await createExample(exampleRoot); rememberLibrary();
}
async function createWindow() {
  window = new BrowserWindow({ width: 1520, height: 980, minWidth: 1080, minHeight: 720, show: false, title: '知识星系', backgroundColor: '#101719', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.once('ready-to-show', () => { if (!hiddenTest) window?.show(); });
  window.on('closed', () => { window = null; });
  if (devUrl) await window.loadURL(devUrl); else await window.loadFile(path.join(projectRoot, 'dist', 'index.html'));
}
if (acquired) {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    await initializeRepository(); registerIpc(); await createWindow();
  }).catch(error => { dialog.showErrorBox('知识星系无法启动', error.message); app.quit(); });
  app.on('activate', () => { if (!window && repository) createWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.on('before-quit', () => { try { repository?.persist(); } catch (error) { console.error(error); } });
}
