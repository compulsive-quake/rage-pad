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
  rawTitle?: string;     // raw title (distinct from computed title)
  hasUncropped?: boolean;
}

export interface Category {
  name: string;
  sounds: Sound[];
  image: string;
  subCategories: Category[];
}

export interface ConnectionStatus {
  connected: boolean;
  error?: string;
}

export interface CategoryIcon {
  name: string;
  icon: string;
  isBase64: boolean;
}

export interface AudioDevices {
  input: string[];
  output: string[];
}
