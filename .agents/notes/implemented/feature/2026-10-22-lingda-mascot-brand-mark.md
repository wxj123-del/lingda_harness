# Agent Note: Lingda mascot replaces the fish brand mark

Status: implemented

English | [中文](2026-10-22-lingda-mascot-brand-mark.zh.md)

## Problem

Every client surface still carried DeepSeek's attribution: the sidebar and the New Session hero drew the whale silhouette from `FISH_LOGO_PATH`, the web and documentation favicons held the same glyph, and the desktop package shipped without a product icon, so Electron fell back to its default. This deployment ships as Lingda Harness (`apps/web`, `apps/desktop`), which left the product showing another vendor's mark in its own chrome.

## Decision

`dsh-client-ui-primitives` exports `LingdaMascot`, rendering the brand sheet's front view — head, both leaf ears, and the floating jade cube — as a WebP data URL. The artwork is cropped and cut from the supplied mascot sheet, un-blended against its pale page, and lifted slightly in clarity so the eyes stay readable at the 24px rail size. It replaces `FishLogo`, `BrandWordmark`, `FISH_LOGO_PATH`, and `FISH_LOGO_VIEWBOX`, which are deleted: no shipped surface wants a monochrome `currentColor` mark once the product mark is full-color artwork.

The mark enters the UI through the existing slots. `ui-sidebar` keeps `sidebar.brand.mark` with `LingdaMascot` as its fallback, and `ui-conversation` keeps `conversation.hero.brand.mark` with the same component at 34px, so a deployment can still replace either seat. The hero's SMIL path morph and the ink-matching sway are removed with the SVG; the hitbox now runs a CSS float — a lift and lean keyed on the chin — under the same `(hover: hover) and (prefers-reduced-motion: no-preference)` guard, because raster artwork cannot deform its own curves.

`apps/web/public/favicon.svg` and `website/public/favicon.svg` wrap the same artwork as a 64px `<image>`, so the favicon keeps one palette in both color schemes instead of inverting a black path. The documentation site's navigation lockup drops the inlined DeepSeek wordmark for the mascot plus a localized product name, and `website/public/wordmark.svg` is deleted with it. `apps/desktop/build/` carries `icon.icns`, `icon.ico`, and `icon.png` for electron-builder, and the manifest's install identity becomes Lingda Harness / 灵搭 with raster 192px and 512px install icons beside the SVG favicon.

## Alternatives considered

**Redraw the mascot as a hand-authored SVG.** The mark has to sit at 24px in the rail; traced and hand-drawn vector versions turned to mush at that size while the photographic gradients of the sheet's rendering survived downsampling better. A data URL also needs no asset pipeline, which Client plugin bundles do not have — a `.webp` import would have to be inlined by a package-local build plugin the way the PDF.js assets are.

**Keep the fish as a monochrome fallback and add the mascot only in the hero.** That leaves the sidebar — the surface users look at most — on DeepSeek's mark, and preserves two brand vocabularies in one product.

**Ship the mascot as a separate brand package occupying the slots.** `ui-brand-official` is deliberately retired and registers nothing; a new occupant package would add a composition axis for a single static mark and would still need the same artwork in `ui-conversation`'s hero fallback, since a feature plugin may not value-import across packages.

## Consequences

The mark carries its own palette and no longer follows `currentColor`, so theme changes do not tint it; this is recorded in the primitives README's known limits. The embed is roughly 17KB of base64 in the primitives bundle, which every client plugin that imports the barrel pays even when it renders no mark. The artwork derives from the published brand sheet, so re-cropping it needs the source illustration; the crop bounds and tone lift are not checked in as a script.

## Verification

- `packages/client/ui-primitives/tests/icons.client.spec.tsx` pins the data-URL prefix, square sizing, and decorative attributes.
- `packages/client/ui-conversation/tests/skeleton.client.spec.tsx` asserts the hero fallback renders the mascot at 34px through the slot.
- `packages/client/ui-sidebar/tests/sidebar-root.client.spec.tsx` asserts the sidebar fallback renders the 24px mascot.
- `apps/web/tests/pwa-manifest.e2e.ts` pins the Lingda manifest identity, the raster favicon, and both install icons.
- `apps/desktop/tests/macos-signature.spec.ts` pins each packaged platform's icon path and its presence.
- `apps/web/tests/startup-auto-selection.e2e.ts` asserts the hero mark animates on hover.

The snapshot serializer in `packages/test-support/client-runtime` folds an inline `<img>` payload to a fingerprint and leaves its `src` at the data-URL prefix, keeping the sidebar's DOM snapshots readable while still flipping when the artwork changes.
