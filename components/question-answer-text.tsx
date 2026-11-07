"use client";

import type { ComponentProps } from "react";
import type { QuestionAnswerReference } from "@/lib/question-transcript";
import { RichUserText } from "@/components/rich-user-text";

export function questionAnswerFields(content: string, reference?: QuestionAnswerReference) {
  if (!reference) return;
  if (reference.display) {
    // Editing and resending an answer must display the edited message itself.
    return reference.display.summary === content ? reference.display.fields : undefined;
  }
  // Historical replies store a flat "Question?: Answer" summary. Preserve the
  // answer verbatim, including colons, URLs and line breaks.
  const legacy = content.match(/^([^\n]*?\?):[ \t]+([\s\S]+)$/);
  return legacy ? [{ question: legacy[1], answer: legacy[2] }] : undefined;
}

export function QuestionAnswerText({ content, reference, references }: {
  content: string;
  reference?: QuestionAnswerReference;
  references?: ComponentProps<typeof RichUserText>["references"];
}) {
  const fields = questionAnswerFields(content, reference);
  if (!fields?.length) return <RichUserText content={content} references={references} />;
  return <dl className="space-y-4" data-slot="question-answer">
    {fields.map((field, index) => <div key={index} className="space-y-1.5">
      <dt className="whitespace-pre-wrap border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground">{field.question}</dt>
      <dd className="whitespace-pre-wrap text-[15px] leading-[1.55] text-foreground"><RichUserText content={field.answer} references={references} /></dd>
    </div>)}
  </dl>;
}
