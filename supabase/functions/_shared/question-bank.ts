export type AnswerChoice = "a" | "b" | "c" | "d";

export interface QuizDefinition {
  readonly moduleNumber: number;
  readonly passScore: number;
  readonly answers: Readonly<Record<string, AnswerChoice>>;
}

export const ANSWER_KEY_VERSION = "1.3.0-20260811";

// This is the authoritative grading key used by the Edge Function. The public
// course source also contains answer feedback, so the key is not treated as a
// credential; the security boundary is that clients cannot submit scores.
export const QUESTION_BANK: Readonly<Record<string, QuizDefinition>> = Object.freeze({
  "module-1-mini-signal-to-outcome": {
    moduleNumber: 1,
    passScore: 1,
    answers: { "module-1-mini-signal-to-outcome-q1": "b" },
  },
  "module-1-mini-interpretable-outcome": {
    moduleNumber: 1,
    passScore: 1,
    answers: { "module-1-mini-interpretable-outcome-q1": "c" },
  },
  "module-1-mini-decision-draft": {
    moduleNumber: 1,
    passScore: 1,
    answers: { "module-1-mini-decision-draft-q1": "d" },
  },
  "module-1-knowledge-check": {
    moduleNumber: 1,
    passScore: 4,
    answers: {
      "module-1-knowledge-check-q1": "b",
      "module-1-knowledge-check-q2": "c",
      "module-1-knowledge-check-q3": "a",
      "module-1-knowledge-check-q4": "d",
    },
  },
  "module-2-mini-pre-deployment": {
    moduleNumber: 2,
    passScore: 1,
    answers: { "module-2-mini-pre-deployment-q1": "b" },
  },
  "module-2-mini-reconcile-batch": {
    moduleNumber: 2,
    passScore: 1,
    answers: { "module-2-mini-reconcile-batch-q1": "c" },
  },
  "module-2-self-check": {
    moduleNumber: 2,
    passScore: 4,
    answers: {
      "module-2-self-check-q1": "c",
      "module-2-self-check-q2": "a",
      "module-2-self-check-q3": "d",
      "module-2-self-check-q4": "b",
    },
  },
  "module-3-mini-folder-map": {
    moduleNumber: 3,
    passScore: 1,
    answers: { "module-3-mini-folder-map-q1": "c" },
  },
  "module-3-mini-naming-rule": {
    moduleNumber: 3,
    passScore: 1,
    answers: { "module-3-mini-naming-rule-q1": "b" },
  },
  "module-3-self-check": {
    moduleNumber: 3,
    passScore: 4,
    answers: {
      "module-3-self-check-q1": "b",
      "module-3-self-check-q2": "d",
      "module-3-self-check-q3": "a",
      "module-3-self-check-q4": "c",
    },
  },
  "module-4-mini-pilot-manifest": {
    moduleNumber: 4,
    passScore: 1,
    answers: { "m4-mini-1": "d" },
  },
  "module-4-self-check": {
    moduleNumber: 4,
    passScore: 3,
    answers: { "m4-check-1": "b", "m4-check-2": "c", "m4-check-3": "a" },
  },
  "module-5-mini-pilot-review": {
    moduleNumber: 5,
    passScore: 1,
    answers: { "m5-mini-1": "c" },
  },
  "module-5-self-check": {
    moduleNumber: 5,
    passScore: 3,
    answers: { "m5-check-1": "b", "m5-check-2": "a", "m5-check-3": "d" },
  },
  "module-6-mini-safe-merge": {
    moduleNumber: 6,
    passScore: 1,
    answers: { "m6-mini-1": "b" },
  },
  "module-6-self-check": {
    moduleNumber: 6,
    passScore: 4,
    answers: {
      "m6-check-1": "c",
      "m6-check-2": "b",
      "m6-check-3": "d",
      "m6-check-4": "a",
    },
  },
  "module-7-mini-audit-rehearsal": {
    moduleNumber: 7,
    passScore: 1,
    answers: { "m7-mini-1": "a" },
  },
  "module-7-self-check": {
    moduleNumber: 7,
    passScore: 4,
    answers: {
      "m7-check-1": "c",
      "m7-check-2": "d",
      "m7-check-3": "b",
      "m7-check-4": "a",
    },
  },
  "final-workflow-checkpoint": {
    moduleNumber: 8,
    passScore: 6,
    answers: {
      "final-q1": "b",
      "final-q2": "c",
      "final-q3": "b",
      "final-q4": "a",
      "final-q5": "c",
      "final-q6": "b",
      "final-q7": "c",
      "final-q8": "a",
    },
  },
  "module-8-applied-cases": {
    moduleNumber: 8,
    passScore: 5,
    answers: {
      "m8-case-1": "b",
      "m8-case-2": "d",
      "m8-case-3": "c",
      "m8-case-4": "a",
      "m8-case-5": "b",
    },
  },
  "module-8-concept-review": {
    moduleNumber: 8,
    passScore: 6,
    answers: {
      "m8-review-1": "c",
      "m8-review-2": "a",
      "m8-review-3": "d",
      "m8-review-4": "b",
      "m8-review-5": "a",
      "m8-review-6": "c",
    },
  },
  "module-8-mini-capstone-audit": {
    moduleNumber: 8,
    passScore: 1,
    answers: { "m8-mini-1": "d" },
  },
});

export interface GradedAnswer {
  question_id: string;
  question_order: number;
  selected_answer: AnswerChoice;
  is_correct: boolean;
}

export interface GradeResult {
  quiz_id: string;
  answers: GradedAnswer[];
  score: number;
  total: number;
  passed: boolean;
  answer_key_version: string;
}

export function gradeQuiz(
  quizId: string,
  submittedAnswers: Readonly<Record<string, AnswerChoice>>,
): GradeResult {
  const definition = QUESTION_BANK[quizId];
  if (!definition) throw new Error("unknown_quiz");

  const expectedIds = Object.keys(definition.answers);
  const submittedIds = Object.keys(submittedAnswers);
  if (
    submittedIds.length !== expectedIds.length ||
    expectedIds.some((questionId) => !Object.hasOwn(submittedAnswers, questionId)) ||
    submittedIds.some((questionId) => !Object.hasOwn(definition.answers, questionId))
  ) {
    throw new Error("incomplete_quiz_attempt");
  }

  const answers = expectedIds.map((questionId, index) => {
    const selected = submittedAnswers[questionId];
    if (!(["a", "b", "c", "d"] as const).includes(selected)) {
      throw new Error("invalid_answer_choice");
    }
    return {
      question_id: questionId,
      question_order: index + 1,
      selected_answer: selected,
      is_correct: selected === definition.answers[questionId],
    };
  });
  const score = answers.filter((answer) => answer.is_correct).length;

  return {
    quiz_id: quizId,
    answers,
    score,
    total: answers.length,
    passed: score >= definition.passScore,
    answer_key_version: ANSWER_KEY_VERSION,
  };
}
