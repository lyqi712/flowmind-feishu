export const LATEST_SCHEMA_VERSION = 4;

const CORE_UP = String.raw`
CREATE TABLE IF NOT EXISTS repository_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS source_connections (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  name TEXT NOT NULL,
  external_id TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  sync_cursor TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(source_type, external_id)
);

CREATE TABLE IF NOT EXISTS spaces (
  id TEXT PRIMARY KEY,
  source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  parent_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  space_type TEXT NOT NULL DEFAULT 'knowledge-base',
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_url TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(source_connection_id, external_id)
);

CREATE TABLE IF NOT EXISTS content_items (
  id TEXT PRIMARY KEY,
  source_connection_id TEXT NOT NULL REFERENCES source_connections(id) ON DELETE CASCADE,
  space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  external_id TEXT NOT NULL,
  parent_external_id TEXT,
  content_type TEXT NOT NULL DEFAULT 'document',
  title TEXT NOT NULL DEFAULT '',
  current_content TEXT NOT NULL DEFAULT '',
  revision TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  current_version_id INTEGER,
  mime_type TEXT,
  source_url TEXT,
  author_json TEXT,
  source_created_at TEXT,
  source_modified_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ingested_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(source_connection_id, external_id)
);

CREATE TABLE IF NOT EXISTS content_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  revision TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  source_modified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(content_item_id, revision, content_hash)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  color TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_item_tags (
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY(content_item_id, tag_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  external_id TEXT,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  byte_size INTEGER,
  content_hash TEXT,
  source_url TEXT,
  local_path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(content_item_id, external_id)
);

CREATE TABLE IF NOT EXISTS index_chunks (
  id TEXT PRIMARY KEY,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  content_version_id INTEGER REFERENCES content_versions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  text TEXT NOT NULL,
  token_count INTEGER,
  content_hash TEXT NOT NULL,
  embedding_model TEXT,
  embedding_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(content_item_id, ordinal)
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id TEXT PRIMARY KEY,
  source_connection_id TEXT REFERENCES source_connections(id) ON DELETE SET NULL,
  space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  job_type TEXT NOT NULL DEFAULT 'sync',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','cancelled')),
  dedupe_key TEXT UNIQUE,
  cursor TEXT,
  stats_json TEXT NOT NULL DEFAULT '{}',
  error_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_imports (
  id TEXT PRIMARY KEY,
  source_path TEXT,
  source_hash TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  UNIQUE(source_path, source_hash)
);

CREATE TABLE IF NOT EXISTS content_search_fallback (
  content_item_id TEXT PRIMARY KEY REFERENCES content_items(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_sources_type ON source_connections(source_type, deleted_at);
CREATE INDEX IF NOT EXISTS idx_spaces_source ON spaces(source_connection_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_content_space ON content_items(space_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_content_type ON content_items(content_type, deleted_at);
CREATE INDEX IF NOT EXISTS idx_content_modified ON content_items(source_modified_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_versions_item ON content_versions(content_item_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_item ON attachments(content_item_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_chunks_item ON index_chunks(content_item_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON ingestion_jobs(status, created_at DESC);
`;

const CORE_DOWN = String.raw`
DROP TABLE IF EXISTS content_search_fallback;
DROP TABLE IF EXISTS legacy_imports;
DROP TABLE IF EXISTS ingestion_jobs;
DROP TABLE IF EXISTS index_chunks;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS content_item_tags;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS content_versions;
DROP TABLE IF EXISTS content_items;
DROP TABLE IF EXISTS spaces;
DROP TABLE IF EXISTS source_connections;
DROP TABLE IF EXISTS repository_meta;
DROP TABLE IF EXISTS schema_migrations;
`;

