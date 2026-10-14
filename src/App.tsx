import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine,
  Check,
  ChevronDown,
  CircleHelp,
  Folder,
  FolderOpen,
  HardDrive,
  Layers3,
  Link2,
  LoaderCircle,
  MoreHorizontal,
  Network,
  Orbit,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from './api';
import type { LibraryCommand, LibraryDocument, WorkspaceState } from './domain';
import { errorMessage, kinds } from './lib/format';
import { buildWorkspaceIndex, selectDocuments } from './lib/workspace';
import EditModal, { type EditModalType } from './components/EditModal';
import DocumentDetails from './components/DocumentDetails';
import DocumentList from './components/DocumentList';
import OrganizeView from './components/OrganizeView';
const GalaxyView = lazy(() => import('./components/GalaxyView'));
const DocumentPreview = lazy(() => import('./components/DocumentPreview'));
type Page = 'documents' | 'galaxy' | 'organize' | 'trash';
type Modal = EditModalType | null;

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
  const pendingActions = useRef(0);
  const [loadError, setLoadError] = useState('');
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  useEffect(() => {
    function dismiss(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMoreOpen(false);
      }
    }
    window.addEventListener('keydown', dismiss);
    return () => window.removeEventListener('keydown', dismiss);
  }, []);

  useEffect(() => {
    let active = true;
    void api
      .snapshot()
      .then((value) => {
        if (active) {
          setState(value);
          setSelectedId(value.documents.find((doc) => !doc.trashed)?.id || '');
        }
      })
      .catch((error) => {
        if (active) setLoadError(errorMessage(error));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 5200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  async function runAction<T>(action: () => Promise<T>): Promise<T | undefined> {
    pendingActions.current++;
    setBusy(true);
    try {
      return await action();
    } catch (error) {
      setToast({ text: errorMessage(error), error: true });
    } finally {
      pendingActions.current--;
      setBusy(pendingActions.current > 0);
    }
  }
  async function perform(
    action: () => Promise<WorkspaceState | null>,
    success?: string,
    reset = false,
  ) {
    const value = await runAction(action);
    if (value) {
      setState(value);
      const validIds = new Set([
        ...value.documents.map((doc) => doc.id),
        ...value.knowledge.map((node) => node.id),
        ...value.tags.map((tag) => tag.id),
        ...value.facets.flatMap((facet) => facet.options.map((option) => option.id)),
      ]);
      if (reset) {
        clearFilters();
        setPreview(null);
        setPage('documents');
        setSelectedId(value.documents.find((doc) => !doc.trashed)?.id || '');
      } else {
        setSelectedId((current) =>
          !current || validIds.has(current)
            ? current
            : value.documents.find((doc) => !doc.trashed)?.id || '',
        );
        setChecked((current) => current.filter((id) => validIds.has(id)));
      }
      if (success) setToast({ text: success });
      return true;
    }
    return false;
  }
  async function command(value: LibraryCommand, message?: string) {
    return perform(() => api.command(value), message);
  }
  async function openOriginal(document: LibraryDocument) {
    await runAction(() => api.openDocument(document.id));
  }
  async function backup() {
    setMoreOpen(false);
    const result = await runAction(() => api.backup());
    if (result) setToast({ text: `备份已保存：${result.path}` });
  }
  const index = useMemo(() => (state ? buildWorkspaceIndex(state) : null), [state]);
  const activeDocuments = index?.activeDocuments || [];
  const folders = index?.folders || [];
  const visibleDocuments = useMemo(
    () =>
      index
        ? selectDocuments(index, {
            query,
            trash: page === 'trash',
            kind: kindFilter,
            tag: tagFilter,
            folder: folderFilter,
            facets: facetFilters,
            sort,
          })
        : [],
    [index, query, page, kindFilter, tagFilter, folderFilter, facetFilters, sort],
  );
  const visibleDocumentIds = useMemo(
    () => visibleDocuments.map((doc) => doc.id),
    [visibleDocuments],
  );
  const selectedDocument = index?.documents.get(selectedId);
  useEffect(() => {
    const ids = new Set(visibleDocumentIds);
    setChecked((current) => current.filter((id) => ids.has(id)));
    if (
      (page === 'documents' || page === 'trash') &&
      selectedDocument &&
      !ids.has(selectedDocument.id)
    )
      setSelectedId('');
  }, [page, selectedDocument, visibleDocumentIds]);
  const hasFilters = Boolean(
    query || kindFilter || tagFilter || folderFilter || Object.values(facetFilters).some(Boolean),
  );
  const clearFilters = () => {
    setQuery('');
    setKindFilter('');
    setTagFilter('');
    setFolderFilter('');
    setFacetFilters({});
    setChecked([]);
  };
  const changePage = (value: Page) => {
    setPage(value);
    setChecked([]);
    setMobileNav(false);
    if (value === 'galaxy') {
      setSelectedId('');
    } else if (value === 'trash') {
      clearFilters();
      setSelectedId(state?.documents.find((doc) => doc.trashed)?.id || '');
    } else if (page === 'trash') {
      setSelectedId(state?.documents.find((doc) => !doc.trashed)?.id || '');
    }
  };
  async function addTagToSelection(tagId: string) {
    if (await command({ type: 'tag-documents', ids: checked, tagId }, '标签已添加')) setChecked([]);
  }

  if (!state || !index)
    return (
      <div className="loading-screen">
        <Orbit size={28} />
        <h1>NoteOrbit</h1>
        <p>{loadError || '正在打开资料库…'}</p>
        {loadError ? (
          <button className="secondary-button" onClick={() => window.location.reload()}>
            重新打开
          </button>
        ) : (
          <LoaderCircle className="spin" size={20} />
        )}
      </div>
    );

  const pageTitles: Record<Page, string> = {
    documents: '资料库',
    galaxy: '星系',
    organize: '分类与标签',
    trash: '回收站',
  };
  const detailVisible = page !== 'organize' && index.nodeNames.has(selectedId);
  const filterCount = [kindFilter, tagFilter, folderFilter, ...Object.values(facetFilters)].filter(
    Boolean,
  ).length;
  return (
    <div className={`app-shell ${mobileNav ? 'nav-visible' : ''}`}>
      {mobileNav && (
        <button className="nav-scrim" aria-label="关闭导航" onClick={() => setMobileNav(false)} />
      )}
      <aside className="sidebar">
        <div className="brand">
          <Orbit size={21} strokeWidth={1.6} />
          <span>NoteOrbit</span>
        </div>
        <button
          className="library-switch"
          disabled={busy}
          onClick={() => void perform(() => api.chooseLibrary(), '资料库已打开', true)}
          title={state.library.path}
        >
          <FolderOpen size={17} />
          <span>
            <strong>{state.library.name}</strong>
            <small>
              {state.library.mode === 'demo'
                ? '浏览器示例'
                : state.library.isExample
                  ? '本地示例库'
                  : '本地资料库'}
            </small>
          </span>
          <ChevronDown size={14} />
        </button>
        <nav className="main-nav" aria-label="主导航">
          <button
            className={page === 'documents' ? 'active' : ''}
            aria-label="资料管理"
            onClick={() => changePage('documents')}
          >
            <FolderOpen size={17} />
            <span>资料</span>
          </button>
          <button
            className={page === 'galaxy' ? 'active' : ''}
            aria-label="3D 知识星系"
            onClick={() => changePage('galaxy')}
          >
            <Network size={17} />
            <span>星系</span>
          </button>
          <button
            className={page === 'organize' ? 'active' : ''}
            onClick={() => changePage('organize')}
          >
            <Settings2 size={17} />
            <span>分类与标签</span>
          </button>
          <button className={page === 'trash' ? 'active' : ''} onClick={() => changePage('trash')}>
            <Trash2 size={17} />
            <span>回收站</span>
            {index.trashedDocuments.length > 0 && (
              <span className="nav-count">{index.trashedDocuments.length}</span>
            )}
          </button>
        </nav>
        <div className="sidebar-filters">
          <div className="sidebar-section-heading">
            <span>文件夹</span>
          </div>
          <button
            className={`filter-link ${!folderFilter && page === 'documents' ? 'selected' : ''}`}
            onClick={() => {
              clearFilters();
              setPage('documents');
              setMobileNav(false);
            }}
          >
            <Folder size={15} />
            <span>全部资料</span>
            <small>{activeDocuments.length}</small>
          </button>
          {folders.map((folder) => (
            <button
              className={`filter-link ${folderFilter === folder ? 'selected' : ''}`}
              key={folder}
              title={folder}
              onClick={() => {
                clearFilters();
                setFolderFilter(folder);
                setPage('documents');
                setSelectedId('');
                setMobileNav(false);
              }}
            >
              <Folder size={15} />
              <span>{folder}</span>
              <small>{index.folderCounts.get(folder) || 0}</small>
            </button>
          ))}
          <div className="sidebar-section-heading">
            <span>标签</span>
            <button
              className="icon-button"
              aria-label="创建标签"
              title="创建标签"
              onClick={() => setModal('tag')}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="sidebar-tag-list">
            {state.tags.map((tag) => (
              <button
                className={`filter-link ${tagFilter === tag.id ? 'selected' : ''}`}
                key={tag.id}
                onClick={() => {
                  setTagFilter(tagFilter === tag.id ? '' : tag.id);
                  if (page === 'organize' || page === 'trash') setPage('documents');
                  setMobileNav(false);
                }}
              >
                <span className="tag-dot" style={{ background: tag.color }} />
                <span>{tag.name}</span>
                {tagFilter === tag.id && <Check size={13} />}
              </button>
            ))}
          </div>
        </div>
        <div className="sidebar-bottom">
          <HardDrive size={14} />
          <span>{state.library.mode === 'demo' ? '浏览器预览' : '本地资料库'}</span>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="mobile-menu icon-button"
              aria-label="打开导航"
              onClick={() => setMobileNav(true)}
            >
              <Layers3 size={19} />
            </button>
            <h1>{pageTitles[page]}</h1>
          </div>
          <div className="topbar-right">
            {(state.library.isExample || state.library.mode === 'demo') && (
              <span
                className="local-badge"
                title={
                  state.library.mode === 'demo'
                    ? '浏览器预览，桌面版可打开本地文件夹'
                    : '本地示例资料库'
                }
              >
                示例库
              </span>
            )}
            <div className="heading-actions">
              {page === 'organize' ? (
                <button className="primary-button" onClick={() => setModal('facet')}>
                  <Plus size={15} />
                  新建分类
                </button>
              ) : page === 'trash' ? null : (
                <>
                  {page === 'galaxy' ? (
                    <>
                      <button
                        className={`filter-toggle ${filtersExpanded || filterCount ? 'selected' : ''}`}
                        aria-label="筛选资料"
                        title="筛选资料"
                        aria-expanded={filtersExpanded}
                        aria-controls="library-filters"
                        onClick={() => setFiltersExpanded(!filtersExpanded)}
                      >
                        <Settings2 size={15} />
                      </button>
                      <button className="secondary-button" onClick={() => setModal('knowledge')}>
                        <Plus size={15} />
                        添加节点
                      </button>
                      <button className="primary-button" onClick={() => setModal('relation')}>
                        <Link2 size={15} />
                        建立关联
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="secondary-button"
                        disabled={busy}
                        onClick={() => setModal('note')}
                      >
                        <Plus size={15} />
                        新建笔记
                      </button>
                      <button
                        className="primary-button"
                        disabled={busy}
                        onClick={() => void perform(() => api.importFiles(), '文件已导入')}
                      >
                        <Upload size={15} />
                        导入文件
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
            <div className="more-wrapper">
              <button
                className="icon-button"
                title="资料库操作"
                aria-label="资料库操作"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen(!moreOpen)}
              >
                <MoreHorizontal size={20} />
              </button>
              {moreOpen && (
                <>
                  <button
                    className="menu-dismiss"
                    aria-label="关闭资料库菜单"
                    onClick={() => setMoreOpen(false)}
                  />
                  <div className="dropdown-menu">
                    <button
                      disabled={busy}
                      onClick={() => {
                        setMoreOpen(false);
                        void perform(() => api.chooseLibrary(), '资料库已打开', true);
                      }}
                    >
                      <FolderOpen size={15} />
                      打开资料库
                    </button>
                    <button disabled={busy} onClick={() => void backup()}>
                      <ArrowDownToLine size={15} />
                      备份资料库
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => {
                        setMoreOpen(false);
                        void perform(() => api.restoreBackup(), '备份已恢复', true);
                      }}
                    >
                      <RotateCcw size={15} />
                      从备份恢复
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </header>

        <div className={`main-content ${page === 'galaxy' ? 'galaxy-content' : ''}`}>
          {page === 'organize' ? (
            <OrganizeView
              state={state}
              index={index}
              onEditModal={setModal}
              onAddOption={(id) => {
                setOptionFacetId(id);
                setModal('option');
              }}
              onFilterTag={(id) => {
                clearFilters();
                setTagFilter(id);
                setPage('documents');
              }}
              onSelectKnowledge={(id) => {
                setSelectedId(id);
                setPage('galaxy');
              }}
            />
          ) : (
            <>
              {(page !== 'galaxy' || hasFilters) && (
                <div
                  className={`filter-toolbar ${page === 'galaxy' ? 'graph-filter-toolbar' : ''}`}
                >
                  {page !== 'galaxy' && (
                    <div className="search-field">
                      <Search size={16} />
                      <input
                        aria-label="搜索资料"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="搜索资料…"
                      />
                      {query && (
                        <button aria-label="清除搜索" onClick={() => setQuery('')}>
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  )}
                  {page !== 'galaxy' && (
                    <button
                      className={`filter-toggle ${filtersExpanded || filterCount ? 'selected' : ''}`}
                      aria-label="筛选资料"
                      aria-expanded={filtersExpanded}
                      aria-controls="library-filters"
                      onClick={() => setFiltersExpanded(!filtersExpanded)}
                    >
                      <Settings2 size={15} />
                      <span>筛选</span>
                      {filterCount > 0 && <b>{filterCount}</b>}
                    </button>
                  )}
                  {hasFilters && (
                    <div className="active-filters">
                      {folderFilter && (
                        <button onClick={() => setFolderFilter('')}>
                          {folderFilter}
                          <X size={11} />
                        </button>
                      )}
                      {kindFilter && (
                        <button onClick={() => setKindFilter('')}>
                          {kindFilter}
                          <X size={11} />
                        </button>
                      )}
                      {tagFilter && (
                        <button onClick={() => setTagFilter('')}>
                          {index.tags.get(tagFilter)?.name}
                          <X size={11} />
                        </button>
                      )}
                      {Object.entries(facetFilters)
                        .filter(([, value]) => value)
                        .map(([id, value]) => (
                          <button
                            key={id}
                            onClick={() => setFacetFilters({ ...facetFilters, [id]: '' })}
                          >
                            {index.labels.get(value)}
                            <X size={11} />
                          </button>
                        ))}
                      {query && page === 'galaxy' && (
                        <button onClick={() => setQuery('')}>
                          {query}
                          <X size={11} />
                        </button>
                      )}
                      <button className="clear-filters" onClick={clearFilters}>
                        清除
                      </button>
                    </div>
                  )}
                </div>
              )}
              {filtersExpanded && (
                <div id="library-filters" className="facet-filter-row">
                  {page === 'galaxy' && (
                    <div className="search-field">
                      <Search size={15} />
                      <input
                        aria-label="搜索资料"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="筛选资料…"
                      />
                    </div>
                  )}
                  <select
                    aria-label="按文件夹筛选"
                    value={folderFilter}
                    onChange={(event) => setFolderFilter(event.target.value)}
                  >
                    <option value="">全部文件夹</option>
                    {folders.map((folder) => (
                      <option key={folder} value={folder}>
                        {folder}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="按资料类型筛选"
                    value={kindFilter}
                    onChange={(event) => setKindFilter(event.target.value)}
                  >
                    <option value="">全部类型</option>
                    {kinds.map((kind) => (
                      <option key={kind}>{kind}</option>
                    ))}
                  </select>
                  {state.facets
                    .filter((facet) => facet.options.length)
                    .map((facet) => (
                      <select
                        className={facetFilters[facet.id] ? 'has-value' : ''}
                        aria-label={`按${facet.name}筛选`}
                        key={facet.id}
                        value={facetFilters[facet.id] || ''}
                        onChange={(event) =>
                          setFacetFilters({ ...facetFilters, [facet.id]: event.target.value })
                        }
                      >
                        <option value="">{facet.name}</option>
                        {facet.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {index.labels.get(option.id) || option.id}
                          </option>
                        ))}
                      </select>
                    ))}
                </div>
              )}
              <div className={`content-split ${detailVisible ? 'with-detail' : ''}`}>
                <section className={`collection-panel ${page === 'galaxy' ? 'galaxy-panel' : ''}`}>
                  {page === 'galaxy' ? (
                    <Suspense
                      fallback={
                        <div className="empty-state">
                          <LoaderCircle className="spin" />
                          <p>正在打开星系…</p>
                        </div>
                      }
                    >
                      <GalaxyView
                        state={state}
                        visibleDocumentIds={visibleDocumentIds}
                        selectedId={selectedId}
                        onSelect={setSelectedId}
                        onSaveLayout={(positions) =>
                          command({ type: 'save-layout', positions }, '布局已保存')
                        }
                      />
                    </Suspense>
                  ) : (
                    <>
                      <DocumentList
                        documents={visibleDocuments}
                        index={index}
                        checked={checked}
                        selectedId={selectedId}
                        busy={busy}
                        sort={sort}
                        trash={page === 'trash'}
                        hasFilters={hasFilters}
                        onCheckedChange={setChecked}
                        onSelect={setSelectedId}
                        onPreview={setPreview}
                        onSort={setSort}
                        onClearFilters={clearFilters}
                        onBatchTag={addTagToSelection}
                      />
                    </>
                  )}
                </section>

                {detailVisible && (
                  <DocumentDetails
                    key={selectedId}
                    state={state}
                    index={index}
                    selectedId={selectedId}
                    busy={busy}
                    onSelect={setSelectedId}
                    onCommand={command}
                    onPreview={setPreview}
                    onOpenOriginal={openOriginal}
                    onEditModal={setModal}
                    onFilterFacet={(facetId, optionId) => {
                      clearFilters();
                      setFacetFilters({ [facetId]: optionId });
                      setPage('documents');
                    }}
                    onFilterTag={(id) => {
                      clearFilters();
                      setTagFilter(id);
                      setPage('documents');
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </main>
      {preview && (
        <Suspense fallback={<div className="busy-indicator">正在打开预览…</div>}>
          <DocumentPreview
            document={preview}
            onClose={() => setPreview(null)}
            onSaved={() => {
              void perform(() => api.snapshot());
            }}
          />
        </Suspense>
      )}
      {modal && (
        <EditModal
          key={`${modal}-${selectedId}`}
          modal={modal}
          state={state}
          document={selectedDocument}
          optionFacetId={optionFacetId}
          selectedId={selectedId}
          nodeCandidates={index.nodeCandidates}
          busy={busy}
          onClose={() => setModal(null)}
          onSubmit={async (value) => {
            const ok = await command(value, modal === 'relation' ? '关联已建立' : '已保存');
            if (ok) setModal(null);
          }}
        />
      )}
      {toast && (
        <div
          className={`toast ${toast.error ? 'error' : ''}`}
          role={toast.error ? 'alert' : 'status'}
        >
          {toast.error ? <CircleHelp size={16} /> : <Check size={16} />}
          <span>{toast.text}</span>
          <button aria-label="关闭提示" onClick={() => setToast(null)}>
            <X size={14} />
          </button>
        </div>
      )}
      {busy && (
        <div className="busy-indicator">
          <LoaderCircle size={14} className="spin" />
          正在处理…
        </div>
      )}
    </div>
  );
}
