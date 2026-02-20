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

export interface Category {
  name: string;
  sounds: Sound[];
  image: string;
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
