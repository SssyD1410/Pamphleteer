# Pamphleteer

*Many tongues · One page.*

Pamphleteer lays a book or article beside its translations. Upload the same work in two, three or four languages and it sets them in parallel columns, chapter by chapter and paragraph by paragraph, as one long page to scroll.

![Pamphleteer](assets/og-image.png)

## How it works

- **First visit:** a short guided tour of the start page, and another the first time the reader opens. Replay it with *New here? Take the tour* or the **?** button.
- **Mismatch warning:** after collaging, Pamphleteer checks that the texts really are the same work. It looks at how well paired paragraph lengths correspond, how long each text is, whether the chapters line up, and whether two columns are set to the same language. If something looks off, it says so in plain words above the text. In tests on *Alice* in English, French and German, matching translations misfit by 1–2%; a different book, shuffled paragraphs or half a book misfit by 16–38%. The warning appears above 8%.
- **× remove** next to an upload clears that side.
- **Nothing is uploaded.** Files are read in the browser. It's a static site with no server and no build step.
- **Formats:** PDF, EPUB, DOCX, HTML, FB2, Markdown, SRT and plain text. Each side can use a different format, and you can paste text instead.
- **Links:** *or add a link* fetches an article, a Wikipedia page or an online book. A web page can't read other sites unless they allow it, so a link is tried three ways:
  1. **Wikipedia, Wikisource** and other Wikimedia sites, through their open API. References, infoboxes and source lists are dropped, and the language comes from the address.
  2. **The site itself**, when it allows reading from other pages.
  3. Otherwise the free [r.jina.ai](https://jina.ai/reader) reader fetches it. That service sees the link, and allows about 20 links a minute.

  Web pages are cut down to the article with Mozilla's [Readability](https://github.com/mozilla/readability), the engine behind Firefox's Reader View. Links to PDF, EPUB, Word or text files go through the normal file readers. Pages behind a login or paywall can't be read; save them and upload the file instead.
- **Cheap on big books.** Parsers load only when a format needs them (pdf.js, JSZip, mammoth). Alignment is two cheap passes:
  1. Each text is aligned to the first one. Chapters are matched by their numbers (*Chapter IV* ↔ *Chapitre IV*). Tables of contents are skipped.
  2. Inside each chapter, paragraphs are paired by a banded Gale–Church style alignment on paragraph length, allowing 1–1, 1–2, 2–1, 2–2 and 1–3 groupings. Very long texts without chapters fall back to a single linear pass.
  Long works are split into pages, one per chapter, and long chapters are cut at about 30,000 characters per language. Use the page picker, the ‹ › buttons or the arrow keys; the browser's Back button works too. Each page also adds rows as you scroll.
- **Short texts can be translated** (up to 60,000 characters) when a side is left empty:
  - *Claude* (your Anthropic key): best quality. It translates as a literary translator, keeping tone, idiom and dialogue.
  - *Google Translate* (your Google Cloud key): the same engine as translate.google.com, through Google's official Cloud Translation API. The first 500,000 characters a month are free.
  - *This browser:* Chrome's on-device translator. Free and private, but rougher.
  - *MyMemory:* free with no key, but basic and limited to about 5,000 characters a day.
  Keys are sent only to Anthropic or Google. They stay in the tab unless you tick "Remember my keys on this device".
- **Hover over a sentence** to underline it and its counterpart in every other column. **On a phone:** tap once to underline a sentence and its translations; double-tap a word to double-underline it and open the dictionary. Sentences in the hovered row are paired by the same length-based aligner, and the underline uses the CSS Custom Highlight API, so the text isn't modified.
- **Hover over a word** to double-underline it and see a short gloss. **Click it** to open the dictionary panel, which shows the sentence, a translation into each other language on the page, and the full Wiktionary entry.
  - With a Claude key, the word is translated *in its sentence*: the sense used here, its dictionary form, and a note on tense, case or idiom.
  - With a Google key, Google Translate is used.
  - Without a key, the free engines translate the word on its own.
  - Definitions come from the English Wiktionary REST API (free, no key).
  - Words and sentences are found from the pointer position on demand, so the page never wraps each word of a book in its own element.
- **Reading aids** (the *Aids* button, shown when a column needs it) draw pronunciation above the text, word by word:
  - *Chinese:* pinyin with tones, through [pinyin-pro](https://github.com/zh-lx/pinyin-pro), which picks the right reading for characters that have several.
  - *Japanese:* furigana in hiragana over the kanji only, or romaji, from the [kuromoji](https://github.com/takuyaa/kuromoji.js) dictionary. It's an 18 MB download the first time.
  - *Korean* (Revised Romanization, with linking and nasal sound changes), *Russian* and *Ukrainian* (Latin letters), *Greek* (ELOT 743 with stress marks), *Arabic* and *Hebrew* (transliteration, using vowel marks when the text has them) and *Hindi* (IAST, with the silent final *a* dropped). These follow built-in rules, with no download.
  - Arabic and Hebrew columns are set right to left.
  - The hover gloss and the dictionary show the word's romanization. The dictionary's **▶ Listen** reads the word or the whole sentence aloud with your device's voices.
  - Aids are remembered between visits and appear in HTML and PDF exports.
- **Typefaces:** EB Garamond, Cormorant, Libre Baskerville, Crimson Pro, Old Standard, Noto Serif (with Chinese and Japanese) or the system serif. Your choice is remembered.
- **Columns** can be hidden, shown or rotated from the toolbar.
- **HTML** downloads the parallel text as one self-contained web page.
- **PDF** lays out the entire book, every page, and opens the print dialog; choose *Save as PDF*. Pages are A4, portrait for 2 columns and landscape for 3–4, with each chapter on a new page. The text stays selectable and searchable.

## Try it

On the start page, click **English & French** or **English, French & German**. These load public-domain *Alice's Adventures in Wonderland* texts from Project Gutenberg ([#11](https://www.gutenberg.org/ebooks/11), [#55456](https://www.gutenberg.org/ebooks/55456), [#19778](https://www.gutenberg.org/ebooks/19778)) out of `samples/`.

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
js/translate.js   short-text and single-word translation
js/dict.js        hover gloss + Wiktionary dictionary panel
js/sentences.js   hovered-sentence underline across columns
js/tour.js        first-visit guided tour
js/romanize.js    reading aids: pinyin, furigana/romaji, romanization rules
js/fetchurl.js    import from a link (Wikimedia API, direct, reader service + Readability)
js/app.js         upload UI and the scrolling reader
assets/           favicons and social images
samples/          public-domain test texts
```

## License

MIT. The sample texts are in the public domain (Project Gutenberg).
