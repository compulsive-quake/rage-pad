"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SoundpadClient = void 0;
const net = __importStar(require("net"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const child_process_1 = require("child_process");
class SoundpadClient {
    constructor() {
        this.pipeName = '\\\\.\\pipe\\sp_remote_control';
        this.cachedConnectionState = null;
        this.lastConnectionCheck = 0;
        this.connectionCheckCacheMs = 2000; // Cache connection state for 2 seconds
        // Path to Soundpad's soundlist.spl file
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        this.soundlistPath = path.join(appData, 'Leppsoft', 'soundlist.spl');
    }
    async sendCommand(command) {
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
            client.on('data', (chunk) => {
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
            client.on('error', (err) => {
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
                    }
                    else {
                        markDisconnected(); // Timeout with no data means disconnected
                        reject(new Error('Connection timeout'));
                    }
                }
            }, 5000);
        });
    }
    async getSoundList() {
        try {
            const response = await this.sendCommand('GetSoundlist()');
            console.log('Soundpad GetSoundlist response:', response.substring(0, 500));
            const sounds = this.parseSoundList(response);
            return { success: true, data: sounds };
        }
        catch (error) {
            console.error('GetSoundlist error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get sound list'
            };
        }
    }
    async playSound(index, speakersOnly = false, micOnly = false) {
        try {
            // Soundpad uses DoPlaySound for playing by index
            // Second param: play on speakers, Third param: play on microphone
            const response = await this.sendCommand(`DoPlaySound(${index},${speakersOnly},${micOnly})`);
            console.log('Soundpad DoPlaySound response:', response);
            return { success: true, data: response };
        }
        catch (error) {
            console.error('PlaySound error:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to play sound'
            };
        }
    }
    async stopSound() {
        try {
            // Soundpad uses DoStopSound
            const response = await this.sendCommand('DoStopSound()');
            console.log('Soundpad DoStopSound response:', response);
            return { success: true, data: response };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to stop sound'
            };
        }
    }
    async togglePause() {
        try {
            // Soundpad uses DoTogglePause
            const response = await this.sendCommand('DoTogglePause()');
            console.log('Soundpad DoTogglePause response:', response);
            return { success: true, data: response };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to toggle pause'
            };
        }
    }
    async setVolume(volume) {
        try {
            // Volume should be between 0 and 100
            const clampedVolume = Math.max(0, Math.min(100, volume));
            const response = await this.sendCommand(`SetVolume(${clampedVolume})`);
            return { success: true, data: response };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to set volume'
            };
        }
    }
    async setPlayMode(mode) {
        try {
            const response = await this.sendCommand(`SetPlayMode(${mode})`);
            console.log('Soundpad SetPlayMode response:', response);
            return { success: true, data: response };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to set play mode'
            };
        }
    }
    async setSpeakersOnly(enabled) {
        try {
            // Soundpad uses DoPlaySelectedSoundOnSpeakers to toggle speakers-only mode
            // When enabled, sounds play only on speakers (not through microphone)
            const response = await this.sendCommand(`SetPlaySelectedSoundOnSpeakers(${enabled ? 1 : 0})`);
            console.log('Soundpad SetPlaySelectedSoundOnSpeakers response:', response);
            return { success: true, data: response };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to set speakers only mode'
            };
        }
    }
    async searchSounds(query) {
        try {
            const response = await this.sendCommand('GetSoundlist()');
            const sounds = this.parseSoundList(response);
            const filteredSounds = sounds.filter((sound) => sound.title.toLowerCase().includes(query.toLowerCase()) ||
                sound.artist.toLowerCase().includes(query.toLowerCase()));
            return { success: true, data: filteredSounds };
        }
        catch (error) {
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to search sounds'
            };
        }
    }
    async restartSoundpad() {
        return new Promise((resolve) => {
            // Kill Soundpad using taskkill (works regardless of pipe command support)
            const killer = (0, child_process_1.spawn)('taskkill', ['/F', '/IM', 'Soundpad.exe'], { stdio: 'ignore' });
            killer.on('close', (code) => {
                // code 0 = killed, code 128 = not found (already not running) — both are fine
                this.cachedConnectionState = false;
                this.lastConnectionCheck = 0;
                // Wait for process to fully exit, then relaunch
                setTimeout(() => {
                    const soundpadPath = 'C:\\Program Files\\Soundpad\\Soundpad.exe';
                    const proc = (0, child_process_1.spawn)(soundpadPath, [], { detached: true, stdio: 'ignore' });
                    proc.unref();
                    resolve({ success: true, data: 'Soundpad restarting' });
                }, 1500);
            });
            killer.on('error', (err) => {
                resolve({ success: false, error: `Failed to kill Soundpad: ${err.message}` });
            });
        });
    }
    async isConnected() {
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
        }
        catch (error) {
            this.cachedConnectionState = false;
            this.lastConnectionCheck = now;
            return false;
        }
    }
    quickConnectionCheck() {
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
    parseSoundList(xmlResponse) {
        const sounds = [];
        console.log('Parsing sound list, response length:', xmlResponse.length);
        console.log('XML Response sample:', xmlResponse.substring(0, 1000));
        // Soundpad returns XML with categories like:
        // <Soundlist>
        //   <Category index="1" name="CategoryName">
        //     <Sound index="1" url="..." title="..." ... />
        //   </Category>
        // </Soundlist>
        // First, try to parse with category structure
        const categoryRegex = /<Category\s+([^>]*?)>([\s\S]*?)<\/Category>/gi;
        let categoryMatch;
        let hasCategories = false;
        while ((categoryMatch = categoryRegex.exec(xmlResponse)) !== null) {
            hasCategories = true;
            const categoryAttrs = categoryMatch[1];
            const categoryContent = categoryMatch[2];
            const categoryName = this.extractAttribute(categoryAttrs, 'name') || 'Uncategorized';
            // Try multiple possible attribute names for the category icon
            const categoryImage = this.extractAttribute(categoryAttrs, 'image') ||
                this.extractAttribute(categoryAttrs, 'icon') ||
                this.extractAttribute(categoryAttrs, 'iconPath') ||
                this.extractAttribute(categoryAttrs, 'imagePath') ||
                '';
            console.log('Category found:', categoryName);
            console.log('Category attrs:', categoryAttrs);
            console.log('Category image:', categoryImage);
            // Parse sounds within this category
            const soundRegex = /<Sound\s+([^>]*?)(?:\/>|>(?:[\s\S]*?)<\/Sound>)/gi;
            let soundMatch;
            while ((soundMatch = soundRegex.exec(categoryContent)) !== null) {
                const attrs = soundMatch[1] || soundMatch[0];
                const indexMatch = /index="(\d+)"/i.exec(attrs);
                if (indexMatch) {
                    const index = parseInt(indexMatch[1], 10);
                    const url = this.extractAttribute(attrs, 'url') || '';
                    const sound = {
                        index,
                        title: this.extractAttribute(attrs, 'title') ||
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
                        categoryImage: categoryImage
                    };
                    sounds.push(sound);
                }
            }
        }
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
                    const sound = {
                        index,
                        title: this.extractAttribute(attrs, 'title') ||
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
                        categoryImage: ''
                    };
                    sounds.push(sound);
                }
            }
        }
        console.log('Parsed sounds count:', sounds.length);
        return sounds;
    }
    extractCategoryFromUrl(url) {
        if (!url)
            return 'Uncategorized';
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
    formatDuration(msString) {
        if (!msString)
            return '0:00';
        const ms = parseInt(msString, 10);
        if (isNaN(ms))
            return '0:00';
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
    extractAttribute(content, attrName) {
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
    decodeXmlEntities(str) {
        return str
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
            .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
    }
    async getCategoryIcons() {
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
        }
        catch (error) {
            console.error('Error reading category icons:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Failed to read category icons'
            };
        }
    }
    parseCategoryIcons(xmlContent) {
        const icons = [];
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
            if (!name)
                continue;
            // Check if icon is base64 encoded (starts with image data) or a stock icon name
            const isBase64 = !!(icon && !icon.startsWith('stock_'));
            icons.push({
                name,
                icon: icon || '',
                isBase64
            });
            console.log(`Category icon found: ${name}, isBase64: ${isBase64}, icon length: ${icon?.length || 0}`);
        }
        return icons;
    }
}
exports.SoundpadClient = SoundpadClient;
exports.default = SoundpadClient;
//# sourceMappingURL=soundpad-client.js.map