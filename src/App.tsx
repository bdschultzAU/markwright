import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import dogbertImg from "../dogbert.jpg";
import "./App.css";

/** Turn JSON-style escaped newlines into real line breaks (paste-friendly). */
function unescapeNewlines(text: string): string {
  return text.replace(/\\n/g, "\n");
}

/**
 * Remove trailing commas before `}` or `]` (common in pasted "JSON") while
 * respecting string contents.
 */
function stripTrailingCommas(json: string): string {
  let out = "";
  let inString = false;
  let escape = false;
  for (let i = 0; i < json.length; i++) {
    const c = json[i];
    if (escape) {
      out += c;
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      out += c;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      out += c;
      continue;
    }
    if (!inString && c === ",") {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j])) j++;
      const next = json[j];
      if (next === "}" || next === "]") continue;
    }
    out += c;
  }
  return out;
}

function tryParseStrict(text: string): unknown | null {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** Parse JSON tolerating trailing commas and messy whitespace. */
function parseRelaxedJson(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const strict = tryParseStrict(trimmed);
  if (strict !== null) return strict;
  const relaxed = tryParseStrict(stripTrailingCommas(trimmed));
  return relaxed;
}

/** End index (exclusive) after the matching `}` or `]` for a root object/array. */
function findMatchingJsonEnd(s: string, openIdx: number): number {
  const open = s[openIdx];
  if (open !== "{" && open !== "[") return -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (c === "\\" && inString) {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Find the next `{` or `[` position where the balanced slice parses as relaxed JSON.
 * Skips braces that do not form valid JSON (e.g. `{` in prose).
 */
function findNextJsonSegment(s: string, from: number): { start: number; end: number } | null {
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c !== "{" && c !== "[") continue;
    const end = findMatchingJsonEnd(s, i);
    if (end < 0) continue;
    const slice = s.slice(i, end);
    if (parseRelaxedJson(slice) !== null) return { start: i, end };
  }
  return null;
}

/** Pretty-print every JSON object/array in the buffer; preserve text between them. */
function tryPrettyPrintAllJsonSegments(text: string): string | null {
  let pos = 0;
  const chunks: string[] = [];
  let foundJson = false;
  while (pos < text.length) {
    const hit = findNextJsonSegment(text, pos);
    if (!hit) {
      chunks.push(text.slice(pos));
      break;
    }
    foundJson = true;
    if (hit.start > pos) chunks.push(text.slice(pos, hit.start));
    const slice = text.slice(hit.start, hit.end);
    const parsed = parseRelaxedJson(slice);
    if (parsed === null) return null;
    try {
      chunks.push(JSON.stringify(parsed, null, 2));
    } catch {
      return null;
    }
    pos = hit.end;
  }
  return foundJson ? chunks.join("") : null;
}

/** Tab / Shift+Tab in the editor: indent or outdent; returns new text and selection. */
function applyEditorTab(
  value: string,
  start: number,
  end: number,
  shift: boolean
): { next: string; selStart: number; selEnd: number } {
  if (shift) {
    const line0 = value.lastIndexOf("\n", start - 1) + 1;
    let line1 = value.indexOf("\n", end);
    if (line1 === -1) line1 = value.length;
    const block = value.slice(line0, line1);
    const lines = block.split("\n");
    const out = lines
      .map((ln) =>
        ln.startsWith("\t")
          ? ln.slice(1)
          : ln.startsWith("  ")
            ? ln.slice(2)
            : ln.startsWith(" ")
              ? ln.slice(1)
              : ln
      )
      .join("\n");
    const next = value.slice(0, line0) + out + value.slice(line1);
    const delta = out.length - block.length;
    return {
      next,
      selStart: Math.max(line0, start + delta),
      selEnd: Math.max(line0, end + delta),
    };
  }

  const selected = value.slice(start, end);
  if (!selected.includes("\n")) {
    const next = value.slice(0, start) + "\t" + value.slice(end);
    const p = start + 1;
    return { next, selStart: p, selEnd: p };
  }

  const line0 = value.lastIndexOf("\n", start - 1) + 1;
  let line1 = value.indexOf("\n", end);
  if (line1 === -1) line1 = value.length;
  const block = value.slice(line0, line1);
  const lines = block.split("\n");
  const indented = lines.map((ln) => "\t" + ln).join("\n");
  const next = value.slice(0, line0) + indented + value.slice(line1);
  const n = lines.length;
  return {
    next,
    selStart: start + 1,
    selEnd: end + n,
  };
}

/** Pretty-print if the buffer can be parsed as JSON; otherwise null. */
function tryBeautifyJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const multi = tryPrettyPrintAllJsonSegments(text);
  if (multi !== null) return multi;
  const parsed = parseRelaxedJson(text);
  if (parsed === null) return null;
  try {
    return JSON.stringify(parsed, null, 2);
  } catch {
    return null;
  }
}

