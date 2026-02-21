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
    restartSoundpadOnly(): Promise<SoundpadResponse>;
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