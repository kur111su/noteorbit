import type { Facet, FacetOption, Relation, WorkspaceState } from '../domain';
import { folderOf } from './format.ts';

export type NodeCandidate = { id: string; label: string; group: string };

export function optionLabels(facet: Facet) {
  const options = new Map(facet.options.map((option) => [option.id, option]));
  const labels = new Map<string, string>();
  function resolve(id: string, visiting = new Set<string>()): string {
    const cached = labels.get(id);
    if (cached !== undefined) return cached;
    const option = options.get(id);
    if (!option || visiting.has(id)) return id;
    visiting.add(id);
    const parent =
      option.parentId && options.has(option.parentId) ? resolve(option.parentId, visiting) : '';
    const label = parent ? `${parent} / ${option.label}` : option.label;
    labels.set(id, label);
    visiting.delete(id);
    return label;
  }
  for (const option of facet.options) resolve(option.id);
  return labels;
}

// Build once per snapshot. Typing in search only scans these prepared strings.
export function buildWorkspaceIndex(state: WorkspaceState) {
  const documents = new Map(state.documents.map((doc) => [doc.id, doc]));
  const tags = new Map(state.tags.map((tag) => [tag.id, tag]));
  const knowledge = new Map(state.knowledge.map((node) => [node.id, node]));
  const facets = new Map(state.facets.map((facet) => [facet.id, facet]));
  const relationTypes = new Map(state.relationTypes.map((type) => [type.id, type]));
  const options = new Map<string, FacetOption & { facetId: string; facetName: string }>();
  const labels = new Map<string, string>();
  const nodeNames = new Map<string, string>();
  const relations = new Map<string, Relation[]>();
  const folderCounts = new Map<string, number>();
  const tagCounts = new Map<string, number>();
  const activeDocuments = state.documents.filter((doc) => !doc.trashed);
  const trashedDocuments = state.documents.filter((doc) => doc.trashed);
  const nodeCandidates: NodeCandidate[] = activeDocuments.map((doc) => ({
    id: doc.id,
    label: doc.title,
    group: '文档',
  }));

  for (const doc of state.documents) nodeNames.set(doc.id, doc.title);
  for (const node of state.knowledge) {
    nodeNames.set(node.id, node.title);
    nodeCandidates.push({ id: node.id, label: node.title, group: node.type });
  }
  for (const facet of state.facets) {
    for (const [id, label] of optionLabels(facet)) labels.set(id, label);
    for (const option of facet.options) {
      options.set(option.id, { ...option, facetId: facet.id, facetName: facet.name });
      nodeNames.set(option.id, option.label);
      nodeCandidates.push({
        id: option.id,
        label: `${facet.name} / ${labels.get(option.id)}`,
        group: '分类',
      });
    }
  }
  for (const tag of state.tags) {
    nodeNames.set(tag.id, tag.name);
    nodeCandidates.push({ id: tag.id, label: tag.name, group: '标签' });
  }
  for (const relation of state.relations) {
    for (const id of [relation.source, relation.target]) {
      const entries = relations.get(id) || [];
      entries.push(relation);
      relations.set(id, entries);
    }
  }
  for (const doc of activeDocuments) {
    const folder = folderOf(doc.path);
    folderCounts.set(folder, (folderCounts.get(folder) || 0) + 1);
    for (const id of doc.tagIds) tagCounts.set(id, (tagCounts.get(id) || 0) + 1);
  }
  const searchText = new Map(
    state.documents.map((doc) => {
      const values = Object.entries(doc.values).flatMap(([id, value]) => {
        if (!facets.has(id)) return [];
        return (Array.isArray(value) ? value : [value]).map(
          (v) => labels.get(String(v)) || String(v ?? ''),
        );
      });
      const linkedNames = (relations.get(doc.id) || []).map(
        (relation) =>
          nodeNames.get(relation.source === doc.id ? relation.target : relation.source) || '',
      );
      return [
        doc.id,
        [
          doc.title,
          doc.path,
          ...doc.tagIds.map((id) => tags.get(id)?.name || ''),
          ...values,
          ...linkedNames,
        ]
          .join(' ')
          .toLocaleLowerCase(),
      ];
    }),
  );
  return {
    documents,
    tags,
    knowledge,
    facets,
    options,
    relationTypes,
    labels,
    nodeNames,
    relations,
    nodeCandidates,
    activeDocuments,
    trashedDocuments,
    folderCounts,
    tagCounts,
    searchText,
    folders: [...folderCounts.keys()].sort(),
  };
}

export type WorkspaceIndex = ReturnType<typeof buildWorkspaceIndex>;
export interface DocumentFilters {
  query: string;
  trash: boolean;
  kind: string;
  tag: string;
  folder: string;
  facets: Record<string, string>;
  sort: string;
}

function acceptedOptions(facet: Facet | undefined, selected: string) {
  const accepted = new Set([selected]);
  if (facet?.type !== 'tree') return accepted;
  const children = new Map<string, string[]>();
  for (const option of facet.options) {
    if (!option.parentId) continue;
    const entries = children.get(option.parentId) || [];
    entries.push(option.id);
    children.set(option.parentId, entries);
  }
  const queue = [selected];
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) || []) {
      if (accepted.has(child)) continue;
      accepted.add(child);
      queue.push(child);
    }
  }
  return accepted;
}

export function selectDocuments(index: WorkspaceIndex, filters: DocumentFilters) {
  const query = filters.query.trim().toLocaleLowerCase();
  // Expand hierarchical filters once per query, rather than for every document.
  const facets = Object.entries(filters.facets)
    .filter(([, value]) => value)
    .map(([id, value]) => [id, acceptedOptions(index.facets.get(id), value)] as const);
  return (filters.trash ? index.trashedDocuments : index.activeDocuments)
    .filter((doc) => {
      if (filters.kind && doc.kind !== filters.kind) return false;
      if (filters.tag && !doc.tagIds.includes(filters.tag)) return false;
      if (filters.folder && folderOf(doc.path) !== filters.folder) return false;
      if (query && !index.searchText.get(doc.id)?.includes(query)) return false;
      return facets.every(([id, accepted]) => {
        const value = doc.values[id];
        return (Array.isArray(value) ? value : [String(value ?? '')]).some((option) =>
          accepted.has(option),
        );
      });
    })
    .sort((a, b) =>
      filters.sort === 'title'
        ? a.title.localeCompare(b.title, 'zh-CN')
        : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
    );
}
