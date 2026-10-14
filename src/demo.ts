import type {
  GalaxyAPI,
  LibraryCommand,
  LibraryDocument,
  ReadDocumentResult,
  WorkspaceState,
} from './domain';
import { isImage, isTextNote, maxFileBytes, supportedExtensions } from './lib/files';

const KEY = 'knowledge-galaxy-demo-v1';
const notes = new Map<string, string>();
const today = new Date().toISOString();
export function createDemoState(): WorkspaceState {
  const state: WorkspaceState = {
    schemaVersion: 1,
    library: {
      name: '教学示例资料库',
      path: '浏览器示例 · 数据仅保存在当前浏览器',
      mode: 'demo',
      isExample: true,
    },
    facets: [
      {
        id: 'grade',
        name: '年级',
        type: 'single',
        options: [
          { id: 'grade7', label: '七年级' },
          { id: 'grade8', label: '八年级' },
          { id: 'grade9', label: '九年级' },
        ],
      },
      {
        id: 'subject',
        name: '科目',
        type: 'single',
        options: [
          { id: 'math', label: '数学' },
          { id: 'chinese', label: '语文' },
          { id: 'english', label: '英语' },
        ],
      },
      {
        id: 'chapter',
        name: '章节',
        type: 'multi',
        options: [
          { id: 'equations', label: '一元一次方程' },
          { id: 'geometry', label: '几何基础' },
          { id: 'linear', label: '一次函数' },
          { id: 'triangle', label: '三角形' },
          { id: 'quadratic', label: '二次函数' },
        ],
      },
      {
        id: 'difficulty',
        name: '难度',
        type: 'single',
        options: [
          { id: 'basic', label: '基础' },
          { id: 'advanced', label: '提高' },
        ],
      },
      { id: 'year', name: '年份', type: 'number', options: [] },
    ],
    tags: [
      { id: 'tag-important', name: '重点', color: '#8b5cf6' },
      { id: 'tag-mistakes', name: '易错题', color: '#f59e0b' },
      { id: 'tag-print', name: '待打印', color: '#06b6d4' },
      { id: 'tag-taught', name: '已讲解', color: '#10b981' },
    ],
    documents: [],
    knowledge: [
      { id: 'knowledge-equality', title: '等式性质', type: '知识点' },
      { id: 'knowledge-application', title: '方程应用', type: '知识点' },
      { id: 'knowledge-slope', title: '斜率与截距', type: '知识点' },
      { id: 'knowledge-image', title: '函数图像', type: '知识点' },
      { id: 'knowledge-congruent', title: '三角形全等判定', type: '知识点' },
      { id: 'knowledge-vertex', title: '抛物线顶点', type: '知识点' },
      { id: 'topic-review', title: '期末复习专题', type: '专题' },
    ],
    relationTypes: [
      { id: 'covers', name: '考查' },
      { id: 'contains', name: '包含' },
      { id: 'explains', name: '解释' },
      { id: 'references', name: '引用' },
      { id: 'prerequisite', name: '相关基础' },
    ],
    relations: [],
  };
  const examples = [
    [
      '七年级数学期末综合卷',
      'grade7',
      ['equations', 'geometry'],
      '试卷',
      'pdf',
      ['tag-print', 'tag-important'],
    ],
    ['一元一次方程专项训练', 'grade7', ['equations'], '试卷', 'pdf', ['tag-mistakes']],
    ['几何基础章节测验', 'grade7', ['geometry'], '试卷', 'pdf', ['tag-taught']],
    ['七年级期末卷解析', 'grade7', ['equations', 'geometry'], '解析', 'md', ['tag-important']],
    ['等式性质课堂笔记', 'grade7', ['equations'], '笔记', 'md', []],
    ['一次函数章节训练', 'grade8', ['linear'], '试卷', 'pdf', ['tag-print']],
    ['八年级数学期中复习卷', 'grade8', ['linear', 'triangle'], '试卷', 'pdf', ['tag-important']],
    ['三角形全等专项训练', 'grade8', ['triangle'], '试卷', 'pdf', ['tag-mistakes']],
    ['一次函数解题方法', 'grade8', ['linear'], '笔记', 'md', ['tag-important']],
    ['二次函数综合训练', 'grade9', ['quadratic'], '试卷', 'pdf', ['tag-print', 'tag-mistakes']],
    ['九年级数学复习资料', 'grade9', ['quadratic'], '教材', 'md', ['tag-important']],
    ['函数图像错题整理', 'grade9', ['linear', 'quadratic'], '笔记', 'md', ['tag-mistakes']],
  ] as const;
  examples.forEach((row, i) => {
    const [title, grade, chapters, kind, extension, tagIds] = row;
    const id = `doc-${i + 1}`;
    const doc: LibraryDocument = {
      id,
      title,
      path: `${kind === '笔记' || kind === '解析' ? '笔记' : '试卷'}/${title}.${extension}`,
      extension,
      kind,
      size: extension === 'pdf' ? 1100 : 500,
      updatedAt: today,
      tagIds: [...tagIds],
      values: {
        grade,
        subject: 'math',
        chapter: [...chapters],
        difficulty: i % 3 ? 'basic' : 'advanced',
        year: 2026,
      },
    };
    state.documents.push(doc);
    notes.set(
      id,
      `# ${title}\n\n这是 NoteOrbit 的示例笔记，用于体验本地资料整理与关联浏览。\n\n## 重点\n\n- 梳理章节中的核心概念。\n- 对照试卷记录解题方法。\n- 用分类、标签和关联串起相关资料。\n\n你可以编辑这段内容并保存。\n`,
    );
  });
  const rel = (source: string, target: string, typeId: string) =>
    state.relations.push({ id: `rel-${state.relations.length + 1}`, source, target, typeId });
  rel('equations', 'knowledge-equality', 'contains');
  rel('equations', 'knowledge-application', 'contains');
  rel('linear', 'knowledge-slope', 'contains');
  rel('linear', 'knowledge-image', 'contains');
  rel('triangle', 'knowledge-congruent', 'contains');
  rel('quadratic', 'knowledge-vertex', 'contains');
  rel('quadratic', 'knowledge-image', 'contains');
  rel('linear', 'equations', 'prerequisite');
  rel('doc-1', 'knowledge-application', 'covers');
  rel('doc-2', 'knowledge-equality', 'covers');
  rel('doc-4', 'doc-1', 'explains');
  rel('doc-5', 'knowledge-equality', 'references');
  rel('doc-6', 'knowledge-slope', 'covers');
  rel('doc-8', 'knowledge-congruent', 'covers');
  rel('doc-9', 'knowledge-image', 'references');
  rel('doc-10', 'knowledge-vertex', 'covers');
  rel('doc-12', 'knowledge-image', 'references');
  rel('topic-review', 'doc-1', 'references');
  rel('topic-review', 'doc-7', 'references');
  rel('topic-review', 'doc-10', 'references');
  return state;
}
function load(): WorkspaceState {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (stored?.schemaVersion === 1) return stored;
  } catch {
    /* new demo */
  }
  const result = createDemoState();
  localStorage.setItem(KEY, JSON.stringify(result));
  return result;
}
function save(state: WorkspaceState) {
  localStorage.setItem(KEY, JSON.stringify(state));
  return structuredClone(state);
}
function nonempty(value: string) {
  const name = value.trim();
  if (!name) throw new Error('名称不能为空。');
  return name;
}
const id = () => crypto.randomUUID();
const entities = (s: WorkspaceState) =>
  new Set([
    ...s.documents.filter((d) => !d.trashed).map((d) => d.id),
    ...s.knowledge.map((n) => n.id),
    ...s.tags.map((t) => t.id),
    ...s.facets.flatMap((f) => f.options.map((o) => o.id)),
  ]);
