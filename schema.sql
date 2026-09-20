PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS authors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 2 AND 100),
    slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 120 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT LIKE '-%' AND slug NOT LIKE '%-'),
    count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0)
);

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) BETWEEN 1 AND 60),
    slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 80 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT LIKE '-%' AND slug NOT LIKE '%-'),
    count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0)
);

CREATE TABLE IF NOT EXISTS papers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE CHECK (length(slug) BETWEEN 1 AND 200 AND slug NOT GLOB '*[^a-z0-9-]*' AND slug NOT LIKE '-%' AND slug NOT LIKE '%-'),
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 5 AND 200),
    author TEXT NOT NULL CHECK (length(trim(author)) BETWEEN 2 AND 100),
    author_slug TEXT NOT NULL REFERENCES authors(slug) ON UPDATE CASCADE ON DELETE RESTRICT,
    explanation TEXT NOT NULL CHECK (length(trim(explanation)) >= 1),
    source_text TEXT NOT NULL CHECK (length(trim(source_text)) BETWEEN 50 AND 12000),
    lang TEXT NOT NULL CHECK (lang IN ('hi', 'en')),
    tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags) AND json_type(tags) = 'array'),
    views INTEGER NOT NULL DEFAULT 0 CHECK (views >= 0),
    word_count INTEGER NOT NULL DEFAULT 0 CHECK (word_count >= 0),
    reading_time INTEGER NOT NULL DEFAULT 1 CHECK (reading_time >= 1),
    ai_provider TEXT NOT NULL CHECK (ai_provider IN ('gemini', 'workers-ai')),
    published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS errors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    endpoint TEXT NOT NULL CHECK (length(trim(endpoint)) BETWEEN 1 AND 200),
    message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 2000),
    provider TEXT CHECK (provider IS NULL OR provider IN ('gemini','workers-ai','none','system')),
    ip_hash TEXT CHECK (ip_hash IS NULL OR (length(ip_hash) = 64 AND ip_hash NOT GLOB '*[^0-9a-f]*'))
);

