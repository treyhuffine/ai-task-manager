# Ri identity assets

The supplied logo is preserved in `source-logo.png`. `public/brand/ri-mark.svg` is the authoritative vector master, traced from the source alpha silhouette using Potrace 2.1.8 (threshold 128, turd size 12, optimization tolerance 0.2). The viewBox uses the path's actual bounds, approximately 790.5 by 718 units. No raster is embedded in the SVG.

The mark keeps the original proportions and subtle corner shapes. The square canvas and its surrounding whitespace have been removed. The logo itself is fairly close to square, so the tight version has an aspect ratio of about 1.10, not an artificially stretched wordmark.

## Files

| Asset | Use |
| --- | --- |
| `public/brand/ri-mark.svg` | Tight master with `currentColor`, suitable for inline SVG or a CSS mask |
| `public/brand/ri-mark-black.svg`, `ri-mark-white.svg` | Tight marks for `<img>`/Next Image, which do not inherit the page's text color |
| `public/brand/ri-mark-black.png`, `ri-mark-white.png` | Transparent 1582px-wide exports |
| `public/brand/ri-app-icon.svg` and `.png` | 1024px square master, charcoal mark on warm white |
| `public/brand/ri-app-icon-dark.svg` and `.png` | Inverse square master |
| `public/brand/ri-desktop-icon.svg` and `.png` | Rounded tile with transparent outer margin for desktop use |
| `assets/brand/icons/icon.icns` | Multi-resolution macOS icon |
| `assets/brand/icons/icon.ico` | Windows icon with 16, 24, 32, 48, 64, 128 and 256px PNG frames |
| `assets/brand/icons/icon-*.png` | 16 through 1024px desktop exports, including Linux sizes |
| `assets/brand/icons/tray-template.svg`, `trayTemplate.png`, `trayTemplate@2x.png` | Monochrome macOS tray template. Set the shell's template-icon option |
| `src/app/favicon.ico`, `src/app/icon.svg`, `src/app/apple-icon.png` | Integrated Next.js file-based metadata icons |
| `assets/brand/preview.svg` and `.png` | Review sheet showing marks, icons, and an illustrative onboarding placement |

Colors: charcoal `#181a18`, warm white `#f5f2ea`. Transparent marks also include pure black and white for flexible use.

## Usage

Use the tight mark on onboarding, an About dialog, or a startup screen. Keep ordinary task and chat views focused on content. Use the square or desktop tile for launchers and installers. Avoid displaying a padded app icon where a tight mark belongs.

Give a standalone logo an accessible name. The onboarding image is decorative (`alt=""`) because the adjacent text already names Ri. Do not set both width and height to the same number on a tight mark. Preserve its aspect ratio.

For Tauri, the square SVG can feed `pnpm tauri icon public/brand/ri-app-icon.svg` once Tauri is installed. Review the resulting macOS silhouette and use the provided desktop ICNS if appropriate. For Electron, point the platform packager at `assets/brand/icons/icon.icns` or `icon.ico`. These assets do not choose a shell framework.

## Regeneration

After the repo dependencies are installed:

```sh
pnpm exec node scripts/generate-brand-assets.mjs
```

The exporter uses the existing `sharp` dependency. It regenerates variants from the checked-in SVG, so retracing the raster is unnecessary. ICNS regeneration uses macOS `iconutil`. On other operating systems, the existing ICNS stays intact while the other formats regenerate.

The original raster is kept for provenance. Edit the vector master for future intentional shape changes, then regenerate derivatives. The preview is a design review sheet, not a screenshot of the running app.

## Verification

The traced and original silhouettes overlap by 99.775% (intersection over union at a 50% alpha threshold, measured on the original 1254px canvas). The review sheet was rendered and visually inspected. All exported PNGs, all ICO frames, and the PNG representations inside the ICNS were decoded successfully. The onboarding TSX passed a syntax check, and the onboarding component and asset exporter passed targeted ESLint checks. A full app build, browser integration test, and desktop packaging test were not run.
