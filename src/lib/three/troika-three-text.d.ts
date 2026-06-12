/**
 * Minimal ambient types for `troika-three-text` 0.52 (the package ships no
 * .d.ts). Covers only the surface HeroText.ts uses — `Text` is a three.js
 * Object3D subclass with text props + `sync()`, plus the `preloadFont` helper.
 */
declare module 'troika-three-text' {
  import type { Mesh, Material, Color } from 'three';

  export class Text extends Mesh {
    text: string;
    font: string | null;
    fontSize: number;
    lineHeight: number | 'normal';
    letterSpacing: number;
    textAlign: 'left' | 'right' | 'center' | 'justify';
    anchorX: number | 'left' | 'center' | 'right' | string;
    anchorY: number | 'top' | 'top-baseline' | 'middle' | 'bottom-baseline' | 'bottom' | string;
    material: Material;
    outlineWidth: number | string;
    outlineColor: number | string | Color;
    outlineOpacity: number;
    outlineBlur: number | string;
    strokeWidth: number | string;
    strokeColor: number | string | Color;
    strokeOpacity: number;
    sdfGlyphSize: number;
    /** populated after sync(); has blockBounds: [minX,minY,maxX,maxY] */
    textRenderInfo: { blockBounds: [number, number, number, number] } | null;
    sync(callback?: () => void): void;
    dispose(): void;
  }

  export function preloadFont(
    options: { font: string; characters?: string | string[]; sdfGlyphSize?: number },
    callback: () => void,
  ): void;
}
