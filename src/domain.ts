export type FacetType = 'single' | 'multi' | 'tree' | 'text' | 'number' | 'date';
export type DocumentKind = '试卷' | '解析' | '笔记' | '教材' | '图片' | '其他';
export type FacetValue = string | string[] | number | null;
export interface FacetOption { id: string; label: string; parentId?: string; }
export interface Facet { id: string; name: string; type: FacetType; options: FacetOption[]; }
export interface Tag { id: string; name: string; color: string; }
export interface LibraryDocument {
  id: string; title: string; path: string; extension: string; kind: DocumentKind;
  size: number; updatedAt: string; tagIds: string[]; values: Record<string, FacetValue>;
  missing?: boolean; trashed?: boolean;
}
export interface KnowledgeNode { id: string; title: string; type: '章节' | '知识点' | '专题'; description?: string; }
export interface RelationType { id: string; name: string; }
export interface Relation { id: string; source: string; target: string; typeId: string; }
export interface WorkspaceState {
  schemaVersion: 1;
  library: { name: string; path: string; mode: 'desktop' | 'demo'; isExample?: boolean };
  documents: LibraryDocument[]; facets: Facet[]; tags: Tag[];
  knowledge: KnowledgeNode[]; relationTypes: RelationType[]; relations: Relation[];
  graphLayout?: Record<string, { x: number; y: number; z: number }>;
}
export type LibraryCommand =
  | { type: 'add-tag'; name: string; color: string }
  | { type: 'add-facet'; name: string; fieldType: FacetType }
  | { type: 'add-option'; facetId: string; label: string; parentId?: string }
  | { type: 'update-document'; id: string; patch: Partial<Pick<LibraryDocument, 'title' | 'kind' | 'tagIds' | 'values'>> }
  | { type: 'add-knowledge'; title: string; nodeType: KnowledgeNode['type'] }
  | { type: 'add-relation'; source: string; target: string; typeId: string }
  | { type: 'remove-relation'; id: string }
  | { type: 'add-relation-type'; name: string }
  | { type: 'create-note'; title: string; content?: string }
  | { type: 'save-note'; id: string; content: string }
  | { type: 'rename-document'; id: string; fileName: string }
  | { type: 'move-document'; id: string; folder: string }
  | { type: 'trash-document'; id: string }
  | { type: 'restore-document'; id: string }
  | { type: 'save-layout'; positions: Record<string, { x: number; y: number; z: number }> };
export interface ReadDocumentResult { mime: string; base64: string; text?: string; }
export interface GalaxyAPI {
  snapshot(): Promise<WorkspaceState>;
  chooseLibrary(): Promise<WorkspaceState | null>;
  importFiles(): Promise<WorkspaceState | null>;
  command(command: LibraryCommand): Promise<WorkspaceState>;
  readDocument(id: string): Promise<ReadDocumentResult>;
  openDocument(id: string): Promise<void>;
  backup(): Promise<{ path: string } | null>;
  restoreBackup(): Promise<WorkspaceState | null>;
}
declare global { interface Window { galaxy?: GalaxyAPI; } }
