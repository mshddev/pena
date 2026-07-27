import {
  parseDecisionDocument,
  type DocumentVersion,
  type DocumentVersionSummary,
  type PenaDocument,
} from "@pena/contracts";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import {
  fetchDocumentVersion,
  fetchDocumentVersions,
  restoreDocumentVersion,
  type DocumentResource,
} from "../../../api";
import { formatRelativeTime } from "../../../format";
import { MarkdownContent } from "../MarkdownContent";
import { markdownComponents } from "../markdown-components";
import { diffMarkdown } from "../version-diff";

interface VersionHistoryProps {
  currentDocument: PenaDocument;
  currentEtag: string;
  canRestore: boolean;
  onClose: () => void;
  onRestored: (resource: DocumentResource) => void;
  onError: (message: string) => void;
}

type HistoryMode = "browse" | "compare";

export function VersionHistory({
  currentDocument,
  currentEtag,
  canRestore,
  onClose,
  onRestored,
  onError,
}: VersionHistoryProps) {
  const [versions, setVersions] = useState<DocumentVersionSummary[]>([]);
  const [selectedVersion, setSelectedVersion] = useState(
    currentDocument.version,
  );
  const [beforeVersion, setBeforeVersion] = useState(
    Math.max(1, currentDocument.version - 1),
  );
  const [afterVersion, setAfterVersion] = useState(currentDocument.version);
  const [documents, setDocuments] = useState<Record<number, DocumentVersion>>(
    {},
  );
  const [mode, setMode] = useState<HistoryMode>("browse");
  const [isLoading, setIsLoading] = useState(true);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isConfirmingRestore, setIsConfirmingRestore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportError = useCallback(
    (message: string) => {
      setError(message);
      onError(message);
    },
    [onError],
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    void fetchDocumentVersions(currentDocument.workspaceSlug, currentDocument.slug)
      .then((response) => {
        if (!cancelled) {
          setVersions(response.versions);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          reportError(
            error instanceof Error
              ? error.message
              : "Could not load version history.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [currentDocument.slug, currentDocument.workspaceSlug, reportError]);

  useEffect(() => {
    const needed =
      mode === "compare"
        ? [beforeVersion, afterVersion]
        : [selectedVersion];

    for (const version of needed) {
      if (documents[version]) {
        continue;
      }

      if (version === currentDocument.version) {
        setDocuments((current) => ({
          ...current,
          [version]: {
            workspaceSlug: currentDocument.workspaceSlug,
            slug: currentDocument.slug,
            content: currentDocument.content,
            version: currentDocument.version,
            updatedAt: currentDocument.updatedAt,
          },
        }));
        continue;
      }

      void fetchDocumentVersion(
        currentDocument.workspaceSlug,
        currentDocument.slug,
        version,
      )
        .then((document) =>
          setDocuments((current) => ({ ...current, [version]: document })),
        )
        .catch((error) =>
          reportError(
            error instanceof Error
              ? error.message
              : `Could not load version ${version}.`,
          ),
        );
    }
  }, [
    afterVersion,
    beforeVersion,
    currentDocument,
    documents,
    mode,
    reportError,
    selectedVersion,
  ]);

  const selectedDocument = documents[selectedVersion];
  const beforeDocument = documents[beforeVersion];
  const afterDocument = documents[afterVersion];
  const diff = useMemo(
    () =>
      beforeDocument && afterDocument
        ? diffMarkdown(beforeDocument.content, afterDocument.content)
        : [],
    [afterDocument, beforeDocument],
  );

  async function handleRestore(): Promise<void> {
    setIsRestoring(true);

    try {
      const resource = await restoreDocumentVersion(
        currentDocument.workspaceSlug,
        currentDocument.slug,
        selectedVersion,
        currentEtag,
      );
      onRestored(resource);
    } catch (error) {
      reportError(
        error instanceof Error ? error.message : "Could not restore the version.",
      );
      setIsRestoring(false);
      setIsConfirmingRestore(false);
    }
  }

  return (
    <div className="version-workspace">
      <section className="version-history" aria-label="Version history">
        <header className="version-history-heading">
          <div>
            <p className="section-label">Document timeline</p>
            <h2>Version history</h2>
          </div>
          <button className="quiet-button" type="button" onClick={onClose}>
            Back to current
          </button>
        </header>

        {isLoading ? (
          <p className="version-history-state">Loading history…</p>
        ) : error ? (
          <p className="version-history-state error" role="alert">
            {error}
          </p>
        ) : (
          <div className="version-history-list">
            {versions.map((version) => (
              <button
                className={`version-history-row${
                  selectedVersion === version.version && mode === "browse"
                    ? " selected"
                    : ""
                }`}
                type="button"
                key={version.version}
                onClick={() => {
                  setSelectedVersion(version.version);
                  setMode("browse");
                  setIsConfirmingRestore(false);
                }}
              >
                <span>v{version.version}</span>
                <time dateTime={version.updatedAt}>
                  {formatRelativeTime(version.updatedAt)}
                </time>
                {version.version === currentDocument.version ? (
                  <strong>Current</strong>
                ) : null}
              </button>
            ))}
          </div>
        )}

        {versions.length > 1 ? (
          <button
            className={`compare-mode-button${mode === "compare" ? " active" : ""}`}
            type="button"
            onClick={() => setMode("compare")}
          >
            Compare versions
          </button>
        ) : null}
      </section>

      <section className="version-content">
        {mode === "compare" ? (
          <>
            <header className="version-content-heading compare-heading">
              <div>
                <p className="section-label">Markdown changes</p>
                <h2>
                  v{beforeVersion} → v{afterVersion}
                </h2>
              </div>
              <div className="version-selectors">
                <VersionSelect
                  label="From"
                  value={beforeVersion}
                  versions={versions}
                  onChange={setBeforeVersion}
                />
                <VersionSelect
                  label="To"
                  value={afterVersion}
                  versions={versions}
                  onChange={setAfterVersion}
                />
              </div>
            </header>

            {beforeDocument && afterDocument ? (
              <div className="version-diff" aria-label="Version comparison">
                {diff.map((line, index) => (
                  <div className={`diff-line ${line.kind}`} key={index}>
                    <span aria-hidden="true">
                      {line.kind === "added"
                        ? "+"
                        : line.kind === "removed"
                          ? "−"
                          : " "}
                    </span>
                    <code>{line.text || " "}</code>
                  </div>
                ))}
              </div>
            ) : (
              <p className="version-history-state">Loading comparison…</p>
            )}
          </>
        ) : (
          <>
            <header className="version-content-heading">
              <div>
                <p className="section-label">
                  {selectedVersion === currentDocument.version
                    ? "Current document"
                    : "Historical document"}
                </p>
                <h2>Version {selectedVersion}</h2>
              </div>

              {selectedVersion !== currentDocument.version ? (
                <button
                  className="restore-version-button"
                  type="button"
                  disabled={
                    currentDocument.archivedAt !== null ||
                    !canRestore ||
                    isRestoring
                  }
                  title={
                    currentDocument.archivedAt
                      ? "Unarchive the document before restoring a version."
                      : !canRestore
                        ? "Submit or remove draft feedback before restoring."
                        : undefined
                  }
                  onClick={() => setIsConfirmingRestore(true)}
                >
                  Restore this version
                </button>
              ) : null}
            </header>

            {isConfirmingRestore ? (
              <div className="restore-version-confirmation">
                <p>
                  Make v{selectedVersion} current? If its content differs,
                  Pena will create v{currentDocument.version + 1}. Earlier
                  feedback will remain on v{selectedVersion}.
                </p>
                <div>
                  <button
                    className="quiet-button"
                    type="button"
                    disabled={isRestoring}
                    onClick={() => setIsConfirmingRestore(false)}
                  >
                    Cancel
                  </button>
                  <button
                    className="confirm-restore-version-button"
                    type="button"
                    disabled={isRestoring}
                    onClick={() => void handleRestore()}
                  >
                    {isRestoring ? "Restoring" : "Create restored version"}
                  </button>
                </div>
              </div>
            ) : null}

            {selectedDocument ? (
              <ReadOnlyDocument content={selectedDocument.content} />
            ) : (
              <p className="version-history-state">Loading version…</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

interface VersionSelectProps {
  label: string;
  value: number;
  versions: DocumentVersionSummary[];
  onChange: (version: number) => void;
}

function VersionSelect({
  label,
  value,
  versions,
  onChange,
}: VersionSelectProps) {
  return (
    <label>
      <span>{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {[...versions].reverse().map((version) => (
          <option value={version.version} key={version.version}>
            v{version.version}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ReadOnlyDocument({ content }: { content: string }) {
  const parsed = useMemo(() => parseDecisionDocument(content), [content]);

  return (
    <article className="markdown-body readonly-document">
      {parsed.segments.map((segment, index) =>
        segment.type === "markdown" ? (
          <MarkdownContent
            components={markdownComponents}
            key={`markdown-${index}`}
          >
            {segment.content}
          </MarkdownContent>
        ) : (
          <Fragment key={segment.decision.id}>
            <div className="decision-block readonly-decision">
              <p className="decision-label">Decision in this version</p>
              <MarkdownContent components={markdownComponents}>
                {segment.decision.body}
              </MarkdownContent>
              <div className="decision-actions">
                <span className="decision-choice">{segment.decision.choiceA}</span>
                <span className="decision-choice">{segment.decision.choiceB}</span>
              </div>
            </div>
          </Fragment>
        ),
      )}
    </article>
  );
}
