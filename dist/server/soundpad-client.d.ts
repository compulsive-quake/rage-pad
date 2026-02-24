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
    categoryIndex: number;
}
export interface CategoryIcon {
    name: string;
    icon: string;
    isBase64: boolean;
}
export interface SoundpadResponse {
    success: boolean;
    data?: any;
    error?: string;
}
export declare class SoundpadClient {
    private pipeName;
    private soundlistPath;
    private cachedConnectionState;
    private lastConnectionCheck;
    private connectionCheckCacheMs;
    constructor();
    private sendCommand;
    getSoundList(): Promise<SoundpadResponse>;
    playSound(index: number, speakersOnly?: boolean, micOnly?: boolean): Promise<SoundpadResponse>;
    stopSound(): Promise<SoundpadResponse>;
    togglePause(): Promise<SoundpadResponse>;
    setVolume(volume: number): Promise<SoundpadResponse>;
    searchSounds(query: string): Promise<SoundpadResponse>;
    renameSound(index: number, newTitle: string): Promise<SoundpadResponse>;
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
    private killSoundpadAndWait;
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
    reorderSound(soundIndex: number, targetCategory: string, targetPosition: number): Promise<SoundpadResponse>;
    /**
     * Move a top-level category to a new position in soundlist.spl.
     * @param categoryName Name of the category to move
     * @param targetPosition 0-based index in the visible (non-hidden) category list
     */
    reorderCategory(categoryName: string, targetPosition: number): Promise<SoundpadResponse>;
    /**
     * Find all top-level <Category> elements in the given XML content, returning
     * their string positions alongside name and hidden flag.
     */
    private findTopLevelCategoryRanges;
    /**
     * Reorder a named category within the Categories XML string.
     * Only non-hidden, named top-level categories participate in the ordering.
     */
    private reorderCategoryInContent;
    /**
     * Insert a <Sound id="N"/> reference into a specific category at a given position
     * within the Categories XML content.
     */
    private insertSoundInCategory;
    restartSoundpad(index: number, newTitle: string): Promise<SoundpadResponse>;
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
    private updateSoundCustomTag;
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
     */
    addSound(tempFilePath: string, originalName: string, categoryName: string, displayName?: string, artist?: string, title?: string, durationSeconds?: number): Promise<SoundpadResponse>;
    /**
     * Get the list of categories and sub-categories from soundlist.spl.
     * Returns a flat list of { name, parentCategory } objects.
     */
    getCategoriesList(): {
        name: string;
        parentCategory: string;
    }[];
    /**
     * Recursively collect category names from the <Categories> XML section.
     */
    private collectCategories;
    restartSoundpadOnly(): Promise<SoundpadResponse>;
    /**
     * Launch Soundpad if it is not already running.
     * Does NOT kill an existing instance first – this is a "start if not running" helper.
     * Returns success:true once Soundpad is detected on the named pipe (or was already running).
     */
    launchSoundpad(): Promise<SoundpadResponse>;
    /**
     * Poll the Soundpad named pipe until it responds, or until the timeout expires.
     * This is used after relaunching Soundpad to ensure it is fully ready before
     * the server returns a response to the client.
     *
     * @param timeoutMs  Maximum time to wait (default 15 000 ms)
     * @param intervalMs Polling interval (default 500 ms)
     */
    private waitForSoundpadReady;
    isConnected(): Promise<boolean>;
    private quickConnectionCheck;
    private parseSoundList;
    /**
     * Recursively parse categories and their nested sub-categories.
     * Returns true if any categories were found.
     */
    private parseCategoryRecursive;
    /**
     * Extract top-level <Category> elements from XML content (non-nested).
     */
    private extractTopLevelCategories;
    /**
     * Remove nested <Category> blocks from content, leaving only direct sounds.
     */
    private removeNestedCategories;
    /**
     * Parse <Sound> elements from content and add them to the sounds array.
     */
    private parseSoundsInContent;
    private extractCategoryFromUrl;
    private formatDuration;
    private extractAttribute;
    private decodeXmlEntities;
    getCategoryIcons(): Promise<SoundpadResponse>;
    private parseCategoryIcons;
    /**
     * Parse the <Categories> section of soundlist.spl to build a map of
     * sound index -> { category, parentCategory }.
     * The SPL file uses <Sound id="N"/> references (1-based index) inside
     * nested <Category> elements.
     */
    private parseCategoryHierarchy;
    /**
     * Recursively walk <Category> elements, assigning category/parentCategory/categoryIndex
     * to each <Sound id="N"/> found within.
     */
    private walkCategoryHierarchy;
}
export default SoundpadClient;
//# sourceMappingURL=soundpad-client.d.ts.map