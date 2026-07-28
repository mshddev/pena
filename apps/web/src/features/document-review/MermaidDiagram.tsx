import {
  useEffect,
  useId,
  useState,
  type ComponentPropsWithoutRef,
} from "react";

type Mermaid = (typeof import("mermaid"))["default"];

type RenderState =
  | { status: "loading" }
  | { status: "rendered"; source: string; svg: string }
  | { status: "error"; message: string; source: string };

interface MermaidDiagramProps
  extends Omit<ComponentPropsWithoutRef<"figure">, "children"> {
  source: string;
}

let mermaidPromise: Promise<Mermaid> | undefined;

export function MermaidDiagram({
  source,
  ...figureProps
}: MermaidDiagramProps) {
  const reactId = useId();
  const diagramId = `pena-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [renderState, setRenderState] = useState<RenderState>({
    status: "loading",
  });

  useEffect(() => {
    let isCurrent = true;

    setRenderState({ status: "loading" });

    void loadMermaid()
      .then((mermaid) => mermaid.render(diagramId, source))
      .then(({ svg }) => {
        if (isCurrent) {
          setRenderState({ status: "rendered", source, svg });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setRenderState({
            status: "error",
            source,
            message:
              error instanceof Error
                ? error.message
                : "Mermaid could not render this diagram.",
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [diagramId, source]);

  const currentRenderState =
    renderState.status !== "loading" && renderState.source !== source
      ? { status: "loading" as const }
      : renderState;

  if (currentRenderState.status === "error") {
    return (
      <figure
        {...figureProps}
        className="mermaid-diagram mermaid-diagram-error"
      >
        <figcaption>Unable to render Mermaid diagram</figcaption>
        <p>{currentRenderState.message}</p>
        <pre>
          <code className="language-mermaid">{source}</code>
        </pre>
      </figure>
    );
  }

  return (
    <figure {...figureProps} className="mermaid-diagram">
      {currentRenderState.status === "loading" ? (
        <div className="mermaid-diagram-loading" aria-busy="true">
          Rendering diagram…
        </div>
      ) : (
        <div
          className="mermaid-diagram-canvas"
          role="img"
          aria-label="Mermaid diagram"
          dangerouslySetInnerHTML={{ __html: currentRenderState.svg }}
        />
      )}
    </figure>
  );
}

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid")
      .then(({ default: mermaid }) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          suppressErrorRendering: true,
          theme: "dark",
        });

        return mermaid;
      })
      .catch((error: unknown) => {
        mermaidPromise = undefined;
        throw error;
      });
  }

  return mermaidPromise;
}
