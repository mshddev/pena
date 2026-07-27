import type { DecisionBlock as DecisionBlockDefinition } from "@pena/contracts";
import { useMemo, useRef } from "react";

import { MarkdownContent } from "../MarkdownContent";
import { createAnnotatedMarkdownComponents } from "../markdown-components";

interface DecisionBlockProps {
  decision: DecisionBlockDefinition;
  namespace: string;
  draftChoice: string | null;
  submittedChoice: string | null;
  isSubmitting: boolean;
  position: number;
  total: number;
  onChoice: (
    decision: DecisionBlockDefinition,
    choice: string,
    bodyElement: HTMLElement,
  ) => void;
}

export function DecisionBlock({
  decision,
  namespace,
  draftChoice,
  submittedChoice,
  isSubmitting,
  position,
  total,
  onChoice,
}: DecisionBlockProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const components = useMemo(
    () => createAnnotatedMarkdownComponents(namespace),
    [namespace],
  );
  const selectedChoice = submittedChoice ?? draftChoice;
  const isSubmitted = submittedChoice !== null;
  const isDisabled = isSubmitted || isSubmitting;

  function choose(choice: string): void {
    if (bodyRef.current && !isDisabled) {
      onChoice(decision, choice, bodyRef.current);
    }
  }

  return (
    <section
      className={`decision-block${isSubmitted ? " submitted" : ""}`}
      data-decision-id={decision.id}
    >
      <p className="decision-label" data-pena-annotation>
        {/* A lone decision needs no place in a sequence. */}
        {total > 1 ? (
          <span className="decision-position">
            {position}/{total}
          </span>
        ) : null}
        {isSubmitted ? "Decision submitted" : "Decision required"}
      </p>
      <div className="decision-body" ref={bodyRef}>
        <MarkdownContent components={components}>
          {decision.body}
        </MarkdownContent>
      </div>
      <div
        className="decision-actions"
        data-pena-annotation
        data-pena-decision-control
        role="group"
        aria-label={`Decision options for ${decision.id}`}
      >
        {[decision.choiceA, decision.choiceB].map((choice) => {
          const isSelected = selectedChoice === choice;

          return (
            <button
              className={`decision-choice${isSelected ? " selected" : ""}`}
              type="button"
              key={choice}
              aria-pressed={isSelected}
              disabled={isDisabled}
              onClick={() => choose(choice)}
            >
              {choice}
            </button>
          );
        })}
      </div>
    </section>
  );
}
