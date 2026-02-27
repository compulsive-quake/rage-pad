import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

// ── Types ────────────────────────────────────────────────────────────────────

export interface SoundRow {
  id: number;
  title: string;
  file_name: string;
  artist: string;
  duration_ms: number;
  added_date: string;
  last_played_date: string | null;
  play_count: number;
  category_id: number;
  sort_order: number;
  has_uncropped: number;
  icon: string;
  icon_is_base64: number;
  hide_title: number;
}

export interface CategoryRow {
  id: number;
  name: string;
  parent_id: number | null;
  icon: string;
  icon_is_base64: number;
  hidden: number;
  sort_order: number;
}

/** Matches the existing frontend Sound interface (with id replacing index). */
export interface Sound {
  id: number;
  title: string;
  url: string;
  artist: string;
  duration: string;
  addedDate: string;
  lastPlayedDate: string;
  playCount: number;
  category: string;
  parentCategory: string;
  categoryImage: string;
  categoryIndex: number;
  customTag?: string;
  hasUncropped?: boolean;
  icon?: string;
  iconIsBase64?: boolean;
  hideTitle?: boolean;
}

export interface CategoryIcon {
  name: string;
  icon: string;
  isBase64: boolean;
}

// ── SoundDb ──────────────────────────────────────────────────────────────────

export class SoundDb {
  private db: Database.Database;
  private soundsDir: string;

  constructor(dbPath: string, soundsDir: string) {
    this.soundsDir = soundsDir;

    // Ensure directories exist
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
    if (!fs.existsSync(soundsDir)) fs.mkdirSync(soundsDir, { recursive: true });

    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.createSchema();
  }

  // ── Schema ───────────────────────────────────────────────────────────────

