import { Image, Platform } from "react-native";
import type { ImageSourcePropType } from "react-native";

const IOSKELEY_MONO_TERM_REGULAR = require("../assets/fonts/IoskeleyMono/IoskeleyMonoTerm-Regular.ttf") as ImageSourcePropType;
const ANDROID_TERMINAL_FONT_URI = "file:///android_res/raw/assets_fonts_ioskeleymono_ioskeleymonotermregular.ttf";

export const TERMINAL_FONT_FACE = "Ioskeley Mono Term";
export const TERMINAL_FONT_FAMILY = `"${TERMINAL_FONT_FACE}", "Ioskeley Mono", Menlo, "Cascadia Code", monospace`;
export const TERMINAL_FONT_SIZE = 12;
export const TERMINAL_LINE_HEIGHT = 1.25;
export const TERMINAL_HORIZONTAL_PADDING = 4;
export const TERMINAL_TOP_PADDING = 4;

export function resolveTerminalFontUri(): string | null {
  return Image.resolveAssetSource(IOSKELEY_MONO_TERM_REGULAR)?.uri ?? null;
}

export function resolveTerminalFontUris(): string[] {
  const assetUri = resolveTerminalFontUri();
  const fontUris = assetUri ? [assetUri] : [];

  if (Platform.OS === "android") {
    return [ANDROID_TERMINAL_FONT_URI, ...fontUris];
  }

  return fontUris;
}

export function terminalFontFaceCss(fontUris: string | string[] | null): string {
  const sourceUris = Array.isArray(fontUris) ? fontUris : fontUris ? [fontUris] : [];
  if (sourceUris.length === 0) {
    return "";
  }

  const fontSources = sourceUris.map((fontUri) => `url(${JSON.stringify(fontUri)}) format('truetype')`).join(", ");
  return `
    @font-face {
      font-family: '${TERMINAL_FONT_FACE}';
      src: ${fontSources};
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
  `;
}
