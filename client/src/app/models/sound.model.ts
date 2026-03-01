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
  categoryIndex: number; // position of this sound within its category (0-based)
  customTag?: string;    // display name
  hasUncropped?: boolean;
  icon?: string;
  iconIsBase64?: boolean;
  hideTitle?: boolean;
  nsfw?: boolean;
}

export interface Category {
  name: string;
  sounds: Sound[];
  image: string;
  subCategories: Category[];
  nsfw?: boolean;
  visibility?: 'private' | 'public';
}

export interface StoreCategory {
  id: number;
  name: string;
  icon: string;
  icon_is_base64: boolean;
  uploader_name: string;
  sound_count: number;
  uploaded_at: string;
  updated_at: string;
}

export interface StoreSound {
  id: number;
  title: string;
  file_name: string;
  artist: string;
  duration_ms: number;
  sort_order: number;
  icon: string;
  icon_is_base64: boolean;
  hide_title: boolean;
}

export interface StoreCategoryDetail {
  category: StoreCategory;
  sounds: StoreSound[];
}

export interface ConnectionStatus {
  connected: boolean;
  error?: string;
}

export interface CategoryIcon {
  name: string;
  icon: string;
  isBase64: boolean;
  nsfw: boolean;
  visibility?: 'private' | 'public';
}

export interface AudioDevices {
  input: string[];
  output: string[];
}
