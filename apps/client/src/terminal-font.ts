import { Image } from "react-native";
import type { ImageSourcePropType } from "react-native";

const IOSKELEY_MONO_TERM_REGULAR = require("../assets/fonts/IoskeleyMono/IoskeleyMonoTerm-Regular.ttf") as ImageSourcePropType;

export const TERMINAL_FONT_FACE = "Ioskeley Mono Term";
export const TERMINAL_FONT_FAMILY = `"${TERMINAL_FONT_FACE}", "Ioskeley Mono", Menlo, "Cascadia Code", monospace`;
export const TERMINAL_TOP_PADDING = 4;

export function resolveTerminalFontUri(): string | null {
  return Image.resolveAssetSource(IOSKELEY_MONO_TERM_REGULAR)?.uri ?? null;
}

export function terminalFontFaceCss(fontUri: string | null): string {
  if (!fontUri) {
    return "";
  }

  return `
    @font-face {
      font-family: '${TERMINAL_FONT_FACE}';
      src: url(${JSON.stringify(fontUri)}) format('truetype');
      font-weight: 400;
      font-style: normal;
      font-display: block;
    }
  `;
}
