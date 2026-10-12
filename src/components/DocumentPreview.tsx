import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Save, X } from 'lucide-react';
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { api } from '../api';
import type { LibraryDocument, ReadDocumentResult } from '../domain';
import './DocumentPreview.css';
import { useDialogFocus } from './useDialogFocus';
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export default function DocumentPreview({ document: doc, onClose, onSaved }: { document: LibraryDocument; onClose: () => void; onSaved: () => void }) {
  const dialogRef = useDialogFocus<HTMLElement>();
  const [file, setFile] = useState<ReadDocumentResult | null>(null);
  const [error, setError] = useState(''); const [text, setText] = useState(''); const [saving, setSaving] = useState(false);
  const [pdf, setPdf] = useState<pdfjs.PDFDocumentProxy | null>(null); const [page, setPage] = useState(1);
  const canvas = useRef<HTMLCanvasElement>(null); const area = useRef<HTMLDivElement>(null);
  const [image, setImage] = useState('');
  useEffect(() => {
    function escape(event: KeyboardEvent) { if (event.key === 'Escape' && !saving) onClose(); }
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [onClose, saving]);
  useEffect(() => {
    let active = true; let loading: pdfjs.PDFDocumentLoadingTask | undefined; let objectUrl = '';
    setFile(null); setPdf(null); setError(''); setPage(1); setImage('');
    void api.readDocument(doc.id).then(async value => {
      if (!active) return; setFile(value); setText(value.text || '');
      if (doc.extension === 'pdf') {
        const bytes = Uint8Array.from(atob(value.base64), c => c.charCodeAt(0));
        loading = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
        const result = await loading.promise; if (active) setPdf(result);
      } else if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(doc.extension)) {
        objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(value.base64), c => c.charCodeAt(0))], { type: value.mime }));
        if (active) setImage(objectUrl);
      }
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : String(err)); });
    return () => { active = false; if (loading) void loading.destroy(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [doc.id, doc.extension]);
  useEffect(() => {
    if (!pdf || !canvas.current) return; let active = true; let task: pdfjs.RenderTask | undefined;
    void pdf.getPage(page).then(p => {
      if (!active || !canvas.current) return;
      const available = Math.max(250, (area.current?.clientWidth || 680) - 48);
      const normal = p.getViewport({ scale: 1 }); const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const scale = Math.min(1.4, available / normal.width); const viewport = p.getViewport({ scale: scale * ratio });
      canvas.current.width = viewport.width; canvas.current.height = viewport.height;
      canvas.current.style.width = `${viewport.width / ratio}px`; canvas.current.style.height = `${viewport.height / ratio}px`;
      task = p.render({ canvas: canvas.current, viewport }); return task.promise;
    }).catch(err => { if (active && err?.name !== 'RenderingCancelledException') setError(String(err?.message || err)); });
    return () => { active = false; task?.cancel(); };
  }, [pdf, page]);
  const editable = ['md', 'markdown', 'txt'].includes(doc.extension);
  async function save() { setSaving(true); try { await api.command({ type: 'save-note', id: doc.id, content: text }); onSaved(); } catch (err) { setError(err instanceof Error ? err.message : String(err)); } finally { setSaving(false); } }
  return <div className="preview-overlay" role="dialog" aria-modal="true" aria-label={`预览 ${doc.title}`} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="preview-dialog" ref={dialogRef} tabIndex={-1}>
      <header className="preview-header"><div><span className="preview-eyebrow">{editable ? '本地笔记' : '文件预览'}</span><h2>{doc.title}</h2></div><div className="preview-actions">{editable && <button className="primary-button" onClick={save} disabled={saving}><Save size={16} />{saving ? '保存中…' : '保存笔记'}</button>}<button className="icon-button" aria-label="关闭预览" onClick={onClose}><X size={20} /></button></div></header>
      <div className="preview-body" ref={area}>
        {error ? <div className="preview-message" role="alert">{error}</div> : !file ? <div className="preview-message">正在读取本地资料…</div> : editable ? <textarea className="note-editor" aria-label="笔记内容" value={text} onChange={e => setText(e.target.value)} spellCheck={false} /> : doc.extension === 'pdf' ? <div className="pdf-page"><canvas ref={canvas} aria-label={`PDF 第 ${page} 页`} />{!pdf && <p>正在加载 PDF…</p>}</div> : image ? <img className="document-image" src={image} alt={doc.title} /> : <div className="preview-message"><p>此格式由本机应用打开。</p><button className="button" onClick={() => void api.openDocument(doc.id).catch(err => setError(String(err.message || err)))}>打开原文件</button></div>}
      </div>
      <footer className="preview-footer"><span>{doc.path}</span>{pdf && <div className="pdf-pagination"><button className="icon-button" aria-label="上一页" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={16} /></button><span>{page} / {pdf.numPages}</span><button className="icon-button" aria-label="下一页" disabled={page >= pdf.numPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={16} /></button></div>}</footer>
    </section>
  </div>;
}
