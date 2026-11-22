const EMOJI_TO_ISO: Record<string, FlagIso> = {
  '🇪🇬': 'EG',
  '🇮🇹': 'IT',
  '🇳🇱': 'NL',
  '🇬🇧': 'GB',
  '🇦🇺': 'AU',
  '🇫🇷': 'FR',
  '🇲🇨': 'MC',
  '🇳🇿': 'NZ',
  '🇦🇹': 'AT',
  '🇺🇸': 'US',
};

export type FlagIso = 'EG' | 'IT' | 'NL' | 'GB' | 'AU' | 'FR' | 'MC' | 'NZ' | 'AT' | 'US';

/**
 * Resolves a Unicode regional-indicator flag emoji or ISO-3166 alpha-2 code
 * into a normalized FlagIso identifier so Windows/Android/iOS all render identically.
 */
export function resolveFlagIso(flagOrIso: string): FlagIso | null {
  const trimmed = flagOrIso.trim();
  if (trimmed in EMOJI_TO_ISO) {
    return EMOJI_TO_ISO[trimmed];
  }
  const upper = trimmed.toUpperCase();
  if (
    upper === 'EG' ||
    upper === 'IT' ||
    upper === 'NL' ||
    upper === 'GB' ||
    upper === 'AU' ||
    upper === 'FR' ||
    upper === 'MC' ||
    upper === 'NZ' ||
    upper === 'AT' ||
    upper === 'US'
  ) {
    return upper;
  }
  return null;
}

function unionJackPrimitives(ox = 0, oy = 0, w = 24, h = 16): string {
  const cx = ox + w * 0.5;
  const cy = oy + h * 0.5;
  const diagWhite = Math.max(1.2, h * 0.2);
  const diagRed = Math.max(0.7, h * 0.11);
  const crossWhite = Math.max(1.6, h * 0.3);
  const crossRed = Math.max(1.0, h * 0.18);
  return `
    <rect x="${ox}" y="${oy}" width="${w}" height="${h}" fill="#012169"/>
    <line x1="${ox}" y1="${oy}" x2="${ox + w}" y2="${oy + h}" stroke="#FFFFFF" stroke-width="${diagWhite}"/>
    <line x1="${ox + w}" y1="${oy}" x2="${ox}" y2="${oy + h}" stroke="#FFFFFF" stroke-width="${diagWhite}"/>
    <line x1="${ox}" y1="${oy}" x2="${ox + w}" y2="${oy + h}" stroke="#C8102E" stroke-width="${diagRed}"/>
    <line x1="${ox + w}" y1="${oy}" x2="${ox}" y2="${oy + h}" stroke="#C8102E" stroke-width="${diagRed}"/>
    <rect x="${ox}" y="${cy - crossWhite * 0.5}" width="${w}" height="${crossWhite}" fill="#FFFFFF"/>
    <rect x="${cx - crossWhite * 0.5}" y="${oy}" width="${crossWhite}" height="${h}" fill="#FFFFFF"/>
    <rect x="${ox}" y="${cy - crossRed * 0.5}" width="${w}" height="${crossRed}" fill="#C8102E"/>
    <rect x="${cx - crossRed * 0.5}" y="${oy}" width="${crossRed}" height="${h}" fill="#C8102E"/>
  `.trim();
}

/**
 * Renders a crisp cross-platform inline SVG flag icon so country flags display cleanly
 * on Windows Chrome/Edge (which do not ship color Unicode flag glyphs) as well as macOS/iOS/Android.
 */