/** Keys we treat as Markdown when the editor holds JSON. Order matters. */
const MARKDOWN_JSON_KEYS = [
  "markdown",
  "body",
  "content",
  "md",
  "text",
] as const;

type PreviewPart =
  | { type: "json"; pretty: string }
  | { type: "markdown"; text: string };

type PreviewModel = { parts: PreviewPart[] };

/** When the whole buffer is not one JSON value, alternate Markdown and JSON segments. */
function buildInterleavedSegments(raw: string, unescapeLiteral: boolean): PreviewPart[] {
  const unesc = (t: string) => (unescapeLiteral ? unescapeNewlines(t) : t);
  const parts: PreviewPart[] = [];
  let pos = 0;
  while (pos < raw.length) {
    const hit = findNextJsonSegment(raw, pos);
    if (!hit) {
      const md = raw.slice(pos);
      if (md) parts.push({ type: "markdown", text: unesc(md) });
      break;
    }
    if (hit.start > pos) {
      const md = raw.slice(pos, hit.start);
      if (md) parts.push({ type: "markdown", text: unesc(md) });
    }
    const slice = raw.slice(hit.start, hit.end);
    const parsed = parseRelaxedJson(slice)!;
    parts.push({ type: "json", pretty: JSON.stringify(parsed, null, 2) });
    pos = hit.end;
  }
  return parts;
}

/**
 * If the whole buffer is one JSON value, unwrap markdown fields or show JSON.
 * Otherwise interleave pretty-printed JSON blocks with Markdown (anywhere in the doc).
 */
function previewModelFromRaw(raw: string, unescapeLiteral: boolean): PreviewModel {
  const trimmed = raw.trim();
  if (!trimmed) return { parts: [] };

  const parsed = parseRelaxedJson(trimmed);
  if (parsed !== null) {
    if (typeof parsed === "string") {
      return {
        parts: [{ type: "markdown", text: unescapeLiteral ? unescapeNewlines(parsed) : parsed }],
      };
    }
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const o = parsed as Record<string, unknown>;
      for (const key of MARKDOWN_JSON_KEYS) {
        const v = o[key];
        if (typeof v === "string") {
          return {
            parts: [{ type: "markdown", text: unescapeLiteral ? unescapeNewlines(v) : v }],
          };
        }
      }
    }
    return { parts: [{ type: "json", pretty: JSON.stringify(parsed, null, 2) }] };
  }

  return { parts: buildInterleavedSegments(raw, unescapeLiteral) };
}

const EDITOR_STORAGE_KEY = "markwright";

type StoredEditorState = { raw: string; unescapeLiteral: boolean };