CREATE INDEX IF NOT EXISTS idx_papers_slug ON papers(slug);
CREATE INDEX IF NOT EXISTS idx_papers_published_at ON papers(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_papers_author_slug ON papers(author_slug);
CREATE INDEX IF NOT EXISTS idx_papers_lang ON papers(lang);
CREATE INDEX IF NOT EXISTS idx_papers_views ON papers(views DESC);
CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);
CREATE INDEX IF NOT EXISTS idx_tags_count ON tags(count DESC);
CREATE INDEX IF NOT EXISTS idx_authors_slug ON authors(slug);
CREATE INDEX IF NOT EXISTS idx_authors_count ON authors(count DESC);
CREATE INDEX IF NOT EXISTS idx_errors_timestamp ON errors(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_errors_endpoint ON errors(endpoint);

CREATE VIRTUAL TABLE IF NOT EXISTS papers_fts USING fts5(
    title, author, explanation, source_text,
    content='papers', content_rowid='id', tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS papers_after_insert AFTER INSERT ON papers BEGIN
    UPDATE authors SET count = count + 1 WHERE slug = NEW.author_slug;
    UPDATE tags SET count = count + 1 WHERE slug IN (SELECT DISTINCT value FROM json_each(NEW.tags) WHERE type = 'text');
    INSERT INTO papers_fts(rowid,title,author,explanation,source_text) VALUES (NEW.id,NEW.title,NEW.author,NEW.explanation,NEW.source_text);
END;

CREATE TRIGGER IF NOT EXISTS papers_after_delete AFTER DELETE ON papers BEGIN
    UPDATE authors SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END WHERE slug = OLD.author_slug;
    UPDATE tags SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END WHERE slug IN (SELECT DISTINCT value FROM json_each(OLD.tags) WHERE type = 'text');
    INSERT INTO papers_fts(papers_fts,rowid,title,author,explanation,source_text) VALUES ('delete',OLD.id,OLD.title,OLD.author,OLD.explanation,OLD.source_text);
END;

CREATE TRIGGER IF NOT EXISTS papers_after_update AFTER UPDATE ON papers BEGIN
    UPDATE authors SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END WHERE slug = OLD.author_slug AND OLD.author_slug <> NEW.author_slug;
    UPDATE authors SET count = count + 1 WHERE slug = NEW.author_slug AND OLD.author_slug <> NEW.author_slug;
    UPDATE tags SET count = CASE WHEN count > 0 THEN count - 1 ELSE 0 END WHERE slug IN (SELECT DISTINCT value FROM json_each(OLD.tags) WHERE type = 'text') AND slug NOT IN (SELECT DISTINCT value FROM json_each(NEW.tags) WHERE type = 'text');
    UPDATE tags SET count = count + 1 WHERE slug IN (SELECT DISTINCT value FROM json_each(NEW.tags) WHERE type = 'text') AND slug NOT IN (SELECT DISTINCT value FROM json_each(OLD.tags) WHERE type = 'text');
    UPDATE papers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id AND updated_at = OLD.updated_at;
    INSERT INTO papers_fts(papers_fts,rowid,title,author,explanation,source_text) VALUES ('delete',OLD.id,OLD.title,OLD.author,OLD.explanation,OLD.source_text);
    INSERT INTO papers_fts(rowid,title,author,explanation,source_text) VALUES (NEW.id,NEW.title,NEW.author,NEW.explanation,NEW.source_text);
END;

CREATE TRIGGER IF NOT EXISTS papers_validate_tags_insert BEFORE INSERT ON papers BEGIN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.tags) WHERE type != 'text' OR length(trim(value)) = 0) THEN RAISE(ABORT, 'papers.tags must contain only non-empty strings') END;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.tags) WHERE value NOT IN (SELECT slug FROM tags)) THEN RAISE(ABORT, 'papers.tags contains unknown tag slugs') END;
END;

CREATE TRIGGER IF NOT EXISTS papers_validate_tags_update BEFORE UPDATE OF tags ON papers BEGIN
    SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.tags) WHERE type != 'text' OR length(trim(value)) = 0) THEN RAISE(ABORT, 'papers.tags must contain only non-empty strings') END;
    SELECT CASE WHEN EXISTS (SELECT 1 FROM json_each(NEW.tags) WHERE value NOT IN (SELECT slug FROM tags)) THEN RAISE(ABORT, 'papers.tags contains unknown tag slugs') END;
END;

CREATE TRIGGER IF NOT EXISTS authors_validate_slug_insert BEFORE INSERT ON authors BEGIN
    SELECT CASE WHEN NEW.slug != lower(NEW.slug) THEN RAISE(ABORT, 'authors.slug must be lowercase') END;
END;

CREATE TRIGGER IF NOT EXISTS tags_validate_slug_insert BEFORE INSERT ON tags BEGIN
    SELECT CASE WHEN NEW.slug != lower(NEW.slug) THEN RAISE(ABORT, 'tags.slug must be lowercase') END;
END;

CREATE TRIGGER IF NOT EXISTS papers_validate_author_insert BEFORE INSERT ON papers BEGIN
    SELECT CASE WHEN NEW.author_slug != lower(NEW.author_slug) THEN RAISE(ABORT, 'papers.author_slug must be lowercase') END;
END;

CREATE TRIGGER IF NOT EXISTS papers_validate_author_update BEFORE UPDATE OF author_slug ON papers BEGIN
    SELECT CASE WHEN NEW.author_slug != lower(NEW.author_slug) THEN RAISE(ABORT, 'papers.author_slug must be lowercase') END;
END;

CREATE TRIGGER IF NOT EXISTS papers_updated_at_guard AFTER UPDATE OF title, author, author_slug, explanation, source_text, lang, tags, views, reading_time, ai_provider ON papers
WHEN NEW.updated_at = OLD.updated_at
BEGIN
    UPDATE papers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;
