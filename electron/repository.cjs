'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const initSqlJs = require('sql.js');
const JSZip = require('jszip');

const EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.md', '.markdown', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MIME = { '.pdf': 'application/pdf', '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.md': 'text/markdown', '.markdown': 'text/markdown', '.txt': 'text/plain', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
const KINDS = new Set(['试卷', '解析', '笔记', '教材', '图片', '其他']);
const FACET_TYPES = new Set(['single', 'multi', 'tree', 'text', 'number', 'date']);
const NODE_TYPES = new Set(['章节', '知识点', '专题']);
const MAX_FILE_BYTES = 200 * 1024 * 1024;
const MAX_BACKUP_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 10000;
const MAX_CATALOG_BYTES = 32 * 1024 * 1024;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAMPLE_TOPICS=['有理数','数轴与绝对值','有理数的加减','整式的加减','去括号与合并同类项','一元一次方程','移项与系数化一','方程应用题','几何图形初步','直线射线与线段','角的比较与运算','相交线与平行线','实数与平方根','平面直角坐标系','二元一次方程组','不等式与不等式组','数据的收集与整理'];
let sqlPromise;

function getSql() {
  if (!sqlPromise) sqlPromise = initSqlJs({ locateFile: file => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')), file) });
  return sqlPromise;
}
function assert(condition, message) { if (!condition) throw new Error(message); }
function id() { return crypto.randomUUID(); }
function string(value, label = '名称', max = 200) { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label}不能为空且最多 ${max} 个字符`); return value.trim(); }
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function hashFile(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function relativePath(value, allowEmpty = false) {
  assert(typeof value === 'string' && value.length <= 1024 && !value.includes('\0'), '文件路径无效');
  const normalized = value.replace(/\\/g, '/');
  if (allowEmpty && normalized === '') return '';
  assert(normalized && !path.posix.isAbsolute(normalized) && !/^[a-z]:/i.test(normalized) && !normalized.includes(':') && !normalized.split('/').some(p => !p || p === '..' || p === '.' || /[<>"|?*]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p)), '路径必须位于当前资料库内');
  assert(normalized.split('/')[0].toLowerCase() !== '.galaxy', '不能访问应用数据目录');
  return normalized;
}
function fileName(value) { const name = relativePath(string(value, '文件名')); assert(!name.includes('/'), '文件名不能包含目录'); return name; }
function isInside(root, candidate) { const rel = path.relative(root, candidate); return rel === '' || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel)); }
function safePath(root, relative, options = {}) {
  const rel = options.internal ? relative.replace(/\\/g, '/') : relativePath(relative, options.allowEmpty);
  const target = path.resolve(root, rel);
  assert(isInside(root, target), '路径越过资料库边界');
  let cursor = target;
  while (!fs.existsSync(cursor)) { const parent = path.dirname(cursor); assert(parent !== cursor, '路径无效'); cursor = parent; }
  const actual = fs.realpathSync(cursor);
  assert(isInside(fs.realpathSync(root), actual), '文件链接不能指向资料库外');
  // Reject symlinks anywhere along the resolved path, including internal metadata.
  let current = root;
  for (const part of path.relative(root, cursor).split(path.sep).filter(Boolean)) { current = path.join(current, part); assert(!fs.lstatSync(current).isSymbolicLink(), '资料库中不支持符号链接'); }
  return target;
}
function uniquePath(root, folder, name) {
  const parsed = path.parse(name);
  for (let n = 0; n < 10000; n++) { const candidate = [folder, n ? `${parsed.name} (${n})${parsed.ext}` : name].filter(Boolean).join('/'); if (!fs.existsSync(safePath(root, candidate))) return candidate; }
  throw new Error('同名文件过多，请调整文件名');
}
function zipBytes(entry, maximum) {
  return new Promise((resolve, reject) => {
    let total = 0; const chunks = [];
    const stream = entry.internalStream('nodebuffer');
    stream.on('data', chunk => { total += chunk.length; if (total > maximum) { stream.pause(); reject(new Error('备份解压内容超过大小限制')); } else chunks.push(chunk); });
    stream.on('error', reject); stream.on('end', () => resolve(Buffer.concat(chunks))); stream.resume();
  });
}
function writeNewFile(target, content, undo) {
  const handle=fs.openSync(target,'wx');
  undo.push(()=>{ if(fs.existsSync(target))fs.unlinkSync(target); });
  try { fs.writeFileSync(handle,content); } finally { fs.closeSync(handle); }
}

class Repository {
  static async open(root, { isExample = false } = {}) {
    assert(typeof root === 'string' && path.isAbsolute(root), '请选择完整的资料库目录');
    fs.mkdirSync(root, { recursive: true });
    assert(!fs.lstatSync(root).isSymbolicLink(), '资料库目录不能是符号链接');
    const realRoot = fs.realpathSync(root);
    const metadata = safePath(realRoot, '.galaxy', { internal: true });
    fs.mkdirSync(metadata, { recursive: true });
    const catalog = safePath(realRoot, '.galaxy/catalog.sqlite', { internal: true });
    const SQL = await getSql();
    if(fs.existsSync(catalog))assert(fs.statSync(catalog).size<=MAX_CATALOG_BYTES,'资料库元数据超过大小限制');
    const db = fs.existsSync(catalog) ? new SQL.Database(fs.readFileSync(catalog)) : new SQL.Database();
    const repo = new Repository(realRoot, db);
    repo.setup(isExample);
    repo.validateCatalog();
    repo.scan();
    repo.persist();
    return repo;
  }
  constructor(root, db) { this.root = root; this.db = db; }
  setup(isExample) {
    this.db.run(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS facets (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS relation_types (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS relations (id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS layout (id TEXT PRIMARY KEY, data TEXT NOT NULL);`);
    const version = this.meta('schemaVersion');
    assert(!version || version === '1', '此资料库版本暂不支持');
    if (!version) {
      this.setMeta('schemaVersion', '1'); this.setMeta('isExample', String(isExample));
      for (const name of ['考查', '包含', '解释', '引用', '先修于']) this.put('relation_types', { id: id(), name });
    }
  }
  meta(key) { const s = this.db.prepare('SELECT value FROM metadata WHERE key = ?'); try { s.bind([key]); return s.step() ? s.getAsObject().value : null; } finally { s.free(); } }
  setMeta(key, value) { this.db.run('INSERT OR REPLACE INTO metadata (key,value) VALUES (?,?)', [key, value]); }
  all(table) { assert(['documents','facets','tags','knowledge','relation_types','relations','layout'].includes(table), '数据表无效'); const result = this.db.exec(`SELECT id,data FROM ${table}`); return result.length ? result[0].values.map(row => {const value=JSON.parse(row[1]);assert(plain(value)&&value.id===row[0],'资料库记录损坏');return value;}) : []; }
  put(table, value) { assert(['documents','facets','tags','knowledge','relation_types','relations','layout'].includes(table), '数据表无效'); this.db.run(`INSERT OR REPLACE INTO ${table} (id,data) VALUES (?,?)`, [value.id, JSON.stringify(value)]); }
  remove(table, key) { assert(['relations','layout'].includes(table), '数据表无效'); this.db.run(`DELETE FROM ${table} WHERE id = ?`, [key]); }
  persist() { const temp = safePath(this.root, '.galaxy/catalog.sqlite.tmp', { internal: true }); const target = safePath(this.root, '.galaxy/catalog.sqlite', { internal: true }); fs.writeFileSync(temp, Buffer.from(this.db.export())); fs.renameSync(temp, target); }
  close() { this.db.close(); }
  async atomic(action) {
    const SQL=await getSql(),before=Buffer.from(this.db.export()),undo=[];
    this.db.run('BEGIN IMMEDIATE TRANSACTION');
    try { action(undo); this.validateCatalog(); this.db.run('COMMIT'); this.persist(); return this.snapshot(); }
    catch(error) {
      try { this.db.run('ROLLBACK'); } catch {}
      this.db.close(); this.db=new SQL.Database(before);
      const recovery=[]; for(const reverse of undo.reverse()) { try { reverse(); } catch(failure) { recovery.push(failure.message); } }
      if(recovery.length) throw new Error(`${error.message}；文件回滚未完成，请检查资料库：${recovery.join('；')}`);
      throw error;
    }
  }
  scan() {
    const byPath = new Map(this.all('documents').map(d => [d.path.toLowerCase(), d]));
    let count = byPath.size;
    let folders = 0;
    const visit = (folder, rel = '', depth = 0) => {
      if (depth > 30 || folders++ > 20000) return;
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
        const relative = rel ? `${rel}/${entry.name}` : entry.name;
        try { relativePath(relative); } catch { continue; }
        const absolute = safePath(this.root, relative);
        if (entry.isDirectory()) { visit(absolute, relative, depth + 1); continue; }
        if (!entry.isFile() || !EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        const stat = fs.statSync(absolute); if (stat.size > MAX_FILE_BYTES || count >= MAX_ENTRIES) continue;
        const previous = byPath.get(relative.toLowerCase());
        if (previous) { if (previous.size !== stat.size || (previous.fileModifiedAt || previous.updatedAt) !== stat.mtime.toISOString()) { previous.size = stat.size; previous.fileModifiedAt=stat.mtime.toISOString(); previous.updatedAt=new Date(Math.max(Date.parse(previous.updatedAt),stat.mtime.getTime())).toISOString(); this.put('documents', previous); } }
        else { this.put('documents', this.makeDocument(relative, stat)); count++; }
      }
    };
    visit(this.root);
  }
  makeDocument(relative, stat) { const extension = path.extname(relative).toLowerCase(); return { id: id(), title: path.basename(relative, extension), path: relative, extension, kind: ['.md','.markdown','.txt'].includes(extension) ? '笔记' : MIME[extension]?.startsWith('image/') ? '图片' : '其他', size: stat.size, updatedAt: stat.mtime.toISOString(), fileModifiedAt:stat.mtime.toISOString(), tagIds: [], values: {} }; }
  document(key) { const doc = this.all('documents').find(d => d.id === key); assert(doc, '未找到该资料'); return doc; }
  documentPath(doc) { return safePath(this.root, doc.path, { internal: Boolean(doc.trashed) }); }
  snapshot() {
    const facets = this.all('facets'), tags = this.all('tags'), knowledge = this.all('knowledge'), relationTypes = this.all('relation_types');
    const documents = this.all('documents').map(d => {
      let missing = true; try { missing = !fs.statSync(this.documentPath(d)).isFile(); } catch { /* Missing and unsafe files remain visible but cannot be read. */ }
      const { originalPath, hash, fileModifiedAt, ...publicDoc } = d;
      return { ...publicDoc, extension: d.extension.slice(1), missing };
    });
    const entityIds = new Set([...documents.map(d => d.id), ...knowledge.map(k => k.id), ...tags.map(t => t.id), ...facets.flatMap(f => f.options.map(o => o.id))]), typeIds = new Set(relationTypes.map(t => t.id));
    const relations = this.all('relations').filter(r => entityIds.has(r.source) && entityIds.has(r.target) && typeIds.has(r.typeId));
    const graphLayout = Object.fromEntries(this.all('layout').filter(p => entityIds.has(p.id)).map(({id, ...position}) => [id, position]));
    return { schemaVersion: 1, library: { name: path.basename(this.root), path: this.root, mode: 'desktop', isExample: this.meta('isExample') === 'true' }, documents, facets, tags, knowledge, relationTypes, relations, graphLayout };
  }
  entityIds(includeTrashed = false) { return new Set([...this.all('documents').filter(d => includeTrashed || !d.trashed).map(d => d.id), ...this.all('knowledge').map(k => k.id), ...this.all('tags').map(t => t.id), ...this.all('facets').flatMap(f => f.options.map(o => o.id))]); }
  validateCatalog() {
    const documents=this.all('documents'),facets=this.all('facets'),tags=this.all('tags'),knowledge=this.all('knowledge'),types=this.all('relation_types'),relations=this.all('relations'),layout=this.all('layout');
    assert(documents.length<=MAX_ENTRIES&&facets.length<=200&&tags.length<=5000&&knowledge.length<=MAX_ENTRIES&&types.length<=500&&relations.length<=100000&&layout.length<=30000,'资料库记录数量超限');
    const allIds=new Set(); const add=value=>{assert(typeof value==='string'&&UUID.test(value)&&!allIds.has(value),'资料库记录 ID 无效或重复');allIds.add(value);};
    for(const record of [...documents,...facets,...tags,...knowledge,...types,...relations])add(record.id);
    for(const tag of tags){string(tag.name,'标签名称');assert(/^#[0-9a-f]{6}$/i.test(tag.color),'资料库标签颜色无效');}
    for(const facet of facets){string(facet.name,'分类名称');assert(FACET_TYPES.has(facet.type)&&Array.isArray(facet.options)&&facet.options.length<=500,'资料库分类无效');for(const option of facet.options){assert(plain(option),'资料库分类选项无效');add(option.id);string(option.label,'分类选项');if(option.parentId)assert(facet.type==='tree'&&facet.options.some(o=>o.id===option.parentId)&&option.parentId!==option.id,'资料库父分类无效');}for(const option of facet.options){let current=option;const visited=new Set();while(current.parentId){assert(!visited.has(current.id),'资料库分类存在循环');visited.add(current.id);current=facet.options.find(o=>o.id===current.parentId);}}}
    const tagIds=new Set(tags.map(t=>t.id));
    for(const doc of documents)if(doc.fileModifiedAt!==undefined)assert(typeof doc.fileModifiedAt==='string'&&!Number.isNaN(Date.parse(doc.fileModifiedAt)),'资料库文件修改时间无效');
    for(const doc of documents){string(doc.title,'资料标题',512);assert(EXTENSIONS.has(doc.extension)&&KINDS.has(doc.kind)&&Number.isSafeInteger(doc.size)&&doc.size>=0&&typeof doc.updatedAt==='string'&&!Number.isNaN(Date.parse(doc.updatedAt))&&Array.isArray(doc.tagIds)&&doc.tagIds.every(t=>tagIds.has(t))&&(doc.trashed===undefined||typeof doc.trashed==='boolean'),'资料库文档信息无效');const rel=doc.trashed?`.galaxy/trash/${doc.id}${doc.extension}`:relativePath(doc.path);assert(rel===doc.path&&path.extname(rel).toLowerCase()===doc.extension,'资料库文档路径无效');if(doc.trashed)relativePath(doc.originalPath);this.validateValues(doc.values,facets);}
    for(const node of knowledge){string(node.title,'知识标题');assert(NODE_TYPES.has(node.type),'资料库知识节点类型无效');if(node.description!==undefined)assert(typeof node.description==='string'&&node.description.length<=10000,'资料库知识描述无效');}
    for(const type of types)string(type.name,'关系名称');
    const entities=this.entityIds(true),typeIds=new Set(types.map(t=>t.id));for(const r of relations)assert(entities.has(r.source)&&entities.has(r.target)&&r.source!==r.target&&typeIds.has(r.typeId),'资料库关联引用无效');
    for(const p of layout)assert(entities.has(p.id)&&['x','y','z'].every(axis=>typeof p[axis]==='number'&&Number.isFinite(p[axis])&&Math.abs(p[axis])<1e7),'资料库布局无效');
  }
  validateValues(values, knownFacets) {
    assert(plain(values) && Object.keys(values).length <= 200, '分类属性无效');
    const facets = knownFacets || this.all('facets');
    for (const [key, value] of Object.entries(values)) {
      const facet = facets.find(f => f.id === key); assert(facet, '分类不存在');
      if (value === null) continue;
      if (facet.type === 'number') assert(typeof value === 'number' && Number.isFinite(value), '数字分类必须填写有效数字');
      else if (facet.type === 'text') assert(typeof value === 'string' && value.length <= 2000, '文本分类过长');
      else if (facet.type === 'date') assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value, '日期分类格式应为有效的 YYYY-MM-DD');
      else if (facet.type === 'single') assert(typeof value === 'string' && facet.options.some(o => o.id === value), '分类选项不存在');
      else { assert(Array.isArray(value) && value.length <= 500 && value.every(v => typeof v === 'string' && facet.options.some(o => o.id === v)), '分类选项不存在'); assert(new Set(value).size === value.length, '分类选项不能重复'); }
    }
  }
  async command(command) {
    assert(plain(command) && typeof command.type === 'string', '操作格式无效');
    const types = { 'add-tag':['name','color'], 'add-facet':['name','fieldType'], 'add-option':['facetId','label','parentId'], 'update-document':['id','patch'], 'add-knowledge':['title','nodeType'], 'add-relation':['source','target','typeId'], 'remove-relation':['id'], 'add-relation-type':['name'], 'create-note':['title','content'], 'save-note':['id','content'], 'rename-document':['id','fileName'], 'move-document':['id','folder'], 'trash-document':['id'], 'restore-document':['id'], 'save-layout':['positions'] };
    assert(types[command.type] && Object.keys(command).every(key => key === 'type' || types[command.type].includes(key)), '不支持的操作');
    const c = command;
    return this.atomic(undo=>{
    switch(c.type) {
      case 'add-tag': { const name = string(c.name); assert(/^#[0-9a-f]{6}$/i.test(c.color), '标签颜色应为十六进制颜色'); assert(!this.all('tags').some(t => t.name === name), '标签已存在'); this.put('tags', { id:id(), name, color:c.color }); break; }
      case 'add-facet': { const name = string(c.name); assert(FACET_TYPES.has(c.fieldType), '分类类型无效'); assert(!this.all('facets').some(f => f.name === name), '分类已存在'); this.put('facets', {id:id(), name, type:c.fieldType, options:[]}); break; }
      case 'add-option': { const facet = this.all('facets').find(f => f.id === c.facetId); assert(facet && ['single','multi','tree'].includes(facet.type), '此分类不支持选项'); const label = string(c.label); assert(!facet.options.some(o => o.label === label && o.parentId === c.parentId), '同级选项已存在'); if (c.parentId) assert(facet.type === 'tree' && facet.options.some(o => o.id === c.parentId), '父选项不存在'); facet.options.push({ id:id(), label, ...(c.parentId ? {parentId:c.parentId} : {}) }); this.put('facets', facet); break; }
      case 'update-document': { const doc = this.document(c.id); assert(plain(c.patch) && Object.keys(c.patch).every(k => ['title','kind','tagIds','values'].includes(k)), '资料修改格式无效'); const patch = c.patch; if ('title' in patch) patch.title = string(patch.title, '标题'); if ('kind' in patch) assert(KINDS.has(patch.kind), '资料类型无效'); if ('tagIds' in patch) { const ids = new Set(this.all('tags').map(t => t.id)); assert(Array.isArray(patch.tagIds) && patch.tagIds.every(t => ids.has(t)) && new Set(patch.tagIds).size === patch.tagIds.length, '标签不存在或重复'); } if ('values' in patch) this.validateValues(patch.values); this.put('documents', {...doc,...patch,fileModifiedAt:doc.fileModifiedAt || doc.updatedAt,updatedAt:new Date().toISOString()}); break; }
      case 'add-knowledge': { const title = string(c.title, '标题'); assert(NODE_TYPES.has(c.nodeType), '节点类型无效'); this.put('knowledge', {id:id(),title,type:c.nodeType}); break; }
      case 'add-relation-type': { const name = string(c.name); assert(!this.all('relation_types').some(r => r.name === name), '关系类型已存在'); this.put('relation_types', {id:id(), name}); break; }
      case 'add-relation': { const ids = this.entityIds(); assert(ids.has(c.source) && ids.has(c.target) && c.source !== c.target, '关联端点不存在或指向自身'); assert(this.all('relation_types').some(t => t.id === c.typeId), '关联类型不存在'); assert(!this.all('relations').some(r => r.source === c.source && r.target === c.target && r.typeId === c.typeId), '该关联已存在'); this.put('relations', {id:id(),source:c.source,target:c.target,typeId:c.typeId}); break; }
      case 'remove-relation': { assert(this.all('relations').some(r => r.id === c.id), '关联不存在'); this.remove('relations',c.id); break; }
      case 'create-note': { const title = string(c.title, '标题'); const content = c.content ?? ''; assert(typeof content === 'string' && Buffer.byteLength(content) <= 10*1024*1024, '笔记内容过大'); const cleanName = title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/g,'') || '未命名笔记'; const relative = uniquePath(this.root, '笔记', fileName(cleanName + '.md')); const absolute = safePath(this.root, relative); fs.mkdirSync(path.dirname(absolute),{recursive:true}); writeNewFile(absolute,content,undo); const doc = this.makeDocument(relative,fs.statSync(absolute)); doc.title = title; this.put('documents',doc); break; }
      case 'save-note': { const doc = this.document(c.id); assert(!doc.trashed && ['.md','.markdown','.txt'].includes(doc.extension), '只能保存文本笔记'); assert(typeof c.content === 'string' && Buffer.byteLength(c.content) <= 10*1024*1024, '笔记内容过大'); const absolute = this.documentPath(doc); assert(fs.existsSync(absolute),'原文件已丢失，请重新定位'); const previous=fs.readFileSync(absolute),oldStat=fs.statSync(absolute); undo.push(()=>{fs.writeFileSync(absolute,previous);fs.utimesSync(absolute,oldStat.atime,oldStat.mtime);}); fs.writeFileSync(absolute,c.content); const stat = fs.statSync(absolute); this.put('documents',{...doc,size:stat.size,updatedAt:stat.mtime.toISOString(),fileModifiedAt:stat.mtime.toISOString()}); break; }
      case 'rename-document': { const doc = this.document(c.id); assert(!doc.trashed,'请先恢复资料'); const name = fileName(c.fileName); assert(path.extname(name).toLowerCase() === doc.extension, '改名时不能更改文件类型'); const folder = path.posix.dirname(doc.path); this.relocate(doc,[folder === '.' ? '' : folder,name].filter(Boolean).join('/'),undo); doc.title = path.basename(name,doc.extension); this.put('documents',doc); break; }
      case 'move-document': { const doc = this.document(c.id); assert(!doc.trashed,'请先恢复资料'); const folder = relativePath(c.folder,true); this.relocate(doc,[folder,path.posix.basename(doc.path)].filter(Boolean).join('/'),undo); this.put('documents',doc); break; }
      case 'trash-document': { const doc = this.document(c.id); assert(!doc.trashed,'资料已在回收站'); const original = this.documentPath(doc); assert(fs.existsSync(original),'原文件已丢失'); const trash = `.galaxy/trash/${doc.id}${doc.extension}`; const target = safePath(this.root,trash,{internal:true}); fs.mkdirSync(path.dirname(target),{recursive:true}); assert(!fs.existsSync(target),'回收站中存在同名文件'); fs.renameSync(original,target); undo.push(()=>fs.renameSync(target,original)); this.put('documents',{...doc,originalPath:doc.path,path:trash,trashed:true}); break; }
      case 'restore-document': { const doc = this.document(c.id); assert(doc.trashed && doc.originalPath,'资料不在回收站'); const original = relativePath(doc.originalPath); const folder = path.posix.dirname(original); const targetRel = uniquePath(this.root,folder === '.' ? '' : folder,path.posix.basename(original)); const target = safePath(this.root,targetRel); fs.mkdirSync(path.dirname(target),{recursive:true}); const previous=this.documentPath(doc); fs.renameSync(previous,target); undo.push(()=>fs.renameSync(target,previous)); doc.path = targetRel; delete doc.originalPath; delete doc.trashed; this.put('documents',doc); break; }
      case 'save-layout': { assert(plain(c.positions) && Object.keys(c.positions).length <= MAX_ENTRIES,'布局数据无效'); const ids = this.entityIds(true); for (const [key,p] of Object.entries(c.positions)) { assert(ids.has(key) && plain(p) && Object.keys(p).length === 3 && ['x','y','z'].every(axis => typeof p[axis] === 'number' && Number.isFinite(p[axis]) && Math.abs(p[axis]) < 1e7),'布局坐标无效'); } for (const [key,p] of Object.entries(c.positions)) this.put('layout',{id:key,...p}); break; }
      default: throw new Error('不支持的操作');
    }
    });
  }
  relocate(doc, relative, undo) { const target = safePath(this.root,relative); const previous = this.documentPath(doc); assert(fs.existsSync(previous),'原文件已丢失'); if (target === previous) return; assert(!fs.existsSync(target),'目标已有同名文件，未覆盖'); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.renameSync(previous,target); undo.push(()=>fs.renameSync(target,previous)); doc.path = relative; }
  async importFiles(files) {
    assert(Array.isArray(files) && files.length <= 1000, '一次最多导入 1000 个文件');
    const docs = this.all('documents'); const hashes = new Set();
    assert(docs.length + files.length <= MAX_ENTRIES, '资料库最多支持 10000 个文件');
    for (const file of files) { assert(typeof file === 'string' && path.isAbsolute(file), '导入路径无效'); assert(!fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isFile(),'只能导入普通文件'); assert(EXTENSIONS.has(path.extname(file).toLowerCase()),'不支持此文件类型'); assert(fs.statSync(file).size <= MAX_FILE_BYTES,'单个文件不能超过 200 MB'); }
    for (const d of docs) { try { if (!d.trashed && fs.existsSync(this.documentPath(d))) hashes.add(hashFile(this.documentPath(d))); } catch {} }
    return this.atomic(undo=>{
    for (const file of files) {
      assert(typeof file === 'string' && path.isAbsolute(file), '导入路径无效');
      assert(!fs.lstatSync(file).isSymbolicLink() && fs.statSync(file).isFile(),'只能导入普通文件');
      const extension = path.extname(file).toLowerCase(); assert(EXTENSIONS.has(extension),'不支持此文件类型'); assert(fs.statSync(file).size <= MAX_FILE_BYTES,'单个文件不能超过 200 MB');
      const hash = hashFile(file); if (hashes.has(hash)) continue;
      const relative = uniquePath(this.root,'导入',fileName(path.basename(file))); const target = safePath(this.root,relative); fs.mkdirSync(path.dirname(target),{recursive:true}); writeNewFile(target,fs.readFileSync(file),undo); this.put('documents',this.makeDocument(relative,fs.statSync(target))); hashes.add(hash);
    }
    });
  }
  readDocument(key) { const doc = this.document(key); assert(!doc.trashed,'请先恢复回收站资料'); const absolute = this.documentPath(doc); const stat = fs.statSync(absolute); assert(stat.isFile() && stat.size <= MAX_FILE_BYTES,'文件过大或无效'); const bytes = fs.readFileSync(absolute); return {mime:MIME[doc.extension] || 'application/octet-stream',base64:bytes.toString('base64'),...(['.md','.markdown','.txt'].includes(doc.extension) ? {text:bytes.toString('utf8')} : {})}; }
  openPath(key) { const doc = this.document(key); assert(!doc.trashed && EXTENSIONS.has(doc.extension),'此文件不能直接打开'); const absolute = this.documentPath(doc); assert(fs.statSync(absolute).isFile(),'原文件已丢失'); assert(path.extname(absolute).toLowerCase() === doc.extension,'文件类型不一致'); return absolute; }
  async backup(output) {
    assert(typeof output === 'string' && path.isAbsolute(output),'备份路径无效');
    this.persist(); const zip = new JSZip(); let total = 0; const files = [];
    const catalogBytes=Buffer.from(this.db.export()); assert(catalogBytes.length<=MAX_CATALOG_BYTES,'资料库元数据超过 32 MB'); zip.file('catalog.sqlite',catalogBytes);
    for (const doc of this.all('documents')) { let absolute; try { absolute=this.documentPath(doc); if (!fs.existsSync(absolute)) continue; } catch { continue; } const stat=fs.statSync(absolute); assert(stat.isFile() && stat.size <= MAX_FILE_BYTES,'备份中存在过大文件'); total += stat.size; assert(total<=MAX_BACKUP_BYTES && files.length<MAX_ENTRIES,'备份超过 512 MB 或文件过多'); const bytes=fs.readFileSync(absolute); zip.file(`files/${doc.path}`,bytes); files.push({path:doc.path,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}); }
    zip.file('manifest.json',JSON.stringify({format:'knowledge-galaxy',version:1,createdAt:new Date().toISOString(),catalogSha256:crypto.createHash('sha256').update(catalogBytes).digest('hex'),files},null,2));
    const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
    assert(!fs.existsSync(output),'备份文件已存在，请选择新名称'); fs.writeFileSync(output,bytes,{flag:'wx'}); return {path:output};
  }
  static async restoreBackup(archive,destination) {
    assert(typeof archive==='string' && path.isAbsolute(archive) && fs.statSync(archive).size<=MAX_BACKUP_BYTES,'备份文件无效或过大');
    assert(typeof destination==='string' && path.isAbsolute(destination),'恢复目录无效');
    assert(!fs.existsSync(destination),'恢复位置已存在，请使用新目录');
    const zip=await JSZip.loadAsync(fs.readFileSync(archive));
    const entries=Object.values(zip.files); assert(entries.length<=MAX_ENTRIES+1000,'备份文件数量过多'); let declared=0;
    for (const entry of entries) {
      const name=entry.unsafeOriginalName || entry.name; assert(name===entry.name && !name.includes('\\') && !name.startsWith('/') && !/^[a-z]:/i.test(name) && !name.split('/').some(p=>p==='..'||p==='.'),'备份包含不安全路径');
      assert(entry.dir || name==='manifest.json' || name==='catalog.sqlite' || name.startsWith('files/'),'备份包含未知内容');
      const size=entry._data?.uncompressedSize || 0; assert(size<=MAX_FILE_BYTES,'备份单文件过大'); declared+=size; assert(declared<=MAX_BACKUP_BYTES,'备份解压后超过 512 MB');
    }
    const manifestEntry=zip.file('manifest.json'),catalogEntry=zip.file('catalog.sqlite'); assert(manifestEntry&&catalogEntry,'备份缺少清单或数据库');
    const manifest=JSON.parse((await zipBytes(manifestEntry,5*1024*1024)).toString('utf8')); assert(manifest.format==='knowledge-galaxy'&&manifest.version===1&&Array.isArray(manifest.files)&&manifest.files.length<=MAX_ENTRIES,'备份格式或版本不支持');
    const catalog=await zipBytes(catalogEntry,MAX_CATALOG_BYTES); assert(typeof manifest.catalogSha256==='string'&&crypto.createHash('sha256').update(catalog).digest('hex')===manifest.catalogSha256,'备份数据库校验失败'); const SQL=await getSql(); let validation;
    try {
      validation=new SQL.Database(catalog); const integrity=validation.exec('PRAGMA integrity_check'); assert(integrity[0]?.values[0]?.[0]==='ok','备份数据库损坏');
      const repo=new Repository(destination,validation); assert(repo.meta('schemaVersion')==='1','备份数据版本不支持');repo.validateCatalog();
      const docs=repo.all('documents'),known=new Set(docs.map(d=>d.path));
      const seen=new Set(); const payload=[]; let actual=0;
      for (const file of manifest.files) { assert(plain(file)&&typeof file.path==='string'&&known.has(file.path)&&!seen.has(file.path)&&Number.isSafeInteger(file.size)&&file.size>=0&&file.size<=MAX_FILE_BYTES,'备份文件清单无效'); seen.add(file.path); const entry=zip.file(`files/${file.path}`); assert(entry,'备份文件缺失'); const bytes=await zipBytes(entry,Math.min(file.size,MAX_BACKUP_BYTES-actual)); actual+=bytes.length; assert(actual<=MAX_BACKUP_BYTES&&bytes.length===file.size&&crypto.createHash('sha256').update(bytes).digest('hex')===file.sha256,'备份文件校验失败'); payload.push([file.path,bytes]); }
      const entities=repo.entityIds(true), relationTypes=new Set(repo.all('relation_types').map(r=>r.id)); assert(repo.all('relations').every(r=>entities.has(r.source)&&entities.has(r.target)&&relationTypes.has(r.typeId)),'备份关联数据无效');
      fs.mkdirSync(destination,{recursive:true});
      try { fs.mkdirSync(safePath(destination,'.galaxy',{internal:true}),{recursive:true}); for (const [relative,bytes] of payload) { const target=safePath(destination,relative,{internal:true}); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,bytes,{flag:'wx'}); const doc=docs.find(d=>d.path===relative); const date=new Date(doc.fileModifiedAt || doc.updatedAt); if (!Number.isNaN(date.getTime())) fs.utimesSync(target,date,date); } repo.root=fs.realpathSync(destination); repo.setMeta('isExample','false'); repo.persist(); } catch(error) { throw new Error(`恢复未完成，保留已写入文件供检查：${error.message}`); }
    } finally { validation?.close(); }
    return Repository.open(destination);
  }
}