function readStoredEditorState(): StoredEditorState | null {
  if (typeof window === "undefined") return null;
  try {
    const s = localStorage.getItem(EDITOR_STORAGE_KEY);
    if (s == null || s === "") return null;
    const parsed: unknown = JSON.parse(s);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "raw" in parsed &&
      typeof (parsed as { raw: unknown }).raw === "string"
    ) {
      const raw = (parsed as { raw: string }).raw;
      const u = (parsed as { unescapeLiteral?: unknown }).unescapeLiteral;
      return {
        raw,
        unescapeLiteral: typeof u === "boolean" ? u : true,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function getInitialState(): StoredEditorState {
  if (typeof window === "undefined") {
    return { raw: SAMPLE, unescapeLiteral: true };
  }
  try {
    const params = new URLSearchParams(window.location.search);
    const j = params.get("json");
    if (j != null && j !== "") {
      const decoded = decodeURIComponent(j);
      return {
        raw: tryBeautifyJson(decoded) ?? decoded,
        unescapeLiteral: true,
      };
    }
  } catch {
    // ignore malformed URI components
  }
  const stored = readStoredEditorState();
  if (stored) return stored;
  return { raw: SAMPLE, unescapeLiteral: true };
}

const THEME_STORAGE_KEY = "markwright-theme";

function getInitialTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "light";
  try {
    const t = localStorage.getItem(THEME_STORAGE_KEY);
    if (t === "dark" || t === "light") return t;
  } catch {
    /* ignore */
  }
  return "light";
}

const SAMPLE = `## Welcome

**Markwright** is a simple Markdown editor with a live preview.\\nThis paragraph is one long line in the editor until you expand paste-style newlines—use **Options** and the checkbox there (it targets a backslash plus "n", two characters).

Keep those pairs in **plain text** or list lines. If you tuck them inside **bold** or *italics*, the expander turns them into real line breaks *inside* the emphasis span and the preview looks wrong.

Tiny list on one editor line:\\n- Morning coffee\\n- A walk outside\\n- Something creative

---

## Tips

Use **Export PDF** when you want a printable copy.\\nSingle line breaks in the preview use *remark-breaks* (GitHub-style) so you do not need blank lines everywhere.`;

function IconSun() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"
      />
    </svg>
  );
}

function IconMoon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"
      />
    </svg>
  );
}

function JsonChevron() {
  return (
    <svg
      className="json-tree-chevron-svg"
      width="12"
      height="12"
      viewBox="0 0 12 12"
      aria-hidden
    >
      <path d="M3 2 L9 6 L3 10 Z" fill="currentColor" />
    </svg>
  );
}

function JsonExpandableObject({ entries }: { entries: [string, unknown][] }) {
  const [open, setOpen] = useState(true);
  const n = entries.length;
  return (
    <span className="json-tree-expandable">
      <span className="json-tree-expandable-head">
        <button
          type="button"
          className="json-tree-caret"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse object" : "Expand object"}
        >
          <JsonChevron />
        </button>
        {open ? (
          <span className="json-tree-punct">{"{"}</span>
        ) : (
          <span className="json-tree-folded">
            <span className="json-tree-punct">{"{"}</span>
            <span className="json-tree-folded-meta">
              {n} {n === 1 ? "key" : "keys"}
            </span>
            <span className="json-tree-punct">{"}"}</span>
          </span>
        )}
      </span>
      {open && (
        <>
          <ul className="json-tree-list">
            {entries.map(([k, v], i) => (
              <li key={k} className="json-tree-item">
                <div className="json-tree-prop">
                  <span className="json-tree-key">{JSON.stringify(k)}</span>
                  <span className="json-tree-colon">: </span>
                  <span className="json-tree-value-cell">
                    <JsonTreeValue value={v} />
                  </span>
                  {i < n - 1 && <span className="json-tree-punct json-tree-comma">,</span>}
                </div>
              </li>
            ))}
          </ul>
          <span className="json-tree-punct json-tree-close-bracket">{"}"}</span>
        </>
      )}
    </span>
  );
}

