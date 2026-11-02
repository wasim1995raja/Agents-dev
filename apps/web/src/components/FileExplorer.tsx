"use client";

import { useEffect, useMemo, useState } from "react";

import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";
import type { FileContent, GeneratedFile } from "@/lib/types";
import { EmptyState } from "./ui";

/**
 * File explorer. The index and file contents both come from the API, which
 * filters secret-bearing paths before they can ever reach the browser.
 */
export function FileExplorer({ projectId, refreshKey }: { projectId: string; refreshKey: number }) {
  const [files, setFiles] = useState<GeneratedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState<FileContent | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .listFiles(projectId)
      .then(({ items }) => {
        if (cancelled) return;
        setFiles(items);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setFiles([]);
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshKey]);

  useEffect(() => {
    if (!selected || files === null) return;
    if (!files.some((file) => file.path === selected)) setSelected(null);
  }, [files, selected]);

  const visible = useMemo(() => {
    if (!files) return [];
    const needle = query.trim().toLowerCase();
    return files.filter((file) => (needle ? file.path.toLowerCase().includes(needle) : true));
  }, [files, query]);

  async function open(path: string) {
    setSelected(path);
    setLoading(true);
    setContent(null);
    try {
      const file = await api.readFile(projectId, path);
      setContent(file);
    } catch (cause) {
      setContent({
        path,
        sizeBytes: 0,
        content: `Unable to read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
      });
    } finally {
      setLoading(false);
    }
  }

  if (files === null) {
    return <div className="skeleton" style={{ height: 380 }} />;
  }

  if (error) {
    return (
      <div className="alert alert-error" role="alert">
        {error}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <EmptyState title="No files generated yet">
        Files appear here as soon as the implementation phase writes them. Secret files
        and <code className="mono">node_modules</code> are excluded by the API.
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="panel-toolbar">
        <span className="panel-sub">
          {files.length} indexed file{files.length === 1 ? "" : "s"}
        </span>
        <input
          className="input"
          placeholder="Filter file paths…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          aria-label="Filter files"
        />
      </div>

      <div className="file-browser">
        <div className="file-list" role="listbox" aria-label="Generated files">
          {visible.length === 0 ? (
            <p className="panel-sub" style={{ padding: 10 }}>
              No file matches “{query}”.
            </p>
          ) : (
            visible.map((file) => {
              const slash = file.path.lastIndexOf("/");
              const dir = slash === -1 ? "" : file.path.slice(0, slash + 1);
              const base = slash === -1 ? file.path : file.path.slice(slash + 1);
              return (
                <button
                  type="button"
                  className="file-entry"
                  key={file.path}
                  data-active={selected === file.path}
                  onClick={() => void open(file.path)}
                >
                  <span className="file-dir">{dir}</span>
                  {base}
                </button>
              );
            })
          )}
        </div>

        <div className="file-viewer">
          <div className="file-viewer-head">
            <span>{selected ?? "Select a file"}</span>
            {content ? (
              <span>
                {formatBytes(content.sizeBytes)}
                {files.find((file) => file.path === selected)?.language
                  ? ` · ${files.find((file) => file.path === selected)?.language}`
                  : ""}
              </span>
            ) : null}
          </div>
          {!selected ? (
            <div className="code-empty">
              Choose a file from the index to inspect the generated source.
            </div>
          ) : loading ? (
            <div className="code-empty">
              <span className="spinner" aria-hidden="true" /> Loading {selected}
            </div>
          ) : content ? (
            <pre className="code">{content.content}</pre>
          ) : (
            <div className="code-empty">No content.</div>
          )}
        </div>
      </div>
    </div>
  );
}