export function renderFlagSvg(flagOrIso: string): string {
  const iso = resolveFlagIso(flagOrIso);
  if (!iso) return flagOrIso;

  let body = '';
  switch (iso) {
    case 'EG':
      body = `
        <rect width="24" height="5.34" y="0" fill="#CE1126"/>
        <rect width="24" height="5.34" y="5.33" fill="#FFFFFF"/>
        <rect width="24" height="5.34" y="10.66" fill="#111111"/>
        <path d="M12 6.0 L13.1 7.2 L12.7 9.6 L11.3 9.6 L10.9 7.2 Z" fill="#C09300"/>
        <circle cx="12" cy="7.4" r="0.95" fill="#C09300"/>
      `;
      break;
    case 'IT':
      body = `
        <rect width="8" height="16" x="0" fill="#009246"/>
        <rect width="8" height="16" x="8" fill="#FFFFFF"/>
        <rect width="8" height="16" x="16" fill="#CE2B37"/>
      `;
      break;
    case 'NL':
      body = `
        <rect width="24" height="5.34" y="0" fill="#AE1C28"/>
        <rect width="24" height="5.34" y="5.33" fill="#FFFFFF"/>
        <rect width="24" height="5.34" y="10.66" fill="#21468B"/>
      `;
      break;
    case 'GB':
      body = unionJackPrimitives(0, 0, 24, 16);
      break;
    case 'AU':
      body = `
        <rect width="24" height="16" fill="#00008B"/>
        ${unionJackPrimitives(0, 0, 12, 8)}
        <circle cx="6" cy="12" r="1.45" fill="#FFFFFF"/>
        <circle cx="18" cy="3.6" r="0.85" fill="#FFFFFF"/>
        <circle cx="15.2" cy="7.2" r="0.85" fill="#FFFFFF"/>
        <circle cx="20.6" cy="6.6" r="0.85" fill="#FFFFFF"/>
        <circle cx="18" cy="12.6" r="0.95" fill="#FFFFFF"/>
        <circle cx="19.8" cy="9.4" r="0.6" fill="#FFFFFF"/>
      `;
      break;
    case 'FR':
      body = `
        <rect width="8" height="16" x="0" fill="#002395"/>
        <rect width="8" height="16" x="8" fill="#FFFFFF"/>
        <rect width="8" height="16" x="16" fill="#ED2939"/>
      `;
      break;
    case 'MC':
      body = `
        <rect width="24" height="8" y="0" fill="#CE1126"/>
        <rect width="24" height="8" y="8" fill="#FFFFFF"/>
      `;
      break;
    case 'NZ':
      body = `
        <rect width="24" height="16" fill="#00247D"/>
        ${unionJackPrimitives(0, 0, 12, 8)}
        <circle cx="18" cy="3.8" r="1.05" fill="#FFFFFF"/><circle cx="18" cy="3.8" r="0.68" fill="#CC142B"/>
        <circle cx="15.4" cy="7.4" r="1.0" fill="#FFFFFF"/><circle cx="15.4" cy="7.4" r="0.64" fill="#CC142B"/>
        <circle cx="20.8" cy="6.8" r="0.95" fill="#FFFFFF"/><circle cx="20.8" cy="6.8" r="0.6" fill="#CC142B"/>
        <circle cx="18" cy="12.4" r="1.15" fill="#FFFFFF"/><circle cx="18" cy="12.4" r="0.75" fill="#CC142B"/>
      `;
      break;
    case 'AT':
      body = `
        <rect width="24" height="5.34" y="0" fill="#ED2939"/>
        <rect width="24" height="5.34" y="5.33" fill="#FFFFFF"/>
        <rect width="24" height="5.34" y="10.66" fill="#ED2939"/>
      `;
      break;
    case 'US':
      body = `
        <rect width="24" height="16" fill="#FFFFFF"/>
        <rect width="24" height="1.23" y="0" fill="#B22234"/>
        <rect width="24" height="1.23" y="2.46" fill="#B22234"/>
        <rect width="24" height="1.23" y="4.92" fill="#B22234"/>
        <rect width="24" height="1.23" y="7.38" fill="#B22234"/>
        <rect width="24" height="1.23" y="9.84" fill="#B22234"/>
        <rect width="24" height="1.23" y="12.30" fill="#B22234"/>
        <rect width="24" height="1.23" y="14.77" fill="#B22234"/>
        <rect width="10.5" height="8.62" fill="#3C3B6E"/>
        <circle cx="2.3" cy="2.1" r="0.55" fill="#FFFFFF"/><circle cx="5.2" cy="2.1" r="0.55" fill="#FFFFFF"/><circle cx="8.1" cy="2.1" r="0.55" fill="#FFFFFF"/>
        <circle cx="3.7" cy="4.3" r="0.55" fill="#FFFFFF"/><circle cx="6.7" cy="4.3" r="0.55" fill="#FFFFFF"/>
        <circle cx="2.3" cy="6.5" r="0.55" fill="#FFFFFF"/><circle cx="5.2" cy="6.5" r="0.55" fill="#FFFFFF"/><circle cx="8.1" cy="6.5" r="0.55" fill="#FFFFFF"/>
      `;
      break;
  }

  return `<svg class="country-flag-icon" data-flag="${iso}" viewBox="0 0 24 16" role="img" aria-label="${iso} flag">${body.replace(/\s+/g, ' ').trim()}</svg>`;
}

