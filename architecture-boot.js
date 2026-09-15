/* No artworks.js, no image-manifest.js, no terminal-manifest.js, no
   tile-image.js — there is nothing for any of them to describe yet.
   terminal.js reads every one of those through a typeof guard already
   (see its bitsEntry/realFor), so their absence is just an empty
   catalogue rather than an error. KRITOR_BOOT_PAGE is the one thing
   terminal.js needed taught to it, so this page's boot asks for
   "architecture" instead of the default "catalogue". */
window.ARTWORKS = [];
window.KRITOR_BOOT_PAGE = "architecture";
