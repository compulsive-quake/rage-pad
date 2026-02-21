import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';

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

  async restartSoundpad(index: number, newTitle: string): Promise<SoundpadResponse> {
    if (!fs.existsSync(this.soundlistPath)) {
      return { success: false, error: 'Soundlist file not found' };
    }

    // Step 1: Gracefully close Soundpad so it releases the soundlist file
    await new Promise<void>((resolve) => {
      // Send WM_CLOSE (graceful) first; wait up to 5 s for it to exit
      const gracefulKill = spawn('taskkill', ['/IM', 'Soundpad.exe'], { stdio: 'ignore' });

      gracefulKill.on('close', () => {
        // Give Soundpad a moment to fully exit and flush its files
        setTimeout(resolve, 2000);
      });

      gracefulKill.on('error', () => {
        // Process may not have been running – continue anyway
        setTimeout(resolve, 500);
      });
    });

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

  async restartSoundpadOnly(): Promise<SoundpadResponse> {
    // Gracefully close Soundpad, then relaunch it
    await new Promise<void>((resolve) => {
      const gracefulKill = spawn('taskkill', ['/IM', 'Soundpad.exe'], { stdio: 'ignore' });

      gracefulKill.on('close', () => {
        setTimeout(resolve, 2000);
      });

      gracefulKill.on('error', () => {
        setTimeout(resolve, 500);
      });
    });

    this.cachedConnectionState = false;
    this.lastConnectionCheck = 0;

    const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
    spawn(soundpadPath, [], { detached: true, stdio: 'ignore' }).unref();

    return { success: true, data: 'Soundpad restarting' };
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
      const soundRegex = /<Sound\s+([^>]*?)(?:\/>|>(?:[\s\S]*?)<\/Sound>)/gi;
      let match;

      while ((match = soundRegex.exec(xmlResponse)) !== null) {
        const attrs = match[1] || match[0];

        const indexMatch = /index="(\d+)"/i.exec(attrs);
        if (indexMatch) {
          const index = parseInt(indexMatch[1], 10);
          const url = this.extractAttribute(attrs, 'url') || '';

          // Try to get category from the 'category' attribute if present
          const categoryFromAttr = this.extractAttribute(attrs, 'category');

          const sound: Sound = {
            index,
            title: this.extractAttribute(attrs, 'tag') ||
                   this.extractAttribute(attrs, 'title') ||
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
            categoryIndex: 0
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
    const soundRegex = /<Sound\s+([^>]*?)(?:\/>|>(?:[\s\S]*?)<\/Sound>)/gi;
    let soundMatch;

    while ((soundMatch = soundRegex.exec(content)) !== null) {
      const attrs = soundMatch[1] || soundMatch[0];
      const indexMatch = /index="(\d+)"/i.exec(attrs);

      if (indexMatch) {
        const index = parseInt(indexMatch[1], 10);
        const url = this.extractAttribute(attrs, 'url') || '';

        const sound: Sound = {
          index,
          title: this.extractAttribute(attrs, 'tag') ||
                 this.extractAttribute(attrs, 'title') ||
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
          categoryIndex: 0
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
}

export default SoundpadClient;