/**
 * Draws a crisp 2D canvas country flag (using fillRect/strokeRect/arc only so headless mock canvases stay clean).
 */
export function drawFlagOnCanvas(
  ctx: CanvasRenderingContext2D,
  flagOrIso: string,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const iso = resolveFlagIso(flagOrIso);
  if (!iso) return;

  const drawUnionCanton = (cx: number, cy: number, cw: number, ch: number) => {
    ctx.fillStyle = '#012169';
    ctx.fillRect(cx, cy, cw, ch);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(cx, cy + ch * 0.36, cw, ch * 0.28);
    ctx.fillRect(cx + cw * 0.38, cy, cw * 0.24, ch);
    ctx.fillStyle = '#C8102E';
    ctx.fillRect(cx, cy + ch * 0.42, cw, ch * 0.16);
    ctx.fillRect(cx + cw * 0.43, cy, cw * 0.14, ch);
  };

  switch (iso) {
    case 'EG':
      ctx.fillStyle = '#CE1126';
      ctx.fillRect(x, y, w, h / 3);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y + h / 3, w, h / 3);
      ctx.fillStyle = '#111111';
      ctx.fillRect(x, y + (h * 2) / 3, w, h / 3);
      ctx.fillStyle = '#C09300';
      ctx.fillRect(x + w * 0.44, y + h * 0.39, w * 0.12, h * 0.22);
      break;
    case 'IT':
      ctx.fillStyle = '#009246';
      ctx.fillRect(x, y, w / 3, h);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x + w / 3, y, w / 3, h);
      ctx.fillStyle = '#CE2B37';
      ctx.fillRect(x + (w * 2) / 3, y, w / 3, h);
      break;
    case 'NL':
      ctx.fillStyle = '#AE1C28';
      ctx.fillRect(x, y, w, h / 3);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y + h / 3, w, h / 3);
      ctx.fillStyle = '#21468B';
      ctx.fillRect(x, y + (h * 2) / 3, w, h / 3);
      break;
    case 'GB':
      drawUnionCanton(x, y, w, h);
      break;
    case 'AU':
      ctx.fillStyle = '#00008B';
      ctx.fillRect(x, y, w, h);
      drawUnionCanton(x, y, w * 0.5, h * 0.5);
      ctx.fillStyle = '#FFFFFF';
      for (const [sx, sy, r] of [
        [0.25, 0.75, 0.08],
        [0.75, 0.24, 0.055],
        [0.64, 0.46, 0.055],
        [0.86, 0.42, 0.055],
        [0.75, 0.78, 0.06],
      ]) {
        ctx.beginPath();
        ctx.arc(x + w * sx, y + h * sy, h * r, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'FR':
      ctx.fillStyle = '#002395';
      ctx.fillRect(x, y, w / 3, h);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x + w / 3, y, w / 3, h);
      ctx.fillStyle = '#ED2939';
      ctx.fillRect(x + (w * 2) / 3, y, w / 3, h);
      break;
    case 'MC':
      ctx.fillStyle = '#CE1126';
      ctx.fillRect(x, y, w, h * 0.5);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y + h * 0.5, w, h * 0.5);
      break;
    case 'NZ':
      ctx.fillStyle = '#00247D';
      ctx.fillRect(x, y, w, h);
      drawUnionCanton(x, y, w * 0.5, h * 0.5);
      ctx.fillStyle = '#CC142B';
      for (const [sx, sy] of [
        [0.75, 0.24],
        [0.64, 0.46],
        [0.86, 0.42],
        [0.75, 0.78],
      ]) {
        ctx.beginPath();
        ctx.arc(x + w * sx, y + h * sy, h * 0.065, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    case 'AT':
      ctx.fillStyle = '#ED2939';
      ctx.fillRect(x, y, w, h / 3);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y + h / 3, w, h / 3);
      ctx.fillStyle = '#ED2939';
      ctx.fillRect(x, y + (h * 2) / 3, w, h / 3);
      break;
    case 'US':
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#B22234';
      for (let i = 0; i < 7; i++) {
        ctx.fillRect(x, y + i * (h / 6.5), w, h / 13);
      }
      ctx.fillStyle = '#3C3B6E';
      ctx.fillRect(x, y, w * 0.44, h * 0.54);
      break;
  }

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
}