const GRAPH_UP = String.raw`
CREATE TABLE IF NOT EXISTS graph_nodes (
  id TEXT PRIMARY KEY,
  content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
  node_type TEXT NOT NULL,
  space_id TEXT REFERENCES spaces(id) ON DELETE SET NULL,
  path TEXT,
  title TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  properties_json TEXT NOT NULL DEFAULT '{}',
  version_id INTEGER REFERENCES content_versions(id) ON DELETE SET NULL,
  content_hash TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  UNIQUE(content_item_id, node_type)
);

CREATE TABLE IF NOT EXISTS graph_edges (
  id TEXT PRIMARY KEY,
  source_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
  target_node_id TEXT REFERENCES graph_nodes(id) ON DELETE CASCADE,
  edge_type TEXT NOT NULL,
  directed INTEGER NOT NULL DEFAULT 1,
  source_anchor TEXT,
  target_anchor TEXT,
  label TEXT NOT NULL DEFAULT '',
  parsing_status TEXT NOT NULL DEFAULT 'resolved',
  created_source TEXT NOT NULL,
  source_content_item_id TEXT REFERENCES content_items(id) ON DELETE CASCADE,
  source_version_id INTEGER REFERENCES content_versions(id) ON DELETE SET NULL,
  raw_target TEXT,
  occurrence INTEGER NOT NULL DEFAULT 1,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS graph_suggestions (
  id TEXT PRIMARY KEY,
  source_node_id TEXT REFERENCES graph_nodes(id) ON DELETE SET NULL,
  target_node_id TEXT REFERENCES graph_nodes(id) ON DELETE SET NULL,
  edge_type TEXT NOT NULL DEFAULT 'link',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','applied','failed')),
  reason TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  proposed_content_item_id TEXT REFERENCES content_items(id) ON DELETE SET NULL,
  proposed_patch_json TEXT NOT NULL DEFAULT '{}',
  created_source TEXT NOT NULL DEFAULT 'agent',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE IF NOT EXISTS markdown_mirror_roots (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  root_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS markdown_mirror_entries (
  id TEXT PRIMARY KEY,
  root_id TEXT NOT NULL REFERENCES markdown_mirror_roots(id) ON DELETE CASCADE,
  content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  relative_path TEXT NOT NULL,
  base_hash TEXT NOT NULL,
  last_synced_version_id INTEGER REFERENCES content_versions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'synced',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(root_id, relative_path),
  UNIQUE(root_id, content_item_id)
);

CREATE TABLE IF NOT EXISTS markdown_mirror_conflicts (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES markdown_mirror_entries(id) ON DELETE CASCADE,
  disk_hash TEXT NOT NULL,
  database_hash TEXT NOT NULL,
  base_hash TEXT NOT NULL,
  disk_content TEXT NOT NULL,
  database_content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_graph_nodes_item ON graph_nodes(content_item_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_graph_nodes_space ON graph_nodes(space_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_node_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_node_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_graph_edges_status ON graph_edges(parsing_status, deleted_at);
CREATE INDEX IF NOT EXISTS idx_graph_suggestions_status ON graph_suggestions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_markdown_mirror_entries_root ON markdown_mirror_entries(root_id, status);
`;

export const MIGRATIONS = [
  {
    version: 1,
    name: 'core-content-domain',
    up(db, context) {
      db.exec(CORE_UP);
      context.setMeta('search_backend', 'fallback');
    },
    down(db) {
      db.exec(CORE_DOWN);
    }
  },
  {
    version: 2,
    name: 'fts5-search-index',
    up(db, context) {
      if (context.forceSearchFallback) {
        context.setMeta('search_backend', 'fallback');
        return;
      }
      try {
        db.exec(`
          CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
            content_item_id UNINDEXED,
            title,
            content,
            tokenize='unicode61'
          );
        `);
        db.exec(`
          INSERT INTO content_fts(content_item_id, title, content)
          SELECT content_item_id, title, content FROM content_search_fallback
          WHERE content_item_id NOT IN (SELECT content_item_id FROM content_fts);
        `);
        context.setMeta('search_backend', 'fts5');
      } catch (error) {
        try { db.exec('DROP TABLE IF EXISTS content_fts;'); } catch {}
        context.setMeta('search_backend', 'fallback');
        context.setMeta('fts5_error', String(error?.message || error));
      }
    },
    down(db, context) {
      db.exec('DROP TABLE IF EXISTS content_fts;');
      context.setMeta('search_backend', 'fallback');
    }
  },
  {
    version: 3,
    name: 'pdf-originals-and-annotations',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS attachment_blobs (
          attachment_id TEXT PRIMARY KEY REFERENCES attachments(id) ON DELETE CASCADE,
          data BLOB NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS annotations (
          id TEXT PRIMARY KEY,
          content_item_id TEXT NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
          attachment_id TEXT REFERENCES attachments(id) ON DELETE SET NULL,
          page_number INTEGER NOT NULL CHECK(page_number > 0),
          anchor TEXT NOT NULL,
          quote TEXT NOT NULL DEFAULT '',
          comment TEXT NOT NULL DEFAULT '',
          color TEXT NOT NULL DEFAULT 'yellow',
          selector_json TEXT NOT NULL DEFAULT '{}',
          metadata_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          deleted_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_annotations_item_page
          ON annotations(content_item_id, page_number, deleted_at, created_at);
      `);
    },
    down(db) {
      db.exec('DROP TABLE IF EXISTS annotations; DROP TABLE IF EXISTS attachment_blobs;');
    }
  },
  {
    version: 4,
    name: 'explicit-graph-index-and-markdown-mirror',
    up(db) {
      db.exec(GRAPH_UP);
    },
    down(db) {
      db.exec(`
        DROP TABLE IF EXISTS markdown_mirror_conflicts;
        DROP TABLE IF EXISTS markdown_mirror_entries;
        DROP TABLE IF EXISTS markdown_mirror_roots;
        DROP TABLE IF EXISTS graph_suggestions;
        DROP TABLE IF EXISTS graph_edges;
        DROP TABLE IF EXISTS graph_nodes;
      `);
    }
  }
];