function smallPdf() {
  const stream='BT /F1 22 Tf 50 770 Td (NoteOrbit - Sample Exam) Tj 0 -42 Td /F1 12 Tf (Grade 7 Mathematics / Linear Equations) Tj 0 -32 Td (1. Solve: 3x + 5 = 20) Tj 0 -26 Td (2. Solve: 2x - 7 = 9) Tj 0 -26 Td (3. Explain your reasoning in a linked note.) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let body='%PDF-1.4\n',offsets=[0]; objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${o}\nendobj\n`;}); const xref=Buffer.byteLength(body); body+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return body;
}
async function createExample(root) {
  if (!fs.existsSync(path.join(root,'.galaxy','catalog.sqlite'))) {
    fs.mkdirSync(path.join(root,'试卷','七年级'),{recursive:true}); fs.mkdirSync(path.join(root,'笔记'),{recursive:true});
    fs.writeFileSync(path.join(root,'试卷','七年级','一元一次方程练习.pdf'),smallPdf());
    fs.writeFileSync(path.join(root,'笔记','方程解题方法.md'),'# 一元一次方程解题方法\n\n## 解题步骤\n\n1. 去分母、去括号\n2. 移项、合并同类项\n3. 系数化为 1\n\n## 易错提醒\n\n移项时要变号，最后代回原式检验。\n');
    fs.writeFileSync(path.join(root,'笔记','七年级复习计划.md'),'# 七年级复习计划\n\n- [ ] 一元一次方程\n- [ ] 几何图形初步\n- [ ] 整式的加减\n\n在右侧面板给资料添加自定义分类、标签和关联。\n');
    for (const [index,topic] of SAMPLE_TOPICS.entries()) { const folder=path.join(root,'试卷',index<11?'七年级':'八年级');fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,`${String(index+1).padStart(2,'0')} ${topic}练习.md`),`# ${topic}练习\n\n这是一份可编辑的示例教学资料，用于体验文件分类、知识关联与星系浏览。\n\n## 练习目标\n\n理解${topic}的基本概念，并能说明解题依据。\n\n## 教学记录\n\n- 课前回顾相关知识。\n- 整理一道典型例题。\n- 记录容易出错的步骤。\n`); }
  }
  const repo=await Repository.open(root,{isExample:true});
  if (!repo.meta('exampleSeeded')) {
    const grade={id:id(),name:'年级',type:'single',options:[{id:id(),label:'七年级'},{id:id(),label:'八年级'},{id:id(),label:'九年级'}]};
    const subject={id:id(),name:'科目',type:'single',options:[{id:id(),label:'数学'},{id:id(),label:'语文'},{id:id(),label:'英语'}]};
    const chapters={id:id(),name:'章节',type:'tree',options:[]}; const parent={id:id(),label:'七年级上册'}; chapters.options=[parent,{id:id(),label:'一元一次方程',parentId:parent.id},{id:id(),label:'几何图形初步',parentId:parent.id},{id:id(),label:'整式的加减',parentId:parent.id}];
    const laterParent={id:id(),label:'八年级数学'}; chapters.options.push(laterParent); SAMPLE_TOPICS.forEach((topic,index)=>{if(!chapters.options.some(o=>o.label===topic))chapters.options.push({id:id(),label:topic,parentId:index<11?parent.id:laterParent.id});});
    [grade,subject,chapters].forEach(f=>repo.put('facets',f));
    const tag={id:id(),name:'重点',color:'#dba458'},tag2={id:id(),name:'待复习',color:'#72b8a2'}; [tag,tag2].forEach(t=>repo.put('tags',t));
    const nodes=[{id:id(),title:'一元一次方程',type:'章节'},{id:id(),title:'移项与合并同类项',type:'知识点'},{id:id(),title:'等式的性质',type:'知识点'},{id:id(),title:'七年级数学复习',type:'专题'},{id:id(),title:'几何图形初步',type:'章节'},{id:id(),title:'整式的加减',type:'章节'}]; SAMPLE_TOPICS.forEach(topic=>{if(!nodes.some(n=>n.title===topic))nodes.push({id:id(),title:topic,type:'知识点'});}); nodes.forEach(n=>repo.put('knowledge',n));
    const types=repo.all('relation_types'); const relation=(source,target,name)=>repo.put('relations',{id:id(),source,target,typeId:types.find(t=>t.name===name).id});
    for (const doc of repo.all('documents')) { const topic=SAMPLE_TOPICS.find(t=>doc.title.replace(/^\d+ /,'')===`${t}练习`)||'一元一次方程'; const option=chapters.options.find(o=>o.label===topic); doc.values={[grade.id]:grade.options[doc.path.includes('八年级')?1:0].id,[subject.id]:subject.options[0].id,[chapters.id]:[option.id]}; doc.tagIds=[tag.id,...(doc.extension!=='.pdf'?[tag2.id]:[])]; if (doc.path.startsWith('试卷/')) {doc.kind='试卷';relation(doc.id,nodes.find(n=>n.title===topic).id,'考查');if(topic==='一元一次方程')relation(doc.id,nodes[1].id,'考查');} else relation(doc.id,nodes[0].id,'引用'); repo.put('documents',doc); }
    relation(nodes[0].id,nodes[1].id,'包含');relation(nodes[0].id,nodes[2].id,'包含');relation(nodes[2].id,nodes[1].id,'先修于');[nodes[0],nodes[4],nodes[5]].forEach(n=>relation(nodes[3].id,n.id,'包含'));
    const relationTitles=[['有理数','数轴与绝对值','包含'],['有理数','有理数的加减','包含'],['整式的加减','去括号与合并同类项','包含'],['一元一次方程','移项与系数化一','包含'],['一元一次方程','方程应用题','包含'],['几何图形初步','直线射线与线段','包含'],['几何图形初步','角的比较与运算','包含'],['一元一次方程','二元一次方程组','先修于'],['有理数','实数与平方根','先修于'],['直线射线与线段','相交线与平行线','先修于']]; relationTitles.forEach(([source,target,name])=>relation(nodes.find(n=>n.title===source).id,nodes.find(n=>n.title===target).id,name));
    repo.setMeta('exampleSeeded','true');repo.persist();
  }
  return repo;
}

module.exports={Repository,createExample,EXTENSIONS,MIME,relativePath,safePath};
