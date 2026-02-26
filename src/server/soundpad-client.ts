import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, execSync } from 'child_process';

export interface Sound {
  index: number;
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
  categoryIndex: number; // position of this sound within its category (0-based)
  customTag?: string;    // raw customTag attribute from SPL
  rawTitle?: string;     // raw title attribute from SPL (distinct from computed title)
}

export interface CategoryIcon {
  name: string;
  icon: string; // base64 image data or stock icon name
  isBase64: boolean;
}

export interface SoundpadResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export class SoundpadClient {
  private pipeName: string = '\\\\.\\pipe\\sp_remote_control';
  private soundlistPath: string;
  private cachedConnectionState: boolean | null = null;
  private lastConnectionCheck: number = 0;
  private connectionCheckCacheMs: number = 2000; // Cache connection state for 2 seconds

  constructor() {
    // Path to Soundpad's soundlist.spl file
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    this.soundlistPath = path.join(appData, 'Leppsoft', 'soundlist.spl');
  }

  private async sendCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = net.createConnection(this.pipeName);

      // Update connection cache on successful connection
      const markConnected = () => {
        this.cachedConnectionState = true;
        this.lastConnectionCheck = Date.now();
      };

      const markDisconnected = () => {
        this.cachedConnectionState = false;
        this.lastConnectionCheck = Date.now();
      };
      let data = Buffer.alloc(0);
      let resolved = false;

      client.on('connect', () => {
        // Soundpad expects commands with null terminator
        const commandBuffer = Buffer.from(command + '\0', 'utf-8');
        client.write(commandBuffer);
      });

      client.on('data', (chunk: Buffer) => {
        markConnected(); // Data received means we're connected
        data = Buffer.concat([data, chunk]);

        // Check if we received a complete response (ends with null byte or has complete XML)
        const dataStr = data.toString('utf-8');

        // For simple responses (like "R-0" for success)
        if (dataStr.startsWith('R-') || dataStr.startsWith('E-')) {
          if (!resolved) {
            resolved = true;
            client.end();
            resolve(dataStr.replace(/\0/g, ''));
          }
          return;
        }

        // For XML responses, check if we have complete XML
        if (dataStr.includes('</Soundlist>') || dataStr.includes('</Sounds>') ||
            dataStr.includes('</PlayStatus>') || dataStr.includes('/>')) {
          if (!resolved) {
            resolved = true;
            client.end();
            resolve(dataStr.replace(/\0/g, ''));
          }
        }
      });

      client.on('end', () => {
        if (!resolved) {
          resolved = true;
          resolve(data.toString('utf-8').replace(/\0/g, ''));
        }
      });

