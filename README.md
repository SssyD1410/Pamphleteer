# Pamphleteer

*Two tongues · One page.*

Pamphleteer lays a book or article beside its translation. Upload the same work in two languages and it sets them in facing columns, chapter by chapter and paragraph by paragraph, as one long page to scroll.

**Live:** https://sssyd1410.github.io/Pamphleteer/

![Pamphleteer](assets/og-image.png)

## How it works

- **Nothing is uploaded.** Files are read in the browser. It's a static site with no server and no build step.
- **Formats:** PDF, EPUB, DOCX, HTML, FB2, Markdown, SRT and plain text. Each side can use a different format, and you can paste text instead.
- **Cheap on big books.** Parsers load only when a format needs them (pdf.js, JSZip, mammoth). Alignment is two cheap passes:
  1. Chapters are matched by their numbers (*Chapter IV* ↔ *Chapitre IV*). Tables of contents are skipped.
  2. Inside each chapter, paragraphs are paired by a banded Gale–Church style alignment on paragraph length, allowing 1–1, 1–2, 2–1, 2–2 and 1–3 groupings. Very long texts without chapters fall back to a single linear pass.
  The reader adds rows as you scroll, so a 1,000-page book doesn't render all at once.
- **Short texts can be translated** (up to 60,000 characters) when you only have one language:
  - *This browser:* Chrome's on-device Translator API. Free, and nothing leaves the machine.
  - *Claude:* uses your own Anthropic API key, called straight from the page. The key is never stored.
  - *MyMemory:* free public API with no key, limited to about 5,000 characters a day.
- **Save** downloads the finished parallel text as one self-contained HTML file.

## Try it

Click **"Alice's Adventures in Wonderland, English & French"** on the start page. It loads the public-domain Project Gutenberg texts ([#11](https://www.gutenberg.org/ebooks/11) and [#55456](https://www.gutenberg.org/ebooks/55456)) from `samples/`.

## Run locally

```bash
python -m http.server 8000
```

Then open http://localhost:8000. Any static file server works.

## Layout

```
index.html        page shell
css/style.css     black & white, EB Garamond
js/extract.js     file → paragraphs (per format)
js/align.js       chapter matching + paragraph alignment
js/translate.js   short-text translation engines
js/app.js         upload UI and the scrolling reader
assets/           favicons and social images
samples/          public-domain test texts
```

## License

MIT. The sample texts are in the public domain (Project Gutenberg).
