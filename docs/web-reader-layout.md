# Website reading workspace

Implemented design, 2026-10-25. Scope: the Drive website; Extension and Host behavior are unchanged.

## Layout contract

At 1024px and wider, use the entire viewport: a large video on the left and a 400px material pane on the right. The shared shadcn ResizablePanelGroup, ResizablePanel and ResizableHandle use react-resizable-panels v4. Dragging the handle or using its Left/Right keys adjusts the material width between 320 and 600px; Home/End use the library's constraint limits, and double-click restores the width at which this reader opened (400px initially). Keep at least 360px available for video. Width preference is saved locally after resizing and reset. The video keeps its aspect ratio within a dark player stage. Material scrolling must not move the player or the top navigation.

Below 1024px, place video above material and let material consume the remaining height. Collapse video for full-width reading without destroying or restarting the iframe. Below 560px viewport height in this stacked mode, start collapsed; expanding video switches focus to video rather than leaving a thin, obscured material strip. Video can still enter native fullscreen. No additional timing-editing controls are added.

The same panel tree remains mounted across horizontal/vertical layout changes. Stacked layout disables resizing and hides the handle. Returning to the desktop restores the remembered material width. The handle captures the pointer on press so an embedded player cannot swallow the first drag movement; sizing, limits, keyboard semantics and drag lifecycle remain owned by the shadcn primitive. Original custom pointer math and separator styles were removed. Component source follows https://ui.shadcn.com/docs/components/resizable and the official new-york-v4 registry.

The reading page has one compact toolbar with return, a truncated document title, existing favorite controls and the existing theme selector. The library retains its normal header and PWA installation entry. Custom Markdown headings remain content, with a smaller type scale; do not use the source's long video title as another giant heading. Standard lessons use the same ContextualSceneReader as the Extension.

The video stage and standard material card share their top edge. Video actions (YouTube link and collapse) sit together below the player instead of shifting it down with a separate heading. Desktop separator gutters are12px on each side; the video left edge and material card right edge align with the page toolbar. Standard material uses its internal scroll container, so the outer pane reserves no redundant scrollbar gutter. Small-screen fixed video height includes the single action row without unused extra height.

When video is collapsed, the material pane adds no horizontal padding: the full card's left/right edges match the page toolbar and Show video action. The reader's internal720px maximum text column remains for readable line lengths. The separate no-video layout retains its existing centered900px width and12px inner padding.

## Browser navigation

`navigation.ts` owns hash routes: `#/library`, `#/favorites`, `#/material/<kind:uuid>`, and `#/favorite/<identity-hash>`. Switching lists or opening a document pushes a page. Browser Back/Forward restore the previous route without adding another history entry. In-page return uses history when a prior app page exists, with a safe list fallback for directly opened links. Reload rehydrates the selected document from the account-isolated cache or current Drive connection. Missing/uncached links offer a connection or a return action.

History entries contain account ownership, numeric scroll positions and video-collapse preference, never tokens or full documents. Scroll restoration covers the page, custom material pane and standard lesson's inner content. Standard scene position remains in the existing per-account reader preferences. Disclosure and playback changes do not create extra navigation entries. Logout replaces the current route with the library; old links cannot expose content without an active account/cache. Late favorite downloads cannot navigate after the user leaves their initiating page.

## Acceptance

See `.audit/web-reader-layout/`. Unit tests cover URL round trips and malformed routes. Browser acceptance uses the real App/reader with synthetic Drive and deterministic YouTube responses at 320×844,480×900,900×1000,1024×768,1165×768,1600×900 and844×390, in both themes. It checks placement and actual player size, independent scrolling, pointer/keyboard resizing, iframe/playback preservation on collapse, native Back/Forward, reload, scroll restoration, collapse restoration, standard/custom favorites and overflow. The production offline script separately covers Service Worker reload, deep material links, OAuth reuse/expiry and cross-tab logout. These controlled tests do not establish real Google OAuth, real video streaming, a physical second device or an installed PWA.