      client.on('error', (err: Error) => {
        markDisconnected(); // Error means connection failed
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      client.on('close', () => {
        if (!resolved) {
          resolved = true;
          resolve(data.toString('utf-8').replace(/\0/g, ''));
        }
      });

      // Set timeout for connection
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          client.destroy();
          // If we have some data, return it
          if (data.length > 0) {
            resolve(data.toString('utf-8').replace(/\0/g, ''));
          } else {
            markDisconnected(); // Timeout with no data means disconnected
            reject(new Error('Connection timeout'));
          }
        }
      }, 5000);
    });
  }

  async getSoundList(): Promise<SoundpadResponse> {
    try {
      const response = await this.sendCommand('GetSoundlist()');
      console.log('Soundpad GetSoundlist response:', response.substring(0, 500));
      const sounds = this.parseSoundList(response);

      // Enrich sounds with category hierarchy from soundlist.spl
      if (fs.existsSync(this.soundlistPath)) {
        const splContent = fs.readFileSync(this.soundlistPath, 'utf-8');
        const categoryMap = this.parseCategoryHierarchy(splContent);
        sounds.forEach(sound => {
          const mapping = categoryMap.get(sound.index);
          if (mapping) {
            sound.category = mapping.category;
            sound.parentCategory = mapping.parentCategory;
            sound.categoryIndex = mapping.categoryIndex;
          }
        });
      }

      return { success: true, data: sounds };
    } catch (error) {
      console.error('GetSoundlist error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get sound list'
      };
    }
  }

  async playSound(index: number, speakersOnly = false, micOnly = false): Promise<SoundpadResponse> {
    try {
      // Soundpad uses DoPlaySound for playing by index
      // Second param: play on speakers, Third param: play on microphone
      // If neither speakers-only nor mic-only is enabled, use DoPlaySound with index only
      const neitherEnabled = !speakersOnly && !micOnly;
      const response = await this.sendCommand(
        neitherEnabled
          ? `DoPlaySound(${index})`
          : `DoPlaySound(${index},${speakersOnly},${micOnly})`
      );
      console.log('Soundpad DoPlaySound response:', response);
      return { success: true, data: response };
    } catch (error) {
      console.error('PlaySound error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to play sound'
      };
    }
  }

  async stopSound(): Promise<SoundpadResponse> {
    try {
      // Soundpad uses DoStopSound
      const response = await this.sendCommand('DoStopSound()');
      console.log('Soundpad DoStopSound response:', response);
      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to stop sound'
      };
    }
  }

  async togglePause(): Promise<SoundpadResponse> {
    try {
      // Soundpad uses DoTogglePause
      const response = await this.sendCommand('DoTogglePause()');
      console.log('Soundpad DoTogglePause response:', response);
      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to toggle pause'
      };
    }
  }

  async setVolume(volume: number): Promise<SoundpadResponse> {
    try {
      // Volume should be between 0 and 100
      const clampedVolume = Math.max(0, Math.min(100, volume));
      const response = await this.sendCommand(`SetVolume(${clampedVolume})`);
      return { success: true, data: response };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set volume'
      };
    }
  }

  async searchSounds(query: string): Promise<SoundpadResponse> {
    try {
      const response = await this.sendCommand('GetSoundlist()');
      const sounds = this.parseSoundList(response);
      const filteredSounds = sounds.filter((sound: Sound) =>
        sound.title.toLowerCase().includes(query.toLowerCase()) ||
        sound.artist.toLowerCase().includes(query.toLowerCase())
      );
      return { success: true, data: filteredSounds };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search sounds'
      };
    }
  }

  async renameSound(index: number, newTitle: string): Promise<SoundpadResponse> {
    try {
      // Directly edit the soundlist.spl file to change the customTag attribute for the sound.
      // Sounds in soundlist.spl are identified by their 1-based position in the file (not an
      // index attribute). The display name is stored in the "customTag" attribute.
      if (!fs.existsSync(this.soundlistPath)) {
        return { success: false, error: 'Soundlist file not found' };
      }

      let splContent = fs.readFileSync(this.soundlistPath, 'utf-8');

      const result = this.updateSoundCustomTag(splContent, index, newTitle);
      if (!result.success) {
        return { success: false, error: result.error };
      }

      fs.writeFileSync(this.soundlistPath, result.content!, 'utf-8');
      console.log(`Renamed sound index ${index} to "${newTitle}" in soundlist.spl`);
      return { success: true, data: `Sound renamed to "${newTitle}"` };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to rename sound'
      };
    }
  }

  /**
   * Reliably kill Soundpad and wait until the process is fully gone.
   *
   * Strategy:
   *   1. Send a graceful WM_CLOSE via `taskkill /IM Soundpad.exe` (no /F).
   *   2. Poll `tasklist` every 250 ms to check whether the process is still
   *      running.  Give it up to `gracefulTimeoutMs` (default 6 s) to exit on
   *      its own.
   *   3. If it is still alive after the graceful window, force-kill it with
   *      `taskkill /F /IM Soundpad.exe` and wait another 3 s for the OS to
   *      clean up the process entry.
   *   4. Return only once `tasklist` confirms the process is gone (or after the
   *      combined timeout).
   */
  private async killSoundpadAndWait(gracefulTimeoutMs = 6000): Promise<void> {
    const isSoundpadRunning = (): boolean => {
      try {
        const output = execSync('tasklist /FI "IMAGENAME eq Soundpad.exe" /NH', {
          encoding: 'utf-8',
          timeout: 3000,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        return output.toLowerCase().includes('soundpad.exe');
      } catch {
        return false; // tasklist failed – assume not running
      }
    };

    // If Soundpad isn't running at all, nothing to do
    if (!isSoundpadRunning()) {
      console.log('[killSoundpad] Soundpad was not running');
      return;
    }

    // Step 1: Graceful close
    await new Promise<void>((resolve) => {
      const gracefulKill = spawn('taskkill', ['/IM', 'Soundpad.exe'], { stdio: 'ignore' });
      gracefulKill.on('close', resolve);
      gracefulKill.on('error', resolve); // not running – that's fine
    });

    // Step 2: Poll until the process disappears or the graceful timeout expires
    const gracefulDeadline = Date.now() + gracefulTimeoutMs;
    while (Date.now() < gracefulDeadline) {
      await new Promise(r => setTimeout(r, 250));
      if (!isSoundpadRunning()) {
        console.log(`[killSoundpad] Soundpad exited gracefully after ~${gracefulTimeoutMs - (gracefulDeadline - Date.now())}ms`);
        return;
      }
    }

    // Step 3: Force-kill if still alive
    console.warn('[killSoundpad] Soundpad did not exit gracefully – force-killing');
    await new Promise<void>((resolve) => {
      const forceKill = spawn('taskkill', ['/F', '/IM', 'Soundpad.exe'], { stdio: 'ignore' });
      forceKill.on('close', resolve);
      forceKill.on('error', resolve);
    });

    // Step 4: Wait for the OS to fully remove the process entry (up to 3 s)
    const forceDeadline = Date.now() + 3000;
    while (Date.now() < forceDeadline) {
      await new Promise(r => setTimeout(r, 250));
      if (!isSoundpadRunning()) {
        console.log('[killSoundpad] Soundpad force-killed successfully');
        return;
      }
    }

    console.warn('[killSoundpad] Soundpad process may still be running after force-kill');
  }

  /**
   * Reorder a sound by moving it to a target category at a specific position.
   * This edits the soundlist.spl <Categories> section:
   *   1. Removes the <Sound id="N"/> reference from its current location
   *   2. Inserts it at the target position in the target category
   *   3. Restarts Soundpad to apply changes
   *
   * @param soundIndex 1-based sound index (from Soundpad API)
   * @param targetCategory Name of the target category (or sub-category)
   * @param targetPosition 0-based position within the target category's sound list
   */
  async reorderSound(soundIndex: number, targetCategory: string, targetPosition: number): Promise<SoundpadResponse> {
    if (!fs.existsSync(this.soundlistPath)) {
      return { success: false, error: 'Soundlist file not found' };
    }

    try {
      // SPL file uses 0-based IDs; Soundpad API uses 1-based indices
      const splId = soundIndex - 1;
      // Also match with varying whitespace
      const soundTagRegex = new RegExp(`<Sound\\s+id="${splId}"\\s*/>`, 'g');

      // Step 1: Kill Soundpad
      await this.killSoundpadAndWait();
      this.cachedConnectionState = false;
      this.lastConnectionCheck = 0;

      // Step 2: Read and edit soundlist.spl
      let splContent = fs.readFileSync(this.soundlistPath, 'utf-8');

      // Find the Categories section
      const categoriesMatch = /<Categories>([\s\S]*)<\/Categories>/i.exec(splContent);
      if (!categoriesMatch) {
        // Relaunch Soundpad before returning error
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: false, error: 'No Categories section found in soundlist.spl' };
      }

      let categoriesContent = categoriesMatch[1];

      // Remove the sound reference from wherever it currently is in the Categories section
      const originalLength = categoriesContent.length;
      categoriesContent = categoriesContent.replace(soundTagRegex, '');

      // Clean up any leftover blank lines from removal
      categoriesContent = categoriesContent.replace(/\n\s*\n\s*\n/g, '\n\n');

      if (categoriesContent.length === originalLength) {
        console.warn(`Sound id="${splId}" not found in Categories section, it may be uncategorized`);
      }

      // Find the target category and insert the sound at the target position
      const insertResult = this.insertSoundInCategory(categoriesContent, targetCategory, splId, targetPosition);
      if (!insertResult.success) {
        // Relaunch Soundpad before returning error
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: false, error: insertResult.error || 'Failed to insert sound in target category' };
      }

      // Replace the Categories section in the full SPL content
      splContent = splContent.replace(
        /<Categories>[\s\S]*<\/Categories>/i,
        `<Categories>${insertResult.content}</Categories>`
      );

      // Step 3: Write the updated file
      fs.writeFileSync(this.soundlistPath, splContent, 'utf-8');
      console.log(`Reordered sound index ${soundIndex} to category "${targetCategory}" at position ${targetPosition}`);

      // Step 4: Relaunch Soundpad
      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

      // Step 5: Wait for Soundpad to become available
      await this.waitForSoundpadReady(15000, 500);

      return { success: true, data: `Sound moved to "${targetCategory}" at position ${targetPosition}` };
    } catch (error) {
      console.error('reorderSound error:', error);
      // Try to relaunch Soundpad even on error
      try {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      } catch (e) { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reorder sound'
      };
    }
  }

  /**
   * Move a top-level category to a new position in soundlist.spl.
   * @param categoryName Name of the category to move
   * @param targetPosition 0-based index in the visible (non-hidden) category list
   */
  async reorderCategory(categoryName: string, targetPosition: number): Promise<SoundpadResponse> {
    if (!fs.existsSync(this.soundlistPath)) {
      return { success: false, error: 'Soundlist file not found' };
    }

    try {
      await this.killSoundpadAndWait();
      this.cachedConnectionState = false;
      this.lastConnectionCheck = 0;

      let splContent = fs.readFileSync(this.soundlistPath, 'utf-8');

      const categoriesMatch = /<Categories>([\s\S]*)<\/Categories>/i.exec(splContent);
      if (!categoriesMatch) {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: false, error: 'No Categories section found in soundlist.spl' };
      }

      const categoriesContent = categoriesMatch[1];
      const result = this.reorderCategoryInContent(categoriesContent, categoryName, targetPosition);

      if (!result.success) {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: false, error: result.error };
      }

      splContent = splContent.replace(
        /<Categories>[\s\S]*<\/Categories>/i,
        `<Categories>${result.content}</Categories>`
      );

      fs.writeFileSync(this.soundlistPath, splContent, 'utf-8');
      console.log(`Reordered category "${categoryName}" to position ${targetPosition}`);

      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

      await this.waitForSoundpadReady(15000, 500);

      return { success: true, data: `Category "${categoryName}" moved to position ${targetPosition}` };
    } catch (error) {
      console.error('reorderCategory error:', error);
      try {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      } catch (e) { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to reorder category'
      };
    }
  }

  /**
   * Find all top-level <Category> elements in the given XML content, returning
   * their string positions alongside name and hidden flag.
   */
  private findTopLevelCategoryRanges(
    content: string
  ): Array<{ start: number; end: number; name: string; hidden: boolean }> {
    const ranges: Array<{ start: number; end: number; name: string; hidden: boolean }> = [];
    let i = 0;

    while (i < content.length) {
      const openIdx = content.indexOf('<Category ', i);
      if (openIdx === -1) break;

      const tagEnd = content.indexOf('>', openIdx);
      if (tagEnd === -1) break;

      const isSelfClosing = content[tagEnd - 1] === '/';
      const attrs = content.substring(openIdx + 10, isSelfClosing ? tagEnd - 1 : tagEnd).trim();
      const name = this.extractAttribute(attrs, 'name');
      const hidden = this.extractAttribute(attrs, 'hidden') === 'true';

      if (isSelfClosing) {
        ranges.push({ start: openIdx, end: tagEnd + 1, name: name || '', hidden });
        i = tagEnd + 1;
        continue;
      }

      // Count depth to find the matching </Category>
      let depth = 1;
      let searchPos = tagEnd + 1;
      let closingEnd = -1;

      while (depth > 0 && searchPos < content.length) {
        const nextOpen = content.indexOf('<Category ', searchPos);
        const nextClose = content.indexOf('</Category>', searchPos);
        if (nextClose === -1) break;

        if (nextOpen !== -1 && nextOpen < nextClose) {
          const innerTagEnd = content.indexOf('>', nextOpen);
          if (innerTagEnd !== -1 && content[innerTagEnd - 1] !== '/') {
            depth++;
          }
          searchPos = (innerTagEnd !== -1 ? innerTagEnd : nextOpen) + 1;
        } else {
          depth--;
          if (depth === 0) closingEnd = nextClose + '</Category>'.length;
          searchPos = nextClose + '</Category>'.length;
        }
      }

      if (closingEnd === -1) { i = tagEnd + 1; continue; }

      ranges.push({ start: openIdx, end: closingEnd, name: name || '', hidden });
      i = closingEnd;
    }

    return ranges;
  }

  /**
   * Reorder a named category within the Categories XML string.
   * Only non-hidden, named top-level categories participate in the ordering.
   */
  private reorderCategoryInContent(
    content: string,
    categoryName: string,
    targetPosition: number
  ): { success: boolean; content?: string; error?: string } {
    const allRanges = this.findTopLevelCategoryRanges(content);
    const visibleRanges = allRanges.filter(r => !r.hidden && r.name);

    const sourceIdx = visibleRanges.findIndex(r => r.name === categoryName);
    if (sourceIdx === -1) {
      return { success: false, error: `Category "${categoryName}" not found` };
    }

    const clampedTarget = Math.max(0, Math.min(targetPosition, visibleRanges.length - 1));
    if (sourceIdx === clampedTarget) {
      return { success: true, content };
    }

    // Build the new order
    const reordered = [...visibleRanges];
    const [moved] = reordered.splice(sourceIdx, 1);
    reordered.splice(clampedTarget, 0, moved);

    // Replace each visible slot in reverse order (preserves earlier positions)
    let newContent = content;
    for (let i = visibleRanges.length - 1; i >= 0; i--) {
      const slot = visibleRanges[i];
      const replacement = content.substring(reordered[i].start, reordered[i].end);
      newContent = newContent.substring(0, slot.start) + replacement + newContent.substring(slot.end);
    }

    return { success: true, content: newContent };
  }

  /**
   * Insert a <Sound id="N"/> reference into a specific category at a given position
   * within the Categories XML content.
   */
  private insertSoundInCategory(
    categoriesContent: string,
    targetCategoryName: string,
    splId: number,
    targetPosition: number
  ): { success: boolean; content?: string; error?: string } {
    const soundTag = `<Sound id="${splId}"/>`;

    // Find the target category by name - search for <Category ... name="targetCategoryName" ...>
    // We need to handle both top-level and nested categories
    const escapedName = targetCategoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const categoryOpenRegex = new RegExp(
      `(<Category\\s[^>]*name="${escapedName}"[^>]*>)`,
      'i'
    );

    const categoryMatch = categoryOpenRegex.exec(categoriesContent);
    if (!categoryMatch) {
      return { success: false, error: `Target category "${targetCategoryName}" not found` };
    }

    const categoryOpenEnd = categoryMatch.index + categoryMatch[0].length;

    // Find the matching </Category> for this opening tag
    // We need to handle nested categories, so count depth
    let depth = 1;
    let searchPos = categoryOpenEnd;
    let closingPos = -1;

    while (depth > 0 && searchPos < categoriesContent.length) {
      const nextOpen = categoriesContent.indexOf('<Category ', searchPos);
      const nextClose = categoriesContent.indexOf('</Category>', searchPos);

      if (nextClose === -1) break;

      if (nextOpen !== -1 && nextOpen < nextClose) {
        // Check if it's a self-closing tag
        const tagEnd = categoriesContent.indexOf('>', nextOpen);
        if (tagEnd !== -1 && categoriesContent[tagEnd - 1] === '/') {
          // Self-closing, don't increase depth
          searchPos = tagEnd + 1;
        } else {
          depth++;
          searchPos = nextOpen + 10;
        }
      } else {
        depth--;
        if (depth === 0) {
          closingPos = nextClose;
        }
        searchPos = nextClose + 11;
      }
    }

    if (closingPos === -1) {
      return { success: false, error: `Could not find closing tag for category "${targetCategoryName}"` };
    }

    // Get the content between the opening and closing category tags
    const categoryInnerContent = categoriesContent.substring(categoryOpenEnd, closingPos);

    // Find all existing <Sound id="N"/> references in this category (not in sub-categories)
    const contentWithoutSubs = this.removeNestedCategories(categoryInnerContent);
    const existingSoundRefs: { id: string; fullMatch: string }[] = [];
    const soundRefRegex = /<Sound\s+id="(\d+)"\s*\/>/gi;
    let m;
    while ((m = soundRefRegex.exec(contentWithoutSubs)) !== null) {
      existingSoundRefs.push({ id: m[1], fullMatch: m[0] });
    }

    // Determine where to insert the new sound tag
    if (existingSoundRefs.length === 0 || targetPosition === 0) {
      // Insert at the beginning of the category content (after the opening tag)
      // Find the first non-whitespace position or insert right after opening tag
      const insertPos = categoryOpenEnd;
      const newContent =
        categoriesContent.substring(0, insertPos) +
        '\n      ' + soundTag +
        categoriesContent.substring(insertPos);
      return { success: true, content: newContent };
    }

    if (targetPosition >= existingSoundRefs.length) {
      // Insert after the last sound reference
      const lastRef = existingSoundRefs[existingSoundRefs.length - 1];
      // Find the actual position of this reference in the full category content (not the stripped version)
      const lastRefPos = categoryInnerContent.indexOf(lastRef.fullMatch);
      if (lastRefPos !== -1) {
        const absolutePos = categoryOpenEnd + lastRefPos + lastRef.fullMatch.length;
        const newContent =
          categoriesContent.substring(0, absolutePos) +
          '\n      ' + soundTag +
          categoriesContent.substring(absolutePos);
        return { success: true, content: newContent };
      }
    } else {
      // Insert before the sound at targetPosition
      const targetRef = existingSoundRefs[targetPosition];
      const targetRefPos = categoryInnerContent.indexOf(targetRef.fullMatch);
      if (targetRefPos !== -1) {
        const absolutePos = categoryOpenEnd + targetRefPos;
        const newContent =
          categoriesContent.substring(0, absolutePos) +
          soundTag + '\n      ' +
          categoriesContent.substring(absolutePos);
        return { success: true, content: newContent };
      }
    }

    // Fallback: insert at the end of the category content
    const newContent =
      categoriesContent.substring(0, closingPos) +
      '\n      ' + soundTag + '\n    ' +
      categoriesContent.substring(closingPos);
    return { success: true, content: newContent };
  }

  async restartSoundpad(index: number, newTitle: string): Promise<SoundpadResponse> {
    if (!fs.existsSync(this.soundlistPath)) {
      return { success: false, error: 'Soundlist file not found' };
    }

    // Step 1: Kill Soundpad and wait until it is fully gone before touching the file
    await this.killSoundpadAndWait();

    this.cachedConnectionState = false;
    this.lastConnectionCheck = 0;

    // Step 2: Edit the soundlist.spl XML while Soundpad is closed
    const splContent = fs.readFileSync(this.soundlistPath, 'utf-8');

    const result = this.updateSoundCustomTag(splContent, index, newTitle);

    if (!result.success) {
      // Soundpad is already closed – relaunch before returning the error
      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      return { success: false, error: result.error };
    }

    fs.writeFileSync(this.soundlistPath, result.content!, 'utf-8');
    console.log(`Renamed sound index ${index} to "${newTitle}" in soundlist.spl`);

    // Step 3: Relaunch Soundpad with the updated soundlist
    const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
    spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

    // Step 4: Wait for Soundpad to become available via its named pipe
    await this.waitForSoundpadReady(15000, 500);

    return { success: true, data: `Sound renamed to "${newTitle}" and Soundpad restarting` };
  }

  /**
   * Update the customTag attribute of the Nth <Sound> element (1-based index) in the
   * soundlist.spl XML content.  Sounds in the SPL file do not carry an index attribute;
   * their position in document order is their Soundpad API index (1-based).
   *
   * If the sound already has a customTag attribute it is replaced; if it is absent it is
   * inserted before the closing "/> " of the element.
   *
   * Returns { success: true, content: updatedXml } on success or
   *         { success: false, error: message } on failure.
   */
  private updateSoundCustomTag(
    splContent: string,
    index: number,
    newTitle: string
  ): { success: boolean; content?: string; error?: string } {
    const escapedTitle = newTitle
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

    // Collect the start positions of every <Sound …/> element in document order.
    // We match self-closing Sound tags only (Soundpad uses self-closing elements).
    const soundTagRegex = /<Sound\s[^>]*?\/>/gi;
    const matches: Array<{ index: number; match: string }> = [];
    let m: RegExpExecArray | null;

    while ((m = soundTagRegex.exec(splContent)) !== null) {
      matches.push({ index: m.index, match: m[0] });
    }

    if (index < 1 || index > matches.length) {
      return {
        success: false,
        error: `Sound with index ${index} not found in soundlist (file has ${matches.length} sounds)`
      };
    }

    const target = matches[index - 1]; // convert 1-based to 0-based
    let updatedTag: string;

    if (/\bcustomTag="[^"]*"/.test(target.match)) {
      // Replace existing customTag value
      updatedTag = target.match.replace(/\bcustomTag="[^"]*"/, `customTag="${escapedTitle}"`);
    } else {
      // Insert customTag before the closing />
      updatedTag = target.match.replace(/\s*\/>$/, ` customTag="${escapedTitle}"/>`);
    }

    const updatedContent =
      splContent.slice(0, target.index) +
      updatedTag +
      splContent.slice(target.index + target.match.length);

    return { success: true, content: updatedContent };
  }

  /**
   * Update multiple attributes (customTag, artist, title) on a Sound element in
   * the soundlist.spl file. Optionally moves the sound to a different category.
   *
   * This kills Soundpad, edits the file, and relaunches – all in a single
   * restart cycle.
   */
  async updateSoundDetails(
    index: number,
    customTag: string,
    artist: string,
    title: string,
    targetCategory?: string
  ): Promise<SoundpadResponse> {
    if (!fs.existsSync(this.soundlistPath)) {
      return { success: false, error: 'Soundlist file not found' };
    }

    try {
      // Step 1: Kill Soundpad
      await this.killSoundpadAndWait();
      this.cachedConnectionState = false;
      this.lastConnectionCheck = 0;

      // Step 2: Update attributes in soundlist.spl
      let splContent = fs.readFileSync(this.soundlistPath, 'utf-8');

      const attrResult = this.updateSoundAttributes(splContent, index, { customTag, artist, title });
      if (!attrResult.success) {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: false, error: attrResult.error };
      }
      splContent = attrResult.content!;

      // Step 3: If a target category was given, move the sound reference
      if (targetCategory) {
        const splId = index - 1; // SPL uses 0-based IDs
        const soundTagRegex = new RegExp(`<Sound\\s+id="${splId}"\\s*/>`, 'g');

        const categoriesMatch = /<Categories>([\s\S]*)<\/Categories>/i.exec(splContent);
        if (categoriesMatch) {
          let categoriesContent = categoriesMatch[1];
          categoriesContent = categoriesContent.replace(soundTagRegex, '');
          categoriesContent = categoriesContent.replace(/\n\s*\n\s*\n/g, '\n\n');

          const insertResult = this.insertSoundInCategory(categoriesContent, targetCategory, splId, 999999);
          if (insertResult.success) {
            splContent = splContent.replace(
              /<Categories>[\s\S]*<\/Categories>/i,
              `<Categories>${insertResult.content}</Categories>`
            );
          } else {
            console.warn(`[updateSoundDetails] Could not move to category "${targetCategory}": ${insertResult.error}`);
          }
        }
      }

      // Step 4: Write the updated file
      fs.writeFileSync(this.soundlistPath, splContent, 'utf-8');
      console.log(`Updated details for sound index ${index}`);

      // Step 5: Relaunch Soundpad
      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

      await this.waitForSoundpadReady(15000, 500);

      return { success: true, data: `Sound details updated` };
    } catch (error) {
      console.error('updateSoundDetails error:', error);
      try {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      } catch (e) { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update sound details'
      };
    }
  }

  /**
   * Update one or more attributes on the Nth <Sound> element (1-based index)
   * in the soundlist.spl XML content. Generalizes `updateSoundCustomTag`.
   */
  private updateSoundAttributes(
    splContent: string,
    index: number,
    attrs: { customTag?: string; artist?: string; title?: string }
  ): { success: boolean; content?: string; error?: string } {
    // Collect every <Sound …/> element in document order
    const soundTagRegex = /<Sound\s[^>]*?\/>/gi;
    const matches: Array<{ index: number; match: string }> = [];
    let m: RegExpExecArray | null;

    while ((m = soundTagRegex.exec(splContent)) !== null) {
      matches.push({ index: m.index, match: m[0] });
    }

    if (index < 1 || index > matches.length) {
      return {
        success: false,
        error: `Sound with index ${index} not found in soundlist (file has ${matches.length} sounds)`
      };
    }

    const target = matches[index - 1];
    let updatedTag = target.match;

    for (const [attrName, rawValue] of Object.entries(attrs)) {
      if (rawValue === undefined) continue;
      const escapedValue = rawValue
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const attrRegex = new RegExp(`\\b${attrName}="[^"]*"`);
      if (attrRegex.test(updatedTag)) {
        updatedTag = updatedTag.replace(attrRegex, `${attrName}="${escapedValue}"`);
      } else {
        updatedTag = updatedTag.replace(/\s*\/>$/, ` ${attrName}="${escapedValue}"/>`);
      }
    }

    const updatedContent =
      splContent.slice(0, target.index) +
      updatedTag +
      splContent.slice(target.index + target.match.length);

    return { success: true, content: updatedContent };
  }

  /**
   * Add a new sound file to Soundpad.
   * Since Soundpad has no API for adding files, we must:
   *   1. Close Soundpad so it releases the soundlist.spl file
   *   2. Copy the uploaded file to a permanent location
   *   3. Edit soundlist.spl to add a <Sound> entry in the correct category
   *   4. Relaunch Soundpad
   *
   * @param tempFilePath  Path to the uploaded temp file
   * @param originalName  Original filename (used as display label fallback)
   * @param categoryName  Category (or sub-category) name to place the sound in
   * @param displayName   Optional custom display name provided by the user
   * @param artist        Optional artist metadata to write into the SPL tag
   * @param title         Optional title metadata to write into the SPL tag
   * @param durationSeconds
   * @param uncroppedTempPath
   * @param uncroppedOriginalName
   */
  async addSound(tempFilePath: string, originalName: string, categoryName: string, displayName?: string, artist = '', title = '', durationSeconds = 0, uncroppedTempPath?: string, uncroppedOriginalName?: string): Promise<SoundpadResponse> {
    try {
      if (!fs.existsSync(this.soundlistPath)) {
        return { success: false, error: 'Soundlist file not found' };
      }

      // Determine permanent storage directory next to soundlist.spl
      const soundsDir = path.join(path.dirname(this.soundlistPath), 'sounds');
      if (!fs.existsSync(soundsDir)) {
        fs.mkdirSync(soundsDir, { recursive: true });
      }

      // Build a unique destination filename to avoid collisions
      const ext = path.extname(originalName);
      const baseName = path.basename(originalName, ext);
      let destFileName = originalName;
      let destPath = path.join(soundsDir, destFileName);
      let counter = 1;
      while (fs.existsSync(destPath)) {
        destFileName = `${baseName} (${counter})${ext}`;
        destPath = path.join(soundsDir, destFileName);
        counter++;
      }

      // Copy the uploaded temp file to the permanent location
      fs.copyFileSync(tempFilePath, destPath);

      // Clean up the temp file
      try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }

      // If an uncropped original was provided, save it alongside with _uncropped suffix
      if (uncroppedTempPath && uncroppedOriginalName) {
        const uncroppedExt = path.extname(uncroppedOriginalName);
        const uncroppedBaseName = path.basename(destFileName, ext);
        const uncroppedDestPath = path.join(soundsDir, `${uncroppedBaseName}_uncropped${uncroppedExt}`);
        fs.copyFileSync(uncroppedTempPath, uncroppedDestPath);
        try { fs.unlinkSync(uncroppedTempPath); } catch { /* ignore */ }
        console.log(`[addSound] Saved uncropped backup: ${uncroppedDestPath}`);
      }

      // Step 1: Kill Soundpad and wait until it is fully gone before touching the file
      await this.killSoundpadAndWait();

      this.cachedConnectionState = false;
      this.lastConnectionCheck = 0;

      // Step 2: Edit soundlist.spl to add the new sound
      let splContent = fs.readFileSync(this.soundlistPath, 'utf-8');

      // Build the display label from the custom name or filename (without extension)
      const displayLabel = displayName || baseName;
      const escapedLabel = displayLabel
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const escapedUrl = destPath
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const escapedArtist = artist
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      const escapedTitle = title
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');

      // Format duration as MM:SS for the SPL tag (Soundpad uses this format)
      const durationAttr = durationSeconds > 0
        ? ` duration="${Math.floor(durationSeconds / 60)}:${String(Math.floor(durationSeconds % 60)).padStart(2, '0')}"`
        : '';

      // Build the new <Sound /> tag to insert into the Soundlist section
      const newSoundTag = `<Sound url="${escapedUrl}" customTag="${escapedLabel}" artist="${escapedArtist}" title="${escapedTitle}"${durationAttr}/>`;

      // --- Insert the new sound into the flat <Soundlist> section ---
      // The SPL file structure is:
      //   <Soundlist>
      //     <Sound url="..." .../> <!-- flat list of sound definitions -->
      //     ...
      //     <Categories>...</Categories>  <!-- nested inside Soundlist -->
      //     <Hotbar>...</Hotbar>
      //   </Soundlist>
      //
      // Category references use <Sound id="N"/> where N is a 0-based index
      // into the flat list of <Sound url="..."/> entries. We must:
      //   1. Count only <Sound> tags with a url attribute (not id references)
      //   2. Insert the new sound BEFORE <Categories> (not at end of Soundlist)

      const categoriesOpenIdx = splContent.indexOf('<Categories>');
      const soundlistCloseIdx = splContent.lastIndexOf('</Soundlist>');

      if (soundlistCloseIdx === -1) {
        // Relaunch Soundpad before returning error
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: false, error: 'Could not find </Soundlist> in soundlist.spl' };
      }

      // Count only actual sound definitions (those with a url attribute),
      // NOT the <Sound id="N"/> category references inside <Categories>.
      // Search the entire <Soundlist> section since sounds may appear after </Categories>.
      const soundlistOpenIdx = splContent.indexOf('<Soundlist');
      const soundlistSection = splContent.slice(soundlistOpenIdx, soundlistCloseIdx);
      const soundUrlTagRegex = /<Sound\s[^>]*url="[^"]*"[^>]*\/>/gi;
      let existingSoundCount = 0;
      while (soundUrlTagRegex.exec(soundlistSection) !== null) {
        existingSoundCount++;
      }

      const newSoundId = existingSoundCount;

      // Insert the new sound tag BEFORE <Categories> (or before </Soundlist> if no categories)
      const insertIdx = categoriesOpenIdx !== -1 ? categoriesOpenIdx : soundlistCloseIdx;
      splContent =
        splContent.slice(0, insertIdx) +
        '  ' + newSoundTag + '\n' +
        splContent.slice(insertIdx);

      // Insert the sound reference into the correct category in <Categories>
      const newSoundRef = `<Sound id="${newSoundId}"/>`;
      const categoriesMatch = /<Categories>([\s\S]*)<\/Categories>/i.exec(splContent);
      if (categoriesMatch && categoryName) {
        const escapedCatName = categoryName
          .replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Find the category by name – look for <Category ... name="categoryName" ...>
        // We need to insert the sound ref before the closing </Category> of the matching category.
        // Handle both parent and sub-categories by finding the LAST occurrence of the category
        // (sub-categories appear nested inside parents).
        const catOpenRegex = new RegExp(
          `<Category\\s[^>]*name="${escapedCatName}"[^>]*>`,
          'gi'
        );

        let lastCatMatch: RegExpExecArray | null = null;
        let catMatch: RegExpExecArray | null;
        while ((catMatch = catOpenRegex.exec(splContent)) !== null) {
          lastCatMatch = catMatch;
        }

        if (lastCatMatch) {
          // Find the matching </Category> for this opening tag
          const afterOpen = lastCatMatch.index + lastCatMatch[0].length;
          let depth = 1;
          let j = afterOpen;
          let closingIdx = -1;

          while (j < splContent.length && depth > 0) {
            const nextOpen = splContent.indexOf('<Category', j);
            const nextClose = splContent.indexOf('</Category>', j);

            if (nextClose === -1) break;

            if (nextOpen !== -1 && nextOpen < nextClose) {
              // Check if self-closing
              const tagEnd = splContent.indexOf('>', nextOpen);
              if (tagEnd !== -1 && splContent[tagEnd - 1] !== '/') {
                depth++;
              }
              j = tagEnd + 1;
            } else {
              depth--;
              if (depth === 0) {
                closingIdx = nextClose;
              }
              j = nextClose + '</Category>'.length;
            }
          }

          if (closingIdx !== -1) {
            // Insert the sound reference just before </Category>
            splContent =
              splContent.slice(0, closingIdx) +
              '  ' + newSoundRef + '\n' +
              splContent.slice(closingIdx);
          }
        }
      }

      // Write the updated soundlist.spl
      fs.writeFileSync(this.soundlistPath, splContent, 'utf-8');
      console.log(`Added sound "${displayLabel}" to category "${categoryName}" in soundlist.spl`);

      // Step 3: Relaunch Soundpad
      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

      // Step 4: Wait for Soundpad to become available via its named pipe
      await this.waitForSoundpadReady(15000, 500);

      return { success: true, data: `Sound "${displayLabel}" added to "${categoryName}" and Soundpad restarted` };
    } catch (error) {
      // Attempt to relaunch Soundpad even on error
      try {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      } catch { /* ignore */ }

      // Clean up temp file on error
      try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch { /* ignore */ }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to add sound'
      };
    }
  }

  /**
   * Get the list of categories and sub-categories from soundlist.spl.
   * Returns a flat list of { name, parentCategory } objects.
   */
  getCategoriesList(): { name: string; parentCategory: string }[] {
    if (!fs.existsSync(this.soundlistPath)) {
      return [];
    }

    const xmlContent = fs.readFileSync(this.soundlistPath, 'utf-8');
    const categoriesMatch = /<Categories>([\s\S]*)<\/Categories>/i.exec(xmlContent);
    if (!categoriesMatch) {
      return [];
    }

    const result: { name: string; parentCategory: string }[] = [];
    this.collectCategories(categoriesMatch[1], '', result);
    return result;
  }

  /**
   * Recursively collect category names from the <Categories> XML section.
   */
  private collectCategories(
    xmlContent: string,
    parentName: string,
    result: { name: string; parentCategory: string }[]
  ): void {
    const topLevel = this.extractTopLevelCategories(xmlContent);

    for (const { attrs, content } of topLevel) {
      const hidden = this.extractAttribute(attrs, 'hidden');
      if (hidden === 'true') continue;

      const name = this.extractAttribute(attrs, 'name');
      if (!name) continue;

      result.push({ name, parentCategory: parentName });

      // Recurse into sub-categories
      if (/<Category\s/i.test(content)) {
        this.collectCategories(content, name, result);
      }
    }
  }

  async restartSoundpadOnly(): Promise<SoundpadResponse> {
    // Kill Soundpad and wait until it is fully gone, then relaunch it
    await this.killSoundpadAndWait();

    this.cachedConnectionState = false;
    this.lastConnectionCheck = 0;

    const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
    spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

    // Wait for Soundpad to become available via its named pipe
    await this.waitForSoundpadReady(15000, 500);

    return { success: true, data: 'Soundpad restarting' };
  }

  /**
   * Launch Soundpad if it is not already running.
   * Does NOT kill an existing instance first – this is a "start if not running" helper.
   * Returns success:true once Soundpad is detected on the named pipe (or was already running).
   */
  async launchSoundpad(): Promise<SoundpadResponse> {
    try {
      // Check if already running
      const alreadyConnected = await this.quickConnectionCheck();
      if (alreadyConnected) {
        this.cachedConnectionState = true;
        this.lastConnectionCheck = Date.now();
        return { success: true, data: 'Soundpad is already running' };
      }

      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';

      // Check if the executable exists
      if (!fs.existsSync(soundpadPath)) {
        return { success: false, error: `Soundpad executable not found at ${soundpadPath}` };
      }

      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      console.log('[launchSoundpad] Soundpad launched – waiting for pipe…');

      // Wait up to 15 s for Soundpad to become ready
      await this.waitForSoundpadReady(15000, 500);

      // Final check
      const ready = await this.quickConnectionCheck();
      if (ready) {
        this.cachedConnectionState = true;
        this.lastConnectionCheck = Date.now();
        return { success: true, data: 'Soundpad launched successfully' };
      }

      return { success: false, error: 'Soundpad launched but did not become ready in time' };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to launch Soundpad'
      };
    }
  }

  /**
   * Poll the Soundpad named pipe until it responds, or until the timeout expires.
   * This is used after relaunching Soundpad to ensure it is fully ready before
   * the server returns a response to the client.
   *
   * @param timeoutMs  Maximum time to wait (default 15 000 ms)
   * @param intervalMs Polling interval (default 500 ms)
   */
  private async waitForSoundpadReady(timeoutMs = 15000, intervalMs = 500): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const ready = await this.quickConnectionCheck();
        if (ready) {
          // Reset connection cache so subsequent calls see the fresh state
          this.cachedConnectionState = true;
          this.lastConnectionCheck = Date.now();
          console.log(`[addSound] Soundpad ready after ${Date.now() - start}ms`);
          return;
        }
      } catch {
        // ignore – Soundpad not ready yet
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    console.warn(`[addSound] Soundpad did not become ready within ${timeoutMs}ms`);
  }

  async isConnected(): Promise<boolean> {
    const now = Date.now();

    // Return cached state if still valid
    if (this.cachedConnectionState !== null &&
        (now - this.lastConnectionCheck) < this.connectionCheckCacheMs) {
      return this.cachedConnectionState;
    }

    try {
      // Use a fast connection check with short timeout
      const connected = await this.quickConnectionCheck();
      this.cachedConnectionState = connected;
      this.lastConnectionCheck = now;
      return connected;
    } catch (error) {
      this.cachedConnectionState = false;
      this.lastConnectionCheck = now;
      return false;
    }
  }

  private quickConnectionCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      const client = net.createConnection(this.pipeName);
      let resolved = false;

      const cleanup = () => {
        if (!resolved) {
          resolved = true;
          client.destroy();
        }
      };

      client.on('connect', () => {
        // Connection successful - send a simple command to verify
        const commandBuffer = Buffer.from('GetPlayStatus()\0', 'utf-8');
        client.write(commandBuffer);
      });

      client.on('data', () => {
        // Any data received means we're connected
        if (!resolved) {
          resolved = true;
          client.end();
          resolve(true);
        }
      });

      client.on('error', () => {
        cleanup();
        resolve(false);
      });

      client.on('close', () => {
        if (!resolved) {
          resolved = true;
          resolve(false);
        }
      });

      // Fast timeout - 500ms is enough to check if pipe exists
      setTimeout(() => {
        if (!resolved) {
          cleanup();
          resolve(false);
        }
      }, 500);
    });
  }

  private parseSoundList(xmlResponse: string): Sound[] {
    const sounds: Sound[] = [];

    console.log('Parsing sound list, response length:', xmlResponse.length);
    console.log('XML Response sample:', xmlResponse.substring(0, 1000));

    // Soundpad returns XML with nested categories like:
    // <Soundlist>
    //   <Category index="1" name="ParentCategory">
    //     <Category index="2" name="SubCategory">
    //       <Sound index="1" url="..." title="..." ... />
    //     </Category>
    //     <Sound index="2" url="..." title="..." ... />
    //   </Category>
    // </Soundlist>

    // Use recursive parsing to handle nested categories
    const hasCategories = this.parseCategoryRecursive(xmlResponse, '', sounds);

    // If no categories found, fall back to parsing sounds directly
    if (!hasCategories) {
      const soundRegex = /<Sound\s+([^>]*?)(?:\/>|>[\s\S]*?<\/Sound>)/gi;
      let match;

      while ((match = soundRegex.exec(xmlResponse)) !== null) {
        const attrs = match[1] || match[0];

        const indexMatch = /index="(\d+)"/i.exec(attrs);
        if (indexMatch) {
          const index = parseInt(indexMatch[1], 10);
          const url = this.extractAttribute(attrs, 'url') || '';

          // Try to get category from the 'category' attribute if present
          const categoryFromAttr = this.extractAttribute(attrs, 'category');

          const rawCustomTag = this.extractAttribute(attrs, 'tag') || this.extractAttribute(attrs, 'customTag') || '';
          const rawTitle = this.extractAttribute(attrs, 'title') || '';

          const sound: Sound = {
            index,
            title: rawCustomTag ||
                   rawTitle ||
                   this.extractAttribute(attrs, 'name') ||
                   `Sound ${index}`,
            url,
            artist: this.extractAttribute(attrs, 'artist') || '',
            duration: this.extractAttribute(attrs, 'duration') ||
                      this.formatDuration(this.extractAttribute(attrs, 'durationInMs')),
            addedDate: this.extractAttribute(attrs, 'addedDate') || '',
            lastPlayedDate: this.extractAttribute(attrs, 'lastPlayedDate') || '',
            playCount: parseInt(this.extractAttribute(attrs, 'playCount') || '0', 10),
            category: categoryFromAttr || this.extractCategoryFromUrl(url),
            parentCategory: '',
            categoryImage: '',
            categoryIndex: 0,
            customTag: rawCustomTag || undefined,
            rawTitle: rawTitle || undefined,
          };

          sounds.push(sound);
        }
      }
    }

    console.log('Parsed sounds count:', sounds.length);

    return sounds;
  }

  /**
   * Recursively parse categories and their nested sub-categories.
   * Returns true if any categories were found.
   */
  private parseCategoryRecursive(xmlContent: string, parentCategoryName: string, sounds: Sound[]): boolean {
    let hasCategories = false;

    // We need to find top-level <Category> elements only (not nested ones).
    // We do this by scanning character by character to find balanced tags.
    const topLevelCategories = this.extractTopLevelCategories(xmlContent);

    for (const { attrs: categoryAttrs, content: categoryContent } of topLevelCategories) {
      hasCategories = true;
      const categoryName = this.extractAttribute(categoryAttrs, 'name') || 'Uncategorized';
      const categoryImage = this.extractAttribute(categoryAttrs, 'image') ||
                           this.extractAttribute(categoryAttrs, 'icon') ||
                           this.extractAttribute(categoryAttrs, 'iconPath') ||
                           this.extractAttribute(categoryAttrs, 'imagePath') ||
                           '';

      console.log(`Category found: "${categoryName}" (parent: "${parentCategoryName}")`);

      // Check if this category has nested sub-categories
      const hasSubCategories = /<Category\s/i.test(categoryContent);

      if (hasSubCategories) {
        // Recurse into sub-categories, passing this category as the parent
        this.parseCategoryRecursive(categoryContent, categoryName, sounds);

        // Also parse any direct sounds in this category (not inside sub-categories)
        const contentWithoutSubCategories = this.removeNestedCategories(categoryContent);
        this.parseSoundsInContent(contentWithoutSubCategories, categoryName, parentCategoryName, categoryImage, sounds);
      } else {
        // Leaf category - parse sounds directly
        this.parseSoundsInContent(categoryContent, categoryName, parentCategoryName, categoryImage, sounds);
      }
    }

    return hasCategories;
  }

  /**
   * Extract top-level <Category> elements from XML content (non-nested).
   */
  private extractTopLevelCategories(xmlContent: string): Array<{ attrs: string; content: string }> {
    const results: Array<{ attrs: string; content: string }> = [];
    let i = 0;

    while (i < xmlContent.length) {
      // Find the next <Category opening tag
      const categoryStart = xmlContent.indexOf('<Category', i);
      if (categoryStart === -1) break;

      // Find the end of the opening tag
      const openTagEnd = xmlContent.indexOf('>', categoryStart);
      if (openTagEnd === -1) break;

      const openTag = xmlContent.substring(categoryStart, openTagEnd + 1);

      // Check if it's a self-closing tag
      if (openTag.endsWith('/>')) {
        const attrsStr = openTag.slice('<Category'.length, -2).trim();
        results.push({ attrs: attrsStr, content: '' });
        i = openTagEnd + 1;
        continue;
      }

      // Extract attributes from the opening tag
      const attrsStr = openTag.slice('<Category'.length, -1).trim();

      // Find the matching closing </Category> tag, accounting for nesting
      let depth = 1;
      let j = openTagEnd + 1;

      while (j < xmlContent.length && depth > 0) {
        const nextOpen = xmlContent.indexOf('<Category', j);
        const nextClose = xmlContent.indexOf('</Category>', j);

        if (nextClose === -1) break; // Malformed XML

        if (nextOpen !== -1 && nextOpen < nextClose) {
          // Check it's not a self-closing tag
          const nextOpenTagEnd = xmlContent.indexOf('>', nextOpen);
          if (nextOpenTagEnd !== -1 && !xmlContent.substring(nextOpen, nextOpenTagEnd + 1).endsWith('/>')) {
            depth++;
          }
          j = nextOpenTagEnd !== -1 ? nextOpenTagEnd + 1 : nextOpen + 1;
        } else {
          depth--;
          if (depth === 0) {
            const content = xmlContent.substring(openTagEnd + 1, nextClose);
            results.push({ attrs: attrsStr, content });
            i = nextClose + '</Category>'.length;
            break;
          }
          j = nextClose + '</Category>'.length;
        }
      }

      if (depth !== 0) {
        // Couldn't find matching close tag, skip
        i = openTagEnd + 1;
      }
    }

    return results;
  }

  /**
   * Remove nested <Category> blocks from content, leaving only direct sounds.
   */
  private removeNestedCategories(content: string): string {
    let result = content;
    let changed = true;

    // Iteratively remove innermost <Category>...</Category> blocks
    while (changed) {
      changed = false;
      const newResult = result.replace(/<Category\b[^>]*>[\s\S]*?<\/Category>/gi, '');
      if (newResult !== result) {
        result = newResult;
        changed = true;
      }
    }

    return result;
  }

  /**
   * Parse <Sound> elements from content and add them to the sounds array.
   */
  private parseSoundsInContent(
    content: string,
    categoryName: string,
    parentCategoryName: string,
    categoryImage: string,
    sounds: Sound[]
  ): void {
    const soundRegex = /<Sound\s+([^>]*?)(?:\/>|>[\s\S]*?<\/Sound>)/gi;
    let soundMatch;

    while ((soundMatch = soundRegex.exec(content)) !== null) {
      const attrs = soundMatch[1] || soundMatch[0];
      const indexMatch = /index="(\d+)"/i.exec(attrs);

      if (indexMatch) {
        const index = parseInt(indexMatch[1], 10);
        const url = this.extractAttribute(attrs, 'url') || '';
        const rawCustomTag = this.extractAttribute(attrs, 'tag') || this.extractAttribute(attrs, 'customTag') || '';
        const rawTitle = this.extractAttribute(attrs, 'title') || '';

        const sound: Sound = {
          index,
          title: rawCustomTag ||
                 rawTitle ||
                 this.extractAttribute(attrs, 'name') ||
                 `Sound ${index}`,
          url,
          artist: this.extractAttribute(attrs, 'artist') || '',
          duration: this.extractAttribute(attrs, 'duration') ||
                    this.formatDuration(this.extractAttribute(attrs, 'durationInMs')),
          addedDate: this.extractAttribute(attrs, 'addedDate') || '',
          lastPlayedDate: this.extractAttribute(attrs, 'lastPlayedDate') || '',
          playCount: parseInt(this.extractAttribute(attrs, 'playCount') || '0', 10),
          category: categoryName,
          parentCategory: parentCategoryName,
          categoryImage: categoryImage,
          categoryIndex: 0,
          customTag: rawCustomTag || undefined,
          rawTitle: rawTitle || undefined,
        };

        sounds.push(sound);
      }
    }
  }

  private extractCategoryFromUrl(url: string): string {
    if (!url) return 'Uncategorized';

    // Extract the parent folder name from the file path
    // Handle both forward and backslashes
    const normalizedUrl = url.replace(/\\/g, '/');
    const parts = normalizedUrl.split('/');

    // Get the parent folder (second to last part, before the filename)
    if (parts.length >= 2) {
      const parentFolder = parts[parts.length - 2];
      // Return the folder name, or 'Uncategorized' if it looks like a drive letter or root
      if (parentFolder && parentFolder.length > 1 && !parentFolder.match(/^[A-Za-z]:?$/)) {
        return parentFolder;
      }
    }

    return 'Uncategorized';
  }

  private formatDuration(msString: string): string {
    if (!msString) return '0:00';
    const ms = parseInt(msString, 10);
    if (isNaN(ms)) return '0:00';

    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  private extractAttribute(content: string, attrName: string): string {
    // Try different attribute name formats
    const patterns = [
      new RegExp(`${attrName}="([^"]*)"`, 'i'),
      new RegExp(`${attrName}='([^']*)'`, 'i'),
    ];

    for (const regex of patterns) {
      const match = regex.exec(content);
      if (match) {
        return this.decodeXmlEntities(match[1]);
      }
    }
    return '';
  }

  private decodeXmlEntities(str: string): string {
    return str
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
      .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
  }

  async getCategoryIcons(): Promise<SoundpadResponse> {
    try {
      // Read the soundlist.spl file - always reparse from disk
      if (!fs.existsSync(this.soundlistPath)) {
        console.log('Soundlist file not found at:', this.soundlistPath);
        return { success: false, error: 'Soundlist file not found' };
      }

      // Get file stats to log when it was last modified
      const stats = fs.statSync(this.soundlistPath);
      console.log(`Reparsing category icons from soundlist.spl (last modified: ${stats.mtime.toISOString()})`);

      // Read file fresh from disk (no caching)
      const xmlContent = fs.readFileSync(this.soundlistPath, 'utf-8');
      const categoryIcons = this.parseCategoryIcons(xmlContent);

      console.log(`Parsed ${categoryIcons.length} category icons`);

      return { success: true, data: categoryIcons };
    } catch (error) {
      console.error('Error reading category icons:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read category icons'
      };
    }
  }

  private parseCategoryIcons(xmlContent: string): CategoryIcon[] {
    const icons: CategoryIcon[] = [];

    // Find the Categories section
    const categoriesMatch = /<Categories>([\s\S]*?)<\/Categories>/i.exec(xmlContent);
    if (!categoriesMatch) {
      console.log('No Categories section found in soundlist');
      return icons;
    }

    const categoriesContent = categoriesMatch[1];

    // Parse each Category element
    const categoryRegex = /<Category\s+([^>]*?)(?:\/>|>[\s\S]*?<\/Category>)/gi;
    let match;

    while ((match = categoryRegex.exec(categoriesContent)) !== null) {
      const attrs = match[1];
      const name = this.extractAttribute(attrs, 'name');
      const icon = this.extractAttribute(attrs, 'icon');

      // Skip categories without a name (like the hidden list category)
      if (!name) continue;

      // Check if icon is base64 encoded (long string of only base64 chars) or a stock icon name / file path
      const isBase64 = !!(icon && !icon.startsWith('stock_') && /^[A-Za-z0-9+/=]{20,}$/.test(icon));

      icons.push({
        name,
        icon: icon || '',
        isBase64
      });

      console.log(`Category icon found: ${name}, isBase64: ${isBase64}, icon length: ${icon?.length || 0}`);
    }

    return icons;
  }

  /**
   * Update the icon attribute for a category (top-level or sub-category)
   * in soundlist.spl.  Follows the kill → edit → restart pattern.
   */
  async setCategoryIcon(categoryName: string, iconBase64: string): Promise<SoundpadResponse> {
    if (!fs.existsSync(this.soundlistPath)) {
      return { success: false, error: 'Soundlist file not found' };
    }

    try {
      await this.killSoundpadAndWait();
      this.cachedConnectionState = false;
      this.lastConnectionCheck = 0;

      let splContent = fs.readFileSync(this.soundlistPath, 'utf-8');

      const categoriesMatch = /<Categories>([\s\S]*)<\/Categories>/i.exec(splContent);
      if (!categoriesMatch) {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: false, error: 'No Categories section found in soundlist.spl' };
      }

      // Match any <Category ... name="categoryName" ...> tag (self-closing or opening)
      // We need to find the tag and replace/add the icon attribute
      const escapedName = categoryName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const categoryTagRegex = new RegExp(
        `(<Category\\s+)([^>]*?name="${escapedName}"[^>]*?)(\\s*/?>)`,
        'i'
      );

      const tagMatch = categoryTagRegex.exec(splContent);
      if (!tagMatch) {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: false, error: `Category "${categoryName}" not found in soundlist.spl` };
      }

      const [fullMatch, prefix, attrs, suffix] = tagMatch;

      // Replace existing icon attribute or add one
      let newAttrs: string;
      if (/\bicon="[^"]*"/i.test(attrs)) {
        newAttrs = attrs.replace(/\bicon="[^"]*"/i, `icon="${iconBase64}"`);
      } else {
        newAttrs = attrs + ` icon="${iconBase64}"`;
      }

      splContent = splContent.replace(fullMatch, prefix + newAttrs + suffix);

      fs.writeFileSync(this.soundlistPath, splContent, 'utf-8');
      console.log(`Updated icon for category "${categoryName}" (base64 length: ${iconBase64.length})`);

      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

      await this.waitForSoundpadReady(15000, 500);

      return { success: true, data: `Category "${categoryName}" icon updated` };
    } catch (error) {
      console.error('setCategoryIcon error:', error);
      try {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      } catch (e) { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to set category icon'
      };
    }
  }

  /**
   * Parse the <Categories> section of soundlist.spl to build a map of
   * sound index -> { category, parentCategory }.
   * The SPL file uses <Sound id="N"/> references (1-based index) inside
   * nested <Category> elements.
   */
  private parseCategoryHierarchy(xmlContent: string): Map<number, { category: string; parentCategory: string; categoryIndex: number }> {
    const result = new Map<number, { category: string; parentCategory: string; categoryIndex: number }>();

    // Find the Categories section
    const categoriesMatch = /<Categories>([\s\S]*)<\/Categories>/i.exec(xmlContent);
    if (!categoriesMatch) {
      console.log('No Categories section found for hierarchy parsing');
      return result;
    }

    const categoriesContent = categoriesMatch[1];

    // Recursively walk the top-level categories
    this.walkCategoryHierarchy(categoriesContent, '', result);

    console.log(`Category hierarchy: mapped ${result.size} sounds`);
    return result;
  }

  /**
   * Recursively walk <Category> elements, assigning category/parentCategory/categoryIndex
   * to each <Sound id="N"/> found within.
   */
  private walkCategoryHierarchy(
    xmlContent: string,
    parentCategoryName: string,
    result: Map<number, { category: string; parentCategory: string; categoryIndex: number }>
  ): void {
    const topLevel = this.extractTopLevelCategories(xmlContent);

    for (const { attrs, content } of topLevel) {
      const hidden = this.extractAttribute(attrs, 'hidden');
      if (hidden === 'true') continue; // skip hidden system categories

      const categoryName = this.extractAttribute(attrs, 'name');
      if (!categoryName) continue;

      // Find direct <Sound id="N"/> references (not inside nested categories)
      // The order they appear in the XML is the order Soundpad displays them.
      const contentWithoutSubCategories = this.removeNestedCategories(content);
      const soundIdRegex = /<Sound\s+id="(\d+)"\s*\/>/gi;
      let m;
      let categoryIndex = 0;
      while ((m = soundIdRegex.exec(contentWithoutSubCategories)) !== null) {
        // SPL file uses 0-based IDs; Soundpad API returns 1-based indices.
        // Add 1 to convert so the map key matches sound.index from GetSoundlist().
        const soundIndex = parseInt(m[1], 10) + 1;
        result.set(soundIndex, {
          category: categoryName,
          parentCategory: parentCategoryName,
          categoryIndex: categoryIndex++
        });
      }

      // Recurse into sub-categories
      if (/<Category\s/i.test(content)) {
        this.walkCategoryHierarchy(content, categoryName, result);
      }
    }
  }

  /**
   * Restore the uncropped backup for a sound: replace the cropped file with
   * the _uncropped version, then restart Soundpad so it picks up the change.
   */
  async deleteSound(soundIndex: number): Promise<SoundpadResponse> {
    if (!fs.existsSync(this.soundlistPath)) {
      return { success: false, error: 'Soundlist file not found' };
    }

    try {
      // SPL file uses 0-based IDs; Soundpad API uses 1-based indices
      const splId = soundIndex - 1;

      // Step 1: Kill Soundpad so we can safely edit the file
      await this.killSoundpadAndWait();
      this.cachedConnectionState = false;
      this.lastConnectionCheck = 0;

      // Step 2: Read soundlist.spl
      let splContent = fs.readFileSync(this.soundlistPath, 'utf-8');

      // Step 3: Find the Nth <Sound url="..." .../> definition tag (0-based)
      const soundUrlTagRegex = /<Sound\s[^>]*url="([^"]*)"[^>]*\/>/gi;
      let match: RegExpExecArray | null;
      let count = 0;
      let soundDefStart = -1;
      let soundDefEnd = -1;
      let soundFilePath = '';

      while ((match = soundUrlTagRegex.exec(splContent)) !== null) {
        if (count === splId) {
          soundDefStart = match.index;
          soundDefEnd = match.index + match[0].length;
          soundFilePath = match[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"');
          break;
        }
        count++;
      }

      if (soundDefStart === -1) {
        // Relaunch Soundpad before returning error
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
        return { success: false, error: `Sound definition at index ${soundIndex} not found in soundlist.spl` };
      }

      // Step 4: Remove the sound definition tag (and surrounding whitespace/newline)
      // Eat the preceding whitespace on the same line and the trailing newline
      let removeStart = soundDefStart;
      while (removeStart > 0 && splContent[removeStart - 1] === ' ') {
        removeStart--;
      }
      let removeEnd = soundDefEnd;
      if (splContent[removeEnd] === '\r') removeEnd++;
      if (splContent[removeEnd] === '\n') removeEnd++;

      splContent = splContent.slice(0, removeStart) + splContent.slice(removeEnd);

      // Step 5: Remove all <Sound id="splId"/> references from Categories and Hotbar
      const soundRefRegex = new RegExp(`[ \\t]*<Sound\\s+id="${splId}"\\s*/>[ \\t]*\\r?\\n?`, 'g');
      splContent = splContent.replace(soundRefRegex, '');

      // Step 6: Renumber all <Sound id="N"/> where N > splId (decrement by 1)
      splContent = splContent.replace(/<Sound\s+id="(\d+)"\s*\/>/g, (_full, idStr) => {
        const id = parseInt(idStr, 10);
        if (id > splId) {
          return `<Sound id="${id - 1}"/>`;
        }
        return _full;
      });

      // Step 7: Write the updated file
      fs.writeFileSync(this.soundlistPath, splContent, 'utf-8');
      console.log(`[deleteSound] Removed sound index ${soundIndex} (splId=${splId}) from soundlist.spl`);

      // Step 8: Delete the physical audio file and any _uncropped backup
      if (soundFilePath && fs.existsSync(soundFilePath)) {
        try {
          fs.unlinkSync(soundFilePath);
          console.log(`[deleteSound] Deleted audio file: ${soundFilePath}`);
        } catch (e) {
          console.warn(`[deleteSound] Failed to delete audio file: ${soundFilePath}`, e);
        }

        // Delete _uncropped backup if it exists
        const ext = path.extname(soundFilePath);
        const base = path.basename(soundFilePath, ext);
        const dir = path.dirname(soundFilePath);
        const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a', '.opus', '.aiff', '.ape'];
        for (const aExt of audioExts) {
          const uncroppedPath = path.join(dir, `${base}_uncropped${aExt}`);
          if (fs.existsSync(uncroppedPath)) {
            try {
              fs.unlinkSync(uncroppedPath);
              console.log(`[deleteSound] Deleted uncropped backup: ${uncroppedPath}`);
            } catch (e) {
              console.warn(`[deleteSound] Failed to delete uncropped backup: ${uncroppedPath}`, e);
            }
            break;
          }
        }
      }

      // Step 9: Relaunch Soundpad
      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

      // Step 10: Wait for Soundpad to become available
      await this.waitForSoundpadReady(15000, 500);

      return { success: true, data: `Sound "${path.basename(soundFilePath)}" deleted successfully` };
    } catch (error) {
      console.error('deleteSound error:', error);
      // Try to relaunch Soundpad even on error
      try {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      } catch (e) { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to delete sound'
      };
    }
  }

  /**
   * Resolve the filesystem path of the Nth sound in soundlist.spl.
   * @param soundIndex 1-based sound index (from Soundpad API)
   */
  getSoundFilePath(soundIndex: number): string | null {
    if (!fs.existsSync(this.soundlistPath)) return null;

    const splId = soundIndex - 1;
    const splContent = fs.readFileSync(this.soundlistPath, 'utf-8');
    const soundUrlTagRegex = /<Sound\s[^>]*url="([^"]*)"[^>]*\/>/gi;
    let match: RegExpExecArray | null;
    let count = 0;

    while ((match = soundUrlTagRegex.exec(splContent)) !== null) {
      if (count === splId) {
        return match[1]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"');
      }
      count++;
    }
    return null;
  }

  /**
   * Replace a sound's audio file on disk.
   * Kills Soundpad, overwrites (or replaces with new extension), cleans up
   * any _uncropped backup, and relaunches Soundpad.
   */
  async updateSoundFile(soundIndex: number, tempFilePath: string, originalName: string): Promise<SoundpadResponse> {
    try {
      const currentPath = this.getSoundFilePath(soundIndex);
      if (!currentPath) {
        try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
        return { success: false, error: `Sound at index ${soundIndex} not found in soundlist.spl` };
      }

      await this.killSoundpadAndWait();
      this.cachedConnectionState = false;
      this.lastConnectionCheck = 0;

      const currentExt = path.extname(currentPath).toLowerCase();
      const newExt = path.extname(originalName).toLowerCase();

      if (currentExt === newExt) {
        // Same extension — overwrite in place
        fs.copyFileSync(tempFilePath, currentPath);
      } else {
        // Different extension — write new file, update SPL url, remove old file
        const dir = path.dirname(currentPath);
        const base = path.basename(currentPath, currentExt);
        const newPath = path.join(dir, `${base}${newExt}`);
        fs.copyFileSync(tempFilePath, newPath);

        if (fs.existsSync(this.soundlistPath)) {
          let spl = fs.readFileSync(this.soundlistPath, 'utf-8');
          const escapedOld = currentPath.replace(/\\/g, '\\\\').replace(/[.*+?^${}()|[\]]/g, '\\$&');
          spl = spl.replace(new RegExp(escapedOld, 'g'), newPath);
          fs.writeFileSync(this.soundlistPath, spl, 'utf-8');
        }

        try { fs.unlinkSync(currentPath); } catch { /* ignore */ }
      }

      // Clean up temp file
      try { fs.unlinkSync(tempFilePath); } catch { /* ignore */ }

      // Remove any _uncropped backup (user is deliberately replacing the audio)
      const ext = path.extname(currentPath);
      const base = path.basename(currentPath, ext);
      const dir = path.dirname(currentPath);
      const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a', '.opus', '.aiff', '.ape'];
      for (const aExt of audioExts) {
        const uncroppedPath = path.join(dir, `${base}_uncropped${aExt}`);
        if (fs.existsSync(uncroppedPath)) {
          try { fs.unlinkSync(uncroppedPath); } catch { /* ignore */ }
          console.log(`[updateSoundFile] Removed uncropped backup: ${uncroppedPath}`);
          break;
        }
      }

      console.log(`[updateSoundFile] Replaced audio for sound index ${soundIndex}`);

      // Relaunch Soundpad
      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      await this.waitForSoundpadReady(15000, 500);

      return { success: true, data: `Sound file updated successfully` };
    } catch (error) {
      // Try to relaunch Soundpad even on error
      try {
        const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
        spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();
      } catch { /* ignore */ }
      try { if (fs.existsSync(tempFilePath)) fs.unlinkSync(tempFilePath); } catch { /* ignore */ }
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to update sound file'
      };
    }
  }

  async resetCrop(soundUrl: string): Promise<SoundpadResponse> {
    try {
      const soundPath = soundUrl.replace(/\//g, path.sep);
      const ext = path.extname(soundPath);
      const base = path.basename(soundPath, ext);
      const dir = path.dirname(soundPath);

      // Find the _uncropped backup (may have a different extension than the cropped file)
      const audioExts = ['.mp3', '.wav', '.ogg', '.flac', '.aac', '.wma', '.m4a', '.opus', '.aiff', '.ape'];
      let uncroppedPath = '';
      for (const aExt of audioExts) {
        const candidate = path.join(dir, `${base}_uncropped${aExt}`);
        if (fs.existsSync(candidate)) {
          uncroppedPath = candidate;
          break;
        }
      }

      if (!uncroppedPath) {
        return { success: false, error: 'No uncropped backup found for this sound' };
      }

      // Kill Soundpad so we can safely modify the file
      await this.killSoundpadAndWait();
      this.cachedConnectionState = false;
      this.lastConnectionCheck = 0;

      // Replace the cropped file with the uncropped backup
      const uncroppedExt = path.extname(uncroppedPath);
      if (ext === uncroppedExt) {
        // Same extension — just overwrite
        fs.copyFileSync(uncroppedPath, soundPath);
      } else {
        // Different extension — write new file, update SPL reference, remove old cropped file
        const newSoundPath = path.join(dir, `${base}${uncroppedExt}`);
        fs.copyFileSync(uncroppedPath, newSoundPath);

        // Update the URL in soundlist.spl
        if (fs.existsSync(this.soundlistPath)) {
          let spl = fs.readFileSync(this.soundlistPath, 'utf-8');
          const escapedOld = soundPath.replace(/\\/g, '\\\\').replace(/[.*+?^${}()|[\]]/g, '\\$&');
          spl = spl.replace(new RegExp(escapedOld, 'g'), newSoundPath);
          fs.writeFileSync(this.soundlistPath, spl, 'utf-8');
        }

        // Remove old cropped file (different extension)
        try { fs.unlinkSync(soundPath); } catch { /* ignore */ }
      }

      // Remove the uncropped backup since it's been restored
      try { fs.unlinkSync(uncroppedPath); } catch { /* ignore */ }

      console.log(`[resetCrop] Restored uncropped audio for: ${soundPath}`);

      // Relaunch Soundpad
      const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
      spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

      // Wait for Soundpad to respond
      const timeout = 15000;
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const connected = await this.isConnected();
        if (connected) break;
        await new Promise(r => setTimeout(r, 500));
      }

      return { success: true, data: 'Crop reset successfully' };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error('[resetCrop] Error:', errMsg);
      return { success: false, error: errMsg };
    }
  }
}

export default SoundpadClient;
