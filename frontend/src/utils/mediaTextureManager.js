import * as THREE from 'three';

const MAX_IMAGES = 10;

export default class MediaTextureManager {
  constructor() {
    this._imageCache = new Map();   // url -> HTMLImageElement
    this._textureCache = new Map(); // url -> THREE.Texture
    this._trackKey = '';
    this._staleTextures = [];

    // Current loaded assets
    this.artistImages = [];         // HTMLImageElement[]
    this.artistTextures = [];       // THREE.Texture[]
    this.albumArtImage = null;
    this.albumArtTexture = null;
    this.ytThumbImage = null;
    this.ytThumbTexture = null;
  }

  update(media) {
    if (!media) return;
    const key = `${media.artist}|||${media.title}`;
    if (key === this._trackKey) return;
    this._trackKey = key;

    // Dispose textures from two track changes ago
    this._staleTextures.forEach(t => t.dispose());
    this._staleTextures = [];

    // Mark current textures as stale (will be disposed next track change)
    this._staleTextures = [...this._textureCache.values()];
    this._textureCache.clear();
    this._imageCache.clear();

    this.artistImages = [];
    this.artistTextures = [];
    this.albumArtImage = null;
    this.albumArtTexture = null;
    this.ytThumbImage = null;
    this.ytThumbTexture = null;

    // Load artist images
    const urls = (media.artistImages || []).slice(0, MAX_IMAGES);
    urls.forEach(url => this._loadImage(url, (img, tex) => {
      this.artistImages.push(img);
      this.artistTextures.push(tex);
    }));

    // Load album art (base64 data URI — no CORS)
    if (media.albumArt) {
      this._loadImage(media.albumArt, (img, tex) => {
        this.albumArtImage = img;
        this.albumArtTexture = tex;
      });
    }

    // Load YouTube thumbnail (localhost — no CORS)
    if (media.youtubeThumbnailUrl) {
      this._loadImage(media.youtubeThumbnailUrl, (img, tex) => {
        this.ytThumbImage = img;
        this.ytThumbTexture = tex;
      });
    }
  }

  _loadImage(url, onLoad) {
    if (this._imageCache.has(url)) {
      const img = this._imageCache.get(url);
      const tex = this._textureCache.get(url);
      if (img && tex) onLoad(img, tex);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this._imageCache.set(url, img);
      const tex = new THREE.Texture(img);
      tex.needsUpdate = true;
      this._textureCache.set(url, tex);
      onLoad(img, tex);
    };
    img.onerror = () => {}; // silent skip
    img.src = url;
  }

  getImages() {
    return {
      artists: this.artistImages,
      albumArt: this.albumArtImage,
      ytThumb: this.ytThumbImage,
    };
  }

  getTextures() {
    return {
      artists: this.artistTextures,
      albumArt: this.albumArtTexture,
      ytThumb: this.ytThumbTexture,
    };
  }

  getAllTextures() {
    const all = [...this.artistTextures];
    if (this.albumArtTexture) all.push(this.albumArtTexture);
    if (this.ytThumbTexture) all.push(this.ytThumbTexture);
    return all;
  }

  getAllImages() {
    const all = [...this.artistImages];
    if (this.albumArtImage) all.push(this.albumArtImage);
    if (this.ytThumbImage) all.push(this.ytThumbImage);
    return all;
  }

  dispose() {
    this._textureCache.forEach(t => t.dispose());
    this._staleTextures.forEach(t => t.dispose());
    this._textureCache.clear();
    this._imageCache.clear();
    this._staleTextures = [];
  }
}
