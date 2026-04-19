import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import dogbertImg from "../dogbert.jpg";
import "./App.css";

/** Turn JSON-style escaped newlines into real line breaks (paste-friendly). */
function unescapeNewlines(text: string): string {
  return text.replace(/\\n/g, "\n");
}

const SAMPLE = `## Analysis Summary

**Test Method:** basePlaywrightTestBeforeMethod (ID: 972591)  
**Execution:** SF Service Cloud Voice daily build 2017 in TEST environment  
**Failure Time:** 2026-04-14 05:55:10 - 05:55:13 UTC (3-second duration)

## Root Cause

The failure occurred during the **test setup phase** in the \`basePlaywrightTestBeforeMethod\`, specifically during user creation and DID pool operations.`;

export default function App() {
  const [raw, setRaw] = useState(SAMPLE);
  const [unescapeLiteral, setUnescapeLiteral] = useState(true);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const previewRef = useRef<HTMLElement>(null);

  const markdown = useMemo(
    () => (unescapeLiteral ? unescapeNewlines(raw) : raw),
    [raw, unescapeLiteral]
  );

  const applyUnescape = useCallback(() => {
    setRaw((t) => unescapeNewlines(t));
  }, []);

  const exportPdf = useCallback(async () => {
    const el = previewRef.current;
    if (!el) return;
    setPdfExporting(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      await html2pdf()
        .set({
          margin: [12, 12, 14, 12],
          filename: `markwright-${stamp}.pdf`,
          image: { type: "jpeg", quality: 0.92 },
          html2canvas: { scale: 2, useCORS: true, logging: false },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["avoid-all", "css", "legacy"] },
        })
        .from(el)
        .save();
    } finally {
      setPdfExporting(false);
    }
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  useEffect(() => {
    if (!aboutOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAboutOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [aboutOpen]);

  return (
    <div className="app">
      <header className="topbar">
        <h1 className="brand">Markwright</h1>
        <div className="topbar-actions">
          <button
            type="button"
            className="about-button"
            onClick={() => setAboutOpen(true)}
          >
            About
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Open settings menu"
            aria-expanded={menuOpen}
            aria-controls="options-drawer"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <span className="hamburger" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          </button>
          <button
            type="button"
            className="export-button"
            onClick={exportPdf}
            disabled={pdfExporting}
          >
            {pdfExporting ? "Exporting…" : "Export PDF"}
          </button>
        </div>
      </header>

      {aboutOpen && (
        <>
          <button
            type="button"
            className="modal-backdrop"
            aria-label="Close about dialog"
            onClick={() => setAboutOpen(false)}
          />
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-heading"
          >
            <button
              type="button"
              className="modal-close"
              aria-label="Close about dialog"
              onClick={() => setAboutOpen(false)}
            >
              ×
            </button>
            <h2 id="about-heading" className="modal-title">
              About
            </h2>
            <p className="modal-tagline">Developed by B Schultz</p>
            <div className="modal-figure">
              <img src={dogbertImg} alt="Dogbert" className="modal-dogbert" />
            </div>
          </div>
        </>
      )}

      {menuOpen && (
        <button
          type="button"
          className="drawer-backdrop"
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <aside
        id="options-drawer"
        className={`drawer ${menuOpen ? "drawer--open" : ""}`}
        aria-hidden={!menuOpen}
      >
        <div className="drawer-header">
          <span className="drawer-title">Options</span>
          <button
            type="button"
            className="drawer-close"
            aria-label="Close settings"
            onClick={() => setMenuOpen(false)}
          >
            ×
          </button>
        </div>
        <div className="drawer-body">
          <label className="drawer-option">
            <input
              type="checkbox"
              checked={unescapeLiteral}
              onChange={(e) => setUnescapeLiteral(e.target.checked)}
            />
            <span>
              Treat <code>\n</code> as newline when rendering
            </span>
          </label>
          <button type="button" className="drawer-button" onClick={applyUnescape}>
            Replace <code>\n</code> in editor
          </button>
          <p className="drawer-hint">
            Single line breaks use <strong>remark-breaks</strong> (GitHub-style soft breaks).
          </p>
        </div>
      </aside>

      <div className="panes">
        <div className="pane">
          <div className="pane-header">Markdown</div>
          <textarea
            className="editor"
            spellCheck={false}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder="Write markdown here…"
            aria-label="Markdown source"
          />
        </div>
        <div className="pane">
          <div className="pane-header">Preview</div>
          <div className="preview-wrap">
            <article ref={previewRef} className="preview">
              <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                {markdown}
              </ReactMarkdown>
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}
