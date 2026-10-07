/* The architecture room has no work to show yet, so it hands terminal.js an
   empty catalogue — every one of its readers goes through a typeof guard, so
   an absent manifest is just an empty room rather than an error.
   KRITOR_BOOT_PAGE is the one thing terminal.js needed taught to it: this
   page's boot asks for "architecture" instead of the default "catalogue". */
window.ARTWORKS = [];
window.KRITOR_BOOT_PAGE = "architecture";