async function fileDB() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('knowledge-galaxy-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function putFile(key: string, value: ReadDocumentResult) {
  const db = await fileDB();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('files', 'readwrite');
      tx.objectStore('files').put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error || new Error('浏览器文件保存失败。'));
    });
  } finally {
    db.close();
  }
}
async function getFile(key: string) {
  const db = await fileDB();
  try {
    return await new Promise<ReadDocumentResult | undefined>((resolve, reject) => {
      const request = db.transaction('files').objectStore('files').get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
function pdf(): string {
  const stream =
    'BT /F1 24 Tf 64 740 Td (NoteOrbit) Tj 0 -40 Td /F1 14 Tf (Example teaching document) Tj 0 -32 Td (Local PDF preview is ready.) Tj 0 -24 Td (This sample is for application testing.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let content = '%PDF-1.4\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(content.length);
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const start = content.length;
  content += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((n) => `${String(n).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`;
  return btoa(content);
}
async function command(command: LibraryCommand): Promise<WorkspaceState> {
  const state = load();
  const doc = 'id' in command ? state.documents.find((d) => d.id === command.id) : undefined;
  switch (command.type) {
    case 'add-tag':
      if (state.tags.some((t) => t.name === command.name.trim()))
        throw new Error('这个标签已经存在。');
      state.tags.push({ id: id(), name: nonempty(command.name), color: command.color });
      break;
    case 'add-facet':
      if (state.facets.some((f) => f.name === command.name.trim()))
        throw new Error('这个分类已经存在。');
      state.facets.push({
        id: id(),
        name: nonempty(command.name),
        type: command.fieldType,
        options: [],
      });
      break;
    case 'add-option': {
      const facet = state.facets.find((f) => f.id === command.facetId);
      if (!facet) throw new Error('分类不存在。');
      if (
        facet.options.some(
          (o) => o.label === command.label.trim() && o.parentId === command.parentId,
        )
      )
        throw new Error('这个选项已经存在。');
      facet.options.push({ id: id(), label: nonempty(command.label), parentId: command.parentId });
      break;
    }
    case 'update-document':
      if (!doc) throw new Error('资料不存在。');
      Object.assign(doc, command.patch, {
        values: { ...doc.values, ...command.patch.values },
        updatedAt: new Date().toISOString(),
      });
      break;
    case 'tag-documents': {
      if (
        !command.ids.length ||
        new Set(command.ids).size !== command.ids.length ||
        !state.tags.some((tag) => tag.id === command.tagId)
      )
        throw new Error('请选择有效的资料和标签。');
      const documents = new Map(state.documents.map((doc) => [doc.id, doc]));
      const selected = command.ids.map((key) => {
        const doc = documents.get(key);
        if (!doc || doc.trashed) throw new Error('资料不存在或已移入回收站。');
        return doc;
      });
      const updatedAt = new Date().toISOString();
      for (const doc of selected)
        if (!doc.tagIds.includes(command.tagId)) {
          doc.tagIds.push(command.tagId);
          doc.updatedAt = updatedAt;
        }
      break;
    }
    case 'add-knowledge':
      state.knowledge.push({ id: id(), title: nonempty(command.title), type: command.nodeType });
      break;
    case 'add-relation-type':
      if (state.relationTypes.some((t) => t.name === command.name.trim()))
        throw new Error('关系类型已经存在。');
      state.relationTypes.push({ id: id(), name: nonempty(command.name) });
      break;
    case 'add-relation': {
      const valid = entities(state);
      if (
        !valid.has(command.source) ||
        !valid.has(command.target) ||
        !state.relationTypes.some((t) => t.id === command.typeId)
      )
        throw new Error('请选择有效的关联对象和关系类型。');
      if (command.source === command.target) throw new Error('请选择两个不同的对象。');
      if (
        state.relations.some(
          (r) =>
            r.source === command.source &&
            r.target === command.target &&
            r.typeId === command.typeId,
        )
      )
        throw new Error('这条关联已经存在。');
      state.relations.push({
        id: id(),
        source: command.source,
        target: command.target,
        typeId: command.typeId,
      });
      break;
    }
    case 'remove-relation':
      state.relations = state.relations.filter((r) => r.id !== command.id);
      break;
    case 'create-note': {
      const key = id();
      const title = nonempty(command.title);
      const content = command.content ?? '';
      state.documents.push({
        id: key,
        title,
        path: `笔记/${title}.md`,
        extension: 'md',
        kind: '笔记',
        size: new TextEncoder().encode(content).length,
        updatedAt: new Date().toISOString(),
        tagIds: [],
        values: {},
      });
      await putFile(key, { mime: 'text/markdown', text: content, base64: '' });
      break;
    }
    case 'save-note':
      if (!doc || doc.trashed || !isTextNote(doc.extension))
        throw new Error('此文件不支持文本编辑。');
      await putFile(doc.id, {
        mime: doc.extension === 'txt' ? 'text/plain' : 'text/markdown',
        text: command.content,
        base64: '',
      });
      doc.updatedAt = new Date().toISOString();
      doc.size = new TextEncoder().encode(command.content).length;
      break;
    case 'rename-document':
      if (!doc) throw new Error('资料不存在。');
      {
        const name = nonempty(command.fileName);
        if (/[\\/]/.test(name)) throw new Error('文件名不能包含路径。');
        if (name.split('.').at(-1)?.toLowerCase() !== doc.extension)
          throw new Error('改名时不能更改文件类型。');
        doc.path = doc.path.slice(0, doc.path.lastIndexOf('/') + 1) + name;
        doc.title = name.replace(/\.[^.]+$/, '');
      }
      break;
    case 'move-document':
      if (!doc) throw new Error('资料不存在。');
      {
        const folder = command.folder.replaceAll('\\', '/');
        if (
          folder &&
          (folder.startsWith('/') ||
            folder.split('/').some((part) => !part || part === '..' || part === '.'))
        )
          throw new Error('文件夹无效。');
        doc.path = [folder, doc.path.split('/').at(-1)].filter(Boolean).join('/');
      }
      break;
    case 'trash-document':
      if (doc) doc.trashed = true;
      break;
    case 'restore-document':
      if (doc) doc.trashed = false;
      break;
    case 'save-layout':
      state.graphLayout = command.positions;
      break;
    default:
      throw new Error('不支持的操作。');
  }
  return save(state);
}
export const demoAPI: GalaxyAPI = {
  snapshot: async () => structuredClone(load()),
  command,
  chooseLibrary: async () => {
    throw new Error('浏览器中显示的是示例资料库。请启动桌面应用来选择本地文件夹。');
  },
  importFiles: async () =>
    await new Promise<WorkspaceState | null>((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = supportedExtensions.map((extension) => `.${extension}`).join(',');
      input.oncancel = () => resolve(null);
      input.onchange = async () => {
        try {
          const state = load();
          const files = Array.from(input.files || []);
          if (files.length > 1000) throw new Error('一次最多导入 1000 个文件。');
          for (const file of files) {
            const extension = file.name.split('.').at(-1)?.toLowerCase() || '';
            if (!supportedExtensions.includes(extension)) throw new Error('不支持此文件类型。');
            if (file.size > maxFileBytes) throw new Error('单个文件不能超过 200 MB。');
          }
          for (const file of files) {
            const extension = file.name.split('.').at(-1)?.toLowerCase() || '';
            const bytes = new Uint8Array(await file.arrayBuffer());
            let binary = '';
            for (let i = 0; i < bytes.length; i += 8192)
              binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
            const key = id();
            const text = isTextNote(extension) ? new TextDecoder().decode(bytes) : undefined;
            await putFile(key, {
              mime: file.type || 'application/octet-stream',
              base64: btoa(binary),
              text,
            });
            state.documents.push({
              id: key,
              title: file.name.replace(/\.[^.]+$/, ''),
              path: `导入/${file.name}`,
              extension,
              kind: isTextNote(extension) ? '笔记' : isImage(extension) ? '图片' : '其他',
              size: file.size,
              updatedAt: new Date().toISOString(),
              tagIds: [],
              values: {},
            });
          }
          resolve(save(state));
        } catch (error) {
          reject(error);
        }
      };
      input.click();
    }),
  readDocument: async (key) => {
    const doc = load().documents.find((d) => d.id === key);
    if (!doc || doc.trashed) throw new Error('资料不存在或已移入回收站。');
    const stored = await getFile(key);
    if (stored) return stored;
    if (doc.extension === 'pdf') return { mime: 'application/pdf', base64: pdf() };
    if (!notes.size) createDemoState();
    return { mime: 'text/markdown', base64: '', text: notes.get(key) || `# ${doc.title}\n\n` };
  },
  openDocument: async () => {
    throw new Error('浏览器示例支持内置预览；打开本地原文件请使用桌面应用。');
  },
  backup: async () => {
    throw new Error('完整资料库备份请在桌面应用中使用。');
  },
  restoreBackup: async () => {
    throw new Error('恢复资料库备份请在桌面应用中使用。');
  },
};