function JsonExpandableArray({ items }: { items: unknown[] }) {
  const [open, setOpen] = useState(true);
  const n = items.length;
  return (
    <span className="json-tree-expandable">
      <span className="json-tree-expandable-head">
        <button
          type="button"
          className="json-tree-caret"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse array" : "Expand array"}
        >
          <JsonChevron />
        </button>
        {open ? (
          <span className="json-tree-punct">{"["}</span>
        ) : (
          <span className="json-tree-folded">
            <span className="json-tree-punct">{"["}</span>
            <span className="json-tree-folded-meta">
              {n} {n === 1 ? "item" : "items"}
            </span>
            <span className="json-tree-punct">{"]"}</span>
          </span>
        )}
      </span>
      {open && (
        <>
          <ul className="json-tree-list json-tree-list--array">
            {items.map((item, i) => (
              <li key={i} className="json-tree-item">
                <div className="json-tree-prop">
                  <span className="json-tree-index">{i}</span>
                  <span className="json-tree-colon">: </span>
                  <span className="json-tree-value-cell">
                    <JsonTreeValue value={item} />
                  </span>
                  {i < n - 1 && <span className="json-tree-punct json-tree-comma">,</span>}
                </div>
              </li>
            ))}
          </ul>
          <span className="json-tree-punct json-tree-close-bracket">{"]"}</span>
        </>
      )}
    </span>
  );
}

function JsonTreeValue({ value }: { value: unknown }) {
  if (value === null) {
    return <span className="json-tree-null">null</span>;
  }
  const t = typeof value;
  if (t === "boolean") {
    return <span className="json-tree-bool">{value ? "true" : "false"}</span>;
  }
  if (t === "number") {
    return <span className="json-tree-number">{String(value)}</span>;
  }
  if (t === "string") {
    return <span className="json-tree-string">{JSON.stringify(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="json-tree-punct">[]</span>;
    }
    return <JsonExpandableArray items={value} />;
  }
  if (t === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      return <span className="json-tree-punct">{"{}"}</span>;
    }
    return <JsonExpandableObject entries={entries} />;
  }
  return <span className="json-tree-unknown">{String(value)}</span>;
}

function PreviewJsonBlock({ pretty }: { pretty: string }) {
  const [mode, setMode] = useState<"nested" | "pretty">("pretty");
  const parsed = useMemo(() => {
    try {
      return JSON.parse(pretty) as unknown;
    } catch {
      return null;
    }
  }, [pretty]);

  const toggle = () => setMode((m) => (m === "pretty" ? "nested" : "pretty"));

  return (
    <div className="preview-json-block">
      <div className="preview-json-surface">
        {parsed !== null && (
          <div className="preview-json-toolbar">
            <button
              type="button"
              className="preview-json-toggle"
              onClick={toggle}
              aria-pressed={mode === "nested"}
              title={mode === "pretty" ? "Show nested tree" : "Show pretty-printed JSON"}
            >
              {mode === "pretty" ? "Nested" : "Pretty"}
            </button>
          </div>
        )}
        {mode === "nested" && parsed !== null ? (
          <div className="preview-json-tree">
            <JsonTreeValue value={parsed} />
          </div>
        ) : (
          <pre className="preview-json preview-json-body">
            <code>{pretty}</code>
          </pre>
        )}
      </div>
    </div>
  );
}

/** Solid gear—reads clearly at 20px; thin stroke icons looked uneven in the header. */
function IconGear() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z" />
    </svg>
  );
}