  private createSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        icon TEXT NOT NULL DEFAULT '',
        icon_is_base64 INTEGER NOT NULL DEFAULT 0,
        hidden INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sounds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        file_name TEXT NOT NULL,
        artist TEXT NOT NULL DEFAULT '',
        duration_ms INTEGER NOT NULL DEFAULT 0,
        added_date TEXT NOT NULL DEFAULT (datetime('now')),
        last_played_date TEXT,
        play_count INTEGER NOT NULL DEFAULT 0,
        category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        has_uncropped INTEGER NOT NULL DEFAULT 0
      );
    `);

    // Migration: drop raw_title column if it exists
    const columns = this.db.prepare("PRAGMA table_info(sounds)").all() as { name: string }[];
    if (columns.some(c => c.name === 'raw_title')) {
      this.db.exec('ALTER TABLE sounds DROP COLUMN raw_title');
    }

    // Migration: add icon columns to sounds if missing
    const colNames = new Set(columns.map(c => c.name));
    if (!colNames.has('icon')) {
      this.db.exec("ALTER TABLE sounds ADD COLUMN icon TEXT NOT NULL DEFAULT ''");
      this.db.exec("ALTER TABLE sounds ADD COLUMN icon_is_base64 INTEGER NOT NULL DEFAULT 0");
      this.db.exec("ALTER TABLE sounds ADD COLUMN hide_title INTEGER NOT NULL DEFAULT 0");
    }
  }

  // ── Sound file paths ─────────────────────────────────────────────────────

  getSoundsDir(): string {
    return this.soundsDir;
  }

  getSoundFilePath(id: number): string | null {
    const row = this.db.prepare('SELECT file_name FROM sounds WHERE id = ?').get(id) as { file_name: string } | undefined;
    if (!row) return null;
    return path.join(this.soundsDir, row.file_name);
  }

  getUncroppedPath(fileName: string): string {
    const ext = path.extname(fileName);
    const base = path.basename(fileName, ext);
    return path.join(this.soundsDir, `${base}_uncropped${ext}`);
  }

  // ── Sounds CRUD ──────────────────────────────────────────────────────────

  getAllSounds(): Sound[] {
    const rows = this.db.prepare(`
      SELECT s.*, c.name AS category_name, pc.name AS parent_category_name
      FROM sounds s
      JOIN categories c ON s.category_id = c.id
      LEFT JOIN categories pc ON c.parent_id = pc.id
      ORDER BY c.sort_order, s.sort_order
    `).all() as (SoundRow & { category_name: string; parent_category_name: string | null })[];

    return rows.map(row => this.rowToSound(row));
  }

  searchSounds(query: string): Sound[] {
    const pattern = `%${query}%`;
    const rows = this.db.prepare(`
      SELECT s.*, c.name AS category_name, pc.name AS parent_category_name
      FROM sounds s
      JOIN categories c ON s.category_id = c.id
      LEFT JOIN categories pc ON c.parent_id = pc.id
      WHERE s.title LIKE ? OR s.artist LIKE ? OR c.name LIKE ?
      ORDER BY c.sort_order, s.sort_order
    `).all(pattern, pattern, pattern) as (SoundRow & { category_name: string; parent_category_name: string | null })[];

    return rows.map(row => this.rowToSound(row));
  }

  addSound(params: {
    title: string;
    fileName: string;
    artist?: string;
    durationMs?: number;
    categoryId: number;
    hasUncropped?: boolean;
    icon?: string;
    iconIsBase64?: boolean;
    hideTitle?: boolean;
  }): number {
    const maxOrder = this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM sounds WHERE category_id = ?'
    ).get(params.categoryId) as { m: number };

    const result = this.db.prepare(`
      INSERT INTO sounds (title, file_name, artist, duration_ms, category_id, sort_order, has_uncropped, icon, icon_is_base64, hide_title)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      params.title,
      params.fileName,
      params.artist || '',
      params.durationMs || 0,
      params.categoryId,
      maxOrder.m + 1,
      params.hasUncropped ? 1 : 0,
      params.icon || '',
      params.iconIsBase64 ? 1 : 0,
      params.hideTitle ? 1 : 0
    );

    return result.lastInsertRowid as number;
  }

  renameSound(id: number, title: string): boolean {
    const result = this.db.prepare('UPDATE sounds SET title = ? WHERE id = ?').run(title, id);
    return result.changes > 0;
  }

  updateSoundDetails(id: number, params: {
    title?: string;
    artist?: string;
    categoryId?: number;
    icon?: string;
    iconIsBase64?: boolean;
    hideTitle?: boolean;
  }): boolean {
    const sound = this.db.prepare('SELECT * FROM sounds WHERE id = ?').get(id) as SoundRow | undefined;
    if (!sound) return false;

    const newTitle = params.title !== undefined ? params.title : sound.title;
    const newArtist = params.artist !== undefined ? params.artist : sound.artist;
    const newCategoryId = params.categoryId !== undefined ? params.categoryId : sound.category_id;
    const newIcon = params.icon !== undefined ? params.icon : sound.icon;
    const newIconIsBase64 = params.iconIsBase64 !== undefined ? (params.iconIsBase64 ? 1 : 0) : sound.icon_is_base64;
    const newHideTitle = params.hideTitle !== undefined ? (params.hideTitle ? 1 : 0) : sound.hide_title;

    // If changing category, put at end of new category
    let newSortOrder = sound.sort_order;
    if (params.categoryId !== undefined && params.categoryId !== sound.category_id) {
      const maxOrder = this.db.prepare(
        'SELECT COALESCE(MAX(sort_order), -1) AS m FROM sounds WHERE category_id = ?'
      ).get(params.categoryId) as { m: number };
      newSortOrder = maxOrder.m + 1;
    }

    const result = this.db.prepare(`
      UPDATE sounds SET title = ?, artist = ?, category_id = ?, sort_order = ?, icon = ?, icon_is_base64 = ?, hide_title = ?
      WHERE id = ?
    `).run(newTitle, newArtist, newCategoryId, newSortOrder, newIcon, newIconIsBase64, newHideTitle, id);

    return result.changes > 0;
  }

  deleteSound(id: number): { fileName: string } | null {
    const sound = this.db.prepare('SELECT file_name FROM sounds WHERE id = ?').get(id) as { file_name: string } | undefined;
    if (!sound) return null;

    this.db.prepare('DELETE FROM sounds WHERE id = ?').run(id);
    return { fileName: sound.file_name };
  }

  recordPlay(id: number): void {
    this.db.prepare(`
      UPDATE sounds SET play_count = play_count + 1, last_played_date = datetime('now')
      WHERE id = ?
    `).run(id);
  }

  updateSoundFile(id: number, newFileName: string): boolean {
    const result = this.db.prepare('UPDATE sounds SET file_name = ? WHERE id = ?').run(newFileName, id);
    return result.changes > 0;
  }

  setHasUncropped(id: number, hasUncropped: boolean): void {
    this.db.prepare('UPDATE sounds SET has_uncropped = ? WHERE id = ?').run(hasUncropped ? 1 : 0, id);
  }

  /** Move a sound to a category at a specific position (0-based). */
  reorderSound(soundId: number, targetCategoryId: number, targetPosition: number): boolean {
    const sound = this.db.prepare('SELECT * FROM sounds WHERE id = ?').get(soundId) as SoundRow | undefined;
    if (!sound) return false;

    const reorder = this.db.transaction(() => {
      // Remove from old position: shift down sounds after it
      this.db.prepare(`
        UPDATE sounds SET sort_order = sort_order - 1
        WHERE category_id = ? AND sort_order > ?
      `).run(sound.category_id, sound.sort_order);

      // Make room in target category
      this.db.prepare(`
        UPDATE sounds SET sort_order = sort_order + 1
        WHERE category_id = ? AND sort_order >= ?
      `).run(targetCategoryId, targetPosition);

      // Move the sound
      this.db.prepare(`
        UPDATE sounds SET category_id = ?, sort_order = ? WHERE id = ?
      `).run(targetCategoryId, targetPosition, soundId);
    });

    reorder();
    return true;
  }

  // ── Categories CRUD ──────────────────────────────────────────────────────

  getAllCategories(): CategoryRow[] {
    return this.db.prepare('SELECT * FROM categories ORDER BY sort_order').all() as CategoryRow[];
  }

  /** Flat list of categories for dropdown (name + parent). */
  getCategoriesList(): { id: number; name: string; parentCategory: string }[] {
    const rows = this.db.prepare(`
      SELECT c.id, c.name, pc.name AS parent_name
      FROM categories c
      LEFT JOIN categories pc ON c.parent_id = pc.id
      ORDER BY c.sort_order
    `).all() as { id: number; name: string; parent_name: string | null }[];

    return rows.map(r => ({
      id: r.id,
      name: r.name,
      parentCategory: r.parent_name || ''
    }));
  }

  getCategoryByName(name: string): CategoryRow | undefined {
    return this.db.prepare('SELECT * FROM categories WHERE name = ?').get(name) as CategoryRow | undefined;
  }

  getCategoryById(id: number): CategoryRow | undefined {
    return this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as CategoryRow | undefined;
  }

  addCategory(name: string, parentId: number | null = null): number {
    const maxOrder = this.db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM categories WHERE parent_id IS ?'
    ).get(parentId) as { m: number };

    const result = this.db.prepare(`
      INSERT INTO categories (name, parent_id, sort_order) VALUES (?, ?, ?)
    `).run(name, parentId, maxOrder.m + 1);

    return result.lastInsertRowid as number;
  }

  /** Get or create a category by name. */
  getOrCreateCategory(name: string, parentId: number | null = null): number {
    const existing = parentId === null
      ? this.db.prepare('SELECT id FROM categories WHERE name = ? AND parent_id IS NULL').get(name) as { id: number } | undefined
      : this.db.prepare('SELECT id FROM categories WHERE name = ? AND parent_id = ?').get(name, parentId) as { id: number } | undefined;
    if (existing) return existing.id;
    return this.addCategory(name, parentId);
  }

  reorderCategory(categoryId: number, targetPosition: number): boolean {
    const cat = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId) as CategoryRow | undefined;
    if (!cat) return false;

    const reorder = this.db.transaction(() => {
      // Shift categories at the same level
      this.db.prepare(`
        UPDATE categories SET sort_order = sort_order - 1
        WHERE parent_id IS ? AND sort_order > ?
      `).run(cat.parent_id, cat.sort_order);

      this.db.prepare(`
        UPDATE categories SET sort_order = sort_order + 1
        WHERE parent_id IS ? AND sort_order >= ?
      `).run(cat.parent_id, targetPosition);

      this.db.prepare('UPDATE categories SET sort_order = ? WHERE id = ?').run(targetPosition, categoryId);
    });

    reorder();
    return true;
  }

  // ── Category Icons ───────────────────────────────────────────────────────

  getCategoryIcons(): CategoryIcon[] {
    const rows = this.db.prepare(
      'SELECT name, icon, icon_is_base64 FROM categories ORDER BY sort_order'
    ).all() as { name: string; icon: string; icon_is_base64: number }[];

    return rows.map(r => ({
      name: r.name,
      icon: r.icon,
      isBase64: r.icon_is_base64 === 1
    }));
  }

  setCategoryIcon(categoryName: string, iconBase64: string): boolean {
    const result = this.db.prepare(
      'UPDATE categories SET icon = ?, icon_is_base64 = 1 WHERE name = ?'
    ).run(iconBase64, categoryName);
    return result.changes > 0;
  }

  // ── Uncropped backup helpers ─────────────────────────────────────────────

  getUncroppedList(): { id: number; url: string }[] {
    const rows = this.db.prepare(
      'SELECT id, file_name FROM sounds WHERE has_uncropped = 1'
    ).all() as { id: number; file_name: string }[];

    return rows
      .map(r => ({
        id: r.id,
        url: path.join(this.soundsDir, r.file_name)
      }))
      .filter(r => {
        const ext = path.extname(r.url);
        const base = path.basename(r.url, ext);
        const uncroppedPath = path.join(this.soundsDir, `${base}_uncropped${ext}`);
        return fs.existsSync(uncroppedPath);
      });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private rowToSound(row: SoundRow & { category_name: string; parent_category_name: string | null }): Sound {
    const durationSec = Math.round(row.duration_ms / 1000);
    const minutes = Math.floor(durationSec / 60);
    const seconds = durationSec % 60;
    const duration = `${minutes}:${seconds.toString().padStart(2, '0')}`;

    const filePath = path.join(this.soundsDir, row.file_name);
    const hasUncropped = row.has_uncropped === 1;

    return {
      id: row.id,
      title: row.title,
      url: filePath,
      artist: row.artist,
      duration,
      addedDate: row.added_date || '',
      lastPlayedDate: row.last_played_date || '',
      playCount: row.play_count,
      category: row.category_name,
      parentCategory: row.parent_category_name || '',
      categoryImage: '',
      categoryIndex: row.sort_order,
      customTag: row.title,
      hasUncropped,
      icon: row.icon || undefined,
      iconIsBase64: row.icon_is_base64 === 1 || undefined,
      hideTitle: row.hide_title === 1 || undefined,
    };
  }

  close(): void {
    this.db.close();
  }
}
