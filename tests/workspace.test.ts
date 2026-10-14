import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LibraryDocument, WorkspaceState } from '../src/domain.ts';
import {
  buildWorkspaceIndex,
  optionLabels,
  selectDocuments,
  type DocumentFilters,
} from '../src/lib/workspace.ts';
import { isImage, isTextNote, supportedExtensions } from '../src/lib/files.ts';

function fixture(): WorkspaceState {
  const doc = (
    id: string,
    title: string,
    values: LibraryDocument['values'],
    extra: Partial<LibraryDocument> = {},
  ): LibraryDocument => ({
    id,
    title,
    values,
    path: `试卷/七年级/${title}.pdf`,
    extension: 'pdf',
    kind: '试卷',
    size: 128,
    updatedAt: '2026-10-01T00:00:00.000Z',
    tagIds: [],
    ...extra,
  });
  return {
    schemaVersion: 1,
    library: { name: '测试', path: '/library', mode: 'demo' },
    facets: [
      {
        id: 'chapter',
        name: '章节',
        type: 'tree',
        options: [
          { id: 'leaf', label: '移项', parentId: 'unit' },
          { id: 'root', label: '七上' },
          { id: 'geometry', label: '几何' },
          { id: 'unit', label: '方程', parentId: 'root' },
        ],
      },
      { id: 'year', name: '年份', type: 'number', options: [] },
      { id: 'source', name: '来源', type: 'text', options: [] },
    ],
    tags: [{ id: 'review', name: '待复习', color: '#7c5cce' }],
    documents: [
      doc('d1', 'Algebra', { chapter: ['leaf'], year: 2026 }, { tagIds: ['review'] }),
      doc(
        'd2',
        'Geometry',
        { chapter: ['geometry'], source: '实验学校', year: 0 },
        { updatedAt: '2026-10-03T00:00:00.000Z' },
      ),
      doc(
        'd3',
        'Methods',
        { chapter: ['root', 'geometry'] },
        {
          kind: '笔记',
          path: '笔记/Methods.md',
          extension: 'md',
          updatedAt: '2026-10-02T00:00:00.000Z',
        },
      ),
      doc(
        'trash',
        'Old exam',
        { chapter: ['leaf'] },
        { trashed: true, tagIds: ['review'], path: '.galaxy/trash/old.pdf' },
      ),
    ],
    knowledge: [{ id: 'k1', title: '等式性质', type: '知识点' }],
    relationTypes: [{ id: 'covers', name: '考查' }],
    relations: [
      { id: 'r1', source: 'd1', target: 'k1', typeId: 'covers' },
      { id: 'r2', source: 'k1', target: 'd2', typeId: 'covers' },
      { id: 'r3', source: 'd3', target: 'd1', typeId: 'covers' },
    ],
  };
}
const defaults: DocumentFilters = {
  query: '',
  trash: false,
  kind: '',
  tag: '',
  folder: '',
  facets: {},
  sort: 'title',
};
const ids = (state: WorkspaceState, overrides: Partial<DocumentFilters> = {}) =>
  selectDocuments(buildWorkspaceIndex(state), { ...defaults, ...overrides }).map((doc) => doc.id);

test('indexes exclude trash from counts and candidates while keeping reverse relations', () => {
  const index = buildWorkspaceIndex(fixture());
  assert.equal(index.folderCounts.get('试卷/七年级'), 2);
  assert.equal(index.folderCounts.get('笔记'), 1);
  assert.equal(index.tagCounts.get('review'), 1);
  assert(!index.nodeCandidates.some((node) => node.id === 'trash'));
  assert.equal(index.relations.get('k1')?.length, 2);
  assert.equal(index.labels.get('leaf'), '七上 / 方程 / 移项');
  assert.equal(index.options.get('leaf')?.facetId, 'chapter');
});

test('search matches titles, paths, tags, scalar values, ancestors and both relation directions', () => {
  const state = fixture();
  assert.deepEqual(ids(state, { query: ' ALGEBRA ' }), ['d1', 'd3']);
  assert.deepEqual(ids(state, { query: '试卷/七年级' }), ['d1', 'd2']);
  assert.deepEqual(ids(state, { query: '待复习' }), ['d1']);
  assert.deepEqual(ids(state, { query: '实验学校' }), ['d2']);
  assert.deepEqual(ids(state, { query: '七上' }), ['d1', 'd3']);
  assert.deepEqual(ids(state, { query: '等式性质' }), ['d1', 'd2']);
  assert.deepEqual(ids(state, { query: 'Methods' }), ['d1', 'd3']);
  assert.deepEqual(ids(state, { query: '0' }), ['d1', 'd2']);
  assert.deepEqual(ids(state, { query: '没有的资料' }), []);
});

test('tree parent filters include descendants and combine with tag, folder and kind filters', () => {
  const state = fixture();
  assert.deepEqual(ids(state, { facets: { chapter: 'root' } }), ['d1', 'd3']);
  assert.deepEqual(ids(state, { facets: { chapter: 'unit' } }), ['d1']);
  assert.deepEqual(ids(state, { facets: { chapter: 'geometry' } }), ['d2', 'd3']);
  assert.deepEqual(
    ids(state, { facets: { chapter: 'root' }, kind: '试卷', folder: '试卷/七年级', tag: 'review' }),
    ['d1'],
  );
  assert.deepEqual(ids(state, { facets: { chapter: 'root' }, kind: '教材' }), []);
  assert.deepEqual(ids(state, { facets: { chapter: '' } }), ['d1', 'd2', 'd3']);
});

test('sort and trash selection do not mutate the source snapshot or index', () => {
  const state = fixture();
  const before = structuredClone(state);
  const index = buildWorkspaceIndex(state);
  assert.deepEqual(
    selectDocuments(index, { ...defaults, sort: 'updated' }).map((doc) => doc.id),
    ['d2', 'd3', 'd1'],
  );
  assert.deepEqual(
    selectDocuments(index, { ...defaults, trash: true }).map((doc) => doc.id),
    ['trash'],
  );
  assert.deepEqual(
    index.activeDocuments.map((doc) => doc.id),
    ['d1', 'd2', 'd3'],
  );
  assert.deepEqual(state, before);
});

test('a malformed demo hierarchy terminates safely', () => {
  const facet = fixture().facets[0];
  facet.options = [
    { id: 'a', label: '甲', parentId: 'b' },
    { id: 'b', label: '乙', parentId: 'a' },
  ];
  assert(optionLabels(facet).get('a')?.includes('甲'));
  const state = fixture();
  state.facets = [facet];
  state.documents[0].values = { chapter: ['b'] };
  assert.deepEqual(ids(state, { facets: { chapter: 'a' } }), ['d1']);
});

test('frontend format recognition includes .markdown and GIF without partial matches', () => {
  assert(isTextNote('markdown'));
  assert(isTextNote('md'));
  assert(isTextNote('txt'));
  assert(isImage('gif'));
  assert(isImage('jpeg'));
  assert(isImage('webp'));
  assert(!isImage('png.exe'));
  assert(!isImage('notjpg'));
  assert(!isTextNote('docx'));
  assert(supportedExtensions.includes('markdown'));
  assert(supportedExtensions.includes('gif'));
});
