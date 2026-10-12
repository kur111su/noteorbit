import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownToLine, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight,
  CircleHelp, Database, File, FileImage, FileText, Folder, FolderOpen, GitBranch,
  HardDrive, Layers3, Link2, LoaderCircle, MoreHorizontal, Network, Plus, RotateCcw,
  Search, Settings2, Sparkles, Tag as TagIcon, Trash2, Upload, X,
} from 'lucide-react';
import { api } from './api';
import type { DocumentKind, Facet, FacetType, FacetValue, LibraryCommand, LibraryDocument, WorkspaceState } from './domain';
const GalaxyView = lazy(() => import('./components/GalaxyView'));
const DocumentPreview = lazy(() => import('./components/DocumentPreview'));
import { useDialogFocus } from './components/useDialogFocus';

type Page = 'documents' | 'galaxy' | 'organize' | 'trash';
type Modal = 'note' | 'tag' | 'facet' | 'option' | 'knowledge' | 'relation' | 'relationType' | 'rename' | 'move' | null;
const kinds: DocumentKind[] = ['试卷', '解析', '笔记', '教材', '图片', '其他'];
const facetTypes: { value: FacetType; label: string }[] = [
  { value: 'single', label: '单选' }, { value: 'multi', label: '多选' }, { value: 'tree', label: '层级' },
  { value: 'text', label: '文本' }, { value: 'number', label: '数字' }, { value: 'date', label: '日期' },
];
const colors = ['#4d8b82', '#4d7db5', '#ad7b56', '#9474b6', '#b86c82', '#909b59', '#cc9949', '#70829b'];
function folderOf(path: string) { const parts = path.replaceAll('\\', '/').split('/'); parts.pop(); return parts.join('/') || '资料库根目录'; }
function shortFolder(path: string) { const folder = folderOf(path); const parts = folder.split('/'); return parts.slice(-2).join('/'); }
function formatDate(date: string) { const value = new Date(date); return Number.isNaN(value.getTime()) ? '—' : value.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' }).replace('/', '月') + '日'; }
function sizeLabel(size: number) { return size > 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`; }
function FileGlyph({ document, small = false }: { document: LibraryDocument; small?: boolean }) {
  const Icon = document.kind === '图片' ? FileImage : document.kind === '笔记' ? BookOpen : FileText;
  return <span className={`file-glyph kind-${document.kind} ${small ? 'small' : ''}`}><Icon size={small ? 17 : 23} strokeWidth={1.7} />{!small && <span>{document.extension.replace('.', '').toUpperCase() || 'FILE'}</span>}</span>;
}
function Empty({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{children}</p></div>;
}
function optionLabel(facet: Facet, id: string): string {
  const chain: string[] = []; const visited = new Set<string>(); let current = facet.options.find(item => item.id === id);
  while (current && !visited.has(current.id)) { visited.add(current.id); chain.unshift(current.label); current = current.parentId ? facet.options.find(item => item.id === current?.parentId) : undefined; }
  return chain.join(' / ') || id;
}
function matchesFacet(document: LibraryDocument, facet: Facet | undefined, id: string, filter: string) {
  if (!filter) return true;
  const accepted = new Set([filter]);
  if (facet?.type === 'tree') {
    let changed = true;
    while (changed) { changed = false; for (const option of facet.options) { if (option.parentId && accepted.has(option.parentId) && !accepted.has(option.id)) { accepted.add(option.id); changed = true; } } }
  }
  const values = Array.isArray(document.values[id]) ? document.values[id] as string[] : [String(document.values[id] ?? '')];
  return values.some(value => accepted.has(value));
}

export default function App() {
  const [state, setState] = useState<WorkspaceState | null>(null);
  const [page, setPage] = useState<Page>('documents');
  const [query, setQuery] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const [facetFilters, setFacetFilters] = useState<Record<string, string>>({});
  const [selectedId, setSelectedId] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [sort, setSort] = useState('updated');
  const [modal, setModal] = useState<Modal>(null);
  const [optionFacetId, setOptionFacetId] = useState('');
  const [preview, setPreview] = useState<LibraryDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);

  useEffect(() => { api.snapshot().then(value => { setState(value); setSelectedId(value.documents.find(doc => !doc.trashed)?.id || ''); }).catch(error => setToast({ text: String(error.message || error), error: true })); }, []);
  useEffect(() => { if (!toast) return; const timeout = window.setTimeout(() => setToast(null), 5200); return () => window.clearTimeout(timeout); }, [toast]);

  async function perform(action: () => Promise<WorkspaceState | null>, success?: string, reset = false) {
    setBusy(true);
    try { const value = await action(); if (value) {
      setState(value);
      const validIds = new Set([...value.documents.map(doc => doc.id), ...value.knowledge.map(node => node.id), ...value.tags.map(tag => tag.id), ...value.facets.flatMap(facet => facet.options.map(option => option.id))]);
      if (reset) { clearFilters(); setPreview(null); setPage('documents'); setSelectedId(value.documents.find(doc => !doc.trashed)?.id || ''); }
      else { setSelectedId(current => validIds.has(current) ? current : value.documents.find(doc => !doc.trashed)?.id || ''); setChecked(current => current.filter(id => validIds.has(id))); }
      if (success) setToast({ text: success }); return true;
    } return false; }
    catch (error) { setToast({ text: error instanceof Error ? error.message : String(error), error: true }); return false; }
    finally { setBusy(false); }
  }
  async function command(value: LibraryCommand, message?: string) { return perform(() => api.command(value), message); }
  async function openOriginal(document: LibraryDocument) {
    try { await api.openDocument(document.id); } catch (error) { setToast({ text: error instanceof Error ? error.message : String(error), error: true }); }
  }
  async function backup() {
    setBusy(true); setMoreOpen(false);
    try { const result = await api.backup(); if (result) setToast({ text: `备份已保存：${result.path}` }); }
    catch (error) { setToast({ text: error instanceof Error ? error.message : String(error), error: true }); } finally { setBusy(false); }
  }
  const activeDocuments = state?.documents.filter(doc => !doc.trashed) || [];
  const folders = useMemo(() => [...new Set((state?.documents || []).filter(doc => !doc.trashed).map(doc => folderOf(doc.path)))].sort(), [state]);
  const visibleDocuments = useMemo(() => {
    if (!state) return [];
    const q = query.trim().toLocaleLowerCase();
    return state.documents.filter(doc => Boolean(doc.trashed) === (page === 'trash'))
      .filter(doc => !kindFilter || doc.kind === kindFilter)
      .filter(doc => !tagFilter || doc.tagIds.includes(tagFilter))
      .filter(doc => !folderFilter || folderOf(doc.path) === folderFilter)
      .filter(doc => Object.entries(facetFilters).every(([id, value]) => matchesFacet(doc, state.facets.find(facet => facet.id === id), id, value)))
      .filter(doc => !q || [doc.title, doc.path, ...doc.tagIds.map(id => state.tags.find(tag => tag.id === id)?.name || ''), ...Object.entries(doc.values).flatMap(([id, value]) => {
        const facet = state.facets.find(item => item.id === id); if (!facet) return [];
        return (Array.isArray(value) ? value : [value]).map(v => facet.options.find(option => option.id === v)?.label || String(v ?? ''));
      }), ...state.relations.filter(relation => relation.source === doc.id || relation.target === doc.id).map(relation => {
        const otherId = relation.source === doc.id ? relation.target : relation.source;
        return state.knowledge.find(node => node.id === otherId)?.title || state.documents.find(item => item.id === otherId)?.title || state.facets.flatMap(facet => facet.options).find(option => option.id === otherId)?.label || state.tags.find(tag => tag.id === otherId)?.name || '';
      })].join(' ').toLocaleLowerCase().includes(q))
      .sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title, 'zh-CN') : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [state, query, page, kindFilter, tagFilter, folderFilter, facetFilters, sort]);
  const selectedDocument = state?.documents.find(doc => doc.id === selectedId);
  const selectedKnowledge = state?.knowledge.find(node => node.id === selectedId);
  const selectedTag = state?.tags.find(tag => tag.id === selectedId);
  const selectedOption = state?.facets.flatMap(facet => facet.options.map(option => ({ ...option, facetName: facet.name }))).find(option => option.id === selectedId);
  const hasFilters = Boolean(query || kindFilter || tagFilter || folderFilter || Object.values(facetFilters).some(Boolean));
  const clearFilters = () => { setQuery(''); setKindFilter(''); setTagFilter(''); setFolderFilter(''); setFacetFilters({}); setChecked([]); };
  const changePage = (value: Page) => {
    setPage(value); setChecked([]); setMobileNav(false);
    if (value === 'galaxy') { setSelectedId(''); }
    else if (value === 'trash') { clearFilters(); setSelectedId(state?.documents.find(doc => doc.trashed)?.id || ''); }
    else if (page === 'trash') { setSelectedId(state?.documents.find(doc => !doc.trashed)?.id || ''); }
  };
  const nodeName = (id: string) => state?.documents.find(doc => doc.id === id)?.title || state?.knowledge.find(node => node.id === id)?.title || state?.tags.find(tag => tag.id === id)?.name || state?.facets.flatMap(facet => facet.options).find(option => option.id === id)?.label || '未知资料';
  const relations = state?.relations.filter(relation => relation.source === selectedId || relation.target === selectedId) || [];
  const nodeCandidates = state ? [
    ...state.documents.filter(doc => !doc.trashed).map(doc => ({ id: doc.id, label: doc.title, group: '文档' })),
    ...state.knowledge.map(node => ({ id: node.id, label: node.title, group: node.type })),
    ...state.facets.flatMap(facet => facet.options.map(option => ({ id: option.id, label: `${facet.name} / ${optionLabel(facet, option.id)}`, group: '分类' }))),
    ...state.tags.map(tag => ({ id: tag.id, label: tag.name, group: '标签' })),
  ] : [];
  function setFacetValue(document: LibraryDocument, facet: Facet, value: FacetValue) {
    void command({ type: 'update-document', id: document.id, patch: { values: { ...document.values, [facet.id]: value } } });
  }

  if (!state) return <div className="loading-screen"><div className="brand-mark"><Sparkles size={26} /></div><h1>知识星系</h1><p>{toast?.error ? toast.text : '正在打开你的资料库…'}</p>{!toast?.error && <LoaderCircle className="spin" size={22} />}</div>;

  const pageTitles: Record<Page, string> = { documents: '资料管理', galaxy: '3D 知识星系', organize: '分类与标签', trash: '回收站' };
  const detailVisible = page !== 'organize' && Boolean(selectedDocument || selectedKnowledge || selectedTag || selectedOption);
  return <div className={`app-shell ${mobileNav ? 'nav-visible' : ''}`}>
    {mobileNav && <button className="nav-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} />}
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Sparkles size={23} strokeWidth={1.6} /></span><span>知识星系<small>KNOWLEDGE GALAXY</small></span></div>
      <button className="library-switch" disabled={busy} onClick={() => void perform(() => api.chooseLibrary(), '资料库已打开', true)} title={state.library.path}><FolderOpen size={19} /><span><strong>{state.library.name}</strong><small>{state.library.mode === 'demo' ? '示例资料库 · 浏览器预览' : state.library.isExample ? '本地示例资料库' : '本地资料库'}</small></span><ChevronDown size={15} /></button>
      <p className="sidebar-label">工作空间</p>
      <nav className="main-nav" aria-label="主导航">
        <button className={page === 'documents' ? 'active' : ''} onClick={() => changePage('documents')}><FolderOpen size={18} /><span>资料管理</span><span className="nav-count">{activeDocuments.length}</span></button>
        <button className={page === 'galaxy' ? 'active' : ''} onClick={() => changePage('galaxy')}><Network size={18} /><span>3D 知识星系</span><span className="new-dot" /></button>
        <button className={page === 'organize' ? 'active' : ''} onClick={() => changePage('organize')}><Settings2 size={18} /><span>分类与标签</span></button>
        <button className={page === 'trash' ? 'active' : ''} onClick={() => changePage('trash')}><Trash2 size={18} /><span>回收站</span>{state.documents.some(doc => doc.trashed) && <span className="nav-count">{state.documents.filter(doc => doc.trashed).length}</span>}</button>
      </nav>
      <div className="sidebar-filters">
        <div className="sidebar-section-heading"><p className="sidebar-label">资料类型</p>{kindFilter && <button aria-label="清除类型筛选" onClick={() => setKindFilter('')}><X size={13} /></button>}</div>
        {kinds.slice(0, 5).map(kind => <button className={`filter-link ${kindFilter === kind ? 'selected' : ''}`} key={kind} onClick={() => { setKindFilter(kindFilter === kind ? '' : kind); if (page === 'organize') setPage('documents'); }}><FileText size={15} /><span>{kind}</span><small>{activeDocuments.filter(doc => doc.kind === kind).length}</small></button>)}
        <div className="sidebar-section-heading"><p className="sidebar-label">我的标签</p><button aria-label="创建标签" title="创建标签" onClick={() => setModal('tag')}><Plus size={15} /></button></div>
        <div className="sidebar-tag-list">{state.tags.map(tag => <button className={`filter-link ${tagFilter === tag.id ? 'selected' : ''}`} key={tag.id} onClick={() => { setTagFilter(tagFilter === tag.id ? '' : tag.id); if (page === 'organize') setPage('documents'); }}><span className="tag-dot" style={{ background: tag.color }} /><span>{tag.name}</span>{tagFilter === tag.id && <Check size={13} />}</button>)}{state.tags.length === 0 && <p className="sidebar-hint">用标签标记资料的用途和状态</p>}</div>
      </div>
      <div className="sidebar-bottom"><HardDrive size={16} /><div><strong>你的资料，留在本地</strong><small>{state.library.mode === 'demo' ? '示例数据保存在当前浏览器' : '文件与关联保存在你的电脑'}</small></div></div>
    </aside>

    <main className="workspace">
      <header className="topbar"><div className="breadcrumb"><button className="mobile-menu icon-button" aria-label="打开导航" onClick={() => setMobileNav(true)}><Layers3 size={20} /></button><span>工作空间</span><ChevronRight size={13} /><strong>{pageTitles[page]}</strong></div><div className="topbar-right"><span className={`local-badge ${state.library.isExample || state.library.mode === 'demo' ? 'example' : ''}`}><span />{state.library.isExample || state.library.mode === 'demo' ? '示例资料库' : '本地资料库'}</span><div className="more-wrapper"><button className="icon-button" title="资料库操作" aria-label="资料库操作" onClick={() => setMoreOpen(!moreOpen)}><MoreHorizontal size={21} /></button>{moreOpen && <div className="dropdown-menu"><button disabled={busy} onClick={() => { setMoreOpen(false); void perform(() => api.chooseLibrary(), '资料库已打开', true); }}><FolderOpen size={16} />打开本地资料库</button><button disabled={busy} onClick={() => void backup()}><ArrowDownToLine size={16} />备份资料库</button><button disabled={busy} onClick={() => { setMoreOpen(false); void perform(() => api.restoreBackup(), '备份已恢复', true); }}><RotateCcw size={16} />从备份恢复</button></div>}</div></div></header>

      <div className={`main-content ${page === 'galaxy' ? 'galaxy-content' : ''}`}>
        <div className="page-heading"><div><div className="eyebrow">{page === 'galaxy' ? 'EXPLORE YOUR KNOWLEDGE' : page === 'organize' ? 'MAKE IT YOURS' : 'YOUR PERSONAL LIBRARY'}</div><h1>{page === 'documents' ? '我的资料库' : pageTitles[page]}{page === 'documents' && <span>{activeDocuments.length} 份资料</span>}</h1><p>{page === 'galaxy' ? '沿着关联探索，让每一份资料找到自己的位置。' : page === 'organize' ? '按你的习惯组织资料，创建属于自己的知识结构。' : page === 'trash' ? '移入回收站的资料可以恢复，原有关联会继续保留。' : '整理每一份资料，连接每一个知识点。'}</p></div><div className="heading-actions">{page === 'organize' ? <button className="primary-button" onClick={() => setModal('facet')}><Plus size={16} />新建分类</button> : page === 'trash' ? null : <><button className="secondary-button" disabled={busy} onClick={() => setModal('note')}><Plus size={16} />新建笔记</button><button className="primary-button" disabled={busy} onClick={() => void perform(() => api.importFiles(), '文件已导入')}><Upload size={16} />导入文件</button></>}</div></div>

        {page === 'organize' ? <div className="organize-page">
          <section className="organize-section"><div className="section-title"><div><h2><Layers3 size={19} />分类维度</h2><p>单选、多选或层级，让资料有序可循。</p></div><span>{state.facets.length} 个维度</span></div><div className="facet-grid">{state.facets.map(facet => <article className="facet-card" key={facet.id}><div className="facet-card-header"><span className="category-symbol"><Layers3 size={19} /></span><div><h3>{facet.name}</h3><span>{facetTypes.find(type => type.value === facet.type)?.label}</span></div></div><div className="option-chips">{facet.options.map(option => <span key={option.id} title={optionLabel(facet, option.id)}>{option.parentId && <GitBranch size={11} />}{option.label}</span>)}{!facet.options.length && <span className="muted">{['text', 'number', 'date'].includes(facet.type) ? '在资料详情中直接填写' : '还没有选项'}</span>}</div>{!['text', 'number', 'date'].includes(facet.type) && <button className="text-button" onClick={() => { setOptionFacetId(facet.id); setModal('option'); }}><Plus size={14} />添加选项</button>}</article>)}<button className="add-facet-card" onClick={() => setModal('facet')}><Plus size={24} /><strong>创建分类维度</strong><span>年级、章节，或任何你需要的类别</span></button></div></section>
          <section className="organize-section"><div className="section-title"><div><h2><TagIcon size={19} />自由标签</h2><p>为资料标记用途、状态和灵感。</p></div><button className="secondary-button compact" onClick={() => setModal('tag')}><Plus size={15} />新建标签</button></div><div className="tag-management">{state.tags.map(tag => <button key={tag.id} style={{ '--tag-color': tag.color } as React.CSSProperties} onClick={() => { setTagFilter(tag.id); setPage('documents'); }}><span className="tag-dot" style={{ background: tag.color }} /><strong>{tag.name}</strong><span>{activeDocuments.filter(doc => doc.tagIds.includes(tag.id)).length} 份资料</span><ArrowUpRight size={14} /></button>)}{!state.tags.length && <p className="muted">创建第一个标签，开始整理你的资料。</p>}</div></section>
          <section className="organize-section"><div className="section-title"><div><h2><Network size={19} />知识节点</h2><p>跨越文件夹，把章节、知识点和专题串起来。</p></div><button className="secondary-button compact" onClick={() => setModal('knowledge')}><Plus size={15} />添加节点</button></div><div className="knowledge-grid">{state.knowledge.map(node => <button key={node.id} onClick={() => { setSelectedId(node.id); setPage('galaxy'); }}><span className="knowledge-node-icon"><GitBranch size={17} /></span><span><strong>{node.title}</strong><small>{node.type}</small></span><ArrowUpRight size={15} /></button>)}</div>{!state.knowledge.length && <p className="muted">添加章节或知识点，再把资料关联到它们。</p>}</section>
          <section className="organize-section relation-type-section"><div className="section-title"><div><h2><Link2 size={19} />关系类型</h2><p>每条连线都有明确含义，例如“考查”“解释”或“先修于”。</p></div><button className="secondary-button compact" onClick={() => setModal('relationType')}><Plus size={15} />新建关系类型</button></div><div className="option-chips">{state.relationTypes.map(type => <span key={type.id}>{type.name}</span>)}</div></section>
        </div> : <>
          <div className="filter-toolbar"><div className="search-field"><Search size={17} /><input aria-label="搜索资料" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索资料、知识点或标签…" />{query && <button aria-label="清除搜索" onClick={() => setQuery('')}><X size={14} /></button>}</div><select aria-label="按文件夹筛选" value={folderFilter} onChange={event => setFolderFilter(event.target.value)}><option value="">全部文件夹</option>{folders.map(folder => <option key={folder} value={folder}>{folder.split('/').slice(-2).join('/')}</option>)}</select><select aria-label="按资料类型筛选" value={kindFilter} onChange={event => setKindFilter(event.target.value)}><option value="">全部类型</option>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select><button className="icon-button filter-settings" title="管理分类与标签" aria-label="管理分类与标签" onClick={() => changePage('organize')}><Settings2 size={18} /></button></div>
          {(state.facets.some(facet => facet.options.length > 0) || hasFilters) && <div className="facet-filter-row"><span><Layers3 size={13} />分类筛选</span>{state.facets.filter(facet => facet.options.length > 0).map(facet => <select className={facetFilters[facet.id] ? 'has-value' : ''} aria-label={`按${facet.name}筛选`} key={facet.id} value={facetFilters[facet.id] || ''} onChange={event => setFacetFilters({ ...facetFilters, [facet.id]: event.target.value })}><option value="">{facet.name}</option>{facet.options.map(option => <option key={option.id} value={option.id}>{optionLabel(facet, option.id)}</option>)}</select>)}{tagFilter && <button className="active-filter" onClick={() => setTagFilter('')}><TagIcon size={12} />{state.tags.find(tag => tag.id === tagFilter)?.name}<X size={12} /></button>}{hasFilters && <button className="clear-filters" onClick={clearFilters}>清除筛选</button>}</div>}
          <div className={`content-split ${detailVisible ? 'with-detail' : ''}`}>
            <section className={`collection-panel ${page === 'galaxy' ? 'galaxy-panel' : ''}`}>
              {page === 'galaxy' ? <Suspense fallback={<div className="empty-state"><LoaderCircle className="spin" /><p>正在打开 3D 星系…</p></div>}><GalaxyView state={state} visibleDocumentIds={visibleDocuments.map(doc => doc.id)} selectedId={selectedId} onSelect={setSelectedId} onSaveLayout={positions => command({ type: 'save-layout', positions }, '星系布局已保存')} /></Suspense> : <>
                <div className="list-toolbar"><div>{checked.length ? <><span className="selection-count">已选 {checked.length} 份</span><select aria-label="批量添加标签" defaultValue="" disabled={busy} onChange={event => { const tagId = event.target.value; event.target.value = ''; if (!tagId) return; void (async () => { setBusy(true); try { let next = state; for (const id of checked) { const doc = next.documents.find(item => item.id === id); if (doc) next = await api.command({ type: 'update-document', id, patch: { tagIds: [...new Set([...doc.tagIds, tagId])] } }); } setState(next); setToast({ text: '标签已批量添加' }); setChecked([]); } catch (error) { setToast({ text: error instanceof Error ? error.message : String(error), error: true }); } finally { setBusy(false); } })(); }}><option value="">添加标签…</option>{state.tags.map(tag => <option value={tag.id} key={tag.id}>{tag.name}</option>)}</select><button className="text-button" onClick={() => setChecked([])}>取消选择</button></> : <><span className="results-count">{hasFilters ? '筛选结果' : page === 'trash' ? '已删除资料' : '全部资料'}</span><span className="results-total">{visibleDocuments.length}</span></>}</div><select className="sort-select" aria-label="排序方式" value={sort} onChange={event => setSort(event.target.value)}><option value="updated">最近更新</option><option value="title">名称排序</option></select></div>
                <div className="document-table-head"><label><input type="checkbox" aria-label="选择所有显示资料" checked={visibleDocuments.length > 0 && visibleDocuments.every(doc => checked.includes(doc.id))} onChange={event => setChecked(event.target.checked ? visibleDocuments.map(doc => doc.id) : [])} /></label><span>资料名称</span><span className="table-tags">标签</span><span className="table-date">更新日期</span></div>
                <div className="document-list">{visibleDocuments.map(doc => <div role="button" tabIndex={0} key={doc.id} className={`document-row ${selectedId === doc.id ? 'selected' : ''}`} onClick={() => setSelectedId(doc.id)} onDoubleClick={() => { if (!doc.trashed) setPreview(doc); }} onKeyDown={event => { if (event.key === 'Enter') setSelectedId(doc.id); }}><label onClick={event => event.stopPropagation()}><input type="checkbox" aria-label={`选择${doc.title}`} checked={checked.includes(doc.id)} onChange={event => setChecked(event.target.checked ? [...checked, doc.id] : checked.filter(id => id !== doc.id))} /></label><FileGlyph document={doc} /><div className="document-name"><strong>{doc.title}{doc.missing && <span className="missing-mark">文件丢失</span>}</strong><small><Folder size={11} />{shortFolder(doc.path)}<span className="row-kind">{doc.kind}</span></small></div><div className="row-tags">{doc.tagIds.slice(0, 2).map(id => { const tag = state.tags.find(item => item.id === id); return tag && <span key={id} className="tag-chip" style={{ '--tag-color': tag.color } as React.CSSProperties}>{tag.name}</span>; })}{doc.tagIds.length > 2 && <span className="extra-tags">+{doc.tagIds.length - 2}</span>}</div><span className="row-date">{formatDate(doc.updatedAt)}</span></div>)}{!visibleDocuments.length && <Empty icon={page === 'trash' ? <Trash2 size={28} /> : <Search size={28} />} title={page === 'trash' ? '回收站是空的' : hasFilters ? '没有找到相关资料' : '从第一份资料开始'}>{hasFilters ? <button className="text-button" onClick={clearFilters}>清除筛选，查看全部资料</button> : page === 'trash' ? '移入回收站的文件会显示在这里。' : '点击“导入文件”，或创建一篇笔记。'}</Empty>}</div>
                <div className="collection-footer"><span><HardDrive size={12} />{state.library.mode === 'demo' ? '示例库 · 数据保存在当前浏览器' : '本地资料库 · 离线可用'}</span><span>{visibleDocuments.length} 份资料</span></div>
              </>}
            </section>
            {detailVisible && <aside className="detail-panel"><div className="detail-topline"><span>资料详情</span><button className="icon-button" aria-label="关闭详情" onClick={() => setSelectedId('')}><X size={16} /></button></div><div className="detail-scroll">
              {selectedDocument ? <>
                <div className="detail-title"><FileGlyph document={selectedDocument} /><span className="detail-kind">{selectedDocument.kind}<span>·</span>{sizeLabel(selectedDocument.size)}</span><h2>{selectedDocument.title}</h2><p title={selectedDocument.path}>{selectedDocument.path}</p></div>
                {selectedDocument.trashed ? <button className="primary-button full" disabled={busy} onClick={() => void command({ type: 'restore-document', id: selectedDocument.id }, '资料已恢复')}><RotateCcw size={15} />恢复资料</button> : <div className="detail-actions"><button className="primary-button" onClick={() => setPreview(selectedDocument)}><BookOpen size={15} />预览资料</button><button className="secondary-button" onClick={() => void openOriginal(selectedDocument)} title="使用系统默认应用打开"><ArrowUpRight size={16} />打开原文件</button></div>}
                {!selectedDocument.trashed && <>
                  <section className="detail-section"><div className="detail-section-title"><h3><Settings2 size={14} />分类属性</h3><button className="icon-button" aria-label="管理分类" title="管理分类" onClick={() => changePage('organize')}><Plus size={14} /></button></div><div className="property-list"><div className="property-row"><label htmlFor="document-title">显示名称</label><input id="document-title" key={`${selectedDocument.id}-${selectedDocument.title}`} defaultValue={selectedDocument.title} onBlur={event => { const title = event.target.value.trim(); if (title && title !== selectedDocument.title) void command({ type: 'update-document', id: selectedDocument.id, patch: { title } }); }} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /></div><div className="property-row"><label htmlFor="document-kind">资料类型</label><select id="document-kind" value={selectedDocument.kind} disabled={busy} onChange={event => void command({ type: 'update-document', id: selectedDocument.id, patch: { kind: event.target.value as DocumentKind } })}>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></div>{state.facets.map(facet => <div className={`property-row ${facet.type === 'multi' || facet.type === 'tree' ? 'multivalue-row' : ''}`} key={facet.id}><label htmlFor={`facet-${facet.id}`}>{facet.name}</label>{facet.type === 'multi' || facet.type === 'tree' ? <div className={`multi-values ${facet.type === 'tree' ? 'tree-values' : ''}`}>{facet.options.map(option => { const rawValues = selectedDocument.values[facet.id]; const values = Array.isArray(rawValues) ? rawValues : typeof rawValues === 'string' && rawValues ? [rawValues] : []; return <button className={`${values.includes(option.id) ? 'chosen' : ''} ${option.parentId ? 'child-option' : ''}`} key={option.id} disabled={busy} aria-label={`${facet.name}：${optionLabel(facet, option.id)}`} aria-pressed={values.includes(option.id)} title={optionLabel(facet, option.id)} onClick={() => setFacetValue(selectedDocument, facet, values.includes(option.id) ? values.filter(id => id !== option.id) : [...values, option.id])}>{values.includes(option.id) && <Check size={10} />}{facet.type === 'tree' ? optionLabel(facet, option.id) : option.label}</button>; })}{!facet.options.length && <span className="muted">暂无选项</span>}</div> : facet.type === 'single' ? <select id={`facet-${facet.id}`} value={String(selectedDocument.values[facet.id] || '')} disabled={busy} onChange={event => setFacetValue(selectedDocument, facet, event.target.value || null)}><option value="">未设置</option>{facet.options.map(option => <option value={option.id} key={option.id}>{optionLabel(facet, option.id)}</option>)}</select> : <input id={`facet-${facet.id}`} type={facet.type === 'number' ? 'number' : facet.type === 'date' ? 'date' : 'text'} key={`${selectedDocument.id}-${facet.id}-${selectedDocument.values[facet.id]}`} defaultValue={String(selectedDocument.values[facet.id] ?? '')} placeholder="未设置" onBlur={event => { const raw = event.target.value.trim(); const value = !raw ? null : facet.type === 'number' ? Number(raw) : raw; if (value !== selectedDocument.values[facet.id]) setFacetValue(selectedDocument, facet, value); }} />}</div>)}</div></section>
                  <section className="detail-section"><div className="detail-section-title"><h3><TagIcon size={14} />标签</h3><button className="icon-button" title="创建标签" aria-label="创建标签" onClick={() => setModal('tag')}><Plus size={14} /></button></div><div className="detail-tag-picker">{state.tags.map(tag => <button className={`tag-chip ${selectedDocument.tagIds.includes(tag.id) ? 'chosen' : 'unchosen'}`} style={{ '--tag-color': tag.color } as React.CSSProperties} key={tag.id} disabled={busy} title={selectedDocument.tagIds.includes(tag.id) ? '点击移除标签' : '点击添加标签'} onClick={() => void command({ type: 'update-document', id: selectedDocument.id, patch: { tagIds: selectedDocument.tagIds.includes(tag.id) ? selectedDocument.tagIds.filter(id => id !== tag.id) : [...selectedDocument.tagIds, tag.id] } })}>{selectedDocument.tagIds.includes(tag.id) && <Check size={11} />}{tag.name}</button>)}</div></section>
                </>}
              </> : <div className="node-detail"><span className="node-detail-icon"><Network size={28} /></span><span className="detail-kind">{selectedKnowledge?.type || (selectedTag ? '标签' : selectedOption?.facetName)}</span><h2>{selectedKnowledge?.title || selectedTag?.name || selectedOption?.label}</h2><p>{selectedKnowledge?.description || '从这个节点出发，探索与它关联的资料。'}</p>{selectedOption && <button className="secondary-button full" onClick={() => { const facet = state.facets.find(item => item.options.some(option => option.id === selectedOption.id)); if (facet) { clearFilters(); setFacetFilters({ [facet.id]: selectedOption.id }); setPage('documents'); } }}>查看该分类的资料<ArrowUpRight size={14} /></button>}{selectedTag && <button className="secondary-button full" onClick={() => { clearFilters(); setTagFilter(selectedTag.id); setPage('documents'); }}>查看带有该标签的资料<ArrowUpRight size={14} /></button>}</div>}
              <section className="detail-section"><div className="detail-section-title"><h3><Link2 size={14} />关联资料<span className="tiny-count">{relations.length}</span></h3>{!selectedDocument?.trashed && <button className="icon-button" aria-label="添加关联" title="添加关联" onClick={() => setModal('relation')}><Plus size={14} /></button>}</div><div className="relations-list">{relations.map(relation => { const outgoing = relation.source === selectedId; const otherId = outgoing ? relation.target : relation.source; return <div className="relation-item" key={relation.id}><button onClick={() => setSelectedId(otherId)}><span className="relation-direction">{outgoing ? '→' : '←'} {state.relationTypes.find(type => type.id === relation.typeId)?.name || '关联'} {!outgoing && <small>· 反向关联</small>}</span><strong><File size={13} />{nodeName(otherId)}</strong></button><button className="remove-relation icon-button" title="解除关联" aria-label={`解除与${nodeName(otherId)}的关联`} disabled={busy} onClick={() => void command({ type: 'remove-relation', id: relation.id }, '关联已解除')}><X size={13} /></button></div>; })}{relations.length === 0 && <div className="empty-relations"><Link2 size={22} /><span>还没有关联</span><p>连接章节、知识点或其他资料，<br />让它们在星系中相遇。</p></div>}</div></section>
              {selectedDocument && !selectedDocument.trashed && <div className="document-operations"><button className="text-button" onClick={() => setModal('rename')}>重命名文件</button><button className="text-button" onClick={() => setModal('move')}>移动文件</button><button className="text-button danger" disabled={busy} onClick={() => void command({ type: 'trash-document', id: selectedDocument.id }, '资料已移入回收站')}><Trash2 size={13} />移入回收站</button></div>}
            </div></aside>}
          </div>
          {page === 'galaxy' && <div className="galaxy-bottom-actions"><button className="text-button" onClick={() => setModal('knowledge')}><Plus size={14} />添加知识节点</button><button className="text-button" onClick={() => setModal('relation')}><Link2 size={14} />建立关联</button><span><CircleHelp size={13} />旋转、缩放，在知识之间自由穿行</span></div>}
        </>}
      </div>
    </main>
    {preview && <Suspense fallback={<div className="busy-indicator">正在打开预览…</div>}><DocumentPreview document={preview} onClose={() => setPreview(null)} onSaved={() => { void perform(() => api.snapshot()); }} /></Suspense>}
    {modal && <EditModal key={`${modal}-${selectedId}`} modal={modal} state={state} document={selectedDocument} optionFacetId={optionFacetId} selectedId={selectedId} nodeCandidates={nodeCandidates} busy={busy} onClose={() => setModal(null)} onSubmit={async value => { const ok = await command(value, modal === 'relation' ? '关联已建立' : '已保存'); if (ok) setModal(null); }} />}
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleHelp size={17} /> : <Check size={17} />}<span>{toast.text}</span><button aria-label="关闭提示" onClick={() => setToast(null)}><X size={15} /></button></div>}
    {busy && <div className="busy-indicator"><LoaderCircle size={14} className="spin" />正在处理…</div>}
  </div>;
}

function EditModal({ modal, state, document, optionFacetId, selectedId, nodeCandidates, busy, onClose, onSubmit }: {
  modal: Exclude<Modal, null>; state: WorkspaceState; document?: LibraryDocument; optionFacetId: string; selectedId: string;
  nodeCandidates: { id: string; label: string; group: string }[]; busy: boolean; onClose: () => void; onSubmit: (command: LibraryCommand) => Promise<void>;
}) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const [name, setName] = useState(modal === 'rename' ? document?.path.replaceAll('\\', '/').split('/').pop() || '' : '');
  const [color, setColor] = useState(colors[0]);
  const [fieldType, setFieldType] = useState<FacetType>('single');
  const eligibleFacets = state.facets.filter(facet => ['single', 'multi', 'tree'].includes(facet.type));
  const [facetId, setFacetId] = useState(eligibleFacets.some(facet => facet.id === optionFacetId) ? optionFacetId : eligibleFacets[0]?.id || '');
  const [parentId, setParentId] = useState('');
  const [nodeType, setNodeType] = useState<'章节' | '知识点' | '专题'>('知识点');
  const [source, setSource] = useState(nodeCandidates.some(node => node.id === selectedId) ? selectedId : nodeCandidates[0]?.id || '');
  const [target, setTarget] = useState('');
  const [relationType, setRelationType] = useState(state.relationTypes[0]?.id || '');
  const [content, setContent] = useState('');
  const [folder, setFolder] = useState('');
  const [formError, setFormError] = useState('');
  const title: Record<Exclude<Modal, null>, string> = { note: '新建笔记', tag: '创建标签', facet: '创建分类维度', option: '添加分类选项', knowledge: '添加知识节点', relation: '建立关联', relationType: '创建关系类型', rename: '重命名文件', move: '移动文件' };
  const description: Record<Exclude<Modal, null>, string> = { note: '写下想法，把它放进你的知识星系。', tag: '用一个简短的词，标记资料的用途或状态。', facet: '自由定义分类方式，按自己的习惯整理。', option: '新选项可以立即分配给资料。', knowledge: '知识节点连接散落在不同文件中的内容。', relation: '为两个节点之间的联系赋予明确含义。', relationType: '例如：考查、解释、引用、先修于。', rename: '修改原始文件名称，已有分类和关联继续保留。', move: '输入资料库内的目标文件夹，文件夹不存在时自动创建。' };
  const currentFacet = state.facets.find(facet => facet.id === facetId);
  useEffect(() => { function escape(event: KeyboardEvent) { if (event.key === 'Escape' && !busy) onClose(); } window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape); }, [busy, onClose]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setFormError('');
    if (modal === 'relation') { if (!source || !target || !relationType) { setFormError('请选择两个节点和关系类型。'); return; } if (source === target) { setFormError('请选择两个不同的节点。'); return; } await onSubmit({ type: 'add-relation', source, target, typeId: relationType }); return; }
    if (modal === 'move') { if (!folder.trim()) { setFormError('请输入目标文件夹。'); return; } if (document) await onSubmit({ type: 'move-document', id: document.id, folder: folder.trim() }); return; }
    if (!name.trim()) { setFormError('请填写名称。'); return; }
    if (modal === 'note') await onSubmit({ type: 'create-note', title: name.trim(), content });
    if (modal === 'tag') await onSubmit({ type: 'add-tag', name: name.trim(), color });
    if (modal === 'facet') await onSubmit({ type: 'add-facet', name: name.trim(), fieldType });
    if (modal === 'option') { if (!eligibleFacets.some(facet => facet.id === facetId)) { setFormError('请先创建单选、多选或层级分类。'); return; } await onSubmit({ type: 'add-option', facetId, label: name.trim(), ...(parentId ? { parentId } : {}) }); }
    if (modal === 'knowledge') await onSubmit({ type: 'add-knowledge', title: name.trim(), nodeType });
    if (modal === 'relationType') await onSubmit({ type: 'add-relation-type', name: name.trim() });
    if (modal === 'rename' && document) await onSubmit({ type: 'rename-document', id: document.id, fileName: name.trim() });
  }
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}><section ref={dialogRef} tabIndex={-1} className="edit-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-header"><span className="modal-symbol">{modal === 'relation' ? <Link2 size={23} /> : modal === 'tag' ? <TagIcon size={23} /> : <Plus size={23} />}</span><button className="icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={19} /></button></div><h2 id="modal-title">{title[modal]}</h2><p>{description[modal]}</p><form onSubmit={event => void submit(event)}>
    {modal === 'option' && <label className="form-field">分类维度<select value={facetId} disabled={!eligibleFacets.length} required onChange={event => { setFacetId(event.target.value); setParentId(''); }}>{!eligibleFacets.length && <option value="">没有可添加选项的分类</option>}{eligibleFacets.map(facet => <option key={facet.id} value={facet.id}>{facet.name}</option>)}</select>{!eligibleFacets.length && <small>请先创建一个单选、多选或层级分类。</small>}</label>}
    {modal !== 'relation' && modal !== 'move' && <label className="form-field">{modal === 'rename' ? '文件名（包含扩展名）' : modal === 'note' ? '笔记标题' : '名称'}<input autoFocus value={name} maxLength={180} onChange={event => setName(event.target.value)} placeholder={modal === 'tag' ? '例如：待打印' : modal === 'facet' ? '例如：难度' : modal === 'knowledge' ? '例如：一元一次方程' : '填写名称…'} required /></label>}
    {modal === 'move' && <label className="form-field">目标文件夹<input autoFocus value={folder} onChange={event => setFolder(event.target.value)} placeholder="例如：数学/七年级/期末" required /><small>相对于资料库根目录填写。</small></label>}
    {modal === 'note' && <label className="form-field">笔记内容<textarea value={content} onChange={event => setContent(event.target.value)} placeholder="支持 Markdown，例如 # 标题" rows={5} /></label>}
    {modal === 'tag' && <div className="form-field">标签颜色<div className="color-picker">{colors.map(value => <button type="button" aria-label={`选择颜色 ${value}`} aria-pressed={value === color} className={color === value ? 'selected' : ''} style={{ background: value }} key={value} onClick={() => setColor(value)}>{value === color && <Check size={15} />}</button>)}</div><div className="tag-preview"><span className="tag-chip" style={{ '--tag-color': color } as React.CSSProperties}>{name || '标签预览'}</span></div></div>}
    {modal === 'facet' && <label className="form-field">分类形式<select value={fieldType} onChange={event => setFieldType(event.target.value as FacetType)}>{facetTypes.map(type => <option value={type.value} key={type.value}>{type.label}</option>)}</select><small>{fieldType === 'multi' ? '同一份资料可以选择多个选项。' : fieldType === 'tree' ? '选项可以包含子选项，形成层级结构。' : fieldType === 'single' ? '同一份资料选择一个选项。' : '在资料详情中直接填写内容。'}</small></label>}
    {modal === 'option' && currentFacet?.type === 'tree' && <label className="form-field">上级选项<select value={parentId} onChange={event => setParentId(event.target.value)}><option value="">无，创建为顶层选项</option>{currentFacet.options.map(option => <option value={option.id} key={option.id}>{optionLabel(currentFacet, option.id)}</option>)}</select></label>}
    {modal === 'knowledge' && <label className="form-field">节点类型<select value={nodeType} onChange={event => setNodeType(event.target.value as typeof nodeType)}><option>知识点</option><option>章节</option><option>专题</option></select></label>}
    {modal === 'relation' && <><label className="form-field">起点<select value={source} onChange={event => setSource(event.target.value)} required><option value="">选择节点</option>{nodeCandidates.map(node => <option value={node.id} key={node.id}>[{node.group}] {node.label}</option>)}</select></label><label className="form-field">关系类型<select value={relationType} onChange={event => setRelationType(event.target.value)} required><option value="">选择关系类型</option>{state.relationTypes.map(type => <option value={type.id} key={type.id}>{type.name}</option>)}</select></label><label className="form-field">终点<select value={target} onChange={event => setTarget(event.target.value)} required><option value="">选择关联节点</option>{nodeCandidates.filter(node => node.id !== source).map(node => <option value={node.id} key={node.id}>[{node.group}] {node.label}</option>)}</select></label></>}
    {formError && <p className="form-error" role="alert">{formError}</p>}
    <div className="modal-footer"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button className="primary-button" disabled={busy || (modal === 'option' && !eligibleFacets.length)} type="submit">{busy && <LoaderCircle className="spin" size={15} />}{modal === 'relation' ? '建立关联' : '保存'}</button></div>
  </form></section></div>;
}
