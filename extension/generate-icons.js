/**
 * Generate extension icons - SVG version
 *
 * To convert to PNG, use one of:
 * 1. Online: https://cloudconvert.com/svg-to-png
 * 2. ImageMagick: convert icon.svg -resize 128x128 icon-128.png
 * 3. Inkscape: inkscape icon.svg -w 128 -h 128 -o icon-128.png
 */

import fs from 'fs';

function generateSVG() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="128" height="128" rx="24" fill="url(#bgGradient)"/>

  <!-- Browser window -->
  <rect x="20" y="20" width="88" height="88" rx="8" fill="white" opacity="0.95"/>

  <!-- Title bar -->
  <rect x="20" y="20" width="88" height="18" rx="8" fill="#667eea" opacity="0.3"/>
  <rect x="20" y="29" width="88" height="9" fill="#667eea" opacity="0.3"/>

  <!-- Window control dots -->
  <circle cx="28" cy="29" r="3" fill="#ff5f57"/>
  <circle cx="36" cy="29" r="3" fill="#ffbd2e"/>
  <circle cx="44" cy="29" r="3" fill="#28ca42"/>

  <!-- Connection symbol (chain link) -->
  <g transform="translate(64, 70)" stroke="#667eea" stroke-width="5" stroke-linecap="round" fill="none">
    <!-- Left link -->
    <path d="M -12,-8 A 8,8 0 0,1 -12,8" />
    <!-- Right link -->
    <path d="M 12,-8 A 8,8 0 0,0 12,8" />
    <!-- Connecting lines -->
    <line x1="-7" y1="-4" x2="7" y2="-4"/>
    <line x1="-7" y1="4" x2="7" y2="4"/>
  </g>
</svg>`;
}

fs.writeFileSync('icon.svg', generateSVG());
console.log('Generated icon.svg - convert to PNG with ImageMagick or online tool');
