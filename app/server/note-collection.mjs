import { createHash } from 'node:crypto';
import { noteSearchableContent } from './note-knowledge.mjs';

const bodyHash = value => createHash('sha256').update(String(value || '')).digest('hex');

// Keep editable text separate from attachment text used by the search index.
export function canonicalNoteMetadata(note, existing = {}) {
  const { attachments, sourceRefs, tagsText, contentVersionId, contentHash, revision, ...record } = note;
  return {
    ...existing,
    noteId: String(note.id),
    sourceRefs: Array.isArray(sourceRefs) ? sourceRefs : [],
    ...(note.artifactKind ? { artifactKind: note.artifactKind } : {}),
    noteState: {
      ...record,
      // Keep explicit hashes so attachment-index projections can never be
      // mistaken for the editable note body after a restart.
      bodyHash: bodyHash(note.content),
      searchableBodyHash: bodyHash(noteSearchableContent(note))
    }
  };
}

export function createNoteCollection({ repository, writeNote, attachmentManifest }) {
  function read() {
    const notes = [];
    for (let offset = 0; ; offset += 1000) {
      const items = repository.listContentItems({ contentType: 'note', includeDeleted: true, limit: 1000, offset, sortBy: 'createdAt', sortDirection: 'asc' });
      for (const item of items) {
        const record = item.metadata?.noteState || {};
        const { indexedBodyHash, bodyHash: savedBodyHash, searchableBodyHash, deletedAt, ...saved } = record;
        const hasCanonicalBody = typeof savedBodyHash === 'string';
        notes.push({
          ...saved,
          id: item.id,
          contentVersionId: item.currentVersionId,
          contentHash: item.contentHash,
          title: item.title,
          content: hasCanonicalBody
            ? String(record.content || '')
            : indexedBodyHash === bodyHash(item.content) ? String(record.content || '') : String(item.content || ''),
          tags: (item.tags || []).map(tag => typeof tag === 'string' ? tag : tag.name).filter(Boolean),
          sourceRefs: item.metadata?.sourceRefs || saved.sourceRefs || [],
          attachments: repository.listAttachments(item.id).map(attachment => attachmentManifest(item.id, attachment)),
          archived: Boolean(saved.archived ?? item.metadata?.archived),
          ...(item.metadata?.artifactKind ? { artifactKind: item.metadata.artifactKind } : {}),
          createdAt: saved.createdAt || item.createdAt,
          updatedAt: saved.updatedAt || item.updatedAt,
          ...(item.deletedAt ? { deletedAt: item.deletedAt } : {})
        });
      }
      if (items.length < 1000) break;
    }
    return notes;
  }

  function write(next = [], before = []) {
    const previous = new Map(before.map(note => [String(note.id), note]));
    const incoming = new Map();
    for (const note of next) if (note?.id && !incoming.has(String(note.id))) incoming.set(String(note.id), note);
    repository.transaction(() => {
      for (const [id, note] of incoming) {
        if (JSON.stringify(note) === JSON.stringify(previous.get(id))) continue;
        writeNote(note);
        if (note.deletedAt) repository.softDeleteContentItem(id, note.deletedAt);
      }
      for (const [id] of previous) if (!incoming.has(id)) repository.softDeleteContentItem(id);
    });
  }

  function migrate(legacyNotes = []) {
    repository.transaction(() => {
      for (const note of legacyNotes) {
        if (!note?.id) continue;
        const existing = repository.getContentItem(note.id, { includeDeleted: true });
        // A restored/canonical record wins over any stale JSON copy on restart.
        if (existing?.metadata?.noteState) continue;
        writeNote(note);
        if (note.deletedAt || existing?.deletedAt) repository.softDeleteContentItem(note.id, note.deletedAt || existing.deletedAt);
      }
    });
  }

  return { read, write, migrate };
}
