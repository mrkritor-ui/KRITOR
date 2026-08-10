// One entry per artwork. Fields:
//
//   title      text
//   year       number
//   price      number (AUD, no symbol/commas) — omit or leave 0 if not applicable
//   status     "available" | "sold" | "na"      (na = not for sale)
//   collection text, e.g. "Studio Series" — leave "" for standalone works
//   size       text, e.g. "60 × 90 cm"
//   image      path inside /images
//
// Collections group works together in the "All" view and can be filtered
// individually from the bar at the top. Leave collection: "" for one-off
// pieces — they'll appear in their own "Standalone" group.

const ARTWORKS = [
  {
    title: "Untitled",
    year: 2024,
    price: 1200,
    status: "available",
    collection: "Studio Series",
    size: "— × — cm",
    image: "images/work-01.png"
  },
  {
    title: "People",
    year: 2024,
    price: 850,
    status: "sold",
    collection: "Studio Series",
    size: "— × — cm",
    image: "images/work-02.png"
  },
  {
    title: "Untitled",
    year: 2023,
    price: 0,
    status: "na",
    collection: "Field Studies",
    size: "— × — cm",
    image: "images/work-03.png"
  },
  {
    title: "Untitled",
    year: 2023,
    price: 600,
    status: "available",
    collection: "Field Studies",
    size: "— × — cm",
    image: "images/work-04.png"
  },
  {
    title: "Untitled",
    year: 2025,
    price: 2400,
    status: "available",
    collection: "Studio Series",
    size: "— × — cm",
    image: "images/work-05.png"
  },
  {
    title: "Untitled",
    year: 2022,
    price: 950,
    status: "sold",
    collection: "",
    size: "— × — cm",
    image: "images/work-06.png"
  },
  {
    title: "Untitled",
    year: 2025,
    price: 400,
    status: "available",
    collection: "Field Studies",
    size: "— × — cm",
    image: "images/work-07.png"
  },
];
