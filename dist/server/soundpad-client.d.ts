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
    categoryImage: string;
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
    setPlayMode(mode: number): Promise<SoundpadResponse>;
    setSpeakersOnly(enabled: boolean): Promise<SoundpadResponse>;
    searchSounds(query: string): Promise<SoundpadResponse>;
    restartSoundpad(): Promise<SoundpadResponse>;
    isConnected(): Promise<boolean>;
    private quickConnectionCheck;
    private parseSoundList;
    private extractCategoryFromUrl;
    private formatDuration;
    private extractAttribute;
    private decodeXmlEntities;
    getCategoryIcons(): Promise<SoundpadResponse>;
    private parseCategoryIcons;
}
export default SoundpadClient;
//# sourceMappingURL=soundpad-client.d.ts.map