export default function App() {
  const initial = getInitialState();
  const [raw, setRaw] = useState(initial.raw);
  const [unescapeLiteral, setUnescapeLiteral] = useState(initial.unescapeLiteral);
  const [theme, setTheme] = useState<"light" | "dark">(getInitialTheme);
  const [pdfExporting, setPdfExporting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const previewRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const editorSelectionPending = useRef<{ start: number; end: number } | null>(null);

  const handleEditorKeyDown = useCallback((e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const el = e.currentTarget;
    const { next, selStart, selEnd } = applyEditorTab(
      el.value,
      el.selectionStart,
      el.selectionEnd,
      e.shiftKey
    );
    editorSelectionPending.current = { start: selStart, end: selEnd };
    setRaw(next);
  }, []);

  useLayoutEffect(() => {
    const pending = editorSelectionPending.current;
    const ta = editorRef.current;
    if (!pending || !ta) return;
    ta.setSelectionRange(pending.start, pending.end);
    editorSelectionPending.current = null;
  }, [raw]);

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme === "dark" ? "dark" : "light";
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  useEffect(() => {
    try {
      const payload: StoredEditorState = { raw, unescapeLiteral };
      localStorage.setItem(EDITOR_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore */
    }
  }, [raw, unescapeLiteral]);

  const previewModel = useMemo(
    () => previewModelFromRaw(raw, unescapeLiteral),
    [raw, unescapeLiteral]
  );

  const applyUnescape = useCallback(() => {
    setRaw((t) => unescapeNewlines(t));
  }, []);

  const formatJson = useCallback(() => {
    setRaw((r) => tryBeautifyJson(r) ?? r);
  }, []);

  const exportPdf = useCallback(async () => {
    const el = previewRef.current;
    if (!el) return;
    setPdfExporting(true);
    el.setAttribute("data-pdf-export", "");
    await new Promise<void>((r) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => r());
      });
    });
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
      el.removeAttribute("data-pdf-export");
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
        <div className="topbar-brand">
          <h1 className="brand">Markwright</h1>
          <button
            type="button"
            className="about-button"
            onClick={() => setAboutOpen(true)}
          >
            About
          </button>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Open settings menu"
            aria-expanded={menuOpen}
            aria-controls="options-drawer"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <IconGear />
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
            <p className="modal-about">
              Markwright is built to render Markdown that still contains literal newline characters (
              <code>\n</code>)—common in pasted logs and tool output. That case is often handled poorly
              in popular online Markdown editors and previews.
            </p>
            <p className="modal-about">
              It also shows <strong>JSON and Markdown in the same view</strong>: JSON values are
              pretty-printed in the preview, and surrounding text renders as Markdown—including
              multiple JSON blocks in one document.
            </p>
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
          <button
            type="button"
            className="drawer-theme-option"
            aria-pressed={theme === "dark"}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            onClick={() => setTheme((t) => (t === "light" ? "dark" : "light"))}
          >
            {theme === "light" ? <IconMoon /> : <IconSun />}
            <span>{theme === "light" ? "Dark mode" : "Light mode"}</span>
          </button>
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
          <button type="button" className="drawer-button" onClick={formatJson}>
            Format JSON in editor
          </button>
          <p className="drawer-hint">
            Anywhere in the document, <code>{"{ … }"}</code> / <code>[ … ]</code> values that parse
            as JSON are shown formatted; other text is Markdown. JSON parsing allows{" "}
            <strong>trailing commas</strong> before <code>{"}"}</code> or <code>]</code>.{" "}
            <strong>Format JSON</strong> pretty-prints when the buffer can be parsed. Preview uses
            Markdown from a JSON string value, or from{" "}
            <code>markdown</code> / <code>body</code> / <code>content</code> / <code>md</code> /{" "}
            <code>text</code>. Optional URL: <code>?json=…</code>. Single line breaks in Markdown use{" "}
            <strong>remark-breaks</strong> (GitHub-style soft breaks).
          </p>
        </div>
      </aside>

      <div className="panes">
        <div className="pane">
          <div className="pane-header">Markdown</div>
          <textarea
            ref={editorRef}
            className="editor"
            spellCheck={false}
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            onKeyDown={handleEditorKeyDown}
            placeholder="Write markdown here…"
            aria-label="Markdown source"
          />
        </div>
        <div className="pane">
          <div className="pane-header">Preview</div>
          <div className="preview-wrap">
            <article ref={previewRef} className="preview">
              {previewModel.parts.map((part, idx) =>
                part.type === "json" ? (
                  <PreviewJsonBlock key={idx} pretty={part.pretty} />
                ) : (
                  <div key={idx} className="preview-md-segment">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                      {part.text}
                    </ReactMarkdown>
                  </div>
                )
              )}
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}
